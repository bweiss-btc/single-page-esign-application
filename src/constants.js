// Constants extracted from App.jsx for modularity
export const STEPS = ["Business Information", "Owner Information", "Review & Sign"];

// Updated entity options per spec: Corporation, LLC, LLP, Ltd. Partnership, Partnership, Sole Proprietor
export const ENTITY_OPTS = ["Corporation", "LLC", "LLP", "Ltd. Partnership", "Partnership", "Sole Proprietor"];

export const PRODUCT_OPTS = ["Term Loan", "Line of Credit", "SBA Loan", "Equipment Financing", "Invoice Factoring", "Merchant Cash Advance"];

// New: Use of Proceeds dropdown options
export const PROCEEDS_OPTS = ["Working Capital", "Payroll", "Inventory", "Equipment", "Expansion", "Marketing", "Debt Consolidation", "Real Estate", "Other"];

export const YES_NO = ["Yes", "No"];

export const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

export const COMMON_DOMAINS = ["gmail.com","yahoo.com","hotmail.com","outlook.com","aol.com","icloud.com","me.com","live.com","msn.com","comcast.net","verizon.net","att.net","sbcglobal.net","mail.com","protonmail.com","zoho.com","ymail.com","gmx.com"];

export const emptyOwner = () => ({ firstName:"", lastName:"", dob:"", ssn:"", ownership:"", creditScore:"", address:"", city:"", state:"", zip:"", email:"", cell:"" });

export const WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/ec9ccd01-c951-42b3-ac51-27a3077f6648";
export const LOOKUP_WEBHOOK = "https://n8n.bigthinkcapital.com/webhook/e41ebca9-5f6c-49b2-af2c-cd4299edf4ytd";
export const LOGO = "https://bigthink-capital-assets.s3.us-east-1.amazonaws.com/images/company-logo.png";

// Fallback icon used when an agent has no photo
export const AGENT_FALLBACK_ICON = "https://bigthink-capital-assets.s3.us-east-1.amazonaws.com/images/b-icon.png";

// Brand navy palette
export const NV1 = "#0a1929";
export const NV2 = "#132f4c";
export const NV3 = "#1a4971";
