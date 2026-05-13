// Bank statement upload proxy.
//
// HISTORY:
//   v1 — Raw multipart forward.
//   v2 — Dual binary + base64. Broke uploads.
//   v3 — Base64-only JSON, hit 10s function timeout (504).
//   v4 — Fire-and-forget. Worked but lost real success/failure feedback.
//   v5 — Direct multipart→JSON conversion with Pro tier 60s timeout. Worked
//        for files <4.5MB total but hit Vercel's inbound body cap above that.
//   v6 (CURRENT) — Two-path upload:
//        (A) JSON-with-blob-URLs (preferred): browser uploaded files directly
//            to Vercel Blob, sends us only the URLs. We fetch the bytes from
//            Blob storage (server-to-server, no inbound size cap), encode as
//            base64, forward as JSON to n8n.
//        (B) Multipart fallback: if a client somehow still sends multipart,
//            handle it the v5 way for backwards compatibility during deploys.
//        Path A removes the 4.5MB inbound limit entirely. Files can be 100MB+.
//
// REQUIRED ENV:
//   - BLOB_READ_WRITE_TOKEN — auto-injected when Vercel Blob store is
//     connected. Used for cleanup (deleting files after successful forward).
//
// CLEANUP:
//   After a successful forward to n8n, we delete the blobs to keep the store
//   tidy. If forwarding fails, blobs are left for manual cleanup or retry.

import { Readable } from "node:stream";
import { del } from "@vercel/blob";

const WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";

export const config = {
  api: {
    // Default body parser handles JSON. For the multipart fallback we override
    // by checking content-type and reading raw stream below.
    bodyParser: { sizeLimit: "4mb" },
  },
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const contentType = req.headers["content-type"] || "";

  try {
    let payload;
    let blobUrlsToDelete = [];

    if (contentType.includes("application/json")) {
      // PATH A: blob URLs in JSON. The browser already uploaded files to
      // Vercel Blob — we just need to fetch, encode, and forward.
      const body = req.body;
      if (!body || !Array.isArray(body.blob_files)) {
        return res.status(400).json({ error: "Missing blob_files array" });
      }

      const files = [];
      for (const blob of body.blob_files) {
        if (!blob || !blob.url) {
          return res.status(400).json({ error: "Each blob_files entry needs a url" });
        }
        const response = await fetch(blob.url);
        if (!response.ok) {
          return res.status(502).json({
            error: "Failed to fetch blob from storage",
            url: blob.url,
            status: response.status,
          });
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        files.push({
          field_name: blob.field_name || blob.filename,
          filename: blob.filename || "",
          mimetype: blob.mimetype || response.headers.get("content-type") || "application/octet-stream",
          size_bytes: buffer.length,
          base64: buffer.toString("base64"),
        });
        blobUrlsToDelete.push(blob.url);
      }

      // Pass through metadata fields as-is.
      payload = {
        event: body.event,
        step: body.step,
        email: body.email,
        timestamp: body.timestamp,
        agent_param: body.agent_param,
        slug: body.slug,
        link_url: body.link_url,
        agent_info: body.agent_info,
        submission_id: body.submission_id,
        total_files: body.total_files || String(files.length),
        file_count: files.length,
        files,
      };
    } else if (contentType.includes("multipart/form-data")) {
      // PATH B: legacy multipart fallback. Kept so an old client cached
      // during the rollout doesn't immediately break.
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

      payload = {};
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
    } else {
      return res.status(400).json({
        error: "Expected application/json with blob_files OR multipart/form-data",
        received: contentType,
      });
    }

    // Forward to n8n. With maxDuration: 60 we have a full minute for the
    // workflow to complete (Salesforce + Box + email).
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
        files_processed: payload.file_count,
      });
    }

    // Forward succeeded. Clean up any Blob files (best-effort, don't fail the
    // request if delete fails). Done in parallel for speed.
    if (blobUrlsToDelete.length > 0) {
      await Promise.allSettled(
        blobUrlsToDelete.map(url =>
          del(url).catch(e => console.log("[blob] delete failed:", url, e.message))
        )
      );
    }

    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { parsed = { success: true, message: text }; }
    return res.status(200).json(parsed || { success: true });
  } catch (err) {
    return res.status(500).json({ error: "Upload failed: " + err.message });
  }
}
