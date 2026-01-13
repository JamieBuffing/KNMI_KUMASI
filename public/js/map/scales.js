import { clamp01 } from "./colors.js";
import { VALUE_SUFFIX, SCALE_PRESETS, SCALE_STORAGE_KEY } from "./constants.js";
import { percentile } from "./data-utils.js";

export function normalizeForColor(value, activeScale) {
  const max = (typeof activeScale?.colorMax === "number" && activeScale.colorMax > 0)
    ? activeScale.colorMax
    : 50;
  return clamp01(value / max);
}

export function getCategory(value, activeScale) {
  const a = activeScale?.annual;
  const h = activeScale?.high;

  if (typeof a !== "number" || typeof h !== "number") {
    return "Value context unavailable";
  }

  if (value <= a) return `≤ ${a}${VALUE_SUFFIX}`;
  if (value <= h) return `> ${a}${VALUE_SUFFIX} and ≤ ${h}${VALUE_SUFFIX}`;
  return `> ${h}${VALUE_SUFFIX}`;
}

export function setScalePreset(key, state) {
  const preset = SCALE_PRESETS[key];
  if (!preset) return;

  if (preset.key === "DATA" && (preset.colorMax == null || preset.annual == null || preset.high == null)) {
    return;
  }

  state.activeScale = { ...preset };

  try {
    localStorage.setItem(SCALE_STORAGE_KEY, state.activeScale.key);
  } catch (_) {}
}

export function applyStoredScalePreset(state) {
  try {
    const stored = localStorage.getItem(SCALE_STORAGE_KEY);
    if (stored && SCALE_PRESETS[stored]) {
      setScalePreset(stored, state);
    }
  } catch (_) {}
}

export function computeDataScaleFromPoints(points) {
  const vals = [];

  points.forEach(pt => {
    (pt.measurements || []).forEach(m => {
      if (!m) return;
      if (m.noMeasurement) return;
      if (typeof m.value !== "number" || Number.isNaN(m.value)) return;
      vals.push(m.value);
    });
  });

  vals.sort((a, b) => a - b);
  if (!vals.length) return null;

  const p50 = percentile(vals, 0.50);
  const p75 = percentile(vals, 0.75);
  const p95 = percentile(vals, 0.95);

  const round1 = (x) => Math.round(x * 10) / 10;

  return {
    key: "DATA",
    label: "Data",
    annual: round1(p50),
    high: round1(p75),
    colorMax: Math.max(1, round1(p95))
  };
}
