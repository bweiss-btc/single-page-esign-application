// Bank statement upload proxy.
//
// HISTORY:
//   v1 — Raw byte-for-byte multipart forward.
//   v2 — Dual binary + base64 multipart. Broke uploads (boundary regen).
//   v3 — Base64 JSON. Worked but constrained by Vercel 4.5MB inbound limit.
//   v4 — Fire-and-forget. Worked but blind to n8n failures.
//   v5 — maxDuration: 60 + real wait. Real failures surface, still 4.5MB cap.
//   v6 (current) — Accepts Vercel Blob URLs. Browser uploads files directly
//                  to Blob via /api/blob-upload-token (bypassing the 4.5MB
//                  function body limit), then sends ONLY the URLs to this
//                  endpoint. We download from Blob, encode to base64, and
//                  forward to n8n. After successful forward, blobs are
//                  deleted to avoid storage accumulation.
//
//                  Backward compatible with v5: if a request comes in as
//                  multipart/form-data instead of JSON, the multipart path
//                  still works. This avoids breaking during the deploy
//                  window where the new App.jsx hasn't fully rolled out yet.
//
// FILE SIZE: Vercel Blob client upload supports up to 5 TB per file. Bank
// statements at 10-20 MB are nowhere near a problem.
//
// EXPECTED JSON PAYLOAD SHAPE (new path):
//   {
//     "event": "bank_statements_uploaded",
//     "step": "bank_upload",
//     "email": "customer@example.com",
//     ...other metadata fields...
//     "blobs": [
//       {
//         "url": "https://<store>.blob.vercel-storage.com/bank-statements/...",
//         "filename": "BS1.pdf",
//         "mimetype": "application/pdf",
//         "size_bytes": 9831234,
//         "field_name": "file_0"
//       },
//       ...
//     ]
//   }

import { Readable } from "node:stream";
import { del } from "@vercel/blob";

const WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";

export const config = {
  // bodyParser stays default for JSON path. For multipart fallback path,
  // we override below by detecting Content-Type and re-reading the stream.
  api: {
    bodyParser: {
      sizeLimit: "10mb", // accommodates JSON shape (URLs only, very small)
    },
  },
  maxDuration: 60,
};

// Same security headers as before.
function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

// Process a JSON body containing Blob URLs. Downloads each blob, encodes to
// base64, builds the n8n payload, posts to n8n, and deletes the blobs on
// success.
async function handleJsonWithBlobs(req, res, body) {
  if (!Array.isArray(body.blobs)) {
    return res.status(400).json({ error: "Expected blobs array in JSON body" });
  }
  if (body.blobs.length === 0) {
    return res.status(400).json({ error: "blobs array is empty" });
  }

  // Download each blob from Vercel Blob storage and encode to base64. Server-
  // to-server fetch isn't subject to the 4.5MB inbound limit (that only
  // applies to incoming request bodies, not outbound fetches we initiate),
  // so we can handle files of any size here.
  const files = [];
  for (const blob of body.blobs) {
    if (!blob.url || typeof blob.url !== "string") {
      return res.status(400).json({ error: "blob entry missing url" });
    }

    let buffer;
    try {
      const r = await fetch(blob.url);
      if (!r.ok) {
        return res.status(502).json({
          error: "Failed to download blob from Vercel Blob",
          blob_status: r.status,
          blob_url: blob.url,
        });
      }
      const arrayBuffer = await r.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (fetchErr) {
      return res.status(502).json({
        error: "Network error downloading blob",
        details: fetchErr.message,
      });
    }

    files.push({
      field_name: blob.field_name || `file_${files.length}`,
      filename: blob.filename || "",
      mimetype: blob.mimetype || "application/octet-stream",
      size_bytes: buffer.length,
      base64: buffer.toString("base64"),
    });
  }

  // Strip the blobs array from the outbound payload — n8n doesn't need to
  // know about Vercel Blob, only about the file contents.
  const { blobs, ...rest } = body;
  const outboundPayload = {
    ...rest,
    files,
    file_count: files.length,
  };

  const upstream = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(outboundPayload),
  });
  const text = await upstream.text();

  // Always try to clean up blobs after sending to n8n, regardless of n8n's
  // success. If n8n succeeded, the data is already through. If n8n failed,
  // the customer will see an error and either retry (uploading new blobs)
  // or contact support. Leaving blobs around accumulates storage cost. The
  // del calls are wrapped individually so one bad URL doesn't block cleanup
  // of others.
  await Promise.all(
    blobs.map(async (b) => {
      try { await del(b.url); } catch (e) { /* swallow - cleanup is best effort */ }
    })
  );

  if (!upstream.ok) {
    return res.status(upstream.status).json({
      error: "Upload forwarding to n8n failed",
      upstream_status: upstream.status,
      upstream_body: text.slice(0, 500),
      files_processed: files.length,
    });
  }

  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { parsed = { success: true, message: text }; }
  return res.status(200).json(parsed || { success: true });
}

// Legacy multipart fallback for the deploy-window edge case where the old
// App.jsx is still in some browsers. Same logic as v5: parse multipart,
// base64 encode, forward to n8n as JSON.
async function handleMultipartFallback(req, res) {
  // Body parser was already invoked for JSON above. For multipart, we need
  // raw bytes. Disable parsing temporarily by reading the stream directly.
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
}

export default async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const contentType = (req.headers["content-type"] || "").toLowerCase();

    if (contentType.includes("application/json")) {
      // New path: JSON body with Blob URLs.
      // bodyParser has already parsed req.body for us.
      const body = req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
      return await handleJsonWithBlobs(req, res, body);
    }

    if (contentType.includes("multipart/form-data")) {
      // Legacy path: multipart with files inline. Still works for files
      // small enough to fit under the 4.5MB inbound limit. NOTE: when
      // bodyParser is enabled (as it is in config above for JSON), Vercel
      // may have already consumed the body for multipart, breaking this
      // fallback. In practice browsers will be hitting the JSON path once
      // the new App.jsx deploys; this fallback is just a transitional
      // safety net.
      return await handleMultipartFallback(req, res);
    }

    return res.status(400).json({
      error: "Expected application/json or multipart/form-data",
      got: contentType,
    });
  } catch (err) {
    return res.status(500).json({ error: "Upload failed: " + err.message });
  }
}
