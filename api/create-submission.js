export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { DOCUSEAL_BASE_ENDPOINT, DOCUSEAL_TEMPLATE_ID, DOCUSEAL_API_KEY } = process.env;

  if (!DOCUSEAL_API_KEY) return res.status(500).json({ error: "DOCUSEAL_API_KEY is not set" });
  if (!DOCUSEAL_BASE_ENDPOINT) return res.status(500).json({ error: "DOCUSEAL_BASE_ENDPOINT is not set" });
  if (!DOCUSEAL_TEMPLATE_ID) return res.status(500).json({ error: "DOCUSEAL_TEMPLATE_ID is not set" });

  try {
    const { business, owners, email } = req.body;
    const submitterEmail = email || owners?.[0]?.email || "applicant@example.com";

    const payload = {
      template_id: parseInt(DOCUSEAL_TEMPLATE_ID),
      send_email: false,
      submitters: [{
        email: submitterEmail
      }]
    };

    console.log("DocuSeal request:", DOCUSEAL_BASE_ENDPOINT + "/api/submissions");
    console.log("Template ID:", DOCUSEAL_TEMPLATE_ID);
    console.log("Email:", submitterEmail);

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