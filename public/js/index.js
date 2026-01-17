const mapButton = document.getElementById("MapButton");
const tableButton = document.getElementById("TableButton");
const tableView = document.getElementById("tableView");
const mapView = document.getElementById("mapView");
const dataRAW = document.getElementById("boot-data");
const data = dataRAW ? JSON.parse(dataRAW.textContent) : { keuzes: {}, points: [] };
console.log(data.points);

let selectedYear;
let selectedMonthIndex;

const delay = 0.5;

let scale = "WHO";
const kleuren = {
  LOW: "rgb(0, 255, 0)",
  MID: "rgb(255, 255, 0)",
  HIGH: "rgb(255, 165, 0)",
  MAX: "rgb(255, 0, 0)",
  ABSOLUTE: "rgb(0, 0, 0)",
  NOMES: "rgb(160, 160, 160)"
};

const SCALE_PRESETS = {
  WHO: { key: "WHO", label: "WHO", annual: 10, colorMax: 20 },
  EU: { key: "EU", label: "EU", annual: 40, colorMax: 80 },
  DATA: { key: "DATA", label: "Data", annual: null, colorMax: null }
};

let activeScale = { key: "WHO", label: "WHO", annual: 10, colorMax: 20 };

let legendaControl;
let legendaElements = {};

const points = Array.isArray(data.points) ? data.points : [];
const values = points.flatMap(p =>
  (Array.isArray(p?.measurements) ? p.measurements : [])
    .filter(m => typeof m?.value === "number" && !Number.isNaN(m.value))
    .map(m => m.value)
);

const maxValue = values.length ? Math.max(...values) : null;

let map;

const startCoords =
  (data.keuzes.Coordinaten && data.keuzes.Coordinaten.length === 2)
    ? data.keuzes.Coordinaten
    : [0, 0];

map = L.map("map", { zoomControl: false }).setView(startCoords, 13);
L.control.zoom({ position: "bottomleft" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 17 }).addTo(map);
const markerLayer = L.layerGroup().addTo(map);

mapButton.addEventListener("click", (d) => {
  mapButton.classList.add("active");
  tableButton.classList.remove("active");
  tableView.style.display = "none";
  mapView.style.display = "block";
});

tableButton.addEventListener("click", (d) => {
  mapButton.classList.remove("active");
  tableButton.classList.add("active");
  tableView.style.display = "block";
  mapView.style.display = "none";
});

document.addEventListener("DOMContentLoaded", () => {
  const menu = document.querySelector(".header-menu");
  if (!menu) return;

  const btn = menu.querySelector(".header-button");
  const dropdown = menu.querySelector(".header-dropdown");
  if (!btn || !dropdown) return;

  const setOpen = (open) => {
    menu.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  };

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(!menu.classList.contains("is-open"));
  });

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("is-open")) return;
    if (menu.contains(e.target)) return;
    setOpen(false);
  });

  // Close on escape
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!menu.classList.contains("is-open")) return;
    setOpen(false);
    btn.focus();
  });

  // Close after choosing a link
  dropdown.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;
    setOpen(false);
  });
});

SCALE_PRESETS.DATA.colorMax = maxValue;
SCALE_PRESETS.DATA.annual = Number((maxValue / 2).toFixed(2));

