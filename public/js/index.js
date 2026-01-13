(function () {
  const toggle = document.querySelector("[data-view-toggle]");
  if (!toggle) return;

  const buttons = toggle.querySelectorAll("[data-view]");
  const views = {
    map: document.getElementById("map-view"),
    table: document.getElementById("table-view")
  };

  let activeView = "map";

  function setView(view) {
    if (!views[view]) return;

    // buttons
    buttons.forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.view === view);
    });

    // views
    Object.keys(views).forEach(key => {
      views[key].classList.toggle("is-active", key === view);
    });

    activeView = view;

    // ⚠️ Leaflet fix: kaart hertekenen als hij weer zichtbaar wordt
    if (view === "map" && window.map) {
      setTimeout(() => {
        window.map.invalidateSize();
      }, 0);
    }
  }

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      setView(btn.dataset.view);
    });
  });
})();
