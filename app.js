require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const { Resend } = require("resend");
const rateLimit = require("express-rate-limit");

const keuzes = require("./public/data/keuzes.json");

// ----- DB config from .env -----
const uri = process.env.MONGODB_URI && process.env.MONGODB_URI.trim();
const dbName = process.env.MONGODB_DB_NAME && process.env.MONGODB_DB_NAME.trim();

if (!uri || !dbName) {
  console.error("MONGODB_URI or MONGODB_DB_NAME missing in .env");
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts from this IP, please try again later.",
});

const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: "Too many verification attempts from this IP, please try again later.",
});

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // bv "473920"
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
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
app.set("trust proxy", 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: uri,           // dezelfde URI als je al gebruikt
      dbName: dbName,          // zelfde dbName als je al hebt
      collectionName: "sessions",
      ttl: 60 * 60 * 1,        // 8 uur (in seconden)
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 1, // 8 uur (in ms)
    },
  })
);


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

app.get("/beheer", requireAuth, (req, res) => {
  res.render("pages/beheer");
});

// ➕ Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.post("/loginform", loginLimiter, async (req, res, next) => {
  try {
    const db = await getDb();
    const { email } = req.body;

    if (!email) {
      return res.render("pages/login", { error: "Voer een e-mailadres in." });
    }

    // We gaan ervan uit dat je een "Users" collectie hebt met een veld "email"
    const usersCollection = db.collection("Users");
    const user = await usersCollection.findOne({
      email: email.toLowerCase(),
    });

    if (!user) {
      // E-mail niet bekend in de DB → foutmelding op de loginpagina
      return res.render("pages/login", {
        error: "If this email address exists in our system, we have sent you a login code.",
      });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minuten geldig

    // Code in de database opslaan
    const loginCodesCollection = db.collection("LoginCodes");

    // Oude codes voor deze user eventueel opruimen (optioneel, maar netjes)
    await loginCodesCollection.deleteMany({
      email: user.email,
    });

    // Nieuwe code invoegen
    await loginCodesCollection.insertOne({
      email: user.email,
      code,                      // plain text; kan ook gehashed, maar voor nu prima
      expiresAt,                 // Date object
      userId: user._id.toString(),
      used: false,
      createdAt: new Date(),
    });

    // Onthoud naar welk e-mailadres we de code stuurden
    req.session.pendingEmail = user.email;

    // E-mail versturen via Resend
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: user.email,
      subject: "Je login code",
      html: `
        <p>Je login code is: <strong>${code}</strong></p>
        <p>Deze code is 10 minuten geldig.</p>
      `,
    });

    // Ga naar de pagina waar je de code invult
    res.redirect("/loginVerification");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.post("/loginVerification", verifyCodeLimiter, async (req, res, next) => {
  try {
    const rawCode = req.body.code;
    const email = req.session.pendingEmail;

    if (!email) {
      return res.redirect("/login");
    }

    const code = String(rawCode || "").trim();

    const db = await getDb();
    const loginCodesCollection = db.collection("LoginCodes");

    // Zoeken naar een niet-gebruikte code voor dit emailadres
    const record = await loginCodesCollection.findOne({
      email,
      code,
      used: false,
    });

    if (!record || !record.expiresAt || record.expiresAt < new Date()) {
      return res.render("pages/loginVerification", {
        error: "Ongeldige of verlopen code.",
      });
    }

    // Markeer code als gebruikt
    await loginCodesCollection.updateOne(
      { _id: record._id },
      { $set: { used: true, usedAt: new Date() } }
    );

    delete req.session.pendingEmail;
    req.session.userId = record.userId;

    res.redirect("/beheer");
  } catch (err) {
    console.error(err);
    next(err);
  }
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
  res.render("pages/login", { error: null });
}

app.get("/loginVerification", (req, res) => {
  if (!req.session.pendingEmail) {
    return res.redirect("/login");
  }
  res.render("pages/loginVerification", { error: null });
});

// ----- Export / server start -----
module.exports = app;

if (process.env.VERCEL !== "1") {
  const server = app.listen(3000, "0.0.0.0", () =>
    console.log("http://localhost:3000")
  );
}
