// public/js/map.js
let map;
let markersLayer;

let allPoints = [];
let selectedYear = null;
let selectedMonthIndex = null; // 0-11

let availableMonthsByYear = {};

let monthButtons = [];
let yearDisplayEl = null;
let yearInputEl = null;
let yearPrevBtn = null;
let yearNextBtn = null;
let summaryTextEl = null;

let legendEls = null;

// Mongo export / API responses can include dates as ISO strings, Date objects,
// or extended JSON like { "$date": "..." }.
function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object") {
    const v = value.$date ?? value["$date"];
    if (v) {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April",
  "May", "June", "July", "August",
  "September", "October", "November", "December"
];

const POPUP_PANE_TOP = "popupTop";
const VALUE_SUFFIX = " µg/m³";

const SCALE_PRESETS = {
  WHO:  { key: "WHO",  label: "WHO",  annual: 10,  high: 25,  colorMax: 50 },
  EU:   { key: "EU",   label: "EU",   annual: 40,  high: 60,  colorMax: 80 },
  DATA: { key: "DATA", label: "Data", annual: null, high: null, colorMax: null }
};

const SCALE_STORAGE_KEY = "no2ScalePreset";
let activeScale = { ...SCALE_PRESETS.WHO };

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function normalizeForColor(value) {
  const max = (typeof activeScale.colorMax === "number" && activeScale.colorMax > 0)
    ? activeScale.colorMax
    : 50;
  return clamp01(value / max);
}

function getColor(m) {
  if (m <= 0.5) {
    const t = m / 0.5;
    const r = Math.round(t * 255);
    return `rgb(${r},255,0)`;
  }
  const t = (m - 0.5) / 0.5;
  const g = Math.round(255 - t * 255);
  return `rgb(255,${g},0)`;
}

function getCategory(value) {
  const a = activeScale.annual;
  const h = activeScale.high;

  if (typeof a !== "number" || typeof h !== "number") return "Value context unavailable";
  if (value <= a) return `≤ ${a}${VALUE_SUFFIX}`;
  if (value <= h) return `> ${a}${VALUE_SUFFIX} and ≤ ${h}${VALUE_SUFFIX}`;
  return `> ${h}${VALUE_SUFFIX}`;
}

// Level meta for popup badge/table (based on activeScale)
function getLevelMeta(value, isNoMeasurement) {
  if (isNoMeasurement || typeof value !== "number" || Number.isNaN(value)) {
    return {
      label: "n/a",
      badgeBg: "#E5E7EB",
      badgeText: "#334155",
      accent: "#94A3B8"
    };
  }

  const a = activeScale?.annual;
  const h = activeScale?.high;

  // If we can't classify, still show something nice
  if (typeof a !== "number" || typeof h !== "number") {
    return {
      label: "Measured",
      badgeBg: "#E0F2FE",
      badgeText: "#075985",
      accent: "#0284C7"
    };
  }

  const highUpper = h + (h - a);

  if (value <= a) {
    return { label: "Low", badgeBg: "#DCFCE7", badgeText: "#166534", accent: "#22C55E" };
  }
  if (value <= h) {
    return { label: "Medium", badgeBg: "#FEF9C3", badgeText: "#854D0E", accent: "#EAB308" };
  }
  if (value <= highUpper) {
    return { label: "High", badgeBg: "#FFEDD5", badgeText: "#9A3412", accent: "#F97316" };
  }
  return { label: "Very high", badgeBg: "#FEE2E2", badgeText: "#991B1B", accent: "#EF4444" };
}

function setScalePreset(key) {
  const preset = SCALE_PRESETS[key];
  if (!preset) return;
  if (preset.key === "DATA" && (preset.colorMax == null || preset.annual == null || preset.high == null)) return;

  activeScale = { ...preset };
  try { localStorage.setItem(SCALE_STORAGE_KEY, activeScale.key); } catch (_) {}
}

function applyStoredScalePreset() {
  try {
    const stored = localStorage.getItem(SCALE_STORAGE_KEY);
    if (stored && SCALE_PRESETS[stored]) setScalePreset(stored);
  } catch (_) {}
}

function extractAvailableYears(points) {
  const years = new Set();
  points.forEach(point => {
    (point?.measurements || []).forEach(m => {
      if (!m?.date) return;
      const d = toJsDate(m.date);
      if (!d) return;
      years.add(d.getFullYear());
    });
  });
  return Array.from(years).sort((a, b) => a - b);
}

function buildAvailableMonthsByYear(points) {
  const tmp = {};
  points.forEach(point => {
    (point?.measurements || []).forEach(m => {
      if (!m?.date) return;
      const d = toJsDate(m.date);
      if (!d) return;
      const y = d.getFullYear();
      const mo = d.getMonth();
      if (!tmp[y]) tmp[y] = new Set();
      tmp[y].add(mo);
    });
  });

  const out = {};
  Object.keys(tmp).forEach(y => {
    out[y] = Array.from(tmp[y]).sort((a, b) => a - b);
  });
  return out;
}

