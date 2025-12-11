require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const keuzes = require("./public/data/keuzes.json");

// ----- DB config from .env -----
const uri = process.env.MONGODB_URI && process.env.MONGODB_URI.trim();
const dbName = process.env.MONGODB_DB_NAME && process.env.MONGODB_DB_NAME.trim();

if (!uri || !dbName) {
  console.error("MONGODB_URI or MONGODB_DB_NAME missing in .env");
  process.exit(1);
}

// ----- DB connect helper -----
let db = null;
let dbPromise = null;

async function getDb() {
  // Als er al een db-verbinding is, gebruik die
  if (db) return db;

  // Als we al bezig zijn met verbinden, wacht daarop
  if (dbPromise) return dbPromise;

  // Nieuwe verbinding opzetten
  const client = new MongoClient(uri);

  dbPromise = client
    .connect()
    .then((client) => {
      db = client.db(dbName);
      console.log("Client connected to database:", dbName);
      return db;
    })
    .catch((error) => {
      console.error("Database connection error:", error);
      // Als het misgaat, dbPromise resetten zodat we het later opnieuw kunnen proberen
      dbPromise = null;
      throw error;
    });

  return dbPromise;
}

// ----- Express setup -----
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "public/views"));

// voor POST /loginform
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use("/js", express.static(path.join(__dirname, "public/js")));
app.use("/img", express.static(path.join(__dirname, "public/img")));
app.use("/leafletcss", express.static(path.join(__dirname, "public/css/leaflet")));
app.use("/leafletjs", express.static(path.join(__dirname, "public/js/leaflet")));

// ----- Routes -----
app.get("/", toonIndex);
app.get("/login", toonLogin);

app.get("/api/keuzes", (req, res) => {
  res.json(keuzes);
});

app.get("/api/data", async (req, res, next) => {
  try {
    const db = await getDb();
    const collection = db.collection("Data");
    const data = await collection.find({}).toArray();
    res.json(data);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.post("/loginform", (req, res) => {
  const loginAttempt = req.body;
  console.log(loginAttempt);

  res.render("pages/index");
});

// ----- Route handlers -----
async function toonIndex(req, res, next) {
  try {
    const db = await getDb();
    const collection = db.collection("Data");
    const points = await collection.find({}).toArray();

    res.render("pages/index", { points });
  } catch (err) {
    console.error(err);
    next(err);
  }
}

function toonLogin(req, res) {
  res.render("pages/login");
}

// ----- Export / server start -----
module.exports = app;

if (process.env.VERCEL !== "1") {
  const server = app.listen(3000, "0.0.0.0", () =>
    console.log("http://localhost:3000")
  );
}
