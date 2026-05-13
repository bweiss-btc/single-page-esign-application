// Bank statement upload proxy.
//
// HISTORY:
//   v1 — Raw byte-for-byte multipart forward. Binary preserved exactly but
//        n8n nodes couldn't easily inspect contents.
//   v2 — Dual binary + base64 multipart. Boundary regeneration broke uploads.
//   v3 — Base64-only JSON. Cleaner, but uploads timed out (504) because the
//        function blocked waiting for n8n's full workflow to complete.
//   v4 (current) — Base64 JSON with fire-and-forget semantics. We send the
//        payload to n8n, wait briefly for confirmation it was received, then
//        return success to the browser regardless of whether the n8n workflow
//        has finished. n8n keeps processing in the background.
//
// WHY FIRE-AND-FORGET:
//   - Vercel serverless functions have a 10-second execution limit on Hobby
//     (60s on Pro). The n8n workflow downstream of this webhook does Salesforce
//     writes, Box uploads, email sending, and multiple branch evaluations.
//     That whole chain easily exceeds 10s.
//   - n8n's webhook node, by default, only responds to the HTTP caller after
//     the entire workflow completes. So our `await fetch()` was blocking for
//     the full workflow duration, hitting Vercel's timeout, and returning 504
//     to the browser — even though n8n successfully received and processed
//     the upload.
//   - The browser doesn't actually need to wait for n8n to finish. It just
//     needs confirmation that the file was uploaded. n8n's own error handling
//     and retry logic catches downstream failures separately.
//
// HOW IT WORKS:
//   - Start the fetch to n8n.
//   - Race it against a 5-second timeout (well under Vercel's 10s limit).
//   - If n8n responds in time (rare — workflow usually takes longer), forward
//     that response to the browser.
//   - If the timeout fires first, abort the fetch and return success with a
//     "queued" flag. The TCP body has long since been sent at this point —
//     n8n has the data and is processing it.
//   - If something genuinely fails (network error, DNS, etc.), surface that
//     to the browser.
//
// TRADEOFFS:
//   - If n8n returns an error AFTER we've already returned success, the
//     browser won't know. The customer will see a thank-you page even if
//     Salesforce sync failed silently. We rely on the rep being notified via
//     the existing email path and on n8n's error workflows to surface issues.
//   - If n8n is completely unreachable, the abort/error path catches it and
//     returns 500 to the browser. So actual failures still surface.
//
// IMPORTANT LIMITATION (UNCHANGED):
//   - The 4.5MB Vercel INBOUND limit still applies. Customers uploading >4.5MB
//     of statements still get blocked at the edge. Vercel Blob is the fix for
//     that, separate change.

import { Readable } from "node:stream";

const WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";

// 5 seconds gives n8n a chance to respond quickly if it's configured to and
// leaves a comfortable buffer under Vercel's 10s execution limit.
const UPSTREAM_RESPONSE_TIMEOUT_MS = 5000;

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: "Expected multipart/form-data" });
    }

    // Parse the multipart body using Node's built-in Web Request + FormData APIs.
    const webStream = Readable.toWeb(req);
    const incomingRequest = new Request("http://localhost/", {
      method: "POST",
      headers: new Headers(req.headers),
      body: webStream,
      duplex: "half",
    });

    let incoming;
    try {
      incoming = await incomingRequest.formData();
    } catch (parseErr) {
      return res.status(400).json({ error: "Failed to parse multipart: " + parseErr.message });
    }

    // Build the JSON payload for n8n.
    const payload = {};
    const files = [];

    for (const [key, value] of incoming.entries()) {
      const isFile = value && typeof value === "object" && typeof value.arrayBuffer === "function";

      if (isFile) {
        const buffer = Buffer.from(await value.arrayBuffer());
        files.push({
          field_name: key,
          filename: value.name || "",
          mimetype: value.type || "application/octet-stream",
          size_bytes: buffer.length,
          base64: buffer.toString("base64"),
        });
      } else {
        payload[key] = value;
      }
    }

    payload.files = files;
    payload.file_count = files.length;

    // Fire the request to n8n with a short timeout. AbortController fires the
    // abort signal after the timeout. The body is sent over TCP almost
    // immediately (3MB payload at typical Vercel→n8n network speeds is well
    // under 1s); the wait is for n8n to FINISH processing and return headers.
    // We don't care about that — once the body is sent, n8n has the data.
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), UPSTREAM_RESPONSE_TIMEOUT_MS);

    let upstreamResponse = null;
    let upstreamError = null;

    try {
      upstreamResponse = await fetch(WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      upstreamError = err;
    } finally {
      clearTimeout(timeoutHandle);
    }

    // If we got a real network error that ISN'T an AbortError (DNS failure,
    // connection refused, etc.), surface it to the browser. AbortError just
    // means "n8n is taking longer than 5s to respond" which is expected.
    if (upstreamError && upstreamError.name !== "AbortError") {
      return res.status(502).json({
        error: "Could not reach upstream",
        details: upstreamError.message,
        files_processed: files.length,
      });
    }

    // If n8n responded within the timeout (uncommon but possible if the
    // workflow is fast or the webhook is configured to respond immediately),
    // honor its response.
    if (upstreamResponse) {
      const text = await upstreamResponse.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { parsed = { success: true, message: text }; }

      if (!upstreamResponse.ok) {
        return res.status(upstreamResponse.status).json({
          error: "Upload forwarding failed",
          upstream_status: upstreamResponse.status,
          upstream_body: text.slice(0, 500),
          files_processed: files.length,
        });
      }

      return res.status(200).json(parsed || { success: true });
    }

    // Timeout fired before n8n responded. The TCP body has already been sent
    // (n8n has the data); the workflow is just still processing. Return
    // success — the customer's upload is queued for processing.
    return res.status(200).json({
      success: true,
      queued: true,
      files_processed: files.length,
      message: "Upload received and queued for processing",
    });
  } catch (err) {
    return res.status(500).json({ error: "Upload failed: " + err.message });
  }
}
