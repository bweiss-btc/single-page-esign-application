export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { DOCUSEAL_BASE_ENDPOINT, DOCUSEAL_TEMPLATE_ID, DOCUSEAL_API_KEY } = process.env;

  if (!DOCUSEAL_API_KEY) return res.status(500).json({ error: "DOCUSEAL_API_KEY is not set" });
  if (!DOCUSEAL_BASE_ENDPOINT) return res.status(500).json({ error: "DOCUSEAL_BASE_ENDPOINT is not set" });
  if (!DOCUSEAL_TEMPLATE_ID) return res.status(500).json({ error: "DOCUSEAL_TEMPLATE_ID is not set" });

  try {
    const { business, owners, email } = req.body;
    const fields = [];

    if (business) {
      const map = {
        "Business Name": business.name,
        "DBA Name": business.dba,
        "Business Start Date": business.startDate,
        "Legal Entity": business.entity,
        "Industry": business.industry,
        "Tax Id": business.taxId,
        "Business Description": business.description,
        "Amount Requested": business.amountRequested,
        "Annual Revenue": business.annualRevenue,
        "Use of Proceeds": business.useOfProceeds,
        "Products Interested In": business.product,
        "Business Address": business.address,
        "Business City": business.city,
        "Business State": business.state,
        "Business Zip": business.zip,
        "Website": business.website,
        "Phone": business.phone,
        "Owns Real Estate": business.ownRealEstate,
        "Has Open Business Loans": business.openLoans
      };
      for (const [name, value] of Object.entries(map)) {
        if (value && String(value).trim() !== "") {
          fields.push({ name, default_value: String(value), readonly: true });
        }
      }
    }

    if (owners && owners.length > 0) {
      const o = owners[0];
      const ownerMap = {
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
        "Owner Email": o.email,
        "Owner Phone": o.cell
      };
      for (const [name, value] of Object.entries(ownerMap)) {
        if (value && String(value).trim() !== "") {
          fields.push({ name, default_value: String(value), readonly: true });
        }
      }
    }

    const submitterEmail = email || owners?.[0]?.email || "applicant@example.com";

    const payload = {
      template_id: parseInt(DOCUSEAL_TEMPLATE_ID),
      send_email: false,
      submitters: [{
        email: submitterEmail,
        role: "Owner 1",
        fields: fields.length > 0 ? fields : undefined
      }]
    };

    console.log("DocuSeal request:", DOCUSEAL_BASE_ENDPOINT + "/api/submissions");
    console.log("Template ID:", DOCUSEAL_TEMPLATE_ID);
    console.log("Fields count:", fields.length);
    console.log("Field names:", fields.map(f => f.name).join(", "));

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
      return res.status(500).json({ error: "Invalid JSON from DocuSeal", details: responseText });
    }

    const submitter = Array.isArray(data) ? data[0] : data;
    const slug = submitter?.slug;

    if (!slug) {
      return res.status(500).json({ error: "No slug returned from DocuSeal", details: responseText });
    }

    return res.status(200).json({
      slug,
      src: DOCUSEAL_BASE_ENDPOINT + "/s/" + slug
    });
  } catch (error) {
    console.error("Submission error:", error);
    return res.status(500).json({ error: "Failed to create submission: " + error.message });
  }
}