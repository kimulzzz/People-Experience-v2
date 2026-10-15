// scripts/create-admin.js
// Creates a login account with role ADMIN (the first one after install, or any later emergency admin).
//
//   npm run auth:create-admin                          admin account "admin"
//   npm run auth:create-admin -- --username 8801923 --name "Nama Lengkap" --email nama@cimbniaga.co.id
//   npm run auth:create-admin -- --username admin --reset-password     new random password for an EXISTING account
//
// The password is RANDOM, printed once to this console and never stored in clear text (scrypt hash only).
// The account must change it at the first login. There is no default password anywhere in the code.
// Works on the active backend (STORAGE_BACKEND in .env: sql = px_users, json = server/data/auth.json).
// Safe to re-run: an existing username is left alone unless --reset-password is given.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const storage = require('../server/db/storage');
const { hashPassword, generateTempPassword } = require('../server/services/authService');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

async function main() {
  const username = String(arg('username', 'admin')).trim();
  const fullName = String(arg('name', 'Administrator PX')).trim();
  const email = String(arg('email', '')).trim();
  const resetPassword = process.argv.includes('--reset-password');
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) throw new Error('Username 3-50 karakter: huruf, angka, titik, minus, garis bawah.');

  // A fresh SQL database may not have the auth tables yet (the server creates them at boot).
  if (typeof storage.applySchema === 'function') await storage.applySchema();

  const existing = await storage.getUserByUsername(username);
  const password = generateTempPassword();
  const password_hash = await hashPassword(password);

  if (existing) {
    if (!resetPassword) {
      console.log(`Akun "${username}" sudah ada - tidak diubah. Gunakan --reset-password untuk membuat password acak baru.`);
      return;
    }
    await storage.updateUser(existing.user_id, { password_hash, must_change_password: true, failed_attempts: 0, locked_until: null, is_active: true });
    await storage.deleteSessionsForUser(existing.user_id);
  } else {
    await storage.createUser({ username, full_name: fullName, email, role: 'ADMIN', password_hash, is_active: true, must_change_password: true });
  }

  console.log('==============================================================');
  console.log(existing ? 'Password akun Admin direset.' : 'Akun Admin dibuat.');
  console.log(`  Username           : ${username}`);
  console.log(`  Password sementara : ${password}`);
  console.log('  Catat sekarang - password ini TIDAK akan ditampilkan lagi.');
  console.log('  Anda wajib menggantinya pada login pertama.');
  console.log('==============================================================');
}

main()
  .then(() => (typeof storage.close === 'function' ? storage.close() : null))
  .catch(async err => {
    console.error('CREATE_ADMIN_FAILED:', err.message);
    try { if (typeof storage.close === 'function') await storage.close(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
