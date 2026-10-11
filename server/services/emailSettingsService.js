// server/services/emailSettingsService.js
// Admin-managed sender account for the Survey Upload Reminder emails ("Setting Email" menu).
// Settings live in the database (px_email_settings); the password is stored encrypted and is
// NEVER returned by any API. If nothing is configured in the database the legacy SMTP_* values
// from .env are still honoured, and if neither exists sending is skipped gracefully.
const nodemailer = require('nodemailer');
const storage = require('../db/storage');
const { encrypt, decrypt } = require('./secretBox');

const PROVIDERS = {
  GMAIL: { host: 'smtp.gmail.com', port: 465, secure: true },
  SMTP: null // custom host (e.g. an internal on-premise relay)
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class SettingsError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

// Settings as the UI sees them: everything except the password.
function toPublic(s) {
  return {
    enabled: !!s.enabled,
    provider: s.provider,
    smtp_host: s.smtp_host,
    smtp_port: s.smtp_port,
    smtp_secure: !!s.smtp_secure,
    smtp_user: s.smtp_user,
    from_name: s.from_name,
    from_email: s.from_email,
    has_password: !!s.smtp_password_enc,
    // false = a password is stored but cannot be decrypted (the encryption key changed/was lost) → must be re-entered
    password_readable: !s.smtp_password_enc || !!decrypt(s.smtp_password_enc),
    updated_at: s.updated_at || null,
    env_fallback_available: !!process.env.SMTP_HOST
  };
}

async function getPublicSettings() {
  return toPublic(await storage.getEmailSettings());
}

async function updateSettings(input = {}) {
  const current = await storage.getEmailSettings();
  const provider = String(input.provider || current.provider || 'GMAIL').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) throw new SettingsError('Provider harus GMAIL atau SMTP.');

  const next = { ...current, provider, enabled: input.enabled !== undefined ? !!input.enabled : !!current.enabled };
  next.smtp_user = input.smtp_user !== undefined ? String(input.smtp_user).trim() : current.smtp_user;
  next.from_name = input.from_name !== undefined ? String(input.from_name).trim() : current.from_name;
  next.from_email = input.from_email !== undefined ? String(input.from_email).trim() : current.from_email;

  if (PROVIDERS[provider]) {
    Object.assign(next, { smtp_host: PROVIDERS[provider].host, smtp_port: PROVIDERS[provider].port, smtp_secure: PROVIDERS[provider].secure });
  } else {
    next.smtp_host = input.smtp_host !== undefined ? String(input.smtp_host).trim() : current.smtp_host;
    next.smtp_port = input.smtp_port !== undefined ? parseInt(input.smtp_port, 10) : current.smtp_port;
    next.smtp_secure = input.smtp_secure !== undefined ? !!input.smtp_secure : !!current.smtp_secure;
    if (!Number.isInteger(next.smtp_port) || next.smtp_port < 1 || next.smtp_port > 65535) throw new SettingsError('Port harus angka 1 - 65535.');
  }

  if (next.smtp_user.length > 200 || next.from_name.length > 200 || next.from_email.length > 200 || (next.smtp_host || '').length > 200) {
    throw new SettingsError('Isian terlalu panjang (maksimal 200 karakter).');
  }
  if (next.from_email && !EMAIL_RE.test(next.from_email)) throw new SettingsError('Format "Email Pengirim" tidak valid.');
  if (provider === 'GMAIL' && next.smtp_user && !EMAIL_RE.test(next.smtp_user)) throw new SettingsError('Username Gmail harus berupa alamat email.');

  if (input.clear_password) next.smtp_password_enc = '';
  else if (typeof input.smtp_password === 'string' && input.smtp_password.length > 0) {
    if (input.smtp_password.length > 200) throw new SettingsError('Password terlalu panjang.');
    next.smtp_password_enc = encrypt(input.smtp_password);
  }

  if (next.enabled) {
    if (!next.smtp_host) throw new SettingsError('SMTP Host wajib diisi.');
    if (!next.smtp_user) throw new SettingsError('Username / Email akun pengirim wajib diisi.');
    if (!next.smtp_password_enc) throw new SettingsError('Password (untuk Gmail: App Password) wajib diisi sebelum email diaktifkan.');
  }
  await storage.saveEmailSettings(next);
  return getPublicSettings();
}

// Builds the transporter that reminders / test emails use right now. Re-read on every call so
// a change in the menu takes effect immediately (no restart, no stale cache).
async function buildTransport() {
  const s = await storage.getEmailSettings();
  const password = decrypt(s.smtp_password_enc);
  const common = { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 };

  if (s.enabled && s.smtp_host && s.smtp_user && password) {
    const fromEmail = s.from_email || s.smtp_user;
    return {
      source: 'database',
      provider: s.provider,
      from: s.from_name ? `"${s.from_name.replace(/"/g, '')}" <${fromEmail}>` : fromEmail,
      transporter: nodemailer.createTransport({
        host: s.smtp_host, port: s.smtp_port, secure: !!s.smtp_secure,
        auth: { user: s.smtp_user, pass: password }, ...common
      })
    };
  }
  if (process.env.SMTP_HOST) {
    return {
      source: 'env',
      provider: 'SMTP',
      from: process.env.SMTP_FROM || 'people-experience@cimbniaga.co.id',
      transporter: nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined, ...common
      })
    };
  }
  return { source: 'none', provider: null, from: null, transporter: null };
}

// Human-readable explanation for the failures people actually hit.
function explainError(err, provider) {
  const code = err && err.code;
  if (code === 'EAUTH') {
    return provider === 'GMAIL'
      ? 'Login ditolak oleh Gmail. Gmail tidak menerima password akun biasa — aktifkan Verifikasi 2 Langkah lalu buat "App Password" (16 karakter) dan isi di kolom password.'
      : 'Login ditolak oleh server email (username/password salah).';
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ENOTFOUND') {
    return `Tidak dapat terhubung ke server email (${err.message}). Periksa koneksi internet / host / port.`;
  }
  return err && err.message ? err.message : 'Gagal mengirim email.';
}

async function sendTestEmail(to) {
  const s = await storage.getEmailSettings();
  const recipient = String(to || s.from_email || s.smtp_user || '').trim();
  if (!EMAIL_RE.test(recipient)) throw new SettingsError('Alamat email tujuan test tidak valid.');

  const t = await buildTransport();
  if (!t.transporter) {
    return { sent: false, error: 'Email belum dikonfigurasi atau belum diaktifkan. Isi akun pengirim lalu aktifkan terlebih dahulu.' };
  }
  try {
    const info = await t.transporter.sendMail({
      from: t.from,
      to: recipient,
      subject: '[PX] Test Email Pengingat Upload Survei',
      text: 'Ini adalah email TEST dari sistem People Experience (PX) CIMB Niaga.\n\nJika Anda menerima email ini, pengaturan email pengirim reminder sudah benar. Tidak ada tindakan yang diperlukan.\n\nSistem People Experience CIMB Niaga'
    });
    return { sent: true, to: recipient, source: t.source, accepted: info.accepted || [], message_id: info.messageId };
  } catch (err) {
    return { sent: false, to: recipient, source: t.source, error: explainError(err, t.provider) };
  }
}

module.exports = { getPublicSettings, updateSettings, buildTransport, sendTestEmail, SettingsError };
