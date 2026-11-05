const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const { db, DATA_DIR } = require('./src/db');
const { kindOf, makeThumb } = require('./src/media');
const V = require('./src/views');

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
const UPLOADS = path.join(DATA_DIR, 'uploads');
const THUMBS = path.join(DATA_DIR, 'thumbs');

const app = express();
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(SECRET));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
const ICONS = path.join(__dirname, 'public', 'icons');
app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.type('text').send('ok'); });
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(ICONS, 'favicon.ico'), { maxAge: '7d' }));
app.get('/apple-touch-icon.png', (req, res) => res.sendFile(path.join(ICONS, 'apple-touch-icon.png'), { maxAge: '7d' }));
app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').sendFile(path.join(ICONS, 'manifest.webmanifest')));

const token = (n = 24) => crypto.randomBytes(n).toString('base64url');
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };

// ---------- auth ----------
app.use((req, res, next) => {
  const t = req.signedCookies.cf_session;
  if (t) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`).get(t, Date.now());
    if (row) req.user = row;
  }
  next();
});
const requireUser = (req, res, next) => (req.user ? next() : res.redirect('/login'));

function startSession(res, userId) {
  const t = token();
  const maxAge = 30 * 24 * 3600 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(t, userId, Date.now() + maxAge);
  res.cookie('cf_session', t, { ...cookieOpts, signed: true, maxAge });
}

app.get('/', (req, res) => (req.user ? res.redirect('/dashboard') : res.send(V.landing())));
app.get('/signup', (req, res) => res.send(V.authForm({ mode: 'signup' })));
app.get('/login', (req, res) => res.send(V.authForm({ mode: 'login' })));

app.post('/signup', (req, res) => {
  const { name = '', studio = '', email = '', password = '' } = req.body;
  const values = { name, studio, email };
  if (!name.trim() || !email.trim() || password.length < 8)
    return res.status(400).send(V.authForm({ mode: 'signup', error: 'Name, email and an 8+ character password are required.', values }));
  try {
    const r = db.prepare('INSERT INTO users (email, name, studio, password_hash) VALUES (?, ?, ?, ?)')
      .run(email.trim().toLowerCase(), name.trim(), studio.trim() || null, bcrypt.hashSync(password, 10));
    startSession(res, r.lastInsertRowid);
    res.redirect('/dashboard');
  } catch (e) {
    res.status(400).send(V.authForm({ mode: 'signup', error: 'An account with that email already exists.', values }));
  }
});

app.post('/login', (req, res) => {
  const { email = '', password = '' } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.password_hash))
    return res.status(401).send(V.authForm({ mode: 'login', error: 'Wrong email or password.', values: { email } }));
  startSession(res, u.id);
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  const t = req.signedCookies.cf_session;
  if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
  res.clearCookie('cf_session');
  res.redirect('/');
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
  res.send(V.dashboard({ user: req.user, projects }));
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
  const recent = db.prepare(`SELECT p.id, p.title, p.share_token,
      COALESCE((SELECT a.id FROM assets a WHERE a.id = p.cover_asset_id AND a.thumb_name IS NOT NULL),
        (SELECT a.id FROM assets a WHERE a.project_id = p.id AND a.thumb_name IS NOT NULL ORDER BY a.position, a.id LIMIT 1)) AS cover_id
    FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT 3`).all(req.user.id);
  res.send(V.projectPage({ user: req.user, project: p, assets, saved: req.query.saved, recent,
    stats: { views: stats.views || 0, downloads: stats.downloads || 0, last: stats.last },
    origin: process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}` }));
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
  fs.rm(path.join(UPLOADS, String(a.project_id), a.stored_name), { force: true }, () => {});
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

app.post('/projects/:id/upload', requireUser, ownProject, upload.array('files'), async (req, res) => {
  const insert = db.prepare(`INSERT INTO assets (project_id, original_name, stored_name, mime, size, kind, position)
    VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM assets WHERE project_id = ?))`);
  const out = [];
  for (const f of req.files || []) {
    // Browsers send filenames as latin1 through multipart; recover UTF-8 names.
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    const kind = kindOf(f.mimetype, name);
    const r = insert.run(req.project.id, name, f.filename, f.mimetype, f.size, kind, req.project.id);
    const thumb = await makeThumb(f.path, kind, r.lastInsertRowid);
    if (thumb) db.prepare('UPDATE assets SET thumb_name = ? WHERE id = ?').run(thumb, r.lastInsertRowid);
    out.push({ id: r.lastInsertRowid, name, kind, size: f.size });
  }
  res.json({ ok: true, files: out });
});

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
  if (p.password_hash && bcrypt.compareSync(req.body.password || '', p.password_hash)) {
    res.cookie(`cf_unlock_${p.id}`, unlockValue(p), { ...cookieOpts, signed: true, maxAge: 30 * 24 * 3600 * 1000 });
    return res.redirect(`/d/${p.share_token}`);
  }
  res.status(401).send(V.unlockPage({ project: p, studio: p.owner_studio || p.owner_name, error: 'That password is not right.' }));
});

app.get('/d/:token/thumb/:aid', loadDelivery, requireUnlocked, (req, res) => {
  const a = getAsset(req);
  if (!a || !a.thumb_name) return res.sendStatus(404);
  res.sendFile(path.join(THUMBS, a.thumb_name), { maxAge: '7d' });
});

// Inline streaming (sendFile handles HTTP Range requests for video seeking).
app.get('/d/:token/media/:aid', loadDelivery, requireUnlocked, (req, res) => {
  const a = getAsset(req);
  if (!a) return res.sendStatus(404);
  res.type(a.mime || 'application/octet-stream');
  res.sendFile(path.join(UPLOADS, String(a.project_id), a.stored_name), { headers: { 'Content-Disposition': 'inline' } });
});

app.get('/d/:token/download/:aid', loadDelivery, requireUnlocked, (req, res) => {
  if (!req.project.allow_download && !req.isOwner) return res.sendStatus(403);
  const a = getAsset(req);
  if (!a) return res.sendStatus(404);
  if (!req.headers.range) track(req, 'download', a.id);
  res.download(path.join(UPLOADS, String(a.project_id), a.stored_name), a.original_name);
});

app.get('/d/:token/zip', loadDelivery, requireUnlocked, (req, res) => {
  const p = req.project;
  if (!p.allow_download && !req.isOwner) return res.sendStatus(403);
  let assets = db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY position, id').all(p.id);
  // ?ids=1,2,3 zips only the files the client picked in the gallery.
  const ids = new Set(String(req.query.ids || '').split(',').map(Number).filter(Boolean));
  if (ids.size) assets = assets.filter((a) => ids.has(a.id));
  if (!assets.length) return res.sendStatus(404);
  track(req, 'zip');
  const safe = p.title.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'delivery';
  res.attachment(`${safe}${ids.size ? ' (selection)' : ''}.zip`);
  const zip = new ZipArchive({ store: true }); // media is already compressed
  zip.on('error', () => res.end());
  zip.pipe(res);
  const used = new Set();
  for (const a of assets) {
    let n = a.original_name, i = 1;
    while (used.has(n)) n = a.original_name.replace(/(\.[^.]*)?$/, ` (${i++})$1`);
    used.add(n);
    zip.file(path.join(UPLOADS, String(a.project_id), a.stored_name), { name: n });
  }
  zip.finalize();
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: 'File too large' });
  res.status(500).send(V.messagePage('Something went wrong', 'Please try again.'));
});

if (require.main === module) app.listen(PORT, () => console.log(`ContentFlows running on http://localhost:${PORT}`));
module.exports = app;
