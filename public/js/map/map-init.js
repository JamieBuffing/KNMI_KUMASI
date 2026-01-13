import { POPUP_PANE_TOP } from "./constants.js";

export function initMap(state, startCoords, startZoom = 13) {
  state.map = L.map("map").setView(startCoords, startZoom);
  window.map = state.map;

  function setUiHidden(hidden) {
    const root = state.map.getContainer();
    root.querySelectorAll(".leaflet-control-container .leaflet-control").forEach(el => {
      el.style.display = hidden ? "none" : "";
    });
    root.querySelectorAll(".menu-control").forEach(el => {
      el.style.display = hidden ? "none" : "";
    });
  }

  state.map.on("popupopen", () => setUiHidden(true));
  state.map.on("popupclose", () => setUiHidden(false));

  state.map.createPane(POPUP_PANE_TOP);
  state.map.getPane(POPUP_PANE_TOP).style.zIndex = "5000";

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17
  }).addTo(state.map);

  return state.map;
}
