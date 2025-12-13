require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const { Resend } = require("resend");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const ExcelJS = require("exceljs");

const { buildPublicDataPipeline } = require("./publicData");
const keuzes = require("./public/data/keuzes.json");

// ---- NO2 (µg/m³) validation rules ----
const MEASUREMENT_MIN = 0;
const MEASUREMENT_MAX = 200; // moet matchen met beheer.js

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

const apiPerMinuteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const apiPerDayLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 250,
  standardHeaders: true,
  legacyHeaders: false
});

const apiKeyRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many API key requests from this IP, please try again later.",
});

const apiKeyVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: "Too many API key verification attempts from this IP, please try again later.",
});

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // bv "473920"
}

function generateApiKey() {
  // 30 random alfanumerieke tekens (letters + cijfers)
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(30);
  let out = "";
  for (let i = 0; i < 30; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

async function ensureApiIndexes(db) {
  const apiCol = db.collection("API");

  // 1 key per email (case-insensitive via emailLower)
  await apiCol.createIndex(
    { emailLower: 1 },
    { unique: true, name: "uniq_emailLower" }
  );

  // apiKey moet uniek zijn, maar alleen voor records die al een apiKey hebben
  // (dus aanvragen die nog niet verified zijn geven geen unique-conflict)
  await apiCol.createIndex(
    { apiKey: 1 },
    {
      unique: true,
      name: "uniq_apiKey",
      partialFilterExpression: { apiKey: { $type: "string" } },
    }
  );

  // optioneel maar handig voor "1 jaar geleden" checks/queries
  await apiCol.createIndex({ lastCallAt: 1 }, { name: "idx_lastCallAt" });
}

async function requireApiKey(req, res, next) {
  try {
    // We accepteren de key via header: x-api-key (aanrader)
    // (optioneel fallback) of via query: ?apiKey=...
    const apiKey =
      String(req.headers["x-api-key"] || "").trim() ||
      String(req.query.apiKey || "").trim();

    if (!apiKey) {
      return res.status(401).json({
        error: "API key required. Provide it via the 'x-api-key' header.",
      });
    }

    const db = await getDb();
    const apiCol = db.collection("API");

    const record = await apiCol.findOne({ apiKey });

    if (!record || record.verified !== true) {
      return res.status(403).json({ error: "Invalid or unverified API key." });
    }

    // Handig voor later (rate limiting, logging, etc.)
    req.apiClient = {
      _id: record._id,
      emailLower: record.emailLower,
      apiKey: record.apiKey,
    };

    return next();
  } catch (err) {
    return next(err);
  }
}


async function requireApiKeyOrSession(req, res, next) {
  try {
    // 1) Beheer blijft simpel
    if (req.session && req.session.userId) {
      return next();
    }

    // 2) API key ophalen
    const apiKey =
      String(req.headers["x-api-key"] || "").trim() ||
      String(req.query.apiKey || "").trim();

    if (!apiKey) {
      return res.status(401).json({
        error: "API key required. Provide it via the 'x-api-key' header.",
      });
    }

    const db = await getDb();
    const apiCol = db.collection("API");

    const record = await apiCol.findOne({ apiKey });

    if (!record || record.verified !== true) {
      return res.status(403).json({ error: "Invalid or unverified API key." });
    }

    // ─────────────────────────────
    // 2.5) 1-JAAR INACTIVITEIT CHECK
    // ─────────────────────────────
    const now = new Date();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;

    if (record.lastCallAt && now - new Date(record.lastCallAt) > oneYearMs) {
      // Mail sturen met opdracht om nieuwe key aan te vragen
      try {
        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: record.emailLower,
          subject: "Je API key is verlopen – vraag een nieuwe aan",
          html: `
            <p>Je API key is verlopen omdat er langer dan 1 jaar geen API call is gedaan.</p>
            <p>Vraag een nieuwe API key aan via:</p>
            <p><strong>${process.env.BASE_URL || ""}/api-key</strong></p>
            <p>Daarna werkt je API weer.</p>
          `,
        });
      } catch (mailErr) {
        console.error("Failed to send expiry email:", mailErr);
      }

      // Verwijder het oude object (key ongeldig maken)
      await apiCol.deleteOne({ _id: record._id });

      return res.status(403).json({
        error: "API key expired due to inactivity. A new key is required.",
      });
    }

    // Als lastCallAt nog niet bestaat (eerste call), laten we het doorgaan.


    // ─────────────────────────────
    // 3) RATE LIMITING PER KEY
    // ─────────────────────────────

    // Minute window
    const minuteWindowMs = 60 * 1000;
    const dayWindowMs = 24 * 60 * 60 * 1000;

    let rate = record.rate || {};

    // ---- per minute ----
    if (
      !rate.minute ||
      !rate.minute.windowStart ||
      now - new Date(rate.minute.windowStart) >= minuteWindowMs
    ) {
      rate.minute = { windowStart: now, count: 1 };
    } else {
      rate.minute.count += 1;
      if (rate.minute.count > 20) {
        return res.status(429).json({
          error: "Rate limit exceeded (20 requests per minute).",
        });
      }
    }

    // ---- per day ----
    if (
      !rate.day ||
      !rate.day.windowStart ||
      now - new Date(rate.day.windowStart) >= dayWindowMs
    ) {
      rate.day = { windowStart: now, count: 1 };
    } else {
      rate.day.count += 1;
      if (rate.day.count > 250) {
        return res.status(429).json({
          error: "Rate limit exceeded (250 requests per day).",
        });
      }
    }

    // ─────────────────────────────
    // 4) LOG LAATSTE API CALL
    // ─────────────────────────────
    const lastCall = {
      method: req.method,
      path: req.originalUrl.split("?")[0],
      query: req.query || {},
      userAgent: req.headers["user-agent"] || "",
    };

    await apiCol.updateOne(
      { _id: record._id },
      {
        $set: {
          rate,
          lastCallAt: now,
          lastCall,
        },
      }
    );

    // beschikbaar voor routes
    req.apiClient = {
      _id: record._id,
      emailLower: record.emailLower,
      apiKey: record.apiKey,
    };

    next();
  } catch (err) {
    next(err);
  }
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
    .then(async (client) => {
      db = client.db(dbName);
      console.log("Client connected to database:", dbName);

      // ✅ Zorg dat de API collection indexes bestaan
      await ensureApiIndexes(db);

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
app.use(express.json()); // For JSON APIs (admin actions)

app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: uri, // dezelfde URI als je al gebruikt
      dbName: dbName, // zelfde dbName als je al hebt
      collectionName: "sessions",
      ttl: 60 * 60 * 1, // 1 uur (in seconden)
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 1, // 1 uur (in ms)
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
app.get("/data", toonData);

app.use("/api", requireApiKeyOrSession);

// ----- API Key pages -----
app.get("/api-key", (req, res) => {
  res.render("pages/apiKeyRequest", { error: null });
});

app.post("/api-key/request", apiKeyRequestLimiter, async (req, res, next) => {
  try {
    const db = await getDb();
    const apiCol = db.collection("API");

    const emailRaw = String(req.body.email || "").trim();
    if (!emailRaw) {
      return res.render("pages/apiKeyRequest", { error: "Voer een e-mailadres in." });
    }

    const emailLower = emailRaw.toLowerCase();

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minuten

    // Upsert: als user al bestaat, zetten we nieuwe verify-code (rotatie mogelijk)
    // We laten bestaande apiKey staan tot verificatie is gelukt.
    await apiCol.updateOne(
      { emailLower },
      {
        $set: {
          email: emailRaw,
          emailLower,
          "verify.code": code,
          "verify.expiresAt": expiresAt,
        },
        $setOnInsert: {
          verified: false,
          createdAt: new Date(),
          rate: {
            minute: { windowStart: new Date(0), count: 0 },
            day: { windowStart: new Date(0), count: 0 },
          },
        },
      },
      { upsert: true }
    );

    // Onthoud welke email we verifiëren (zoals login flow)
    req.session.pendingApiKeyEmail = emailLower;

    // Mail de verificatiecode
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: emailLower,
      subject: "Bevestig je email voor je API key",
      html: `
        <p>Je verificatiecode is: <strong>${code}</strong></p>
        <p>Deze code is 10 minuten geldig.</p>
        <p>Vul deze code in om je API key te ontvangen.</p>
      `,
    });

    return res.redirect("/api-key/verify");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.get("/api-key/verify", (req, res) => {
  if (!req.session.pendingApiKeyEmail) {
    return res.redirect("/api-key");
  }
  res.render("pages/apiKeyVerify", { error: null });
});

app.post("/api-key/verify", apiKeyVerifyLimiter, async (req, res, next) => {
  try {
    const emailLower = req.session.pendingApiKeyEmail;
    if (!emailLower) return res.redirect("/api-key");

    const code = String(req.body.code || "").trim();
    if (!code) {
      return res.render("pages/apiKeyVerify", { error: "Voer je verificatiecode in." });
    }

    const db = await getDb();
    const apiCol = db.collection("API");

    const record = await apiCol.findOne({ emailLower });

    if (
      !record ||
      !record.verify ||
      record.verify.code !== code ||
      !record.verify.expiresAt ||
      record.verify.expiresAt < new Date()
    ) {
      return res.render("pages/apiKeyVerify", { error: "Ongeldige of verlopen code." });
    }

    // Genereer + sla API key op
    const apiKey = generateApiKey();
    const now = new Date();

    await apiCol.updateOne(
      { _id: record._id },
      {
        $set: {
          apiKey,
          verified: true,
          createdAt: now,
        },
        $unset: {
          verify: "",
        },
      }
    );

    // Mail API key
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: emailLower,
      subject: "Je API key",
      html: `
        <p>Hier is je API key:</p>
        <p><strong>${apiKey}</strong></p>
        <p>Bewaar deze key goed. Je hebt deze nodig voor alle API calls.</p>
      `,
    });

    // Toon key 1x op success pagina
    delete req.session.pendingApiKeyEmail;
    req.session.apiKeyToShow = apiKey;

    return res.redirect("/api-key/success");
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.get("/api-key/success", (req, res) => {
  const apiKey = req.session.apiKeyToShow;
  if (!apiKey) return res.redirect("/api-key");

  // Laat 1x zien, daarna uit sessie halen
  delete req.session.apiKeyToShow;

  res.render("pages/apiKeySuccess", { apiKey });
});

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

// ----- Points API (admin) -----
app.post("/api/points", requireAuth, async (req, res, next) => {
  try {
    const { description, lat, lon, startDate, firstValue } = req.body;

    // Basisvalidatie
    if (!description || lat == null || lon == null || !startDate) {
      return res.status(400).json({
        error: "description, lat, lon and startDate are required.",
      });
    }

    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      return res.status(400).json({
        error: "lat and lon must be valid numbers.",
      });
    }

    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({
        error: "startDate must be a valid date (YYYY-MM-DD).",
      });
    }

    const db = await getDb();
    const collection = db.collection("Data");

    // Bepaal volgend point_number (optioneel, maar nice om te hebben)
    const last = await collection
      .find({})
      .sort({ point_number: -1 })
      .limit(1)
      .toArray();

    let nextPointNumber = 1;
    if (last.length && typeof last[0].point_number === "number") {
      nextPointNumber = last[0].point_number + 1;
    }

    const now = new Date();

    const doc = {
      point_number: nextPointNumber,
      coordinates: {
        lat: latNum,
        lon: lonNum,
      },
      description: String(description).trim(),
      start_date: start,
      measurements: [],
      active: true, // nieuw veld
      createdAt: now,
    };

    // Optioneel: eerste meting meteen toevoegen
    if (firstValue !== undefined && firstValue !== null && firstValue !== "") {
      const cleaned = String(firstValue).replace(",", ".");
      const v = Number(cleaned);

      if (!Number.isFinite(v) || v < MEASUREMENT_MIN || v > MEASUREMENT_MAX) {
        return res.status(400).json({
          error: `firstValue must be a number between ${MEASUREMENT_MIN} and ${MEASUREMENT_MAX} (µg/m³).`,
        });
      }

      doc.measurements.push({
        date: start,
        value: v,
        createdAt: now,
      });
    }

    const result = await collection.insertOne(doc);

    // Haal het volledige document weer op zodat we zeker alles meesturen
    const inserted = await collection.findOne({ _id: result.insertedId });

    res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.patch("/api/points/:id/active", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid point id." });
    }

    const isActive = !!active; // forceer booleaan

    const db = await getDb();
    const collection = db.collection("Data");

    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { active: isActive } }
    );

    if (!result.matchedCount) {
      return res.status(404).json({ error: "Measurement point not found." });
    }

    res.json({ success: true, active: isActive });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

// ----- Users API (admin) -----
app.get("/api/users", requireAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const usersCollection = db.collection("Users");

    const users = await usersCollection.find({}).sort({ email: 1 }).toArray();

    const cleaned = users.map((u) => ({
      _id: u._id.toString(),
      email: u.email,
      createdAt: u.createdAt ? u.createdAt.toISOString() : null,
    }));

    res.json(cleaned);
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.post("/api/users", requireAuth, async (req, res, next) => {
  try {
    let { email } = req.body;
    email = (email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const db = await getDb();
    const usersCollection = db.collection("Users");

    const existing = await usersCollection.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: "User already exists." });
    }

    const now = new Date();
    const result = await usersCollection.insertOne({
      email,
      createdAt: now,
    });

    res.status(201).json({
      _id: result.insertedId.toString(),
      email,
      createdAt: now.toISOString(),
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

app.delete("/api/users/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid user id." });
    }

    const db = await getDb();
    const usersCollection = db.collection("Users");
    const loginCodesCollection = db.collection("LoginCodes");

    const result = await usersCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (!result.deletedCount) {
      return res.status(404).json({ error: "User not found." });
    }

    // Clean up login codes for this user (userId is stored as string)
    await loginCodesCollection.deleteMany({ userId: id });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

// ----- Batch measurements API -----
// Verwacht: { year: 2025, month: 9, entries: [...] }
// Slaat op met date = eerste dag van die maand (UTC): 2025-09-01T00:00:00.000Z
app.post("/api/measurements/batch", requireAuth, async (req, res, next) => {
  try {
    // year/month negeren: we gebruiken altijd "nu"
    const { entries } = req.body;

    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "Invalid payload: entries must be an array." });
    }

    // Altijd huidige maand/jaar (server tijd)
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1; // 1-12

    const db = await getDb();
    const collection = db.collection("Data");

    // Period date = first day of the CURRENT month (UTC midnight)
    const measurementDate = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));

    const bulkOps = [];

    // Zelfde regel als in beheer.js:
    // per entry: óf een value (µg/m³), óf noMeasurement = true,
    // maar niet beide en niet allebei leeg.
    for (const [index, entry] of entries.entries()) {
      const pointId = entry.pointId;
      if (!pointId || !ObjectId.isValid(pointId)) {
        // Ongeldig pointId → sla deze entry over
        continue;
      }

      const rawValueString =
        entry.value === null || entry.value === undefined
          ? ""
          : String(entry.value).trim();

      const hasValue = rawValueString !== "";
      const hasNoMeasurement = !!entry.noMeasurement;

      // Niets ingevuld → request afkeuren
      if (!hasValue && !hasNoMeasurement) {
        return res.status(400).json({
          error:
            "Each measurement must either have a value or be marked as 'no measurement'.",
          index,
        });
      }

      // Beide ingevuld → ook afkeuren
      if (hasValue && hasNoMeasurement) {
        return res.status(400).json({
          error:
            "A measurement cannot have both a numeric value and 'no measurement' at the same time.",
          index,
        });
      }

      let value = null;

      if (hasValue) {
        const cleaned = rawValueString.replace(",", ".");
        const num = Number(cleaned);

        // alleen range toestaan
        if (!Number.isFinite(num) || num < MEASUREMENT_MIN || num > MEASUREMENT_MAX) {
          return res.status(400).json({
            error: `Measurement values must be between ${MEASUREMENT_MIN} and ${MEASUREMENT_MAX} (µg/m³).`,
            index,
          });
        }

        value = num;
      }

      const measurementDoc = { date: measurementDate };
      if (hasNoMeasurement) {
        measurementDoc.noMeasurement = true;
      } else {
        measurementDoc.value = value;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: new ObjectId(pointId) },
          update: { $push: { measurements: measurementDoc } },
        },
      });
    }

    if (!bulkOps.length) {
      return res.status(400).json({ error: "No valid entries to save." });
    }

    const result = await collection.bulkWrite(bulkOps);

    // handig voor debugging: geef terug voor welke periode is opgeslagen
    res.json({
      success: true,
      modifiedCount: result.modifiedCount,
      savedPeriod: { year: y, month: m },
      measurementDateUTC: measurementDate.toISOString(),
    });
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
        error:
          "If this email address exists in our system, we have sent you a login code.",
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
      code, // plain text; kan ook gehashed, maar voor nu prima
      expiresAt, // Date object
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
// async function toonIndex(req, res, next) {
//   try {
//     const db = await getDb();
//     const collection = db.collection("Data");
//     const data = await collection.find({}).toArray();
//     res.json(data);
//   } catch (err) {
//     console.error(err);
//     next(err);
//   }
//   try {
//     res.render("pages/index", {
//       keuzes: keuzes || [],
//       initialPoints: data || []
//     });
//   } catch (err) {
//     next(err);
//   }
// }

async function toonIndex(req, res, next) {
  try {
    const db = await getDb();
    const collection = db.collection("Data");

    // Zelfde engine als /api/public/data, maar nu voor server-side bootstrapping
    const q = {
      includeMeasurements: "true",
      limit: "200",         // zet hoger als je wil, maar let op performance/payload
      page: "1"
    };

    const { pipeline } = buildPublicDataPipeline(q);
    const items = await collection.aggregate(pipeline).toArray();

    res.render("pages/index", {
      keuzes: keuzes || {},
      initialPoints: items || []
    });
  } catch (err) {
    next(err);
  }
}

function toonLogin(req, res) {
  res.render("pages/login", { error: null });
}

function toonData(req, res) {
  res.render("pages/data", { error: null });
}

app.get("/loginVerification", (req, res) => {
  if (!req.session.pendingEmail) {
    return res.redirect("/login");
  }
  res.render("pages/loginVerification", { error: null });
});

function stripPaginationFromPipeline(pipeline) {
  return pipeline.filter((stage) => !("$skip" in stage) && !("$limit" in stage));
}

app.get("/downloads/data.json", async (req, res, next) => {
  try {
    const db = await getDb();
    const collection = db.collection("Data");

    const docs = await collection.find({}).project({ _id: 0 }).toArray();

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="data.json"');
    res.status(200).send(JSON.stringify(docs, null, 2));
  } catch (err) {
    next(err);
  }
});


function csvEscape(v) {
  const s = (v === undefined || v === null) ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

app.get("/downloads/data.csv", async (req, res, next) => {
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
      "no_measurement"
    ];

    let lines = [header.join(",")];

    for (const p of docs) {
      const lat = p?.coordinates?.lat ?? "";
      const lon = p?.coordinates?.lon ?? "";
      const startDate = p?.start_date ? new Date(p.start_date).toISOString() : "";
      const active = (p.active === undefined ? "" : p.active);

      const measurements = Array.isArray(p.measurements) ? p.measurements : [];

      if (measurements.length === 0) {
        lines.push([
          csvEscape(p.point_number),
          csvEscape(lat),
          csvEscape(lon),
          csvEscape(p.location ?? ""),
          csvEscape(p.description ?? ""),
          csvEscape(startDate),
          csvEscape(active),
          "",
          "",
          ""
        ].join(","));
        continue;
      }

      for (const m of measurements) {
        lines.push([
          csvEscape(p.point_number),
          csvEscape(lat),
          csvEscape(lon),
          csvEscape(p.location ?? ""),
          csvEscape(p.description ?? ""),
          csvEscape(startDate),
          csvEscape(active),
          csvEscape(m?.date ? new Date(m.date).toISOString() : ""),
          csvEscape(m?.value ?? ""),
          csvEscape(m?.noMeasurement ? "true" : "")
        ].join(","));
      }
    }

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="data.csv"');
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
});

app.get("/downloads/data.xlsx", async (req, res, next) => {
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
      { header: "active", key: "active" }
    ];

    const wsMeas = wb.addWorksheet("Measurements");
    wsMeas.columns = [
      { header: "point_number", key: "point_number" },
      { header: "measurement_date", key: "date" },
      { header: "measurement_value", key: "value" },
      { header: "no_measurement", key: "noMeasurement" }
    ];

    for (const p of docs) {
      wsPoints.addRow({
        point_number: p.point_number ?? "",
        location: p.location ?? "",
        lat: p?.coordinates?.lat ?? "",
        lon: p?.coordinates?.lon ?? "",
        description: p.description ?? "",
        start_date: p?.start_date ? new Date(p.start_date).toISOString() : "",
        active: (p.active === undefined ? "" : p.active)
      });

      const ms = Array.isArray(p.measurements) ? p.measurements : [];
      for (const m of ms) {
        wsMeas.addRow({
          point_number: p.point_number ?? "",
          date: m?.date ? new Date(m.date).toISOString() : "",
          value: (m?.value ?? ""),
          noMeasurement: (m?.noMeasurement ? true : "")
        });
      }
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="data.xlsx"');

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

app.get("/api/public/data", requireApiKey, async (req, res, next) => {
  try {
    const { pipeline, page, limit } = buildPublicDataPipeline(req.query);

    const db = await getDb();
    const collection = db.collection("Data");

    // 1) Items (pagination)
    const items = await collection.aggregate(pipeline).toArray();

    // 2) Totaal aantal records (count)
    const pipelineNoSkipLimit = pipeline.slice(0, -2);  // Verwijder $skip/$limit voor telling

    const countArr = await collection
      .aggregate([...pipelineNoSkipLimit, { $count: "count" }])
      .toArray();

    const totalCount = countArr[0]?.count ?? 0;

    res.json({
      page,
      limit,
      count: totalCount, // Totaal aantal matches
      items // Items van de huidige pagina
    });
  } catch (err) {
    next(err);
  }
});




























































// ----- Export / server start -----
module.exports = app;

if (process.env.VERCEL !== "1") {
  const server = app.listen(3000, "0.0.0.0", () =>
    console.log("http://localhost:3000")
  );
}