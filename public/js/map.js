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

// ---- Units + WHO thresholds (NO2) ----
// WHO AQG 2021 for NO2: annual 10 µg/m³, 24-hour 25 µg/m³
const VALUE_SUFFIX = " µg/m³";
const WHO = {
  annual: 10,
  daily: 25
};

// How to scale colors (0..1). Everything above COLOR_MAX becomes "max red".
const COLOR_MAX = WHO.daily * 2; // adjust if you want

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function normalizeForColor(value) {
  return clamp01(value / COLOR_MAX);
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
  // Interpret as µg/m³
  if (value <= WHO.annual) return `Meets WHO annual (${WHO.annual}${VALUE_SUFFIX})`;
  if (value <= WHO.daily) return `Above annual, meets WHO 24h (${WHO.daily}${VALUE_SUFFIX})`;
  return `Above WHO 24h (${WHO.daily}${VALUE_SUFFIX})`;
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
      { href: "/login", text: "Login" },
      { href: "/data", text: "Data" }
    ];

    items.forEach(item => {
      const a = L.DomUtil.create("a", "menu-item", menu);
      a.href = item.href;
      a.textContent = item.text;
    });

    button.addEventListener("click", () => {
      menu.classList.toggle("open");
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
        // Only draw if we have at least 2 numeric values in that year
        const numericYearMeasurements = yearMeasurements
          .filter(m => !m.noMeasurement && typeof m.value === "number" && !Number.isNaN(m.value));

        let sparklineSvg = "";
        if (numericYearMeasurements.length > 1) {
          const vals = numericYearMeasurements.map(m => m.value);
          const max = Math.max(...vals);
          const min = Math.min(...vals);

          const w = 130;
          const h = 55;
          const paddingLeft = 20;
          const paddingBottom = 14;
          const paddingRight = 10;

          const innerW = w - paddingLeft - paddingRight;
          const innerH = h - paddingBottom;

          const minLabel = min.toFixed(2);
          const maxLabel = max.toFixed(2);

          const coords = (i, v) => {
            const t = (max === min) ? 0.5 : (v - min) / (max - min); // 0–1
            const x = paddingLeft + (numericYearMeasurements.length === 1
              ? innerW / 2
              : (i / (numericYearMeasurements.length - 1)) * innerW);
            const y = innerH - t * innerH;
            return { x, y };
          };

          const positions = numericYearMeasurements.map((m, i) => {
            const d = new Date(m.date);
            const monthShort = d.toLocaleString("en-US", { month: "short" });
            const { x, y } = coords(i, m.value);
            return { x, y, monthShort, value: m.value };
          });

          const pointsAttr = positions.map(p => `${p.x},${p.y}`).join(" ");

          const stops = positions.map((p, i) => {
            const offset = (positions.length === 1)
              ? 0
              : (i / (positions.length - 1)) * 100;
            const c = getColor(normalizeForColor(p.value));
            return `<stop offset="${offset}%" stop-color="${c}" />`;
          }).join("");

          const xTicks = positions.map(p => `
            <line x1="${p.x}" y1="${innerH}" x2="${p.x}" y2="${innerH + 5}" stroke="#888888" stroke-width="1" />
          `).join("");

          const firstPos = positions[0];
          const lastPos = positions[positions.length - 1];
          const firstLabelX = firstPos.x;
          const lastLabelX = Math.min(lastPos.x, w - 8);

          const xLabels = `
            <text x="${firstLabelX}" y="${h - 2}" font-size="8" text-anchor="middle">${firstPos.monthShort}</text>
            <text x="${lastLabelX}" y="${h - 2}" font-size="8" text-anchor="middle">${lastPos.monthShort}</text>
          `;

          const xAxisEnd = paddingLeft + innerW;

          sparklineSvg = `
            <svg width="${w}" height="${h}">
              <defs>
                <linearGradient id="gradLine" x1="${paddingLeft}" y1="0" x2="${xAxisEnd}" y2="0" gradientUnits="userSpaceOnUse">
                  ${stops}
                </linearGradient>
              </defs>

              <!-- Y-axis -->
              <line x1="${paddingLeft}" y1="0" x2="${paddingLeft}" y2="${innerH}" stroke="#cccccc" stroke-width="1" />
              <!-- X-axis -->
              <line x1="${paddingLeft}" y1="${innerH}" x2="${xAxisEnd}" y2="${innerH}" stroke="#cccccc" stroke-width="1" />

              <!-- Mid tick on Y-axis -->
              <line x1="${paddingLeft - 3}" y1="${innerH / 2}" x2="${paddingLeft}" y2="${innerH / 2}" stroke="#cccccc" stroke-width="1" />

              <!-- Y-axis min/max labels -->
              <text x="${paddingLeft - 4}" y="8" font-size="8" text-anchor="end">${maxLabel}</text>
              <text x="${paddingLeft - 4}" y="${innerH - 2}" font-size="8" text-anchor="end">${minLabel}</text>

              <!-- X-axis ticks & first/last month labels -->
              ${xTicks}
              ${xLabels}

              <!-- Gradient data line -->
              <polyline 
                points="${pointsAttr}"
                fill="none"
                stroke="url(#gradLine)"
                stroke-width="2"
              />
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
              <span style="font-size:10px; text-transform:uppercase; color:#888;">WHO context</span><br>
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
      });
  });
}

// ------------ INIT: map + data fetch ------------

fetch("/api/keuzes")
  .then(res => res.json())
  .then(keuzes => {
    const coords = keuzes.Coordinaten;

    map = L.map("map").setView(coords, 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 17
    }).addTo(map);

    // then load DB data
    return fetch("/api/data");
  })
  .then(res => res.json())
  .then(points => {
    console.log("API /data response:", points); // debug

    allPoints = points;

    const years = extractAvailableYears(points);
    availableMonthsByYear = buildAvailableMonthsByYear(points);

    if (years.length === 0) {
      console.warn("No years found in measurement data");
      return;
    }

    selectedYear = years[years.length - 1];

    const uiControl = createUiControl(years);
    uiControl.addTo(map);

    const loginControl = createUiLogin();
    loginControl.addTo(map);

    // ✅ now slider exists, so this works
    updateMonthSliderForYear(selectedYear);

    updateMarkers();
  })
  .catch(err => console.error(err));
