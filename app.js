require("dotenv").config();

const express = require("express");
const app = express();
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;

// -------------------- helpers / db --------------------
const getDb = require("./server/db/getDb");

// -------------------- middleware --------------------
const requireUserInUsers = require("./server/helpers/requireUserInUsers");
const requireApiKeyStrict = require("./server/helpers/requireApiKeyStrict");

// -------------------- rate limiters --------------------
const loginLimiter = require("./server/helpers/limiters/loginLimiter");
const verifyCodeLimiter = require("./server/helpers/limiters/verifyCodeLimiter");
const apiKeyRequestLimiter = require("./server/helpers/limiters/apiKeyRequestLimiter");
const apiKeyVerifyLimiter = require("./server/helpers/limiters/apiKeyVerifyLimiter");

// -------------------- GET handlers --------------------
const getIndex = require("./server/appGet/getIndex");
const getData = require("./server/appGet/getData");
const getLogin = require("./server/appGet/getLogin");
const getLoginVerification = require("./server/appGet/getLoginVerification");
const getBeheer = require("./server/appGet/getBeheer");
const getLogout = require("./server/appGet/getLogout");

const getApiKey = require("./server/appGet/getApiKey");
const getApiKeyVerify = require("./server/appGet/getApiKeyVerify");
const getApiKeySuccess = require("./server/appGet/getApiKeySuccess");

const getDownloadJson = require("./server/appGet/getDownloadJson");
const getDownloadCsv = require("./server/appGet/getDownloadCsv");
const getDownloadXlsx = require("./server/appGet/getDownloadXlsx");

// -------------------- POST handlers --------------------
const postLoginForm = require("./server/post/postLoginForm");
const postLoginVerification = require("./server/post/postLoginVerification");
const postApiKeyRequest = require("./server/post/postApiKeyRequest");
const postApiKeyVerify = require("./server/post/postApiKeyVerify");

// -------------------- API routers --------------------
const publicApi = require("./server/api/publicApi");
const adminApi = require("./server/api/adminApi");

// -------------------- Express setup --------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "public/views"));
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use("/js", express.static(path.join(__dirname, "public/js")));
app.use("/img", express.static(path.join(__dirname, "public/img")));
app.use("/leafletcss", express.static(path.join(__dirname, "public/css/leaflet")));
app.use("/leafletjs", express.static(path.join(__dirname, "public/js/leaflet")));

// -------------------- session --------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-dev-secret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      dbName: process.env.MONGODB_DB_NAME,
      collectionName: "sessions",
      ttl: 60 * 60,
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60,
    },
  })
);

// -------------------- Pages --------------------
app.get("/", getIndex);
app.get("/data", getData);

app.get("/login", getLogin);
app.post("/loginform", loginLimiter, postLoginForm);

app.get("/loginVerification", getLoginVerification);
app.post("/loginVerification", verifyCodeLimiter, postLoginVerification);

app.get("/beheer", requireUserInUsers, getBeheer);
app.get("/logout", getLogout);

// -------------------- API key pages --------------------
app.get("/api-key", getApiKey);
app.post("/api-key/request", apiKeyRequestLimiter, postApiKeyRequest);

app.get("/api-key/verify", getApiKeyVerify);
app.post("/api-key/verify", apiKeyVerifyLimiter, postApiKeyVerify);

app.get("/api-key/success", getApiKeySuccess);

// -------------------- APIs --------------------
app.use("/api/public", publicApi);
app.use("/api", adminApi);

// -------------------- downloads --------------------
app.get("/downloads/data.json", getDownloadJson);
app.get("/downloads/data.csv", getDownloadCsv);
app.get("/downloads/data.xlsx", getDownloadXlsx);

// -------------------- export / local start --------------------
module.exports = app;

if (process.env.VERCEL !== "1") {
  app.listen(3000, "0.0.0.0", () => {
    console.log("Server running at http://localhost:3000");
  });
}