// --- kleur helpers (FIX) ---
function parseRgbString(rgb) {
  // "rgb(0, 255, 0)" -> [0,255,0]
  const nums = String(rgb).match(/\d+/g);
  if (!nums || nums.length < 3) return [0, 0, 0];
  return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getKleuren(value, maxValue) {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) {
    return kleuren.LOW;
  }

  // ✅ Extra segment: rood -> zwart tussen max en 5x max
  if (value > maxValue) {
    const tBlack = Math.min(Math.max((value - maxValue) / (maxValue * 4), 0), 1); // 0..1
    const red = parseRgbString(kleuren.MAX);      // [255,0,0]
    const black = [0, 0, 0];

    const r = Math.round(lerp(red[0], black[0], tBlack));
    const g = Math.round(lerp(red[1], black[1], tBlack));
    const b = Math.round(lerp(red[2], black[2], tBlack));

    return `rgb(${r}, ${g}, ${b})`;
  }

  // 🔻 Normale schaal 0..max: groen -> geel -> oranje -> rood
  const t = Math.min(Math.max(value / maxValue, 0), 1);

  let c1, c2, localT;

  if (t <= 0.33) {
    c1 = parseRgbString(kleuren.LOW);
    c2 = parseRgbString(kleuren.MID);
    localT = t / 0.33;
  } else if (t <= 0.66) {
    c1 = parseRgbString(kleuren.MID);
    c2 = parseRgbString(kleuren.HIGH);
    localT = (t - 0.33) / 0.33;
  } else {
    c1 = parseRgbString(kleuren.HIGH);
    c2 = parseRgbString(kleuren.MAX);
    localT = (t - 0.66) / 0.34;
  }

  const r = Math.round(lerp(c1[0], c2[0], localT));
  const g = Math.round(lerp(c1[1], c2[1], localT));
  const b = Math.round(lerp(c1[2], c2[2], localT));

  return `rgb(${r}, ${g}, ${b})`;
}

function getClass(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return { key: "NONE", label: "No data" };
  }

  // zelfde grenzen als je legenda: 0, 0.25*max, 0.5*max, 1*max, daarna "Dangerous"
  if (value <= max * 0.25) return { key: "LOW", label: "Low" };
  if (value <= max * 0.5) return { key: "MID", label: "Medium" };
  if (value <= max) return { key: "HIGH", label: "High" };
  if (value <= max * 5) return { key: "MAX", label: "Dangerous" };

  return { key: "ABSOLUTE", label: "Extreme" };
}

function monthKey(year, monthIndex) {
  return year * 12 + monthIndex; // handig voor vergelijken/sorteren
}

function formatMonthYear(year, monthIndex) {
  return `${monthNames[monthIndex]} ${year}`;
}

function getSortedMonthlyMeasurements(point) {
  const ms = Array.isArray(point?.measurements) ? point.measurements : [];

  // maak uniforme records: {year, monthIndex, dateKey, value, status}
  const rows = ms.map(m => {
    const d = new Date(m.date);
    if (Number.isNaN(d.getTime())) return null;

    const year = d.getFullYear();
    const monthIndex = d.getMonth();
    const dateKey = monthKey(year, monthIndex);

    if (typeof m.value === "number" && !Number.isNaN(m.value)) {
      return { year, monthIndex, dateKey, status: "value", value: m.value };
    }
    // noMeasurement of value ontbreekt
    return { year, monthIndex, dateKey, status: "noMeasurement", value: null };
  }).filter(Boolean);

  // sort + dedupe (laatste wint als dubbel)
  rows.sort((a, b) => a.dateKey - b.dateKey);
  const dedup = new Map();
  rows.forEach(r => dedup.set(r.dateKey, r));
  return Array.from(dedup.values()).sort((a, b) => a.dateKey - b.dateKey);
}

function findRowForMonth(rows, year, monthIndex) {
  const key = monthKey(year, monthIndex);
  return rows.find(r => r.dateKey === key) || null;
}

function buildWindowAround(rows, year, monthIndex, beforeCount = 5, afterCount = 6) {
  const key = monthKey(year, monthIndex);

  // index van selected month in rows (kan ook ontbreken)
  const idx = rows.findIndex(r => r.dateKey === key);

  if (idx === -1) {
    // als selected maand niet bestaat in de point measurements:
    // pak de eerstvolgende maand na selectie als "anchor", anders laatste ervoor
    const nextIdx = rows.findIndex(r => r.dateKey > key);
    const anchor = nextIdx !== -1 ? nextIdx : (rows.length - 1);
    const start = Math.max(0, anchor - beforeCount);
    const end = Math.min(rows.length, anchor + 1 + afterCount);
    return { windowRows: rows.slice(start, end), selectedExists: false };
  }

  const start = Math.max(0, idx - beforeCount);
  const end = Math.min(rows.length, idx + 1 + afterCount);
  return { windowRows: rows.slice(start, end), selectedExists: true };
}

