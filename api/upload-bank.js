// Multipart proxy for bank statement uploads.
//
// The browser can't POST multipart/form-data directly to the n8n webhook because of
// the Access-Control-Allow-Origin:https://offers.bigthinkcapital.com header that n8n
// (or the reverse proxy in front of it) returns. That preflight failure is what made
// bank uploads look like "binary not sending correctly" — the browser would send the
// request but the response would be blocked, and sometimes the binary payload doesn't
// even reach the server because preflight fails.
//
// Unlike JSON, we can't re-serialize multipart in the proxy — the boundary in the
// Content-Type header must match the boundary bytes in the body exactly, byte for
// byte. So we disable the body parser, read the raw request buffer, and forward it
// as-is with the original Content-Type header intact.
//
// Vercel serverless limit: ~4.5MB total request body. Three bank statement PDFs are
// usually well under this. If users hit the limit, we'll need to move to Vercel Blob
// (direct-to-storage upload, then pass URLs to n8n).

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
    // Collect raw request body. Must preserve binary bytes exactly so the multipart
    // boundary in the body stays consistent with the Content-Type header.
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    if (body.length === 0) {
      return res.status(400).json({ error: "Empty body" });
    }

    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: "Expected multipart/form-data" });
    }

    // Forward raw bytes with the same content-type (including boundary) to n8n.
    const upstream = await fetch(WEBHOOK, {
      method: "POST",
      headers: {
        "content-type": contentType,
        "content-length": String(body.length),
      },
      body,
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "Upload forwarding failed",
        upstream_status: upstream.status,
        upstream_body: text.slice(0, 500),
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