function percentile(sortedArr, p) {
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
    (pt?.measurements || []).forEach(m => {
      if (!m || m.noMeasurement) return;
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

/* Legend (labels depend on active scale) */
function formatLegendLabels() {
  const a = activeScale?.annual;
  const h = activeScale?.high;

  if (typeof a !== "number" || typeof h !== "number") {
    return {
      low: "—",
      medium: "—",
      high: "—",
      veryHigh: "—",
      note: "* Based on monthly average (NO₂, µg/m³)"
    };
  }

  const highUpper = h + (h - a);
  const r = (x) => (Math.round(x * 10) / 10).toString();

  return {
    low: `≤ ${r(a)}`,
    medium: `> ${r(a)} – ≤ ${r(h)}`,
    high: `> ${r(h)} – ≤ ${r(highUpper)}`,
    veryHigh: `> ${r(highUpper)}`,
    note: "* Based on monthly average (NO₂, µg/m³)"
  };
}

function updateLegend() {
  if (!legendEls) return;
  const labels = formatLegendLabels();
  legendEls.low.text.textContent = labels.low;
  legendEls.med.text.textContent = labels.medium;
  legendEls.high.text.textContent = labels.high;
  legendEls.vhi.text.textContent = labels.veryHigh;
  legendEls.note.textContent = labels.note;
}

function createLegendControl() {
  const control = L.control({ position: "topleft" });

  control.onAdd = function () {
    const container = L.DomUtil.create("div", "legend-control");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const summaryBtn = L.DomUtil.create("button", "legend-summary-btn", container);
    summaryBtn.type = "button";

    const title = L.DomUtil.create("span", "legend-summary-text", summaryBtn);
    title.textContent = "Legend";

    const icon = L.DomUtil.create("span", "legend-summary-icon", summaryBtn);
    icon.innerHTML = "&#x25BE;";

    const panel = L.DomUtil.create("div", "legend-panel", container);
    const items = L.DomUtil.create("div", "legend-items", panel);

    function item(color) {
      const row = L.DomUtil.create("div", "legend-item", items);
      const dot = L.DomUtil.create("span", "legend-dot", row);
      dot.style.background = color;
      const text = L.DomUtil.create("span", "legend-text", row);
      return { row, dot, text };
    }

    const low = item("rgb(0,255,0)");
    const med = item("rgb(255,255,0)");
    const high = item("rgb(255,165,0)");
    const vhi = item("rgb(255,0,0)");
    const note = L.DomUtil.create("div", "legend-note", panel);

    legendEls = { low, med, high, vhi, note };

    const setOpen = (open) => {
      container.classList.toggle("is-open", open);
      panel.style.display = open ? "block" : "none";
    };

    summaryBtn.addEventListener("click", () => {
      setOpen(!container.classList.contains("is-open"));
    });

    map.on("click", () => setOpen(false));

    updateLegend();
    setOpen(false);

    return container;
  };

  return control;
}

/* Month/Year control */
function isValidYear(year, years) {
  return years.includes(year);
}

function clampYearToAvailable(year, years) {
  if (!years.length) return null;
  if (isValidYear(year, years)) return year;

  let nearest = years[0];
  let bestDist = Math.abs(year - nearest);
  for (const y of years) {
    const d = Math.abs(year - y);
    if (d < bestDist) {
      bestDist = d;
      nearest = y;
    }
  }
  return nearest;
}

function getDefaultMonthForYear(year) {
  const months = availableMonthsByYear[year] || [];
  if (!months.length) return null;

  const now = new Date();
  const curMonth = now.getMonth();
  if (year === now.getFullYear() && months.includes(curMonth)) return curMonth;
  return months[months.length - 1];
}

function refreshYearNav(years) {
  if (!yearPrevBtn || !yearNextBtn) return;

  const idx = years.indexOf(selectedYear);
  const prevDisabled = idx <= 0;
  const nextDisabled = idx < 0 || idx >= years.length - 1;

  yearPrevBtn.disabled = prevDisabled;
  yearNextBtn.disabled = nextDisabled;

  const setTip = (el, disabled, msg) => {
    if (!el) return;
    if (disabled) {
      el.setAttribute("data-tooltip", msg);
      el.setAttribute("aria-label", msg);
      el.setAttribute("title", msg);
    } else {
      el.removeAttribute("data-tooltip");
      el.removeAttribute("aria-label");
      el.removeAttribute("title");
    }
  };

  setTip(yearPrevBtn, prevDisabled, "No earlier year available");
  setTip(yearNextBtn, nextDisabled, "No later year available");
}

function refreshMonthButtons() {
  if (!monthButtons?.length) return;

  const months = availableMonthsByYear[selectedYear] || [];
  monthButtons.forEach((btn, monthIdx) => {
    const enabled = months.includes(monthIdx);
    btn.disabled = !enabled;
    btn.classList.toggle("is-disabled", !enabled);

    if (!enabled) {
      const msg = "No data available for this month";
      btn.setAttribute("data-tooltip", msg);
      btn.setAttribute("aria-label", msg);
      btn.setAttribute("title", msg);
    } else {
      btn.removeAttribute("data-tooltip");
      btn.removeAttribute("aria-label");
      btn.removeAttribute("title");
    }
  });
}

function highlightSelectedMonth() {
  if (!monthButtons?.length) return;
  monthButtons.forEach((btn, i) => btn.classList.toggle("is-active", selectedMonthIndex === i));
}

function updateSummaryDisplay() {
  if (!summaryTextEl) return;
  const monthShort = (selectedMonthIndex != null) ? MONTH_NAMES[selectedMonthIndex].slice(0, 3) : "";
  summaryTextEl.textContent = monthShort ? `${monthShort} ${selectedYear}` : String(selectedYear);
}

function setSelectedYear(year, years, { preserveMonth = true } = {}) {
  if (!years.length) return;

  const clampedYear = clampYearToAvailable(year, years);
  if (clampedYear == null) return;

  selectedYear = clampedYear;
  if (yearDisplayEl) yearDisplayEl.textContent = String(selectedYear);

  refreshYearNav(years);
  refreshMonthButtons();

  const months = availableMonthsByYear[selectedYear] || [];
  if (!months.length) {
    selectedMonthIndex = null;
  } else if (preserveMonth && selectedMonthIndex != null && months.includes(selectedMonthIndex)) {
    // keep
  } else {
    selectedMonthIndex = getDefaultMonthForYear(selectedYear);
  }

  highlightSelectedMonth();
  updateSummaryDisplay();
  updateMarkers();
}

function tryCommitYearInput(years) {
  if (!yearInputEl) return;

  const raw = yearInputEl.value.trim();
  const n = Number(raw);
  if (!raw || Number.isNaN(n)) {
    yearInputEl.value = String(selectedYear);
    return;
  }

  const y = Math.trunc(n);
  if (!isValidYear(y, years)) {
    yearInputEl.classList.add("is-invalid");
    setTimeout(() => {
      if (!yearInputEl) return;
      yearInputEl.classList.remove("is-invalid");
      yearInputEl.value = String(selectedYear);
    }, 600);
    return;
  }

  yearInputEl.classList.remove("is-invalid");
  setSelectedYear(y, years, { preserveMonth: false });
}

function enterYearEditMode(years) {
  if (!yearDisplayEl || !yearInputEl) return;

  yearDisplayEl.style.display = "none";
  yearInputEl.style.display = "inline-block";
  yearInputEl.value = String(selectedYear);
  yearInputEl.focus();
  yearInputEl.select();

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryCommitYearInput(years);
      exitYearEditMode();
    } else if (e.key === "Escape") {
      e.preventDefault();
      yearInputEl.value = String(selectedYear);
      exitYearEditMode();
    }
  };

  const onBlur = () => {
    tryCommitYearInput(years);
    exitYearEditMode();
  };

  yearInputEl.addEventListener("keydown", onKey, { once: false });
  yearInputEl.addEventListener("blur", onBlur, { once: true });
  yearInputEl._onKey = onKey;
}

function exitYearEditMode() {
  if (!yearDisplayEl || !yearInputEl) return;

  yearDisplayEl.style.display = "inline-block";
  yearInputEl.style.display = "none";

  if (yearInputEl._onKey) {
    yearInputEl.removeEventListener("keydown", yearInputEl._onKey);
    delete yearInputEl._onKey;
  }
}

function createUiControl(years) {
  const control = L.control({ position: "topright" });

  control.onAdd = function () {
    const container = L.DomUtil.create("div", "month-year-control");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const summaryBtn = L.DomUtil.create("button", "myc-summary-btn", container);
    summaryBtn.type = "button";
    summaryBtn.title = "Choose month and year";

    const summaryText = L.DomUtil.create("span", "myc-summary-text", summaryBtn);
    summaryTextEl = summaryText;

    const summaryIcon = L.DomUtil.create("span", "myc-summary-icon", summaryBtn);
    summaryIcon.innerHTML = "&#x25BE;";

    const panel = L.DomUtil.create("div", "myc-panel", container);

    const yearRow = L.DomUtil.create("div", "myc-year-row", panel);

    const prevBtn = L.DomUtil.create("button", "myc-year-nav", yearRow);
    prevBtn.type = "button";
    prevBtn.innerHTML = "&#x2039;";
    yearPrevBtn = prevBtn;

    const yearCenter = L.DomUtil.create("div", "myc-year-center", yearRow);

    const yearDisplay = L.DomUtil.create("button", "myc-year-display", yearCenter);
    yearDisplay.type = "button";
    yearDisplay.title = "Click to type a year";
    yearDisplayEl = yearDisplay;

    const yearInput = L.DomUtil.create("input", "myc-year-input", yearCenter);
    yearInput.type = "number";
    yearInput.inputMode = "numeric";
    yearInput.min = String(years[0]);
    yearInput.max = String(years[years.length - 1]);
    yearInput.style.display = "none";
    yearInputEl = yearInput;

    const nextBtn = L.DomUtil.create("button", "myc-year-nav", yearRow);
    nextBtn.type = "button";
    nextBtn.innerHTML = "&#x203A;";
    yearNextBtn = nextBtn;

    prevBtn.addEventListener("click", () => {
      const idx = years.indexOf(selectedYear);
      if (idx > 0) setSelectedYear(years[idx - 1], years);
    });

    nextBtn.addEventListener("click", () => {
      const idx = years.indexOf(selectedYear);
      if (idx >= 0 && idx < years.length - 1) setSelectedYear(years[idx + 1], years);
    });

    yearDisplay.addEventListener("click", () => enterYearEditMode(years));

    const monthsGrid = L.DomUtil.create("div", "myc-month-grid", panel);
    monthButtons = [];

    MONTH_NAMES.forEach((name, idx) => {
      const btn = L.DomUtil.create("button", "myc-month-btn", monthsGrid);
      btn.type = "button";
      btn.textContent = name.slice(0, 3);
      btn.dataset.month = String(idx);

      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        selectedMonthIndex = idx;
        highlightSelectedMonth();
        updateSummaryDisplay();
        updateMarkers();
      });

      monthButtons.push(btn);
    });

    const setOpen = (open) => {
      container.classList.toggle("is-open", open);
      panel.style.display = open ? "block" : "none";
    };

    summaryBtn.addEventListener("click", () => {
      setOpen(!container.classList.contains("is-open"));
    });

    map.on("click", () => setOpen(false));

    yearDisplay.textContent = String(selectedYear);
    refreshYearNav(years);
    refreshMonthButtons();
    highlightSelectedMonth();
    updateSummaryDisplay();
    setOpen(false);

    return container;
  };

  return control;
}

