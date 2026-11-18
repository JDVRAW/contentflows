// Auto-delete is opt-in per delivery: when the creator turns it on, the delivery deletes itself a number
// of days (their choice) after the client first downloads something (one file, a selection, a folder or
// Download all).
const MAX_DAYS = 365;
const clampDays = (n) => Math.min(MAX_DAYS, Math.max(1, Math.round(n)));
// The countdown suggested when a creator turns auto-delete on.
const DEFAULT_DAYS = clampDays(Number(process.env.AUTO_DELETE_DAYS) || 7);

// A days value from a form or a tool: a whole number from 1 to MAX_DAYS, otherwise the default.
const cleanDays = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 ? clampDays(n) : DEFAULT_DAYS; };
const daysOf = (p) => cleanDays(p.auto_delete_days);
const daysText = (n) => `${n} day${n === 1 ? '' : 's'}`;

// Times are kept the way SQLite writes them ("YYYY-MM-DD HH:MM:SS", UTC) so they sort and compare as text.
const DAY = 24 * 3600 * 1000;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const fromSql = (t) => Date.parse(`${t.replace(' ', 'T')}Z`);
const deleteAtFrom = (days, ms = Date.now()) => sqlTime(ms + days * DAY);
// A countdown already running moves with a new length: it still counts from the first download.
const shiftDeleteAt = (deleteAt, oldDays, newDays) => sqlTime(fromSql(deleteAt) + (newDays - oldDays) * DAY);
const isDue = (p, ms = Date.now()) => !!(p.auto_delete && p.delete_at && p.delete_at <= sqlTime(ms));

// The last moment a client can open the delivery: its expiry date or its deletion date, whichever is first.
function lastDay(p) {
  const exp = p.expires_at ? `${p.expires_at} 23:59:59` : null;
  const del = p.auto_delete && p.delete_at ? p.delete_at : null;
  if (exp && del) return del < exp ? { at: del, deleting: true } : { at: exp.slice(0, 10), deleting: false };
  if (del) return { at: del, deleting: true };
  if (exp) return { at: p.expires_at, deleting: false };
  return null;
}

module.exports = { MAX_DAYS, DEFAULT_DAYS, cleanDays, daysOf, daysText, sqlTime, deleteAtFrom, shiftDeleteAt, isDue, lastDay };
