import { POPUP_PANE_TOP } from "../constants.js";
import { getColor } from "../colors.js";
import { normalizeForColor } from "../scales.js";
import { createMarkerIcon } from "./marker-icon.js";
import { buildPopupHtml } from "./popup.js";

function findMeasurement(point, year, monthIndex) {
  return (point.measurements || []).find(m => {
    if (!m?.date) return false;
    const d = new Date(m.date);
    if (Number.isNaN(d.getTime())) return false;
    return d.getFullYear() === year && d.getMonth() === monthIndex;
  });
}

export function updateMarkers(state) {
  if (!state.map || !state.allPoints?.length || !state.selectedYear) return;
  if (!state.monthSlider) return;
  if (!state.activeMonths || state.activeMonths.length === 0) return;
  if (!state.activeScale) return;

  const sliderIdx = Number(state.monthSlider.value);
  const monthIndex = state.activeMonths[sliderIdx];

  if (!state.markersLayer) {
    state.markersLayer = L.layerGroup().addTo(state.map);
  } else {
    state.markersLayer.clearLayers();
  }

  state.allPoints.forEach(point => {
    const lat = point?.coordinates?.lat;
    const lon = point?.coordinates?.lon;
    if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon)) return;

    const measurement = findMeasurement(point, state.selectedYear, monthIndex);
    if (!measurement) return;

    const isNo = !!measurement.noMeasurement;

    let color = "rgb(160,160,160)";
    if (!isNo) {
      const value = measurement.value;
      if (typeof value !== "number" || Number.isNaN(value)) return;
      color = getColor(normalizeForColor(value, state.activeScale));
    }

    const icon = createMarkerIcon(color);

    L.marker([lat, lon], { icon })
      .addTo(state.markersLayer)
      .bindPopup(() => buildPopupHtml({
        point,
        measurement,
        selectedYear: state.selectedYear,
        selectedMonthIndex: monthIndex,
        activeScale: state.activeScale
      }), {
        pane: POPUP_PANE_TOP,
        minWidth: 320,
        maxWidth: 320,
        autoPanPadding: [10, 10]
      });
  });
}