/* Scale control */
function createScaleControl() {
  const control = L.control({ position: "bottomright" });

  control.onAdd = function () {
    const container = L.DomUtil.create("div", "scale-control");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const buttons = {};

    function refresh() {
      Object.keys(buttons).forEach(key => {
        buttons[key].classList.toggle("is-active", activeScale?.key === key);
      });

      if (buttons.DATA) {
        const ready = SCALE_PRESETS.DATA && typeof SCALE_PRESETS.DATA.colorMax === "number";
        buttons.DATA.disabled = !ready;
        buttons.DATA.title = ready ? "" : "Not enough data to compute a scale";
      }
    }

    [
      { key: "WHO", label: "WHO" },
      { key: "EU", label: "EU" },
      { key: "DATA", label: "Data" }
    ].forEach(preset => {
      const btn = L.DomUtil.create("button", "", container);
      btn.type = "button";
      btn.textContent = preset.label;
      btn.dataset.preset = preset.key;
      buttons[preset.key] = btn;

      btn.addEventListener("click", () => {
        if (preset.key === "DATA" && (!SCALE_PRESETS.DATA || SCALE_PRESETS.DATA.colorMax == null)) return;
        setScalePreset(preset.key);
        refresh();
        updateLegend();
        updateMarkers();
      });
    });

    refresh();
    return container;
  };

  return control;
}

