export const MONTH_NAMES = [
  "January", "February", "March", "April",
  "May", "June", "July", "August",
  "September", "October", "November", "December"
];

export const POPUP_PANE_TOP = "popupTop";

export const VALUE_SUFFIX = " µg/m³";

export const SCALE_STORAGE_KEY = "no2ScalePreset";

export const SCALE_PRESETS = {
  WHO:  { key: "WHO",  label: "WHO",  annual: 10,  high: 25,  colorMax: 50 },
  EU:   { key: "EU",   label: "EU",   annual: 40,  high: 60,  colorMax: 80 },
  DATA: { key: "DATA", label: "Data", annual: null, high: null, colorMax: null }
};
