// server/services/reminderService.js
/**
 * Survey Upload Reminder Service — 100% On-Premise
 *
 * Tracks metrics whose "Update Data Berkala" (Periodic Data Update) parameter says a human
 * PIC must manually upload a survey CSV, and reminds that PIC by email as the configured
 * "Batas Waktu Upload Survey" (Survey Upload Deadline) approaches or has passed.
 *
 * Email is sent via a configurable on-premise/internal SMTP relay (nodemailer). No 3rd-party
 * cloud email API is used — if SMTP_HOST is not configured, reminders are still computed and
 * returned/logged, but sending is skipped gracefully (never crashes the app).
 */
const storage = require('../db/storage');
const { buildTransport } = require('./emailSettingsService');

const REMINDER_LEAD_DAYS = 5; // start warning this many days before the deadline

// The sender account comes from the "Setting Email" menu (px_email_settings, password encrypted);
// legacy SMTP_* values in .env are only a fallback. Re-read on every send, so a change applies at once.

/**
 * Has this metric's survey already been uploaded for the current reporting cycle?
 * - MONTHLY metrics: checks the current calendar month.
 * - ONE_TIME_ANNUAL metrics: checks the whole current year (uploaded once is enough).
 */
async function hasUploadedForCurrentCycle(metric, today) {
  const responses = (await storage.getUploadedResponsesByMetric(metric.metric_id)) || [];
  if (responses.length === 0) return false;

  const year = String(today.getFullYear());
  const month = String(today.getMonth() + 1).padStart(2, '0');

  return responses.some(r => {
    const d = r.survey_date || (r.created_at || '').slice(0, 10);
    if (!d) return false;
    if (metric.update_frequency === 'ONE_TIME_ANNUAL') {
      return d.startsWith(year);
    }
    return d.startsWith(`${year}-${month}`);
  });
}

/**
 * Computes the next applicable deadline date for a metric relative to "today".
 */
function computeDeadline(metric, today) {
  const year = today.getFullYear();
  const day = Math.min(Math.max(parseInt(metric.upload_deadline_day) || 25, 1), 28);

  if (metric.update_frequency === 'ONE_TIME_ANNUAL') {
    const month = Math.min(Math.max(parseInt(metric.upload_deadline_month) || 11, 1), 12);
    return new Date(year, month - 1, day, 23, 59, 59);
  }
  // MONTHLY: deadline is this calendar month
  return new Date(year, today.getMonth(), day, 23, 59, 59);
}

/**
 * Scans all metrics requiring manual survey upload and returns those that are
 * DUE_SOON (within REMINDER_LEAD_DAYS of the deadline) or OVERDUE (past deadline),
 * excluding any metric whose current cycle has already been uploaded.
 */
async function getPendingUploadReminders(referenceDate = new Date()) {
  const today = new Date(referenceDate);
  const metrics = (await storage.getMetrics()).filter(m => m.metric_type === 'SURVEY' && m.requires_manual_upload);

  const reminders = [];
  for (const metric of metrics) {
    if (await hasUploadedForCurrentCycle(metric, today)) continue;

    const deadline = computeDeadline(metric, today);
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilDeadline = Math.ceil((deadline.getTime() - today.getTime()) / msPerDay);

    let status = null;
    if (daysUntilDeadline < 0) status = 'OVERDUE';
    else if (daysUntilDeadline <= REMINDER_LEAD_DAYS) status = 'DUE_SOON';

    if (status) {
      reminders.push({
        metric_id: metric.metric_id,
        metric_name: metric.metric_name,
        update_frequency: metric.update_frequency,
        pic_name: metric.pic_name || metric.experience_owner || '-',
        pic_email: metric.pic_email || '',
        deadline: deadline.toISOString().slice(0, 10),
        days_until_deadline: daysUntilDeadline,
        status
      });
    }
  }

  reminders.sort((a, b) => a.days_until_deadline - b.days_until_deadline);
  return reminders;
}

/**
 * Sends one reminder email per pending item via the configured on-premise SMTP relay.
 * Returns a summary — never throws, so a misconfigured/offline mail server can't take
 * down the rest of the app (mirrors the graceful-fallback pattern used for Ollama).
 */
async function sendPendingUploadReminders(referenceDate = new Date()) {
  const reminders = await getPendingUploadReminders(referenceDate);
  const { transporter, from, source } = await buildTransport();

  const results = [];
  for (const reminder of reminders) {
    if (!reminder.pic_email) {
      results.push({ ...reminder, email_status: 'SKIPPED_NO_EMAIL' });
      continue;
    }
    if (!transporter) {
      // No SMTP configured for this on-premise environment — log only, don't fail.
      console.log(`[reminderService] SMTP not configured. Would remind ${reminder.pic_name} <${reminder.pic_email}> about "${reminder.metric_name}" (${reminder.status}, deadline ${reminder.deadline}).`);
      results.push({ ...reminder, email_status: 'LOGGED_ONLY' });
      continue;
    }
    try {
      await transporter.sendMail({
        from,
        to: reminder.pic_email,
        subject: `[PX Reminder] Upload Survey "${reminder.metric_name}" — ${reminder.status === 'OVERDUE' ? 'Terlambat' : 'Segera Jatuh Tempo'}`,
        text: `Halo ${reminder.pic_name},\n\nMohon segera upload data survei untuk metrik "${reminder.metric_name}" pada sistem People Experience (PX).\nBatas waktu upload: ${reminder.deadline}\nStatus: ${reminder.status === 'OVERDUE' ? 'SUDAH LEWAT BATAS WAKTU' : `Jatuh tempo dalam ${reminder.days_until_deadline} hari`}\n\nTerima kasih.\nSistem People Experience CIMB Niaga`
      });
      results.push({ ...reminder, email_status: 'SENT' });
    } catch (err) {
      results.push({ ...reminder, email_status: 'FAILED', email_error: err.message });
    }
  }

  return {
    total_reminders: reminders.length,
    smtp_configured: !!transporter,
    sender_source: source,
    results
  };
}

module.exports = {
  getPendingUploadReminders,
  sendPendingUploadReminders
};
