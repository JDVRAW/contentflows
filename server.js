const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const { pipeline } = require('stream');
const { db, DATA_DIR } = require('./src/db');
const { kindOf, makeThumb } = require('./src/media');
const storage = require('./src/storage');
const billing = require('./src/billing');
const { PLANS, PAID, INTERVALS, planOf } = require('./src/plans');
const V = require('./src/views');
const { mcpRouter, newKey, hashKey } = require('./src/mcp');

const PORT = process.env.PORT || 3000;
// Cookie signing key: SESSION_SECRET if set, otherwise one generated on first start and kept with the data.
const SECRET = process.env.SESSION_SECRET || (() => {
  const f = path.join(DATA_DIR, '.secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 10240) * 1024 * 1024;
const LIMIT_TEXT = MAX_UPLOAD >= 1024 ** 3 ? `${+(MAX_UPLOAD / 1024 ** 3).toFixed(1)} GB` : `${Math.round(MAX_UPLOAD / 1024 ** 2)} MB`;
const UPLOADS = path.join(DATA_DIR, 'uploads');
const THUMBS = path.join(DATA_DIR, 'thumbs');

const app = express();
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(SECRET));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
const ICONS = path.join(__dirname, 'public', 'icons');
app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.type('text').send('ok'); });

// Stripe tells us about subscription changes here (signed with STRIPE_WEBHOOK_SECRET).
app.post('/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!billing.webhookReady) return res.status(503).json({ error: 'Stripe is not set up on this server.' });
  try {
    const type = await billing.handleWebhook(req.body, req.headers['stripe-signature']);
    res.json({ received: true, type });
  } catch (e) {
    const msg = String(e.message).split('\n')[0].trim();
    console.error('stripe webhook', msg);
    res.status(400).json({ error: msg });
  }
});
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(ICONS, 'favicon.ico'), { maxAge: '7d' }));
app.get('/apple-touch-icon.png', (req, res) => res.sendFile(path.join(ICONS, 'apple-touch-icon.png'), { maxAge: '7d' }));
app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').sendFile(path.join(ICONS, 'manifest.webmanifest')));

const token = (n = 24) => crypto.randomBytes(n).toString('base64url');
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };

// ---------- password guessing ----------
// Wrong passwords are counted per address and per target (one delivery, or one account email).
// After too many in 15 minutes, more tries are refused until the 15 minutes are up, so nobody can
// run through guesses at speed. The per-target count also covers guesses spread over many addresses.
const GUESS_WINDOW = 15 * 60 * 1000;
const PER_ADDRESS = 10, PER_TARGET = 30;
const misses = new Map(); // key -> { n, until }
const missKeys = (req, target) => [[`${target}|${req.ip}`, PER_ADDRESS], [target, PER_TARGET]];
// Minutes to wait before another try is allowed, or 0.
function guessWait(req, target) {
  const now = Date.now();
  for (const [k, max] of missKeys(req, target)) {
    const m = misses.get(k);
    if (m && m.until > now && m.n >= max) return Math.ceil((m.until - now) / 60000);
  }
  return 0;
}
function countMiss(req, target) {
  const now = Date.now();
  for (const [k] of missKeys(req, target)) {
    const m = misses.get(k);
    if (m && m.until > now) m.n++;
    // Past this many tracked addresses, keep counting per target only, so the map can't be flooded.
    else if (k === target || misses.size < 50000) misses.set(k, { n: 1, until: now + GUESS_WINDOW });
  }
}
const clearMisses = (req, target) => misses.delete(`${target}|${req.ip}`);
const waitText = (min) => `Too many wrong passwords. Try again in ${min} minute${min === 1 ? '' : 's'}.`;
setInterval(() => { const now = Date.now(); for (const [k, m] of misses) if (m.until <= now) misses.delete(k); }, 60 * 1000).unref();

