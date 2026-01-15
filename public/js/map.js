// public/js/map.js
// Monolithic Leaflet map (no modules/imports)

// -------------------- STATE --------------------
let map;
let markersLayer;

let allPoints = [];
let selectedYear = null;

let selectedMonthIndex = null; // 0-11

// UI refs
let monthButtons = []; // 12 buttons
let yearDisplayEl = null;
let yearInputEl = null;
let yearPrevBtn = null;
let yearNextBtn = null;

let summaryBtnEl = null;
let panelEl = null;
let summaryTextEl = null;

let availableMonthsByYear = {}; // { 2025: [0,1,2], ... }

// -------------------- CONSTANTS --------------------
const MONTH_NAMES = [
  "January", "February", "March", "April",
  "May", "June", "July", "August",
  "September", "October", "November", "December"
];

const POPUP_PANE_TOP = "popupTop";

// Units (NO2)
const VALUE_SUFFIX = " µg/m³";

const SCALE_PRESETS = {
  WHO:  { key: "WHO",  label: "WHO",  annual: 10,  high: 25,  colorMax: 50 },
  EU:   { key: "EU",   label: "EU",   annual: 40,  high: 60,  colorMax: 80 },
  DATA: { key: "DATA", label: "Data", annual: null, high: null, colorMax: null }
};

const SCALE_STORAGE_KEY = "no2ScalePreset";
let activeScale = { ...SCALE_PRESETS.WHO };

// -------------------- HELPERS --------------------
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
  // m: 0..1
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

  // Ignore DATA if not ready
  if (preset.key === "DATA" && (preset.colorMax == null || preset.annual == null || preset.high == null)) return;

  activeScale = { ...preset };

  try {
    localStorage.setItem(SCALE_STORAGE_KEY, activeScale.key);
  } catch (_) {}
}

function applyStoredScalePreset() {
  try {
    const stored = localStorage.getItem(SCALE_STORAGE_KEY);
    if (stored && SCALE_PRESETS[stored]) setScalePreset(stored);
  } catch (_) {}
}

// -------------------- DATA UTILS --------------------
function extractAvailableYears(points) {
  const years = new Set();
  points.forEach(point => {
    (point?.measurements || []).forEach(m => {
      if (!m?.date) return;
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return;
      years.add(d.getFullYear());
    });
  });
  return Array.from(years).sort((a, b) => a - b);
}

