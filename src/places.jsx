import { useEffect, useRef, useState } from "react";
import { NV3 } from "./constants";

// Google Places API key (must have Places library enabled in Google Cloud Console)
const PLACES_KEY = "AIzaSyBGnK8cvCmoPqJ1einqzkz8HLRMIo-1Kbs";

let _placesLoadPromise = null;
function loadPlacesScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (_placesLoadPromise) return _placesLoadPromise;
  if (window.google && window.google.maps && window.google.maps.places) {
    _placesLoadPromise = Promise.resolve();
    return _placesLoadPromise;
  }
  _placesLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-places-loader="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + PLACES_KEY + "&libraries=places&v=weekly";
    s.async = true;
    s.defer = true;
    s.dataset.placesLoader = "1";
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _placesLoadPromise;
}

function parsePlace(place) {
  const get = (type, short) => {
    const c = (place.address_components || []).find(x => x.types.includes(type));
    if (!c) return "";
    return short ? c.short_name : c.long_name;
  };
  const streetNum = get("street_number");
  const route = get("route");
  return {
    address: [streetNum, route].filter(Boolean).join(" "),
    city: get("locality") || get("sublocality") || get("postal_town") || get("administrative_area_level_3"),
    state: get("administrative_area_level_1", true),
    zip: get("postal_code")
  };
}

// AddressField — text input with Google Places Autocomplete.
// When a place is chosen, calls onPlaceSelect({ address, city, state, zip }) so the
// parent form can fill adjacent city/state/zip fields in one shot.
// Free typing still calls onChange(val) like a normal field.
export function AddressField({ label, value, onChange, placeholder, required, half, error, id, onPlaceSelect }) {
  const inputRef = useRef(null);
  const autoRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const hasErr = error && required && !value;
  useEffect(() => {
    let cancelled = false;
    loadPlacesScript().then(() => {
      if (cancelled || !inputRef.current || autoRef.current) return;
      try {
        const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ["address"],
          componentRestrictions: { country: ["us"] },
          fields: ["address_components", "formatted_address"]
        });
        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (!place || !place.address_components) return;
          const parsed = parsePlace(place);
          if (parsed.address) onChange(parsed.address);
          if (onPlaceSelect) onPlaceSelect(parsed);
        });
        autoRef.current = ac;
      } catch (e) { /* ignore; field still works as plain input */ }
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);
  return (
    <div data-error={hasErr ? "true" : undefined} data-field-id={id} style={{ flex: half ? "1 1 calc(50% - 8px)" : "1 1 100%", minWidth: half ? 120 : 0 }}>
      <label style={{ display: "block", marginBottom: 4, fontSize: 12, fontWeight: 600, color: hasErr ? "#dc2626" : focused ? NV3 : "#4a5568", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
        {label}{required && <span style={{ color: "#d64545", marginLeft: 2 }}>*</span>}
      </label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${hasErr ? "#dc2626" : focused ? NV3 : "#dde1e7"}`, borderRadius: 10, fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#1a202c", background: hasErr ? "#fef2f2" : focused ? "#f0f4f8" : "#fff", outline: "none", boxSizing: "border-box" }}
      />
    </div>
  );
}
