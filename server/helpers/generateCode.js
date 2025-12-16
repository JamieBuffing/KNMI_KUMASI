const bcrypt = require('bcryptjs');

async function generateCode() {
  const codeBase = String(Math.floor(100000 + Math.random() * 900000));
  const code = await hashData(codeBase);
  return code;
}

async function hashData(data) {
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedData = await bcrypt.hash(data, salt);
    return hashedData;
  } catch (error) {
    console.error("Error hashing data:", error);
    throw error;
  }
}

module.exports = generateCode;
