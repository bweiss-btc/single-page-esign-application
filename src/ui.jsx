import { useState, useEffect, useRef } from "react";
import { STATES, NV1, NV2, NV3 } from "./constants";
import { fmtMoney, rawMoney, maskSSN } from "./utils";

export function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return m;
}

export const sliderCss = `input[type=range]{-webkit-appearance:none;width:100%;height:6px;border-radius:3px;background:#e2e8f0;outline:none;margin:8px 0;}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:${NV2};cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.2);}input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:${NV2};cursor:pointer;border:none;}`;

export const mobileCss = `@media(max-width:768px){.step-bar-label{display:none!important;}.step-bar-wrap{padding:16px 12px 20px!important;}.form-card{border-radius:12px!important;}.form-pad{padding:18px 16px 20px!important;}.sec-header{padding:18px 16px!important;}.sec-header h2{font-size:17px!important;}.main-wrap{padding:0 12px!important;padding-bottom:16px!important;}}`;

export function ValidationModal({ missing, onClose, onFix }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", width: "100%", maxWidth: 440, background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 25px 60px rgba(0,0,0,0.3)", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
        <div style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)", padding: "20px 22px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div>
            <h3 style={{ margin: 0, color: "#fff", fontSize: 16, fontWeight: 700 }}>Missing Required Fields</h3>
            <p style={{ margin: "2px 0 0", color: "rgba(255,255,255,0.8)", fontSize: 12 }}>Please complete {missing.length} field{missing.length > 1 ? "s" : ""}</p>
          </div>
        </div>
        <div style={{ padding: "16px 22px", maxHeight: 280, overflowY: "auto" }}>
          {missing.map((m, i) => (
            <div key={i} onClick={() => onFix(m.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 6, background: "#fef2f2", borderRadius: 10, border: "1px solid #fecaca", cursor: "pointer" }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontWeight: 700, color: "#dc2626" }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a202c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</p>
                {m.hint && <p style={{ margin: "1px 0 0", fontSize: 10.5, color: "#94a3b8" }}>{m.hint}</p>}
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          ))}
        </div>
        <div style={{ padding: "14px 22px 20px", display: "flex", gap: 10 }}>
          <button onClick={() => onFix(missing[0]?.id)} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", background: `linear-gradient(135deg,${NV1},${NV2})`, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Fix First Field</button>
          <button onClick={onClose} style={{ padding: "12px 20px", borderRadius: 12, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function HoneypotField({ onChange }) {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px", width: 0, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
      <label htmlFor="company_url" style={{ display: "none" }}>Leave empty</label>
      <input type="text" id="company_url" name="company_url" tabIndex={-1} autoComplete="off" onChange={e => onChange(e.target.value)} />
    </div>
  );
}

// SSN Field with eye toggle for show/hide
export function SSNField({ label, value, onChange, required, half, error, id }) {
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const hasErr = error && required && !value;
  const showPlain = focused || shown;
  const display = showPlain ? value : maskSSN(value);
  return (
    <div data-error={hasErr ? "true" : undefined} data-field-id={id} style={{ flex: half ? "1 1 calc(50% - 8px)" : "1 1 100%", minWidth: half ? 120 : 0 }}>
      <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: hasErr ? "#dc2626" : focused ? NV3 : "#4a5568", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{label}{required && <span style={{ color: "#d64545", marginLeft: 2 }}>*</span>}</label>
      <div style={{ position: "relative" }}>
        <input type={showPlain ? "text" : "password"} inputMode="numeric" value={display} placeholder="XXX-XX-XXXX" autoComplete="off" data-lpignore="true" data-1p-ignore="true"
          onChange={e => { if (showPlain) { const raw = e.target.value.replace(/\D/g, "").slice(0, 9); onChange(raw); } }}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={{ width: "100%", padding: "10px 40px 10px 12px", border: `1.5px solid ${hasErr ? "#dc2626" : focused ? NV3 : "#dde1e7"}`, borderRadius: 10, fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#1a202c", background: hasErr ? "#fef2f2" : focused ? "#f0f4f8" : "#fff", outline: "none", boxSizing: "border-box", letterSpacing: showPlain ? 0 : "0.15em" }} />
        <button type="button" onClick={() => setShown(s => !s)} tabIndex={-1} aria-label={shown ? "Hide SSN" : "Show SSN"} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex", alignItems: "center", justifyContent: "center", color: shown ? NV3 : "#94a3b8" }}>
          {shown ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          )}
        </button>
      </div>
    </div>
  );
}

export function Field({ label, value, onChange, type = "text", placeholder = "", required, half, fmt, raw, error, id, noAuto }) {
  const [f, setF] = useState(false);
  const handleChange = e => { const v = fmt ? fmt(e.target.value) : e.target.value; onChange(raw ? raw(v) : v, v); };
  const displayVal = fmt ? fmt(value) : value;
  const hasErr = error && required && !value;
  return (
    <div data-error={hasErr ? "true" : undefined} data-field-id={id} style={{ flex: half ? "1 1 calc(50% - 8px)" : "1 1 100%", minWidth: half ? 120 : 0 }}>
      <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: hasErr ? "#dc2626" : f ? NV3 : "#4a5568", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{label}{required && <span style={{ color: "#d64545", marginLeft: 2 }}>*</span>}</label>
      <input type={type} value={displayVal} placeholder={placeholder} onChange={handleChange} onFocus={() => setF(true)} onBlur={() => setF(false)} autoComplete={noAuto ? "off" : undefined} data-lpignore={noAuto ? "true" : undefined} data-1p-ignore={noAuto ? "true" : undefined}
        style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${hasErr ? "#dc2626" : f ? NV3 : "#dde1e7"}`, borderRadius: 10, fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#1a202c", background: hasErr ? "#fef2f2" : f ? "#f0f4f8" : "#fff", outline: "none", boxSizing: "border-box" }} />
    </div>
  );
}

export function MoneySliderField({ label, value, onChange, placeholder = "", required, half, min = 0, max = 5000000, step = 10000, error, id }) {
  const [f, setF] = useState(false);
  const [disp, setDisp] = useState(value ? fmtMoney(value) : "");
  const numVal = Number(rawMoney(value)) || 0;
  const hasErr = error && required && !value;
  useEffect(() => { if (value && !f) setDisp(fmtMoney(value)); }, [value]);
  return (
    <div data-error={hasErr ? "true" : undefined} data-field-id={id} style={{ flex: half ? "1 1 calc(50% - 8px)" : "1 1 100%", minWidth: half ? 120 : 0 }}>
      <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: hasErr ? "#dc2626" : f ? NV3 : "#4a5568", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{label}{required && <span style={{ color: "#d64545", marginLeft: 2 }}>*</span>}</label>
      <input type="text" value={f ? disp : fmtMoney(value)} placeholder={placeholder} onChange={e => { setDisp(e.target.value); onChange(rawMoney(e.target.value)); }} onFocus={() => { setF(true); setDisp(value || ""); }} onBlur={() => { setF(false); onChange(rawMoney(disp)); }} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${hasErr ? "#dc2626" : f ? NV3 : "#dde1e7"}`, borderRadius: 10, fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#1a202c", background: hasErr ? "#fef2f2" : f ? "#f0f4f8" : "#fff", outline: "none", boxSizing: "border-box" }} />
      <input type="range" min={min} max={max} step={step} value={numVal} onChange={e => onChange(e.target.value)} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8", marginTop: -4 }}><span>{fmtMoney(String(min))}</span><span>{fmtMoney(String(max))}</span></div>
    </div>
  );
}

export function NumSliderField({ label, value, onChange, placeholder = "", required, half, min = 0, max = 100, step = 1, suffix = "", error, id }) {
  const [f, setF] = useState(false);
  const numVal = Number(value) || 0;
  const hasErr = error && required && !value;
  return (
    <div data-error={hasErr ? "true" : undefined} data-field-id={id} style={{ flex: half ? "1 1 calc(50% - 8px)" : "1 1 100%", minWidth: half ? 120 : 0 }}>
      <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: hasErr ? "#dc2626" : f ? NV3 : "#4a5568", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{label}{required && <span style={{ color: "#d64545", marginLeft: 2 }}>*</span>}</label>
      <input type="text" value={value} placeholder={placeholder} onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); onChange(v); }} onFocus={() => setF(true)} onBlur={() => setF(false)} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${hasErr ? "#dc2626" : f ? NV3 : "#dde1e7"}`, borderRadius: 10, fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#1a202c", background: hasErr ? "#fef2f2" : f ? "#f0f4f8" : "#fff", outline: "none", boxSizing: "border-box" }} />
      <input type="range" min={min} max={max} step={step} value={numVal} onChange={e => onChange(e.target.value)} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8", marginTop: -4 }}><span>{min}{suffix}</span><span>{max}{suffix}</span></div>
    </div>
  );
}

export function StateSelect({ value, onChange, required, half, error, id }) {
  const [f, setF] = useState(false);
  const [q, setQ] = useState(value || "");
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const filtered = STATES.filter(s => s.toLowerCase().startsWith(q.toLowerCase()));
  const hasErr = error && required && (!value || !STATES.includes(value));
  useEffect(() => { setQ(value || ""); }, [value]);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} data-error={hasErr ? "true" : undefined} data-field-id={id} style={{ flex: half ? "1 1 calc(50% - 8px)" : "1 1 100%", minWidth: half ? 120 : 0, position: "relative" }}>
      <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: hasErr ? "#dc2626" : f ? NV3 : "#4a5568", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>State{required && <span style={{ color: "#d64545", marginLeft: 2 }}>*</span>}</label>
      <input type="text" value={q} placeholder="CA" maxLength={2} onChange={e => { const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2); setQ(v); setOpen(true); if (STATES.includes(v)) onChange(v); }} onFocus={() => { setF(true); setOpen(true); }} onBlur={() => setF(false)} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${hasErr ? "#dc2626" : f ? NV3 : "#dde1e7"}`, borderRadius: 10, fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#1a202c", background: hasErr ? "#fef2f2" : f ? "#f0f4f8" : "#fff", outline: "none", boxSizing: "border-box", textTransform: "uppercase" }} />
      {open && filtered.length > 0 && q.length < 2 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, maxHeight: 160, overflowY: "auto", background: "#fff", border: "1px solid #dde1e7", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 50, marginTop: 4 }}>
          {filtered.map(s => (
            <div key={s} onMouseDown={() => { onChange(s); setQ(s); setOpen(false); }} style={{ padding: "8px 14px", fontSize: 13, cursor: "pointer", background: s === value ? "#f0f4f8" : "#fff", fontWeight: s === value ? 700 : 400 }}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Select({ label, value, onChange, options, required, half, placeholder = "Select...", error, id }) {
  const [f, setF] = useState(false);
  const hasErr = error && required && !value;
  return (
    <div data-error={hasErr ? "true" : undefined} data-field-id={id} style={{ flex: half ? "1 1 calc(50% - 8px)" : "1 1 100%", minWidth: half ? 120 : 0 }}>
      <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: hasErr ? "#dc2626" : f ? NV3 : "#4a5568", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{label}{required && <span style={{ color: "#d64545", marginLeft: 2 }}>*</span>}</label>
      <select value={value} onChange={e => onChange(e.target.value)} onFocus={() => setF(true)} onBlur={() => setF(false)} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${hasErr ? "#dc2626" : f ? NV3 : "#dde1e7"}`, borderRadius: 10, fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif", color: value ? "#1a202c" : "#a0aec0", background: hasErr ? "#fef2f2" : f ? "#f0f4f8" : "#fff", outline: "none", appearance: "none", cursor: "pointer", boxSizing: "border-box" }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function Textarea({ label, value, onChange, placeholder, required, error, id }) {
  const [f, setF] = useState(false);
  const hasErr = error && required && !value;
  return (
    <div data-error={hasErr ? "true" : undefined} data-field-id={id} style={{ flex: "1 1 100%" }}>
      <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: hasErr ? "#dc2626" : f ? NV3 : "#4a5568", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{label}{required && <span style={{ color: "#d64545", marginLeft: 2 }}>*</span>}</label>
      <textarea value={value} placeholder={placeholder} rows={3} onChange={e => onChange(e.target.value)} onFocus={() => setF(true)} onBlur={() => setF(false)} style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${hasErr ? "#dc2626" : f ? NV3 : "#dde1e7"}`, borderRadius: 10, fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#1a202c", background: hasErr ? "#fef2f2" : f ? "#f0f4f8" : "#fff", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
    </div>
  );
}

export function Row({ children, gap = 16 }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap }}>{children}</div>;
}
