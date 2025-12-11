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

// make db available later
let db;

// ----- Express setup -----
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "public/views"));

// for POST /loginform
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use("/js", express.static(path.join(__dirname, "public/js")));
app.use("/img", express.static(path.join(__dirname, "public/img")));
app.use("/leafletcss", express.static(path.join(__dirname, "public/css/leaflet")));
app.use("/leafletjs", express.static(path.join(__dirname, "public/js/leaflet")));

app.get("/", toonIndex);
app.get("/login", toonLogin);

app.get("/api/keuzes", (req, res) => {
  res.json(keuzes);
});

app.get("/api/data", async (req, res) => {
  const collection = db.collection("Data");
  const data = await collection.find({}).toArray();
  res.json(data);
});


app.post("/loginform", (req, res) => {
  const loginAttempt = req.body;
  console.log(loginAttempt);

  res.render("pages/index");
});

async function toonIndex(req, res, next) {
  try {
    if (!db) {
      return res.status(500).send("Database not initialized");
    }

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



// ----- DB connect -----
async function connectDB() {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    db = client.db(dbName);

    console.log("Client connected to database:", dbName);
  } catch (error) {
    console.log("Database connection error:", error);
  }
}

connectDB();

// ----- Export / server start -----
module.exports = app;

if (process.env.VERCEL !== "1") {
  const server = app.listen(3000, "0.0.0.0", () =>
    console.log("http://localhost:3000")
  );
}
