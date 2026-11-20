// MCP server: lets an AI assistant (Claude, ChatGPT, Cursor…) work on a creator's deliveries.
// Served at /mcp over Streamable HTTP, stateless: each request gets a fresh server bound to the
// creator whose API key came with it. The key goes in an "Authorization: Bearer <key>" header, or
// in the address itself (/mcp/<key>) for apps whose connector screens only take a URL.
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const retention = require('./retention');

const KEY_PREFIX = 'cf_';
const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');
const newKey = () => KEY_PREFIX + crypto.randomBytes(32).toString('base64url');

// ctx: what the tools need from server.js (database, storage, plan checks, helpers).
function mcpRouter(ctx) {
  const { db, token, TYPES, deleteDelivery, removeAssetFiles, importFile,
    usage, originOf, fmtSize, userView, gdrive, vault, queueImport, importStatus, spaceProblem, cleanFolder, makeUploadLink } = ctx;
  const router = express.Router();

  const findKey = db.prepare('SELECT k.id AS key_id, u.* FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?');
  const touchKey = db.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-5 minutes'))");

  function auth(req, res, next) {
    const header = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
    const key = req.params.key || (header && header[1]) || '';
    const row = key.startsWith(KEY_PREFIX) ? findKey.get(hashKey(key)) : null;
    if (!row) {
      res.set('WWW-Authenticate', 'Bearer realm="ContentFlows"');
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing or unknown API key. Make one in ContentFlows under Connect AI.' }, id: null });
    }
    touchKey.run(row.key_id);
    req.user = userView(row);
    next();
  }

  async function handle(req, res) {
    const server = buildServer(req.user, originOf(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
  // Stateless: no event stream to open and no session to end.
  const notAllowed = (req, res) => res.status(405).set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });

  for (const p of ['/', '/:key']) {
    router.post(p, auth, express.json({ limit: '1mb' }), handle);
    router.get(p, notAllowed);
    router.delete(p, notAllowed);
  }

  // ---------- tools ----------
  function buildServer(user, origin) {
    const server = new McpServer({ name: 'contentflows', version: '1.0.0' }, {
      instructions: 'ContentFlows delivers final photoshoots, films and commercials to clients through one private link. '
        + 'A "delivery" is one project for one client: its files, a share link, and settings (password, expiry, downloads). '
        + 'Auto-delete is off unless turned on: then the delivery and its files are deleted auto_delete_days after the client first downloads anything (deletes_on). '
        + 'Typical flow: create_delivery, add files, then give the user the share link from the result. '
        + 'Adding files: for files in the user\'s Google Drive (private or shared), use add_files_from_google_drive with the Drive links or file ids, '
        + 'even when they are not public; it works once the user has connected Google Drive in ContentFlows (Connect AI). '
        + 'For the user\'s Vault use browse_vault and add_files_from_vault. For any other public link use add_file_from_url. '
        + 'For files on the user\'s own computer, use create_upload_links and then send each file to its link with the curl command it returns '
        + '(this needs an app that can run commands on that computer, such as Claude Desktop with folder access or Claude Code). '
        + 'Drive and Vault copies run in the background: check them with get_import_status before saying they are done. '
        + 'Before adding, look at get_delivery so files that are already there are not added twice. '
        + 'Always show the share link exactly as returned. Before remove_file, new_share_link or delete_delivery, confirm with the user.',
    });
    const link = (p) => `${origin}/d/${p.share_token}`;
    const own = (id) => db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, user.id);
    const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
    const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });
    const typeEnum = z.enum(Object.keys(TYPES));
    const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

    const summary = (p) => {
      const n = db.prepare(`SELECT
          (SELECT COUNT(*) FROM assets WHERE project_id = @id) AS files,
          (SELECT COALESCE(SUM(size), 0) FROM assets WHERE project_id = @id) AS bytes,
          (SELECT COUNT(*) FROM events WHERE project_id = @id AND type = 'view') AS views,
          (SELECT COUNT(*) FROM events WHERE project_id = @id AND type IN ('download', 'zip')) AS downloads`).get({ id: p.id });
      return {
        id: p.id, title: p.title, type: p.type, client_name: p.client_name, client_email: p.client_email,
        share_link: link(p), password_protected: !!p.password_hash, downloads_allowed: !!p.allow_download,
        expires_on: p.expires_at,
        auto_delete: !!p.auto_delete, auto_delete_days: retention.daysOf(p), deletes_on: p.auto_delete && p.delete_at ? `${p.delete_at.replace(' ', 'T')}Z` : null,
        files: n.files, total_size: fmtSize(n.bytes), views: n.views, downloads: n.downloads,
        created_at: p.created_at,
      };
    };

    server.registerTool('list_deliveries', {
      title: 'List deliveries',
      description: 'List all of the creator\'s deliveries, newest first, with their share link, file count, size, views and downloads.',
      inputSchema: { search: z.string().optional().describe('Only deliveries whose title or client name contains this text') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ search }) => {
      let rows = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(user.id);
      if (search) {
        const q = search.toLowerCase();
        rows = rows.filter((p) => `${p.title} ${p.client_name || ''}`.toLowerCase().includes(q));
      }
      return ok({ deliveries: rows.map(summary) });
    });

    server.registerTool('get_delivery', {
      title: 'Get a delivery',
      description: 'Details of one delivery: settings, share link, message to the client, activity, and every file with its id, size and downloads.',
      inputSchema: { delivery_id: z.number().int().describe('Delivery id from list_deliveries') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ delivery_id }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      const files = db.prepare(`SELECT a.id, a.original_name AS name, a.folder, a.kind, a.size,
          (SELECT COUNT(*) FROM events e WHERE e.asset_id = a.id AND e.type = 'download') AS downloads
        FROM assets a WHERE a.project_id = ? ORDER BY a.position, a.id`).all(p.id)
        .map((f) => ({ ...f, size: fmtSize(f.size), is_cover: f.id === p.cover_asset_id }));
      const last = db.prepare('SELECT MAX(created_at) AS t FROM events WHERE project_id = ?').get(p.id).t;
      return ok({ ...summary(p), message: p.message, last_activity: last, files });
    });

    server.registerTool('create_delivery', {
      title: 'Create a delivery',
      description: 'Create a new delivery for a client. Returns its id and share link. Add files next with add_files_from_google_drive, add_files_from_vault or add_file_from_url.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('e.g. "Ana & Luis wedding — finals"'),
        type: typeEnum.optional().describe(`One of: ${Object.entries(TYPES).map(([k, v]) => `${k} (${v})`).join(', ')}. Default project`),
        client_name: z.string().max(200).optional(),
        client_email: z.string().email().optional(),
        message: z.string().max(4000).optional().describe('Note shown to the client on the delivery page'),
        password: z.string().min(1).max(200).optional().describe('If set, the client needs it to open the link'),
        expires_on: dateText.optional().describe('Last day the link works (YYYY-MM-DD)'),
        allow_downloads: z.boolean().optional().describe('Default true'),
        auto_delete: z.boolean().optional().describe('Delete the delivery and its files auto_delete_days after the client\'s first download. Default false'),
        auto_delete_days: z.number().int().min(1).max(retention.MAX_DAYS).optional().describe(`Days from the client's first download to deletion. Default ${retention.DEFAULT_DAYS}`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (a) => {
      const r = db.prepare(`INSERT INTO projects (user_id, title, type, client_name, client_email, message, share_token, password_hash, allow_download, expires_at, auto_delete, auto_delete_days)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, a.title.trim(), a.type || 'project', a.client_name?.trim() || null,
        a.client_email?.trim() || null, a.message?.trim() || null, token(16), a.password ? bcrypt.hashSync(a.password, 10) : null,
        a.allow_downloads === false ? 0 : 1, a.expires_on || null, a.auto_delete ? 1 : 0, retention.cleanDays(a.auto_delete_days));
      return ok(summary(own(r.lastInsertRowid)));
    });

    server.registerTool('update_delivery', {
      title: 'Update a delivery',
      description: 'Change a delivery\'s details or link settings. Only the fields you pass are changed.',
      inputSchema: {
        delivery_id: z.number().int(),
        title: z.string().min(1).max(200).optional(),
        type: typeEnum.optional(),
        client_name: z.string().max(200).optional(),
        client_email: z.string().email().or(z.literal('')).optional(),
        message: z.string().max(4000).optional(),
        password: z.string().min(1).max(200).optional().describe('Set or change the password'),
        remove_password: z.boolean().optional(),
        expires_on: dateText.or(z.literal('')).optional().describe('YYYY-MM-DD, or "" for no expiry'),
        allow_downloads: z.boolean().optional(),
        auto_delete: z.boolean().optional().describe('true turns auto-delete on (the countdown starts at the client\'s next download); false keeps the delivery and stops a running countdown'),
        auto_delete_days: z.number().int().min(1).max(retention.MAX_DAYS).optional().describe('Days from the client\'s first download to deletion; moves a running countdown'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (a) => {
      const p = own(a.delivery_id);
      if (!p) return fail(`No delivery with id ${a.delivery_id}.`);
      const pick = (v, cur) => (v === undefined ? cur : v.trim() || null);
      let pw = p.password_hash;
      if (a.remove_password) pw = null;
      if (a.password) pw = bcrypt.hashSync(a.password, 10);
      db.prepare(`UPDATE projects SET title = ?, type = ?, client_name = ?, client_email = ?, message = ?,
        password_hash = ?, allow_download = ?, expires_at = ?, auto_delete = ?, auto_delete_days = ?, delete_at = ? WHERE id = ?`).run(
        a.title?.trim() || p.title, a.type || p.type, pick(a.client_name, p.client_name), pick(a.client_email, p.client_email),
        pick(a.message, p.message), pw, a.allow_downloads === undefined ? p.allow_download : a.allow_downloads ? 1 : 0,
        a.expires_on === undefined ? p.expires_at : a.expires_on || null,
        ...(() => {
          const on = a.auto_delete === undefined ? !!p.auto_delete : a.auto_delete;
          const days = a.auto_delete_days === undefined ? retention.daysOf(p) : retention.cleanDays(a.auto_delete_days);
          const at = on && p.auto_delete && p.delete_at ? retention.shiftDeleteAt(p.delete_at, retention.daysOf(p), days) : null;
          return [on ? 1 : 0, days, at];
        })(), p.id);
      return ok(summary(own(p.id)));
    });

    server.registerTool('add_file_from_url', {
      title: 'Add a file from a link',
      description: 'Download a file from a public link and add it to a delivery. Works with direct download links and with Dropbox and '
        + 'Google Drive share links. A Drive link is opened with the user\'s connected Google Drive when there is one, so it doesn\'t need to be public '
        + '(for several Drive files, or a Drive folder, use add_files_from_google_drive instead). Thumbnails are made for photos and videos. '
        + 'Big videos can take a while; for very large files suggest uploading in the ContentFlows app instead.',
      inputSchema: {
        delivery_id: z.number().int(),
        url: z.string().url().describe('Public http(s) link to the file'),
        filename: z.string().max(255).optional().describe('Name to show the client, with extension. Default: the name from the link'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async ({ delivery_id, url, filename }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      try {
        let src = { url };
        if (gdrive.isDriveLink(url) && gdrive.connected(user)) {
          const m = await gdrive.meta(user, gdrive.idOf(url));
          if (m.folder) return fail('That is a Google Drive folder. Use add_files_from_google_drive to add what is inside it.');
          if (gdrive.isNative(m)) return fail(`"${m.name}" is a Google Docs, Sheets or Slides file, which can't be added as it is. Export it as a PDF or other file first.`);
          src = { ...(await gdrive.source(user, m.id)) };
          filename = filename || m.name;
        }
        const f = await importFile(user, p, src.url, { filename, headers: src.headers });
        return ok({ file: { id: f.id, name: f.name, kind: f.kind, size: fmtSize(f.size) }, delivery: summary(own(p.id)) });
      } catch (e) {
        return fail(e.message);
      }
    });

    const queued = (p, items, folder, extra = {}) => {
      const job = queueImport(p.id, items, folder);
      return ok({ ...extra, queued: items.map((i) => ({ name: i.name, size: fmtSize(i.size) })), folder: folder || null,
        status: 'Copying in the background, one file at a time. Big videos take a few minutes each. Call get_import_status to see when they are done.',
        in_progress: job.items.filter((i) => i.state === 'waiting' || i.state === 'copying').length, delivery_id: p.id });
    };
    const roomFor = (items) => spaceProblem(user, items.reduce((n, i) => n + (i.size || 0), 0));

    server.registerTool('add_files_from_google_drive', {
      title: 'Add files from Google Drive',
      description: 'Copy files from the user\'s own Google Drive into a delivery, server to server, at full quality. The files do NOT need to be shared '
        + 'publicly: ContentFlows reads them with the Google Drive the user connected under Connect AI. Pass Drive share links, '
        + 'file ids, or a folder link/id (adds the files directly inside that folder; subfolders are listed but not added). '
        + 'Returns right away while the copies run in the background; check progress with get_import_status. '
        + 'If Google Drive is not connected, the answer says where the user connects it.',
      inputSchema: {
        delivery_id: z.number().int(),
        files: z.array(z.string().min(1).max(500)).min(1).max(200).describe('Google Drive links or ids of files or folders'),
        folder: z.string().max(300).optional().describe('Delivery folder to put them in, like "Reels" or "Photos/Selects". Default: the top level'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async ({ delivery_id, files, folder }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      if (!gdrive.enabled) return fail('Google Drive isn\'t set up on this ContentFlows server yet. Share the files as "anyone with the link" and use add_file_from_url, or upload them in the app.');
      if (!gdrive.connected(user)) return fail(`Google Drive isn't connected to ContentFlows yet. Ask the user to open ${origin}/connect#google and choose Connect Google Drive (one time), then try again.`);
      const items = [], skipped = [];
      try {
        for (const raw of files) {
          const id = gdrive.idOf(raw);
          if (!id) { skipped.push({ file: raw, reason: 'Not a Google Drive link or id' }); continue; }
          let m;
          try { m = await gdrive.meta(user, id); } catch (e) {
            if (e.reconnect) throw e;
            skipped.push({ file: raw, reason: e.message }); continue;
          }
          const inside = m.folder ? await gdrive.list(user, m.id) : [m];
          for (const f of inside) {
            if (f.folder) skipped.push({ file: f.name, reason: 'Subfolder: pass its link to add what is inside it' });
            else if (gdrive.isNative(f)) skipped.push({ file: f.name, reason: 'Google Docs, Sheets and Slides files can\'t be added; export them first' });
            else if (!items.some((i) => i.driveId === f.id)) items.push({ from: 'drive', driveId: f.id, name: f.name, size: f.size });
          }
        }
      } catch (e) {
        return fail(e.message);
      }
      if (!items.length) return fail(`Nothing to add.${skipped.length ? ` ${JSON.stringify(skipped)}` : ''}`);
      const full = roomFor(items);
      if (full) return fail(`${full} Upgrade at ${origin}/pricing`);
      return queued(p, items, cleanFolder(folder), skipped.length ? { skipped } : {});
    });

    server.registerTool('create_upload_links', {
      title: 'Upload files from this computer',
      description: 'Make one private upload link per file so files on the user\'s own computer go straight into a delivery at full quality. '
        + 'Then, for each file, run the returned curl command on that computer (curl -T "<path>" "<upload_url>"); the answer is JSON with ok and the new file. '
        + 'Use it when the files are local (Desktop, Downloads, an external drive). It needs an app that can run commands on the user\'s computer, '
        + 'such as Claude Desktop with folder access or Claude Code; in a chat with no access to the computer, tell the user to upload in the ContentFlows app instead. '
        + 'Each link takes one file and expires after 24 hours. No size limit beyond the plan and the per-file limit.',
      inputSchema: {
        delivery_id: z.number().int(),
        files: z.array(z.object({
          name: z.string().min(1).max(255).describe('File name with extension as the client should see it, like "Reel 2.mp4"'),
          size_bytes: z.number().int().min(0).optional().describe('File size, when known, to check the plan has room first'),
        })).min(1).max(100),
        folder: z.string().max(300).optional().describe('Delivery folder to put them in, like "Reels". Default: the top level'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ delivery_id, files, folder }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      const full = spaceProblem(user, files.reduce((n, f) => n + (f.size_bytes || 0), 0));
      if (full) return fail(`${full} Upgrade at ${origin}/pricing`);
      const dest = cleanFolder(folder);
      const links = files.map((f) => {
        const l = makeUploadLink(user, p, { name: f.name, folder: dest });
        const url = `${origin}/up/${l.token}`;
        return { name: f.name, upload_url: url, curl: `curl --fail-with-body -T "<path to ${f.name.replace(/"/g, '')}>" "${url}"`, expires_at: l.expires_at };
      });
      return ok({ delivery_id: p.id, folder: dest, links,
        how: 'Run each curl command on the user\'s computer with the real file path. Upload one file per link; a failed upload can be retried on the same link.',
        share_link: link(p) });
    });

    server.registerTool('search_google_drive', {
      title: 'Find files in Google Drive',
      description: 'Search the user\'s connected Google Drive by name (files and folders), or list a folder\'s contents with folder. '
        + 'Returns ids to pass to add_files_from_google_drive.',
      inputSchema: {
        name: z.string().min(1).max(200).optional().describe('Text in the file or folder name, like "Zenaida"'),
        folder: z.string().max(500).optional().describe('A Drive folder link or id: list what is inside it instead of searching'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ name, folder }) => {
      if (!gdrive.connected(user)) return fail(gdrive.enabled ? `Google Drive isn't connected to ContentFlows yet. Ask the user to open ${origin}/connect#google and choose Connect Google Drive.` : 'Google Drive isn\'t set up on this ContentFlows server yet.');
      if (!name && !folder) return fail('Pass name or folder.');
      try {
        const id = folder && gdrive.idOf(folder);
        if (folder && !id) return fail('That is not a Google Drive folder link or id.');
        const found = id ? await gdrive.list(user, id) : await gdrive.search(user, name);
        return ok({ files: found.map((f) => ({ id: f.id, name: f.name, folder: f.folder, type: f.mimeType, size: f.folder ? null : fmtSize(f.size), modified: f.modified })) });
      } catch (e) { return fail(e.message); }
    });

    server.registerTool('browse_vault', {
      title: 'Browse the Vault',
      description: 'List one folder of the user\'s Vault (their ContentFlows storage platform): its subfolders and files with ids. '
        + 'Leave folder_id out for the top level. Use the file ids with add_files_from_vault.',
      inputSchema: { folder_id: z.string().max(64).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ folder_id }) => {
      if (!vault.connected(user)) return fail(`The Vault isn't connected. Ask the user to connect it at ${origin}/connect#vault.`);
      try {
        const r = await vault.browse(user, folder_id || null);
        return ok({ path: r.path || [], folders: r.folders || [], files: r.files || [] });
      } catch (e) { return fail(e.message); }
    });

    server.registerTool('add_files_from_vault', {
      title: 'Add files from the Vault',
      description: 'Copy files from the user\'s Vault into a delivery, server to server, at full quality. Get the file ids from browse_vault. '
        + 'Returns right away while the copies run in the background; check progress with get_import_status.',
      inputSchema: {
        delivery_id: z.number().int(),
        files: z.array(z.object({ id: z.string().regex(/^[\w-]{1,64}$/), name: z.string().max(255).optional(), size: z.number().optional() }))
          .min(1).max(500).describe('Files from browse_vault: their id, and name and size when known'),
        folder: z.string().max(300).optional().describe('Delivery folder to put them in. Default: the top level'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async ({ delivery_id, files, folder }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      if (!vault.connected(user)) return fail(`The Vault isn't connected. Ask the user to connect it at ${origin}/connect#vault.`);
      const items = files.map((f) => ({ from: 'vault', vaultId: f.id, name: f.name || 'file', size: f.size || 0 }));
      const full = roomFor(items);
      if (full) return fail(`${full} Upgrade at ${origin}/pricing`);
      return queued(p, items, cleanFolder(folder));
    });

    server.registerTool('get_import_status', {
      title: 'Check background copies',
      description: 'Progress of files being copied into a delivery from Google Drive or the Vault: each file is waiting, copying, done or failed (with the reason).',
      inputSchema: { delivery_id: z.number().int() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ delivery_id }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      const st = importStatus(p.id);
      const count = (s) => st.items.filter((i) => i.state === s).length;
      return ok({ delivery_id: p.id, running: st.running, done: count('done'), copying: count('copying'), waiting: count('waiting'), failed: count('failed'),
        files: st.items.map((i) => ({ ...i, size: fmtSize(i.size) })), share_link: link(p) });
    });

    server.registerTool('set_cover', {
      title: 'Set the cover',
      description: 'Use one of the delivery\'s photos or videos as the cover shown at the top of the client page.',
      inputSchema: { delivery_id: z.number().int(), file_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ delivery_id, file_id }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      const a = db.prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?').get(file_id, p.id);
      if (!a) return fail(`No file with id ${file_id} in this delivery.`);
      db.prepare('UPDATE projects SET cover_asset_id = ? WHERE id = ?').run(a.id, p.id);
      return ok({ cover: { id: a.id, name: a.original_name }, delivery: summary(own(p.id)) });
    });

    server.registerTool('remove_file', {
      title: 'Remove a file',
      description: 'Delete one file from a delivery for good. The client will no longer see it. Confirm with the user first.',
      inputSchema: { delivery_id: z.number().int(), file_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ delivery_id, file_id }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      const a = db.prepare('SELECT * FROM assets WHERE id = ? AND project_id = ?').get(file_id, p.id);
      if (!a) return fail(`No file with id ${file_id} in this delivery.`);
      db.prepare('DELETE FROM assets WHERE id = ?').run(a.id);
      removeAssetFiles(a);
      return ok({ removed: { id: a.id, name: a.original_name }, delivery: summary(own(p.id)) });
    });

    server.registerTool('delete_delivery', {
      title: 'Delete a delivery',
      description: 'Delete a whole delivery for good: all its files, folders, folder links and activity. Its share link stops '
        + 'working right away and the space is freed. This can\'t be undone. Confirm the title with the user first.',
      inputSchema: { delivery_id: z.number().int().describe('Delivery id from list_deliveries') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ delivery_id }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      // Same as deleting it in the app: the row goes (files, folders and events cascade), then the stored bytes.
      const files = deleteDelivery(p.id);
      const freed = files.reduce((n, a) => n + a.size, 0);
      return ok({ deleted: { id: p.id, title: p.title, client_name: p.client_name, files: files.length, freed: fmtSize(freed) } });
    });

    server.registerTool('new_share_link', {
      title: 'Replace the share link',
      description: 'Make a new share link for a delivery. The old link stops working right away. Confirm with the user first.',
      inputSchema: { delivery_id: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    }, async ({ delivery_id }) => {
      const p = own(delivery_id);
      if (!p) return fail(`No delivery with id ${delivery_id}.`);
      db.prepare('UPDATE projects SET share_token = ? WHERE id = ?').run(token(16), p.id);
      return ok(summary(own(p.id)));
    });

    server.registerTool('get_storage', {
      title: 'Storage and plan',
      description: 'How much storage the creator uses and how much their plan allows.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => {
      const { used, plan } = usage(user);
      return ok({ plan: plan.name, used: fmtSize(used), limit: plan.limit === Infinity ? 'unlimited' : fmtSize(plan.limit),
        left: plan.limit === Infinity ? 'unlimited' : fmtSize(Math.max(0, plan.limit - used)), upgrade: `${origin}/pricing` });
    });

    return server;
  }

  return router;
}

module.exports = { mcpRouter, newKey, hashKey };
