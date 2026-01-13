// public/js/map.js

let map;
let markersLayer;
let allPoints = [];
let selectedYear = null;

let monthSlider = null;
let monthLabelEl = null;

let availableMonthsByYear = {}; // { 2025: [4,6,7,9], ... }  (0–11)
let activeMonths = [];          // months for selectedYear (array of 0–11)

const MONTH_NAMES = [
  "January", "February", "March", "April",
  "May", "June", "July", "August",
  "September", "October", "November", "December"
];

// ✅ FIX: popup pane name (so popups can be above Leaflet controls)
const POPUP_PANE_TOP = "popupTop";

// ---- Units + thresholds (NO2) ----
// Your measurements are monthly averages (e.g. Palmes tubes) in µg/m³.
const VALUE_SUFFIX = " µg/m³";

// Presets are visualization anchors for monthly means.
// - annual: reference point (annual guideline/limit; used here as a monthly context anchor)
// - high:   "high" monthly anchor (used for context labels)
// - colorMax: value where the color becomes fully red (values above are clamped)
/**
 * ============================
 * NO₂ SCALE SOURCES & RATIONALE
 * ============================
 *
 * Measurement context:
 * - Values represent NO₂ concentrations in µg/m³
 * - Interpreted as *monthly averages* derived from Palmes diffusion tube measurements
 *   (passive sampling, typically 2–4 week exposure periods).
 *
 * WHY MONTHLY?
 * - Palmes tubes do NOT measure hourly or daily peaks.
 * - WHO/EU limit values are defined as annual means and short-term limits.
 * - For map visualization, these limits are translated into *practical monthly reference levels*
 *   rather than legal compliance thresholds.
 *
 * ----------------------------
 * WHO (World Health Organization)
 * ----------------------------
 * Source:
 * - WHO Air Quality Guidelines 2021
 *   https://www.who.int/publications/i/item/9789240034228
 *
 * Official guideline:
 * - Annual mean NO₂: 10 µg/m³
 * - Short-term (24h) guideline: 25 µg/m³
 *
 * Map interpretation:
 * - ≤10 µg/m³   : clean / background levels
 * - 10–25 µg/m³: elevated but within WHO guidance
 * - >25 µg/m³  : increasingly polluted (health risk likely)
 *
 * ----------------------------
 * EU (European Union)
 * ----------------------------
 * Source:
 * - EU Air Quality Directive 2008/50/EC
 *   https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32008L0050
 *
 * Legal limit values:
 * - Annual mean NO₂: 40 µg/m³
 * - Hourly limit: 200 µg/m³ (not applicable to passive samplers)
 *
 * Map interpretation:
 * - ≤40 µg/m³   : within EU annual limit
 * - 40–60 µg/m³: structurally high urban concentrations
 * - >60 µg/m³  : very high for monthly passive measurements
 *
 * ----------------------------
 * Important note
 * ----------------------------
 * - These scales are NOT legal compliance tools.
 * - They are designed for comparative, educational and exploratory mapping only.
 * - Color breaks are intentionally conservative to reflect the smoothing effect
 *   of passive monthly sampling.
 */
const SCALE_PRESETS = {
  WHO:  { key: "WHO",  label: "WHO",  annual: 10,  high: 25,  colorMax: 50 },
  EU:   { key: "EU",   label: "EU",   annual: 40,  high: 60,  colorMax: 80 },
  DATA: { key: "DATA", label: "Data", annual: null, high: null, colorMax: null }
};

const SCALE_STORAGE_KEY = "no2ScalePreset";

// Active scale (default WHO; may be overwritten at init)
let activeScale = { ...SCALE_PRESETS.WHO };

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function setScalePreset(key) {
  const preset = SCALE_PRESETS[key];
  if (!preset) return;

  // If DATA preset isn't computed yet, ignore.
  if (preset.key === "DATA" && (preset.colorMax == null || preset.annual == null || preset.high == null)) {
    return;
  }

  activeScale = { ...preset };

  try {
    localStorage.setItem(SCALE_STORAGE_KEY, activeScale.key);
  } catch (_) {
    // ignore storage errors
  }
}

function applyStoredScalePreset() {
  try {
    const stored = localStorage.getItem(SCALE_STORAGE_KEY);
    if (stored && SCALE_PRESETS[stored]) {
      // will ignore DATA if not ready
      setScalePreset(stored);
    }
  } catch (_) {
    // ignore
  }
}

