// server/services/secretBox.js
// Encrypts small secrets (e.g. the SMTP password) before they are written to the database, so
// the password is never readable from a database dump / backup alone. AES-256-GCM; the key is
// SETTINGS_ENCRYPTION_KEY in .env (gitignored) and is generated automatically on first use.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '..', '.env');

function getKey() {
  let hex = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!/^[0-9a-f]{64}$/i.test(hex || '')) {
    hex = crypto.randomBytes(32).toString('hex');
    try {
      const current = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
      const eol = current.includes('\r\n') ? '\r\n' : '\n';
      const prefix = current && !current.endsWith('\n') ? eol : '';
      fs.appendFileSync(ENV_FILE, `${prefix}${eol}# Key that encrypts secrets stored in the database (SMTP password). Keep it with the database backups.${eol}SETTINGS_ENCRYPTION_KEY=${hex}${eol}`);
    } catch (err) {
      console.error('[secretBox] Could not persist SETTINGS_ENCRYPTION_KEY to .env:', err.message);
    }
    process.env.SETTINGS_ENCRYPTION_KEY = hex;
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

// Returns '' when the value is empty or cannot be decrypted (e.g. the key was lost).
function decrypt(payload) {
  if (!payload) return '';
  try {
    const [version, iv, tag, data] = String(payload).split(':');
    if (version !== 'v1') return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

module.exports = { encrypt, decrypt };