// ---------- auth ----------
app.use((req, res, next) => {
  const t = req.signedCookies.cf_session;
  if (t) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`).get(t, Date.now());
    // Seen through the current Stripe key: a test-mode subscription doesn't count on live keys.
    if (row) req.user = billing.view(row);
  }
  next();
});
const requireUser = (req, res, next) => {
  if (req.user) return next();
  if (req.xhr) return res.status(401).json({ ok: false, error: 'You were logged out. Log in again and retry.' });
  res.redirect('/login');
};

function startSession(res, userId) {
  const t = token();
  const maxAge = 30 * 24 * 3600 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(t, userId, Date.now() + maxAge);
  res.cookie('cf_session', t, { ...cookieOpts, signed: true, maxAge });
}

app.get('/', (req, res) => (req.user ? res.redirect('/dashboard') : res.send(V.landing())));
// A plan picked on the home page (?plan=pro) is carried through sign up or log in to the plans page.
const pickedPlan = (v) => (PAID.includes(v) ? v : undefined);
const afterAuth = (plan) => (plan ? `/pricing?plan=${plan}` : '/dashboard');
app.get('/signup', (req, res) => res.send(V.authForm({ mode: 'signup', plan: pickedPlan(req.query.plan) })));
app.get('/login', (req, res) => res.send(V.authForm({ mode: 'login', plan: pickedPlan(req.query.plan) })));

app.post('/signup', (req, res) => {
  const { name = '', studio = '', email = '', password = '' } = req.body;
  const values = { name, studio, email };
  const plan = pickedPlan(req.body.plan);
  if (!name.trim() || !email.trim() || password.length < 8)
    return res.status(400).send(V.authForm({ mode: 'signup', error: 'Name, email and an 8+ character password are required.', values, plan }));
  try {
    const r = db.prepare('INSERT INTO users (email, name, studio, password_hash) VALUES (?, ?, ?, ?)')
      .run(email.trim().toLowerCase(), name.trim(), studio.trim() || null, bcrypt.hashSync(password, 10));
    startSession(res, r.lastInsertRowid);
    res.redirect(afterAuth(plan));
  } catch (e) {
    res.status(400).send(V.authForm({ mode: 'signup', error: 'An account with that email already exists.', values, plan }));
  }
});

app.post('/login', (req, res) => {
  const { email = '', password = '' } = req.body;
  const plan = pickedPlan(req.body.plan);
  const target = `login:${email.trim().toLowerCase()}`;
  const wait = guessWait(req, target);
  if (wait) return res.status(429).send(V.authForm({ mode: 'login', error: waitText(wait), values: { email }, plan }));
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    countMiss(req, target);
    return res.status(401).send(V.authForm({ mode: 'login', error: 'Wrong email or password.', values: { email }, plan }));
  }
  clearMisses(req, target);
  startSession(res, u.id);
  res.redirect(afterAuth(plan));
});

app.post('/logout', (req, res) => {
  const t = req.signedCookies.cf_session;
  if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
  res.clearCookie('cf_session');
  res.redirect('/');
});

// ---------- storage plans ----------
const usedBytes = (userId) => db.prepare(`SELECT COALESCE(SUM(a.size), 0) AS n FROM assets a
  JOIN projects p ON p.id = a.project_id WHERE p.user_id = ?`).get(userId).n;
// Space held by uploads that are still in progress, so parallel uploads can't overshoot the plan.
const reserved = new Map();
const reservedBytes = (userId) => {
  let n = 0;
  for (const [id, r] of reserved) {
    if (Date.now() - r.at > 24 * 3600e3) reserved.delete(id);
    else if (r.userId === userId) n += r.size;
  }
  return n;
};
const usage = (user) => ({ used: usedBytes(user.id), plan: planOf(user) });
// Why a file of this size can't be added right now, or null if it fits.
function spaceProblem(user, size) {
  const plan = planOf(user);
  if (plan.limit === Infinity) return null;
  const used = usedBytes(user.id) + reservedBytes(user.id);
  if (used + size <= plan.limit) return null;
  return `This file needs ${V.fmtSize(size)}, but your ${plan.name} plan has ${V.fmtSize(Math.max(0, plan.limit - used))} left. Upgrade for more space, or delete files you no longer need.`;
}
// Bytes the creator can still add, counting uploads in progress.
const spaceLeft = (user) => {
  const plan = planOf(user);
  return plan.limit === Infinity ? Infinity : Math.max(0, plan.limit - usedBytes(user.id) - reservedBytes(user.id));
};
const originOf = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

app.get('/pricing', (req, res) => {
  res.send(V.pricingPage({ user: req.user, usage: req.user && usage(req.user), plans: PLANS, billingOn: billing.enabled,
    subscribed: !!req.user && billing.hasLiveSubscription(req.user), notice: req.query }));
});

const billingError = (res, e) => {
  console.error('billing', e.type || '', e.message);
  res.status(502).send(V.messagePage('Payment problem', `Stripe couldn't complete that: ${e.message}`));
};
const needBilling = (req, res, next) => (billing.enabled ? next()
  : res.status(503).send(V.messagePage('Payments aren\'t set up yet', 'Upgrades open as soon as payments are connected. Try again soon.')));

app.post('/billing/checkout', requireUser, needBilling, async (req, res) => {
  const { plan, interval } = req.body;
  if (!PAID.includes(plan) || !INTERVALS.includes(interval)) return res.redirect('/pricing');
  if (req.user.plan === plan && req.user.plan_interval === interval && billing.hasLiveSubscription(req.user) && !req.user.plan_cancel_at_end)
    return res.redirect('/pricing');
  if (usedBytes(req.user.id) > PLANS[plan].limit) return res.redirect(`/pricing?toosmall=${plan}`);
  try { res.redirect(303, await billing.choosePlan(req.user, plan, interval, originOf(req))); } catch (e) { billingError(res, e); }
});
app.get('/billing/done', requireUser, needBilling, async (req, res) => {
  try { await billing.finishCheckout(req.user, String(req.query.session_id || '')); } catch (e) { console.error('billing done', e.message); }
  res.redirect('/pricing?welcome=1');
});
app.post('/billing/cancel', requireUser, needBilling, async (req, res) => {
  try { await billing.setCancelAtEnd(req.user, true); res.redirect('/pricing?canceled=1'); } catch (e) { billingError(res, e); }
});
app.post('/billing/resume', requireUser, needBilling, async (req, res) => {
  try { await billing.setCancelAtEnd(req.user, false); res.redirect('/pricing?resumed=1'); } catch (e) { billingError(res, e); }
});
app.post('/billing/portal', requireUser, needBilling, async (req, res) => {
  try { res.redirect(303, await billing.portalUrl(req.user, originOf(req))); } catch (e) { billingError(res, e); }
});

// ---------- creator: projects ----------
app.get('/dashboard', requireUser, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count,
      (SELECT SUM(size) FROM assets a WHERE a.project_id = p.id) AS total_size,
      (SELECT COUNT(*) FROM events e WHERE e.project_id = p.id AND e.type IN ('download', 'zip')) AS download_count,
      (SELECT COUNT(*) FROM events e WHERE e.project_id = p.id AND e.type = 'view') AS view_count,
      COALESCE(
        (SELECT a.id FROM assets a WHERE a.id = p.cover_asset_id AND a.thumb_name IS NOT NULL),
        (SELECT a.id FROM assets a WHERE a.project_id = p.id AND a.thumb_name IS NOT NULL ORDER BY a.position, a.id LIMIT 1)
      ) AS cover_id
    FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC`).all(req.user.id)
    .map((p) => ({ ...p, cover_thumb: !!p.cover_id }));
  res.send(V.dashboard({ user: req.user, projects, usage: usage(req.user) }));
});

const TYPES = Object.keys(V.TYPES);
app.post('/projects', requireUser, (req, res) => {
  const { title = '', type, client_name, client_email } = req.body;
  if (!title.trim()) return res.redirect('/dashboard');
  const r = db.prepare(`INSERT INTO projects (user_id, title, type, client_name, client_email, share_token)
    VALUES (?, ?, ?, ?, ?, ?)`).run(req.user.id, title.trim(), TYPES.includes(type) ? type : 'project',
    client_name?.trim() || null, client_email?.trim() || null, token(16));
  res.redirect(`/projects/${r.lastInsertRowid}`);
});

function ownProject(req, res, next) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!p && req.xhr) return res.status(404).json({ ok: false, error: 'This delivery no longer exists.' });
  if (!p) return res.status(404).send(V.messagePage('Not found', 'That delivery does not exist.'));
  req.project = p;
  next();
}

app.get('/projects/:id', requireUser, ownProject, (req, res) => {
  const p = req.project;
  const assets = db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM events e WHERE e.asset_id = a.id AND e.type = 'download') AS downloads
    FROM assets a WHERE a.project_id = ? ORDER BY a.position, a.id`).all(p.id);
  const stats = db.prepare(`SELECT
      SUM(type = 'view') AS views, SUM(type IN ('download', 'zip')) AS downloads, MAX(created_at) AS last
    FROM events WHERE project_id = ?`).get(p.id);
  res.send(V.projectPage({ user: req.user, project: p, assets, saved: req.query.saved,
    stats: { views: stats.views || 0, downloads: stats.downloads || 0, last: stats.last },
    origin: originOf(req), direct: storage.enabled, storageMissing: storage.partlySet, usage: usage(req.user) }));
});

