const AGENT_WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/94fb281b-d231-4646-8245-bf768b6dbb89";
const MAIN_WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";

export default async function handler(req, res) {
  // ===== GET = agent lookup proxy (avoids CORS) =====
  if (req.method === "GET") {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ error: "Missing agent parameter" });
    try {
      const response = await fetch(AGENT_WEBHOOK + "?agent=" + encodeURIComponent(agent));
      const text = await response.text();
      console.log("Agent raw response:", text);
      let data;
      try { data = JSON.parse(text); } catch(e) { return res.status(200).json({}); }
      const agentObj = Array.isArray(data) ? data[0] : data;
      return res.status(200).json(agentObj || {});
    } catch (error) {
      console.error("Agent proxy error:", error.message);
      return res.status(200).json({});
    }
  }

  // ===== PUT = DocuSeal webhook (signing completed) =====
  // DocuSeal sends POST but we use the query param to distinguish
  if (req.method === "PUT" || (req.method === "POST" && req.query.source === "docuseal")) {
    console.log("DocuSeal webhook received:", JSON.stringify(req.body).slice(0, 500));
    try {
      const payload = req.body || {};
      const eventType = payload.event_type || payload.event || "submission.completed";
      
      // Extract key data from DocuSeal webhook payload
      const submissionData = payload.data || payload;
      const submitters = submissionData.submitters || [];
      const firstSubmitter = submitters[0] || {};
      
      // Get signed document URLs
      const documents = [];
      if (submissionData.documents) documents.push(...submissionData.documents);
      if (firstSubmitter.documents) documents.push(...firstSubmitter.documents);
      
      // Get all field values from the signed submission
      const fields = {};
      if (firstSubmitter.fields && Array.isArray(firstSubmitter.fields)) {
        for (const f of firstSubmitter.fields) {
          fields[f.name] = f.value;
        }
      }

      // Forward everything to the main n8n webhook
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
        fields: fields,
        raw_payload: payload
      };

      const webhookRes = await fetch(MAIN_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload)
      });
      console.log("Forwarded to n8n:", webhookRes.status);

      return res.status(200).json({ success: true, message: "Webhook processed" });
    } catch (error) {
      console.error("DocuSeal webhook error:", error.message);
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
    const { business, owners, email } = req.body;

    // Send form data to webhook
    try {
      await fetch(MAIN_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "application_submitted", step: "docuseal_created", timestamp: new Date().toISOString(), email, business, owners })
      });
    } catch (e) {}

    // Build pre-fill fields
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
    
    // Set completed_redirect_url AND webhook_url for DocuSeal
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
    console.log("DocuSeal:", response.status, responseText);

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