function changeScale(activeButton) {
  const preset = activeButton?.dataset?.preset; // "WHO" | "EU" | "DATA"
  if (!preset || !SCALE_PRESETS[preset]) return;

  activeScale = SCALE_PRESETS[preset];
  console.log("Active scale:", activeScale);
  updateMarkers();
}

function DrawMarkers() {
  console.log(data.points);
}

function createMenu(position, html) {
  const control = L.control({ position });

  control.onAdd = function () {
    const container = L.DomUtil.create("div", "leaflet-control-custom");

    // ✅ extra id alleen voor bottomright
    if (position === "bottomright") {
      container.id = "regels";
    }

    container.innerHTML = html;
    return container;
  };

  return control;
}

function maakLegenda() {
  const max = activeScale.colorMax ?? 0;

  const legendValues = berekenLegenda(max);

  legendaControl = createMenu("topleft", `
    <div class="menu" id="legenda">
      <p>Legenda</p>

      <p>
        <span class="legendaDot" style="background-color:${kleuren.LOW}"></span>
        Low | <span id="legend-low">${legendValues.LOW}</span>
      </p>

      <p>
        <span class="legendaDot" style="background-color:${kleuren.MID}"></span>
        Medium | <span id="legend-mid">${legendValues.MID}</span>
      </p>

      <p>
        <span class="legendaDot" style="background-color:${kleuren.HIGH}"></span>
        High | <span id="legend-high">${legendValues.HIGH}</span>
      </p>

      <p>
        <span class="legendaDot" style="background-color:${kleuren.MAX}"></span>
        Dangerous | <span id="legend-max">${legendValues.MAX}</span>
      </p>
    </div>
  `);

  map.addControl(legendaControl);

  // cache DOM references
  legendaElements = {
    low: document.getElementById("legend-low"),
    mid: document.getElementById("legend-mid"),
    high: document.getElementById("legend-high"),
    max: document.getElementById("legend-max"),
  };
}

function berekenLegenda(max) {
  return {
    LOW: 0,
    MID: Number((max * 0.25).toFixed(2)),
    HIGH: Number((max * 0.5).toFixed(2)),
    MAX: Number(max.toFixed(2))
  };
}

function updateLegenda() {
  const max = activeScale.colorMax ?? 0;
  const legendValues = berekenLegenda(max);

  legendaElements.low.textContent = legendValues.LOW;
  legendaElements.mid.textContent = legendValues.MID;
  legendaElements.high.textContent = legendValues.HIGH;
  legendaElements.max.textContent = legendValues.MAX;
}

function buildAvailability(points) {
  // Map<year, Set<monthIndex>>
  const byYear = new Map();

  (Array.isArray(points) ? points : []).forEach(p => {
    (Array.isArray(p?.measurements) ? p.measurements : []).forEach(m => {
      // Alleen echte metingen meetellen
      if (typeof m?.value !== "number" || Number.isNaN(m.value)) return;

      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return;

      const y = d.getFullYear();
      const mo = d.getMonth(); // 0-11

      if (!byYear.has(y)) byYear.set(y, new Set());
      byYear.get(y).add(mo);
    });
  });

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);

  // laatste beschikbare (year, month) vinden
  let latest = null;
  years.forEach(y => {
    const months = Array.from(byYear.get(y)).sort((a, b) => a - b);
    months.forEach(mo => {
      if (!latest) latest = { year: y, monthIndex: mo };
      else {
        const a = y * 12 + mo;
        const b = latest.year * 12 + latest.monthIndex;
        if (a > b) latest = { year: y, monthIndex: mo };
      }
    });
  });

  return { byYear, years, latest };
}

function clampToAvailableYear(years, y) {
  if (!years.length) return y;
  if (y <= years[0]) return years[0];
  if (y >= years[years.length - 1]) return years[years.length - 1];

  // als exact beschikbaar: ok
  if (years.includes(y)) return y;

  // anders: dichtstbijzijnde
  let best = years[0];
  let bestDist = Math.abs(y - best);
  for (const yr of years) {
    const dist = Math.abs(y - yr);
    if (dist < bestDist) {
      bestDist = dist;
      best = yr;
    }
  }
  return best;
}