function normalizeForColor(value) {
  const max = (typeof activeScale.colorMax === "number" && activeScale.colorMax > 0) ? activeScale.colorMax : 50;
  return clamp01(value / max);
}

function getColor(m) {
  // m expects value between 0 and 1
  if (m <= 0.5) {
    const t = m / 0.5;
    const r = Math.round(0 + t * 255);
    const g = 255;
    const b = 0;
    return `rgb(${r},${g},${b})`; // green -> yellow
  } else {
    const t = (m - 0.5) / 0.5;
    const r = 255;
    const g = Math.round(255 - t * 255);
    const b = 0;
    return `rgb(${r},${g},${b})`; // yellow -> red
  }
}

function getCategory(value) {
  // Interpret as µg/m³ (monthly means)
  const a = activeScale.annual;
  const h = activeScale.high;

  if (typeof a !== "number" || typeof h !== "number") {
    return "Value context unavailable";
  }

  if (value <= a) return `≤ ${a}${VALUE_SUFFIX}`;
  if (value <= h) return `> ${a}${VALUE_SUFFIX} and ≤ ${h}${VALUE_SUFFIX}`;
  return `> ${h}${VALUE_SUFFIX}`;
}

// Get all years from measurement data (array of docs)
function extractAvailableYears(points) {
  const years = new Set();

  points.forEach(point => {
    if (!point || !point.measurements) return;

    point.measurements.forEach(m => {
      if (!m.date) return;
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return;
      years.add(d.getFullYear());
    });
  });

  return Array.from(years).sort((a, b) => a - b);
}

function buildAvailableMonthsByYear(points) {
  const map = {}; // year -> Set(monthIndex)

  points.forEach(point => {
    (point.measurements || []).forEach(m => {
      if (!m.date) return;
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return;

      const y = d.getFullYear();
      const mo = d.getMonth(); // 0–11

      if (!map[y]) map[y] = new Set();
      map[y].add(mo);
    });
  });

  // convert sets -> sorted arrays
  const out = {};
  Object.keys(map).forEach(y => {
    out[y] = Array.from(map[y]).sort((a, b) => a - b);
  });

  return out;
}

function percentile(sortedArr, p) {
  // sortedArr: ascending, p: 0..1
  if (!sortedArr.length) return null;
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const w = idx - lo;
  return sortedArr[lo] * (1 - w) + sortedArr[hi] * w;
}

function computeDataScaleFromPoints(points) {
  const vals = [];

  points.forEach(pt => {
    (pt.measurements || []).forEach(m => {
      if (!m) return;
      if (m.noMeasurement) return;
      if (typeof m.value !== "number" || Number.isNaN(m.value)) return;
      vals.push(m.value);
    });
  });

  vals.sort((a, b) => a - b);
  if (!vals.length) return null;

  const p50 = percentile(vals, 0.50);
  const p75 = percentile(vals, 0.75);
  const p95 = percentile(vals, 0.95);

  const round1 = (x) => Math.round(x * 10) / 10;

  return {
    key: "DATA",
    label: "Data",
    annual: round1(p50),
    high: round1(p75),
    colorMax: Math.max(1, round1(p95))
  };
}

function updateMonthSliderForYear(year) {
  if (!monthSlider || !monthLabelEl) return;

  activeMonths = availableMonthsByYear[year] || [];

  if (activeMonths.length === 0) {
    // niets beschikbaar: slider uit en label leeg
    monthSlider.disabled = true;
    monthSlider.min = "0";
    monthSlider.max = "0";
    monthSlider.value = "0";
    monthLabelEl.textContent = "No data";
    return;
  }

  monthSlider.disabled = false;
  monthSlider.min = "0";
  monthSlider.max = String(activeMonths.length - 1);

  // reset naar eerste beschikbare maand (of clamp als je liever onthoudt)
  monthSlider.value = "0";

  updateMonthLabel();
}

