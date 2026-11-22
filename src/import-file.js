// Copies a file from a link into a delivery, server to server, then makes a thumbnail. With cloud
// storage set up, the download streams straight into the bucket and never touches this server's
// disk (which is small: a big video used to fill it and fail with ENOSPC). Without it, the file is
// downloaded next to the delivery's other files. Used by "Add from Vault", the Google Drive copy and
// the AI assistant's add_file_from_url.
const fs = require('fs');
const path = require('path');
const { download } = require('./fetch-file');

function makeImporter({ db, token, storage, kindOf, makeThumb, queueView, insertAsset, spaceProblem, spaceLeft, reserved, MAX_UPLOAD, UPLOADS, fmtSize, storeFromBucket }) {
  const fail = (message) => Object.assign(new Error(message), { friendly: true });
  // Resolves to { id, name, kind, size }. Rejects with an Error whose message can be shown to the creator.
  // headers: sent with the download (only to the link's own site). folder: "BTS" or "BTS/Raw", or null.
  async function importFile(user, p, url, { filename, headers, folder } = {}) {
    const full = spaceProblem(user, 1);
    if (full) throw fail(full);
    const hold = `import:${token(9)}`;
    const maxBytes = (declared) => {
      const max = Math.min(MAX_UPLOAD, spaceLeft(user));
      // Hold the size against the plan while it downloads, like browser uploads do, so
      // parallel uploads can't overshoot it.
      reserved.set(hold, { userId: user.id, size: declared && declared <= max ? declared : max, at: Date.now() });
      return max;
    };
    const failed = (e) => {
      if (e.code === 'ETOOBIG') return fail(spaceProblem(user, e.size) || `That file is over the ${fmtSize(MAX_UPLOAD)} limit per file.`);
      return fail(`Couldn't get the file: ${e.message}`);
    };
    if (storage.enabled) return importToBucket(p, url, { filename, headers, folder, maxBytes, hold, failed });
    const dir = path.join(UPLOADS, String(p.id));
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${token(12)}.part`);
    let got;
    try {
      got = await download(url, tmp, { headers, maxBytes });
    } catch (e) {
      reserved.delete(hold);
      throw failed(e);
    }
    try {
      return await store(p, tmp, { name: filename || got.name, type: got.type, size: got.size, folder });
    } finally {
      reserved.delete(hold);
      fs.rm(tmp, { force: true }, () => {});
    }
  }

  // Streams the download into the bucket as it arrives, then adds it to the delivery and makes the
  // thumbnail from the bucket copy.
  async function importToBucket(p, url, { filename, headers, folder, maxBytes, hold, failed }) {
    let key = null, sent = 0;
    try {
      let got;
      try {
        got = await download(url, async (stream, info) => {
          const ext = path.extname(filename || info.name || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
          key = `projects/${p.id}/${token(12)}${ext}`;
          sent = await storage.putStream(key, stream, info.type, info.declared || info.max);
        }, { headers, maxBytes });
      } catch (e) {
        if (key) storage.remove(key);
        throw failed(e);
      }
      try {
        return await storeFromBucket(p, key, { name: filename || got.name, type: got.type, size: sent || got.size, folder });
      } catch (e) {
        storage.remove(key);
        throw fail(`The file arrived but couldn't be saved: ${e.message}`);
      }
    } finally {
      reserved.delete(hold);
    }
  }

  // Saves a file already on this server's disk (tmp) into a delivery: into cloud storage when it's
  // set up, otherwise next to the delivery's other files, then makes a thumbnail. The caller removes
  // tmp afterwards (it may already have been moved). Resolves to { id, name, kind, size }.
  async function store(p, tmp, { name: raw, type, size, folder }) {
    try {
      const dir = path.join(UPLOADS, String(p.id));
      fs.mkdirSync(dir, { recursive: true });
      const name = String(raw || 'file').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 255) || 'file';
      const kind = kindOf(type || '', name);
      const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
      let stored, where = null;
      if (storage.enabled) {
        stored = `projects/${p.id}/${token(12)}${ext}`;
        await storage.putFile(stored, tmp, type);
        where = 's3';
      } else {
        stored = token(12) + ext;
        fs.renameSync(tmp, path.join(dir, stored));
      }
      const r = insertAsset.run(p.id, name, stored, type, size, kind, where, p.id);
      if (folder) db.prepare('UPDATE assets SET folder = ? WHERE id = ?').run(folder, r.lastInsertRowid);
      const thumb = await makeThumb(where ? tmp : path.join(dir, stored), kind, r.lastInsertRowid);
      if (thumb) db.prepare('UPDATE assets SET thumb_name = ? WHERE id = ?').run(thumb, r.lastInsertRowid);
      // Made from the bucket copy in the background (tmp is removed as soon as this returns).
      if (queueView) queueView(r.lastInsertRowid);
      return { id: Number(r.lastInsertRowid), name, kind, size };
    } catch (e) {
      throw fail(`The file arrived but couldn't be saved: ${e.message}`);
    }
  }

  importFile.store = store;
  return importFile;
}

module.exports = { makeImporter };
