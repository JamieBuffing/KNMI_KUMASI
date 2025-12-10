// map.js

let map;
let markers = [];
let alleMeetpunten = null;
let datumLabels = [];
let currentIndex = 0;

// Globale min/max voor alle waardes (voor automatische schaal)
let globalMin = Infinity;
let globalMax = -Infinity;

// ------------ KLEURVERLOOP (groen → geel → rood, geschaald op min/max) ---------------

function getColorForValue(value) {
  // Als min/max nog niet bekend zijn of alle waardes gelijk zijn
  if (!isFinite(globalMin) || !isFinite(globalMax) || globalMin === globalMax) {
    return 'rgb(0,255,0)'; // alles groen bij gebrek aan variatie
  }

  // Normaliseer naar 0–1
  let m = (value - globalMin) / (globalMax - globalMin);
  m = Math.max(0, Math.min(1, m)); // clamp tussen 0 en 1

  if (m <= 0.5) {
    const t = m / 0.5;
    const r = Math.round(0 + t * 255);
    const g = 255;
    const b = 0;
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (m - 0.5) / 0.5;
    const r = 255;
    const g = Math.round(255 - t * 255);
    const b = 0;
    return `rgb(${r},${g},${b})`;
  }
}

function formatMaandLabel(datumString) {
  const d = new Date(datumString);
  const maanden = [
    "januari", "februari", "maart", "april",
    "mei", "juni", "juli", "augustus",
    "september", "oktober", "november", "december"
  ];

  const maandNaam = maanden[d.getMonth()];
  const jaar = d.getFullYear();
  return `${maandNaam} ${jaar}`;
}

// ------------ DATA LADEN ---------------

fetch('/api/keuzes')
  .then(res => res.json())
  .then(keuzes => {
    const coords = keuzes.Coordinaten;

    map = L.map('map').setView(coords, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18
    }).addTo(map);

    return fetch('/api/data');
  })
  .then(res => res.json())
  .then(meetpunten => {
    alleMeetpunten = meetpunten;

    // ---- MIN / MAX VAN ALLE METINGEN BEREKENEN ----
    Object.values(meetpunten).forEach(meetpuntArray => {
      const meetpunt = meetpuntArray[0];
      if (!meetpunt || !meetpunt.metingen) return;

      meetpunt.metingen.forEach(m => {
        const v = m.waarde;
        if (typeof v === 'number' && !isNaN(v)) {
          if (v < globalMin) globalMin = v;
          if (v > globalMax) globalMax = v;
        }
      });
    });

    console.log('globalMin:', globalMin, 'globalMax:', globalMax);

    // Datumlabels baseren op het eerste meetpunt
    const eersteKey = Object.keys(meetpunten)[0];
    const eersteMeetpunt = meetpunten[eersteKey][0];
    datumLabels = eersteMeetpunt.metingen.map(m => m.datum);

    maakSliderControl(datumLabels.length);

    updateMarkers();
  })
  .catch(err => console.error(err));


// ------------ LEAFLET CONTROL VOOR SLIDER ---------------

