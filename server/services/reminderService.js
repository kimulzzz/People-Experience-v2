// server/services/reminderService.js
/**
 * Survey Upload Reminder Service
 *
 * For every SURVEY metric whose data is uploaded manually by a PIC ("requires_manual_upload"),
 * the metric has an upload deadline day (Parameter Admin → "Batas Tanggal Upload").
 *
 *   MONTHLY metrics    : on the deadline day of month M — and afterwards for the rest of M — the
 *                        system checks whether the metric has ANY survey response whose survey_date
 *                        falls in month M-1. If not, the PIC gets an email asking for that month.
 *                        e.g. deadline day 10, today 10 Oct → "no September data?" → email.
 *   ONE_TIME_ANNUAL   : from the deadline date of the year (month + day) the metric must have data
 *                        dated in that year.
 *
 * The check is purely "is there a row in the survey-response table for this metric in that period"
 * (storage.hasSurveyDataInPeriod) — nothing else is inspected.
 *
 * Sending is automatic (see startReminderScheduler): the cycle runs at boot and every 30 minutes,
 * sends from the configured hour (default 08:00), and every email is recorded in px_reminder_log, so
 *   - a restart can never send the same reminder twice on one day,
 *   - a day the server was down is caught up on the next start,
 *   - follow-ups repeat every `reminder_repeat_days` days (default 1; 0 = only the first reminder)
 *     until the data appears.
 * The sender account comes from the "Setting Email" menu (px_email_settings).
 */
const storage = require('../db/storage');
const { buildTransport } = require('./emailSettingsService');

const MONTH_NAMES_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const CYCLE_INTERVAL_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS_PER_DAY = 3;
const DEFAULT_SEND_HOUR = 8;
const DEFAULT_REPEAT_DAYS = 1;

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lastDayOfMonth = (year, month0) => new Date(year, month0 + 1, 0).getDate();
const daysBetween = (fromYmd, toYmd) => Math.round((new Date(`${toYmd}T00:00:00Z`) - new Date(`${fromYmd}T00:00:00Z`)) / 86400000);

// Accepts a Date or a 'YYYY-MM-DD' string (simulation / tests); anything else = now.
function toLocalDate(input) {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  return input instanceof Date && !isNaN(input) ? input : new Date();
}

/**
 * Which period must have data by the deadline, and when is the deadline, for this metric at "today".
 */
function expectedPeriod(metric, today) {
  const year = today.getFullYear();
  const month0 = today.getMonth();
  const day = Math.max(parseInt(metric.upload_deadline_day, 10) || 25, 1);

  if (metric.update_frequency === 'ONE_TIME_ANNUAL') {
    const dm0 = Math.min(Math.max(parseInt(metric.upload_deadline_month, 10) || 11, 1), 12) - 1;
    const deadline = new Date(year, dm0, Math.min(day, lastDayOfMonth(year, dm0)));
    return {
      deadline: ymd(deadline),
      key: String(year),
      label: `tahun ${year}`,
      start: `${year}-01-01`,
      end: `${year + 1}-01-01`
    };
  }

  // MONTHLY: deadline this month, data expected for the PREVIOUS month.
  const deadline = new Date(year, month0, Math.min(day, lastDayOfMonth(year, month0)));
  const prevYear = month0 === 0 ? year - 1 : year;
  const prevMonth0 = month0 === 0 ? 11 : month0 - 1;
  return {
    deadline: ymd(deadline),
    key: `${prevYear}-${pad(prevMonth0 + 1)}`,
    label: `${MONTH_NAMES_ID[prevMonth0]} ${prevYear}`,
    start: `${prevYear}-${pad(prevMonth0 + 1)}-01`,
    end: `${year}-${pad(month0 + 1)}-01`
  };
}

/**
 * Metrics that are past their upload deadline and still have NO survey data in the expected period.
 * Status: DUE_TODAY (today is the deadline day) | OVERDUE (after it). Before the deadline nothing is
 * reported — the deadline day is the reminder day.
 */