function closestAvailableMonth(byYear, year, desiredMonthIndex) {
  const set = byYear.get(year);
  if (!set || set.size === 0) return desiredMonthIndex;

  if (set.has(desiredMonthIndex)) return desiredMonthIndex;

  const months = Array.from(set).sort((a, b) => a - b);

  // pak de dichtstbijzijnde maand, liever “lager” (naar links) bij gelijke afstand
  let best = months[0];
  let bestDist = Math.abs(desiredMonthIndex - best);

  for (const mo of months) {
    const dist = Math.abs(desiredMonthIndex - mo);
    if (dist < bestDist || (dist === bestDist && mo < best)) {
      bestDist = dist;
      best = mo;
    }
  }
  return best;
}

function applyMonthAvailability(monthButtons, byYear, year, selectedMonthIndex) {
  const set = byYear.get(year) || new Set();

  monthButtons.forEach((btn, idx) => {
    const ok = set.has(idx);
    btn.disabled = !ok;
    btn.classList.toggle("is-disabled", !ok); // optioneel class voor styling
    btn.title = ok ? "" : "No data for this month";
  });

  // zorg dat selection op iets bestaands staat
  return closestAvailableMonth(byYear, year, selectedMonthIndex);
}

const menuTopRight = createMenu("topright", `
  <div class="menu menuTopRight">
    <section id="selected"><p id="selectedTekst">Januari</p></section>

    <section id="dateOptions">
      <fieldset>
        <legend>Year:</legend>
        <input id="previous" type="button" value="-">
        <input id="inputYear" type="number">
        <input id="next" type="button" value="+">
      </fieldset>
        <hr>
      <fieldset>
        <legend>Month:</legend>
        <input class="inputMonth" type="button" value="Jan">
        <input class="inputMonth" type="button" value="Feb">
        <input class="inputMonth" type="button" value="Mar">
        <input class="inputMonth" type="button" value="Apr">
        <input class="inputMonth" type="button" value="May">
        <input class="inputMonth" type="button" value="Jun">
        <input class="inputMonth" type="button" value="Jul">
        <input class="inputMonth" type="button" value="Aug">
        <input class="inputMonth" type="button" value="Sep">
        <input class="inputMonth" type="button" value="Okt">
        <input class="inputMonth" type="button" value="Nov">
        <input class="inputMonth" type="button" value="Dec">
      </fieldset>
    </section>
  </div>
`);

map.addControl(menuTopRight);

// --- state ---
const monthNames = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

// init (wacht tot menu in DOM staat)
initMenuTopRight();

function initMenuTopRight() {
  const root = document.querySelector(".menuTopRight");
  if (!root) {
    requestAnimationFrame(initMenuTopRight);
    return;
  }

  const selected = root.querySelector("#selected");
  const selectedTekst = root.querySelector("#selectedTekst");
  const dateOptions = root.querySelector("#dateOptions");

  const yearInput = root.querySelector("#inputYear");
  const prevBtn = root.querySelector("#previous");
  const nextBtn = root.querySelector("#next");
  const monthButtons = root.querySelectorAll(".inputMonth");

  const availability = buildAvailability(points);
  const { byYear, years, latest } = availability;

  const now = new Date();
  const fallbackYear = now.getFullYear();
  const fallbackMonth = now.getMonth();

  selectedYear = latest?.year ?? fallbackYear;
  selectedMonthIndex = latest?.monthIndex ?? fallbackMonth;

  yearInput.value = selectedYear;

  const updateYearNavDisabled = () => {
    if (!years.length) {
      prevBtn.disabled = false;
      nextBtn.disabled = false;
      return;
    }
    prevBtn.disabled = (selectedYear <= years[0]);
    nextBtn.disabled = (selectedYear >= years[years.length - 1]);
  };

  selectedMonthIndex = applyMonthAvailability(monthButtons, byYear, selectedYear, selectedMonthIndex);

  setActiveMonthButton(monthButtons, selectedMonthIndex);
  updateSelectedTekst(selectedTekst);
  updateYearNavDisabled();

  selected.addEventListener("click", (e) => {
    e.stopPropagation();
    dateOptions.classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menuTopRight")) {
      dateOptions.classList.remove("open");
    }
  });

  const refreshMenu = () => {
    selectedYear = clampToAvailableYear(years, selectedYear);
    yearInput.value = selectedYear;

    selectedMonthIndex = applyMonthAvailability(monthButtons, byYear, selectedYear, selectedMonthIndex);

    setActiveMonthButton(monthButtons, selectedMonthIndex);
    updateSelectedTekst(selectedTekst);
    updateYearNavDisabled();
    updateMarkers();
  };

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    selectedYear -= 1;
    refreshMenu();
  });

  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    selectedYear += 1;
    refreshMenu();
  });

  yearInput.addEventListener("input", (e) => {
    e.stopPropagation();
    const val = Number(yearInput.value);
    if (!Number.isFinite(val)) return;
    selectedYear = val;
    refreshMenu();
  });

  monthButtons.forEach((btn, idx) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      selectedMonthIndex = idx;
      refreshMenu();
    });
  });
}

