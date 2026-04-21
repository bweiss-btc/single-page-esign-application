import { useEffect, useState } from "react";
import { STEPS, LOGO, AGENT_FALLBACK_ICON, NV1, NV2, NV3 } from "./constants";
import { getInitials } from "./utils";

export function TopBar() {
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px", display: "flex", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <img src={LOGO} alt="Big Think Capital" style={{ height: 36, objectFit: "contain" }} />
      <div style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>Business Financing Application</div>
    </div>
  );
}

// Renders an agent photo with S3 fallback to b-icon.png. Falls back when (a) agent.Photo
// is empty/null OR (b) the image fails to load in the browser (broken URL, 403, etc.).
// Exported so App.jsx can use it inline (email entry hero + thanks page) instead of
// inline <img> tags that lacked onError.
export function AgentPhoto({ agent, size = 76, fallbackPadding }) {
  const [errored, setErrored] = useState(false);
  const hasPhoto = !!agent.Photo && !errored;
  const src = hasPhoto ? agent.Photo : AGENT_FALLBACK_ICON;
  const pad = fallbackPadding !== undefined ? fallbackPadding : size * 0.18;
  return <img src={src} alt="" onError={() => setErrored(true)} style={{ width: "100%", height: "100%", objectFit: hasPhoto ? "cover" : "contain", background: hasPhoto ? "transparent" : NV1, padding: hasPhoto ? 0 : pad }} />;
}

export function AgentCard({ agent, collapsed, onToggle, isMobile }) {
  if (!agent || isMobile) return null;
  if (collapsed) {
    return (
      <div onClick={onToggle} style={{ position: "fixed", right: 0, top: "50%", transform: "translateY(-50%)", zIndex: 100, background: `linear-gradient(180deg,${NV1},${NV2})`, color: "#fff", padding: "14px 10px", borderRadius: "10px 0 0 10px", cursor: "pointer", writingMode: "vertical-rl", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", boxShadow: "-2px 0 12px rgba(0,0,0,0.3)" }}>
        {"\u203A"}  YOUR FUNDING EXPERT
      </div>
    );
  }
  return (
    <div style={{ position: "fixed", right: 20, top: "50%", transform: "translateY(-50%)", zIndex: 100, width: 280, background: "#fff", borderRadius: 16, boxShadow: "0 10px 50px rgba(0,0,0,0.25)", overflow: "visible", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
      <div style={{ background: `linear-gradient(160deg,${NV1},${NV2},${NV3})`, borderRadius: "16px 16px 0 0", padding: "12px 16px 55px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div onClick={onToggle} style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)", fontSize: 16, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>{"\u203A"}</div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.85)", textTransform: "uppercase", lineHeight: 1.4, paddingTop: 4 }}>YOUR ASSIGNED FUNDING EXPERT</p>
      </div>
      <div style={{ textAlign: "center", marginTop: -40, padding: "0 24px 24px" }}>
        <div style={{ width: 76, height: 76, borderRadius: "50%", border: "3px solid #fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", overflow: "hidden", boxShadow: "0 6px 20px rgba(0,0,0,0.25)", background: NV1 }}>
          <AgentPhoto agent={agent} size={76} />
        </div>
        <p style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 600, color: "#1a202c" }}>{agent.Name}</p>
        {agent.Email && (
          <a href={"mailto:" + agent.Email} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 16px", background: "#f5f7f9", borderRadius: 24, textDecoration: "none", color: NV2, fontSize: 12, fontWeight: 500, marginBottom: 10, border: "1px solid #e4e9ed" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={NV2} strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>
            {agent.Email}
          </a>
        )}
        {agent.Phone && (
          <a href={"tel:" + agent.Phone} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 16px", background: "#f5f7f9", borderRadius: 24, textDecoration: "none", color: NV2, fontSize: 12, fontWeight: 500, border: "1px solid #e4e9ed" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={NV2} strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
            {agent.Phone}
          </a>
        )}
      </div>
    </div>
  );
}

export function AgentFooter({ agent, isMobile }) {
  if (!agent) return null;
  const stickyStyle = isMobile ? { position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 90 } : {};
  return (
    <div style={{ background: `linear-gradient(135deg,${NV1},${NV2},${NV3})`, padding: isMobile ? "10px 12px" : "12px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 8 : 12, flexWrap: "wrap", ...stickyStyle }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: NV1, color: "#fff", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
          <AgentPhoto agent={agent} size={26} fallbackPadding={4} />
        </div>
        <span style={{ color: "#fff", fontSize: isMobile ? 12 : 13, fontWeight: 700 }}>{agent.Name}</span>
      </div>
      {agent.Phone && (
        <a href={"tel:" + agent.Phone} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.15)", padding: "6px 12px", borderRadius: 20, textDecoration: "none", color: "#fff", fontSize: 11.5, fontWeight: 600 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>Call
        </a>
      )}
      {agent.Email && (
        <a href={"mailto:" + agent.Email} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.15)", padding: "6px 12px", borderRadius: 20, textDecoration: "none", color: "#fff", fontSize: 11.5, fontWeight: 600 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>Email
        </a>
      )}
    </div>
  );
}

export function Footer() {
  return (
    <div style={{ textAlign: "center", marginTop: 24, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
      <img src={LOGO} alt="Big Think Capital" style={{ height: 28, objectFit: "contain", marginBottom: 10 }} />
      <p style={{ margin: "0 0 4px", fontSize: 12, color: "#64748b" }}>Questions? Call <strong style={{ color: NV2 }}>844-200-7200</strong></p>
      <p style={{ margin: 0, fontSize: 10.5, color: "#94a3b8" }}>{"\u00a9"} 2026 Big Think Capital. All rights reserved.</p>
    </div>
  );
}

export function Toast({ msg, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 200, background: "linear-gradient(135deg,#0b6e7f,#0e8a9e)", color: "#fff", padding: "12px 20px", borderRadius: 12, fontSize: 14, fontWeight: 700, boxShadow: "0 8px 30px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 8, maxWidth: "90vw" }}>
      <span style={{ fontSize: 20 }}>{"\uD83C\uDF82"}</span>{msg}
    </div>
  );
}

export function StepBar({ current }) {
  return (
    <div className="step-bar-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px 28px" }}>
      {STEPS.map((l, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", flex: i < 2 ? 1 : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: i <= current ? NV2 : "#e2e8f0", color: i <= current ? "#fff" : "#94a3b8", boxShadow: i === current ? "0 0 0 3px rgba(19,47,76,0.2)" : "none", flexShrink: 0 }}>{i < current ? "\u2713" : i + 1}</div>
            <span className="step-bar-label" style={{ fontSize: 12, fontWeight: i === current ? 700 : 500, color: i <= current ? NV2 : "#94a3b8", whiteSpace: "nowrap" }}>{l}</span>
          </div>
          {i < 2 && <div style={{ flex: 1, height: 2, margin: "0 12px", borderRadius: 2, background: i < current ? NV2 : "#e2e8f0" }} />}
        </div>
      ))}
    </div>
  );
}

export function SH({ title, subtitle }) {
  return (
    <div className="sec-header" style={{ background: `linear-gradient(135deg,${NV1} 0%,${NV2} 50%,${NV3} 100%)`, borderRadius: "14px 14px 0 0", padding: "20px 24px" }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#fff", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{title}</h2>
      {subtitle && <p style={{ margin: "3px 0 0", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{subtitle}</p>}
    </div>
  );
}