app.post('/projects/:id/settings', requireUser, ownProject, (req, res) => {
  const b = req.body;
  let pw = req.project.password_hash;
  if (b.remove_password) pw = null;
  else if (b.password) pw = bcrypt.hashSync(b.password, 10);
  db.prepare(`UPDATE projects SET title = ?, type = ?, client_name = ?, client_email = ?, message = ?,
    password_hash = ?, allow_download = ?, expires_at = ? WHERE id = ?`).run(
    (b.title || '').trim() || req.project.title, TYPES.includes(b.type) ? b.type : req.project.type,
    b.client_name?.trim() || null, b.client_email?.trim() || null, b.message?.trim() || null,
    pw, b.allow_download ? 1 : 0, /^\d{4}-\d{2}-\d{2}$/.test(b.expires_at || '') ? b.expires_at : null, req.project.id);
  res.redirect(`/projects/${req.project.id}?saved=1`);
});

app.post('/projects/:id/rotate', requireUser, ownProject, (req, res) => {
  db.prepare('UPDATE projects SET share_token = ? WHERE id = ?').run(token(16), req.project.id);
  res.redirect(`/projects/${req.project.id}`);
});

app.post('/projects/:id/cover/:aid', requireUser, ownProject, (req, res) => {
  db.prepare('UPDATE projects SET cover_asset_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM assets WHERE id = ? AND project_id = ?)')
    .run(req.params.aid, req.project.id, req.params.aid, req.project.id);
  res.redirect(`/projects/${req.project.id}`);
});

