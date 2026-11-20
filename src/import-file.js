// Copies a file from a link into a delivery, server to server: download to this server's disk,
// then into cloud storage when it's set up, then make a thumbnail. Used by the AI assistant's
// add_file_from_url and by "Add from Vault".
const fs = require('fs');
const path = require('path');
const { download } = require('./fetch-file');

function makeImporter({ db, token, storage, kindOf, makeThumb, insertAsset, spaceProblem, spaceLeft, reserved, MAX_UPLOAD, UPLOADS, fmtSize }) {
  const fail = (message) => Object.assign(new Error(message), { friendly: true });
  // Resolves to { id, name, kind, size }. Rejects with an Error whose message can be shown to the creator.
  // headers: sent with the download (only to the link's own site). folder: "BTS" or "BTS/Raw", or null.
  async function importFile(user, p, url, { filename, headers, folder } = {}) {
    const full = spaceProblem(user, 1);
    if (full) throw fail(full);
    const dir = path.join(UPLOADS, String(p.id));
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${token(12)}.part`);
    const hold = `import:${token(9)}`;
    let got;
    try {
      got = await download(url, tmp, {
        headers,
        maxBytes: (declared) => {
          const max = Math.min(MAX_UPLOAD, spaceLeft(user));
          // Hold the size against the plan while it downloads, like browser uploads do, so
          // parallel uploads can't overshoot it.
          reserved.set(hold, { userId: user.id, size: declared && declared <= max ? declared : max, at: Date.now() });
          return max;
        },
      });
    } catch (e) {
      reserved.delete(hold);
      if (e.code === 'ETOOBIG') throw fail(spaceProblem(user, e.size) || `That file is over the ${fmtSize(MAX_UPLOAD)} limit per file.`);
      throw fail(`Couldn't get the file: ${e.message}`);
    }
    try {
      return await store(p, tmp, { name: filename || got.name, type: got.type, size: got.size, folder });
    } finally {
      reserved.delete(hold);
      fs.rm(tmp, { force: true }, () => {});
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
      return { id: Number(r.lastInsertRowid), name, kind, size };
    } catch (e) {
      throw fail(`The file arrived but couldn't be saved: ${e.message}`);
    }
  }

  importFile.store = store;
  return importFile;
}

module.exports = { makeImporter };
