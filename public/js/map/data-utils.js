export function extractAvailableYears(points) {
  const years = new Set();

  points.forEach(point => {
    (point.measurements || []).forEach(m => {
      if (!m?.date) return;
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return;
      years.add(d.getFullYear());
    });
  });

  return Array.from(years).sort((a, b) => a - b);
}

export function buildAvailableMonthsByYear(points) {
  const map = {}; // year -> Set(monthIndex)

  points.forEach(point => {
    (point.measurements || []).forEach(m => {
      if (!m?.date) return;
      const d = new Date(m.date);
      if (Number.isNaN(d.getTime())) return;

      const y = d.getFullYear();
      const mo = d.getMonth();

      if (!map[y]) map[y] = new Set();
      map[y].add(mo);
    });
  });

  const out = {};
  Object.keys(map).forEach(y => {
    out[y] = Array.from(map[y]).sort((a, b) => a - b);
  });

  return out;
}

export function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = (sortedArr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const w = idx - lo;
  return sortedArr[lo] * (1 - w) + sortedArr[hi] * w;
}
