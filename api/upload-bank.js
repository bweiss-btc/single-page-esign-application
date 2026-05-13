// Bank statement upload proxy.
//
// HISTORY:
//   v1 — Raw byte-for-byte multipart forward to n8n. Binary preserved exactly.
//        Simple but n8n nodes couldn't easily inspect file contents without
//        binary-to-base64 conversion downstream.
//   v2 — Parsed multipart, forwarded BOTH binary and base64. Idea was to give
//        n8n flexibility to use whichever it preferred. Problem: rebuilding the
//        multipart payload with Node FormData + fetch regenerated the boundary
//        and apparently confused n8n's webhook handler — uploads stopped working.
//   v3 (current) — Base64 ONLY, sent as JSON.
//
// WHY JSON-WITH-BASE64:
//   - Deterministic: no multipart boundary fragility, no Content-Type/body mismatch
//     possible. fetch() builds the body, sets Content-Type: application/json, done.
//   - Easier for n8n to consume: every field including file contents is just a
//     property on $json. No "switch between binary and JSON nodes" gymnastics.
//   - One canonical representation per file, no duplication.
//
// COST:
//   - Base64 inflates file size by ~33%. For 4 bank statements at ~10MB each,
//     that's ~40MB binary becoming ~53MB base64. Vercel function outbound has no
//     4.5MB limit (only inbound does), so the forward to n8n is fine. n8n's
//     webhook needs to accept ~53MB JSON bodies, which is well within Express'
//     default body parser limit of 100MB (and n8n inherits Express).
//
// IMPORTANT LIMITATION (UNCHANGED):
//   - The 4.5MB Vercel INBOUND limit still applies to the browser → this function
//     hop. If a customer uploads >4.5MB total, this function never runs. The fix
//     for THAT is Vercel Blob (direct browser → storage), separate change.
//
// REQUIRED N8N WORKFLOW UPDATE:
//   - Existing nodes consuming binary file_0 multipart parts will not find them
//     anymore. Update those nodes to:
//     1. Read $json.files[0].base64 (or whatever index)
//     2. Convert base64 → binary using a Code node or built-in base64 decode
//   - Or, if Salesforce attachments are the target, Salesforce's Body field
//     accepts base64 directly — just pass $json.files[0].base64 straight through.

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
    // FormData APIs (Node 18+, which Vercel runs on). Convert the Node IncomingMessage
    // stream into a Web ReadableStream, wrap it in a Request, then call formData() to
    // get a parsed FormData where File entries expose .arrayBuffer() and .name.
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
    // base64 contents, filename, mimetype, and size. The array preserves the
    // order the files were uploaded.
    const payload = {};
    const files = [];

    for (const [key, value] of incoming.entries()) {
      const isFile = value && typeof value === "object" && typeof value.arrayBuffer === "function";

      if (isFile) {
        const buffer = Buffer.from(await value.arrayBuffer());
        files.push({
          field_name: key,                                       // e.g. "file_0"
          filename: value.name || "",
          mimetype: value.type || "application/octet-stream",
          size_bytes: buffer.length,
          base64: buffer.toString("base64"),
        });
      } else {
        // Plain string field — preserve as JSON property. Includes things like
        // event, step, email, timestamp, agent_param, slug, link_url,
        // agent_info, submission_id, total_files.
        payload[key] = value;
      }
    }

    payload.files = files;
    payload.file_count = files.length;

    // Forward to n8n as JSON. No multipart, no boundary handling — fetch sets
    // Content-Type: application/json and the body is a deterministic string.
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
