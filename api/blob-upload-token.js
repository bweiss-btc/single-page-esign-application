// Vercel Blob upload token endpoint.
//
// PURPOSE:
//   The browser uses @vercel/blob/client's upload() function to send files
//   directly to Vercel Blob storage, bypassing Vercel's 4.5MB serverless
//   function inbound body limit. To authorize each upload, the client SDK
//   first calls THIS endpoint to get a short-lived signed token, then uses
//   that token to upload directly to Blob.
//
// HOW IT FITS IN THE FLOW:
//   1. Browser collects file → calls upload(filename, file, { handleUploadUrl: '/api/blob-upload-token' })
//   2. @vercel/blob/client POSTs to this endpoint with the requested upload metadata
//   3. handleUpload() validates the request, issues a token
//   4. Browser uses token to PUT the file directly to Blob storage
//   5. After upload, browser sends the resulting Blob URLs to /api/upload-bank
//      (in a small JSON payload — no file bytes pass through our function)
//
// SECURITY:
//   - allowedContentTypes restricts what file types can be uploaded
//   - maximumSizeInBytes caps each individual file at 100MB
//   - addRandomSuffix prevents filename collisions and predictable URLs
//
// NOTES:
//   - This endpoint requires the BLOB_READ_WRITE_TOKEN env var, which Vercel
//     auto-injects when the Blob store is connected to the project.
//   - onUploadCompleted callback is optional but useful for server-side logging.

import { handleUpload } from "@vercel/blob/client";

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Authorization happens here. For bank statements, we accept PDFs and
        // common image formats (in case a customer photographs their statement).
        // Files are capped at 100MB to prevent abuse — typical statements are
        // 5-20MB. Random suffix ensures unique URLs even if two customers
        // upload statements with the same filename.
        return {
          allowedContentTypes: [
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/heic",
            "image/heif",
          ],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB per file
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Fires server-side after the browser finishes uploading to Blob.
        // We don't need to do anything here — /api/upload-bank handles the
        // actual forwarding to n8n once the browser POSTs the URLs. This
        // callback is mostly useful for server-side logging or async cleanup.
        try {
          console.log("[blob] upload completed:", blob.url, blob.pathname);
        } catch (e) {}
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Token generation failed" });
  }
}
