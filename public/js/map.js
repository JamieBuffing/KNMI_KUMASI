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

/* Popup sparkline + popup HTML */
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
        // Leaflet expects popup content to be a string or a DOM Node.
        // If something inside buildPopupHtml throws, Leaflet will receive
        // `undefined` and attempt to appendChild it, causing:
        // "Failed to execute 'appendChild' on 'Node'".
        try {
          return String(buildPopupHtml(point, measurement, monthIndex));
        } catch (err) {
          console.error("Popup render error:", err);
          return "<div class=\"popup\"><strong>Popup error</strong><div style=\"margin-top:6px\">Kon details niet laden.</div></div>";
        }
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

  map.on("popupopen", () => setLeafletControlsHidden(true));
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