function removeAssetFiles(a) {
  if (a.storage === 's3') { if (storage.enabled) storage.remove(a.stored_name); }
  else fs.rm(path.join(UPLOADS, String(a.project_id), a.stored_name), { force: true }, () => {});
  if (a.thumb_name) fs.rm(path.join(THUMBS, a.thumb_name), { force: true }, () => {});
}

app.post('/projects/:id/assets/:aid/delete', requireUser, ownProject, (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?').get(req.params.aid, req.project.id);
  if (a) { db.prepare('DELETE FROM assets WHERE id = ?').run(a.id); removeAssetFiles(a); }
  res.redirect(`/projects/${req.project.id}`);
});

app.post('/projects/:id/delete', requireUser, ownProject, (req, res) => {
  db.prepare('SELECT * FROM assets WHERE project_id = ?').all(req.project.id).forEach(removeAssetFiles);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.project.id);
  res.redirect('/dashboard');
});

// ---------- creator: uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS, String(req.project.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, token(12) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: MAX_UPLOAD },
});

// Uploads cut off by a restart (a redeploy, a crash) leave files that no asset points to.
// Nothing is uploading while the server starts, so any such file is safe to remove then.
function sweepUnfinishedUploads() {
  const kept = new Set(db.prepare("SELECT project_id || '/' || stored_name AS k FROM assets WHERE storage IS NULL").all().map((r) => r.k));
  let count = 0, bytes = 0;
  for (const dir of fs.readdirSync(UPLOADS)) {
    let names;
    try { names = fs.readdirSync(path.join(UPLOADS, dir)); } catch (e) { continue; }
    for (const n of names) {
      if (kept.has(`${dir}/${n}`)) continue;
      const f = path.join(UPLOADS, dir, n);
      try {
        const st = fs.statSync(f);
        if (!st.isFile()) continue;
        fs.rmSync(f);
        count++; bytes += st.size;
      } catch (e) { console.error('cleanup', f, e.message); }
    }
  }
  if (count) console.log(`Removed ${count} unfinished upload${count === 1 ? '' : 's'} (${(bytes / 1024 ** 3).toFixed(2)} GB)`);
}

const insertAsset = db.prepare(`INSERT INTO assets (project_id, original_name, stored_name, mime, size, kind, storage, position)
  VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM assets WHERE project_id = ?))`);

// Folders come from the uploader's own computer: keep plain names only, a few levels deep.
const cleanFolder = (v) => String(v || '').split(/[\\/]+/)
  .map((s) => s.replace(/[\x00-\x1f]/g, '').trim().slice(0, 100))
  .filter((s) => s && s !== '.' && s !== '..').slice(0, 8).join('/') || null;
const setFolder = db.prepare('UPDATE assets SET folder = ? WHERE id = ?');

// Refuse before reading the body when the upload can't fit in the creator's plan.
const checkSpace = (req, res, next) => {
  const size = Number(req.headers['content-length']) || 0;
  const problem = spaceProblem(req.user, size);
  if (problem) {
    // Read and discard the body so the browser gets this answer instead of a dropped connection.
    req.resume();
    return req.on('end', () => res.status(413).json({ ok: false, error: problem, upgrade: '/pricing' }));
  }
  // Hold the space while the file streams in, then count the saved file instead.
  const id = `form:${token(9)}`;
  reserved.set(id, { userId: req.user.id, size, at: Date.now() });
  res.on('close', () => reserved.delete(id));
  next();
};

app.post('/projects/:id/upload', requireUser, ownProject, checkSpace, upload.array('files'), async (req, res) => {
  const out = [];
  for (const f of req.files || []) {
    // Browsers send filenames as latin1 through multipart; recover UTF-8 names.
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    const kind = kindOf(f.mimetype, name);
    const r = insertAsset.run(req.project.id, name, f.filename, f.mimetype, f.size, kind, null, req.project.id);
    const folder = cleanFolder(req.body && req.body.folder);
    if (folder) setFolder.run(folder, r.lastInsertRowid);
    const thumb = await makeThumb(f.path, kind, r.lastInsertRowid);
    if (thumb) db.prepare('UPDATE assets SET thumb_name = ? WHERE id = ?').run(thumb, r.lastInsertRowid);
    out.push({ id: r.lastInsertRowid, name, kind, size: f.size });
  }
  res.json({ ok: true, files: out });
});

