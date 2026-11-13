const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'thumbs'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'contentflow.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  studio TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'photoshoot',
  client_name TEXT,
  client_email TEXT,
  message TEXT,
  share_token TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  allow_download INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  cover_asset_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  thumb_name TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id INTEGER,
  type TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
`);

// Where an asset's bytes live: NULL = local disk (DATA_DIR/uploads), 's3' = object storage (R2).
if (!db.prepare('PRAGMA table_info(assets)').all().some((c) => c.name === 'storage'))
  db.exec('ALTER TABLE assets ADD COLUMN storage TEXT');

// The folder a file was dropped in, as "BTS" or "BTS/Raw" (NULL = not in a folder).
if (!db.prepare('PRAGMA table_info(assets)').all().some((c) => c.name === 'folder'))
  db.exec('ALTER TABLE assets ADD COLUMN folder TEXT');

// Folders a creator made by hand on the project page. A folder with files in it also shows
// without a row here (it comes from the files' own folder); this keeps empty ones around.
db.exec(`
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, path)
);
`);

// Whether a folder is folded shut on the project page ('' is the "No folder" group).
if (!db.prepare('PRAGMA table_info(folders)').all().some((c) => c.name === 'collapsed'))
  db.exec('ALTER TABLE folders ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0');

// A folder's own delivery link: whoever has it sees only that folder (NULL = no link).
if (!db.prepare('PRAGMA table_info(folders)').all().some((c) => c.name === 'share_token'))
  db.exec('ALTER TABLE folders ADD COLUMN share_token TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_share ON folders(share_token)');

// Where a folder sits in the list the creator and client see (NULL = after the ordered ones, in upload order).
if (!db.prepare('PRAGMA table_info(folders)').all().some((c) => c.name === 'position'))
  db.exec('ALTER TABLE folders ADD COLUMN position INTEGER');

// Storage plan and Stripe subscription, per creator.
const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
for (const [name, type] of [['plan', "TEXT NOT NULL DEFAULT 'free'"], ['plan_interval', 'TEXT'], ['plan_status', 'TEXT'],
  ['plan_period_end', 'INTEGER'], ['plan_cancel_at_end', 'INTEGER NOT NULL DEFAULT 0'],
  ['stripe_customer_id', 'TEXT'], ['stripe_subscription_id', 'TEXT'],
  // 'test' or 'live': which kind of Stripe key the saved customer and subscription belong to.
  ['stripe_mode', 'TEXT'],
  // Branding (Pro and up): logo files under DATA_DIR/brand. logo_dark is the dark-ink version for
  // light backgrounds, logo_light the light-ink version for dark ones. Either can stand in for both.
  ['logo_dark', 'TEXT'], ['logo_light', 'TEXT']]) {
  if (!userCols.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
}

// Keys a creator makes so an AI assistant can work on their deliveries through /mcp.
// Only a SHA-256 hash of each key is kept; the key itself is shown once, when it's made.
db.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  hint TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
`);

// The last time the delivery link was emailed from the app, and to whom (shown on the delivery's page).
const projectCols = new Set(db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name));
for (const name of ['emailed_to', 'emailed_at']) if (!projectCols.has(name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} TEXT`);

// Whether the creator has confirmed they own their login email (by opening a link sent to it).
// Accounts made before this check existed count as confirmed.
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE users SET email_verified = 1');
}
// Confirmation links sent to creators. Only a hash of each link's token is kept.
db.exec(`
CREATE TABLE IF NOT EXISTS email_checks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_checks_user ON email_checks(user_id);
`);

module.exports = { db, DATA_DIR };
