// Bank statement upload proxy.
//
// HISTORY:
//   v1 — Raw byte-for-byte multipart forward.
//   v2 — Dual binary + base64 multipart. Boundary regeneration broke uploads.
//   v3 — Base64-only JSON. Cleaner, but uploads timed out (504) on the 10s
//        Hobby tier limit.
//   v4 — Fire-and-forget with 5s AbortController. Returned success blindly.
//   v5 — Base64 JSON, real wait for n8n. Worked for files <4.5MB but bigger
//        uploads still hit Vercel's INBOUND limit at the edge.
//   v6 (current) — Dual-path: JSON-with-Blob-URLs (preferred, no size limit)
//        OR multipart-with-base64 (fallback, kept for backwards compat).
//
// NEW PATH — JSON with Blob URLs:
//   Browser uploads each file directly to Vercel Blob storage using a
//   presigned token from /api/blob-upload-token. Then sends JUST the resulting
//   blob URLs to THIS endpoint as a small JSON payload. We fetch each URL
//   server-to-server (no inbound size limit on that direction), base64 encode,
//   and forward to n8n. After successful forward, we delete the temporary
//   blobs to keep storage clean.
//
//   This path bypasses Vercel's 4.5MB inbound limit entirely. Customers can
//   upload statements of any reasonable size (Vercel Blob supports 5TB per
//   file, though we cap at 100MB in the token endpoint).
//
// FALLBACK PATH — multipart with base64:
//   Same as v5. Kept around so old client builds or anything that still
//   POSTs multipart still works. The 4.5MB limit applies here.
//
// SHARED OUTPUT FORMAT TO N8N:
//   Both paths produce the same JSON shape sent to n8n:
//   {
//     event, step, email, timestamp, agent_param, slug, link_url, agent_info,
//     submission_id, total_files, file_count,
//     files: [
//       { field_name, filename, mimetype, size_bytes, base64 },
//       ...
//     ]
//   }
//   So n8n workflow nodes don't care which client path was used.

import { Readable } from "node:stream";
import { del } from "@vercel/blob";

const WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";

export const config = {
  api: {
    bodyParser: false,
  },
  // Vercel Pro allows up to 300s. 60s is plenty for n8n's normal workflow.
  maxDuration: 60,
};

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

// Read the raw request body into a Buffer when bodyParser is disabled.
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// JSON path: client uploaded files to Blob first, sends URLs here.
async function handleJsonPath(req, res, raw) {
  let payloadIn;
  try {
    payloadIn = JSON.parse(raw.toString("utf-8"));
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { blob_files, ...metadata } = payloadIn;

  if (!Array.isArray(blob_files) || blob_files.length === 0) {
    return res.status(400).json({ error: "blob_files array is required and non-empty" });
  }

  // Fetch each file from Vercel Blob and base64 encode.
  const files = [];
  const blobUrls = [];
  for (const bf of blob_files) {
    if (!bf || !bf.url) {
      return res.status(400).json({ error: "Each blob_files entry must have a url" });
    }
    blobUrls.push(bf.url);

    let fileBuffer;
    try {
      const fileRes = await fetch(bf.url);
      if (!fileRes.ok) {
        return res.status(502).json({
          error: "Could not fetch blob",
          blob_url: bf.url,
          status: fileRes.status,
        });
      }
      fileBuffer = Buffer.from(await fileRes.arrayBuffer());
    } catch (fetchErr) {
      return res.status(502).json({
        error: "Could not fetch blob",
        blob_url: bf.url,
        details: fetchErr.message,
      });
    }

    files.push({
      field_name: bf.field_name || `file_${files.length}`,
      filename: bf.filename || bf.pathname || "",
      mimetype: bf.mimetype || "application/octet-stream",
      size_bytes: fileBuffer.length,
      base64: fileBuffer.toString("base64"),
    });
  }

  const outPayload = { ...metadata, files, file_count: files.length };

  // Forward to n8n. With maxDuration: 60s, we have time to wait for the full
  // workflow to complete and return real success/failure to the browser.
  let upstreamStatus = 0;
  let upstreamBody = "";
  let upstreamOk = false;
  try {
    const upstream = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outPayload),
    });
    upstreamStatus = upstream.status;
    upstreamOk = upstream.ok;
    upstreamBody = await upstream.text();
  } catch (forwardErr) {
    // If forwarding fails, we DON'T delete the blobs — leaves them for retry
    // or manual recovery. Vercel Blob has its own TTL/cost model so they'll
    // eventually expire if abandoned, but they're cheap.
    return res.status(502).json({
      error: "Could not forward to upstream",
      details: forwardErr.message,
      files_processed: files.length,
    });
  }

  if (!upstreamOk) {
    // Same reasoning as above: leave blobs for retry/inspection on failure.
    return res.status(upstreamStatus).json({
      error: "Upload forwarding failed",
      upstream_status: upstreamStatus,
      upstream_body: upstreamBody.slice(0, 500),
      files_processed: files.length,
    });
  }

  // Forward succeeded → clean up the temporary blobs to keep storage tidy.
  // Best-effort: log but don't fail the request if deletion fails.
  await Promise.all(blobUrls.map(async (url) => {
    try { await del(url); } catch (e) {
      try { console.log("[upload-bank] blob delete failed:", url, e.message); } catch (_) {}
    }
  }));

  let parsed;
  try { parsed = JSON.parse(upstreamBody); } catch (e) { parsed = { success: true, message: upstreamBody }; }
  return res.status(200).json(parsed || { success: true });
}

// Multipart path (fallback): client sent files inline as form-data.
async function handleMultipartPath(req, res, raw) {
  // Reconstruct a Web Request from the buffered body so we can use Node's
  // built-in FormData parser.
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) headers.set(k, v.join(", "));
    else if (v != null) headers.set(k, String(v));
  }

  const incomingRequest = new Request("http://localhost/", {
    method: "POST",
    headers,
    body: raw,
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

    // Read raw bytes once. Both paths need a Buffer because bodyParser: false
    // means req is a stream.
    const raw = await readRawBody(req);

    if (contentType.includes("application/json")) {
      return await handleJsonPath(req, res, raw);
    }
    if (contentType.includes("multipart/form-data")) {
      return await handleMultipartPath(req, res, raw);
    }
    return res.status(400).json({
      error: "Unsupported content-type. Expected application/json or multipart/form-data.",
      received: contentType,
    });
  } catch (err) {
    return res.status(500).json({ error: "Upload failed: " + err.message });
  }
}