function setActiveMonthButton(buttons, activeIndex) {
  buttons.forEach((btn, idx) => {
    btn.classList.toggle("active", idx === activeIndex);
  });
}

function updateSelectedTekst(selectedTekstEl) {
  selectedTekstEl.textContent = `${monthNames[selectedMonthIndex]} ${selectedYear}`;
}

const menuBottomRight = createMenu("bottomright", `
  <div class="scale-control leaflet-control">
    <button id="scaleWHO" class="is-active" type="button" data-preset="WHO">WHO</button>
    <button id="scaleEU" class="" type="button" data-preset="EU">EU</button>
    <button id="scaleData" class="" type="button" data-preset="DATA" title="">Data</button>
  </div>
`);

map.addControl(menuBottomRight);

const scaleWHO = document.getElementById("scaleWHO");
const scaleEU = document.getElementById("scaleEU");
const scaleData = document.getElementById("scaleData");

function setActive(active) {
  [scaleWHO, scaleEU, scaleData].forEach(btn =>
    btn.classList.toggle("is-active", btn === active)
  );
  changeScale(active);
  updateLegenda();
}

scaleWHO.addEventListener("click", () => setActive(scaleWHO));
scaleEU.addEventListener("click", () => setActive(scaleEU));
scaleData.addEventListener("click", () => setActive(scaleData));
maakLegenda();

function updateMarkers() {
  console.log("Markers maken voor: ", monthNames[selectedMonthIndex], selectedYear);
  console.log("Met de schaal: ", activeScale.key);

  markerLayer.clearLayers();

  const year = selectedYear;
  const monthIndex = selectedMonthIndex;
  if (typeof year !== "number" || typeof monthIndex !== "number") return;

  const max = activeScale?.colorMax ?? maxValue ?? 0;
  if (!max) return;

  points.forEach(p => {
    const lat = p?.coordinates?.lat;
    const lon = p?.coordinates?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") return;

    const res = getMonthValue(p, year, monthIndex);

    // geen record voor deze maand -> geen bolletje (voor nu)
    if (res.status === "missing") return;

    // --- NO MEASUREMENT -> grijs bolletje (met schaduw + click) ---
    if (res.status === "noMeasurement") {
      // schaduw
      L.circleMarker([lat, lon], {
        radius: 14,
        stroke: false,
        fill: true,
        fillColor: "#000",
        fillOpacity: 0.25,
        interactive: false
      }).addTo(markerLayer);

      const marker = L.circleMarker([lat, lon], {
        radius: 10,
        stroke: true,
        color: "#FFF",
        weight: 1,
        fill: true,
        fillColor: kleuren.NOMES,
        fillOpacity: 1
      }).addTo(markerLayer);

      marker.on("click", () => {
        openOverlay({
          title: p.location ?? `Point ${p.point_number ?? ""}`,
          subtitle: `${monthNames[monthIndex]} ${year} • Scale: ${activeScale.key}`,
          rows: [
            { label: "NO₂ (monthly avg)", value: "No measurement" },
            { label: "Tube", value: (p.measurements?.find(m => m?.tube_id)?.tube_id ?? "—") }
          ]
        });
      });

      return;
    }

    // --- NORMALE METING -> kleur + schaduw + click ---
    const fill = getKleuren(res.value, max);

    // schaduw
    L.circleMarker([lat, lon], {
      radius: 14,
      stroke: false,
      fill: true,
      fillColor: "#000",
      fillOpacity: 0.25,
      interactive: false
    }).addTo(markerLayer);

    // echte marker (deze is klikbaar)
    const marker = L.circleMarker([lat, lon], {
      radius: 10,
      stroke: true,
      color: "#FFF",
      weight: 1,
      fill: true,
      fillColor: fill,
      fillOpacity: 1
    }).addTo(markerLayer);

    marker.on("click", () => {
      openPointOverlay(p, year, monthIndex);
    });
  });
}


