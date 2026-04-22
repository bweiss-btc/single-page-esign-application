const AGENT_WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/94fb281b-d231-4646-8245-bf768b6dbb89";
const MAIN_WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";
const APP_URL = "https://application.bigthinkcapital.com";

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

function sanitize(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    return val.replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').replace(/on\w+\s*=/gi, '').replace(/['";]\s*(DROP|DELETE|INSERT|UPDATE|ALTER|EXEC)\s/gi, '').replace(/\0/g, '').trim();
  }
  if (Array.isArray(val)) return val.map(sanitize);
  if (typeof val === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(val)) { clean[sanitize(k)] = sanitize(v); }
    return clean;
  }
  return val;
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
}

// Scrub fields that shouldn't persist in DocuSeal's metadata store (passes through their DB
// and comes back in the completion callback). Keep identifiers and business context, drop
// raw SSNs and anything else we don't want sitting in DocuSeal logs.
function scrubForMetadata(submissionSnapshot) {
  const s = JSON.parse(JSON.stringify(submissionSnapshot || {}));
  if (Array.isArray(s.owners)) {
    s.owners = s.owners.map(o => {
      const clean = { ...o };
      delete clean.ssn;
      return clean;
    });
  }
  return s;
}

let _templateFieldsCache = null;
let _templateFieldsCacheAt = 0;
const TEMPLATE_CACHE_MS = 5 * 60 * 1000;
async function getTemplateFieldNames(baseEndpoint, templateId, apiKey) {
  const now = Date.now();
  if (_templateFieldsCache && now - _templateFieldsCacheAt < TEMPLATE_CACHE_MS) return _templateFieldsCache;
  try {
    const res = await fetch(baseEndpoint + "/api/templates/" + templateId, { headers: { "X-Auth-Token": apiKey } });
    if (!res.ok) return null;
    const tpl = await res.json();
    const raw = tpl.fields || tpl.schema || [];
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const names = new Set(raw.map(f => f && (f.name || f.label)).filter(Boolean));
    if (names.size === 0) return null;
    _templateFieldsCache = names;
    _templateFieldsCacheAt = now;
    return names;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  setSecurityHeaders(res);
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  if (req.method === 'POST' && isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
  }

  if (req.method === "GET") {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ error: "Missing agent parameter" });
    try {
      const response = await fetch(AGENT_WEBHOOK + "?agent=" + encodeURIComponent(sanitize(agent)));
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { return res.status(200).json({}); }
      return res.status(200).json((Array.isArray(data) ? data[0] : data) || {});
    } catch (error) { return res.status(200).json({}); }
  }

  if (req.method === "POST" && req.query.source === "docuseal") {
    try {
      const payload = req.body || {};
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
      const metadata = submissionData.metadata || firstSubmitter.metadata || {};
      let parsedMetadata = metadata;
      if (typeof metadata === 'string') { try { parsedMetadata = JSON.parse(metadata); } catch(e) { parsedMetadata = {}; } }
      const callbackSlug = parsedMetadata.slug || null;
      const callbackAgentInfo = parsedMetadata.agent_info || null;
      // Full application snapshot we stashed at submission-creation time. Gives n8n the
      // business/owners/email context without needing to join against the earlier
      // application_submitted event.
      const callbackBusiness = parsedMetadata.business || null;
      const callbackOwners = parsedMetadata.owners || null;
      const callbackEmail = parsedMetadata.email || firstSubmitter.email || null;
      await fetch(MAIN_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "application_signed",
          step: "docuseal_completed",
          docuseal_event: payload.event_type || "submission.completed",
          timestamp: new Date().toISOString(),
          submission_id: submissionData.id || null,
          submitter_email: firstSubmitter.email || null,
          submitter_role: firstSubmitter.role || null,
          status: firstSubmitter.status || "completed",
          slug: callbackSlug,
          agent_param: callbackSlug,
          agent_info: callbackAgentInfo,
          email: callbackEmail,
          business: callbackBusiness,
          owners: callbackOwners,
          signed_documents: documents.map(d => ({ name: d.name || d.filename || "signed-document", url: d.url || d.download_url || null })),
          fields,
          raw_payload: payload
        })
      });
      return res.status(200).json({ success: true });
    } catch (error) { return res.status(200).json({ success: false }); }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { DOCUSEAL_BASE_ENDPOINT, DOCUSEAL_TEMPLATE_ID, DOCUSEAL_API_KEY } = process.env;
  if (!DOCUSEAL_API_KEY || !DOCUSEAL_BASE_ENDPOINT || !DOCUSEAL_TEMPLATE_ID) return res.status(500).json({ error: "Missing DocuSeal config" });

  try {
    const rawBody = req.body;
    if (rawBody._company_url) return res.status(200).json({ slug: "submitted", signingUrl: APP_URL + "/?signed=true" });

    const body = sanitize(rawBody);
    const { business, owners, email, slug, agent_info } = body;

    try { await fetch(MAIN_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "application_submitted", step: "docuseal_created", timestamp: new Date().toISOString(), email, slug: slug || null, agent_param: slug || null, agent_info: agent_info || null, business, owners }) }); } catch (e) {}

    const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    const ownerEmail = email || owners?.[0]?.email || "";
    const b = business || {};
    const o1 = (owners && owners.length > 0) ? owners[0] : {};
    const o2 = (owners && owners.length > 1) ? owners[1] : null;

    const o1Fields = [];
    for (const [name, value] of Object.entries({ "Business Name": b.name, "DBA Name": b.dba, "Business Start Date": b.startDate, "Legal Entity": b.entity, "Industry": b.industry, "Tax Id": b.taxId, "Business Description": b.description, "Amount Requested": b.amountRequested, "Annual Revenue": b.annualRevenue, "Use of Proceeds": b.useOfProceeds, "Products Interested In": b.product, "Business Address": b.address, "Business City": b.city, "Business State": b.state, "Business Zip": b.zip, "Website": b.website, "Phone": b.phone, "Owns Real Estate": b.ownRealEstate, "Has Open Business Loans": b.openLoans })) {
      o1Fields.push({ name, default_value: (value && String(value).trim()) || " ", readonly: true });
    }
    for (const [name, value] of Object.entries({ "Owner First Name": o1.firstName, "Owner Last Name": o1.lastName, "Owner Birthday": o1.dob, "Owner SSN": o1.ssn, "Owner Percentage": o1.ownership, "Owner Address": o1.address, "Owner City": o1.city, "Owner State": o1.state, "Owner Zip": o1.zip, "Owner Credit Score": o1.creditScore, "Owner Email": ownerEmail, "Owner Phone": o1.cell })) {
      o1Fields.push({ name, default_value: (value && String(value).trim()) || " ", readonly: true });
    }
    o1Fields.push({ name: "Owner Signature Date", default_value: today, readonly: true });

    let o2Fields = null;
    if (o2) {
      o2Fields = [];
      for (const [name, value] of Object.entries({ "Owner First Name": o2.firstName, "Owner Last Name": o2.lastName, "Owner Birthday": o2.dob, "Owner SSN": o2.ssn, "Owner Percentage": o2.ownership, "Owner Address": o2.address, "Owner City": o2.city, "Owner State": o2.state, "Owner Zip": o2.zip, "Owner Credit Score": o2.creditScore, "Owner Email": o2.email, "Owner Phone": o2.cell })) {
        o2Fields.push({ name, default_value: (value && String(value).trim()) || " ", readonly: true });
      }
      o2Fields.push({ name: "Owner Signature Date", default_value: today, readonly: true });
    }

    let safeO1 = o1Fields;
    let safeO2 = o2Fields;
    const known = await getTemplateFieldNames(DOCUSEAL_BASE_ENDPOINT, DOCUSEAL_TEMPLATE_ID, DOCUSEAL_API_KEY);
    if (known && known.size > 0) {
      safeO1 = o1Fields.filter(f => known.has(f.name));
      if (o2Fields) safeO2 = o2Fields.filter(f => known.has(f.name));
    }

    const redirectUrl = APP_URL + "/?signed=true" + (slug ? "&agent=" + encodeURIComponent(slug) : "");

    // Application snapshot sent into DocuSeal metadata so it echoes back in the completion
    // callback. Keeps application_signed self-contained — n8n doesn't need to match events.
    const snapshotMetadata = {
      slug: slug || null,
      agent_info: agent_info || null,
      email: ownerEmail || null,
      business: business || null,
      owners: scrubForMetadata({ owners }).owners || null
    };

    const submitters = [{
      email: ownerEmail || "applicant@example.com",
      role: "Owner 1",
      fields: safeO1,
      completed_redirect_url: redirectUrl,
      send_email: false,
      metadata: { ...snapshotMetadata, submitter_role: "owner_1" }
    }];
    if (o2 && safeO2) {
      submitters.push({
        email: o2.email || "applicant2@example.com",
        role: "Owner 2",
        fields: safeO2,
        completed_redirect_url: redirectUrl,
        send_email: true,
        metadata: { ...snapshotMetadata, submitter_role: "owner_2" }
      });
    }

    const response = await fetch(DOCUSEAL_BASE_ENDPOINT + "/api/submissions", {
      method: "POST", headers: { "X-Auth-Token": DOCUSEAL_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: parseInt(DOCUSEAL_TEMPLATE_ID), send_email: false, completed_redirect_url: redirectUrl, metadata: snapshotMetadata, submitters })
    });

    const responseText = await response.text();
    if (!response.ok) return res.status(response.status).json({ error: "DocuSeal error: " + responseText });

    let data;
    try { data = JSON.parse(responseText); } catch (e) { return res.status(500).json({ error: "Invalid JSON" }); }
    const submitterList = Array.isArray(data) ? data : [data];
    const owner1Sub = submitterList.find(s => s && s.role === "Owner 1") || submitterList[0];
    if (!owner1Sub?.slug) return res.status(500).json({ error: "No slug returned" });

    return res.status(200).json({ slug: owner1Sub.slug, signingUrl: DOCUSEAL_BASE_ENDPOINT + "/s/" + owner1Sub.slug });
  } catch (error) { return res.status(500).json({ error: "Failed: " + error.message }); }
}
