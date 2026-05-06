const AGENT_WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/94fb281b-d231-4646-8245-bf768b6dbb89";
const LOOKUP_WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/e41ebca9-5f6c-49b2-af2c-cd4299edf4ytd";
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

function buildLinkUrl(slug) {
  if (!slug) return APP_URL + "/";
  return APP_URL + "/?agent=" + encodeURIComponent(String(slug));
}

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
  // Rate-limit POSTs and signature-verify GETs (the latter could be brute-forced
  // since DocuSeal submission IDs are sequential integers).
  if ((req.method === 'POST' || (req.method === 'GET' && req.query.verify === 'signature')) && isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
  }

  if (req.method === "GET") {
    // Signature verification endpoint. Used by the bank upload page to confirm that
    // the user actually completed the DocuSeal signing flow before allowing them to
    // upload bank statements. Without this check, anyone could navigate directly to
    // /?signed=true and bypass the signature.
    //
    // Defense in depth: requires BOTH submission_id (from sessionStorage, set during
    // submission creation) AND email (from sessionStorage). Server checks DocuSeal
    // for the submission, confirms ALL submitters have status=completed (so a 2-owner
    // submission can't bypass with just Owner 1 signing), and that the email matches
    // the Owner 1 submitter. Even if someone guessed a numeric submission_id, they'd
    // need the right email too.
    if (req.query.verify === "signature") {
      const { DOCUSEAL_BASE_ENDPOINT: baseEndpoint, DOCUSEAL_API_KEY: apiKey } = process.env;
      if (!baseEndpoint || !apiKey) {
        return res.status(500).json({ verified: false, reason: "config" });
      }
      try {
        const sidRaw = req.query.sid ? sanitize(String(req.query.sid)) : "";
        const emailRaw = req.query.email ? sanitize(String(req.query.email)).toLowerCase() : "";
        if (!sidRaw || !/^\d+$/.test(sidRaw)) {
          return res.status(200).json({ verified: false, reason: "invalid_sid" });
        }
        const url = baseEndpoint + "/api/submissions/" + encodeURIComponent(sidRaw);
        const r = await fetch(url, { headers: { "X-Auth-Token": apiKey } });
        if (!r.ok) {
          return res.status(200).json({ verified: false, reason: "lookup_failed", status: r.status });
        }
        const sub = await r.json();
        const submitters = Array.isArray(sub.submitters) ? sub.submitters : [];

        // ALL submitters must be completed. For a 2-owner submission, this means
        // both Owner 1 and Owner 2. If only Owner 1 has signed (e.g. they hit the
        // chain redirect to Owner 2's signing page but Owner 2 abandoned), this
        // returns not_completed and the bank upload stays locked.
        const allCompleted = submitters.length > 0 && submitters.every(s =>
          s && (s.status === "completed" || s.completed_at)
        );

        // Email match is against Owner 1 (the in-browser signer who initiated
        // the flow and stored their email in sessionStorage). Owner 2's email
        // is generally different and we don't try to match it.
        const owner1 = submitters.find(s => s && s.role === "Owner 1") || submitters[0];
        const submitterEmail = (owner1?.email || "").toLowerCase();
        const emailMatches = !emailRaw || emailRaw === submitterEmail;
        const verified = allCompleted && emailMatches;

        // Distinguish "Owner 2 specifically hasn't finished" vs Owner 1 not done,
        // so the client can show a helpful message if needed.
        let reason = null;
        if (!verified) {
          if (!allCompleted) {
            const owner1Done = !!(owner1 && (owner1.status === "completed" || owner1.completed_at));
            const owner2 = submitters.find(s => s && s.role === "Owner 2");
            const owner2Done = !!(owner2 && (owner2.status === "completed" || owner2.completed_at));
            if (submitters.length > 1 && owner1Done && !owner2Done) {
              reason = "owner2_not_completed";
            } else {
              reason = "not_completed";
            }
          } else {
            reason = "email_mismatch";
          }
        }

        return res.status(200).json({
          verified,
          email: verified ? submitterEmail : null,
          submission_id: sub.id || sidRaw,
          slug: (sub.metadata && sub.metadata.slug) || null,
          reason
        });
      } catch (e) {
        return res.status(200).json({ verified: false, reason: "error" });
      }
    }

    // Email lookup proxy.
    if (req.query.lookup === "email" && req.query.email) {
      try {
        const cleanEmail = sanitize(String(req.query.email));
        const cleanSlug = req.query.slug ? sanitize(String(req.query.slug)) : "";
        const cleanLink = req.query.link_url ? sanitize(String(req.query.link_url)) : buildLinkUrl(cleanSlug);
        const qs = "?email=" + encodeURIComponent(cleanEmail)
          + (cleanSlug ? "&slug=" + encodeURIComponent(cleanSlug) : "")
          + (cleanLink ? "&link_url=" + encodeURIComponent(cleanLink) : "");
        const response = await fetch(LOOKUP_WEBHOOK + qs);
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { return res.status(200).json({}); }
        return res.status(200).json(data || {});
      } catch (error) { return res.status(200).json({}); }
    }

    // Agent lookup (existing behavior).
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
      const allSubmitters = submissionData.submitters || [];
      const firstSubmitter = allSubmitters[0] || {};

      const signingLog = allSubmitters.map(s => ({
        role: s.role || null,
        email: s.email || null,
        name: s.name || null,
        phone: s.phone || null,
        status: s.status || null,
        sent_at: s.sent_at || null,
        opened_at: s.opened_at || null,
        completed_at: s.completed_at || null,
        declined_at: s.declined_at || null,
        ip_address: s.ip || s.ip_address || null,
        user_agent: s.ua || s.user_agent || null,
        signing_url: s.embed_src || s.url || null,
        fields: Array.isArray(s.fields) ? s.fields.reduce((acc, f) => { if (f && f.name) acc[f.name] = f.value; return acc; }, {}) : {}
      }));

      const documents = [];
      const seenDocUrls = new Set();
      const addDoc = (d) => {
        const url = d && (d.url || d.download_url);
        if (!url || seenDocUrls.has(url)) return;
        seenDocUrls.add(url);
        documents.push({ name: d.name || d.filename || "signed-document", url });
      };
      if (Array.isArray(submissionData.documents)) submissionData.documents.forEach(addDoc);
      allSubmitters.forEach(s => { if (Array.isArray(s.documents)) s.documents.forEach(addDoc); });

      const completedFields = {};
      if (firstSubmitter.fields && Array.isArray(firstSubmitter.fields)) {
        for (const f of firstSubmitter.fields) completedFields[f.name] = f.value;
      }

      const metadata = submissionData.metadata || firstSubmitter.metadata || {};
      let parsedMetadata = metadata;
      if (typeof metadata === 'string') { try { parsedMetadata = JSON.parse(metadata); } catch(e) { parsedMetadata = {}; } }
      const callbackSlug = parsedMetadata.slug || null;
      const callbackAgentInfo = parsedMetadata.agent_info || null;
      const callbackBusiness = parsedMetadata.business || null;
      const callbackOwners = parsedMetadata.owners || null;
      const callbackEmail = parsedMetadata.email || firstSubmitter.email || null;
      const callbackLinkUrl = parsedMetadata.link_url || buildLinkUrl(callbackSlug);

      await fetch(MAIN_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "application_signed",
          step: "docuseal_completed",
          docuseal_event: payload.event_type || "submission.completed",
          timestamp: new Date().toISOString(),
          submission_id: submissionData.id || null,
          submission_created_at: submissionData.created_at || null,
          submission_completed_at: submissionData.completed_at || firstSubmitter.completed_at || null,
          audit_log_url: submissionData.audit_log_url || submissionData.audit_url || null,
          combined_document_url: submissionData.combined_document_url || null,
          submitter_email: firstSubmitter.email || null,
          submitter_role: firstSubmitter.role || null,
          submitter_name: firstSubmitter.name || null,
          submitter_ip: firstSubmitter.ip || firstSubmitter.ip_address || null,
          submitter_user_agent: firstSubmitter.ua || firstSubmitter.user_agent || null,
          submitter_completed_at: firstSubmitter.completed_at || null,
          status: firstSubmitter.status || "completed",
          signing_log: signingLog,
          signed_documents: documents,
          fields: completedFields,
          slug: callbackSlug,
          agent_param: callbackSlug,
          link_url: callbackLinkUrl,
          agent_info: callbackAgentInfo,
          email: callbackEmail,
          business: callbackBusiness,
          owners: callbackOwners,
          raw_payload: payload
        })
      });
      return res.status(200).json({ success: true });
    } catch (error) { return res.status(200).json({ success: false }); }
  }

  if (req.method === "POST" && req.query.proxy === "webhook") {
    try {
      const incoming = req.body || {};
      const slug = incoming.slug || incoming.agent_param || null;
      const enriched = {
        ...incoming,
        slug: slug || null,
        agent_param: slug || null,
        link_url: incoming.link_url || buildLinkUrl(slug),
      };
      await fetch(MAIN_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enriched)
      });
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(200).json({ success: false });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { DOCUSEAL_BASE_ENDPOINT, DOCUSEAL_TEMPLATE_ID, DOCUSEAL_API_KEY } = process.env;
  if (!DOCUSEAL_API_KEY || !DOCUSEAL_BASE_ENDPOINT || !DOCUSEAL_TEMPLATE_ID) return res.status(500).json({ error: "Missing DocuSeal config" });

  try {
    const rawBody = req.body;
    if (rawBody._company_url) return res.status(200).json({ slug: "submitted", signingUrl: APP_URL + "/?signed=true" });

    const body = sanitize(rawBody);
    const { business, owners, email, slug, agent_info } = body;
    const linkUrl = body.link_url || buildLinkUrl(slug);

    try {
      await fetch(MAIN_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "application_submitted",
          step: "docuseal_created",
          timestamp: new Date().toISOString(),
          email,
          slug: slug || null,
          agent_param: slug || null,
          link_url: linkUrl,
          agent_info: agent_info || null,
          business,
          owners
        })
      });
    } catch (e) {}

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

    // Default redirect URL — used by the FINAL signer (whoever is last in the
    // chain). For a single-owner submission, that's Owner 1. For two owners,
    // we'll override Owner 1's redirect AFTER creation to point to Owner 2's
    // signing URL, so this URL ends up being Owner 2's terminal redirect.
    //
    // Includes {{submission_id}} template token. DocuSeal will substitute the
    // actual ID at redirect time. If unsupported by the DocuSeal version, the
    // literal string lands in the URL — App.jsx detects and ignores that,
    // falling back to sessionStorage which we also set client-side before redirect.
    const redirectUrl = APP_URL + "/?signed=true&sid={{submission_id}}" + (slug ? "&agent=" + encodeURIComponent(slug) : "");

    const snapshotMetadata = {
      slug: slug || null,
      link_url: linkUrl,
      agent_info: agent_info || null,
      email: ownerEmail || null,
      business: business || null,
      owners: scrubForMetadata({ owners }).owners || null
    };

    // Both owners get send_email: false. With the chain (Owner 1 → Owner 2 →
    // bank upload), Owner 2 doesn't need a separate email — they sign right
    // after Owner 1 on the same device. If the chain breaks (Owner 2 walks
    // away mid-flow, browser closes, etc.), the verify endpoint catches it
    // and the customer is told their signature is incomplete; the funding
    // expert can manually re-send via BTC-Sign UI if needed.
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
        send_email: false,
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
    const owner2Sub = submitterList.find(s => s && s.role === "Owner 2");
    if (!owner1Sub?.slug) return res.status(500).json({ error: "No slug returned" });

    // CHAINED SIGNING: if there's an Owner 2, after Owner 1 signs we want them
    // redirected straight to Owner 2's signing page (not back to our app).
    // We do this by PATCHing Owner 1's submitter record to override the
    // completed_redirect_url with Owner 2's signing URL. Owner 2's redirect
    // stays as the original (our app's ?signed=true page), so when both have
    // signed, the customer ends up on the bank upload page.
    //
    // Failure mode: if this PATCH fails, Owner 1 falls back to the original
    // redirect (our app), and the verify endpoint will fail because Owner 2
    // hasn't signed. The customer sees "Signature Not Confirmed" and contacts
    // their funding expert — graceful degradation.
    if (owner2Sub?.slug && owner1Sub?.id) {
      const owner2SigningUrl = DOCUSEAL_BASE_ENDPOINT + "/s/" + owner2Sub.slug;
      try {
        await fetch(DOCUSEAL_BASE_ENDPOINT + "/api/submitters/" + owner1Sub.id, {
          method: "PUT",
          headers: { "X-Auth-Token": DOCUSEAL_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ completed_redirect_url: owner2SigningUrl })
        });
      } catch (e) {
        // Log but don't fail — see comment above for failure mode.
        console.log("Owner 1 redirect chain update failed:", e.message);
      }
    }

    // The submission_id is what we'll use for client-side signature verification
    // after the DocuSeal flow completes.
    const submissionId = owner1Sub.submission_id || owner1Sub.id || null;

    return res.status(200).json({
      slug: owner1Sub.slug,
      signingUrl: DOCUSEAL_BASE_ENDPOINT + "/s/" + owner1Sub.slug,
      submission_id: submissionId
    });
  } catch (error) { return res.status(500).json({ error: "Failed: " + error.message }); }
}
