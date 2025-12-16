const getDb = require("../db/getDb");

module.exports = async function postLoginVerification(req, res, next) {
  try {
    const rawCode = req.body.code;
    const email = req.session.pendingEmail;

    if (!email) return res.redirect("/login");

    const code = String(rawCode || "").trim();

    const db = await getDb();
    const loginCodesCollection = db.collection("LoginCodes");

    const record = await loginCodesCollection.findOne({
      email,
      code,
      used: false,
    });

    if (!record || !record.expiresAt || record.expiresAt < new Date()) {
      return res.render("pages/loginVerification", { error: "Ongeldige of verlopen code." });
    }

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
};
