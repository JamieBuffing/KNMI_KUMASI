import { getColor } from "../colors.js";
import { normalizeForColor } from "../scales.js";

export function buildSparklineSvg(yearMeasurements, activeScale) {
  const numeric = yearMeasurements
    .filter(m => !m.noMeasurement && typeof m.value === "number" && !Number.isNaN(m.value));

  if (numeric.length < 1) {
    return `<span style="font-size:10px; color:#888;">Not enough numeric data for graph</span>`;
  }

  const sorted = [...numeric].sort((a, b) => new Date(a.date) - new Date(b.date));
  const vals = sorted.map(m => m.value);
  const max = Math.max(...vals);
  const min = Math.min(...vals);

  const w = 200;
  const h = 80;
  const padding = 10;
  const paddingRight = padding;
  const paddingBottom = padding + 8;
  const paddingTop = padding;

  const minLabel = min.toFixed(2);
  const maxLabel = max.toFixed(2);
  const labelChars = Math.max(minLabel.length, maxLabel.length);
  const yLabelRoom = Math.max(28, labelChars * 6);
  const paddingLeft = padding + yLabelRoom;

  const innerW = w - paddingLeft - paddingRight;
  const innerH = h - paddingTop - paddingBottom;

  const yForValue = (v) => {
    const t = (max === min) ? 0.5 : (v - min) / (max - min);
    return paddingTop + (innerH - t * innerH);
  };

  const xForMonth = (mIdx) => paddingLeft + (mIdx / 11) * innerW;

  const positions = sorted.map((m) => {
    const d = new Date(m.date);
    const mIdx = d.getMonth();
    const monthShort = d.toLocaleString("en-US", { month: "short" });
    return { x: xForMonth(mIdx), y: yForValue(m.value), monthShort, value: m.value, monthIndex: mIdx };
  });

  const xAxisEnd = paddingLeft + innerW;

  const stops = positions.map((p) => {
    const offset = innerW ? ((p.x - paddingLeft) / innerW) * 100 : 0;
    const c = getColor(normalizeForColor(p.value, activeScale));
    return `<stop offset="${offset}%" stop-color="${c}" />`;
  }).join("");

  const segments = [];
  let current = [positions[0]];

  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const cur = positions[i];
    const gap = cur.monthIndex - prev.monthIndex;

    if (gap > 1) {
      segments.push(current);
      current = [cur];
    } else {
      current.push(cur);
    }
  }
  segments.push(current);

  const polylines = segments
    .filter(seg => seg.length >= 2)
    .map(seg => {
      const pointsAttr = seg.map(p => `${p.x},${p.y}`).join(" ");
      return `<polyline points="${pointsAttr}" fill="none" stroke="url(#gradLine)" stroke-width="2" />`;
    })
    .join("");

  const circles = positions.map(p => {
    const dotColor = getColor(normalizeForColor(p.value, activeScale));
    return `<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="${dotColor}" stroke="#ffffff" stroke-width="1" />`;
  }).join("");

  const firstPos = positions[0];
  const lastPos = positions[positions.length - 1];

  return `
    <svg width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="overflow: visible;">
      <defs>
        <linearGradient id="gradLine" x1="${paddingLeft}" y1="0" x2="${xAxisEnd}" y2="0" gradientUnits="userSpaceOnUse">
          ${stops}
        </linearGradient>
      </defs>

      <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + innerH}" stroke="#cccccc" stroke-width="1" />
      <line x1="${paddingLeft}" y1="${paddingTop + innerH}" x2="${xAxisEnd}" y2="${paddingTop + innerH}" stroke="#cccccc" stroke-width="1" />

      <line x1="${paddingLeft - 3}" y1="${paddingTop + innerH / 2}" x2="${paddingLeft}" y2="${paddingTop + innerH / 2}" stroke="#cccccc" stroke-width="1" />

      <text x="${paddingLeft - 4}" y="${paddingTop + 8}" font-size="8" text-anchor="end">${maxLabel}</text>
      <text x="${paddingLeft - 4}" y="${paddingTop + innerH - 2}" font-size="8" text-anchor="end">${minLabel}</text>

      <line x1="${firstPos.x}" y1="${paddingTop + innerH}" x2="${firstPos.x}" y2="${paddingTop + innerH + 5}" stroke="#888888" stroke-width="1" />
      <line x1="${lastPos.x}"  y1="${paddingTop + innerH}" x2="${lastPos.x}"  y2="${paddingTop + innerH + 5}" stroke="#888888" stroke-width="1" />

      <text x="${firstPos.x}" y="${h - 2}" font-size="8" text-anchor="middle">${firstPos.monthShort}</text>
      <text x="${Math.min(lastPos.x, w - 8)}" y="${h - 2}" font-size="8" text-anchor="middle">${lastPos.monthShort}</text>

      ${polylines}
      ${circles}
    </svg>
  `;
}
