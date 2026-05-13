// Multipart proxy for bank statement uploads.
//
// The browser can't POST multipart/form-data directly to the n8n webhook because of
// the Access-Control-Allow-Origin:https://offers.bigthinkcapital.com header that n8n
// (or the reverse proxy in front of it) returns. That preflight failure is what made
// bank uploads look like "binary not sending correctly" — the browser would send the
// request but the response would be blocked, and sometimes the binary payload doesn't
// even reach the server because preflight fails.
//
// HISTORICAL APPROACH (deprecated):
// We used to forward raw bytes byte-for-byte, preserving the original multipart boundary,
// because that's the simplest way to keep binary integrity. But that meant the n8n
// workflow only saw files in binary form, with no easy way to inspect file contents in
// downstream nodes that expect base64 strings (Salesforce attachments, some HTTP APIs,
// AI extraction nodes, etc.).
//
// CURRENT APPROACH:
// We parse the incoming multipart form, then forward to n8n with each file represented
// TWICE in the new payload:
//   - file_N           — the original binary file (unchanged, multipart part with bytes)
//   - file_N_base64    — the same file's contents encoded as a base64 string field
//   - file_N_filename  — original filename (so n8n knows what to call the base64 version)
//   - file_N_mimetype  — original content-type
// Non-file fields (event, step, email, etc.) pass through untouched. n8n nodes can
// consume whichever form they prefer; existing binary-consuming nodes keep working.
//
// Vercel serverless limit: ~4.5MB total request body. Three bank statement PDFs are
// usually well under this. If users hit the limit, we'll need to move to Vercel Blob
// (direct-to-storage upload, then pass URLs to n8n). Base64 encoding happens AFTER
// the request enters this function, so it doesn't affect the ingress limit (it only
// affects egress size from Vercel → n8n, which has no comparable cap).

import { Readable } from "node:stream";

const WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Basic security headers (same as create-submission.js)
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

    // Parse the incoming multipart body using Node's built-in Web Streams + Request +
    // FormData APIs (Node 18+, which Vercel runs on). We convert the Node IncomingMessage
    // stream to a Web ReadableStream, wrap it in a Request, then call formData() to get
    // a parsed FormData object where File entries have .arrayBuffer() and .name.
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

    // Rebuild a new FormData for the outbound request. For File entries, append the
    // original File AND a parallel base64 string field. For everything else, pass
    // through untouched.
    const outgoing = new FormData();
    let fileCount = 0;

    for (const [key, value] of incoming.entries()) {
      // Detect file entries. In Node's Web FormData implementation, files come back
      // as File or Blob objects with a .name property. Check for arrayBuffer presence
      // as a more reliable signal across runtimes than instanceof File.
      const isFile = value && typeof value === "object" && typeof value.arrayBuffer === "function";

      if (isFile) {
        // Re-append the original file under its original key so the binary path stays
        // exactly as it was before this change. n8n nodes that consume binary continue
        // to work without any workflow modification.
        outgoing.append(key, value, value.name || `${key}.bin`);

        // Compute base64 of the file's bytes and append as a string field. The key is
        // `${key}_base64` so an existing field "file_0" gets a sibling "file_0_base64".
        const buffer = Buffer.from(await value.arrayBuffer());
        outgoing.append(`${key}_base64`, buffer.toString("base64"));

        // Helpful metadata alongside the base64 string so n8n nodes consuming the
        // base64 path know what to call the file and what its mime type is. (The
        // binary multipart part already includes these via Content-Disposition and
        // Content-Type headers, but a node consuming the base64 string field won't
        // see those.)
        outgoing.append(`${key}_filename`, value.name || "");
        outgoing.append(`${key}_mimetype`, value.type || "application/octet-stream");

        fileCount++;
      } else {
        // Plain string field (event, email, agent_param, etc.) — pass through as-is.
        outgoing.append(key, value);
      }
    }

    // Forward to n8n. Letting fetch handle the body means it generates a fresh
    // multipart boundary and sets Content-Type automatically. We don't set the
    // Content-Type header ourselves — if we did, the boundary in the header would
    // mismatch the boundary in the body that FormData generates internally.
    const upstream = await fetch(WEBHOOK, {
      method: "POST",
      body: outgoing,
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "Upload forwarding failed",
        upstream_status: upstream.status,
        upstream_body: text.slice(0, 500),
        files_processed: fileCount,
      });
    }

    // n8n usually returns JSON but sometimes plain text — pass through if JSON,
    // wrap otherwise.
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { parsed = { success: true, message: text }; }
    return res.status(200).json(parsed || { success: true });
  } catch (err) {
    return res.status(500).json({ error: "Upload failed: " + err.message });
  }
}
