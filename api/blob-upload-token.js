// Token endpoint for Vercel Blob client uploads.
//
// The browser uses @vercel/blob/client's upload() function to send files
// directly to Vercel Blob storage, bypassing our serverless function's
// 4.5MB body limit. To do that, the client first POSTs to this endpoint
// to get a presigned upload token. This endpoint validates the request
// (file type, optional metadata) and issues the token via handleUpload().
//
// The actual file upload then goes browser → Vercel Blob (no proxy through
// us), so file size is no longer constrained by serverless body limits.
// Vercel Blob supports up to 5 TB per file in client uploads — bank
// statements at 10-20 MB are nowhere near that ceiling.
//
// After the upload completes, the browser gets back a URL and sends it
// (along with form metadata) to /api/upload-bank, which downloads from
// Blob and forwards to n8n.

import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  // Basic security headers (consistent with other endpoints)
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname /*, clientPayload */) => {
        // Validate what the browser is trying to upload before issuing a
        // token. Bank statements come in as PDF or image (some people scan
        // statements to JPG/PNG before uploading). Keep the allowlist tight
        // so the token can't be misused for arbitrary file uploads.
        return {
          allowedContentTypes: [
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/jpg",
          ],
          // Token validity defaults to 60s. Bank statements are usually
          // uploaded in a few seconds, so 5 minutes is plenty even for
          // slow mobile connections retrying multiple files.
          tokenPayload: JSON.stringify({}),
          maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB per file cap
          validUntil: Date.now() + 5 * 60 * 1000,
        };
      },
      onUploadCompleted: async ({ blob /*, tokenPayload */ }) => {
        // Fires server-side after the browser-to-Blob upload completes.
        // We don't need to do anything here — the browser will send the
        // URL to /api/upload-bank, which is where the real downstream
        // work (n8n forward + cleanup) happens.
        // Keep this stub here in case we want to add logging or other
        // post-upload hooks later.
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Token generation failed" });
  }
}