function createUiLogin() {
  const menuControl = L.control({ position: "topright" });

  menuControl.onAdd = function () {
    const container = L.DomUtil.create("div", "menu-control");

    const button = L.DomUtil.create("button", "menu-button", container);
    button.type = "button";
    button.textContent = "☰";

    const menu = L.DomUtil.create("div", "menu-dropdown", container);

    const items = [
      { href: "/beheer", text: "Login" },
      { href: "/data", text: "Share data" },
      { href: "/about", text: "About us" }
    ];

    items.forEach(item => {
      const a = L.DomUtil.create("a", "menu-item", menu);
      a.href = item.href;
      a.textContent = item.text;
    });

    // ---- Divider ----
    const divider = L.DomUtil.create("div", "", menu);
    divider.style.height = "1px";
    divider.style.background = "rgba(0,0,0,0.12)";
    divider.style.margin = "8px 0";

    // ---- Scale preset buttons ----
    const scaleTitle = L.DomUtil.create("div", "", menu);
    scaleTitle.textContent = "Color scale";
    scaleTitle.style.fontSize = "11px";
    scaleTitle.style.fontWeight = "600";
    scaleTitle.style.marginBottom = "6px";

    const btnRow = L.DomUtil.create("div", "", menu);
    btnRow.style.display = "flex";
    btnRow.style.flexWrap = "wrap";
    btnRow.style.gap = "6px";

    const buttons = {};

    function stylePresetButton(btn, isActive) {
      btn.style.border = "1px solid #ccc";
      btn.style.borderRadius = "4px";
      btn.style.padding = "4px 8px";
      btn.style.fontSize = "11px";
      btn.style.cursor = "pointer";
      btn.style.background = isActive ? "#007bff" : "#f8f9fa";
      btn.style.color = isActive ? "#fff" : "#333";
    }

    let refreshPresetButtons = function () {
      Object.keys(buttons).forEach(k => {
        stylePresetButton(buttons[k], activeScale.key === k);
      });

      // Data button disabled if no computed preset
      if (buttons.DATA) {
        const ready = (SCALE_PRESETS.DATA && typeof SCALE_PRESETS.DATA.colorMax === "number");
        buttons.DATA.disabled = !ready;
        buttons.DATA.title = ready ? "" : "Not enough data to compute a scale";
        buttons.DATA.style.opacity = ready ? "1" : "0.5";
        buttons.DATA.style.cursor = ready ? "pointer" : "not-allowed";
      }
    };

    [
      { key: "WHO", label: "WHO" },
      { key: "EU", label: "EU" },
      { key: "DATA", label: "Data" }
    ].forEach(p => {
      const b = L.DomUtil.create("button", "", btnRow);
      b.type = "button";
      b.textContent = p.label;
      buttons[p.key] = b;

      b.addEventListener("click", () => {
        // Ignore DATA if not ready
        if (p.key === "DATA" && (!SCALE_PRESETS.DATA || SCALE_PRESETS.DATA.colorMax == null)) return;

        setScalePreset(p.key);
        refreshPresetButtons();
        updateMarkers();
      });
    });

    // Small hint (optional)
    const hint = L.DomUtil.create("div", "", menu);
    hint.style.marginTop = "6px";
    hint.style.fontSize = "10px";
    hint.style.color = "#666";
    hint.textContent = `Active: ${activeScale.label} (max red ≈ ${activeScale.colorMax}${VALUE_SUFFIX})`;

    function refreshHint() {
      hint.textContent = `Active: ${activeScale.label} (max red ≈ ${activeScale.colorMax}${VALUE_SUFFIX})`;
    }

    // Keep hint in sync whenever we refresh button styles
    const _refresh = refreshPresetButtons;
    refreshPresetButtons = function () {
      _refresh();
      refreshHint();
    };

    // init styles
    refreshPresetButtons();

    button.addEventListener("click", () => {
      menu.classList.toggle("open");
      // When opening, recompute visuals (in case DATA computed later)
      if (menu.classList.contains("open")) refreshPresetButtons();
    });

    // close on click outside
    document.addEventListener("click", e => {
      if (!container.contains(e.target)) {
        menu.classList.remove("open");
      }
    });

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  };

  return menuControl;
}

