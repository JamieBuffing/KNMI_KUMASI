const ExcelJS = require("exceljs");
const getDb = require("../db/getDb");

module.exports = async function getDownloadXlsx(req, res, next) {
  try {
    const db = await getDb();
    const collection = db.collection("Data");
    const docs = await collection.find({}).project({ _id: 0 }).toArray();

    const wb = new ExcelJS.Workbook();

    const wsPoints = wb.addWorksheet("Points");
    wsPoints.columns = [
      { header: "point_number", key: "point_number" },
      { header: "location", key: "location" },
      { header: "lat", key: "lat" },
      { header: "lon", key: "lon" },
      { header: "description", key: "description" },
      { header: "start_date", key: "start_date" },
      { header: "active", key: "active" },
    ];

    const wsMeas = wb.addWorksheet("Measurements");
    wsMeas.columns = [
      { header: "point_number", key: "point_number" },
      { header: "measurement_date", key: "date" },
      { header: "measurement_value", key: "value" },
      { header: "no_measurement", key: "noMeasurement" },
    ];

    for (const p of docs) {
      wsPoints.addRow({
        point_number: p.point_number ?? "",
        location: p.location ?? "",
        lat: p?.coordinates?.lat ?? "",
        lon: p?.coordinates?.lon ?? "",
        description: p.description ?? "",
        start_date: p?.start_date ? new Date(p.start_date).toISOString() : "",
        active: p.active === undefined ? "" : p.active,
      });

      const ms = Array.isArray(p.measurements) ? p.measurements : [];
      for (const m of ms) {
        wsMeas.addRow({
          point_number: p.point_number ?? "",
          date: m?.date ? new Date(m.date).toISOString() : "",
          value: m?.value ?? "",
          noMeasurement: m?.noMeasurement ? true : "",
        });
      }
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="data.xlsx"');

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};