/* Markers */
function createMarkerIcon(color) {
  return L.divIcon({
    // Leaflet disables pointer-events on marker icons unless they are marked
    // as interactive. In some setups `DivIcon` doesn't always receive the
    // `leaflet-interactive` class automatically, so we include it explicitly.
    className: "custom-marker leaflet-interactive",
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
}

function findMeasurement(point, year, monthIndex) {
  return (point.measurements || []).find(m => {
    if (!m?.date) return false;
    const d = toJsDate(m.date);
    if (!d) return false;
    return d.getFullYear() === year && d.getMonth() === monthIndex;
  });
}

/* Popup sparkline + popup HTML (legacy helpers, no longer used for marker popup) */
function buildSparklineSvg(monthValues) {
  // monthValues: length 12 array of numbers or null
  const w = 280;
  const h = 56;
  const pad = 6;

  const vals = monthValues.filter(v => typeof v === "number" && !Number.isNaN(v));
  if (!vals.length) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="No data" role="img">
      <text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#666">No yearly data</text>
    </svg>`;
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(0.0001, max - min);

  const xStep = (w - pad * 2) / 11;
  const toY = (v) => {
    const t = (v - min) / range;
    return (h - pad) - t * (h - pad * 2);
  };

  const points = monthValues.map((v, i) => {
    const x = pad + i * xStep;
    const y = (typeof v === "number" && !Number.isNaN(v)) ? toY(v) : null;
    return { x, y };
  });

  // Build a polyline with gaps: split into segments where y != null
  const segments = [];
  let cur = [];
  for (const p of points) {
    if (p.y == null) {
      if (cur.length >= 2) segments.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length >= 2) segments.push(cur);

  const segmentEls = segments.map(seg => {
    const pts = seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="#0b3d4d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
  }).join("");

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Year trend">
    <rect x="0" y="0" width="${w}" height="${h}" rx="10" ry="10" fill="#f4f6f8" />
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#d0d6dc" stroke-width="1" />
    ${segmentEls}
  </svg>`;
}

function buildPopupHtml(point, measurement, monthIndex) {
  const location = point?.location || point?.name || `Point ${point?.point_number ?? ""}`.trim();
  const city = point?.city ? `, ${point.city}` : "";

  const monthName = MONTH_NAMES[monthIndex] || "";
  const year = selectedYear;

  const isNo = !!measurement?.noMeasurement;
  const value = (!isNo && typeof measurement?.value === "number" && !Number.isNaN(measurement.value))
    ? measurement.value
    : null;

  const category = value != null ? getCategory(value) : "No measurement";

  // Collect values for the selected year (12 months)
  const monthValues = new Array(12).fill(null);
  (point?.measurements || []).forEach(m => {
    const d = toJsDate(m?.date);
    if (!d) return;
    if (d.getFullYear() !== year) return;
    const mo = d.getMonth();
    if (typeof m.value === "number" && !Number.isNaN(m.value)) monthValues[mo] = m.value;
  });

  const spark = buildSparklineSvg(monthValues);

  const valueHtml = (value == null)
    ? `<span class="popup-value popup-value--na">—</span>`
    : `<span class="popup-value">${value.toFixed(2)}${VALUE_SUFFIX}</span>`;

  return `
    <div class="popup">
      <div class="popup-header">
        <div class="popup-title">${escapeHtml(location)}${escapeHtml(city)}</div>
        <div class="popup-sub">${escapeHtml(monthName)} ${escapeHtml(String(year))}</div>
      </div>

      <div class="popup-metric">
        ${valueHtml}
        <div class="popup-category">${escapeHtml(category)}</div>
      </div>

      <div class="popup-spark">
        ${spark}
      </div>

      ${point?.description ? `<div class="popup-desc">${escapeHtml(point.description)}</div>` : ""}
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* Popup slider (controls + dots + swipe)
   - Works with Leaflet popup re-renders by using global event delegation.
   - Supports swipe/drag horizontally on touch, pen and mouse.
   Contract expected in popup HTML:
     [data-slider-root] wrapper
       [data-slide] (one per slide)
       [data-prev], [data-next] buttons
       [data-dot] buttons (optional)
*/
const PopupSlider = (() => {
  const ROOT_SEL = "[data-slider-root]";
  const SLIDE_SEL = "[data-slide]";
  const DOT_SEL = "[data-dot]";
  const PREV_SEL = "[data-prev]";
  const NEXT_SEL = "[data-next]";

  let globalBound = false;
  let observer = null;

  function stopEvent(e) {
    if (!e) return;
    // Prevent Leaflet from treating UI clicks as map clicks (which can close the popup)
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  }

  // Robust closest that tolerates Text nodes and older WebViews.
  function matches(el, sel) {
    const p = Element.prototype;
    const fn = p.matches || p.msMatchesSelector || p.webkitMatchesSelector;
    return !!(el && el.nodeType === 1 && fn && fn.call(el, sel));
  }
  function closest(node, sel) {
    let el = node;
    if (!el) return null;
    // Text node -> element parent
    if (el.nodeType === 3) el = el.parentElement;
    while (el && el.nodeType === 1) {
      if (matches(el, sel)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function getState(root) {
    const slides = Array.from(root.querySelectorAll(SLIDE_SEL));
    const dots = Array.from(root.querySelectorAll(DOT_SEL));
    const prev = root.querySelector(PREV_SEL);
    const next = root.querySelector(NEXT_SEL);
    return { slides, dots, prev, next };
  }

  function clamp(i, min, max) {
    return Math.max(min, Math.min(max, i));
  }

  function apply(root, nextIdx) {
    const { slides, dots, prev, next } = getState(root);
    if (!slides.length) return;

    const max = slides.length - 1;
    const idx = clamp(nextIdx, 0, max);

    root.setAttribute("data-active", String(idx));

    slides.forEach((s, k) => {
      // Keep it simple and deterministic: only the active slide is visible.
      s.style.display = (k === idx) ? "block" : "none";
    });

    dots.forEach((d, k) => {
      const active = k === idx;
      d.setAttribute("aria-pressed", active ? "true" : "false");
      // If you use inline styling, we leave it; CSS can key off [data-active] as well.
    });

    if (prev) {
      prev.disabled = idx === 0;
      prev.setAttribute("aria-disabled", prev.disabled ? "true" : "false");
    }
    if (next) {
      next.disabled = idx === max;
      next.setAttribute("aria-disabled", next.disabled ? "true" : "false");
    }
  }

  function bump(root, delta) {
    const current = Number(root.getAttribute("data-active")) || 0;
    apply(root, current + delta);
  }

  function gotoDot(root, dotEl) {
    const { dots } = getState(root);
    const idx = dots.indexOf(dotEl);
    if (idx >= 0) apply(root, idx);
  }

  function prepareRoot(root) {
    if (!root || root.dataset.sliderPrepared === "1") return;
    root.dataset.sliderPrepared = "1";

    // Make Leaflet ignore interactions inside the popup UI.
    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(root);
      L.DomEvent.disableScrollPropagation(root);
    }

    const idx = Number(root.getAttribute("data-active")) || 0;
    apply(root, idx);
  }

  function preparePopup(popupEl) {
    if (!popupEl) return;

    // Extra safety: Leaflet closes popups on map "preclick" which can be triggered
    // by mousedown/pointerdown bubbling from inside the popup. Disabling click
    // propagation on the whole popup prevents that.
    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(popupEl);
      L.DomEvent.disableScrollPropagation(popupEl);
    }

    popupEl.querySelectorAll(ROOT_SEL).forEach(prepareRoot);
  }

  // ----- Global (delegated) controls -----
  function onClickLike(e) {
    const prev = closest(e.target, PREV_SEL);
    const next = closest(e.target, NEXT_SEL);
    const dot = closest(e.target, DOT_SEL);
    if (!prev && !next && !dot) return;

    const root = closest(e.target, ROOT_SEL) || closest((prev || next || dot), ROOT_SEL);
    if (!root) return;

    prepareRoot(root);

    stopEvent(e);

    if (prev) bump(root, -1);
    else if (next) bump(root, +1);
    else if (dot) gotoDot(root, dot);
  }

  // ----- Swipe/drag -----
  const swipe = {
    active: false,
    root: null,
    id: null,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    moved: false,
    lock: null // "h" | "v" | null
  };

  function resetSwipe() {
    swipe.active = false;
    swipe.root = null;
    swipe.id = null;
    swipe.x0 = swipe.y0 = swipe.x1 = swipe.y1 = 0;
    swipe.moved = false;
    swipe.lock = null;
  }

  function onPointerDown(e) {
    // Only start swipe inside a slider root, but ignore presses on controls
    const root = closest(e.target, ROOT_SEL);
    if (!root) return;

    // Clicking controls should NEVER bubble to the map (Leaflet may close popup on "preclick")
    if (closest(e.target, PREV_SEL) || closest(e.target, NEXT_SEL) || closest(e.target, DOT_SEL)) {
      prepareRoot(root);
      stopEvent(e);
      return;
    }

    prepareRoot(root);

    swipe.active = true;
    swipe.root = root;
    swipe.id = e.pointerId;
    swipe.x0 = swipe.x1 = e.clientX;
    swipe.y0 = swipe.y1 = e.clientY;
    swipe.moved = false;
    swipe.lock = null;

    try { root.setPointerCapture(e.pointerId); } catch (_) {}
  }

  // Leaflet's popup closing is often triggered by a map-level "preclick" derived from
  // mousedown/touchstart. Some environments still fire those events even when Pointer
  // Events are supported. So we defensively stop them for slider UI.
  function onMouseDown(e) {
    const root = closest(e.target, ROOT_SEL);
    if (!root) return;
    prepareRoot(root);
    stopEvent(e);
  }

  function onTouchStart(e) {
    const root = closest(e.target, ROOT_SEL);
    if (!root) return;
    prepareRoot(root);
    stopEvent(e);
  }

  function onPointerMove(e) {
    if (!swipe.active || e.pointerId !== swipe.id || !swipe.root) return;

    swipe.x1 = e.clientX;
    swipe.y1 = e.clientY;

    const dx = swipe.x1 - swipe.x0;
    const dy = swipe.y1 - swipe.y0;

    if (!swipe.lock) {
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (adx < 6 && ady < 6) return; // tiny jitter
      swipe.lock = (adx >= ady) ? "h" : "v";
    }

    if (swipe.lock === "h") {
      swipe.moved = true;
      // Prevent page scroll / Leaflet drag while swiping horizontally
      stopEvent(e);
    }
  }

  function onPointerUp(e) {
    if (!swipe.active || e.pointerId !== swipe.id || !swipe.root) return;

    const dx = swipe.x1 - swipe.x0;
    const dy = swipe.y1 - swipe.y0;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    const SWIPE_THRESHOLD = 45; // px
    const H_DOMINANCE = 1.2;    // must be clearly more horizontal than vertical

    if (swipe.lock === "h" && absX >= SWIPE_THRESHOLD && absX >= absY * H_DOMINANCE) {
      // dx < 0 => swipe left => next
      bump(swipe.root, dx < 0 ? +1 : -1);
      stopEvent(e);
    }

    resetSwipe();
  }

  function bindGlobal() {
    if (globalBound) return;
    globalBound = true;

    // capture = true helps when Leaflet or other handlers stop propagation
    document.addEventListener("click", onClickLike, true);
    document.addEventListener("pointerup", onClickLike, true);

    document.addEventListener("pointerdown", onPointerDown, true);
    // Some browsers still emit mousedown/touchstart that Leaflet uses for "preclick"
    // even when pointer events are present.
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);

    // Optional: watch for popups inserted without a popupopen hook
    if (window.MutationObserver) {
      observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const n of m.addedNodes || []) {
            if (!n || n.nodeType !== 1) continue;
            if (n.matches && n.matches(".leaflet-popup")) preparePopup(n);
            if (n.querySelectorAll) {
              const popups = n.querySelectorAll(".leaflet-popup");
              popups.forEach(preparePopup);
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  return { bindGlobal, preparePopup };
})();

function updateMarkers() {
  if (!map || !allPoints?.length || !selectedYear) return;
  if (selectedMonthIndex == null) return;

  const months = availableMonthsByYear[selectedYear] || [];
  if (!months.includes(selectedMonthIndex)) return;

  const monthIndex = selectedMonthIndex;

  if (!markersLayer) markersLayer = L.layerGroup().addTo(map);
  else markersLayer.clearLayers();

  allPoints.forEach(point => {
    const lat = point?.coordinates?.lat;
    const lon = point?.coordinates?.lon;
    if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon)) return;

    const measurement = findMeasurement(point, selectedYear, monthIndex);
    if (!measurement) return;

    const isNo = !!measurement.noMeasurement;
    let color = "rgb(160,160,160)";

    if (!isNo) {
      const value = measurement.value;
      if (typeof value !== "number" || Number.isNaN(value)) return;
      color = getColor(normalizeForColor(value));
    }

    const icon = createMarkerIcon(color);

    const marker = L.marker([lat, lon], {
      icon,
      interactive: true,
      keyboard: false,
      // Don't bubble the click to the map; avoids any map-level click handlers
      // accidentally interfering with marker interaction.
      bubblingMouseEvents: false
    })
      .addTo(markersLayer)
      .bindPopup(() => {
        // --- Basic info ---
        const titleRaw = point.location || point.name || point.description || "Measurement point";
        const descriptionRaw = point.description || "";
        const title = escapeHtml(titleRaw);
        const description = escapeHtml(descriptionRaw);

        const isNo = !!measurement?.noMeasurement;
        const value = measurement?.value;

        const monthName = MONTH_NAMES[monthIndex] || "";
        const measuredMonth = `${monthName} ${selectedYear}`;

        // Safe date string (keep your working fix)
        const dateStr = (() => {
          const d = new Date(measurement?.date);
          return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(0, 10);
        })();

        // Collect all measurements in the selected year (sorted by date)
        const yearMeasurements = (point.measurements || [])
          .filter(m => {
            if (!m?.date) return false;
            const d = new Date(m.date);
            return !Number.isNaN(d.getTime()) && d.getFullYear() === selectedYear;
          })
          .sort((a, b) => new Date(a.date) - new Date(b.date));

        // --- Keep your existing chart EXACTLY (sparklineSvg) ---
        let sparklineSvg = `<div style="font-size:10px; color:#888;">Not enough data</div>`;

        // Build a full year series (in display order) but allow nulls for gaps
        const series = (point.measurements || [])
          .filter(m => {
            if (!m?.date) return false;
            const d = new Date(m.date);
            return !Number.isNaN(d.getTime()) && d.getFullYear() === selectedYear;
          })
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .map(m => {
            const d = new Date(m.date);
            const v = (typeof m.value === "number" && !Number.isNaN(m.value)) ? m.value : null;
            return {
              date: d,
              monthShort: d.toLocaleString("en-US", { month: "short" }),
              value: v
            };
          });

        const numericVals = series.filter(p => p.value !== null).map(p => p.value);

        if (numericVals.length >= 2) {
          // Match your target look: full width SVG with axes + labels, taller chart
          const vbW = 200;
          const vbH = 80;

          // Axis + padding like your example
          const x0 = 40;          // left padding for Y axis labels
          const x1 = 190;         // right end of chart
          const yTop = 10;
          const yBottom = 62;

          const innerW = x1 - x0;
          const innerH = yBottom - yTop;

          const minV = Math.min(...numericVals);
          const maxV = Math.max(...numericVals);
          const range = (maxV - minV) || 1;

          // Map series points to x/y; null stays null so we can split segments
          const pts = series.map((p, i) => {
            const x = x0 + (i / (series.length - 1)) * innerW;
            if (p.value === null) return { ...p, x, y: null };
            const y = yTop + (1 - ((p.value - minV) / range)) * innerH;
            return { ...p, x, y };
          });

          // Gradient stops based on available numeric points (spread over x)
          const gradStops = pts
            .filter(p => p.value !== null)
            .map(p => {
              const offset = ((p.x - x0) / innerW) * 100;
              const c = getColor(normalizeForColor(p.value));
              return `<stop offset="${offset}%" stop-color="${c}"></stop>`;
            })
            .join("");

          // Build segmented polylines (break on nulls)
          const segments = [];
          let current = [];
          for (const p of pts) {
            if (p.value === null) {
              if (current.length > 1) segments.push(current);
              current = [];
            } else {
              current.push(p);
            }
          }
          if (current.length > 1) segments.push(current);

          const polylines = segments
            .map(seg => `
              <polyline
                points="${seg.map(p => `${p.x},${p.y}`).join(" ")}"
                fill="none"
                stroke="url(#gradLine)"
                stroke-width="2"
              ></polyline>
            `)
            .join("");

          // Dots (only numeric points)
          const dots = pts
            .filter(p => p.value !== null)
            .map(p => {
              const c = getColor(normalizeForColor(p.value));
              return `<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="${c}" stroke="#ffffff" stroke-width="1"></circle>`;
            })
            .join("");

          // X-axis ticks + labels: first and last *available* month
          const available = pts.filter(p => p.value !== null);
          const first = available[0];
          const last = available[available.length - 1];

          const xTicks = `
            <line x1="${first.x}" y1="${yBottom}" x2="${first.x}" y2="${yBottom + 5}" stroke="#888888" stroke-width="1"></line>
            <line x1="${last.x}" y1="${yBottom}" x2="${last.x}" y2="${yBottom + 5}" stroke="#888888" stroke-width="1"></line>
          `;

          const xLabels = `
            <text x="${first.x}" y="${vbH - 2}" font-size="8" text-anchor="middle">${first.monthShort}</text>
            <text x="${last.x}" y="${vbH - 2}" font-size="8" text-anchor="middle">${last.monthShort}</text>
          `;

          const maxLabel = (Math.round(maxV * 100) / 100).toFixed(2);
          const minLabel = (Math.round(minV * 100) / 100).toFixed(2);

          sparklineSvg = `
            <svg width="100%" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="none" style="overflow: visible;">
              <defs>
                <linearGradient id="gradLine" x1="${x0}" y1="0" x2="${x1}" y2="0" gradientUnits="userSpaceOnUse">
                  ${gradStops}
                </linearGradient>
              </defs>

              <line x1="${x0}" y1="${yTop}" x2="${x0}" y2="${yBottom}" stroke="#cccccc" stroke-width="1"></line>
              <line x1="${x0}" y1="${yBottom}" x2="${x1}" y2="${yBottom}" stroke="#cccccc" stroke-width="1"></line>
              <line x1="${x0 - 3}" y1="${yTop + innerH / 2}" x2="${x0}" y2="${yTop + innerH / 2}" stroke="#cccccc" stroke-width="1"></line>

              <text x="${x0 - 4}" y="${yTop + 8}" font-size="8" text-anchor="end">${maxLabel}</text>
              <text x="${x0 - 4}" y="${yBottom - 2}" font-size="8" text-anchor="end">${minLabel}</text>

              ${xTicks}
              ${xLabels}

              ${polylines}
              ${dots}
            </svg>
          `;
        }

        // --- Popup card values ---
        const valueNum = (!isNo && typeof value === "number" && !Number.isNaN(value)) ? value : null;
        const level = getLevelMeta(valueNum, isNo);

        const valueText = isNo
          ? "n/a"
          : (valueNum != null ? `${valueNum.toFixed(0)}${VALUE_SUFFIX}` : "—");

        const whoGuideline = (activeScale?.key === "WHO")
          ? "&lt; 10 µg/m³"
          : (typeof activeScale?.annual === "number" ? `&lt; ${activeScale.annual}${VALUE_SUFFIX}` : "—");

        const contextText = (valueNum != null) ? escapeHtml(getCategory(valueNum)) : "—";

        // Table rows like screenshot
        const tableRowsHtml = (yearMeasurements || []).map(m => {
          const md = new Date(m.date);
          const monthLabel = Number.isNaN(md.getTime())
            ? "—"
            : `${md.toLocaleString("en-US", { month: "short" })} ${md.getFullYear()}`;

          const v = (!m.noMeasurement && typeof m.value === "number" && !Number.isNaN(m.value)) ? m.value : null;
          const rowLevel = getLevelMeta(v, !!m.noMeasurement || v == null);

          const vCell = (v == null) ? "n/a" : `${v.toFixed(0)}`;
          return `
            <tr style="border-top: 1px solid #EEF2F7;">
              <td style="padding: 6px 10px; font-size: 11px; color:#334155;">${escapeHtml(monthLabel)}</td>
              <td style="padding: 6px 10px; font-size: 11px; color:#0F172A; text-align:right;">${escapeHtml(vCell)}</td>
              <td style="padding: 6px 10px; font-size: 11px; text-align:right;">
                <span style="color:${rowLevel.accent}; font-weight:700;">${escapeHtml(rowLevel.label)}</span>
              </td>
            </tr>
          `;
        }).join("");

        const latStr = (typeof point.coordinates?.lat === "number") ? point.coordinates.lat.toFixed(4) : "—";
        const lonStr = (typeof point.coordinates?.lon === "number") ? point.coordinates.lon.toFixed(4) : "—";

        // --- NEW popup layout (like your screenshot) ---
        return `
          <div style="
            font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
            color:#0F172A;
          ">
            <!-- Header -->
            <div style="margin-bottom: 8px;">
              <div style="font-size: 18px; font-weight: 800; color:#0F4C81; line-height:1.2;">
                ${title}
              </div>
              ${descriptionRaw ? `<div style="margin-top: 4px; font-size: 12px; color:#0B3B63;">${description}</div>` : ""}
            </div>

            <!-- Slider controls -->
            <div data-slider-root data-active="0" tabindex="0" style="
              border: 1px solid #E6EEF6;
              border-radius: 12px;
              background:#fff;
              overflow: hidden;
            ">
              <div style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                padding: 8px 10px;
                border-bottom: 1px solid #E6EEF6;
                background:#F8FAFC;
              ">
                <button data-prev type="button" style="
                  border: 1px solid #E6EEF6; background:#fff; border-radius: 10px;
                  padding: 4px 8px; font-weight:700; cursor:pointer;
                " aria-label="Previous slide">‹</button>

                <div style="display:flex; gap:6px; align-items:center;">
                  <button data-dot type="button" style="width:8px;height:8px;border-radius:99px;border:0;background:#94A3B8;cursor:pointer;" aria-label="Slide 1"></button>
                  <button data-dot type="button" style="width:8px;height:8px;border-radius:99px;border:0;background:#94A3B8;cursor:pointer;" aria-label="Slide 2"></button>
                  <button data-dot type="button" style="width:8px;height:8px;border-radius:99px;border:0;background:#94A3B8;cursor:pointer;" aria-label="Slide 3"></button>
                </div>

                <button data-next type="button" style="
                  border: 1px solid #E6EEF6; background:#fff; border-radius: 10px;
                  padding: 4px 8px; font-weight:700; cursor:pointer;
                " aria-label="Next slide">›</button>
              </div>

              <!-- Slide 1: INFO -->
              <div data-slide style="display:block; padding: 12px;">
                <div style="display:flex; gap:18px; padding-bottom: 10px; border-bottom: 1px solid #E6EEF6; margin-bottom: 10px;">
                  <div style="flex:1;">
                    <div style="font-size: 11px; letter-spacing:.04em; color:#0B3B63; text-transform: uppercase;">MEASURED MONTH</div>
                    <div style="margin-top: 3px; font-weight: 800; color:#0F4C81;">${escapeHtml(measuredMonth)}</div>
                  </div>
                  <div style="flex:1;">
                    <div style="font-size: 11px; letter-spacing:.04em; color:#0B3B63; text-transform: uppercase;">FREQUENCY</div>
                    <div style="margin-top: 3px; font-weight: 800; color:#0F4C81;">Monthly</div>
                  </div>
                </div>

                <div style="
                  border: 1px solid #E6EEF6;
                  border-radius: 12px;
                  padding: 12px;
                  box-shadow: 0 1px 0 rgba(15, 23, 42, .04);
                  background: #FFFFFF;
                ">
                  <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
                    <div style="font-size: 11px; color:#64748B;">Measured using passive diffusion tubes</div>
                    <span style="
                      padding: 3px 10px;
                      border-radius: 999px;
                      font-size: 11px;
                      font-weight: 800;
                      background: ${level.badgeBg};
                      color: ${level.badgeText};
                      border: 1px solid rgba(15, 23, 42, .10);
                    ">${escapeHtml(level.label)}</span>
                  </div>

                  <div style="display:flex; align-items:flex-end; justify-content:space-between; gap: 12px;">
                    <div>
                      <div style="font-size: 11px; color:#64748B; margin-bottom: 2px;">NO₂</div>
                      <div style="font-size: 22px; font-weight: 900; color:#0F172A; line-height:1;">
                        ${escapeHtml(valueText)}
                      </div>
                      <div style="margin-top: 6px; font-size: 10px; color:#64748B;">*Based on monthly average NO₂</div>
                      <div style="margin-top: 8px; font-size: 11px; color:#0B3B63;">
                        <span style="font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:#94A3B8;">WHO context</span><br>
                        <strong>${contextText}</strong>
                      </div>
                    </div>

                    <div style="text-align:right;">
                      <div style="font-size: 10px; color:#64748B;">WHO guideline (annual):</div>
                      <div style="font-size: 11px; color:#334155; font-weight:800;">${whoGuideline}</div>
                      <div style="margin-top: 10px; font-size: 11px; font-weight:800; color:#0F4C81;">
                        Higher than recommended for long-term health
                      </div>
                    </div>
                  </div>

                  <div style="margin-top: 10px; font-size: 11px; color:#64748B;">Date: ${escapeHtml(dateStr)}</div>
                </div>
              </div>

              <!-- Slide 2: GRAPH -->
              <div data-slide style="display:none; padding: 12px;">
                <div style="font-size: 12px; letter-spacing:.06em; color:#0B3B63; text-transform: uppercase; margin: 2px 0 10px; font-weight:900;">
                  MONTHLY VALUES ${escapeHtml(String(selectedYear))}
                </div>
                <div>${sparklineSvg}</div>
              </div>

              <!-- Slide 3: TABLE -->
              <div data-slide style="display:none; padding: 12px;">
                <div style="font-size: 12px; letter-spacing:.06em; color:#0B3B63; text-transform: uppercase; margin: 2px 0 10px; font-weight:900;">
                  TABLE ${escapeHtml(String(selectedYear))}
                </div>

                <div style="
                  border: 1px solid #E6EEF6;
                  border-radius: 12px;
                  overflow: hidden;
                  background:#FFFFFF;
                ">
                  <table style="width:100%; border-collapse: collapse;">
                    <thead>
                      <tr style="background:#F8FAFC;">
                        <th style="text-align:left; padding: 8px 10px; font-size: 11px; color:#0F4C81;">Month</th>
                        <th style="text-align:right; padding: 8px 10px; font-size: 11px; color:#0F4C81;">NO₂ (µg/m³)</th>
                        <th style="text-align:right; padding: 8px 10px; font-size: 11px; color:#0F4C81;">Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${tableRowsHtml || `<tr><td colspan="3" style="padding:10px; font-size:11px; color:#64748B;">No data</td></tr>`}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div style="font-size: 10px; color:#64748B; display:flex; justify-content:space-between; margin-top: 10px;">
              <span>Lat: ${escapeHtml(latStr)}</span>
              <span>Lon: ${escapeHtml(lonStr)}</span>
            </div>

            <style>
              /* dots active state (scoped by attribute selector, safe in popup) */
              [data-slider-root][data-active="0"] [data-dot]:nth-child(1),
              [data-slider-root][data-active="1"] [data-dot]:nth-child(2),
              [data-slider-root][data-active="2"] [data-dot]:nth-child(3) {
                background:#0F4C81 !important;
              }
            </style>
          </div>
        `;
      }, {
        pane: POPUP_PANE_TOP,
        minWidth: 320,
        maxWidth: 320,
        autoPanPadding: [10, 10]
      });

    // Extra safety: ensure click always opens popup.
    marker.on("click", () => marker.openPopup());
  });
}

/* Map init + boot */
function initMap(startCoords, startZoom) {
  map = L.map("map", { zoomControl: false }).setView(startCoords, startZoom);
  window.map = map;

  L.control.zoom({ position: "bottomleft" }).addTo(map);

  map.createPane(POPUP_PANE_TOP);
  map.getPane(POPUP_PANE_TOP).style.zIndex = "5000";

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 17 }).addTo(map);

  PopupSlider.bindGlobal();

  map.on("popupopen", (e) => {
    setLeafletControlsHidden(true);
    PopupSlider.preparePopup(e.popup.getElement());
  });
  map.on("popupclose", () => setLeafletControlsHidden(false));
}

(function initFromBootData() {
  const bootEl = document.getElementById("boot-data");
  const boot = bootEl ? JSON.parse(bootEl.textContent) : { keuzes: {}, points: [] };

  const keuzes = boot.keuzes || {};
  const pointsRaw = Array.isArray(boot.points) ? boot.points : [];

  const coords = Array.isArray(keuzes.Coordinaten) ? keuzes.Coordinaten : null;
  const startCoords = (coords && coords.length === 2) ? coords : [0, 0];

  initMap(startCoords, 13);

  allPoints = pointsRaw.filter(p => {
    const lat = p?.coordinates?.lat;
    const lon = p?.coordinates?.lon;
    return (typeof lat === "number" && !Number.isNaN(lat) && typeof lon === "number" && !Number.isNaN(lon));
  });

  const dataScale = computeDataScaleFromPoints(allPoints);
  if (dataScale) SCALE_PRESETS.DATA = dataScale;

  setScalePreset("WHO");
  applyStoredScalePreset();

  const years = extractAvailableYears(allPoints);
  availableMonthsByYear = buildAvailableMonthsByYear(allPoints);

  createLegendControl().addTo(map);
  createScaleControl().addTo(map);

  if (!years.length) {
    updateMarkers();
    return;
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  selectedYear = years.includes(currentYear) ? currentYear : years[years.length - 1];
  selectedMonthIndex = getDefaultMonthForYear(selectedYear);

  createUiControl(years).addTo(map);

  updateLegend();
  updateMarkers();
})();

function setLeafletControlsHidden(hidden) {
  const container = map.getContainer();
  container
    .querySelectorAll(".leaflet-control-container .leaflet-control")
    .forEach(el => { el.style.display = hidden ? "none" : ""; });
}

function loadtable() {
  // Card-list table view (month select + sort + search)
  const bootEl = document.getElementById("boot-data");
  const boot = bootEl ? JSON.parse(bootEl.textContent) : { keuzes: {}, points: [] };

  const pointsRaw = Array.isArray(boot.points) ? boot.points : [];

  const monthSelect = document.getElementById("tableMonth");
  const sortSelect = document.getElementById("tableSort");
  const searchInput = document.getElementById("tableSearch");
  const listEl = document.getElementById("tableList");
  if (!monthSelect || !sortSelect || !searchInput || !listEl) return;

  // Build available month options across all points
  const monthSet = new Set();
  pointsRaw.forEach(pt => {
    (pt?.measurements || []).forEach(m => {
      const d = toJsDate(m?.date);
      if (!d) return;
      monthSet.add(`${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`);
    });
  });

  const monthKeys = Array.from(monthSet)
    .map(k => {
      const [y, mo] = k.split("-");
      return { y: Number(y), m: Number(mo), key: k };
    })
    .filter(x => Number.isFinite(x.y) && Number.isFinite(x.m))
    .sort((a, b) => (b.y - a.y) || (b.m - a.m));

  // Fill month dropdown
  monthSelect.innerHTML = "";
  monthKeys.forEach(({ y, m, key }) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${MONTH_NAMES[m]} ${y}`;
    monthSelect.appendChild(opt);
  });

  // Default: latest month if available
  if (monthKeys.length) monthSelect.value = monthKeys[0].key;

  function parseMonthKey(key) {
    const [y, mo] = String(key || "").split("-");
    return { year: Number(y), monthIndex: Number(mo) };
  }

  function fmtValue(v) {
    return (typeof v === "number" && !Number.isNaN(v)) ? `${v.toFixed(1)}${VALUE_SUFFIX}` : "—";
  }

  function render() {
    const { year, monthIndex } = parseMonthKey(monthSelect.value);
    const q = searchInput.value.trim().toLowerCase();
    const sortKey = sortSelect.value;

    const items = pointsRaw.map((pt) => {
      const location = pt?.location || pt?.name || pt?.description || "Unknown location";
      const city = pt?.city || pt?.area || pt?.region || "";

      const measurement = (Number.isFinite(year) && Number.isFinite(monthIndex))
        ? findMeasurement(pt, year, monthIndex)
        : null;

      const isNo = !!measurement?.noMeasurement;
      const value = (!isNo && typeof measurement?.value === "number" && !Number.isNaN(measurement.value))
        ? measurement.value
        : null;

      const meta = getLevelMeta(value, isNo);

      return {
        pt,
        location,
        city,
        year,
        monthIndex,
        value,
        level: meta.label,
        accent: meta.accent
      };
    }).filter(item => {
      if (!q) return true;
      return (
        item.location.toLowerCase().includes(q) ||
        (item.city && item.city.toLowerCase().includes(q))
      );
    });

    const valueOrNegInf = (v) => (typeof v === "number" && !Number.isNaN(v)) ? v : -Infinity;
    const valueOrPosInf = (v) => (typeof v === "number" && !Number.isNaN(v)) ? v : Infinity;

    items.sort((a, b) => {
      if (sortKey === "no2_desc") return valueOrNegInf(b.value) - valueOrNegInf(a.value);
      if (sortKey === "no2_asc") return valueOrPosInf(a.value) - valueOrPosInf(b.value);
      if (sortKey === "name_desc") return b.location.localeCompare(a.location);
      return a.location.localeCompare(b.location);
    });

    if (!items.length) {
      listEl.innerHTML = `<div style="padding:10px; color:#0b3d4d; font-weight:600;">No results</div>`;
      return;
    }

    const monthLabel = (Number.isFinite(monthIndex) && MONTH_NAMES[monthIndex]) ? MONTH_NAMES[monthIndex] : "";

    listEl.innerHTML = items.map((item, idx) => {
      const dot = item.accent || "#94A3B8";
      const levelColor = item.accent || "#334155";

      const metaLeft = item.city ? `${escapeHtml(item.city)} · ` : "";
      const metaText = `${metaLeft}${escapeHtml(monthLabel)} ${escapeHtml(String(item.year || ""))}`.trim();

      return `
        <div class="table-card" role="button" tabindex="0" data-idx="${idx}">
          <div class="table-card__title">
            <span class="table-dot" style="background:${dot}"></span>
            <span>${escapeHtml(item.location)}</span>
          </div>

          <div class="table-card__metric">
            NO₂ : <strong>${escapeHtml(fmtValue(item.value))}</strong>
            · <span class="table-level" style="color:${levelColor}">${escapeHtml(item.level)}</span>
          </div>

          <div class="table-card__meta">${metaText}</div>
        </div>
      `;
    }).join("");
  }

  monthSelect.addEventListener("change", render);
  sortSelect.addEventListener("change", render);
  searchInput.addEventListener("input", render);

  render();
}