export const state = {
  map: null,
  markersLayer: null,
  allPoints: [],
  selectedYear: null,

  monthSlider: null,
  monthLabelEl: null,

  availableMonthsByYear: {}, // { 2025: [4,6,7,9], ... }
  activeMonths: [],

  activeScale: null
};
