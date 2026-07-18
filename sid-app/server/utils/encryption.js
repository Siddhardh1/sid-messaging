const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
// Derive a 32-byte key from the environment variable or fallback safely
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'sid-default-secret-key-32charslong!';
const KEY = crypto.scryptSync(ENCRYPTION_KEY, 'sid-salt', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted
  };
}

function decrypt(ivHex, encryptedHex) {
  const iv = Buffer.from(ivHex, 'hex');
  const encryptedText = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
