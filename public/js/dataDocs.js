// public/js/dataDocs.js
(function () {
  function hydrateApiUrls() {
    const base = window.location.origin;
    const els = document.querySelectorAll(".api-url[data-path]");

    els.forEach(el => {
      const path = el.getAttribute("data-path") || "";
      const cleanPath = path.startsWith("/") ? path : "/" + path;
      el.textContent = base + cleanPath;
    });
  }

  document.addEventListener("DOMContentLoaded", hydrateApiUrls);
})();
