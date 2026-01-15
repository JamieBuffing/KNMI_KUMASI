// public/js/map.js
// Monolithic Leaflet map (no modules/imports)

// -------------------- STATE --------------------
let map;
let markersLayer;

let allPoints = [];
let selectedYear = null;

let monthSlider = null;
let monthLabelEl = null;

let availableMonthsByYear = {}; // { 2025: [0,1,2], ... }
let activeMonths = [];          // months for selectedYear

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
function updateMonthLabel() {
  if (!monthSlider || !monthLabelEl) return;

  if (!activeMonths || activeMonths.length === 0) {
    monthLabelEl.textContent = "No data";
    return;
  }

  const idx = Number(monthSlider.value);
  const monthIndex = activeMonths[idx];
  monthLabelEl.textContent = MONTH_NAMES[monthIndex];
}

function updateMonthSliderForYear(year) {
  if (!monthSlider || !monthLabelEl) return;

  activeMonths = availableMonthsByYear[year] || [];

  if (activeMonths.length === 0) {
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
  monthSlider.value = "0";
  updateMonthLabel();
}

function createUiControl(years) {
  const control = L.control({ position: "bottomleft" });

  control.onAdd = function () {
    const container = L.DomUtil.create("div", "map-ui");

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

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

  const sorted = [...numeric].sort((a, b) => new Date(a.date) - new Date(b.date));
  const vals = sorted.map(m => m.value);
  const max = Math.max(...vals);
  const min = Math.min(...vals);

  const w = 200;
  const h = 80;
  const padding = 10;
  const paddingRight = padding;
  const paddingBottom = padding + 8;
  const paddingTop = padding;

  const minLabel = min.toFixed(2);
  const maxLabel = max.toFixed(2);
  const labelChars = Math.max(minLabel.length, maxLabel.length);
  const yLabelRoom = Math.max(28, labelChars * 6);
  const paddingLeft = padding + yLabelRoom;

  const innerW = w - paddingLeft - paddingRight;
  const innerH = h - paddingTop - paddingBottom;

  const yForValue = (v) => {
    const t = (max === min) ? 0.5 : (v - min) / (max - min);
    return paddingTop + (innerH - t * innerH);
  };

  const xForMonth = (mIdx) => paddingLeft + (mIdx / 11) * innerW;

  const positions = sorted.map((m) => {
    const d = new Date(m.date);
    const mIdx = d.getMonth();
    const monthShort = d.toLocaleString("en-US", { month: "short" });
    return { x: xForMonth(mIdx), y: yForValue(m.value), monthShort, value: m.value, monthIndex: mIdx };
  });

  const xAxisEnd = paddingLeft + innerW;

  const stops = positions.map((p) => {
    const offset = innerW ? ((p.x - paddingLeft) / innerW) * 100 : 0;
    const c = getColor(normalizeForColor(p.value));
    return `<stop offset="${offset}%" stop-color="${c}" />`;
  }).join("");

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

  const polylines = segments
    .filter(seg => seg.length >= 2)
    .map(seg => {
      const pointsAttr = seg.map(p => `${p.x},${p.y}`).join(" ");
      return `<polyline points="${pointsAttr}" fill="none" stroke="url(#gradLine)" stroke-width="2" />`;
    })
    .join("");

  const circles = positions.map(p => {
    const dotColor = getColor(normalizeForColor(p.value));
    return `<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="${dotColor}" stroke="#ffffff" stroke-width="1" />`;
  }).join("");

  const firstPos = positions[0];
  const lastPos = positions[positions.length - 1];

  return `
    <svg width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="overflow: visible;">
      <defs>
        <linearGradient id="gradLine" x1="${paddingLeft}" y1="0" x2="${xAxisEnd}" y2="0" gradientUnits="userSpaceOnUse">
          ${stops}
        </linearGradient>
      </defs>

      <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + innerH}" stroke="#cccccc" stroke-width="1" />
      <line x1="${paddingLeft}" y1="${paddingTop + innerH}" x2="${xAxisEnd}" y2="${paddingTop + innerH}" stroke="#cccccc" stroke-width="1" />

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
  if (!monthSlider) return;
  if (!activeMonths || activeMonths.length === 0) return;

  const sliderIdx = Number(monthSlider.value);
  const monthIndex = activeMonths[sliderIdx];

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
  map = L.map("map").setView(startCoords, startZoom);
  window.map = map; // handy for debugging / invalidateSize

  // Create popup pane above controls
  map.createPane(POPUP_PANE_TOP);
  map.getPane(POPUP_PANE_TOP).style.zIndex = "5000";

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17
  }).addTo(map);
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

  selectedYear = years[years.length - 1];
  createUiControl(years).addTo(map);

  // slider exists after UI control
  updateMonthSliderForYear(selectedYear);

  updateMarkers();
})();