function maakSliderControl(aantalSteps) {
  const TimeControl = L.Control.extend({
    options: { position: 'bottomleft' },

    onAdd: function () {
      const container = L.DomUtil.create('div', 'time-control');

      container.innerHTML = `
        <div class="time-control-inner">
          <div class="time-control-buttons">
            <button id="time-back" title="Vorige stap">⟨</button>
            <button id="time-play-pause" title="Afspelen / pauzeren">▶</button>
            <button id="time-forward" title="Volgende stap">⟩</button>
          </div>

          <input id="time-slider" type="range"
                 min="0" max="${aantalSteps - 1}" value="0" step="1" />

          <div class="time-label-row">
            <span id="time-label-start" class="time-label-edge"></span>
            <span id="time-label" class="time-label-main"></span>
            <span id="time-label-end" class="time-label-edge"></span>
          </div>
        </div>
      `;

      L.DomEvent.disableClickPropagation(container);

      return container;
    }
  });

  map.addControl(new TimeControl());

  const slider     = document.getElementById('time-slider');
  const label      = document.getElementById('time-label');
  const labelStart = document.getElementById('time-label-start');
  const labelEnd   = document.getElementById('time-label-end');
  const btnBack    = document.getElementById('time-back');
  const btnPlay    = document.getElementById('time-play-pause');
  const btnForward = document.getElementById('time-forward');

  let playInterval = null;

  function clampIndex(i) {
    if (i < 0) return 0;
    if (i > datumLabels.length - 1) return datumLabels.length - 1;
    return i;
  }

  function updateLabel() {
    const idx = parseInt(slider.value, 10);
    const tekst = formatMaandLabel(datumLabels[idx]);
    label.textContent = tekst;

    // Randen laten zien (eerste en laatste datum)
    if (datumLabels.length > 0) {
      labelStart.textContent = formatMaandLabel(datumLabels[0]);
      labelEnd.textContent   = formatMaandLabel(datumLabels[datumLabels.length - 1]);
    }
  }

  function setIndex(newIndex) {
    currentIndex = clampIndex(newIndex);
    slider.value = currentIndex;
    updateMarkers();
    updateLabel();
  }

  function stopPlaying() {
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
      btnPlay.textContent = '▶';
    }
  }

  function startPlaying() {
    if (playInterval) return;
    btnPlay.textContent = '⏸';

    playInterval = setInterval(() => {
      if (currentIndex >= datumLabels.length - 1) {
        stopPlaying();
        return;
      }
      setIndex(currentIndex + 1);
    }, 800); // snelheid animatie in ms
  }

  // Slider handmatig
  slider.addEventListener('input', () => {
    stopPlaying(); // stoppen met afspelen als gebruiker sleept
    setIndex(parseInt(slider.value, 10));
  });

  // Vorige/volgende
  btnBack.addEventListener('click', () => {
    stopPlaying();
    setIndex(currentIndex - 1);
  });

  btnForward.addEventListener('click', () => {
    stopPlaying();
    setIndex(currentIndex + 1);
  });

  // Play / pause
  btnPlay.addEventListener('click', () => {
    if (playInterval) {
      stopPlaying();
    } else {
      // als we aan het einde staan: opnieuw vanaf 0
      if (currentIndex >= datumLabels.length - 1) {
        setIndex(0);
      }
      startPlaying();
    }
  });

  // Optioneel: pijltjestoetsen gebruiken
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      stopPlaying();
      setIndex(currentIndex - 1);
    } else if (e.key === 'ArrowRight') {
      stopPlaying();
      setIndex(currentIndex + 1);
    } else if (e.key === ' ') {
      e.preventDefault(); // scroll blokkeren
      if (playInterval) {
        stopPlaying();
      } else {
        if (currentIndex >= datumLabels.length - 1) {
          setIndex(0);
        }
        startPlaying();
      }
    }
  });

  // Init
  setIndex(0);
}

// ------------ MARKERS TEKENEN OP BASIS VAN currentIndex ---------------

function updateMarkers() {
  if (!alleMeetpunten) return;

  // Verwijder bestaande markers
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  Object.entries(alleMeetpunten).forEach(([naam, meetpuntArray]) => {
    const meetpunt = meetpuntArray[0];
    if (!meetpunt || !meetpunt.coordinaten || !meetpunt.metingen) return;

    const huidigeMeting = meetpunt.metingen[currentIndex];

    // GEEN data voor deze maand → geen bolletje
    if (!huidigeMeting) return;

    const waarde = huidigeMeting.waarde;

    // Als waarde ontbreekt of ongeldig is → geen bolletje
    if (waarde === null || waarde === undefined || typeof waarde !== 'number' || isNaN(waarde)) {
      return;
    }

    const lat = meetpunt.coordinaten.lat;
    const lon = meetpunt.coordinaten.lon;
    const beschrijving = meetpunt.beschrijving || naam;
    const datum  = huidigeMeting.datum;

    const kleur = getColorForValue(waarde);

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

    const marker = L.marker([lat, lon], { icon })
      .addTo(map)
      .bindPopup(`
        <strong>${beschrijving}</strong><br>
        Waarde: ${waarde}<br>
        Datum: ${datum}<br>
        (${naam})
      `);

    markers.push(marker);
  });
}
