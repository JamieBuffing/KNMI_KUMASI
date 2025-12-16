require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { EJSON } = require("bson");

const uri = process.env.MONGODB_URI && process.env.MONGODB_URI.trim();
const dbName = process.env.MONGODB_DB_NAME && process.env.MONGODB_DB_NAME.trim();

if (!uri || !dbName) {
  console.error("MONGODB_URI of MONGODB_DB_NAME mist in .env");
  process.exit(1);
}

async function seedMeasurementPoints(db) {
  const collection = db.collection("Data");

  // 👉 pad naar jouw JSON bestand
  const filePath = path.join(__dirname, "/public/data/data.json");

  // Lees & parse Mongo Extended JSON
  const raw = fs.readFileSync(filePath, "utf8");
  const docs = EJSON.parse(raw); // ← cruciaal

  if (!Array.isArray(docs)) {
    throw new Error("JSON moet een array van documenten zijn");
  }

  // (optioneel maar handig tijdens development)
  await collection.deleteMany({});
  console.log("Collection opgeschoond");

  const result = await collection.insertMany(docs);
  console.log(`Inserted: ${result.insertedCount} measurement points`);
}

async function main() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);

    await seedMeasurementPoints(db);

    console.log("Klaar met seeden!");
  } catch (err) {
    console.error("Fout tijdens seeden:", err);
  } finally {
    await client.close();
  }
}

main();