function buildAvailableMonthsByYear(points) {
  const tmp = {}; // year -> Set(monthIndex)
  points.forEach(point => {
    (point?.measurements || []).forEach(m => {
      if (!m?.date) return;
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return;

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

// -------------------- UI: YEAR/MONTH --------------------
function isValidYear(year, years) {
  return years.includes(year);
}

function clampYearToAvailable(year, years) {
  if (!years.length) return null;
  if (isValidYear(year, years)) return year;
  // choose nearest year (fallback)
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

  // Prefer current month only when current year and month exists
  if (year === now.getFullYear() && months.includes(curMonth)) return curMonth;

  // Otherwise last available month
  return months[months.length - 1];
}

function refreshYearNav(years) {
  if (!yearPrevBtn || !yearNextBtn) return;
  const idx = years.indexOf(selectedYear);
  const prevDisabled = (idx <= 0);
  const nextDisabled = (idx < 0 || idx >= years.length - 1);

  yearPrevBtn.disabled = prevDisabled;
  yearNextBtn.disabled = nextDisabled;

  if (prevDisabled) {
    const msg = "No earlier year available";
    yearPrevBtn.setAttribute("data-tooltip", msg);
    yearPrevBtn.setAttribute("aria-label", msg);
    yearPrevBtn.setAttribute("title", msg);
  } else {
    yearPrevBtn.removeAttribute("data-tooltip");
    yearPrevBtn.removeAttribute("aria-label");
    yearPrevBtn.removeAttribute("title");
  }

  if (nextDisabled) {
    const msg = "No later year available";
    yearNextBtn.setAttribute("data-tooltip", msg);
    yearNextBtn.setAttribute("aria-label", msg);
    yearNextBtn.setAttribute("title", msg);
  } else {
    yearNextBtn.removeAttribute("data-tooltip");
    yearNextBtn.removeAttribute("aria-label");
    yearNextBtn.removeAttribute("title");
  }
}

function setSelectedYear(year, years, { preserveMonth = true } = {}) {
  if (!years.length) return;
  const clampedYear = clampYearToAvailable(year, years);
  if (clampedYear == null) return;

  selectedYear = clampedYear;

  if (yearDisplayEl) yearDisplayEl.textContent = String(selectedYear);

  refreshYearNav(years);
  refreshMonthButtons();

  // Month selection logic
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

function refreshMonthButtons() {
  if (!monthButtons?.length) return;
  const months = availableMonthsByYear[selectedYear] || [];
  monthButtons.forEach((btn, monthIdx) => {
    const enabled = months.includes(monthIdx);
    btn.disabled = !enabled;
    btn.classList.toggle("is-disabled", !enabled);
    if (!enabled) {
      btn.setAttribute("data-tooltip", "No data available for this month");
    } else {
      btn.removeAttribute("data-tooltip");
    }
  });
}

function highlightSelectedMonth() {
  if (!monthButtons?.length) return;
  monthButtons.forEach((btn, i) => {
    btn.classList.toggle("is-active", selectedMonthIndex === i);
  });
}

function updateSummaryDisplay() {
  if (!summaryTextEl) return;
  const monthName = (selectedMonthIndex != null) ? MONTH_NAMES[selectedMonthIndex] : "";
  summaryTextEl.textContent = monthName ? `${monthName} ${selectedYear}` : String(selectedYear);
}

// Backwards compatibility: older code may still call this after UI creation.
// It now refreshes month buttons/summary for the current selectedYear.
function updateMonthSliderForYear(year) {
  // Optional: if caller passes a year, switch to it when possible.
  // (We avoid needing the years array here; init now sets defaults correctly.)
  if (typeof year === "number" && !Number.isNaN(year) && availableMonthsByYear && Object.prototype.hasOwnProperty.call(availableMonthsByYear, year)) {
    selectedYear = year;
    if (yearDisplayEl) yearDisplayEl.textContent = String(selectedYear);
  }

  refreshMonthButtons();
  if (selectedMonthIndex == null) selectedMonthIndex = getDefaultMonthForYear(selectedYear);
  highlightSelectedMonth();
  updateSummaryDisplay();
}

function tryCommitYearInput(years) {
  if (!yearInputEl) return;
  const raw = yearInputEl.value.trim();
  const n = Number(raw);
  if (!raw || Number.isNaN(n)) {
    // revert
    yearInputEl.value = String(selectedYear);
    return;
  }

  const y = Math.trunc(n);
  if (!isValidYear(y, years)) {
    yearInputEl.classList.add("is-invalid");
    // revert after short delay (keeps feedback visible)
    setTimeout(() => {
      if (yearInputEl) {
        yearInputEl.classList.remove("is-invalid");
        yearInputEl.value = String(selectedYear);
      }
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

  // store handler to remove later
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

    // --- Collapsed summary button ---
    const summaryBtn = L.DomUtil.create("button", "myc-summary-btn", container);
    summaryBtn.type = "button";
    summaryBtn.title = "Choose month and year";

    const summaryText = L.DomUtil.create("span", "myc-summary-text", summaryBtn);
    const summaryIcon = L.DomUtil.create("span", "myc-summary-icon", summaryBtn);
    summaryIcon.innerHTML = "&#x25BE;"; // ▾

    summaryBtnEl = summaryBtn;
    summaryTextEl = summaryText;

    // --- Dropdown panel ---
    const panel = L.DomUtil.create("div", "myc-panel", container);
    panelEl = panel;

    // --- Year header ---
    const yearRow = L.DomUtil.create("div", "myc-year-row", panel);

    const prevBtn = L.DomUtil.create("button", "myc-year-nav", yearRow);
    prevBtn.type = "button";
    prevBtn.innerHTML = "&#x2039;"; // ‹
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
    nextBtn.innerHTML = "&#x203A;"; // ›
    yearNextBtn = nextBtn;

    prevBtn.addEventListener("click", () => {
      const idx = years.indexOf(selectedYear);
      if (idx > 0) setSelectedYear(years[idx - 1], years);
    });

    nextBtn.addEventListener("click", () => {
      const idx = years.indexOf(selectedYear);
      if (idx >= 0 && idx < years.length - 1) setSelectedYear(years[idx + 1], years);
    });

    yearDisplay.addEventListener("click", () => {
      enterYearEditMode(years);
    });

    // --- Month grid ---
    const monthsGrid = L.DomUtil.create("div", "myc-month-grid", panel);
    monthButtons = [];

    MONTH_NAMES.forEach((name, idx) => {
      const short = name.slice(0, 3);
      const btn = L.DomUtil.create("button", "myc-month-btn", monthsGrid);
      btn.type = "button";
      btn.textContent = short;
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

    // Toggle dropdown
    const setOpen = (open) => {
      container.classList.toggle("is-open", open);
      if (panelEl) panelEl.style.display = open ? "block" : "none";
    };

    summaryBtn.addEventListener("click", () => {
      const open = container.classList.contains("is-open");
      setOpen(!open);
    });

    // Close when clicking map
    map.on("click", () => setOpen(false));

    // Initial render
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

// -------------------- UI: SCALE CONTROL (bottom-right) --------------------
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
        updateMarkers();
      });
    });

    refresh();
    return container;
  };

  return control;
}

// -------------------- POPUP: SPARKLINE --------------------
function buildSparklineSvg(yearMeasurements) {
  const numeric = yearMeasurements
    .filter(m => !m.noMeasurement && typeof m.value === "number" && !Number.isNaN(m.value));

  if (numeric.length < 1) {
    return `<span style="font-size:10px; color:#888;">Not enough numeric data for graph</span>`;
  }

  const values = numeric.map(m => m.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const w = 280;
  const h = 60;
  const paddingLeft = 22;
  const paddingRight = 6;
  const paddingTop = 6;
  const paddingBottom = 14;

  const innerW = w - paddingLeft - paddingRight;
  const innerH = h - paddingTop - paddingBottom;

  const normalizeY = (v) => {
    if (max === min) return paddingTop + innerH / 2;
    const t = (v - min) / (max - min);
    return paddingTop + innerH - t * innerH;
  };

  // X positions for all 12 months
  const monthPositions = Array.from({ length: 12 }, (_, i) => {
    const x = paddingLeft + (i / 11) * innerW;
    const monthShort = new Date(2020, i, 1).toLocaleString("en-US", { month: "short" });
    return { i, x, monthShort };
  });

  const points = numeric.map(m => {
    const d = new Date(m.date);
    const mIdx = d.getMonth();
    const x = monthPositions[mIdx].x;
    const y = normalizeY(m.value);
    return { x, y, value: m.value, mIdx };
  });

  // polyline path
  const path = points
    .sort((a, b) => a.mIdx - b.mIdx)
    .map(p => `${p.x},${p.y}`)
    .join(" ");

  const polylines = `<polyline fill="none" stroke="#333" stroke-width="1.5" points="${path}" />`;

  const circles = points.map(p => {
    return `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#333" />`;
  }).join("");

  const minLabel = `${min.toFixed(0)}`;
  const maxLabel = `${max.toFixed(0)}`;

  const firstPos = monthPositions[0];
  const lastPos = monthPositions[11];

  return `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Monthly values sparkline">
      <rect x="0" y="0" width="${w}" height="${h}" fill="white" />

      <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + innerH}" stroke="#cccccc" stroke-width="1" />
      <line x1="${paddingLeft}" y1="${paddingTop + innerH}" x2="${paddingLeft + innerW}" y2="${paddingTop + innerH}" stroke="#cccccc" stroke-width="1" />

      <line x1="${paddingLeft - 3}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop}" stroke="#cccccc" stroke-width="1" />

      <line x1="${paddingLeft - 3}" y1="${paddingTop + innerH / 2}" x2="${paddingLeft}" y2="${paddingTop + innerH / 2}" stroke="#cccccc" stroke-width="1" />

      <text x="${paddingLeft - 4}" y="${paddingTop + 8}" font-size="8" text-anchor="end">${maxLabel}</text>
      <text x="${paddingLeft - 4}" y="${paddingTop + innerH - 2}" font-size="8" text-anchor="end">${minLabel}</text>

      <line x1="${firstPos.x}" y1="${paddingTop + innerH}" x2="${firstPos.x}" y2="${paddingTop + innerH + 5}" stroke="#888888" stroke-width="1" />
      <line x1="${lastPos.x}"  y1="${paddingTop + innerH}" x2="${lastPos.x}"  y2="${paddingTop + innerH + 5}" stroke="#888888" stroke-width="1" />

      <text x="${firstPos.x}" y="${h - 2}" font-size="8" text-anchor="middle">${firstPos.monthShort}</text>
      <text x="${Math.min(lastPos.x, w - 8)}" y="${h - 2}" font-size="8" text-anchor="middle">${lastPos.monthShort}</text>

      ${polylines}
      ${circles}
    </svg>
  `;
}

// -------------------- MARKERS + POPUPS --------------------
function createMarkerIcon(color) {
  return L.divIcon({
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
}

function findMeasurement(point, year, monthIndex) {
  return (point.measurements || []).find(m => {
    if (!m?.date) return false;
    const d = new Date(m.date);
    if (Number.isNaN(d.getTime())) return false;
    return d.getFullYear() === year && d.getMonth() === monthIndex;
  });
}

function buildPopupHtml(point, measurement, monthIndex) {
  const lat = point.coordinates.lat;
  const lon = point.coordinates.lon;

  const title = point.location || point.description || "Measurement point";
  const description = point.description || "";
  const dateStr = new Date(measurement.date).toISOString().slice(0, 10);
  const isNo = !!measurement.noMeasurement;

  const yearMeasurements = (point.measurements || [])
    .filter(m => {
      if (!m?.date) return false;
      const d = new Date(m.date);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === selectedYear;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let color = "rgb(200,200,200)";
  let value = null;

  if (!isNo) {
    value = measurement.value;
    color = getColor(normalizeForColor(value));
  }

  const category = isNo ? "No measurement possible" : getCategory(value);
  const sparklineSvg = buildSparklineSvg(yearMeasurements);

  const chipsHtml =
    yearMeasurements.length
      ? yearMeasurements.map(m => {
          const d = new Date(m.date);
          const monthName = d.toLocaleString("en-US", { month: "short" });
          const mIdx = d.getMonth();

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
            ">${chipText}</span>
          `;
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
      ">n/a</div>
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
      ">${value.toFixed(2)}${VALUE_SUFFIX}</div>
    `;

  return `
    <div style="font-family: Arial, sans-serif; font-size: 12px; max-width: 300px;">
      <h4 style="margin: 0 0 4px; font-size: 14px;">${title}</h4>

      ${description ? `<div style="font-size: 11px; color:#666; margin-bottom: 6px;">${description}</div>` : ""}

      <div style="display: flex; gap: 10px; margin-bottom: 6px;">
        <div style="flex: 1;">${valueBlock}</div>
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
        <div style="margin-bottom:4px;">${sparklineSvg}</div>
        <div style="display:flex; flex-wrap:wrap; gap:4px;">${chipsHtml}</div>
      </div>

      <div style="font-size: 10px; color:#666; display:flex; justify-content:space-between;">
        <span>Lat: ${lat.toFixed(4)}</span>
        <span>Lon: ${lon.toFixed(4)}</span>
      </div>
    </div>
  `;
}

function updateMarkers() {
  if (!map || !allPoints?.length || !selectedYear) return;
  if (selectedMonthIndex == null) return;

  const months = availableMonthsByYear[selectedYear] || [];
  if (!months.includes(selectedMonthIndex)) return;

  const monthIndex = selectedMonthIndex;

  if (!markersLayer) {
    markersLayer = L.layerGroup().addTo(map);
  } else {
    markersLayer.clearLayers();
  }

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

    L.marker([lat, lon], { icon })
      .addTo(markersLayer)
      .bindPopup(() => buildPopupHtml(point, measurement, monthIndex), {
        pane: POPUP_PANE_TOP,
        minWidth: 320,
        maxWidth: 320,
        autoPanPadding: [10, 10]
      });
  });
}

// -------------------- MAP INIT --------------------
function initMap(startCoords, startZoom) {
  // Map zonder standaard zoomcontrol
  map = L.map("map", { zoomControl: false }).setView(startCoords, startZoom);
  window.map = map;

  // Zoomknoppen linksonder
  L.control.zoom({ position: "bottomleft" }).addTo(map);

  // Popup pane boven controls
  map.createPane(POPUP_PANE_TOP);
  map.getPane(POPUP_PANE_TOP).style.zIndex = "5000";

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17
  }).addTo(map);

  // ✅ HIER: popup events koppelen
  map.on("popupopen", () => {
    setLeafletControlsHidden(true);
  });

  map.on("popupclose", () => {
    setLeafletControlsHidden(false);
  });
}

// -------------------- BOOTSTRAP (BOOT-DATA) --------------------
(function initFromBootData() {
  const bootEl = document.getElementById("boot-data");
  const boot = bootEl ? JSON.parse(bootEl.textContent) : { keuzes: {}, points: [] };

  const keuzes = boot.keuzes || {};
  const pointsRaw = Array.isArray(boot.points) ? boot.points : [];

  const coords = Array.isArray(keuzes.Coordinaten) ? keuzes.Coordinaten : null;
  const startCoords = (coords && coords.length === 2) ? coords : [0, 0];

  initMap(startCoords, 13);

  // filter safe points
  allPoints = pointsRaw.filter(p => {
    const lat = p?.coordinates?.lat;
    const lon = p?.coordinates?.lon;
    return (typeof lat === "number" && !Number.isNaN(lat) && typeof lon === "number" && !Number.isNaN(lon));
  });

  // compute DATA preset
  const dataScale = computeDataScaleFromPoints(allPoints);
  if (dataScale) SCALE_PRESETS.DATA = dataScale;

  // default + stored preset
  setScalePreset("WHO");
  applyStoredScalePreset();

  // UI controls
  const years = extractAvailableYears(allPoints);
  availableMonthsByYear = buildAvailableMonthsByYear(allPoints);

  // Scale control bottom-right
  createScaleControl().addTo(map);

  if (years.length === 0) {
    console.warn("No years found in measurement data");
    updateMarkers();
    return;
  }

  // Default year: current year if available, else last available year
  const now = new Date();
  const currentYear = now.getFullYear();
  selectedYear = years.includes(currentYear) ? currentYear : years[years.length - 1];

  // Default month: current month if available in selected year, else last available month in that year
  selectedMonthIndex = getDefaultMonthForYear(selectedYear);

  createUiControl(years).addTo(map);

  updateMarkers();
})();

function setLeafletControlsHidden(hidden) {
  const container = map.getContainer();

  // Alle Leaflet controls (zoom, scale, custom controls)
  container
    .querySelectorAll(".leaflet-control-container .leaflet-control")
    .forEach(el => {
      el.style.display = hidden ? "none" : "";
    });
}
