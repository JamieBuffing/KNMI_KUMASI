let map;
let markersLayer;
let allMeetpunten = {};
let selectedYear = null;

// << nieuw >>
let monthSlider = null;
let monthLabelEl = null;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'
];

function getColor(m) {
  // m verwacht waarde tussen 0 en 1
  if (m <= 0.5) {
    const t = m / 0.5;
    const r = Math.round(0 + t * 255);
    const g = 255;
    const b = 0;
    return `rgb(${r},${g},${b})`; // groen -> geel
  } else {
    const t = (m - 0.5) / 0.5;
    const r = 255;
    const g = Math.round(255 - t * 255);
    const b = 0;
    return `rgb(${r},${g},${b})`; // geel -> rood
  }
}

// Haal alle jaren uit de meetpunten-data
function extractAvailableYears(data) {
  const years = new Set();

  Object.values(data).forEach(meetpuntArray => {
    const meetpunt = meetpuntArray[0];
    if (!meetpunt || !meetpunt.metingen) return;

    meetpunt.metingen.forEach(m => {
      const year = parseInt(m.datum.slice(0, 4), 10);
      if (!Number.isNaN(year)) {
        years.add(year);
      }
    });
  });

  return Array.from(years).sort((a, b) => a - b);
}

function createUiLogin() {
  const login = L.control({ position: 'topright' });
  login.onAdd = function () {
    const container = L.DomUtil.create('div', 'login-control');
    const loginLink = L.DomUtil.create('a', '', container);
    loginLink.id = 'login';            // <a id="login">
    loginLink.href = '/login';         // href="/login"
    loginLink.textContent = 'Login';   // tekst "Login"
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  };

  return login;
}

// UI control (rechtsboven) met jaar-knoppen + maand-slider
function createUiControl(years) {
  const control = L.control({ position: 'bottomleft' });

  control.onAdd = function () {
    const container = L.DomUtil.create('div', 'map-ui');

    // voorkom dat de kaart panned als je op UI klikt
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    // ---- Jaar knoppen ----
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

        // active styling
        yearButtonsContainer.querySelectorAll('button').forEach(b => {
          const isActive = Number(b.dataset.year) === selectedYear;
          b.style.background = isActive ? '#007bff' : '#f8f9fa';
          b.style.color = isActive ? '#fff' : '#333';
        });

        updateMarkers();
      });
    });

    // ---- Maand slider ----
    const monthContainer = L.DomUtil.create('div', '', container);
    monthContainer.style.marginTop = '6px';

    const label = L.DomUtil.create('label', '', monthContainer);
    label.setAttribute('for', 'slider');
    label.textContent = 'Month: ';

    const monthNameSpan = L.DomUtil.create('span', '', label);
    monthNameSpan.id = 'slider-label';
    monthNameSpan.style.fontWeight = '600';
    monthNameSpan.textContent = MONTH_NAMES[0];

    // << hier: globale referenties vullen >>
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

    // << en deze ook >>
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
  // << gebruik nu de globale referenties >>
  if (!monthSlider || !monthLabelEl) return;

  const monthIndex = Number(monthSlider.value);
  monthLabelEl.textContent = MONTH_NAMES[monthIndex]; // Engelse maandnaam
}

// Tekent markers voor geselecteerd jaar + maand (slider)
function updateMarkers() {
  if (!map || !allMeetpunten || !selectedYear) return;

  if (!monthSlider) return;
  const monthIndex = Number(monthSlider.value); // 0–11

  if (!markersLayer) {
    markersLayer = L.layerGroup().addTo(map);
  } else {
    markersLayer.clearLayers();
  }

  Object.entries(allMeetpunten).forEach(([naam, meetpuntArray]) => {
    const meetpunt = meetpuntArray[0];
    if (!meetpunt || !meetpunt.coordinaten) return;

    const lat = meetpunt.coordinaten.lat;
    const lon = meetpunt.coordinaten.lon;
    const beschrijving = meetpunt.beschrijving;

    // Zoek de meting voor dit jaar + maand
    const metingObj = (meetpunt.metingen || []).find(m => {
      const year = parseInt(m.datum.slice(0, 4), 10);
      const month = parseInt(m.datum.slice(5, 7), 10) - 1; // 0–11
      return year === selectedYear && month === monthIndex;
    });

    if (!metingObj) {
      // Geen meting voor deze maand/jaar → geen marker tonen
      return;
    }

    const waarde = metingObj.waarde;
    const kleur = getColor(waarde);

    const icon = L.divIcon({
      className: "custom-marker",
      html: `<div style="
          width: 20px;
          height: 20px;
          background:${kleur};
          border-radius: 50%;
          border: 2px solid #FFFFFF;
          box-shadow: 0 0 4px #00000099;
      "></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    L.marker([lat, lon], { icon })
      .addTo(markersLayer)
      .bindPopup(`
        <strong>${beschrijving}</strong><br>
        Value: ${waarde}<br>
        Date: ${metingObj.datum}<br>
        ${naam}
      `);
  });
}

// ------------ INIT: kaart + data ophalen ------------

fetch('/api/keuzes')
  .then(res => res.json())
  .then(keuzes => {
    const coords = keuzes.Coordinaten;

    map = L.map('map').setView(coords, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17
    }).addTo(map);

    // daarna data laden
    return fetch('/api/data');
  })
  .then(res => res.json())
  .then(meetpunten => {
    allMeetpunten = meetpunten;

    const years = extractAvailableYears(meetpunten);

    if (years.length === 0) {
      console.warn('Geen jaren gevonden in meetdata');
      return;
    }

    // standaard: laatste (meest recente) jaar kiezen
    selectedYear = years[years.length - 1];

    // UI control (jaar & slider)
    const uiControl = createUiControl(years);
    uiControl.addTo(map);

    // Login control
    const loginControl = createUiLogin();
    loginControl.addTo(map);

    // juiste maandnaam tonen en markers tekenen voor eerste waarde
    updateMonthLabel();
    updateMarkers();
  })
  .catch(err => console.error(err));
