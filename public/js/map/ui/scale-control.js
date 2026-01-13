import { SCALE_PRESETS } from "../constants.js";
import { setScalePreset } from "../scales.js";

export function createScaleControl(state, onChange) {
  const control = L.control({ position: "bottomright" });

  control.onAdd = function () {
    // Container met CSS-class (styling via home.css)
    const container = L.DomUtil.create("div", "scale-control");

    // Voorkom dat klikken de kaart verplaatst
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const buttons = {};

    function refresh() {
      Object.keys(buttons).forEach(key => {
        const btn = buttons[key];
        const isActive = state.activeScale?.key === key;
        btn.classList.toggle("is-active", isActive);
      });

      // DATA-knop uitschakelen als schaal niet beschikbaar is
      if (buttons.DATA) {
        const ready =
          SCALE_PRESETS.DATA &&
          typeof SCALE_PRESETS.DATA.colorMax === "number";

        buttons.DATA.disabled = !ready;
        buttons.DATA.title = ready
          ? ""
          : "Not enough data to compute a scale";
      }
    }

    [
      { key: "WHO", label: "WHO" },
      { key: "EU", label: "EU" },
      { key: "DATA", label: "Data" }
    ].forEach(preset => {
      const btn = L.DomUtil.create("button", "", container);
      btn.type = "button";
      btn.textContent = preset.label;

      buttons[preset.key] = btn;

      btn.addEventListener("click", () => {
        // DATA alleen als hij beschikbaar is
        if (
          preset.key === "DATA" &&
          (!SCALE_PRESETS.DATA ||
           SCALE_PRESETS.DATA.colorMax == null)
        ) {
          return;
        }

        setScalePreset(preset.key, state);
        refresh();
        onChange?.();
      });
    });

    // Initiele state
    refresh();

    return container;
  };

  return control;
}
