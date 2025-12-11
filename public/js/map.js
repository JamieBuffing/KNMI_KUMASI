let map;
let markersLayer;
let allPoints = [];
let selectedYear = null;

let monthSlider = null;
let monthLabelEl = null;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'
];

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

function createUiLogin() {
  const login = L.control({ position: 'topright' });
  login.onAdd = function () {
    const container = L.DomUtil.create('div', 'login-control');
    const loginLink = L.DomUtil.create('a', '', container);
    loginLink.id = 'login';
    loginLink.href = '/login';
    loginLink.textContent = 'Login';
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  };

  return login;
}

// UI control (bottom-left) with year buttons + month slider
function createUiControl(years) {
  const control = L.control({ position: 'bottomleft' });

  control.onAdd = function () {
    const container = L.DomUtil.create('div', 'map-ui');

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    // ---- Year buttons ----
    const yearTitle = L.DomUtil.create('div', '', container);
    yearTitle.textContent = 'Year';

    const yearButtonsContainer = L.DomUtil.create('div', '', container);
    yearButtonsContainer.style.display = 'flex';
    yearButtonsContainer.style.flexWrap = 'wrap';
    yearButtonsContainer.style.gap = '4px';
    yearButtonsContainer.style.marginBottom = '6px';
    yearButtonsContainer.style.marginTop = '4px';

    years.forEach(year => {
      const btn = L.DomUtil.create('button', '', yearButtonsContainer);
      btn.textContent = year;
      btn.dataset.year = String(year);
      btn.style.border = '1px solid #ccc';
      btn.style.borderRadius = '3px';
      btn.style.padding = '2px 6px';
      btn.style.cursor = 'pointer';
      btn.style.background = (year === selectedYear) ? '#007bff' : '#f8f9fa';
      btn.style.color = (year === selectedYear) ? '#fff' : '#333';
      btn.style.fontSize = '11px';

      btn.addEventListener('click', () => {
        selectedYear = year;

        yearButtonsContainer.querySelectorAll('button').forEach(b => {
          const isActive = Number(b.dataset.year) === selectedYear;
          b.style.background = isActive ? '#007bff' : '#f8f9fa';
          b.style.color = isActive ? '#fff' : '#333';
        });

        updateMarkers();
      });
    });

    // ---- Month slider ----
    const monthContainer = L.DomUtil.create('div', '', container);
    monthContainer.style.marginTop = '6px';

    const label = L.DomUtil.create('label', '', monthContainer);
    label.setAttribute('for', 'slider');
    label.textContent = 'Month: ';

    const monthNameSpan = L.DomUtil.create('span', '', label);
    monthNameSpan.id = 'slider-label';
    monthNameSpan.style.fontWeight = '600';
    monthNameSpan.textContent = MONTH_NAMES[0];

    monthLabelEl = monthNameSpan;

    const slider = L.DomUtil.create('input', '', monthContainer);
    slider.type = 'range';
    slider.id = 'slider';
    slider.min = '0';
    slider.max = '11';
    slider.step = '1';
    slider.value = '0';
    slider.style.width = '100%';
    slider.style.marginTop = '4px';

    monthSlider = slider;

    slider.addEventListener('input', () => {
      updateMonthLabel();
      updateMarkers();
    });

    return container;
  };

  return control;
}

function updateMonthLabel() {
  if (!monthSlider || !monthLabelEl) return;

  const monthIndex = Number(monthSlider.value);
  monthLabelEl.textContent = MONTH_NAMES[monthIndex];
}

