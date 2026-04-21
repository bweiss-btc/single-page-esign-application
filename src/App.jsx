import { useState, useEffect, useCallback } from "react";
import { STATES, ENTITY_OPTS, PRODUCT_OPTS, PROCEEDS_OPTS, YES_NO, emptyOwner, WEBHOOK, LOOKUP_WEBHOOK, LOGO, AGENT_FALLBACK_ICON, NV1, NV2, NV3 } from "./constants";
import { getParam, normalizeAgent, getInitials, getVal, fmtPhone, rawPhone, fmtTaxId, rawTaxId, fmtZip, rawMoney, isBirthdayToday, extractDomain, scrollToError, getMonthNames } from "./utils";
import { useIsMobile, sliderCss, mobileCss, ValidationModal, HoneypotField, SSNField, Field, MoneySliderField, NumSliderField, StateSelect, Select, Textarea, Row } from "./ui";
import { TopBar, AgentCard, AgentFooter, Footer, Toast, StepBar, SH } from "./brand";
import { AddressField } from "./places";

let _agentData = null;
let _email = (() => { try { return sessionStorage.getItem("btc_email") || ""; } catch (e) { return ""; } })();
let _honeypot = "";

function sendWebhook(data) {
  try {
    fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, email: data.email || _email, timestamp: new Date().toISOString(), agent_param: getParam("agent") || undefined, slug: getParam("agent") || undefined, agent_info: _agentData || undefined }) });
  } catch (e) {}
}

