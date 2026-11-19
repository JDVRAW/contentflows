// The creator's Vault: their own storage platform, connected with a read-only access key made in
// the Vault (Settings → Connected apps). ContentFlows lists folders and copies files from it, server
// to server, so big videos never pass through the creator's browser.
// Every call goes through fetch-file, which only reaches public internet addresses.
const { open, getJson } = require('./fetch-file');

// "storage.example.com" or "https://storage.example.com/app" → "https://storage.example.com".
function cleanAddress(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    return u.origin;
  } catch (e) { return null; }
}

const auth = (key) => ({ Authorization: `Bearer ${key}` });
const cleanId = (id) => (/^[\w-]{1,64}$/.test(String(id || '')) ? String(id) : null);

// Turn a Vault answer into an error the creator can act on.
function problem(status, body) {
  if (status === 401) return 'Your Vault key was removed or is wrong. Connect your Vault again under Connect.';
  if (status === 404) return (body && body.error) || 'Not found in your Vault.';
  if (body && body.error) return body.error;
  return `Your Vault answered with an error (${status}).`;
}

async function call(address, key, pathAndQuery) {
  let r;
  try { r = await getJson(`${address}${pathAndQuery}`, { headers: auth(key) }); } catch (e) {
    throw new Error(e.code === 'EPRIVATE' ? 'That address is private, so it can’t be reached.' : `Couldn’t reach your Vault: ${e.message}`);
  }
  if (r.status !== 200 || !r.body) {
    if (pathAndQuery.startsWith('/api/connect/me')) {
      if (r.status === 401) throw new Error('That access key isn’t right, or it was removed in your Vault. Make a new one in your Vault under Security → Connected apps.');
      if (r.status === 404 || !r.body) throw new Error('That address doesn’t look like a Vault, or the Vault needs updating to allow connected apps.');
    }
    throw Object.assign(new Error(problem(r.status, r.body)), { status: r.status });
  }
  return r.body;
}

// Check an address and key before saving them. Resolves to the Vault account's email.
async function check(address, key) {
  const me = await call(address, key, '/api/connect/me');
  return me.email || '';
}

const connected = (user) => (user && user.vault_url && user.vault_key ? { address: user.vault_url, key: user.vault_key } : null);

function browse(user, folderId) {
  const v = connected(user);
  const id = folderId ? cleanId(folderId) : '';
  if (folderId && !id) return Promise.reject(new Error('Not found in your Vault.'));
  return call(v.address, v.key, `/api/connect/browse${id ? `?folderId=${encodeURIComponent(id)}` : ''}`);
}

// The thumbnail's response (status, headers, body stream) to pipe to the browser.
function thumbnail(user, fileId) {
  const v = connected(user);
  const id = cleanId(fileId);
  if (!id) return Promise.reject(new Error('Not found'));
  return open(`${v.address}/api/connect/files/${id}/thumbnail`, { headers: auth(v.key) });
}

// What importFile needs to copy one Vault file: its download address and the key to send with it.
function source(user, fileId) {
  const v = connected(user);
  const id = cleanId(fileId);
  if (!v || !id) return null;
  return { url: `${v.address}/api/connect/files/${id}/download`, headers: auth(v.key) };
}

module.exports = { cleanAddress, check, connected, browse, thumbnail, source };