// ---------- thumbnails for files in object storage ----------
// ffmpeg reads the file through this loopback-only relay, which fetches just the byte ranges it asks
// for from the bucket with the same client the rest of the app uses. That way ffmpeg never makes
// its own TLS or DNS connections, and only the frames it needs are downloaded.
const relays = new Map();
app.get('/_relay/:t', async (req, res) => {
  const r = relays.get(req.params.t);
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!local || !r) return res.sendStatus(404);
  try {
    const o = await storage.getRange(r.key, req.headers.range);
    res.status(o.ContentRange ? 206 : 200).set({
      'Accept-Ranges': 'bytes', 'Content-Length': String(o.ContentLength),
      'Content-Type': o.ContentType || 'application/octet-stream', ...(o.ContentRange ? { 'Content-Range': o.ContentRange } : {}),
    });
    pipeline(o.Body, res, () => {}); // stops the download from the bucket when ffmpeg hangs up
  } catch (e) {
    if (e.name === 'InvalidRange') return res.sendStatus(416);
    console.error('relay', r.key, e.name, e.message);
    res.sendStatus(502);
  }
});

async function thumbFromStorage(key, kind, id) {
  if (kind !== 'image' && kind !== 'video') return null;
  const t = token(18);
  relays.set(t, { key });
  try {
    const thumb = await makeThumb(`http://127.0.0.1:${PORT}/_relay/${t}`, kind, id);
    if (thumb) db.prepare('UPDATE assets SET thumb_name = ? WHERE id = ?').run(thumb, id);
    return thumb;
  } finally { relays.delete(t); }
}

// Photos and videos in the bucket that have no thumbnail yet (an earlier attempt failed) get another
// try after each start, one at a time.
async function backfillThumbs() {
  if (!storage.enabled) return;
  const missing = db.prepare(`SELECT id, stored_name, kind FROM assets
    WHERE storage = 's3' AND thumb_name IS NULL AND kind IN ('image', 'video') ORDER BY id DESC LIMIT 50`).all();
  for (const a of missing) {
    const ok = await thumbFromStorage(a.stored_name, a.kind, a.id).catch((e) => console.error('backfill', a.id, e.message));
    console.log(`thumbnail for asset ${a.id}: ${ok ? 'made' : 'failed'}`);
  }
}

// ---------- creator: direct uploads to object storage (R2) ----------
// The browser asks for signed part URLs, PUTs the file's parts straight to the bucket, then
// reports the parts back here. File bytes never pass through this server.
const direct = [requireUser, ownProject, (req, res, next) => (storage.enabled ? next()
  : res.status(404).json({ ok: false, error: 'Direct uploads are not set up on this server.' })), express.json({ limit: '2mb' })];
const keyPrefix = (req) => `projects/${req.project.id}/`;
const fileInfo = (req, res) => {
  const b = req.body || {};
  const key = String(b.key || ''), uploadId = String(b.uploadId || '');
  if (!uploadId || !key.startsWith(keyPrefix(req)) || !/^[\w\-./]+$/.test(key) || key.includes('..')) {
    res.status(400).json({ ok: false, error: 'This upload is not valid. Try again.' });
    return null;
  }
  return { key, uploadId, b };
};

app.post('/projects/:id/uploads/start', ...direct, async (req, res) => {
  const { name, type } = req.body || {};
  const size = Number(req.body?.size);
  if (!name || !Number.isFinite(size) || size < 0) return res.status(400).json({ ok: false, error: 'Missing file details.' });
  if (size > MAX_UPLOAD) return res.status(413).json({ ok: false, error: `This file is over the ${LIMIT_TEXT} limit.` });
  const problem = spaceProblem(req.user, size);
  if (problem) return res.status(413).json({ ok: false, error: problem, upgrade: '/pricing' });
  const ext = path.extname(String(name)).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
  const key = keyPrefix(req) + token(12) + ext;
  const uploadId = await storage.startUpload(key, String(type || '').slice(0, 200));
  reserved.set(uploadId, { userId: req.user.id, size, at: Date.now() });
  res.json({ ok: true, key, uploadId, partSize: storage.partSizeFor(size) });
});

app.post('/projects/:id/uploads/sign', ...direct, async (req, res) => {
  const f = fileInfo(req, res);
  if (!f) return;
  const nums = (Array.isArray(f.b.parts) ? f.b.parts : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10000);
  if (!nums.length || nums.length > 100) return res.status(400).json({ ok: false, error: 'This upload is not valid. Try again.' });
  res.json({ ok: true, urls: await storage.signParts(f.key, f.uploadId, nums) });
});