// Draw markers for selected year + month
function updateMarkers() {
  if (!map || !allPoints || !selectedYear) return;
  if (!monthSlider) return;

  const monthIndex = Number(monthSlider.value); // 0–11

  if (!markersLayer) {
    markersLayer = L.layerGroup().addTo(map);
  } else {
    markersLayer.clearLayers();
  }

  allPoints.forEach(point => {
    if (!point || !point.coordinates) return;

    const lat = point.coordinates.lat;
    const lon = point.coordinates.lon;
    const description = point.description;

    const measurement = (point.measurements || []).find(m => {
      if (!m.date) return false;
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return false;

      const year = d.getFullYear();
      const month = d.getMonth(); // 0–11

      return year === selectedYear && month === monthIndex;
    });

    if (!measurement) {
      // No measurement for this month/year → no marker
      return;
    }

    const value = measurement.value;
    const color = getColor(value);

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

        // All measurements in the selected year
        const yearMeasurements = (point.measurements || [])
          .filter(m => {
            const d = new Date(m.date);
            return !Number.isNaN(d.getTime()) && d.getFullYear() === selectedYear;
          })
          .sort((a, b) => new Date(a.date) - new Date(b.date));

        // Category text based on value
        const category =
          value < 0.3 ? "Low" :
          value < 0.6 ? "Moderate" :
          "High";

        // ----- Mini line chart (SVG) with gradient line, min/max labels, Y mid-tick, X ticks + first/last labels -----
        let sparklineSvg = "";
        if (yearMeasurements.length > 1) {
          const vals = yearMeasurements.map(m => m.value);
          const max = Math.max(...vals);
          const min = Math.min(...vals);

          const w = 130;
          const h = 55;
          const paddingLeft = 20;
          const paddingBottom = 14;
          const paddingRight = 10; // extra marge rechts

          const innerW = w - paddingLeft - paddingRight;
          const innerH = h - paddingBottom;

          const minLabel = min.toFixed(2);
          const maxLabel = max.toFixed(2);

          // helper om x,y voor een index/waarde te maken
          const coords = (i, v) => {
            const t = (max === min) ? 0.5 : (v - min) / (max - min); // 0–1
            const x = paddingLeft + (yearMeasurements.length === 1
              ? innerW / 2
              : (i / (yearMeasurements.length - 1)) * innerW);
            const y = innerH - t * innerH;
            return { x, y };
          };

          // posities + maandlabels
          const positions = yearMeasurements.map((m, i) => {
            const d = new Date(m.date);
            const monthShort = d.toLocaleString("en-US", { month: "short" });
            const { x, y } = coords(i, m.value);
            return { x, y, monthShort, value: m.value };
          });

          // polyline-punten
          const pointsAttr = positions.map(p => `${p.x},${p.y}`).join(" ");

          // gradient-stops langs de lijn op basis van value→color
          const stops = positions.map((p, i) => {
            const offset = (positions.length === 1)
              ? 0
              : (i / (positions.length - 1)) * 100;
            const c = getColor(p.value);
            return `<stop offset="${offset}%" stop-color="${c}" />`;
          }).join("");

          // X-as ticks (kleine streepjes) op alle maanden
          const xTicks = positions.map(p => `
            <line x1="${p.x}" y1="${innerH}" x2="${p.x}" y2="${innerH + 5}" stroke="#888888" stroke-width="1" />
          `).join("");

          // Labels voor eerste en laatste maand (iets naar binnen)
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
          sparklineSvg = `<span style="font-size:10px; color:#888;">Not enough data for graph</span>`;
        }

        // ----- Chips with monthly values (colored per value, selected month highlighted) -----
        const chipsHtml =
          yearMeasurements.length
            ? yearMeasurements.map(m => {
                const d = new Date(m.date);
                const monthName = d.toLocaleString("en-US", { month: "short" });
                const mIdx = d.getMonth(); // 0–11
                const chipColor = getColor(m.value);

                const isSelectedMonth = mIdx === monthIndex;

                const borderColor = isSelectedMonth ? "#000000" : "#e0e0e0";
                const fontWeight = isSelectedMonth ? "600" : "400";

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
                    ${monthName}: ${m.value.toFixed(2)}
                  </span>`;
              }).join("")
            : '<span style="font-size:10px; color:#888;">No data for this year</span>';

        return `
          <div style="font-family: Arial, sans-serif; font-size: 12px; max-width: 280px;">
            <h4 style="margin: 0 0 4px; font-size: 14px;">${description}</h4>

            <div style="margin-bottom: 4px; color: #555;">
              Point <strong>#${point.point_number}</strong>
            </div>

            <div style="display: flex; gap: 8px; margin-bottom: 6px;">
              <div style="flex: 1;">
                <div style="font-size: 10px; text-transform: uppercase; color:#888;">Value</div>
                <div style="
                  display: inline-block;
                  padding: 2px 8px;
                  border-radius: 999px;
                  border: 1px solid rgba(0,0,0,0.15);
                  background: ${color};
                  font-weight: 600;
                ">
                  ${value.toFixed(2)}
                </div>
              </div>
              <div style="flex: 1;">
                <div style="font-size: 10px; text-transform: uppercase; color:#888;">Date</div>
                <div>${dateStr}</div>
              </div>
            </div>

            <div style="font-size: 11px; color:#555; margin-bottom: 6px;">
              <span style="font-size:10px; text-transform:uppercase; color:#888;">Category</span><br>
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

fetch('/api/keuzes')
  .then(res => res.json())
  .then(keuzes => {
    const coords = keuzes.Coordinaten;

    map = L.map('map').setView(coords, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17
    }).addTo(map);

    // then load DB data
    return fetch('/api/data');
  })
  .then(res => res.json())
  .then(points => {
    console.log("API /data response:", points); // debug

    allPoints = points;

    const years = extractAvailableYears(points);

    if (years.length === 0) {
      console.warn('No years found in measurement data');
      return;
    }

    selectedYear = years[years.length - 1];

    const uiControl = createUiControl(years);
    uiControl.addTo(map);

    const loginControl = createUiLogin();
    loginControl.addTo(map);

    updateMonthLabel();
    updateMarkers();
  })
  .catch(err => console.error(err));
