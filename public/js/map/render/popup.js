import { VALUE_SUFFIX } from "../constants.js";
import { getColor } from "../colors.js";
import { normalizeForColor, getCategory } from "../scales.js";
import { buildSparklineSvg } from "./sparkline.js";

export function buildPopupHtml({ point, measurement, selectedYear, selectedMonthIndex, activeScale }) {
  const lat = point.coordinates.lat;
  const lon = point.coordinates.lon;

  const title = point.location || point.description || "Measurement point";
  const description = point.description || "";

  const dateStr = new Date(measurement.date).toISOString().slice(0, 10);
  const isNo = !!measurement.noMeasurement;

  const yearMeasurements = (point.measurements || [])
    .filter(m => {
      if (!m?.date) return false;
      const d = new Date(m.date);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === selectedYear;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let color = "rgb(200,200,200)";
  let value = null;

  if (!isNo) {
    value = measurement.value;
    color = getColor(normalizeForColor(value, activeScale));
  }

  const category = isNo ? "No measurement possible" : getCategory(value, activeScale);
  const sparklineSvg = buildSparklineSvg(yearMeasurements, activeScale);

  const chipsHtml =
    yearMeasurements.length
      ? yearMeasurements.map(m => {
          const d = new Date(m.date);
          const monthName = d.toLocaleString("en-US", { month: "short" });
          const mIdx = d.getMonth();

          const isSelectedMonth = mIdx === selectedMonthIndex;
          const borderColor = isSelectedMonth ? "#000000" : "#e0e0e0";
          const fontWeight = isSelectedMonth ? "600" : "400";

          const isNoChip = !!m.noMeasurement || typeof m.value !== "number" || Number.isNaN(m.value);
          const chipColor = isNoChip ? "rgb(200,200,200)" : getColor(normalizeForColor(m.value, activeScale));
          const chipText = isNoChip ? `${monthName}: n/a` : `${monthName}: ${m.value.toFixed(2)}${VALUE_SUFFIX}`;

          return `
            <span style="
              background:${chipColor};
              border-radius:999px;
              padding:2px 6px;
              font-size:10px;
              border:2px solid ${borderColor};
              font-weight:${fontWeight};
              color:#000000;
            ">${chipText}</span>
          `;
        }).join("")
      : '<span style="font-size:10px; color:#888;">No data for this year</span>';

  const valueBlock = isNo
    ? `
      <div style="font-size: 10px; text-transform: uppercase; color:#888;">Value</div>
      <div style="
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(0,0,0,0.15);
        background: rgb(200,200,200);
        font-weight: 600;
      ">n/a</div>
    `
    : `
      <div style="font-size: 10px; text-transform: uppercase; color:#888;">Value</div>
      <div style="
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(0,0,0,0.15);
        background: ${color};
        font-weight: 600;
      ">${value.toFixed(2)}${VALUE_SUFFIX}</div>
    `;

  return `
    <div style="font-family: Arial, sans-serif; font-size: 12px; max-width: 300px;">
      <h4 style="margin: 0 0 4px; font-size: 14px;">${title}</h4>

      ${description ? `<div style="font-size: 11px; color:#666; margin-bottom: 6px;">${description}</div>` : ""}

      <div style="display: flex; gap: 10px; margin-bottom: 6px;">
        <div style="flex: 1;">${valueBlock}</div>
        <div style="flex: 1;">
          <div style="font-size: 10px; text-transform: uppercase; color:#888;">Month</div>
          <div>${dateStr}</div>
        </div>
      </div>

      <div style="font-size: 11px; color:#555; margin-bottom: 6px;">
        <span style="font-size:10px; text-transform:uppercase; color:#888;">${activeScale.label} context</span><br>
        <strong>${category}</strong>
      </div>

      <div style="margin-bottom: 6px;">
        <div style="font-size:10px; text-transform:uppercase; color:#888; margin-bottom:4px;">
          Monthly values in ${selectedYear}
        </div>
        <div style="margin-bottom:4px;">${sparklineSvg}</div>
        <div style="display:flex; flex-wrap:wrap; gap:4px;">${chipsHtml}</div>
      </div>

      <div style="font-size: 10px; color:#666; display:flex; justify-content:space-between;">
        <span>Lat: ${lat.toFixed(4)}</span>
        <span>Lon: ${lon.toFixed(4)}</span>
      </div>
    </div>
  `;
}