// UI control (bottom-left) with year buttons + month slider
function createUiControl(years) {
  const control = L.control({ position: "bottomleft" });

  control.onAdd = function () {
    const container = L.DomUtil.create("div", "map-ui");

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    // ---- Year buttons ----
    const yearTitle = L.DomUtil.create("div", "", container);
    yearTitle.textContent = "Year";

    const yearButtonsContainer = L.DomUtil.create("div", "", container);
    yearButtonsContainer.style.display = "flex";
    yearButtonsContainer.style.flexWrap = "wrap";
    yearButtonsContainer.style.gap = "4px";
    yearButtonsContainer.style.marginBottom = "6px";
    yearButtonsContainer.style.marginTop = "4px";

    years.forEach(year => {
      const btn = L.DomUtil.create("button", "", yearButtonsContainer);
      btn.textContent = year;
      btn.dataset.year = String(year);
      btn.style.border = "1px solid #ccc";
      btn.style.borderRadius = "3px";
      btn.style.padding = "2px 6px";
      btn.style.cursor = "pointer";
      btn.style.background = (year === selectedYear) ? "#007bff" : "#f8f9fa";
      btn.style.color = (year === selectedYear) ? "#fff" : "#333";
      btn.style.fontSize = "11px";

      btn.addEventListener("click", () => {
        selectedYear = year;

        yearButtonsContainer.querySelectorAll("button").forEach(b => {
          const isActive = Number(b.dataset.year) === selectedYear;
          b.style.background = isActive ? "#007bff" : "#f8f9fa";
          b.style.color = isActive ? "#fff" : "#333";
        });

        updateMonthSliderForYear(selectedYear);
        updateMarkers();
      });
    });

    // ---- Month slider ----
    const monthContainer = L.DomUtil.create("div", "", container);
    monthContainer.style.marginTop = "6px";

    const label = L.DomUtil.create("label", "", monthContainer);
    label.setAttribute("for", "slider");
    label.textContent = "Month: ";

    const monthNameSpan = L.DomUtil.create("span", "", label);
    monthNameSpan.id = "slider-label";
    monthNameSpan.style.fontWeight = "600";
    monthNameSpan.textContent = MONTH_NAMES[0];

    monthLabelEl = monthNameSpan;

    const slider = L.DomUtil.create("input", "", monthContainer);
    slider.type = "range";
    slider.id = "slider";
    slider.min = "0";
    slider.max = "11";
    slider.step = "1";
    slider.value = "0";
    slider.style.width = "100%";
    slider.style.marginTop = "4px";

    monthSlider = slider;

    slider.addEventListener("input", () => {
      updateMonthLabel();
      updateMarkers();
    });

    return container;
  };

  return control;
}

function updateMonthLabel() {
  if (!monthSlider || !monthLabelEl) return;

  if (!activeMonths || activeMonths.length === 0) {
    monthLabelEl.textContent = "No data";
    return;
  }

  const idx = Number(monthSlider.value); // index in activeMonths
  const monthIndex = activeMonths[idx];  // echte maand 0–11
  monthLabelEl.textContent = MONTH_NAMES[monthIndex];
}

