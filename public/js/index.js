document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector("[data-view-toggle]");
  if (!toggle) return;

  const buttons = Array.from(toggle.querySelectorAll("[data-view]"));
  const mapView = document.getElementById("map-view");
  const tableView = document.getElementById("table-view");

  function setView(view) {
    // button active state
    buttons.forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.view === view);
    });

    // show/hide views (als aanwezig)
    if (mapView && tableView) {
      mapView.classList.toggle("is-active", view === "map");
      tableView.classList.toggle("is-active", view === "table");
    }

    // Leaflet resize fix
    if (view === "map" && window.map?.invalidateSize) {
      setTimeout(() => window.map.invalidateSize(), 0);
    }
  }

  toggle.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  // init
  const initial = buttons.find(b => b.classList.contains("is-active"))?.dataset.view || "map";
  setView(initial);
});
