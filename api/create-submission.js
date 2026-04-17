export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { DOCUSEAL_BASE_ENDPOINT, DOCUSEAL_TEMPLATE_ID, DOCUSEAL_API_KEY } = process.env;
  const WEBHOOK_URL = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";
  const APP_URL = "https://single-page-esign-application.vercel.app";

  if (!DOCUSEAL_API_KEY) return res.status(500).json({ error: "DOCUSEAL_API_KEY is not set" });
  if (!DOCUSEAL_BASE_ENDPOINT) return res.status(500).json({ error: "DOCUSEAL_BASE_ENDPOINT is not set" });
  if (!DOCUSEAL_TEMPLATE_ID) return res.status(500).json({ error: "DOCUSEAL_TEMPLATE_ID is not set" });

  try {
    const { business, owners, email } = req.body;

    // 1. Send all form data to n8n webhook
    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "application_submitted",
          timestamp: new Date().toISOString(),
          email,
          business,
          owners
        })
      });
      console.log("Webhook sent successfully");
    } catch (webhookErr) {
      console.error("Webhook error (non-blocking):", webhookErr.message);
    }

    // 2. Build ALL fields - use value if filled, "N/A" if not, all readonly
    const fields = [];
    const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    const ownerEmail = email || owners?.[0]?.email || "";
    const b = business || {};
    const o = (owners && owners.length > 0) ? owners[0] : {};

    // Business fields - exact DocuSeal template names
    const bizFields = {
      "Business Name": b.name,
      "DBA Name": b.dba,
      "Business Start Date": b.startDate,
      "Legal Entity": b.entity,
      "Industry": b.industry,
      "Tax Id": b.taxId,
      "Business Description": b.description,
      "Amount Requested": b.amountRequested,
      "Annual Revenue": b.annualRevenue,
      "Use of Proceeds": b.useOfProceeds,
      "Products Interested In": b.product,
      "Business Address": b.address,
      "Business City": b.city,
      "Business State": b.state,
      "Business Zip": b.zip,
      "Website": b.website,
      "Phone": b.phone,
      "Owns Real Estate": b.ownRealEstate,
      "Has Open Business Loans": b.openLoans
    };

    for (const [name, value] of Object.entries(bizFields)) {
      fields.push({
        name,
        default_value: (value && String(value).trim() !== "") ? String(value) : " ",
        readonly: true
      });
    }

    // Owner fields
    const ownerFields = {
      "Owner First Name": o.firstName,
      "Owner Last Name": o.lastName,
      "Owner Birthday": o.dob,
      "Owner SSN": o.ssn,
      "Owner Percentage": o.ownership,
      "Owner Address": o.address,
      "Owner City": o.city,
      "Owner State": o.state,
      "Owner Zip": o.zip,
      "Owner Credit Score": o.creditScore,
      "Owner Email": ownerEmail,
      "Owner Phone": o.cell
    };

    for (const [name, value] of Object.entries(ownerFields)) {
      fields.push({
        name,
        default_value: (value && String(value).trim() !== "") ? String(value) : " ",
        readonly: true
      });
    }

    // Auto-fill signature date
    fields.push({
      name: "Owner Signature Date",
      default_value: today,
      readonly: true
    });

    const submitterEmail = ownerEmail || "applicant@example.com";

    // 3. Create DocuSeal submission with redirect back to app
    const payload = {
      template_id: parseInt(DOCUSEAL_TEMPLATE_ID),
      send_email: false,
      completed_redirect_url: APP_URL + "/?signed=true",
      submitters: [{
        email: submitterEmail,
        role: "Owner 1",
        fields
      }]
    };

    console.log("DocuSeal request:", DOCUSEAL_BASE_ENDPOINT + "/api/submissions");
    console.log("Fields count:", fields.length);

    const response = await fetch(DOCUSEAL_BASE_ENDPOINT + "/api/submissions", {
      method: "POST",
      headers: {
        "X-Auth-Token": DOCUSEAL_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log("DocuSeal response status:", response.status);
    console.log("DocuSeal response:", responseText);

    if (!response.ok) {
      return res.status(response.status).json({
        error: "DocuSeal error (" + response.status + "): " + responseText
      });
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return res.status(500).json({ error: "Invalid JSON from DocuSeal" });
    }

    const submitter = Array.isArray(data) ? data[0] : data;
    const slug = submitter?.slug;

    if (!slug) {
      return res.status(500).json({ error: "No slug returned from DocuSeal" });
    }

    return res.status(200).json({
      slug,
      signingUrl: DOCUSEAL_BASE_ENDPOINT + "/s/" + slug
    });
  } catch (error) {
    console.error("Submission error:", error);
    return res.status(500).json({ error: "Failed to create submission: " + error.message });
  }
}