app.post('/projects/:id/uploads/complete', ...direct, async (req, res) => {
  const f = fileInfo(req, res);
  if (!f) return;
  const parts = Array.isArray(f.b.parts) ? f.b.parts : [];
  if (!parts.length || parts.some((p) => !p || !p.ETag || !Number.isInteger(+p.PartNumber)))
    return res.status(400).json({ ok: false, error: 'The upload finished without all of its parts. Try again.' });
  const name = String(f.b.name || 'file').slice(0, 255);
  const type = String(f.b.type || '').slice(0, 200) || null;
  // The uploader retries when an answer gets lost on the way back; the file may already be saved.
  const saved = () => db.prepare('SELECT id, original_name AS name, kind, size FROM assets WHERE project_id = ? AND stored_name = ?').get(req.project.id, f.key);
  if (saved()) return res.json({ ok: true, files: [saved()] });
  let size;
  try { size = await storage.completeUpload(f.key, f.uploadId, parts); } catch (e) {
    if (e.name === 'NoSuchUpload' && saved()) return res.json({ ok: true, files: [saved()] });
    throw e;
  }
  if (saved()) return res.json({ ok: true, files: [saved()] }); // a retry finished it while this one waited
  reserved.delete(f.uploadId);
  const kind = kindOf(type || '', name);
  const r = insertAsset.run(req.project.id, name, f.key, type, size, kind, 's3', req.project.id);
  const folder = cleanFolder(f.b.folder);
  if (folder) setFolder.run(folder, r.lastInsertRowid);
  await thumbFromStorage(f.key, kind, r.lastInsertRowid);
  res.json({ ok: true, files: [{ id: r.lastInsertRowid, name, kind, size }] });
});

app.post('/projects/:id/uploads/abort', ...direct, async (req, res) => {
  const f = fileInfo(req, res);
  if (!f) return;
  reserved.delete(f.uploadId);
  await storage.abortUpload(f.key, f.uploadId);
  res.json({ ok: true });
});

// ---------- AI assistants (MCP) ----------
// Creators make API keys on /connect, then add ContentFlows as a connector in Claude or another
// assistant, which can then list, create and fill deliveries for them (src/mcp.js).
const mcpUrl = (req, key) => `${originOf(req)}/mcp/${key}`;
const keysOf = (userId) => db.prepare('SELECT id, name, hint, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC').all(userId);

app.get('/connect', requireUser, (req, res) => {
  res.send(V.connectPage({ user: req.user, keys: keysOf(req.user.id), origin: originOf(req) }));
});
app.post('/connect/keys', requireUser, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80) || 'AI assistant';
  if (keysOf(req.user.id).length >= 20)
    return res.status(400).send(V.connectPage({ user: req.user, keys: keysOf(req.user.id), origin: originOf(req), error: 'You have 20 keys. Revoke one you no longer use first.' }));
  const key = newKey();
  db.prepare('INSERT INTO api_keys (user_id, name, key_hash, hint) VALUES (?, ?, ?, ?)').run(req.user.id, name, hashKey(key), key.slice(-4));
  // Shown once, on this page; only its hash is kept.
  res.set('Cache-Control', 'no-store');
  res.send(V.connectPage({ user: req.user, keys: keysOf(req.user.id), origin: originOf(req), fresh: { name, key, url: mcpUrl(req, key) } }));
});
app.post('/connect/keys/:kid/delete', requireUser, (req, res) => {
  db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(req.params.kid, req.user.id);
  res.redirect('/connect');
});
app.use('/mcp', mcpRouter({
  db, token, TYPES: V.TYPES, storage, kindOf, makeThumb, insertAsset, removeAssetFiles, spaceProblem, spaceLeft, reserved,
  usage, originOf, MAX_UPLOAD, UPLOADS, fmtSize: V.fmtSize, userView: billing.view,
}));

// ---------- client: delivery ----------
const unlockValue = (p) => crypto.createHash('sha256').update(`${p.id}:${p.password_hash}`).digest('hex').slice(0, 32);

