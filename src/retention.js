// Deliveries delete themselves a set number of days after the client first downloads something
// (one file, a selection, a folder or Download all). Creators can switch this off per delivery.
const DAYS = Math.max(1, Number(process.env.AUTO_DELETE_DAYS || 7));

// Times are kept the way SQLite writes them ("YYYY-MM-DD HH:MM:SS", UTC) so they sort and compare as text.
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const deleteAtFrom = (ms = Date.now()) => sqlTime(ms + DAYS * 24 * 3600 * 1000);
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

const daysText = `${DAYS} day${DAYS === 1 ? '' : 's'}`;

module.exports = { DAYS, daysText, sqlTime, deleteAtFrom, isDue, lastDay };
