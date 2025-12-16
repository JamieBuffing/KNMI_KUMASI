const getDb = require("../db/getDb");
const csvEscape = require("../helpers/csvEscape");

module.exports = async function getDownloadCsv(req, res, next) {
  try {
    const db = await getDb();
    const collection = db.collection("Data");
    const docs = await collection.find({}).project({ _id: 0 }).toArray();

    const header = [
      "point_number",
      "lat",
      "lon",
      "location",
      "description",
      "start_date",
      "active",
      "measurement_date",
      "measurement_value",
      "no_measurement",
    ];

    const lines = [header.join(",")];

    for (const p of docs) {
      const lat = p?.coordinates?.lat ?? "";
      const lon = p?.coordinates?.lon ?? "";
      const startDate = p?.start_date ? new Date(p.start_date).toISOString() : "";
      const active = p.active === undefined ? "" : p.active;

      const measurements = Array.isArray(p.measurements) ? p.measurements : [];

      if (measurements.length === 0) {
        lines.push(
          [
            csvEscape(p.point_number),
            csvEscape(lat),
            csvEscape(lon),
            csvEscape(p.location ?? ""),
            csvEscape(p.description ?? ""),
            csvEscape(startDate),
            csvEscape(active),
            "",
            "",
            "",
          ].join(",")
        );
        continue;
      }

      for (const m of measurements) {
        lines.push(
          [
            csvEscape(p.point_number),
            csvEscape(lat),
            csvEscape(lon),
            csvEscape(p.location ?? ""),
            csvEscape(p.description ?? ""),
            csvEscape(startDate),
            csvEscape(active),
            csvEscape(m?.date ? new Date(m.date).toISOString() : ""),
            csvEscape(m?.value ?? ""),
            csvEscape(m?.noMeasurement ? "true" : ""),
          ].join(",")
        );
      }
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="data.csv"');
    res.status(200).send(lines.join("\n"));
  } catch (err) {
    next(err);
  }
};