function getMonthValue(point, year, monthIndex) {
  const ms = Array.isArray(point?.measurements) ? point.measurements : [];

  const m = ms.find(meas => {
    const d = new Date(meas.date);
    return !Number.isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === monthIndex;
  });

  if (!m) return { status: "missing", value: null };

  if (typeof m.value === "number" && !Number.isNaN(m.value)) {
    return { status: "value", value: m.value };
  }

  // noMeasurement true (of waarde ontbreekt)
  return { status: "noMeasurement", value: null };
}

updateMarkers();

function ensureOverlay() {
  if (document.getElementById("markerOverlay")) return;

  const el = document.createElement("div");
  el.id = "markerOverlay";
  el.className = "overlay";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.hidden = true;

  el.innerHTML = `
    <div class="overlay__backdrop" data-close></div>
    <div class="overlay__panel" role="document">
      <button class="overlay__close" type="button" aria-label="Close" data-close>×</button>
      <div class="overlay__content" id="markerOverlayContent"></div>
    </div>
  `;

  document.body.appendChild(el);

  // close on click (backdrop or close button)
  el.addEventListener("click", (e) => {
    if (e.target && e.target.closest("[data-close]")) {
      closeOverlay();
    }
  });

  // close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const overlay = document.getElementById("markerOverlay");
    if (!overlay || overlay.hidden) return;
    closeOverlay();
  });
}

function openOverlay({ title, subtitle, rows = [] }) {
  ensureOverlay();

  const overlay = document.getElementById("markerOverlay");
  const content = document.getElementById("markerOverlayContent");
  if (!overlay || !content) return;

  const rowsHtml = rows
    .map(r => `<div class="overlay__row"><span>${r.label}</span><strong>${r.value}</strong></div>`)
    .join("");

  content.innerHTML = `
    <h2 class="overlay__title">${title ?? ""}</h2>
    ${subtitle ? `<p class="overlay__subtitle">${subtitle}</p>` : ""}
    <div class="overlay__rows">${rowsHtml}</div>
  `;

  overlay.hidden = false;
  document.body.classList.add("overlay-open");
}

function closeOverlay() {
  const overlay = document.getElementById("markerOverlay");
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove("overlay-open");
}