function loadDelivery(req, res, next) {
  const p = db.prepare('SELECT p.*, u.name AS owner_name, u.studio AS owner_studio FROM projects p JOIN users u ON u.id = p.user_id WHERE p.share_token = ?').get(req.params.token);
  if (!p) return res.status(404).send(V.messagePage('Link not found', 'This delivery link is invalid or has been replaced.'));
  const isOwner = req.user && req.user.id === p.user_id;
  if (!isOwner && p.expires_at && new Date(`${p.expires_at}T23:59:59Z`) < new Date())
    return res.status(410).send(V.messagePage('Delivery expired', 'This delivery is no longer available. Contact your creator for a new link.'));
  req.project = p;
  req.isOwner = isOwner;
  req.unlocked = isOwner || !p.password_hash || req.signedCookies[`cf_unlock_${p.id}`] === unlockValue(p);
  next();
}
const requireUnlocked = (req, res, next) => (req.unlocked ? next() : res.status(401).send('Locked'));
const track = (req, type, assetId = null) => {
  if (!req.isOwner) db.prepare('INSERT INTO events (project_id, asset_id, type) VALUES (?, ?, ?)').run(req.project.id, assetId, type);
};
const getAsset = (req) => db.prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?').get(req.params.aid, req.project.id);

app.get('/d/:token', loadDelivery, (req, res) => {
  const p = req.project;
  const studio = p.owner_studio || p.owner_name;
  if (!req.unlocked) return res.send(V.unlockPage({ project: p, studio }));
  track(req, 'view');
  const assets = db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY position, id').all(p.id);
  res.send(V.deliveryPage({ project: p, assets, studio, host: req.get('host') }));
});

app.post('/d/:token/unlock', loadDelivery, (req, res) => {
  const p = req.project;
  const studio = p.owner_studio || p.owner_name;
  const target = `delivery:${p.id}`;
  const wait = guessWait(req, target);
  if (wait) return res.status(429).send(V.unlockPage({ project: p, studio, error: waitText(wait) }));
  if (p.password_hash && bcrypt.compareSync(req.body.password || '', p.password_hash)) {
    clearMisses(req, target);
    res.cookie(`cf_unlock_${p.id}`, unlockValue(p), { ...cookieOpts, signed: true, maxAge: 30 * 24 * 3600 * 1000 });
    return res.redirect(`/d/${p.share_token}`);
  }
  countMiss(req, target);
  res.status(401).send(V.unlockPage({ project: p, studio, error: 'That password is not right.' }));
});

app.get('/d/:token/thumb/:aid', loadDelivery, requireUnlocked, (req, res) => {
  const a = getAsset(req);
  if (!a || !a.thumb_name) return res.sendStatus(404);
  res.sendFile(path.join(THUMBS, a.thumb_name), { maxAge: '7d' });
});

// Only photos, video and audio are shown in the browser. Anything else opened on its own (an HTML
// page, an SVG with a script in it) downloads instead of rendering, so an uploaded file can never run
// as a page. SVGs still show as images in the gallery: an <img> ignores the download header.
const opensInline = (mime) => /^(image\/(?!svg)|video\/|audio\/)/i.test(mime || '');

// Files in object storage are served by the bucket itself through a short-lived signed link.
async function sendFromStorage(res, a, attachment) {
  if (!storage.enabled) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  res.redirect(302, await storage.signedGet(a.stored_name, { name: a.original_name, contentType: a.mime, attachment: attachment || !opensInline(a.mime) }));
}

// Files on this server's disk come from the site's own address, so they also get a sandbox: even if
// a browser did render one as a page, it couldn't run scripts or act as the signed-in creator.
const fileHeaders = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' };

// Inline streaming (sendFile handles HTTP Range requests for video seeking).
app.get('/d/:token/media/:aid', loadDelivery, requireUnlocked, async (req, res) => {
  const a = getAsset(req);
  if (!a) return res.sendStatus(404);
  if (a.storage === 's3') return sendFromStorage(res, a, false);
  res.type(a.mime || 'application/octet-stream');
  res.sendFile(path.join(UPLOADS, String(a.project_id), a.stored_name),
    { headers: { ...fileHeaders, 'Content-Disposition': storage.disposition(opensInline(a.mime) ? 'inline' : 'attachment', a.original_name) } });
});

app.get('/d/:token/download/:aid', loadDelivery, requireUnlocked, async (req, res) => {
  if (!req.project.allow_download && !req.isOwner) return res.sendStatus(403);
  const a = getAsset(req);
  if (!a) return res.sendStatus(404);
  if (!req.headers.range) track(req, 'download', a.id);
  if (a.storage === 's3') return sendFromStorage(res, a, true);
  res.download(path.join(UPLOADS, String(a.project_id), a.stored_name), a.original_name, { headers: fileHeaders });
});