export default function App() {
  const isMobile = useIsMobile();
  const isSigned = getParam("signed") === "true";
  const [showEmail, setShowEmail] = useState(!isSigned);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState(0);
  const [anim, setAnim] = useState(false);
  const [dir, setDir] = useState(1);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState(null);
  const [page, setPage] = useState(isSigned ? "bank" : "form");
  const [bankFiles, setBankFiles] = useState([null, null, null, null]);
  const [bankUploading, setBankUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [agent, setAgent] = useState(null);
  const [agentCollapsed, setAgentCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [bankErrors, setBankErrors] = useState("");

  const [biz, setBiz] = useState({ name: "", dba: "", startDate: "", entity: "", industry: "", taxId: "", description: "", amountRequested: "", annualRevenue: "", useOfProceeds: "", product: "", address: "", city: "", state: "", zip: "", website: "", phone: "", ownRealEstate: "", openLoans: "" });
  const [owners, setOwners] = useState([emptyOwner()]);

  const upBiz = (k, v) => { setBiz(p => ({ ...p, [k]: v })); setHasError(false); };
  const upOwner = (idx, k, v) => { setOwners(p => p.map((o, i) => i === idx ? { ...o, [k]: v } : o)); setHasError(false); };

  // Google Places auto-fill: given parsed place parts, fill adjacent city/state/zip.
  const applyBizPlace = (p) => {
    setBiz(prev => ({ ...prev, address: p.address || prev.address, city: p.city || prev.city, state: p.state && STATES.includes(p.state) ? p.state : prev.state, zip: p.zip || prev.zip }));
    setHasError(false);
  };
  const applyOwnerPlace = (idx, p) => {
    setOwners(prev => prev.map((o, i) => i === idx ? { ...o, address: p.address || o.address, city: p.city || o.city, state: p.state && STATES.includes(p.state) ? p.state : o.state, zip: p.zip || o.zip } : o));
    setHasError(false);
  };

  const goTo = n => {
    if (n === step || anim) return;
    setDir(n > step ? 1 : -1);
    setAnim(true);
    setTimeout(() => { setStep(n); setTimeout(() => setAnim(false), 50); }, 220);
  };

  const btnGrad = `linear-gradient(135deg,${NV1},${NV2})`;
  const bottomPad = agent && isMobile ? { paddingBottom: 56 } : {};
  const checkBirthday = dob => { if (isBirthdayToday(dob)) setToast("Happy Birthday! \uD83C\uDF89 Wishing you a wonderful day!"); };
  const handleOwnerEmail = (idx, v) => {
    upOwner(idx, "email", v);
    if (idx === 0) { const domain = extractDomain(v); if (domain && !biz.website) upBiz("website", "https://" + domain); }
  };
  const focusField = id => {
    setModal(null);
    setTimeout(() => {
      const el = document.querySelector(`[data-field-id="${id}"]`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" });
        const input = el.querySelector("input,select,textarea");
        if (input) input.focus();
      }
    }, 200);
  };

  const validateBiz = () => {
    const m = [];
    if (!biz.name) m.push({ id: "biz-name", label: "Business Name", hint: "Enter your legal business name" });
    if (!biz.startDate) m.push({ id: "biz-startDate", label: "Business Start Date" });
    if (!biz.entity) m.push({ id: "biz-entity", label: "Legal Entity", hint: "Select your business entity type" });
    if (!biz.industry) m.push({ id: "biz-industry", label: "Industry" });
    if (!biz.taxId || rawTaxId(biz.taxId).length < 9) m.push({ id: "biz-taxId", label: "Federal Tax ID", hint: "Must be 9 digits (XX-XXXXXXX)" });
    if (!biz.description) m.push({ id: "biz-desc", label: "Description of Business" });
    if (!biz.amountRequested) m.push({ id: "biz-amount", label: "Amount Requested" });
    if (!biz.annualRevenue) m.push({ id: "biz-revenue", label: "Annual Revenue" });
    if (!biz.useOfProceeds) m.push({ id: "biz-proceeds", label: "Use of Proceeds" });
    if (!biz.product) m.push({ id: "biz-product", label: "Product Interest", hint: "Select which product" });
    if (!biz.address) m.push({ id: "biz-address", label: "Business Address" });
    if (!biz.city) m.push({ id: "biz-city", label: "City" });
    if (!biz.state || !STATES.includes(biz.state)) m.push({ id: "biz-state", label: "State", hint: "Valid 2-letter state code" });
    if (!biz.zip || biz.zip.length !== 5) m.push({ id: "biz-zip", label: "ZIP Code", hint: "Must be 5 digits" });
    if (!biz.phone || rawPhone(biz.phone).length < 10) m.push({ id: "biz-phone", label: "Phone Number", hint: "Must be 10 digits" });
    if (m.length > 0) { setHasError(true); setModal(m); scrollToError(); return false; }
    setHasError(false); return true;
  };

  const validateOwners = () => {
    const m = [];
    owners.forEach((o, i) => {
      const p = i === 0 ? "Primary Owner" : `Owner ${i + 1}`;
      if (!o.firstName) m.push({ id: `own${i}-fn`, label: `${p}: First Name` });
      if (!o.lastName) m.push({ id: `own${i}-ln`, label: `${p}: Last Name` });
      if (!o.dob) m.push({ id: `own${i}-dob`, label: `${p}: Date of Birth` });
      if (!o.ssn || o.ssn.replace(/\D/g, "").length < 9) m.push({ id: `own${i}-ssn`, label: `${p}: SSN`, hint: "Must be 9 digits" });
      if (!o.ownership) m.push({ id: `own${i}-own`, label: `${p}: % Ownership` });
      if (!o.address) m.push({ id: `own${i}-addr`, label: `${p}: Address` });
      if (!o.city) m.push({ id: `own${i}-city`, label: `${p}: City` });
      if (!o.state || !STATES.includes(o.state)) m.push({ id: `own${i}-state`, label: `${p}: State` });
      if (!o.zip || o.zip.length !== 5) m.push({ id: `own${i}-zip`, label: `${p}: ZIP`, hint: "Must be 5 digits" });
      if (!o.email || !o.email.includes("@")) m.push({ id: `own${i}-email`, label: `${p}: Email`, hint: "Must contain @" });
    });
    if (m.length > 0) { setHasError(true); setModal(m); scrollToError(); return false; }
    setHasError(false); return true;
  };

  useEffect(() => {
    const a = getParam("agent");
    if (a) {
      fetch("/api/create-submission?agent=" + encodeURIComponent(a)).then(r => r.json()).then(raw => {
        const ag = normalizeAgent(raw); if (ag) { setAgent(ag); _agentData = ag; }
      }).catch(() => {});
    }
  }, []);

  const initDocuSeal = useCallback(async () => {
    setDocLoading(true); setDocError(null);
    try {
      const res = await fetch("/api/create-submission", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business: { ...biz, taxId: rawTaxId(biz.taxId), phone: rawPhone(biz.phone), amountRequested: rawMoney(biz.amountRequested), annualRevenue: rawMoney(biz.annualRevenue) }, owners: owners.map(o => ({ ...o, cell: rawPhone(o.cell) })), email, slug: getParam("agent") || undefined, agent_info: _agentData || undefined, _company_url: _honeypot }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      window.location.href = data.signingUrl;
    } catch (err) { setDocError(err.message); setDocLoading(false); }
  }, [biz, owners, email]);

  useEffect(() => { if (step === 2 && !docLoading && !docError) initDocuSeal(); }, [step]);

  const handleEmailSubmit = async () => {
    _email = email;
    try { sessionStorage.setItem("btc_email", email); } catch (e) {}
    sendWebhook({ event: "email_entered", step: "email", email });
    setLoading(true);
    try {
      const agentParam = getParam("agent");
      const slugQ = agentParam ? "&slug=" + encodeURIComponent(agentParam) : "";
      const res = await fetch(LOOKUP_WEBHOOK + "?email=" + encodeURIComponent(email) + slugQ);
      const d = await res.json();
      const data = Array.isArray(d) ? d[0] : d;
      if (data && data.found !== "false" && data.notFound !== true) {
        const nb = { ...biz };
        nb.name = getVal(data, "Company", "company", "businessName") || nb.name;
        nb.dba = getVal(data, "DBA_Name__c", "dba") || nb.dba;
        nb.startDate = getVal(data, "Business_Start_Date__c", "businessStartDate") || nb.startDate;
        nb.entity = getVal(data, "Legal_Entity__c", "legalEntity") || nb.entity;
        nb.industry = getVal(data, "Industry", "industry") || nb.industry;
        nb.taxId = getVal(data, "Federal_Tax_Id__c", "taxId") || nb.taxId;
        nb.description = getVal(data, "Description", "description") || nb.description;
        nb.amountRequested = getVal(data, "Amount_Requested__c", "amountRequested") || nb.amountRequested;
        nb.annualRevenue = getVal(data, "Annual_Revenue__c", "annualRevenue", "Business_Income__c") || nb.annualRevenue;
        nb.useOfProceeds = getVal(data, "Use_of_Proceeds__c", "useOfProceeds") || nb.useOfProceeds;
        nb.product = getVal(data, "Products_Interested_In__c", "product", "Real_Estate_Loan_Type__c") || nb.product;
        nb.address = getVal(data, "Street", "Real_Estate_Address__c", "businessAddress") || nb.address;
        nb.city = getVal(data, "City", "Real_Estate_City__c") || nb.city;
        nb.state = getVal(data, "State", "Real_Estate_State__c") || nb.state;
        nb.zip = getVal(data, "PostalCode", "Real_Estate_Zip__c") || nb.zip;
        nb.website = getVal(data, "Website", "website") || nb.website;
        nb.phone = getVal(data, "Phone", "phone") || nb.phone;
        nb.ownRealEstate = getVal(data, "Rent_or_Own__c", "ownsRealEstate") || nb.ownRealEstate;
        nb.openLoans = getVal(data, "Has_Open_Business_Loans__c", "hasOpenBusinessLoans") || nb.openLoans;
        if (!nb.website) { const domain = extractDomain(email); if (domain) nb.website = "https://" + domain; }
        setBiz(nb);
        const no = { ...owners[0] };
        no.firstName = getVal(data, "FirstName", "firstName") || no.firstName;
        no.lastName = getVal(data, "LastName", "lastName") || no.lastName;
        no.dob = getVal(data, "csbs__Birthdate__c", "dob") || no.dob;
        no.ssn = getVal(data, "csbs__Social_Security_Number_Unencrypted__c", "ssn") || no.ssn;
        no.ownership = getVal(data, "Ownership_Percentage__c", "ownership") || no.ownership;
        no.creditScore = getVal(data, "csbs__CreditScore__c", "creditScore") || no.creditScore;
        no.address = getVal(data, "csbs__Home_Address_Street__c", "ownerAddress") || no.address;
        no.city = getVal(data, "csbs__Home_Address_City__c", "ownerCity") || no.city;
        no.state = getVal(data, "csbs__Home_Address_State__c", "ownerState") || no.state;
        no.zip = getVal(data, "csbs__Home_Address_Zip_Code__c", "ownerZip") || no.zip;
        no.email = getVal(data, "Email", "email") || email;
        no.cell = getVal(data, "MobilePhone", "Phone", "cell") || no.cell;
        const nOwners = [no, ...owners.slice(1)];
        const o2 = getVal(data, "csbs__Owner_2_First_Name__c");
        if (o2) {
          const o2o = emptyOwner();
          o2o.firstName = o2;
          o2o.lastName = getVal(data, "csbs__Owner_2_Last_Name__c");
          o2o.dob = getVal(data, "csbs__Owner_2_Birthday__c");
          o2o.ssn = getVal(data, "csbs__Owner_2_Social_Security_Number__c");
          o2o.creditScore = getVal(data, "csbs__Owner_2_CreditScore__c");
          o2o.address = getVal(data, "csbs__Owner_2_Home_Address_Street__c");
          o2o.city = getVal(data, "csbs__Owner_2_Home_Address_City__c");
          o2o.state = getVal(data, "csbs__Owner_2_Home_Address_State__c");
          o2o.zip = getVal(data, "csbs__Owner_2_Home_Address_Zip_Code__c");
          o2o.email = getVal(data, "csbs__Owner_2_Email__c");
          o2o.cell = getVal(data, "csbs__Owner_2_Mobile__c");
          nOwners.push(o2o);
        }
        setOwners(nOwners);
      }
    } catch (e) { console.log("Lookup error:", e); }
    setLoading(false);
    setShowEmail(false);
  };

  const addBankSlot = () => setBankFiles(p => [...p, null]);
  const requiredBankCount = 4;

  // Multi-file input handler — distributes selected files into empty slots starting at this index
  const handleBankFileInput = (i, fileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setBankFiles(prev => {
      const next = [...prev];
      let fi = 0;
      next[i] = files[fi++] || null;
      for (let j = i + 1; j < next.length && fi < files.length; j++) {
        if (!next[j]) next[j] = files[fi++];
      }
      while (fi < files.length) next.push(files[fi++]);
      return next;
    });
    setBankErrors("");
  };

  // Binary multipart upload — no base64 overhead, sends real file objects via FormData
  const handleBankSubmit = async () => {
    const missing = bankFiles.slice(0, requiredBankCount).filter(f => !f).length;
    if (missing > 0) { setBankErrors(`First ${requiredBankCount} months are required`); return; }
    setBankErrors(""); setBankUploading(true); setUploadProgress("Preparing upload...");
    try {
      const validFiles = bankFiles.filter(f => f);
      const fd = new FormData();
      fd.append("event", "bank_statements_uploaded");
      fd.append("step", "bank_upload");
      fd.append("email", _email || "");
      fd.append("timestamp", new Date().toISOString());
      const agentParam = getParam("agent");
      if (agentParam) { fd.append("agent_param", agentParam); fd.append("slug", agentParam); }
      if (_agentData) fd.append("agent_info", JSON.stringify(_agentData));
      fd.append("total_files", String(validFiles.length));
      validFiles.forEach((file, i) => { fd.append(`file_${i}`, file, file.name); });
      setUploadProgress("Uploading...");
      await fetch(WEBHOOK, { method: "POST", body: fd });
      setUploadProgress(""); setBankUploading(false); setPage("thanks");
    } catch (e) { setUploadProgress(""); setBankUploading(false); setBankErrors("Upload failed. Please try again."); }
  };

  const slideStyle = { opacity: anim ? 0 : 1, transform: anim ? `translateY(${dir * 20}px)` : "translateY(0)", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)" };
  const errStyle = { fontSize: 11, color: "#d64545", marginTop: 3 };
  const E = hasError;

  if (page === "bank") {
    const monthNames = getMonthNames(requiredBankCount);
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Plus Jakarta Sans',sans-serif", ...bottomPad }}>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <style>{`@keyframes spin{to{transform:rotate(360deg);}}${mobileCss}`}</style>
        <TopBar />
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 12px 0" }}>
          <div className="form-card" style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05),0 8px 30px rgba(0,0,0,0.06)" }}>
            <SH title="Upload Bank Statements" subtitle="Please upload your last 4 months of business bank statements" />
            <div className="form-pad" style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
              {bankFiles.map((f, i) => {
                const isReq = i < requiredBankCount;
                const label = i < requiredBankCount ? (i === 0 ? `${monthNames[0]} (Most Recent)` : monthNames[i]) : `Additional Doc ${i - 3}`;
                return (
                  <div key={i}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                      <label style={{ fontSize: 12.5, fontWeight: 600, color: "#4a5568" }}>{label}{isReq && <span style={{ color: "#d64545", marginLeft: 4 }}>*</span>}</label>
                      {i >= requiredBankCount && <button onClick={() => setBankFiles(p => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#d64545", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Remove</button>}
                    </div>
                    <div style={{ border: "2px dashed " + (f ? NV3 : isReq && bankErrors ? "#d64545" : "#dde1e7"), borderRadius: 10, padding: "12px 14px", background: f ? "#f0f4f8" : "#fff", display: "flex", alignItems: "center", gap: 10 }}>
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg" multiple={i === 0} onChange={e => handleBankFileInput(i, e.target.files)} style={{ flex: 1, fontSize: 12, minWidth: 0 }} />
                      {f && <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}><span style={{ fontSize: 10, color: "#64748b" }}>{(f.size / 1024).toFixed(0)}KB</span><span style={{ color: NV3, fontWeight: 600, fontSize: 14 }}>{"\u2713"}</span></div>}
                    </div>
                  </div>
                );
              })}
              <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 -6px", textAlign: "center" }}>Tip: Click the first slot to upload multiple statements at once</p>
              <button onClick={addBankSlot} style={{ width: "100%", padding: "11px", border: "2px dashed #c8d5db", borderRadius: 10, background: "#f8fbfc", color: NV2, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><span style={{ fontSize: 15 }}>+</span> Add Additional Document</button>
              {bankErrors && <p style={errStyle}>{bankErrors}</p>}
              <button onClick={handleBankSubmit} disabled={bankUploading} style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", background: btnGrad, color: "#fff", fontSize: 14, fontWeight: 700, cursor: bankUploading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>{bankUploading ? <><div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />{uploadProgress}</> : "Submit Bank Statements"}</button>
            </div>
          </div>
          <Footer />
        </div>
        <AgentFooter agent={agent} isMobile={isMobile} />
      </div>
    );
  }

  if (page === "thanks") {
    const ini = agent ? getInitials(agent.Name) : "";
    const hasPhoto = agent && !!agent.Photo;
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f1f5f9", fontFamily: "'Plus Jakarta Sans',sans-serif", ...bottomPad }}>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <TopBar />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ textAlign: "center", maxWidth: 440 }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", margin: "0 auto 16px", background: `linear-gradient(135deg,${NV1},${NV3})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: "#1a202c", margin: "0 0 8px" }}>Thank You for Applying!</h2>
            <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.7, margin: "0 0 20px" }}>
              {agent ? `Your submission has been received. ${agent.Name} will be reaching out shortly.` : "Your application and bank statements have been received. Our team will review everything and reach out within 24 hours."}
            </p>
            {agent && (
              <div style={{ background: "#fff", borderRadius: 16, padding: "18px 20px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: agent.Email || agent.Phone ? 14 : 0 }}>
                  <div style={{ width: 52, height: 52, borderRadius: "50%", background: NV1, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <img src={hasPhoto ? agent.Photo : AGENT_FALLBACK_ICON} alt="" style={{ width: "100%", height: "100%", objectFit: hasPhoto ? "cover" : "contain", padding: hasPhoto ? 0 : 9 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: NV3, letterSpacing: "0.1em", textTransform: "uppercase" }}>Your Funding Expert</p>
                    <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 700, color: "#1a202c" }}>{agent.Name}</p>
                  </div>
                </div>
                {(agent.Email || agent.Phone) && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                    {agent.Phone && (
                      <a href={"tel:" + agent.Phone} style={{ flex: 1, minWidth: 140, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", background: `linear-gradient(135deg,${NV1},${NV2})`, borderRadius: 10, textDecoration: "none", color: "#fff", fontSize: 13, fontWeight: 600 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                        Call
                      </a>
                    )}
                    {agent.Email && (
                      <a href={"mailto:" + agent.Email} style={{ flex: 1, minWidth: 140, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", background: "#f5f7f9", border: "1px solid #e4e9ed", borderRadius: 10, textDecoration: "none", color: NV2, fontSize: 13, fontWeight: 600 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={NV2} strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>
                        Email
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px", width: "100%" }}><Footer /></div>
        <AgentFooter agent={agent} isMobile={isMobile} />
      </div>
    );
  }

  if (showEmail) {
    const ini = agent ? getInitials(agent.Name) : "";
    const hasPhoto = agent && !!agent.Photo;
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: `linear-gradient(170deg,${NV1} 0%,#0d2137 50%,${NV2} 100%)`, fontFamily: "'Plus Jakarta Sans',sans-serif", ...bottomPad }}>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
        <div style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.15)", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={LOGO} alt="Big Think Capital" style={{ height: 36, objectFit: "contain" }} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 16px 16px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 24, padding: "7px 16px", marginBottom: 24 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#5b9bd5" }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.8)", textTransform: "uppercase" }}>Funding Application</span>
          </div>
          <h1 style={{ margin: "0 0 10px", fontSize: "clamp(28px,5vw,44px)", fontWeight: 800, color: "#fff", textAlign: "center", lineHeight: 1.15 }}>Ready to Get Funded?</h1>
          <p style={{ margin: "0 0 28px", fontSize: 15, color: "rgba(255,255,255,0.55)", textAlign: "center", maxWidth: 400, lineHeight: 1.6 }}>Enter your email to retrieve a saved application or start a new one in minutes.</p>
          <div style={{ width: "100%", maxWidth: 440, borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: "0 25px 60px rgba(0,0,0,0.35)" }}>
            <div style={{ padding: "24px 24px 28px" }}>
              {agent && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#f5f8fb", borderRadius: 12, border: "1px solid #e4eaf0", marginBottom: 20 }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: `linear-gradient(135deg,${NV1},${NV3})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                    <img src={hasPhoto ? agent.Photo : AGENT_FALLBACK_ICON} alt="" style={{ width: "100%", height: "100%", objectFit: hasPhoto ? "cover" : "contain", padding: hasPhoto ? 0 : 7 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: NV3, textTransform: "uppercase" }}>Your Assigned Expert</p>
                    <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 700, color: "#1a202c" }}>{agent.Name}</p>
                    {agent.Phone && <p style={{ margin: "1px 0 0", fontSize: 12, color: "#64748b" }}>{agent.Phone}</p>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                    <span style={{ fontSize: 10, color: "#64748b", fontWeight: 500 }}>Available</span>
                  </div>
                </div>
              )}
              <label style={{ display: "block", marginBottom: 5, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#4a5568", textTransform: "uppercase" }}>EMAIL ADDRESS <span style={{ color: "#d64545" }}>*</span></label>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: `1.5px solid ${email && !email.includes("@") ? "#d64545" : "#dde1e7"}`, borderRadius: 10, marginBottom: email && !email.includes("@") ? 6 : 20, background: "#fff" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourcompany.com" onKeyDown={e => { if (e.key === "Enter" && email && email.includes("@")) handleEmailSubmit(); }} style={{ flex: 1, border: "none", outline: "none", fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#1a202c", background: "transparent", minWidth: 0 }} />
              </div>
              {email && !email.includes("@") && <p style={{ ...errStyle, marginBottom: 12 }}>Please enter a valid email address</p>}
              <button onClick={handleEmailSubmit} disabled={!email || !email.includes("@") || loading} style={{ width: "100%", padding: "14px", borderRadius: 10, border: "none", background: email && email.includes("@") ? `linear-gradient(135deg,${NV2},${NV3})` : "#cbd5e1", color: "#fff", fontSize: 15, fontWeight: 700, cursor: email && email.includes("@") && !loading ? "pointer" : "not-allowed", boxShadow: email && email.includes("@") ? "0 4px 14px rgba(10,25,41,0.4)" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>{loading ? <><div style={{ width: 18, height: 18, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />Looking up...</> : <>Continue <span>{"\u2192"}</span></>}</button>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>256-bit SSL encrypted</span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 0, padding: "24px 16px 32px" }}>
          {[{ val: "$2B+", label: "FUNDED" }, { val: "1hr", label: "APPROVALS" }, { val: "40K+", label: "BUSINESSES" }].map((s, i) => (
            <div key={i} style={{ textAlign: "center", flex: 1, maxWidth: 160, borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.12)" : "none", padding: "0 12px" }}>
              <p style={{ margin: 0, fontSize: "clamp(20px,3vw,28px)", fontWeight: 800, color: "#fff" }}>{s.val}</p>
              <p style={{ margin: "3px 0 0", fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase" }}>{s.label}</p>
            </div>
          ))}
        </div>
        <AgentFooter agent={agent} isMobile={isMobile} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Plus Jakarta Sans',sans-serif", ...bottomPad }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}${sliderCss}${mobileCss}`}</style>
      <TopBar />
      <AgentCard agent={agent} collapsed={agentCollapsed} onToggle={() => setAgentCollapsed(!agentCollapsed)} isMobile={isMobile} />
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
      {modal && <ValidationModal missing={modal} onClose={() => setModal(null)} onFix={focusField} />}
      <HoneypotField onChange={v => { _honeypot = v; }} />
      <div className="main-wrap" style={{ maxWidth: 680, margin: "0 auto", padding: "0 16px", paddingBottom: 20 }}>
        <StepBar current={step} />
        <div className="form-card" style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05),0 8px 30px rgba(0,0,0,0.06)", marginBottom: 16 }}>
          {step === 0 && (
            <div style={slideStyle}>
              <SH title="Business Information" subtitle="Tell us about your business" />
              <div className="form-pad" style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
                <Row><Field label="Business Name" value={biz.name} onChange={v => upBiz("name", v)} placeholder="Acme Corporation" required error={E} id="biz-name" /></Row>
                <Row><Field label="DBA Name" value={biz.dba} onChange={v => upBiz("dba", v)} placeholder="Acme Co" /></Row>
                <Row><Field label="Business Start Date" value={biz.startDate} onChange={v => upBiz("startDate", v)} type="date" half required error={E} id="biz-startDate" /><Select label="Legal Entity" value={biz.entity} onChange={v => upBiz("entity", v)} options={ENTITY_OPTS} half required error={E} id="biz-entity" /></Row>
                <Row><Field label="Industry" value={biz.industry} onChange={v => upBiz("industry", v)} placeholder="Technology" half required error={E} id="biz-industry" /><Field label="Federal Tax ID" value={biz.taxId} onChange={v => upBiz("taxId", v)} placeholder="12-3456789" half required fmt={fmtTaxId} raw={v => v} error={E} id="biz-taxId" noAuto /></Row>
                <Row><Textarea label="Description of Business" value={biz.description} onChange={v => upBiz("description", v)} placeholder="Briefly describe your business operations..." required error={E} id="biz-desc" /></Row>
                <Row><MoneySliderField label="Amount Requested" value={biz.amountRequested} onChange={v => upBiz("amountRequested", v)} placeholder="$250,000" half required min={10000} max={5000000} step={10000} error={E} id="biz-amount" /><MoneySliderField label="Annual Revenue" value={biz.annualRevenue} onChange={v => upBiz("annualRevenue", v)} placeholder="$1,500,000" half required min={0} max={50000000} step={50000} error={E} id="biz-revenue" /></Row>
                <Row><Select label="Use of Proceeds" value={biz.useOfProceeds} onChange={v => upBiz("useOfProceeds", v)} options={PROCEEDS_OPTS} required error={E} id="biz-proceeds" /></Row>
                <Row><Select label="Product Interest" value={biz.product} onChange={v => upBiz("product", v)} options={PRODUCT_OPTS} required error={E} id="biz-product" /></Row>
                <Row><AddressField label="Business Address" value={biz.address} onChange={v => upBiz("address", v)} onPlaceSelect={applyBizPlace} placeholder="123 Main Street" required error={E} id="biz-address" /></Row>
                <Row><Field label="City" value={biz.city} onChange={v => upBiz("city", v)} placeholder="San Francisco" half required error={E} id="biz-city" /><StateSelect value={biz.state} onChange={v => upBiz("state", v)} half required error={E} id="biz-state" /></Row>
                <Row><Field label="ZIP" value={biz.zip} onChange={v => upBiz("zip", v)} placeholder="94102" half required fmt={fmtZip} raw={v => v} error={E} id="biz-zip" /><Field label="Website" value={biz.website} onChange={v => upBiz("website", v)} placeholder="https://acmecorp.com" half /></Row>
                <Row><Field label="Phone Number" value={biz.phone} onChange={v => upBiz("phone", v)} placeholder="(516) 878-8873" half required fmt={fmtPhone} raw={v => v} error={E} id="biz-phone" /><Select label="Own Real Estate?" value={biz.ownRealEstate} onChange={v => upBiz("ownRealEstate", v)} options={YES_NO} half /></Row>
                <Row><Select label="Open Business Loans?" value={biz.openLoans} onChange={v => upBiz("openLoans", v)} options={YES_NO} /></Row>
              </div>
            </div>
          )}
          {step === 1 && (
            <div style={slideStyle}>
              <SH title="Owner Information" subtitle="Provide details for all business owners" />
              <div className="form-pad" style={{ padding: "20px 24px 24px" }}>
                {owners.map((o, idx) => (
                  <div key={idx} style={{ marginBottom: idx < owners.length - 1 ? 24 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1a202c", display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#e8eef4", color: NV2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>{idx + 1}</div>
                        {idx === 0 ? "Primary Owner" : `Owner ${idx + 1}`}
                      </div>
                      {idx > 0 && <button onClick={() => setOwners(p => p.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#d64545", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Remove</button>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      <Row><Field label="First Name" value={o.firstName} onChange={v => upOwner(idx, "firstName", v)} placeholder="John" half required error={E} id={`own${idx}-fn`} /><Field label="Last Name" value={o.lastName} onChange={v => upOwner(idx, "lastName", v)} placeholder="Smith" half required error={E} id={`own${idx}-ln`} /></Row>
                      <Row><Field label="Date of Birth" value={o.dob} onChange={v => { upOwner(idx, "dob", v); checkBirthday(v); }} type="date" half required error={E} id={`own${idx}-dob`} /><SSNField label="SSN" value={o.ssn} onChange={v => upOwner(idx, "ssn", v)} half required error={E} id={`own${idx}-ssn`} /></Row>
                      <Row><NumSliderField label="% Ownership" value={o.ownership} onChange={v => upOwner(idx, "ownership", v)} placeholder="60" half required min={1} max={100} suffix="%" error={E} id={`own${idx}-own`} /><NumSliderField label="Credit Score" value={o.creditScore} onChange={v => upOwner(idx, "creditScore", v)} placeholder="720" half min={300} max={850} /></Row>
                      <Row><AddressField label="Address" value={o.address} onChange={v => upOwner(idx, "address", v)} onPlaceSelect={p => applyOwnerPlace(idx, p)} placeholder="456 Oak Avenue" required error={E} id={`own${idx}-addr`} /></Row>
                      <Row><Field label="City" value={o.city} onChange={v => upOwner(idx, "city", v)} placeholder="San Francisco" half required error={E} id={`own${idx}-city`} /><StateSelect value={o.state} onChange={v => upOwner(idx, "state", v)} half required error={E} id={`own${idx}-state`} /></Row>
                      <Row><Field label="ZIP" value={o.zip} onChange={v => upOwner(idx, "zip", v)} placeholder="94102" half required fmt={fmtZip} raw={v => v} error={E} id={`own${idx}-zip`} /><Field label="Email" value={o.email} onChange={v => handleOwnerEmail(idx, v)} type="email" placeholder="john@acmecorp.com" half required error={E} id={`own${idx}-email`} /></Row>
                      <Row><Field label="Cell" value={o.cell} onChange={v => upOwner(idx, "cell", v)} placeholder="(516) 878-8873" fmt={fmtPhone} raw={v => v} /></Row>
                    </div>
                    {idx < owners.length - 1 && <div style={{ borderBottom: "1px dashed #e2e8f0", margin: "24px 0" }} />}
                  </div>
                ))}
                <button onClick={() => setOwners(p => [...p, emptyOwner()])} style={{ width: "100%", marginTop: 20, padding: "12px", border: "2px dashed #c8d5db", borderRadius: 10, background: "#f8fbfc", color: NV2, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><span style={{ fontSize: 16 }}>+</span> Add a Second Owner</button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div style={slideStyle}>
              <SH title="Review & Sign" subtitle="Preparing your signing document..." />
              <div className="form-pad" style={{ padding: "20px 24px 24px" }}>
                {docLoading && (
                  <div style={{ textAlign: "center", padding: "48px 0" }}>
                    <div style={{ width: 40, height: 40, border: "3px solid #e2e8f0", borderTopColor: NV2, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                    <p style={{ fontSize: 15, fontWeight: 600, color: "#1a202c", marginBottom: 4 }}>Preparing your document...</p>
                    <p style={{ fontSize: 12, color: "#94a3b8" }}>You will be redirected to sign</p>
                  </div>
                )}
                {docError && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "20px", textAlign: "center" }}>
                    <p style={{ fontSize: 14, color: "#dc2626", margin: "0 0 12px", fontWeight: 600 }}>Unable to generate signing document</p>
                    <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 12px" }}>{docError}</p>
                    <button onClick={() => { setDocError(null); initDocuSeal(); }} style={{ padding: "10px 28px", borderRadius: 10, border: "none", background: btnGrad, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Try Again</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="nav-btns" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px" }}>
          {step > 0 ? (
            <button onClick={() => { setDocError(null); setDocLoading(false); setHasError(false); setModal(null); goTo(step - 1); }} style={{ padding: "11px 22px", borderRadius: 10, border: "1.5px solid #cbd5e1", background: "#fff", color: "#475569", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{"\u2190"} Back</button>
          ) : <div />}
          {step < 2 && (
            <button onClick={() => {
              if (step === 0) { if (!validateBiz()) return; sendWebhook({ event: "business_info_completed", step: "business_info", email, business: { ...biz, taxId: rawTaxId(biz.taxId), phone: rawPhone(biz.phone) } }); }
              if (step === 1) { if (!validateOwners()) return; sendWebhook({ event: "owner_info_completed", step: "owner_info", email, business: biz, owners }); }
              goTo(step + 1);
            }} style={{ padding: "11px 26px", borderRadius: 10, border: "none", background: btnGrad, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 14px rgba(10,25,41,0.3)" }}>{step === 0 ? "Continue" : "Continue to Signature"} {"\u2192"}</button>
          )}
        </div>
        <Footer />
      </div>
      <AgentFooter agent={agent} isMobile={isMobile} />
    </div>
  );
}