// Draw markers for selected year + month
function updateMarkers() {
  if (!map || !allPoints || !selectedYear) return;
  if (!monthSlider) return;
  if (!activeMonths || activeMonths.length === 0) return;

  const sliderIdx = Number(monthSlider.value); // 0..activeMonths.length-1
  const monthIndex = activeMonths[sliderIdx];  // 0–11

  if (!markersLayer) {
    markersLayer = L.layerGroup().addTo(map);
  } else {
    markersLayer.clearLayers();
  }

  allPoints.forEach(point => {
    if (!point || !point.coordinates) return;

    const lat = point.coordinates.lat;
    const lon = point.coordinates.lon;

    if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon)) {
      return;
    }

    const title = point.location || point.description || "Measurement point";
    const description = point.description || "";

    const measurement = (point.measurements || []).find(m => {
      if (!m.date) return false;
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return false;
      return d.getFullYear() === selectedYear && d.getMonth() === monthIndex;
    });

    // No measurement record for this month/year → no marker
    if (!measurement) return;

    const isNo = !!measurement.noMeasurement;

    // marker color
    let color = "rgb(160,160,160)"; // default grey (no measurement)
    let value = null;

    if (!isNo) {
      value = measurement.value;

      // Skip invalid values
      if (typeof value !== "number" || Number.isNaN(value)) return;

      color = getColor(normalizeForColor(value));
    }

    const icon = L.divIcon({
      className: "custom-marker",
      html: `<div style="
          width: 20px;
          height: 20px;
          background:${color};
          border-radius: 50%;
          border: 2px solid #FFFFFF;
          box-shadow: 0 0 4px #00000099;
      "></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    L.marker([lat, lon], { icon })
      .addTo(markersLayer)
      .bindPopup(() => {
        const dateStr = new Date(measurement.date).toISOString().slice(0, 10);

        // All measurements in the selected year (keep noMeasurement too, for chips)
        const yearMeasurements = (point.measurements || [])
          .filter(m => {
            if (!m.date) return false;
            const d = new Date(m.date);
            return !Number.isNaN(d.getTime()) && d.getFullYear() === selectedYear;
          })
          .sort((a, b) => new Date(a.date) - new Date(b.date));

        // Category text
        const category = isNo ? "No measurement possible" : getCategory(value);

        // ----- Mini line chart (SVG) -----
        // Dots for >= 1 numeric value; lines only where months are consecutive.
        const numericYearMeasurements = yearMeasurements
          .filter(m => !m.noMeasurement && typeof m.value === "number" && !Number.isNaN(m.value));

        let sparklineSvg = "";
        if (numericYearMeasurements.length >= 1) {
          const sorted = [...numericYearMeasurements].sort((a, b) => new Date(a.date) - new Date(b.date));

          const vals = sorted.map(m => m.value);
          const max = Math.max(...vals);
          const min = Math.min(...vals);

          // Virtual size; SVG scales to container width via viewBox + width=100%
          const w = 200;
          const h = 80;

          const padding = 10;
          const paddingRight = padding;
          const paddingBottom = padding + 8;
          const paddingTop = padding;

          // Labels (used to size left room)
          const minLabel = min.toFixed(2);
          const maxLabel = max.toFixed(2);
          const labelChars = Math.max(minLabel.length, maxLabel.length);
          const yLabelRoom = Math.max(28, labelChars * 6); // ~6px per char safety
          const paddingLeft = padding + yLabelRoom; // keep 10px padding + label room

          const innerW = w - paddingLeft - paddingRight;
          const innerH = h - paddingTop - paddingBottom;

          const yForValue = (v) => {
            const t = (max === min) ? 0.5 : (v - min) / (max - min); // 0–1
            return paddingTop + (innerH - t * innerH);
          };

          const xForMonth = (mIdx) => {
            // Spread across Jan..Dec. Missing months become gaps.
            return paddingLeft + (mIdx / 11) * innerW;
          };

          const positions = sorted.map((m) => {
            const d = new Date(m.date);
            const mIdx = d.getMonth(); // 0–11
            const monthShort = d.toLocaleString("en-US", { month: "short" });
            return { x: xForMonth(mIdx), y: yForValue(m.value), monthShort, value: m.value, monthIndex: mIdx };
          });

          const xAxisEnd = paddingLeft + innerW;

          // Gradient stops based on x-position
          const stops = positions.map((p) => {
            const offset = innerW ? ((p.x - paddingLeft) / innerW) * 100 : 0;
            const c = getColor(normalizeForColor(p.value));
            return `<stop offset="${offset}%" stop-color="${c}" />`;
          }).join("");

          // Split into segments when there is a gap of >= 2 months
          const segments = [];
          let current = [positions[0]];

          for (let i = 1; i < positions.length; i++) {
            const prev = positions[i - 1];
            const cur = positions[i];
            const gap = cur.monthIndex - prev.monthIndex;

            if (gap > 1) {
              segments.push(current);
              current = [cur];
            } else {
              current.push(cur);
            }
          }
          segments.push(current);

          // Polylines only for segments with 2+ points
          const polylines = segments
            .filter(seg => seg.length >= 2)
            .map(seg => {
              const pointsAttr = seg.map(p => `${p.x},${p.y}`).join(" ");
              return `<polyline points="${pointsAttr}" fill="none" stroke="url(#gradLine)" stroke-width="2" />`;
            })
            .join("");

          // Dots for every measurement (also single isolated months)
          const circles = positions.map(p => {
            const dotColor = getColor(normalizeForColor(p.value));
            return `<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="${dotColor}" stroke="#ffffff" stroke-width="1" />`;
          }).join("");

          // Labels/ticks
          const firstPos = positions[0];
          const lastPos = positions[positions.length - 1];

          sparklineSvg = `
            <svg width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="overflow: visible;">
              <defs>
                <linearGradient id="gradLine" x1="${paddingLeft}" y1="0" x2="${xAxisEnd}" y2="0" gradientUnits="userSpaceOnUse">
                  ${stops}
                </linearGradient>
              </defs>

              <!-- Y-axis -->
              <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + innerH}" stroke="#cccccc" stroke-width="1" />

              <!-- X-axis -->
              <line x1="${paddingLeft}" y1="${paddingTop + innerH}" x2="${xAxisEnd}" y2="${paddingTop + innerH}" stroke="#cccccc" stroke-width="1" />

              <!-- Mid tick on Y-axis -->
              <line x1="${paddingLeft - 3}" y1="${paddingTop + innerH / 2}" x2="${paddingLeft}" y2="${paddingTop + innerH / 2}" stroke="#cccccc" stroke-width="1" />

              <!-- Y-axis max/min labels -->
              <text x="${paddingLeft - 4}" y="${paddingTop + 8}" font-size="8" text-anchor="end">${maxLabel}</text>
              <text x="${paddingLeft - 4}" y="${paddingTop + innerH - 2}" font-size="8" text-anchor="end">${minLabel}</text>

              <!-- X-axis ticks -->
              <line x1="${firstPos.x}" y1="${paddingTop + innerH}" x2="${firstPos.x}" y2="${paddingTop + innerH + 5}" stroke="#888888" stroke-width="1" />
              <line x1="${lastPos.x}"  y1="${paddingTop + innerH}" x2="${lastPos.x}"  y2="${paddingTop + innerH + 5}" stroke="#888888" stroke-width="1" />

              <!-- X-axis labels -->
              <text x="${firstPos.x}" y="${h - 2}" font-size="8" text-anchor="middle">${firstPos.monthShort}</text>
              <text x="${Math.min(lastPos.x, w - 8)}" y="${h - 2}" font-size="8" text-anchor="middle">${lastPos.monthShort}</text>

              <!-- Segmented data lines -->
              ${polylines}

              <!-- Dots -->
              ${circles}
            </svg>
          `;
        } else {
          sparklineSvg = `<span style="font-size:10px; color:#888;">Not enough numeric data for graph</span>`;
        }

        // Month chips (include noMeasurement as n/a)
        const chipsHtml =
          yearMeasurements.length
            ? yearMeasurements.map(m => {
              const d = new Date(m.date);
              const monthName = d.toLocaleString("en-US", { month: "short" });
              const mIdx = d.getMonth(); // 0–11

              const isSelectedMonth = mIdx === monthIndex;

              const borderColor = isSelectedMonth ? "#000000" : "#e0e0e0";
              const fontWeight = isSelectedMonth ? "600" : "400";

              const isNoChip = !!m.noMeasurement || typeof m.value !== "number" || Number.isNaN(m.value);
              const chipColor = isNoChip ? "rgb(200,200,200)" : getColor(normalizeForColor(m.value));
              const chipText = isNoChip ? `${monthName}: n/a` : `${monthName}: ${m.value.toFixed(2)}${VALUE_SUFFIX}`;

              return `
                <span style="
                  background:${chipColor};
                  border-radius:999px;
                  padding:2px 6px;
                  font-size:10px;
                  border:2px solid ${borderColor};
                  font-weight:${fontWeight};
                  color:#000000;
                ">
                  ${chipText}
                </span>`;
            }).join("")
            : '<span style="font-size:10px; color:#888;">No data for this year</span>';

        const valueBlock = isNo
          ? `
            <div style="font-size: 10px; text-transform: uppercase; color:#888;">Value</div>
            <div style="
              display: inline-block;
              padding: 2px 8px;
              border-radius: 999px;
              border: 1px solid rgba(0,0,0,0.15);
              background: rgb(200,200,200);
              font-weight: 600;
            ">
              n/a
            </div>
          `
          : `
            <div style="font-size: 10px; text-transform: uppercase; color:#888;">Value</div>
            <div style="
              display: inline-block;
              padding: 2px 8px;
              border-radius: 999px;
              border: 1px solid rgba(0,0,0,0.15);
              background: ${color};
              font-weight: 600;
            ">
              ${value.toFixed(2)}${VALUE_SUFFIX}
            </div>
          `;

        return `
          <div style="font-family: Arial, sans-serif; font-size: 12px; max-width: 300px;">
            <h4 style="margin: 0 0 4px; font-size: 14px;">
              ${title}
            </h4>

            ${description ? `<div style="font-size: 11px; color:#666; margin-bottom: 6px;">${description}</div>` : ""}

            <div style="display: flex; gap: 10px; margin-bottom: 6px;">
              <div style="flex: 1;">
                ${valueBlock}
              </div>
              <div style="flex: 1;">
                <div style="font-size: 10px; text-transform: uppercase; color:#888;">Month</div>
                <div>${dateStr}</div>
              </div>
            </div>

            <div style="font-size: 11px; color:#555; margin-bottom: 6px;">
              <span style="font-size:10px; text-transform:uppercase; color:#888;">${activeScale.label} context</span><br>
              <strong>${category}</strong>
            </div>

            <div style="margin-bottom: 6px;">
              <div style="font-size:10px; text-transform:uppercase; color:#888; margin-bottom:4px;">
                Monthly values in ${selectedYear}
              </div>
              <div style="margin-bottom:4px;">
                ${sparklineSvg}
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:4px;">
                ${chipsHtml}
              </div>
            </div>

            <div style="font-size: 10px; color:#666; display:flex; justify-content:space-between;">
              <span>Lat: ${lat.toFixed(4)}</span>
              <span>Lon: ${lon.toFixed(4)}</span>
            </div>
          </div>
        `;
      }, {
        // ✅ FIX: popups in high z-index pane (above +/- buttons)
        pane: POPUP_PANE_TOP,

        // ✅ FIX: all measurement popups same width
        minWidth: 320,
        maxWidth: 320,

        autoPanPadding: [10, 10]
      });
  });
}

// ------------ INIT: map + boot data (NO FETCH) ------------

(function initFromBootData() {
  const bootEl = document.getElementById("boot-data");
  const boot = bootEl ? JSON.parse(bootEl.textContent) : { keuzes: {}, points: [] };

  const keuzes = boot.keuzes || {};
  const pointsRaw = Array.isArray(boot.points) ? boot.points : [];

  // coords from keuzes (your current structure)
  const coords = Array.isArray(keuzes.Coordinaten) ? keuzes.Coordinaten : null;

  // Create map with safe defaults if coords missing
  const startCoords = (coords && coords.length === 2) ? coords : [0, 0];
  const startZoom = 13;

  map = L.map("map").setView(startCoords, startZoom);

  // Hide all Leaflet UI controls when a popup opens (top + bottom controls)
  function setUiHidden(hidden) {
    const root = map.getContainer();

    // Hide ALL Leaflet controls (zoom, your menu control, bottom-left UI control, etc.)
    root.querySelectorAll(".leaflet-control-container .leaflet-control").forEach(el => {
      el.style.display = hidden ? "none" : "";
    });

    // Safety: if your menu is not inside leaflet-control (rare), also hide it
    root.querySelectorAll(".menu-control").forEach(el => {
      el.style.display = hidden ? "none" : "";
    });
  }

  map.on("popupopen", () => setUiHidden(true));
  map.on("popupclose", () => setUiHidden(false));

  // ✅ FIX: create popup pane ABOVE Leaflet controls
  map.createPane(POPUP_PANE_TOP);
  map.getPane(POPUP_PANE_TOP).style.zIndex = "5000";

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17
  }).addTo(map);

  // Points: keep only those that won't crash later
  allPoints = pointsRaw.filter(p => {
    const lat = p?.coordinates?.lat;
    const lon = p?.coordinates?.lon;
    return (typeof lat === "number" && !Number.isNaN(lat) && typeof lon === "number" && !Number.isNaN(lon));
  });

  // Compute DATA preset from your actual monthly measurement values
  const dataScale = computeDataScaleFromPoints(allPoints);
  if (dataScale) {
    SCALE_PRESETS.DATA = dataScale;
  }

  // Apply stored preset (if any) now that DATA may be available
  applyStoredScalePreset();

  const years = extractAvailableYears(allPoints);
  availableMonthsByYear = buildAvailableMonthsByYear(allPoints);

  if (years.length === 0) {
    console.warn("No years found in measurement data");
    const loginControl = createUiLogin();
    loginControl.addTo(map);
    updateMarkers();
    return;
  }

  selectedYear = years[years.length - 1];

  const uiControl = createUiControl(years);
  uiControl.addTo(map);

  const loginControl = createUiLogin();
  loginControl.addTo(map);

  // slider exists, so this works
  updateMonthSliderForYear(selectedYear);

  updateMarkers();
})();
