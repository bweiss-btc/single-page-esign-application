const AGENT_WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/94fb281b-d231-4646-8245-bf768b6dbb89";
const MAIN_WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";

// Rate limiter
const rateMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000;
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) { rateMap.set(ip, { start: now, count: 1 }); return false; }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Input sanitization
function sanitize(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    return val
      .replace(/<[^>]*>/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/['";]\s*(DROP|DELETE|INSERT|UPDATE|ALTER|EXEC)\s/gi, '')
      .replace(/\0/g, '') // null bytes
      .trim();
  }
  if (Array.isArray(val)) return val.map(sanitize);
  if (typeof val === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(val)) {
      clean[sanitize(k)] = sanitize(v);
    }
    return clean;
  }
  return val;
}

// Security headers applied to every response
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://n8n.bigthinkcapital.com https://sign.bigthinkcapital.com; frame-ancestors 'self'");
}

export default async function handler(req, res) {
  // Apply security headers to all responses
  setSecurityHeaders(res);

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  if (req.method === 'POST' && isRateLimited(ip)) {
    console.log("Rate limited:", ip);
    return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
  }

  // ===== GET = agent lookup proxy =====
  if (req.method === "GET") {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ error: "Missing agent parameter" });
    try {
      const response = await fetch(AGENT_WEBHOOK + "?agent=" + encodeURIComponent(sanitize(agent)));
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { return res.status(200).json({}); }
      const agentObj = Array.isArray(data) ? data[0] : data;
      return res.status(200).json(agentObj || {});
    } catch (error) {
      return res.status(200).json({});
    }
  }

  // ===== DocuSeal webhook (signing completed) =====
  if (req.method === "POST" && req.query.source === "docuseal") {
    console.log("DocuSeal webhook received");
    try {
      const payload = req.body || {};
      const eventType = payload.event_type || payload.event || "submission.completed";
      const submissionData = payload.data || payload;
      const submitters = submissionData.submitters || [];
      const firstSubmitter = submitters[0] || {};
      const documents = [];
      if (submissionData.documents) documents.push(...submissionData.documents);
      if (firstSubmitter.documents) documents.push(...firstSubmitter.documents);
      const fields = {};
      if (firstSubmitter.fields && Array.isArray(firstSubmitter.fields)) {
        for (const f of firstSubmitter.fields) fields[f.name] = f.value;
      }
      const webhookPayload = {
        event: "application_signed",
        step: "docuseal_completed",
        docuseal_event: eventType,
        timestamp: new Date().toISOString(),
        submission_id: submissionData.id || null,
        submitter_email: firstSubmitter.email || null,
        submitter_id: firstSubmitter.id || null,
        slug: firstSubmitter.slug || null,
        status: firstSubmitter.status || submissionData.status || "completed",
        signed_documents: documents.map(d => ({
          name: d.name || d.filename || "signed-document",
          url: d.url || d.download_url || null
        })),
        fields,
        raw_payload: payload
      };
      await fetch(MAIN_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload)
      });
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(200).json({ success: false, error: error.message });
    }
  }

  // ===== POST = create DocuSeal submission =====
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { DOCUSEAL_BASE_ENDPOINT, DOCUSEAL_TEMPLATE_ID, DOCUSEAL_API_KEY } = process.env;
  const APP_URL = "https://single-page-esign-application.vercel.app";

  if (!DOCUSEAL_API_KEY) return res.status(500).json({ error: "DOCUSEAL_API_KEY is not set" });
  if (!DOCUSEAL_BASE_ENDPOINT) return res.status(500).json({ error: "DOCUSEAL_BASE_ENDPOINT is not set" });
  if (!DOCUSEAL_TEMPLATE_ID) return res.status(500).json({ error: "DOCUSEAL_TEMPLATE_ID is not set" });

  try {
    const rawBody = req.body;

    // Honeypot check
    if (rawBody._company_url) {
      console.log("Honeypot triggered from IP:", ip);
      return res.status(200).json({ slug: "submitted", signingUrl: APP_URL + "/?signed=true" });
    }

    // Sanitize all input
    const body = sanitize(rawBody);
    const { business, owners, email } = body;

    // Send sanitized form data to webhook
    try {
      await fetch(MAIN_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "application_submitted", step: "docuseal_created", timestamp: new Date().toISOString(), email, business, owners })
      });
    } catch (e) {}

    const fields = [];
    const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    const ownerEmail = email || owners?.[0]?.email || "";
    const b = business || {};
    const o = (owners && owners.length > 0) ? owners[0] : {};

    const bizFields = { "Business Name": b.name, "DBA Name": b.dba, "Business Start Date": b.startDate, "Legal Entity": b.entity, "Industry": b.industry, "Tax Id": b.taxId, "Business Description": b.description, "Amount Requested": b.amountRequested, "Annual Revenue": b.annualRevenue, "Use of Proceeds": b.useOfProceeds, "Products Interested In": b.product, "Business Address": b.address, "Business City": b.city, "Business State": b.state, "Business Zip": b.zip, "Website": b.website, "Phone": b.phone, "Owns Real Estate": b.ownRealEstate, "Has Open Business Loans": b.openLoans };
    for (const [name, value] of Object.entries(bizFields)) {
      fields.push({ name, default_value: (value && String(value).trim() !== "") ? String(value) : " ", readonly: true });
    }

    const ownerFields = { "Owner First Name": o.firstName, "Owner Last Name": o.lastName, "Owner Birthday": o.dob, "Owner SSN": o.ssn, "Owner Percentage": o.ownership, "Owner Address": o.address, "Owner City": o.city, "Owner State": o.state, "Owner Zip": o.zip, "Owner Credit Score": o.creditScore, "Owner Email": ownerEmail, "Owner Phone": o.cell };
    for (const [name, value] of Object.entries(ownerFields)) {
      fields.push({ name, default_value: (value && String(value).trim() !== "") ? String(value) : " ", readonly: true });
    }
    fields.push({ name: "Owner Signature Date", default_value: today, readonly: true });

    const submitterEmail = ownerEmail || "applicant@example.com";
    const payload = {
      template_id: parseInt(DOCUSEAL_TEMPLATE_ID),
      send_email: false,
      completed_redirect_url: APP_URL + "/?signed=true",
      submitters: [{
        email: submitterEmail,
        role: "Owner 1",
        fields,
        completed_redirect_url: APP_URL + "/?signed=true"
      }]
    };

    const response = await fetch(DOCUSEAL_BASE_ENDPOINT + "/api/submissions", {
      method: "POST",
      headers: { "X-Auth-Token": DOCUSEAL_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    if (!response.ok) return res.status(response.status).json({ error: "DocuSeal error (" + response.status + "): " + responseText });

    let data;
    try { data = JSON.parse(responseText); } catch (e) { return res.status(500).json({ error: "Invalid JSON from DocuSeal" }); }
    const submitter = Array.isArray(data) ? data[0] : data;
    if (!submitter?.slug) return res.status(500).json({ error: "No slug returned" });

    return res.status(200).json({ slug: submitter.slug, signingUrl: DOCUSEAL_BASE_ENDPOINT + "/s/" + submitter.slug });
  } catch (error) {
    return res.status(500).json({ error: "Failed: " + error.message });
  }
}