function openPointOverlay(point, year, monthIndex) {
  ensureOverlay();

  const overlay = document.getElementById("markerOverlay");
  const content = document.getElementById("markerOverlayContent");
  if (!overlay || !content) return;

  const max = activeScale?.colorMax ?? maxValue ?? 0;

  const allRows = getSortedMonthlyMeasurements(point);
  const selectedRow = findRowForMonth(allRows, year, monthIndex);

  // waarde + class voor het kaartje
  const value = selectedRow?.status === "value" ? selectedRow.value : null;
  const cls = getClass(value, max);
  const color = (selectedRow?.status === "noMeasurement")
    ? kleuren.NOMES
    : (value == null ? kleuren.NOMES : getKleuren(value, max));

  // tabelwindow (5 vóór + 6 na)
  const { windowRows } = buildWindowAround(allRows, year, monthIndex, 5, 6);

  const tableHtml = windowRows.map(r => {
    const isSelected = r.year === year && r.monthIndex === monthIndex;
    let v = "—";
    let level = "—";

    if (r.status === "noMeasurement") {
      v = "No measurement";
      level = "—";
    } else if (r.status === "value") {
      v = `${r.value.toFixed(2)}`;
      level = getClass(r.value, max).label;
    }

    return `
      <tr class="${isSelected ? "is-selected" : ""}">
        <td>${formatMonthYear(r.year, r.monthIndex)}</td>
        <td>${v}</td>
        <td>${level}</td>
      </tr>
    `;
  }).join("");

  const measuredMonthText = formatMonthYear(year, monthIndex);
  const freqText = "Monthly";

  // status tekst voor het kaartje
  let cardStatusText = "Measured using passive diffusion tubes";
  let cardValueText = value == null ? "—" : `${value.toFixed(2)} µg/m³`;
  if (selectedRow?.status === "noMeasurement") {
    cardStatusText = "No measurement possible this month";
    cardValueText = "No measurement";
  } else if (!selectedRow) {
    cardStatusText = "No record for this month";
    cardValueText = "—";
  }

  const guidelineText = activeScale?.annual
    ? `${activeScale.key} guideline (annual): < ${activeScale.annual} µg/m³`
    : "Guideline: —";

  content.innerHTML = `
    <div class="popup">
      <!-- Header -->
      <div class="popup__header">
        <div>
          <h2 class="popup__title">${point.location ?? "Location"}</h2>
          <p class="popup__desc">${point.description ?? ""}</p>
        </div>
      </div>

      <!-- Meta row -->
      <div class="popup__meta">
        <div class="popup__metaItem">
          <div class="popup__metaLabel">MEASURED MONTH</div>
          <div class="popup__metaValue">${measuredMonthText}</div>
        </div>
        <div class="popup__metaItem">
          <div class="popup__metaLabel">FREQUENCY</div>
          <div class="popup__metaValue">${freqText}</div>
        </div>
      </div>

      <!-- Card -->
      <div class="popup__card">
        <div class="popup__cardTop">
          <div class="popup__tiny">${cardStatusText}</div>
          <div class="popup__chip" style="background:${color}">${cls.label}</div>
        </div>

        <div class="popup__metricRow">
          <div>
            <div class="popup__metricLabel">NO₂</div>
            <div class="popup__metricValue">${cardValueText}</div>
            <div class="popup__metricHint">*Based on monthly average NO₂</div>
          </div>

          <div class="popup__guideline">
            ${guidelineText}
          </div>
        </div>
      </div>

      <!-- Details -->
      <details class="popup__details">
        <summary>Details</summary>
        <div class="popup__detailsBody">
          <div><strong>Scale:</strong> ${activeScale.key}</div>
          <div><strong>Color max:</strong> ${max ? max.toFixed(2) : "—"} µg/m³</div>
          <div><strong>Coordinates:</strong> lat ${point.coordinates?.lat ?? "—"}, lon ${point.coordinates?.lon ?? "—"}</div>
          <div><strong>Tube:</strong> ${(point.measurements?.find(m => m?.tube_id)?.tube_id ?? "—")}</div>
        </div>
      </details>

      <!-- Chart placeholder (D3 later) -->
      <div class="popup__sectionTitle">MONTHLY VALUES ${year}</div>
      <div id="overlayChart" class="popup__chartPlaceholder">
        <!-- D3 chart goes here -->
      </div>

      <!-- Table -->
      <div class="popup__tableWrap">
        <table class="popup__table">
          <thead>
            <tr>
              <th>Month</th>
              <th>NO₂ (µg/m³)</th>
              <th>Level</th>
            </tr>
          </thead>
          <tbody>
            ${tableHtml || `<tr><td colspan="3">No data</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  overlay.hidden = false;
  document.body.classList.add("overlay-open");

  // Later: hier kun je meteen D3 initten met data:
  // drawOverlayChart({ point, year, rows: allRows });
}
