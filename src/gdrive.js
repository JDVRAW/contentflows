// The creator's Google Drive, connected under Connect with Google sign-in (OAuth, read-only).
// ContentFlows keeps only a refresh token; with it, files are copied from Drive into a delivery
// server to server, so they never have to be shared publicly and never pass through a computer.
// On only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (a Google Cloud "Web application"
// OAuth client whose redirect URI is <site>/connect/google/callback).
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const enabled = !!(CLIENT_ID && CLIENT_SECRET);

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.readonly'];
const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';

const fail = (message, extra) => Object.assign(new Error(message), extra || {});
const RECONNECT = 'Google Drive needs to be connected again. Open Connect AI in ContentFlows and choose Connect Google Drive.';

const connected = (user) => !!(enabled && user && user.gdrive_refresh);

function authUrl(redirectUri, state) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenCall(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(body.error === 'invalid_grant' ? RECONNECT : `Google said no: ${body.error_description || body.error || r.status}`,
    { reconnect: body.error === 'invalid_grant' });
  return body;
}

// After Google sends the creator back: trade the code for tokens. Resolves to { refresh, email }.
async function finish(code, redirectUri) {
  const t = await tokenCall({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!t.refresh_token) throw fail('Google didn’t give ContentFlows lasting access. Try connecting again.');
  if (!String(t.scope || '').includes('drive')) throw fail('Tick the box that lets ContentFlows see your Google Drive files, then try again.');
  let email = '';
  try {
    const me = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
    email = (await me.json()).email || '';
  } catch (e) {}
  cache.set(t.refresh_token, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  return { refresh: t.refresh_token, email };
}

// Access tokens last an hour; keep each one until shortly before it runs out.
const cache = new Map(); // refresh token -> { token, until }
async function accessToken(user) {
  if (!connected(user)) throw fail('Google Drive isn’t connected. Connect it in ContentFlows under Connect AI.', { notConnected: true });
  const hit = cache.get(user.gdrive_refresh);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await tokenCall({ refresh_token: user.gdrive_refresh, grant_type: 'refresh_token' });
  cache.set(user.gdrive_refresh, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  return t.access_token;
}

function revoke(refresh) {
  cache.delete(refresh);
  return fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => {});
}

// A Drive file or folder id from anything the creator or an assistant might pass: a share link
// (drive.google.com/file/d/<id>/view, /drive/folders/<id>, open?id=<id>, uc?id=<id>,
// drive.usercontent.google.com/download?id=<id>, docs.google.com/…/d/<id>) or the bare id.
function idOf(raw) {
  const s = String(raw || '').trim();
  if (/^[\w-]{10,200}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (!/(^|\.)google\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/\/(?:file\/d|folders|d)\/([\w-]{10,200})/);
  if (m) return m[1];
  const q = u.searchParams.get('id');
  return q && /^[\w-]{10,200}$/.test(q) ? q : null;
}
const isDriveLink = (raw) => { try { return /(^|\.)(drive|docs|drive\.usercontent)\.google\.com$/.test(new URL(raw).hostname) && !!idOf(raw); } catch (e) { return false; } };

async function api(user, pathAndQuery) {
  const token = await accessToken(user);
  const r = await fetch(`${API}${pathAndQuery}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => null);
  if (r.status === 401) { cache.delete(user.gdrive_refresh); throw fail(RECONNECT, { reconnect: true }); }
  if (r.status === 404) throw fail('That file isn’t in the connected Google Drive, or the connected account can’t open it.', { status: 404 });
  if (!r.ok) throw fail(`Google Drive answered with an error: ${(body && body.error && body.error.message) || r.status}`, { status: r.status });
  return body;
}

const FIELDS = 'id,name,mimeType,size,shortcutDetails(targetId,targetMimeType)';
const view = (f) => ({ id: f.id, name: f.name, folder: f.mimeType === FOLDER, mimeType: f.mimeType, size: Number(f.size) || 0 });

// One file or folder's details, following shortcuts to what they point at.
async function meta(user, id) {
  let f = await api(user, `/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`);
  if (f.mimeType === SHORTCUT && f.shortcutDetails && f.shortcutDetails.targetId)
    f = await api(user, `/files/${encodeURIComponent(f.shortcutDetails.targetId)}?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`);
  return view(f);
}

// What's directly inside a folder (folders first, then by name).
async function list(user, folderId) {
  const out = [];
  let page = '';
  do {
    const q = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`, fields: `nextPageToken,files(${FIELDS})`,
      pageSize: '1000', orderBy: 'folder,name', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      ...(page ? { pageToken: page } : {}),
    });
    const r = await api(user, `/files?${q}`);
    out.push(...(r.files || []).map(view));
    page = r.nextPageToken || '';
  } while (page && out.length < 5000);
  return out;
}

// Files and folders whose name contains the text, newest first.
async function search(user, text) {
  const q = new URLSearchParams({
    q: `name contains '${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed = false`, fields: `files(${FIELDS},modifiedTime)`,
    pageSize: '50', orderBy: 'modifiedTime desc', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives',
  });
  const r = await api(user, `/files?${q}`);
  return (r.files || []).map((f) => ({ ...view(f), modified: f.modifiedTime }));
}

// Google Docs, Sheets and Slides aren't files with bytes; they'd need exporting first.
const isNative = (f) => /^application\/vnd\.google-apps\./.test(f.mimeType);

// What importFile needs to copy one Drive file: its download address and the header to send.
async function source(user, id) {
  const token = await accessToken(user);
  return { url: `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, headers: { Authorization: `Bearer ${token}` } };
}

module.exports = { enabled, connected, authUrl, finish, revoke, idOf, isDriveLink, meta, list, search, isNative, source, RECONNECT };