async function getPendingUploadReminders(referenceDate = new Date()) {
  const today = toLocalDate(referenceDate);
  const todayStr = ymd(today);
  const metrics = (await storage.getMetrics()).filter(m => m.metric_type === 'SURVEY' && m.requires_manual_upload);

  const reminders = [];
  for (const metric of metrics) {
    const period = expectedPeriod(metric, today);
    if (todayStr < period.deadline) continue;                                        // not due yet
    if (await storage.hasSurveyDataInPeriod(metric.metric_id, period.start, period.end)) continue; // data present

    const daysOverdue = daysBetween(period.deadline, todayStr);
    reminders.push({
      metric_id: metric.metric_id,
      metric_name: metric.metric_name,
      update_frequency: metric.update_frequency,
      pic_name: metric.pic_name || metric.experience_owner || '-',
      pic_email: metric.pic_email || '',
      deadline: period.deadline,
      expected_period: period.key,
      expected_period_label: period.label,
      days_overdue: daysOverdue,
      status: daysOverdue === 0 ? 'DUE_TODAY' : 'OVERDUE'
    });
  }

  reminders.sort((a, b) => b.days_overdue - a.days_overdue);
  return reminders;
}

async function getScheduleSettings() {
  const s = await storage.getSettings();
  const hour = Number.isInteger(s.reminder_send_hour) ? s.reminder_send_hour : DEFAULT_SEND_HOUR;
  const repeat = Number.isInteger(s.reminder_repeat_days) ? s.reminder_repeat_days : DEFAULT_REPEAT_DAYS;
  return { sendHour: hour, repeatDays: repeat };
}

// Should the automatic cycle email this reminder today? (manual "send now" skips this check)
async function decideSend(reminder, todayStr, repeatDays) {
  const log = await storage.getReminderLogFor(reminder.metric_id, reminder.expected_period);
  const sent = log.filter(l => l.status === 'SENT');
  if (sent.some(l => l.sent_on === todayStr)) return { send: false, reason: 'ALREADY_SENT_TODAY' };
  if (log.filter(l => l.status === 'FAILED' && l.sent_on === todayStr).length >= MAX_FAILED_ATTEMPTS_PER_DAY) {
    return { send: false, reason: 'TOO_MANY_FAILURES_TODAY' };
  }
  if (sent.length === 0) return { send: true, reason: 'FIRST_REMINDER', sentBefore: 0 };
  if (repeatDays <= 0) return { send: false, reason: 'REPEAT_DISABLED' };
  const lastSent = sent.map(l => l.sent_on).sort().pop();
  if (daysBetween(lastSent, todayStr) >= repeatDays) return { send: true, reason: 'FOLLOW_UP', sentBefore: sent.length };
  return { send: false, reason: 'WAITING_FOR_REPEAT_INTERVAL' };
}

function buildEmail(reminder, sentBefore) {
  const deadlineHuman = (() => {
    const [y, m, d] = reminder.deadline.split('-').map(Number);
    return `${d} ${MONTH_NAMES_ID[m - 1]} ${y}`;
  })();
  const statusLine = reminder.status === 'DUE_TODAY'
    ? 'Hari ini adalah batas waktu upload.'
    : `Batas waktu upload sudah lewat ${reminder.days_overdue} hari.`;
  const followUp = sentBefore > 0 ? ` (pengingat ke-${sentBefore + 1})` : '';
  return {
    subject: `[PX Reminder] Upload Survei "${reminder.metric_name}" — data ${reminder.expected_period_label} belum ada${followUp}`,
    text:
`Halo ${reminder.pic_name},

Sistem People Experience (PX) belum menemukan data survei untuk metrik:
  "${reminder.metric_name}"
pada periode ${reminder.expected_period_label}.

Batas waktu upload: ${deadlineHuman}. ${statusLine}${sentBefore > 0 ? `
Ini adalah pengingat ke-${sentBefore + 1} untuk periode yang sama.` : ''}

Mohon upload data survei periode ${reminder.expected_period_label} melalui sistem PX (menu "Survey Templates" → Upload Survey CSV).
Pengingat ini akan berhenti otomatis setelah data periode tersebut terunggah.

Terima kasih.
Sistem People Experience CIMB Niaga`
  };
}

let cycleRunning = false;
let warnedNoSenderOn = null;

/**
 * One reminder cycle.
 *   automatic (default): honours the send hour and the "already sent / repeat interval" rules.
 *   force:   manual "send now" — ignores them (the admin decided).
 *   dryRun:  nothing is sent or logged; shows what WOULD happen.
 * `referenceDate` simulates another day ('YYYY-MM-DD'); the log then records that date.
 */
