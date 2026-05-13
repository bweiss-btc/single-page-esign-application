// Bank statement upload proxy.
//
// HISTORY:
//   v1 — Raw byte-for-byte multipart forward. Binary preserved exactly but
//        n8n nodes couldn't easily inspect contents.
//   v2 — Dual binary + base64 multipart. Boundary regeneration broke uploads.
//   v3 — Base64-only JSON. Cleaner, but uploads timed out (504) because the
//        function blocked waiting for n8n's full workflow to complete on
//        Vercel's 10s Hobby tier limit.
//   v4 — Fire-and-forget with 5s AbortController. Workaround for the 10s
//        Hobby limit. Returned success blindly after timeout.
//   v5 (current) — Base64 JSON, real wait for n8n. We're on Vercel Pro now,
//        so we can extend the function timeout to 60 seconds via config.
//        That's plenty of time for n8n's downstream Salesforce / Box / email
//        chain to actually finish, which means the browser gets real success
//        or failure feedback instead of a "queued, hope for the best" guess.
//
// WHY THIS IS BETTER:
//   - If Salesforce sync or Box upload fails inside n8n, the customer is now
//     told about it instead of seeing a thank-you page over silent breakage.
//   - The funding expert doesn't have to babysit n8n executions to catch
//     downstream failures — they bubble up as upload errors on the customer side.
//   - Simpler code: no AbortController, no timeout handling, no "queued" path.
//
// IMPORTANT LIMITATION (UNCHANGED):
//   - The 4.5MB Vercel INBOUND limit still applies. Customers uploading >4.5MB
//     of statements still get blocked at the edge before this function runs.
//     Vercel Blob is the fix for that, separate change.

import { Readable } from "node:stream";

const WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";

export const config = {
  api: {
    bodyParser: false,
  },
  // Vercel Pro allows up to 300s. 60s is plenty for n8n's normal workflow
  // execution and leaves headroom if downstream services are slow.
  maxDuration: 60,
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

    // Build the JSON payload for n8n. Non-file fields become top-level string
    // properties. File entries become objects in a `files` array, each with
    // base64 contents, filename, mimetype, and size.
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

    // Forward to n8n as JSON and wait for the actual response. With
    // maxDuration: 60 in config above, we have a full minute for n8n's
    // workflow to complete (Salesforce updates, Box uploads, email sending).
    const upstream = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "Upload forwarding failed",
        upstream_status: upstream.status,
        upstream_body: text.slice(0, 500),
        files_processed: files.length,
      });
    }

    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { parsed = { success: true, message: text }; }
    return res.status(200).json(parsed || { success: true });
  } catch (err) {
    return res.status(500).json({ error: "Upload failed: " + err.message });
  }
}
