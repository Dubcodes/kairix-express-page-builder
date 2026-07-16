import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

export const ROLES = [
  "Admin",
  "Publisher",
  "Editor",
  "File Manager",
  "Analytics Viewer",
  "Read Only"
];

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Read Only',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'Read Only',
      email TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      sku TEXT,
      version_label TEXT,
      category_id INTEGER,
      marketplace_url TEXT,
      short_description TEXT,
      long_description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      featured INTEGER NOT NULL DEFAULT 0,
      marketplace_name TEXT,
      marketplace_listing_id TEXT,
      imported_title TEXT,
      edited_title TEXT,
      imported_description TEXT,
      edited_description TEXT,
      imported_image_urls TEXT,
      import_sync_status TEXT,
      last_imported_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      file_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'gallery',
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS download_objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'Other',
      short_description TEXT,
      external_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS download_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      download_id INTEGER NOT NULL,
      version_number TEXT NOT NULL,
      release_date TEXT,
      file_id INTEGER,
      external_url TEXT,
      release_notes TEXT,
      is_latest INTEGER NOT NULL DEFAULT 0,
      deprecated INTEGER NOT NULL DEFAULT 0,
      warning_text TEXT,
      file_size TEXT,
      checksum TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (download_id) REFERENCES download_objects(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS support_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS support_pack_downloads (
      support_pack_id INTEGER NOT NULL,
      download_id INTEGER NOT NULL,
      PRIMARY KEY (support_pack_id, download_id),
      FOREIGN KEY (support_pack_id) REFERENCES support_packs(id) ON DELETE CASCADE,
      FOREIGN KEY (download_id) REFERENCES download_objects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_support_packs (
      product_id INTEGER NOT NULL,
      support_pack_id INTEGER NOT NULL,
      PRIMARY KEY (product_id, support_pack_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (support_pack_id) REFERENCES support_packs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_download_locks (
      product_id INTEGER NOT NULL,
      download_id INTEGER NOT NULL,
      version_id INTEGER,
      PRIMARY KEY (product_id, download_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (download_id) REFERENCES download_objects(id) ON DELETE CASCADE,
      FOREIGN KEY (version_id) REFERENCES download_versions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS related_products (
      product_id INTEGER NOT NULL,
      related_product_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, related_product_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (related_product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      path TEXT,
      product_id INTEGER,
      download_id INTEGER,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS publish_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      message TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  addColumn("users", "status", "TEXT NOT NULL DEFAULT 'active'");
  addColumn("users", "last_login_at", "TEXT");
  addColumn("users", "password_reset_required", "INTEGER NOT NULL DEFAULT 0");
  addColumn("users", "support_access_expires_at", "TEXT");
  addColumn("users", "disabled_at", "TEXT");
  addColumn("invites", "requires_approval", "INTEGER NOT NULL DEFAULT 0");
  addColumn("invites", "created_user_id", "INTEGER");
  addColumn("invites", "accepted_at", "TEXT");
  addColumn("invites", "status", "TEXT NOT NULL DEFAULT 'open'");
  addColumn("invites", "label", "TEXT");
  addColumn("invites", "support_access_hours", "INTEGER");
  addColumn("products", "stock_tracking", "INTEGER NOT NULL DEFAULT 0");
  addColumn("products", "stock_count", "INTEGER");
  addColumn("products", "stock_low_threshold", "INTEGER NOT NULL DEFAULT 5");
  addColumn("products", "stock_display_mode", "TEXT NOT NULL DEFAULT 'friendly'");
  addColumn("products", "stock_source", "TEXT NOT NULL DEFAULT 'manual'");
  addColumn("products", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  addColumn("products", "archived", "INTEGER NOT NULL DEFAULT 0");
  addColumn("products", "color_options", "TEXT");
  addColumn("products", "option_notes", "TEXT");
  addColumn("products", "publish_state", "TEXT NOT NULL DEFAULT 'draft'");
  addColumn("products", "product_options_json", "TEXT");
  addColumn("categories", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  addColumn("categories", "archived", "INTEGER NOT NULL DEFAULT 0");
  addColumn("download_objects", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  addColumn("download_objects", "archived", "INTEGER NOT NULL DEFAULT 0");
  addColumn("download_objects", "display_group", "TEXT");
  addColumn("download_versions", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  addColumn("files", "content_hash", "TEXT");
  addColumn("support_packs", "bundle_file_id", "INTEGER");
  addColumn("support_packs", "auto_generate_zip", "INTEGER NOT NULL DEFAULT 1");
  addColumn("support_packs", "archived", "INTEGER NOT NULL DEFAULT 0");
  addColumn("support_packs", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  db.prepare("CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_publish_events_created_at ON publish_events(created_at)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at)").run();

  db.prepare("UPDATE products SET publish_state = 'not_ready' WHERE publish_state IN ('ready', 'needs_review')").run();
  db.prepare("UPDATE products SET archived = 1, featured = 0 WHERE publish_state = 'archived'").run();
  db.prepare("UPDATE products SET publish_state = 'archived', featured = 0 WHERE archived = 1").run();
  migrateProductOptions();

  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      message TEXT,
      metadata TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS contact_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      product_id INTEGER,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS contact_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'link',
      value TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS marketplace_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      app_key TEXT,
      app_secret_encrypted TEXT,
      access_token_encrypted TEXT,
      refresh_token_encrypted TEXT,
      token_expires_at TEXT,
      auth_base_url TEXT,
      token_base_url TEXT,
      api_base_url TEXT,
      status TEXT NOT NULL DEFAULT 'setup_required',
      last_test_at TEXT,
      last_sync_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS marketplace_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      source_query TEXT,
      selected_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS marketplace_import_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      marketplace TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT,
      sku TEXT,
      image_url TEXT,
      product_url TEXT,
      price TEXT,
      stock_count INTEGER,
      raw_json TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (marketplace, external_id, batch_id),
      FOREIGN KEY (batch_id) REFERENCES marketplace_import_batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_marketplace_links (
      product_id INTEGER NOT NULL,
      marketplace TEXT NOT NULL,
      external_id TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'linked',
      last_synced_at TEXT,
      raw_json TEXT,
      PRIMARY KEY (product_id, marketplace),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS backup_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'manual',
      manifest_json TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

function addColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

function safeJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fileIdForUploadUrl(value, filesByStoredName) {
  const storedName = String(value || "").replace(/^.*\/uploads\//, "");
  return filesByStoredName.get(storedName) || null;
}

function migrateProductOptions() {
  const filesByStoredName = new Map(db.prepare("SELECT id, stored_name FROM files").all().map((file) => [file.stored_name, file.id]));
  const rows = db.prepare("SELECT id, color_options, product_options_json FROM products").all();
  const update = db.prepare("UPDATE products SET product_options_json = ? WHERE id = ?");
  for (const row of rows) {
    const structured = safeJsonArray(row.product_options_json)
      .map((option) => ({
        type: String(option.type || "Color").trim(),
        value: String(option.value || "").trim(),
        fileId: option.fileId ? Number(option.fileId) : fileIdForUploadUrl(option.image, filesByStoredName)
      }))
      .filter((option) => option.type && option.value);
    if (structured.length) {
      if (JSON.stringify(structured) !== row.product_options_json) update.run(JSON.stringify(structured), row.id);
      continue;
    }
    const legacy = String(row.color_options || "")
      .split(/[,;\n]/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => ({ type: "Color", value, fileId: null }));
    if (legacy.length) update.run(JSON.stringify(legacy), row.id);
  }
}

export function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value ?? "");
}

export function userCount() {
  return db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
}

export function cleanupExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE julianday(expires_at) <= julianday('now')").run();
}

migrate();
