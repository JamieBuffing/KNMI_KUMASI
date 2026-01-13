export function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

export function getColor(m) {
  if (m <= 0.5) {
    const t = m / 0.5;
    const r = Math.round(0 + t * 255);
    const g = 255;
    return `rgb(${r},${g},0)`; // green -> yellow
  } else {
    const t = (m - 0.5) / 0.5;
    const r = 255;
    const g = Math.round(255 - t * 255);
    return `rgb(${r},${g},0)`; // yellow -> red
  }
}
