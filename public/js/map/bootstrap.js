import { state } from "./state.js";
import { SCALE_PRESETS } from "./constants.js";
import { initMap } from "./map-init.js";
import { extractAvailableYears, buildAvailableMonthsByYear } from "./data-utils.js";
import { computeDataScaleFromPoints, applyStoredScalePreset, setScalePreset } from "./scales.js";
import { createUiControl, updateMonthSliderForYear } from "./ui/control.js";
import { createUiLogin } from "./ui/menu.js";
import { updateMarkers } from "./render/markers.js";
import { createScaleControl } from "./ui/scale-control.js";

export function initFromBootData() {
  const bootEl = document.getElementById("boot-data");
  const boot = bootEl ? JSON.parse(bootEl.textContent) : { keuzes: {}, points: [] };

  const keuzes = boot.keuzes || {};
  const pointsRaw = Array.isArray(boot.points) ? boot.points : [];

  const coords = Array.isArray(keuzes.Coordinaten) ? keuzes.Coordinaten : null;
  const startCoords = (coords && coords.length === 2) ? coords : [0, 0];

  initMap(state, startCoords, 13);

  // filter veilige punten
  state.allPoints = pointsRaw.filter(p => {
    const lat = p?.coordinates?.lat;
    const lon = p?.coordinates?.lon;
    return (typeof lat === "number" && !Number.isNaN(lat) && typeof lon === "number" && !Number.isNaN(lon));
  });

  // DATA preset berekenen
  const dataScale = computeDataScaleFromPoints(state.allPoints);
  if (dataScale) SCALE_PRESETS.DATA = dataScale;

  // default scale + stored preset
  setScalePreset("WHO", state);
  applyStoredScalePreset(state);

  const scaleControl = createScaleControl(state, () => updateMarkers(state));
  scaleControl.addTo(state.map);

  const years = extractAvailableYears(state.allPoints);
  state.availableMonthsByYear = buildAvailableMonthsByYear(state.allPoints);

  if (years.length === 0) {
    console.warn("No years found in measurement data");
    updateMarkers(state);
    return;
  }

  state.selectedYear = years[years.length - 1];

  const uiControl = createUiControl(state, years, () => updateMarkers(state));
  uiControl.addTo(state.map);

  updateMonthSliderForYear(state);
  updateMarkers(state);
}
