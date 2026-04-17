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
        "Federal Tax ID": business.taxId,
        "Description of Business": business.description,
        "Amount Requested": business.amountRequested,
        "Annual Revenue": business.annualRevenue,
        "Use of Proceeds": business.useOfProceeds,
        "Product": business.product,
        "Business Address": business.address,
        "City": business.city,
        "State": business.state,
        "ZIP": business.zip,
        "Website": business.website,
        "Business Phone": business.phone,
        "Own Real Estate": business.ownRealEstate,
        "Open Business Loans": business.openLoans
      };
      for (const [name, value] of Object.entries(map)) {
        if (value && value.trim && value.trim() !== "") {
          fields.push({ name, default_value: value, readonly: true });
        }
      }
    }

    if (owners && owners.length > 0) {
      owners.forEach((owner, idx) => {
        const p = owners.length > 1 ? "Owner " + (idx + 1) + " " : "";
        const omap = {
          [p + "First Name"]: owner.firstName,
          [p + "Last Name"]: owner.lastName,
          [p + "Date of Birth"]: owner.dob,
          [p + "Ownership Percent"]: owner.ownership,
          [p + "Credit Score"]: owner.creditScore,
          [p + "Address"]: owner.address,
          [p + "City"]: owner.city,
          [p + "State"]: owner.state,
          [p + "ZIP"]: owner.zip,
          [p + "Email"]: owner.email,
          [p + "Cell"]: owner.cell
        };
        for (const [name, value] of Object.entries(omap)) {
          if (value && value.trim && value.trim() !== "") {
            fields.push({ name, default_value: value, readonly: true });
          }
        }
      });
    }

    const submitterEmail = email || owners?.[0]?.email || "applicant@example.com";

    const payload = {
      template_id: parseInt(DOCUSEAL_TEMPLATE_ID),
      send_email: false,
      submitters: [{
        email: submitterEmail,
        role: "First Party",
        fields: fields.length > 0 ? fields : undefined
      }]
    };

    console.log("DocuSeal request:", DOCUSEAL_BASE_ENDPOINT + "/api/submissions");
    console.log("Template ID:", DOCUSEAL_TEMPLATE_ID);
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
        error: "DocuSeal API error (status " + response.status + ")",
        details: responseText
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