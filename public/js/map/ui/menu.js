import { SCALE_PRESETS, VALUE_SUFFIX } from "../constants.js";
import { setScalePreset } from "../scales.js";

export function createUiLogin(state, onChange) {
  const menuControl = L.control({ position: "topright" });

  menuControl.onAdd = function () {
    const container = L.DomUtil.create("div", "menu-control");

    const button = L.DomUtil.create("button", "menu-button", container);
    button.type = "button";
    button.textContent = "☰";

    const menu = L.DomUtil.create("div", "menu-dropdown", container);

    const scaleTitle = L.DomUtil.create("div", "", menu);
    scaleTitle.textContent = "Color scale";
    scaleTitle.style.fontSize = "11px";
    scaleTitle.style.fontWeight = "600";
    scaleTitle.style.marginBottom = "6px";

    const btnRow = L.DomUtil.create("div", "", menu);
    btnRow.style.display = "flex";
    btnRow.style.flexWrap = "wrap";
    btnRow.style.gap = "6px";

    const buttons = {};

    function stylePresetButton(btn, isActive) {
      btn.style.border = "1px solid #ccc";
      btn.style.borderRadius = "4px";
      btn.style.padding = "4px 8px";
      btn.style.fontSize = "11px";
      btn.style.cursor = "pointer";
      btn.style.background = isActive ? "#007bff" : "#f8f9fa";
      btn.style.color = isActive ? "#fff" : "#333";
    }

    const hint = L.DomUtil.create("div", "", menu);
    hint.style.marginTop = "6px";
    hint.style.fontSize = "10px";
    hint.style.color = "#666";

    function refresh() {
      Object.keys(buttons).forEach(k => {
        stylePresetButton(buttons[k], state.activeScale?.key === k);
      });

      if (buttons.DATA) {
        const ready = (SCALE_PRESETS.DATA && typeof SCALE_PRESETS.DATA.colorMax === "number");
        buttons.DATA.disabled = !ready;
        buttons.DATA.title = ready ? "" : "Not enough data to compute a scale";
        buttons.DATA.style.opacity = ready ? "1" : "0.5";
        buttons.DATA.style.cursor = ready ? "pointer" : "not-allowed";
      }

      hint.textContent = state.activeScale
        ? `Active: ${state.activeScale.label} (max red ≈ ${state.activeScale.colorMax}${VALUE_SUFFIX})`
        : "";
    }

    [
      { key: "WHO", label: "WHO" },
      { key: "EU", label: "EU" },
      { key: "DATA", label: "Data" }
    ].forEach(p => {
      const b = L.DomUtil.create("button", "", btnRow);
      b.type = "button";
      b.textContent = p.label;
      buttons[p.key] = b;

      b.addEventListener("click", () => {
        if (p.key === "DATA" && (!SCALE_PRESETS.DATA || SCALE_PRESETS.DATA.colorMax == null)) return;
        setScalePreset(p.key, state);
        refresh();
        onChange?.();
      });
    });

    refresh();

    button.addEventListener("click", () => {
      menu.classList.toggle("open");
      if (menu.classList.contains("open")) refresh();
    });

    document.addEventListener("click", e => {
      if (!container.contains(e.target)) menu.classList.remove("open");
    });

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  };

  return menuControl;
}