app.get('/d/:token/zip', loadDelivery, requireUnlocked, (req, res) => {
  const p = req.project;
  if (!p.allow_download && !req.isOwner) return res.sendStatus(403);
  let assets = db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY position, id').all(p.id);
  // ?ids=1,2,3 zips only the files the client picked in the gallery.
  const ids = new Set(String(req.query.ids || '').split(',').map(Number).filter(Boolean));
  if (ids.size) assets = assets.filter((a) => ids.has(a.id));
  // ?folder=BTS zips one folder, with the folders inside it.
  const folder = req.query.folder ? cleanFolder(req.query.folder) : null;
  if (folder) assets = assets.filter((a) => a.folder === folder || (a.folder || '').startsWith(folder + '/'));
  if (!assets.length) return res.sendStatus(404);
  track(req, 'zip');
  const safe = p.title.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'delivery';
  res.attachment(`${safe}${folder ? ` - ${folder.split('/').pop()}` : ids.size ? ' (selection)' : ''}.zip`);
  const zip = new ZipArchive({ store: true }); // media is already compressed
  zip.on('error', (e) => { console.error('zip', e.message); res.destroy(); });
  res.on('close', () => { if (!res.writableFinished) zip.abort(); });
  zip.pipe(res);
  const used = new Set();
  // Files keep the folders they were uploaded in.
  const entries = assets.map((a) => {
    const full = (a.folder ? a.folder + '/' : '') + a.original_name.replace(/[\\/]/g, '_');
    let n = full, i = 1;
    while (used.has(n)) n = full.replace(/(\.[^./]*)?$/, ` (${i++})$1`);
    used.add(n);
    return { a, name: n };
  });
  // Add files one at a time, so only one download from the bucket is open at once.
  const next = async () => {
    const e = entries.shift();
    if (!e) return zip.finalize();
    if (e.a.storage !== 's3') return zip.file(path.join(UPLOADS, String(e.a.project_id), e.a.stored_name), { name: e.name });
    try {
      if (!storage.enabled) throw new Error('object storage is not configured');
      zip.append(await storage.getStream(e.a.stored_name), { name: e.name });
    } catch (err) { console.error('zip', e.a.stored_name, err.message); res.destroy(); }
  };
  zip.on('entry', () => { if (!res.destroyed) next(); });
  next();
});

// Errors from R2, explained in terms of the setup step that fixes them.
function storageError(err) {
  if (!err.$metadata && !['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].includes(err.code)) return null;
  const why = {
    NoSuchBucket: 'The bucket in S3_BUCKET does not exist.',
    InvalidAccessKeyId: 'The R2 access key in S3_ACCESS_KEY_ID is wrong.',
    SignatureDoesNotMatch: 'The R2 secret in S3_SECRET_ACCESS_KEY is wrong.',
    AccessDenied: 'The R2 API token is not allowed to write to this bucket.',
    Unauthorized: 'The R2 API token is not allowed to write to this bucket.',
    NoSuchUpload: 'This upload expired on the storage side. Try again.',
    InvalidPart: 'A part of this upload went missing. Try again.',
    ENOTFOUND: 'The address in S3_ENDPOINT can’t be reached.',
    ECONNREFUSED: 'The address in S3_ENDPOINT can’t be reached.',
    ETIMEDOUT: 'Cloud storage took too long to answer. Try again.',
  };
  return [502, `Cloud storage error: ${why[err.name] || why[err.code] || err.message || err.name}`];
}

app.use((err, req, res, next) => {
  // API keys can be part of /mcp addresses; keep them out of the logs.
  console.error(req.method, req.originalUrl.replace(/^\/mcp\/[^/?]+/, '/mcp/…'), err);
  if (req.xhr) {
    // Upload errors go back as JSON so the uploader can show the reason on the file's row.
    const known = {
      LIMIT_FILE_SIZE: [413, `This file is over the ${LIMIT_TEXT} limit.`],
      ENOSPC: [507, 'The server is out of storage space. Make the volume bigger in Railway.'],
      EDQUOT: [507, 'The server is out of storage space. Make the volume bigger in Railway.'],
      EACCES: [500, "The server can't write to its storage folder."],
      EROFS: [500, "The server's storage folder is read-only."],
    }[err.code];
    const [status, error] = known || storageError(err) || [500, `Server error: ${err.message || err.code || 'unknown'}`];
    if (!res.headersSent) return res.status(status).json({ ok: false, error });
    return;
  }
  res.status(500).send(V.messagePage('Something went wrong', 'Please try again.'));
});

if (require.main === module) {
  try { sweepUnfinishedUploads(); } catch (e) { console.error('cleanup failed', e); }
  console.log(`Files are stored in ${storage.enabled ? `object storage, ${storage.describe}` : storage.describe}`);
  const server = app.listen(PORT, () => {
    console.log(`ContentFlows running on http://localhost:${PORT}`);
    setTimeout(() => backfillThumbs().catch((e) => console.error('backfill', e)), 2000);
    billing.labelOldCustomers().catch((e) => console.error('stripe mode check', e.message));
  });
  // Node cuts any request after 5 minutes by default, which kills big uploads on slow connections.
  server.requestTimeout = 2 * 3600 * 1000;
}
module.exports = app;
