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

  // Log incoming request body for debugging Vercel Blob 400 errors. The body
  // shape differs depending on which phase of the upload flow we're in:
  //   - blob.generate-client-token: initial token request from browser
  //   - blob.upload-completed: post-upload callback from Vercel Blob
  // If Vercel Blob rejects an upload, we want to see WHY here, since the
  // browser only gets a generic 400 without much detail.
  try {
    console.log("[blob-upload-token] incoming request:", JSON.stringify({
      type: req.body && req.body.type,
      pathname: req.body && req.body.payload && req.body.payload.pathname,
      callbackUrl: req.body && req.body.payload && req.body.payload.callbackUrl,
    }));
  } catch (e) {
    console.log("[blob-upload-token] could not log request body:", e.message);
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
        //
        // Note: "image/jpg" removed — it's not a valid MIME type per IANA
        // (the correct one is "image/jpeg"). Browsers won't send "image/jpg"
        // even for .jpg files; they send "image/jpeg". Keeping invalid types
        // in the allowlist may trip strict validation in Vercel Blob.
        //
        // addRandomSuffix: true tells Vercel Blob to append a random suffix
        // to the pathname before storing. This avoids collisions when
        // multiple customers upload simultaneously AND it sanitizes
        // problematic filenames transparently.
        console.log("[blob-upload-token] generating token for pathname:", pathname);
        return {
          allowedContentTypes: [
            "application/pdf",
            "image/png",
            "image/jpeg",
          ],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({}),
          maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB per file cap
        };
      },
      onUploadCompleted: async ({ blob /*, tokenPayload */ }) => {
        // Fires server-side after the browser-to-Blob upload completes.
        // We don't need to do anything here — the browser will send the
        // URL to /api/upload-bank, which is where the real downstream
        // work (n8n forward + cleanup) happens.
        console.log("[blob-upload-token] upload completed:", blob && blob.url);
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error("[blob-upload-token] handleUpload error:", err && err.message, err && err.stack);
    return res.status(400).json({ error: err.message || "Token generation failed" });
  }
}
