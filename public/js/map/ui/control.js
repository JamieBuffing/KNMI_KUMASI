import { MONTH_NAMES } from "../constants.js";

export function createUiControl(state, years, onChange) {
  const control = L.control({ position: "bottomleft" });

  control.onAdd = function () {
    const container = L.DomUtil.create("div", "map-ui");

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const yearTitle = L.DomUtil.create("div", "", container);
    yearTitle.textContent = "Year";

    const yearButtonsContainer = L.DomUtil.create("div", "", container);
    yearButtonsContainer.style.display = "flex";
    yearButtonsContainer.style.flexWrap = "wrap";
    yearButtonsContainer.style.gap = "4px";
    yearButtonsContainer.style.marginBottom = "6px";
    yearButtonsContainer.style.marginTop = "4px";

    years.forEach(year => {
      const btn = L.DomUtil.create("button", "", yearButtonsContainer);
      btn.textContent = year;
      btn.dataset.year = String(year);

      btn.style.border = "1px solid #ccc";
      btn.style.borderRadius = "3px";
      btn.style.padding = "2px 6px";
      btn.style.cursor = "pointer";
      btn.style.background = (year === state.selectedYear) ? "#007bff" : "#f8f9fa";
      btn.style.color = (year === state.selectedYear) ? "#fff" : "#333";
      btn.style.fontSize = "11px";

      btn.addEventListener("click", () => {
        state.selectedYear = year;

        yearButtonsContainer.querySelectorAll("button").forEach(b => {
          const isActive = Number(b.dataset.year) === state.selectedYear;
          b.style.background = isActive ? "#007bff" : "#f8f9fa";
          b.style.color = isActive ? "#fff" : "#333";
        });

        updateMonthSliderForYear(state);
        onChange?.();
      });
    });

    const monthContainer = L.DomUtil.create("div", "", container);
    monthContainer.style.marginTop = "6px";

    const label = L.DomUtil.create("label", "", monthContainer);
    label.setAttribute("for", "slider");
    label.textContent = "Month: ";

    const monthNameSpan = L.DomUtil.create("span", "", label);
    monthNameSpan.id = "slider-label";
    monthNameSpan.style.fontWeight = "600";
    monthNameSpan.textContent = MONTH_NAMES[0];
    state.monthLabelEl = monthNameSpan;

    const slider = L.DomUtil.create("input", "", monthContainer);
    slider.type = "range";
    slider.id = "slider";
    slider.min = "0";
    slider.max = "11";
    slider.step = "1";
    slider.value = "0";
    slider.style.width = "100%";
    slider.style.marginTop = "4px";
    state.monthSlider = slider;

    slider.addEventListener("input", () => {
      updateMonthLabel(state);
      onChange?.();
    });

    return container;
  };

  return control;
}

export function updateMonthSliderForYear(state) {
  if (!state.monthSlider || !state.monthLabelEl) return;

  state.activeMonths = state.availableMonthsByYear[state.selectedYear] || [];

  if (state.activeMonths.length === 0) {
    state.monthSlider.disabled = true;
    state.monthSlider.min = "0";
    state.monthSlider.max = "0";
    state.monthSlider.value = "0";
    state.monthLabelEl.textContent = "No data";
    return;
  }

  state.monthSlider.disabled = false;
  state.monthSlider.min = "0";
  state.monthSlider.max = String(state.activeMonths.length - 1);
  state.monthSlider.value = "0";

  updateMonthLabel(state);
}

export function updateMonthLabel(state) {
  if (!state.monthSlider || !state.monthLabelEl) return;

  if (!state.activeMonths || state.activeMonths.length === 0) {
    state.monthLabelEl.textContent = "No data";
    return;
  }

  const idx = Number(state.monthSlider.value);
  const monthIndex = state.activeMonths[idx];
  state.monthLabelEl.textContent = MONTH_NAMES[monthIndex];
}