async function runReminderCycle({ referenceDate = new Date(), force = false, dryRun = false, metricId = null } = {}) {
  const today = toLocalDate(referenceDate);
  const todayStr = ymd(today);
  const { sendHour, repeatDays } = await getScheduleSettings();

  const base = { run_date: todayStr, send_hour: sendHour, repeat_days: repeatDays, force, dry_run: dryRun };
  if (!force && !dryRun && referenceDate instanceof Date && today.getHours() < sendHour) {
    return { ...base, total_reminders: 0, smtp_configured: null, sender_source: null, results: [], skipped: 'BEFORE_SEND_HOUR' };
  }

  let reminders = await getPendingUploadReminders(today);
  if (metricId !== null) reminders = reminders.filter(r => r.metric_id === metricId); // admin/test: only this metric
  const { transporter, from, source } = await buildTransport();
  const results = [];

  for (const reminder of reminders) {
    if (!reminder.pic_email) { results.push({ ...reminder, email_status: 'SKIPPED_NO_EMAIL' }); continue; }

    const decision = force ? { send: true, reason: 'MANUAL', sentBefore: 0 } : await decideSend(reminder, todayStr, repeatDays);
    if (force) {
      const earlier = (await storage.getReminderLogFor(reminder.metric_id, reminder.expected_period)).filter(l => l.status === 'SENT').length;
      decision.sentBefore = earlier;
    }
    if (!decision.send) { results.push({ ...reminder, email_status: 'SKIPPED', skip_reason: decision.reason }); continue; }
    if (dryRun) { results.push({ ...reminder, email_status: 'WOULD_SEND', reason: decision.reason }); continue; }

    if (!transporter) {
      // No sender configured: nothing is recorded, so the reminder goes out as soon as one is set up.
      if (warnedNoSenderOn !== todayStr) {
        console.log(`[reminderService] ${reminders.length} reminder(s) pending but no email sender is configured (Header → Setting Email).`);
        warnedNoSenderOn = todayStr;
      }
      results.push({ ...reminder, email_status: 'LOGGED_ONLY' });
      continue;
    }

    try {
      const mail = buildEmail(reminder, decision.sentBefore);
      await transporter.sendMail({ from, to: reminder.pic_email, subject: mail.subject, text: mail.text });
      await storage.addReminderLog({ metric_id: reminder.metric_id, expected_period: reminder.expected_period, sent_on: todayStr, status: 'SENT', pic_email: reminder.pic_email });
      results.push({ ...reminder, email_status: 'SENT', reason: decision.reason });
    } catch (err) {
      await storage.addReminderLog({ metric_id: reminder.metric_id, expected_period: reminder.expected_period, sent_on: todayStr, status: 'FAILED', pic_email: reminder.pic_email, error_message: String(err.message).slice(0, 500) });
      results.push({ ...reminder, email_status: 'FAILED', email_error: err.message });
    }
  }

  return { ...base, total_reminders: reminders.length, smtp_configured: !!transporter, sender_source: source, results };
}

// Manual "Kirim Reminder Sekarang" (admin button / API). Never throws for mail problems.
async function sendPendingUploadReminders(options = {}) {
  return runReminderCycle({ force: true, ...options });
}

/**
 * Starts the automatic daily reminders: one cycle shortly after boot (catch-up for days the server
 * was down) and then every 30 minutes. Idempotent thanks to px_reminder_log.
 */
function startReminderScheduler() {
  const tick = async () => {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      const result = await runReminderCycle();
      const sent = result.results.filter(r => r.email_status === 'SENT').length;
      const failed = result.results.filter(r => r.email_status === 'FAILED').length;
      if (sent || failed) console.log(`[reminderService] ${result.run_date}: ${sent} reminder email(s) sent, ${failed} failed.`);
    } catch (err) {
      console.error('[reminderService] reminder cycle failed:', err.message);
    } finally {
      cycleRunning = false;
    }
  };
  setTimeout(tick, 20 * 1000);
  return setInterval(tick, CYCLE_INTERVAL_MS);
}

module.exports = {
  getPendingUploadReminders,
  sendPendingUploadReminders,
  runReminderCycle,
  startReminderScheduler,
  expectedPeriod
};
