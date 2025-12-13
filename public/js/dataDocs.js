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

  function normalizeForCopy(text) {
    if (!text) return "";

    let value = text.trim();

    // Strip HTTP method prefixes (GET, POST, PUT, DELETE, etc.)
    value = value.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i, "");

    return value;
  }

  async function copyText(rawText) {
    const value = normalizeForCopy(rawText);
    if (!value) return false;

    // Modern clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_) {
        // fall back
      }
    }

    // Legacy fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";

      document.body.appendChild(ta);
      ta.focus();
      ta.select();

      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function enablePreCopy() {
    document.addEventListener("click", async (e) => {
      const pre = e.target.closest("pre.code-block");
      if (!pre) return;

      const rawText = pre.innerText || pre.textContent || "";
      const ok = await copyText(rawText);

      // Subtiele feedback zonder styling-wijziging
      const oldTitle = pre.getAttribute("title") || "";
      pre.setAttribute("title", ok ? "Copied ✓" : "Copy failed");

      setTimeout(() => {
        if (oldTitle) pre.setAttribute("title", oldTitle);
        else pre.removeAttribute("title");
      }, 1200);
    });

    // UX hint
    document.querySelectorAll("pre.code-block").forEach(pre => {
      pre.style.cursor = "pointer";
      if (!pre.getAttribute("title")) {
        pre.setAttribute("title", "Click to copy URL");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    hydrateApiUrls();
    enablePreCopy();
  });

})();
