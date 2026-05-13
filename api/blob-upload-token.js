// Issues presigned upload tokens for direct browser → Vercel Blob uploads.
//
// WHY THIS EXISTS:
// The browser can't POST large files (>4.5MB) to a Vercel serverless function
// because of Vercel's inbound request body limit. To work around this for the
// bank statement upload page, we use Vercel Blob's client upload pattern:
//
//   1. Browser asks THIS endpoint for a short-lived presigned URL
//   2. Browser uploads the file directly to Vercel Blob storage (no 4.5MB cap,
//      supports up to 5TB per file)
//   3. Browser sends just the resulting blob URL(s) to /api/upload-bank as JSON
//   4. /api/upload-bank fetches files server-to-server and forwards to n8n
//
// This endpoint never sees the actual file bytes — it only signs an upload URL.
// The file goes directly from the browser to Vercel's storage backend.
//
// SECURITY:
// - Restricts content types to PDFs and common image formats (the only file
//   types we want for bank statements / supplemental docs).
// - Caps individual file size at 100MB (generous enough for huge multi-month
//   statements, but prevents abuse).
// - Uses addRandomSuffix so two customers uploading "BS1.pdf" don't collide.
// - The token itself is short-lived (default 1 hour) and only valid for the
//   exact pathname requested.

import { handleUpload } from "@vercel/blob/client";

export const config = {
  api: {
    bodyParser: true,
  },
};

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/heic",
  "image/heif",
];

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export default async function handler(req, res) {
  // Basic security headers
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
      onBeforeGenerateToken: async (pathname /* clientPayload */) => {
        // This callback fires before each upload token is generated. Return
        // restrictions on what the client can upload. The pathname is the
        // intended blob path (filename + any prefix the client provided).
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_FILE_SIZE_BYTES,
          addRandomSuffix: true,
          // tokenPayload is included in the upload completion callback below.
          // We don't use it for anything right now but could log it later.
          tokenPayload: JSON.stringify({
            pathname,
            issued_at: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Called by Vercel Blob after a successful upload. Useful for logging
        // or triggering downstream processing. We don't kick off anything from
        // here because the browser will follow up with a POST to /api/upload-bank
        // containing the blob URL — that endpoint handles forwarding to n8n.
        try {
          console.log("[blob-upload-token] upload completed:", {
            url: blob.url,
            pathname: blob.pathname,
            content_type: blob.contentType,
            payload: tokenPayload,
          });
        } catch (e) {
          // Logging failures shouldn't break uploads.
        }
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (error) {
    // handleUpload throws on validation failures (file too large, wrong type,
    // missing token, etc.). Return a 400 with the message so the client can
    // show useful errors to the user.
    return res.status(400).json({ error: error.message || "Upload token error" });
  }
}
