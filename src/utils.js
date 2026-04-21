import { COMMON_DOMAINS } from "./constants";

export function getParam(k) {
  return new URLSearchParams(window.location.search).get(k);
}

// Accepts a raw agent payload from Salesforce / the n8n lookup webhook and returns
// a stable { Name, Email, Phone, Photo } shape for the UI. Different Salesforce
// objects expose photo URLs under different field names, so we probe a wide list.
// Priority order: confirmed field first, then common variants.
export function normalizeAgent(d) {
  if (!d) return null;
  const n = d.Name || d.name;
  if (!n) return null;
  const photo =
    d.Headshot_Photo__c ||
    d.User_Photo_URL__c ||
    d.Headshot_URL__c ||
    d.Headshot__c ||
    d.Profile_Photo_URL__c ||
    d.Profile_Photo__c ||
    d.Photo_URL__c ||
    d.Avatar_URL__c ||
    d.User_Avatar_URL__c ||
    d.Image_URL__c ||
    d.Photo ||
    d.photo ||
    d.PhotoUrl ||
    d.photoUrl ||
    d.photo_url ||
    d.FullPhotoUrl ||
    d.MediumPhotoUrl ||
    d.SmallPhotoUrl ||
    d.headshot ||
    d.avatar ||
    d.image ||
    "";
  try {
    if (typeof console !== "undefined" && console.log) {
      console.log("[BTC] Agent lookup keys:", Object.keys(d), "matched Photo:", photo || "(none)");
    }
  } catch (e) {}
  return { Name: n, Email: d.Email || d.email || "", Phone: d.Phone || d.phone || "", Photo: photo };
}

export function getInitials(name) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

export function getVal(data, ...keys) {
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
}

export function fmtPhone(v) {
  const d = v.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
export function rawPhone(v) { return v.replace(/\D/g, "").slice(0, 10); }

export function fmtTaxId(v) {
  const d = v.replace(/\D/g, "").slice(0, 9);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}-${d.slice(2)}`;
}
export function rawTaxId(v) { return v.replace(/\D/g, "").slice(0, 9); }

export function fmtZip(v) { return v.replace(/\D/g, "").slice(0, 5); }

export function fmtMoney(v) {
  if (!v) return "";
  const n = String(v).replace(/[^0-9.]/g, "");
  if (!n) return "";
  const parts = n.split(".");
  const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "$" + (parts.length > 1 ? whole + "." + parts[1].slice(0, 2) : whole);
}
export function rawMoney(v) { return String(v).replace(/[^0-9.]/g, ""); }

export function isBirthdayToday(dob) {
  if (!dob) return false;
  const today = new Date();
  const [y, m, d] = dob.split("-").map(Number);
  return m === today.getMonth() + 1 && d === today.getDate();
}

export function extractDomain(email) {
  if (!email || !email.includes("@")) return "";
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "";
  return COMMON_DOMAINS.includes(domain) ? "" : domain;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// SSN masking: show \u2022\u2022\u2022-\u2022\u2022-1234 when not focused
export function maskSSN(v) {
  if (!v || v.length < 4) return v;
  const d = v.replace(/\D/g, "");
  if (d.length <= 4) return d;
  return "\u2022\u2022\u2022-\u2022\u2022-" + d.slice(-4);
}

export function scrollToError() {
  setTimeout(() => {
    const el = document.querySelector('[data-error="true"]');
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 100);
}

// Returns array of last N month names from most-recent backward.
// getMonthNames(4) -> e.g. ["April", "March", "February", "January"] when called in April
export function getMonthNames(count) {
  const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const now = new Date();
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(names[d.getMonth()]);
  }
  return out;
}
