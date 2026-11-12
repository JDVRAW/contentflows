// MCP server: lets an AI assistant (Claude, ChatGPT, Cursor…) work on a creator's deliveries.
// Served at /mcp over Streamable HTTP, stateless: each request gets a fresh server bound to the
// creator whose API key came with it. The key goes in an "Authorization: Bearer <key>" header, or
// in the address itself (/mcp/<key>) for apps whose connector screens only take a URL.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { download } = require('./fetch-file');

const KEY_PREFIX = 'cf_';
const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');
const newKey = () => KEY_PREFIX + crypto.randomBytes(32).toString('base64url');

// ctx: what the tools need from server.js (database, storage, plan checks, helpers).
function mcpRouter(ctx) {
  const { db, token, TYPES, storage, kindOf, makeThumb, insertAsset, removeAssetFiles, spaceProblem, spaceLeft, reserved,
    usage, originOf, MAX_UPLOAD, UPLOADS, fmtSize, userView } = ctx;
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
    res.on('close', () => { transport.close(); server.close(); });
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
        + 'Typical flow: create_delivery, add_file_from_url for each file, then give the user the share link from the result. '
        + 'Always show the share link exactly as returned.',
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
        expires_on: p.expires_at, files: n.files, total_size: fmtSize(n.bytes), views: n.views, downloads: n.downloads,
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
      description: 'Create a new delivery for a client. Returns its id and share link. Add files next with add_file_from_url.',
      inputSchema: {
        title: z.string().min(1).max(200).describe('e.g. "Ana & Luis wedding — finals"'),
        type: typeEnum.optional().describe(`One of: ${Object.entries(TYPES).map(([k, v]) => `${k} (${v})`).join(', ')}. Default project`),
        client_name: z.string().max(200).optional(),
        client_email: z.string().email().optional(),
        message: z.string().max(4000).optional().describe('Note shown to the client on the delivery page'),
        password: z.string().min(1).max(200).optional().describe('If set, the client needs it to open the link'),
        expires_on: dateText.optional().describe('Last day the link works (YYYY-MM-DD)'),
        allow_downloads: z.boolean().optional().describe('Default true'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (a) => {
      const r = db.prepare(`INSERT INTO projects (user_id, title, type, client_name, client_email, message, share_token, password_hash, allow_download, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, a.title.trim(), a.type || 'project', a.client_name?.trim() || null,
        a.client_email?.trim() || null, a.message?.trim() || null, token(16), a.password ? bcrypt.hashSync(a.password, 10) : null,
        a.allow_downloads === false ? 0 : 1, a.expires_on || null);
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
        password_hash = ?, allow_download = ?, expires_at = ? WHERE id = ?`).run(
        a.title?.trim() || p.title, a.type || p.type, pick(a.client_name, p.client_name), pick(a.client_email, p.client_email),
        pick(a.message, p.message), pw, a.allow_downloads === undefined ? p.allow_download : a.allow_downloads ? 1 : 0,
        a.expires_on === undefined ? p.expires_at : a.expires_on || null, p.id);
      return ok(summary(own(p.id)));
    });

    server.registerTool('add_file_from_url', {
      title: 'Add a file from a link',
      description: 'Download a file from a public link and add it to a delivery. Works with direct download links and with Dropbox and '
        + 'Google Drive share links (the file must be shared as "anyone with the link"). Thumbnails are made for photos and videos. '
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
      const full = spaceProblem(user, 1);
      if (full) return fail(full);
      const dir = path.join(UPLOADS, String(p.id));
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `${token(12)}.part`);
      const hold = `mcp:${token(9)}`;
      let got;
      try {
        got = await download(url, tmp, {
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
        if (e.code === 'ETOOBIG') return fail(spaceProblem(user, e.size) || `That file is over the ${fmtSize(MAX_UPLOAD)} limit per file.`);
        return fail(`Couldn't get the file: ${e.message}`);
      }
      try {
        const name = String(filename || got.name || 'file').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 255) || 'file';
        const kind = kindOf(got.type || '', name);
        const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
        let stored, where = null;
        if (storage.enabled) {
          stored = `projects/${p.id}/${token(12)}${ext}`;
          await storage.putFile(stored, tmp, got.type);
          where = 's3';
        } else {
          stored = token(12) + ext;
          fs.renameSync(tmp, path.join(dir, stored));
        }
        const r = insertAsset.run(p.id, name, stored, got.type, got.size, kind, where, p.id);
        const thumb = await makeThumb(where ? tmp : path.join(dir, stored), kind, r.lastInsertRowid);
        if (thumb) db.prepare('UPDATE assets SET thumb_name = ? WHERE id = ?').run(thumb, r.lastInsertRowid);
        return ok({ file: { id: Number(r.lastInsertRowid), name, kind, size: fmtSize(got.size) }, delivery: summary(own(p.id)) });
      } catch (e) {
        return fail(`The file downloaded but couldn't be saved: ${e.message}`);
      } finally {
        reserved.delete(hold);
        fs.rm(tmp, { force: true }, () => {});
      }
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
