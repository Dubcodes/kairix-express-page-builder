import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import cookieParser from "cookie-parser";
import slugify from "slugify";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { config } from "./config.js";
import { db, setSetting, getSettings, userCount, cleanupExpiredSessions, ROLES } from "./db.js";
import {
  authMiddleware,
  can,
  createOneTimeToken,
  createSession,
  destroySession,
  destroyUserSessions,
  hashInviteToken,
  hashPassword,
  hashResetToken,
  isValidRole,
  requireAuth,
  requirePermission,
  sessionCookieOptions,
  verifyPassword
} from "./middleware/auth.js";
import { storageProvider } from "./providers/storage.js";
import { publishSite } from "./services/publish.js";
import { encryptSecret, decryptSecret } from "./services/cryptoBox.js";
import { buildAuthUrl, exchangeCodeForToken, fetchProductList, normalizeAliExpressProduct, testConnection } from "./services/aliexpress.js";
import { createBackup, inspectBackup, listBackups } from "./services/backups.js";
import { parseCsv, toCsv } from "./services/csv.js";

const app = express();
await storageProvider.ensureReady();

if (config.trustProxy) app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(authMiddleware);
app.use(csrfProtection);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false
});

const acceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false
});

const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = slugify(path.basename(file.originalname, ext), { lower: true, strict: true }) || "file";
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${base}${ext}`);
    }
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!config.allowedUploadExtensions.has(ext) || !config.allowedUploadMimeTypes.has(file.mimetype)) {
      cb(new Error(`Unsupported file type: ${file.originalname} (${file.mimetype})`));
      return;
    }
    cb(null, true);
  }
});

function csrfToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function csrfCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge: 1000 * 60 * 60 * 12
  };
}

function getOrCreateCsrf(req, res) {
  const token = req.cookies?.kairix_csrf || csrfToken();
  if (!req.cookies?.kairix_csrf) res.cookie("kairix_csrf", token, csrfCookieOptions());
  return token;
}

function csrfProtection(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (["/api/login", "/api/setup", "/api/invites/accept", "/api/track", "/api/contact-submissions"].includes(req.path)) return next();
  if (!req.user) return next();
  const cookieToken = req.cookies?.kairix_csrf;
  const headerToken = req.get("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "CSRF token is missing or invalid" });
  }
  next();
}

function audit(req, eventType, { entityType = null, entityId = null, message = "", metadata = {} } = {}) {
  db.prepare(`
    INSERT INTO audit_events (user_id, event_type, entity_type, entity_id, message, metadata, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user?.id || null,
    eventType,
    entityType,
    entityId,
    message,
    JSON.stringify(metadata || {}),
    req.ip || "",
    req.get("user-agent") || ""
  );
}

function cleanText(value) {
  return sanitizeHtml(String(value || ""), { allowedTags: [], allowedAttributes: {} }).trim();
}

function cleanRich(value) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "a", "h2", "h3", "blockquote", "code", "pre"],
    allowedAttributes: { a: ["href", "target", "rel"] }
  });
}

function textToParagraphHtml(value) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((paragraph) => cleanText(paragraph).replace(/\n/g, "<br>"))
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("");
}

function cleanRichInput(value, mode = "plain") {
  const raw = String(value || "");
  if (mode === "html" || /<\/?[a-z][\s\S]*>/i.test(raw)) return cleanRich(raw);
  return textToParagraphHtml(raw);
}

function makeSlug(name, table, currentId = null) {
  const base = slugify(name || "item", { lower: true, strict: true }) || "item";
  let slug = base;
  let index = 2;
  while (true) {
    const row = currentId
      ? db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`).get(slug, currentId)
      : db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(slug);
    if (!row) return slug;
    slug = `${base}-${index++}`;
  }
}

function jsonSetting(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function fileRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    originalName: row.original_name,
    storedName: row.stored_name,
    path: row.path,
    url: `/uploads/${row.stored_name}`,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at
  };
}

function redirectUri() {
  return `${config.adminBaseUrl.replace(/\/$/, "")}/api/integrations/aliexpress/callback`;
}

function getMarketplaceConnection(marketplace = "aliexpress", { includeSecrets = false } = {}) {
  const row = db.prepare("SELECT * FROM marketplace_connections WHERE marketplace = ?").get(marketplace);
  const base = row || {
    marketplace,
    enabled: 0,
    app_key: "",
    app_secret_encrypted: "",
    access_token_encrypted: "",
    refresh_token_encrypted: "",
    auth_base_url: config.aliexpressAuthUrl,
    token_base_url: config.aliexpressTokenUrl,
    api_base_url: config.aliexpressApiUrl,
    status: "setup_required",
    last_test_at: null,
    last_sync_at: null,
    metadata: "{}"
  };
  const connection = {
    ...base,
    hasSecret: Boolean(base.app_secret_encrypted),
    hasToken: Boolean(base.access_token_encrypted),
    redirectUri: redirectUri()
  };
  if (includeSecrets) {
    connection.app_secret = decryptSecret(base.app_secret_encrypted);
    connection.access_token = decryptSecret(base.access_token_encrypted);
    connection.refresh_token = decryptSecret(base.refresh_token_encrypted);
  }
  delete connection.app_secret_encrypted;
  delete connection.access_token_encrypted;
  delete connection.refresh_token_encrypted;
  return connection;
}

function saveMarketplaceConnection(input) {
  const current = db.prepare("SELECT * FROM marketplace_connections WHERE marketplace = 'aliexpress'").get();
  const secret = Object.hasOwn(input, "appSecret") && input.appSecret
    ? encryptSecret(input.appSecret)
    : current?.app_secret_encrypted || "";
  const enabled = input.enabled ? 1 : 0;
  const appKey = cleanText(input.appKey);
  const authBaseUrl = cleanText(input.authBaseUrl || current?.auth_base_url || config.aliexpressAuthUrl);
  const tokenBaseUrl = cleanText(input.tokenBaseUrl || current?.token_base_url || config.aliexpressTokenUrl);
  const apiBaseUrl = cleanText(input.apiBaseUrl || current?.api_base_url || config.aliexpressApiUrl);
  const status = enabled && appKey && secret ? "credentials_saved" : "setup_required";
  db.prepare(`
    INSERT INTO marketplace_connections
      (marketplace, enabled, app_key, app_secret_encrypted, auth_base_url, token_base_url, api_base_url, status, updated_at)
    VALUES ('aliexpress', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(marketplace) DO UPDATE SET
      enabled = excluded.enabled,
      app_key = excluded.app_key,
      app_secret_encrypted = excluded.app_secret_encrypted,
      auth_base_url = excluded.auth_base_url,
      token_base_url = excluded.token_base_url,
      api_base_url = excluded.api_base_url,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `).run(enabled, appKey, secret, authBaseUrl, tokenBaseUrl, apiBaseUrl, status);
  return getMarketplaceConnection("aliexpress");
}

function contactMethodRows() {
  return db.prepare("SELECT * FROM contact_methods WHERE visible = 1 ORDER BY sort_order, id").all();
}

function csvProducts() {
  return db.prepare(`
    SELECT p.id, p.name, p.slug, p.sku, c.name AS category, p.marketplace_url, p.status, p.publish_state,
      p.stock_tracking, p.stock_count, p.stock_low_threshold, p.stock_display_mode, p.stock_source, p.short_description
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.archived = 0
    ORDER BY p.sort_order, p.name
  `).all();
}

function csvDownloads() {
  return db.prepare(`
    SELECT d.id, d.name, d.slug, d.type, d.short_description, d.external_url, COUNT(v.id) AS version_count
    FROM download_objects d
    LEFT JOIN download_versions v ON v.download_id = d.id
    WHERE d.archived = 0
    GROUP BY d.id
    ORDER BY d.sort_order, d.type, d.name
  `).all();
}

function csvBundles() {
  return db.prepare(`
    SELECT sp.id, sp.name, sp.slug, sp.description, sp.auto_generate_zip, COUNT(spd.download_id) AS download_count
    FROM support_packs sp
    LEFT JOIN support_pack_downloads spd ON spd.support_pack_id = sp.id
    WHERE sp.archived = 0
    GROUP BY sp.id
    ORDER BY sp.sort_order, sp.name
  `).all();
}

function requireSetupOpen(req, res, next) {
  if (userCount() > 0) return res.status(403).json({ error: "First-run setup has already been completed" });
  next();
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/setup/status", (_req, res) => {
  res.json({ needsSetup: userCount() === 0 });
});

app.post("/api/setup", requireSetupOpen, upload.single("logo"), asyncRoute(async (req, res) => {
  const schema = z.object({
    brandName: z.string().min(2),
    marketplaceUrl: z.string().optional(),
    username: z.string().min(3),
    email: z.string().email().optional().or(z.literal("")),
    password: z.string().min(10)
  });
  const input = schema.parse(req.body);
  const passwordHash = await hashPassword(input.password);
  db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'Admin')")
    .run(cleanText(input.username), cleanText(input.email), passwordHash);
  setSetting("brandName", cleanText(input.brandName));
  setSetting("marketplaceUrl", cleanText(input.marketplaceUrl));
  setSetting("theme", "clean-light");
  setSetting("defaultMarketplaceLabel", "Buy on AliExpress");
  if (req.file) {
    const result = db.prepare(`
      INSERT INTO files (original_name, stored_name, path, mime_type, size)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.file.originalname, req.file.filename, req.file.path, req.file.mimetype, req.file.size);
    setSetting("logo", `/uploads/${req.file.filename}`);
    setSetting("logoFileId", String(result.lastInsertRowid));
  }
  res.json({ ok: true });
}));

app.post("/api/login", loginLimiter, asyncRoute(async (req, res) => {
  const { username, password } = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  }).parse(req.body);
  const user = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(username, username);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    audit(req, "login_failure", { entityType: "user", message: `Failed login for ${cleanText(username)}` });
    return res.status(401).json({ error: "Invalid username or password" });
  }
  if (user.status === "disabled") {
    audit(req, "login_rejected", { entityType: "user", entityId: user.id, message: "Disabled user login rejected" });
    return res.status(403).json({ error: "This user is disabled" });
  }
  if (user.status === "pending") {
    audit(req, "login_rejected", { entityType: "user", entityId: user.id, message: "Pending user login rejected" });
    return res.status(403).json({ error: "This user is pending approval" });
  }
  if (user.support_access_expires_at && new Date(user.support_access_expires_at) <= new Date()) {
    db.prepare("UPDATE users SET status = 'disabled', disabled_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
    audit(req, "login_rejected", { entityType: "user", entityId: user.id, message: "Expired support access login rejected" });
    return res.status(403).json({ error: "This temporary support access has expired" });
  }
  db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
  const session = createSession(user.id);
  res.cookie("kairix_session", session.token, sessionCookieOptions());
  res.cookie("kairix_csrf", csrfToken(), csrfCookieOptions());
  req.user = { id: user.id, username: user.username, email: user.email, role: user.role, status: user.status };
  audit(req, "login_success", { entityType: "user", entityId: user.id, message: "User logged in" });
  res.json({ ok: true, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
}));

app.post("/api/logout", (req, res) => {
  audit(req, "logout", { entityType: "user", entityId: req.user?.id || null, message: "User logged out" });
  destroySession(req.cookies?.kairix_session);
  res.clearCookie("kairix_session", { path: "/" });
  res.clearCookie("kairix_csrf", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const csrf = req.user ? getOrCreateCsrf(req, res) : null;
  res.json({
    user: req.user || null,
    csrfToken: csrf,
    needsSetup: userCount() === 0,
    roles: ROLES,
    permissions: {
      write: can(req.user, "write"),
      files: can(req.user, "files"),
      publish: can(req.user, "publish"),
      analytics: can(req.user, "analytics")
    }
  });
});

app.get("/api/settings", requireAuth, (req, res) => {
  res.json(getSettings());
});

app.put("/api/settings", requirePermission("write"), upload.single("logo"), (req, res) => {
  const fields = [
    "brandName",
    "marketplaceUrl",
    "introText",
    "supportEmail",
    "supportLink",
    "contactFormEnabled",
    "theme",
    "defaultMarketplaceLabel",
    "footerText"
  ];
  for (const field of fields) {
    if (Object.hasOwn(req.body, field)) setSetting(field, field.includes("Text") ? cleanRich(req.body[field]) : cleanText(req.body[field]));
  }
  if (req.file) {
    const result = db.prepare(`
      INSERT INTO files (original_name, stored_name, path, mime_type, size)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.file.originalname, req.file.filename, req.file.path, req.file.mimetype, req.file.size);
    setSetting("logo", `/uploads/${req.file.filename}`);
    setSetting("logoFileId", String(result.lastInsertRowid));
  }
  res.json({ ok: true, settings: getSettings() });
});

app.get("/api/contact-methods", requireAuth, (_req, res) => {
  res.json({ contactMethods: contactMethodRows() });
});

app.post("/api/contact-methods", requirePermission("write"), (req, res) => {
  const body = z.object({
    label: z.string().min(1).max(80),
    type: z.enum(["email", "link", "phone", "marketplace"]).default("link"),
    value: z.string().min(1).max(500),
    sortOrder: z.number().optional()
  }).parse(req.body);
  const result = db.prepare("INSERT INTO contact_methods (label, type, value, sort_order) VALUES (?, ?, ?, ?)")
    .run(cleanText(body.label), body.type, cleanText(body.value), body.sortOrder || 0);
  audit(req, "contact_method_create", { entityType: "contact_method", entityId: result.lastInsertRowid, message: `Created contact method ${body.label}` });
  res.json({ contactMethod: db.prepare("SELECT * FROM contact_methods WHERE id = ?").get(result.lastInsertRowid) });
});

app.put("/api/contact-methods/:id", requirePermission("write"), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM contact_methods WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "Contact row not found" });
  const body = z.object({
    label: z.string().min(1).max(80),
    type: z.enum(["email", "link", "phone", "marketplace"]).default("link"),
    value: z.string().min(1).max(500),
    sortOrder: z.number().optional(),
    visible: z.boolean().optional(),
    enabled: z.boolean().optional()
  }).parse(req.body);
  const visible = body.visible ?? body.enabled ?? Boolean(current.visible);
  db.prepare(`
    UPDATE contact_methods
    SET label = ?, type = ?, value = ?, sort_order = ?, visible = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(cleanText(body.label), body.type, cleanText(body.value), body.sortOrder ?? 0, visible ? 1 : 0, id);
  audit(req, "contact_method_update", { entityType: "contact_method", entityId: id, message: `Updated contact method ${body.label}` });
  res.json({ contactMethod: db.prepare("SELECT * FROM contact_methods WHERE id = ?").get(id) });
});

app.delete("/api/contact-methods/:id", requirePermission("write"), (req, res) => {
  db.prepare("UPDATE contact_methods SET visible = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  audit(req, "contact_method_hide", { entityType: "contact_method", entityId: Number(req.params.id), message: "Contact method hidden" });
  res.json({ ok: true });
});

app.get("/api/import-export/csv/:type", requirePermission("read"), (req, res) => {
  const rows = {
    products: csvProducts,
    downloads: csvDownloads,
    bundles: csvBundles
  }[req.params.type]?.();
  if (!rows) return res.status(404).json({ error: "Unknown CSV export type" });
  res.type("text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="kairix-${req.params.type}.csv"`);
  res.send(toCsv(rows));
});

app.post("/api/import-export/csv/preview", requirePermission("write"), (req, res) => {
  const body = z.object({ csvText: z.string().min(1).max(1024 * 1024) }).parse(req.body);
  const rows = parseCsv(body.csvText);
  res.json({
    rows: rows.slice(0, 100),
    totalRows: rows.length,
    validRows: rows.filter((row) => row.valid).length
  });
});

app.get("/api/backups", requirePermission("write"), (_req, res) => {
  res.json({ backups: listBackups() });
});

app.post("/api/backups", requirePermission("write"), asyncRoute(async (req, res) => {
  const backup = await createBackup({ kind: "manual", createdBy: req.user.id });
  audit(req, "backup_create", { entityType: "backup", message: `Created backup ${backup.filename}`, metadata: { size: backup.size } });
  res.json({ backup: { filename: backup.filename, size: backup.size, manifest: backup.manifest } });
}));

app.get("/api/backups/:filename/inspect", requirePermission("write"), asyncRoute(async (req, res) => {
  res.json({ backup: await inspectBackup(req.params.filename) });
}));

app.get("/api/backups/:filename/download", requirePermission("write"), (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(config.backupsDir, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Backup not found" });
  res.download(filepath, filename);
});

app.get("/api/integrations/aliexpress/status", requireAuth, (_req, res) => {
  res.json({ connection: getMarketplaceConnection("aliexpress") });
});

app.put("/api/integrations/aliexpress/settings", requirePermission("write"), (req, res) => {
  const body = z.object({
    enabled: z.boolean().optional(),
    appKey: z.string().optional(),
    appSecret: z.string().optional(),
    authBaseUrl: z.string().optional(),
    tokenBaseUrl: z.string().optional(),
    apiBaseUrl: z.string().optional()
  }).parse(req.body);
  const connection = saveMarketplaceConnection(body);
  audit(req, "aliexpress_settings_save", { entityType: "marketplace_connection", message: "AliExpress settings saved" });
  res.json({ connection });
});

app.post("/api/integrations/aliexpress/connect", requirePermission("write"), (req, res) => {
  try {
    const token = createOneTimeToken();
    const connection = getMarketplaceConnection("aliexpress", { includeSecrets: true });
    const authUrl = buildAuthUrl(connection, token.raw);
    db.prepare("UPDATE marketplace_connections SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE marketplace = 'aliexpress'")
      .run(JSON.stringify({ oauthStateHash: token.hash, startedAt: new Date().toISOString() }));
    res.json({ authUrl, redirectUri: redirectUri() });
  } catch (error) {
    res.status(error.code === "setup_required" ? 400 : 500).json({ error: error.message, code: error.code || "aliexpress_connect_failed" });
  }
});

app.get("/api/integrations/aliexpress/callback", asyncRoute(async (req, res) => {
  const code = cleanText(req.query.code);
  const state = cleanText(req.query.state);
  const row = db.prepare("SELECT * FROM marketplace_connections WHERE marketplace = 'aliexpress'").get();
  const metadata = row?.metadata ? JSON.parse(row.metadata) : {};
  if (!row || !metadata.oauthStateHash || hashInviteToken(state) !== metadata.oauthStateHash) return res.status(400).send("Invalid AliExpress callback state");
  const tokens = await exchangeCodeForToken(getMarketplaceConnection("aliexpress", { includeSecrets: true }), code);
  db.prepare(`
    UPDATE marketplace_connections SET
      access_token_encrypted = ?, refresh_token_encrypted = ?, token_expires_at = ?, status = 'connected', updated_at = CURRENT_TIMESTAMP
    WHERE marketplace = 'aliexpress'
  `).run(
    encryptSecret(tokens.access_token || tokens.accessToken || ""),
    encryptSecret(tokens.refresh_token || tokens.refreshToken || ""),
    tokens.expires_at || tokens.expiresAt || null
  );
  res.redirect("/#settings/integrations");
}));

app.post("/api/integrations/aliexpress/disconnect", requirePermission("write"), (req, res) => {
  db.prepare(`
    UPDATE marketplace_connections SET access_token_encrypted = '', refresh_token_encrypted = '', token_expires_at = NULL,
      status = 'disconnected', last_test_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE marketplace = 'aliexpress'
  `).run();
  audit(req, "aliexpress_disconnect", { entityType: "marketplace_connection", message: "AliExpress disconnected" });
  res.json({ connection: getMarketplaceConnection("aliexpress") });
});

app.post("/api/integrations/aliexpress/test", requirePermission("write"), asyncRoute(async (_req, res) => {
  try {
    await testConnection(getMarketplaceConnection("aliexpress", { includeSecrets: true }));
    db.prepare("UPDATE marketplace_connections SET status = 'connected', last_test_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE marketplace = 'aliexpress'").run();
    res.json({ ok: true, connection: getMarketplaceConnection("aliexpress") });
  } catch (error) {
    db.prepare("UPDATE marketplace_connections SET status = ?, last_test_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE marketplace = 'aliexpress'")
      .run(error.code === "setup_required" ? "setup_required" : "error");
    res.status(error.code === "setup_required" ? 400 : 502).json({ error: error.message, code: error.code || "aliexpress_test_failed" });
  }
}));

app.post("/api/integrations/aliexpress/fetch-products", requirePermission("write"), asyncRoute(async (req, res) => {
  try {
    const result = await fetchProductList(getMarketplaceConnection("aliexpress", { includeSecrets: true }), req.body || {});
    const rawItems = result.products || result.items || result.result?.products || result.result?.items || [];
    const candidates = rawItems.map(normalizeAliExpressProduct).filter((item) => item.externalId);
    const batchId = db.prepare("INSERT INTO marketplace_import_batches (marketplace, status, source_query, selected_count, created_by) VALUES ('aliexpress', 'fetched', ?, ?, ?)")
      .run(JSON.stringify(req.body || {}), candidates.length, req.user.id).lastInsertRowid;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO marketplace_import_candidates
      (batch_id, marketplace, external_id, title, sku, image_url, product_url, price, stock_count, raw_json)
      VALUES (?, 'aliexpress', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    candidates.forEach((item) => insert.run(batchId, item.externalId, item.title, item.sku, item.imageUrl, item.productUrl, String(item.price || ""), item.stockCount, JSON.stringify(item.raw)));
    res.json({ batchId, candidates });
  } catch (error) {
    res.status(error.code === "setup_required" ? 400 : 502).json({ error: error.message, code: error.code || "aliexpress_fetch_failed" });
  }
}));

app.get("/api/integrations/aliexpress/import-candidates", requirePermission("write"), (_req, res) => {
  const candidates = db.prepare("SELECT * FROM marketplace_import_candidates WHERE marketplace = 'aliexpress' ORDER BY created_at DESC LIMIT 100").all();
  res.json({ candidates });
});

app.post("/api/integrations/aliexpress/import", requirePermission("write"), (req, res) => {
  const body = z.object({ candidateIds: z.array(z.number()).min(1) }).parse(req.body);
  const tx = db.transaction(() => {
    const imported = [];
    for (const candidateId of body.candidateIds) {
      const candidate = db.prepare("SELECT * FROM marketplace_import_candidates WHERE id = ? AND marketplace = 'aliexpress'").get(candidateId);
      if (!candidate) continue;
      const existingLink = db.prepare("SELECT product_id FROM product_marketplace_links WHERE marketplace = 'aliexpress' AND external_id = ?").get(candidate.external_id);
      if (existingLink) {
        db.prepare("UPDATE marketplace_import_candidates SET status = 'linked', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(candidate.id);
        continue;
      }
      const name = cleanText(candidate.title || `AliExpress product ${candidate.external_id}`);
      const slug = makeSlug(name, "products");
      const productId = db.prepare(`
        INSERT INTO products
        (name, slug, sku, marketplace_url, short_description, status, publish_state, stock_tracking, stock_count, stock_source,
          marketplace_name, marketplace_listing_id, imported_title, imported_image_urls, import_sync_status, last_imported_at)
        VALUES (?, ?, ?, ?, ?, 'draft', 'draft', ?, ?, 'marketplace', 'AliExpress', ?, ?, ?, 'imported', CURRENT_TIMESTAMP)
      `).run(
        name,
        slug,
        cleanText(candidate.sku),
        cleanText(candidate.product_url),
        cleanText(candidate.title),
        candidate.stock_count === null || candidate.stock_count === undefined ? 0 : 1,
        candidate.stock_count,
        cleanText(candidate.external_id),
        name,
        candidate.image_url ? JSON.stringify([candidate.image_url]) : "[]"
      ).lastInsertRowid;
      db.prepare(`
        INSERT INTO product_marketplace_links (product_id, marketplace, external_id, sync_status, last_synced_at, raw_json)
        VALUES (?, 'aliexpress', ?, 'imported', CURRENT_TIMESTAMP, ?)
      `).run(productId, candidate.external_id, candidate.raw_json || "{}");
      db.prepare("UPDATE marketplace_import_candidates SET status = 'imported', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(candidate.id);
      imported.push(productId);
    }
    return imported;
  });
  const imported = tx();
  audit(req, "aliexpress_import", { entityType: "marketplace_import", message: `Imported ${imported.length} AliExpress candidate(s)`, metadata: { productIds: imported } });
  res.json({ importedProductIds: imported });
});

app.post("/api/integrations/aliexpress/detach-product/:id", requirePermission("write"), (req, res) => {
  db.prepare("DELETE FROM product_marketplace_links WHERE product_id = ? AND marketplace = 'aliexpress'").run(req.params.id);
  db.prepare("UPDATE products SET import_sync_status = NULL, last_imported_at = NULL, stock_source = 'manual' WHERE id = ?").run(req.params.id);
  audit(req, "aliexpress_product_detach", { entityType: "product", entityId: Number(req.params.id), message: "Detached AliExpress link" });
  res.json({ ok: true });
});

app.post("/api/files/upload", requirePermission("files"), upload.array("files", 12), (req, res) => {
  const records = (req.files || []).map((file) => {
    const result = db.prepare(`
      INSERT INTO files (original_name, stored_name, path, mime_type, size)
      VALUES (?, ?, ?, ?, ?)
    `).run(file.originalname, file.filename, file.path, file.mimetype, file.size);
    return fileRecord(db.prepare("SELECT * FROM files WHERE id = ?").get(result.lastInsertRowid));
  });
  res.json({ files: records });
});

app.get("/api/files", requireAuth, (_req, res) => {
  const files = db.prepare("SELECT * FROM files ORDER BY created_at DESC").all().map(fileRecord);
  res.json({ files });
});

app.get("/api/categories", requireAuth, (_req, res) => {
  res.json({ categories: db.prepare("SELECT * FROM categories ORDER BY name").all() });
});

app.post("/api/categories", requirePermission("write"), (req, res) => {
  const { name, description = "" } = z.object({
    name: z.string().min(2),
    description: z.string().optional()
  }).parse(req.body);
  const slug = makeSlug(name, "categories");
  const result = db.prepare("INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)")
    .run(cleanText(name), slug, cleanText(description));
  res.json({ category: db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid) });
});

app.get("/api/products", requireAuth, (_req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.archived = 0
    ORDER BY p.featured DESC, p.sort_order, p.name
  `).all();
  res.json({ products });
});

app.get("/api/products/:id", requireAuth, (req, res) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const images = db.prepare(`
    SELECT pi.*, f.original_name, f.stored_name
    FROM product_images pi JOIN files f ON f.id = pi.file_id
    WHERE pi.product_id = ? ORDER BY pi.kind, pi.sort_order
  `).all(product.id);
  const supportPackIds = db.prepare("SELECT support_pack_id FROM product_support_packs WHERE product_id = ?").all(product.id).map((row) => row.support_pack_id);
  const relatedProductIds = db.prepare("SELECT related_product_id FROM related_products WHERE product_id = ? ORDER BY sort_order").all(product.id).map((row) => row.related_product_id);
  res.json({ product, images, supportPackIds, relatedProductIds });
});

app.post("/api/products", requirePermission("write"), (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    sku: z.string().optional(),
    versionLabel: z.string().optional(),
    categoryId: z.number().nullable().optional(),
    marketplaceUrl: z.string().optional(),
    shortDescription: z.string().optional(),
    longDescription: z.string().optional(),
    longDescriptionMode: z.enum(["plain", "html"]).optional(),
    status: z.enum(["draft", "published"]).default("draft"),
    publishState: z.enum(["draft", "ready", "published", "needs_review", "archived"]).optional(),
    featured: z.boolean().optional(),
    stockTracking: z.boolean().optional(),
    stockCount: z.number().nullable().optional(),
    stockLowThreshold: z.number().optional(),
    stockDisplayMode: z.enum(["hidden", "friendly", "exact"]).optional(),
    stockSource: z.enum(["manual", "marketplace", "unknown"]).optional(),
    sortOrder: z.number().optional(),
    colorOptions: z.string().optional(),
    optionNotes: z.string().optional(),
    galleryFileIds: z.array(z.number()).optional(),
    descriptionFileIds: z.array(z.number()).optional(),
    setupFileIds: z.array(z.number()).optional(),
    supportPackIds: z.array(z.number()).optional(),
    relatedProductIds: z.array(z.number()).optional()
  }).parse(req.body);
  const slug = makeSlug(body.name, "products");
  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO products
      (name, slug, sku, version_label, category_id, marketplace_url, short_description, long_description, status, featured,
       publish_state, stock_tracking, stock_count, stock_low_threshold, stock_display_mode, stock_source, sort_order, color_options, option_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanText(body.name),
      slug,
      cleanText(body.sku),
      cleanText(body.versionLabel),
      body.categoryId || null,
      cleanText(body.marketplaceUrl),
      cleanText(body.shortDescription),
      cleanRichInput(body.longDescription, body.longDescriptionMode),
      body.status,
      body.featured ? 1 : 0,
      body.publishState || body.status,
      body.stockTracking ? 1 : 0,
      body.stockCount ?? null,
      body.stockLowThreshold ?? 5,
      body.stockDisplayMode || "friendly",
      body.stockSource || "manual",
      body.sortOrder || 0,
      cleanText(body.colorOptions),
      cleanText(body.optionNotes)
    );
    saveProductRelations(result.lastInsertRowid, body);
    return result.lastInsertRowid;
  });
  const id = tx();
  audit(req, "product_create", { entityType: "product", entityId: id, message: `Created product ${body.name}` });
  res.json({ product: db.prepare("SELECT * FROM products WHERE id = ?").get(id) });
});

app.post("/api/products/:id/duplicate", requirePermission("write"), (req, res) => {
  const current = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Product not found" });
  const tx = db.transaction(() => {
    const name = `${current.name} Copy`;
    const slug = makeSlug(name, "products");
    const result = db.prepare(`
      INSERT INTO products
      (name, slug, sku, version_label, category_id, marketplace_url, short_description, long_description, status, featured,
       publish_state, stock_tracking, stock_count, stock_low_threshold, stock_display_mode, stock_source, sort_order, color_options, option_notes)
      SELECT ?, ?, sku, version_label, category_id, marketplace_url, short_description, long_description, 'draft', 0,
       'draft', stock_tracking, stock_count, stock_low_threshold, stock_display_mode, stock_source, sort_order + 1, color_options, option_notes
      FROM products WHERE id = ?
    `).run(name, slug, current.id);
    const newId = result.lastInsertRowid;
    db.prepare("INSERT INTO product_images (product_id, file_id, kind, sort_order) SELECT ?, file_id, kind, sort_order FROM product_images WHERE product_id = ?").run(newId, current.id);
    db.prepare("INSERT INTO product_support_packs (product_id, support_pack_id) SELECT ?, support_pack_id FROM product_support_packs WHERE product_id = ?").run(newId, current.id);
    db.prepare("INSERT INTO related_products (product_id, related_product_id, sort_order) SELECT ?, related_product_id, sort_order FROM related_products WHERE product_id = ?").run(newId, current.id);
    return newId;
  });
  const id = tx();
  audit(req, "product_duplicate", { entityType: "product", entityId: id, message: `Duplicated product ${current.name}` });
  res.json({ product: db.prepare("SELECT * FROM products WHERE id = ?").get(id) });
});

app.put("/api/products/:id", requirePermission("write"), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "Product not found" });
  const body = req.body;
  const name = cleanText(body.name || current.name);
  const slug = name === current.name ? current.slug : makeSlug(name, "products", id);
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE products SET
        name = ?, slug = ?, sku = ?, version_label = ?, category_id = ?, marketplace_url = ?,
        short_description = ?, long_description = ?, status = ?, featured = ?, publish_state = ?,
        stock_tracking = ?, stock_count = ?, stock_low_threshold = ?, stock_display_mode = ?, stock_source = ?,
        sort_order = ?, color_options = ?, option_notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name,
      slug,
      cleanText(body.sku),
      cleanText(body.versionLabel),
      body.categoryId || null,
      cleanText(body.marketplaceUrl),
      cleanText(body.shortDescription),
      cleanRichInput(body.longDescription, body.longDescriptionMode),
      body.status === "published" ? "published" : "draft",
      body.featured ? 1 : 0,
      body.publishState || body.status || "draft",
      body.stockTracking ? 1 : 0,
      body.stockCount ?? null,
      body.stockLowThreshold ?? 5,
      ["hidden", "friendly", "exact"].includes(body.stockDisplayMode) ? body.stockDisplayMode : "friendly",
      ["manual", "marketplace", "unknown"].includes(body.stockSource) ? body.stockSource : "manual",
      Number(body.sortOrder || 0),
      cleanText(body.colorOptions),
      cleanText(body.optionNotes),
      id
    );
    saveProductRelations(id, body);
  });
  tx();
  audit(req, "product_update", { entityType: "product", entityId: id, message: `Updated product ${name}` });
  res.json({ product: db.prepare("SELECT * FROM products WHERE id = ?").get(id) });
});

function saveProductRelations(productId, body) {
  db.prepare("DELETE FROM product_images WHERE product_id = ?").run(productId);
  const insertImage = db.prepare("INSERT INTO product_images (product_id, file_id, kind, sort_order) VALUES (?, ?, ?, ?)");
  for (const [kind, key] of [["gallery", "galleryFileIds"], ["description", "descriptionFileIds"], ["setup", "setupFileIds"]]) {
    (body[key] || []).forEach((fileId, index) => insertImage.run(productId, fileId, kind, index));
  }
  db.prepare("DELETE FROM product_support_packs WHERE product_id = ?").run(productId);
  const insertPack = db.prepare("INSERT OR IGNORE INTO product_support_packs (product_id, support_pack_id) VALUES (?, ?)");
  (body.supportPackIds || []).forEach((packId) => insertPack.run(productId, packId));
  db.prepare("DELETE FROM related_products WHERE product_id = ?").run(productId);
  const insertRelated = db.prepare("INSERT OR IGNORE INTO related_products (product_id, related_product_id, sort_order) VALUES (?, ?, ?)");
  (body.relatedProductIds || []).forEach((relatedId, index) => {
    if (Number(relatedId) !== Number(productId)) insertRelated.run(productId, relatedId, index);
  });
}

app.get("/api/downloads", requireAuth, (_req, res) => {
  const downloads = db.prepare("SELECT * FROM download_objects ORDER BY type, name").all().map((download) => ({
    ...download,
    versions: db.prepare("SELECT * FROM download_versions WHERE download_id = ? ORDER BY is_latest DESC, release_date DESC, id DESC").all(download.id)
  }));
  res.json({ downloads });
});

app.post("/api/downloads", requirePermission("write"), (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    type: z.enum(["Android", "iOS", "Windows", "Mac", "Firmware", "Manual", "Other"]),
    shortDescription: z.string().optional(),
    externalUrl: z.string().optional()
  }).parse(req.body);
  const slug = makeSlug(body.name, "download_objects");
  const result = db.prepare("INSERT INTO download_objects (name, slug, type, short_description, external_url) VALUES (?, ?, ?, ?, ?)")
    .run(cleanText(body.name), slug, body.type, cleanText(body.shortDescription), cleanText(body.externalUrl));
  res.json({ download: db.prepare("SELECT * FROM download_objects WHERE id = ?").get(result.lastInsertRowid) });
});

app.put("/api/downloads/:id", requirePermission("write"), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM download_objects WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "Download object not found" });
  const body = z.object({
    name: z.string().min(2),
    type: z.enum(["Android", "iOS", "Windows", "Mac", "Firmware", "Manual", "Other"]),
    shortDescription: z.string().optional(),
    externalUrl: z.string().optional(),
    displayGroup: z.string().optional(),
    sortOrder: z.number().optional()
  }).parse(req.body);
  const slug = body.name === current.name ? current.slug : makeSlug(body.name, "download_objects", id);
  db.prepare(`
    UPDATE download_objects SET
      name = ?, slug = ?, type = ?, short_description = ?, external_url = ?, display_group = ?,
      sort_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    cleanText(body.name),
    slug,
    body.type,
    cleanText(body.shortDescription),
    cleanText(body.externalUrl),
    cleanText(body.displayGroup),
    Number(body.sortOrder || 0),
    id
  );
  res.json({ download: db.prepare("SELECT * FROM download_objects WHERE id = ?").get(id) });
});

app.post("/api/downloads/:id/archive", requirePermission("write"), (req, res) => {
  db.prepare("UPDATE download_objects SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/downloads/:id/versions", requirePermission("files"), (req, res) => {
  const body = z.object({
    versionNumber: z.string().min(1),
    releaseDate: z.string().optional(),
    fileId: z.number().nullable().optional(),
    externalUrl: z.string().optional(),
    releaseNotes: z.string().optional(),
    releaseNotesMode: z.enum(["plain", "html"]).optional(),
    isLatest: z.boolean().optional(),
    deprecated: z.boolean().optional(),
    warningText: z.string().optional(),
    fileSize: z.string().optional(),
    checksum: z.string().optional()
  }).parse(req.body);
  const download = db.prepare("SELECT * FROM download_objects WHERE id = ?").get(req.params.id);
  if (!download) return res.status(404).json({ error: "Download object not found" });
  const tx = db.transaction(() => {
    if (body.isLatest) db.prepare("UPDATE download_versions SET is_latest = 0 WHERE download_id = ?").run(download.id);
    const result = db.prepare(`
      INSERT INTO download_versions
      (download_id, version_number, release_date, file_id, external_url, release_notes, is_latest, deprecated, warning_text, file_size, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      download.id,
      cleanText(body.versionNumber),
      cleanText(body.releaseDate),
      body.fileId || null,
      cleanText(body.externalUrl),
      cleanRichInput(body.releaseNotes, body.releaseNotesMode),
      body.isLatest ? 1 : 0,
      body.deprecated ? 1 : 0,
      cleanText(body.warningText),
      cleanText(body.fileSize),
      cleanText(body.checksum)
    );
    return result.lastInsertRowid;
  });
  const id = tx();
  res.json({ version: db.prepare("SELECT * FROM download_versions WHERE id = ?").get(id) });
});

function listSoftwareBundles() {
  return db.prepare("SELECT * FROM support_packs WHERE archived = 0 ORDER BY sort_order, name").all().map((pack) => ({
    ...pack,
    downloadIds: db.prepare("SELECT download_id FROM support_pack_downloads WHERE support_pack_id = ?").all(pack.id).map((row) => row.download_id)
  }));
}

app.get("/api/software-bundles", requireAuth, (_req, res) => {
  res.json({ bundles: listSoftwareBundles(), packs: listSoftwareBundles() });
});

app.get("/api/support-packs", requireAuth, (_req, res) => {
  res.json({ packs: listSoftwareBundles() });
});

function createSoftwareBundle(req, res) {
  const body = z.object({
    name: z.string().min(2),
    description: z.string().optional(),
    downloadIds: z.array(z.number()).optional(),
    autoGenerateZip: z.boolean().optional(),
    sortOrder: z.number().optional()
  }).parse(req.body);
  const slug = makeSlug(body.name, "support_packs");
  const tx = db.transaction(() => {
    const result = db.prepare("INSERT INTO support_packs (name, slug, description, auto_generate_zip, sort_order) VALUES (?, ?, ?, ?, ?)")
      .run(cleanText(body.name), slug, cleanText(body.description), body.autoGenerateZip === false ? 0 : 1, body.sortOrder || 0);
    const insert = db.prepare("INSERT OR IGNORE INTO support_pack_downloads (support_pack_id, download_id) VALUES (?, ?)");
    (body.downloadIds || []).forEach((downloadId) => insert.run(result.lastInsertRowid, downloadId));
    return result.lastInsertRowid;
  });
  const id = tx();
  audit(req, "software_bundle_create", { entityType: "software_bundle", entityId: id, message: `Created Software Bundle ${body.name}` });
  res.json({ pack: db.prepare("SELECT * FROM support_packs WHERE id = ?").get(id) });
}

app.post("/api/software-bundles", requirePermission("write"), createSoftwareBundle);
app.post("/api/support-packs", requirePermission("write"), createSoftwareBundle);

app.post("/api/invites", requirePermission("write"), (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Only Admin can create invite links" });
  const body = z.object({
    role: z.string().optional(),
    email: z.string().optional(),
    expiresHours: z.number().optional(),
    requiresApproval: z.boolean().optional(),
    label: z.string().optional()
  }).parse(req.body);
  const role = isValidRole(body.role) ? body.role : "Read Only";
  const token = createOneTimeToken();
  const expires = new Date(Date.now() + (body.expiresHours || 48) * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO invites (token_hash, role, email, expires_at, created_by, requires_approval, label) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(token.hash, role, cleanText(body.email), expires, req.user.id, body.requiresApproval ? 1 : 0, cleanText(body.label));
  audit(req, "invite_created", { entityType: "invite", message: `Invite created for ${role}` });
  res.json({ inviteUrl: `${config.adminBaseUrl.replace(/\/$/, "")}/invite.html?token=${token.raw}`, role, expiresAt: expires });
});

app.get("/api/invites", requirePermission("write"), (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Only Admin can view invites" });
  const invites = db.prepare(`
    SELECT i.id, i.role, i.email, i.expires_at, i.used_at, i.created_at, i.requires_approval,
      i.created_user_id, i.accepted_at, i.status, i.label, i.support_access_hours,
      creator.username AS created_by_username,
      accepted.username AS accepted_username
    FROM invites i
    LEFT JOIN users creator ON creator.id = i.created_by
    LEFT JOIN users accepted ON accepted.id = i.created_user_id
    ORDER BY i.created_at DESC
    LIMIT 100
  `).all();
  res.json({ invites });
});

app.post("/api/support-access", requirePermission("write"), (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Only Admin can create support access" });
  const body = z.object({
    role: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    expiresHours: z.number().optional(),
    accessHours: z.number().optional(),
    requiresApproval: z.boolean().optional(),
    label: z.string().optional()
  }).parse(req.body);
  const role = isValidRole(body.role) ? body.role : "Admin";
  const token = createOneTimeToken();
  const expires = new Date(Date.now() + (body.expiresHours || 24) * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO invites (token_hash, role, email, expires_at, created_by, requires_approval, label, support_access_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(token.hash, role, cleanText(body.email), expires, req.user.id, body.requiresApproval ? 1 : 0, cleanText(body.label || "Temporary support access"), body.accessHours || 24);
  audit(req, "support_access_created", { entityType: "invite", message: `Temporary support access created for ${role}` });
  res.json({ inviteUrl: `${config.adminBaseUrl.replace(/\/$/, "")}/invite.html?token=${token.raw}`, role, expiresAt: expires, supportAccessHours: body.accessHours || 24 });
});

app.post("/api/invites/accept", acceptLimiter, asyncRoute(async (req, res) => {
  const body = z.object({
    token: z.string().min(20),
    username: z.string().min(3),
    email: z.string().email().optional().or(z.literal("")),
    password: z.string().min(10)
  }).parse(req.body);
  const invite = db.prepare("SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')")
    .get(hashInviteToken(body.token));
  if (!invite) return res.status(400).json({ error: "Invite link is invalid or expired" });
  const passwordHash = await hashPassword(body.password);
  const tx = db.transaction(() => {
    const supportExpiry = invite.support_access_hours ? new Date(Date.now() + invite.support_access_hours * 60 * 60 * 1000).toISOString() : null;
    const status = invite.requires_approval ? "pending" : "active";
    const result = db.prepare("INSERT INTO users (username, email, password_hash, role, status, support_access_expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(cleanText(body.username), cleanText(body.email), passwordHash, invite.role, status, supportExpiry);
    db.prepare("UPDATE invites SET used_at = CURRENT_TIMESTAMP, accepted_at = CURRENT_TIMESTAMP, status = 'used', created_user_id = ? WHERE id = ?").run(result.lastInsertRowid, invite.id);
    return result.lastInsertRowid;
  });
  const userId = tx();
  audit(req, "invite_accepted", { entityType: "user", entityId: userId, message: "Invite accepted" });
  res.json({ ok: true, status: invite.requires_approval ? "pending" : "active" });
}));

app.get("/api/users", requirePermission("write"), (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Only Admin can view users" });
  const users = db.prepare("SELECT id, username, email, role, status, last_login_at, support_access_expires_at, disabled_at, created_at FROM users ORDER BY created_at DESC").all();
  res.json({ users });
});

app.post("/api/users", requirePermission("write"), asyncRoute(async (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Only Admin can create users" });
  const body = z.object({
    username: z.string().min(3),
    email: z.string().email().optional().or(z.literal("")),
    password: z.string().min(10),
    role: z.string().optional(),
    active: z.boolean().optional()
  }).parse(req.body);
  const role = isValidRole(body.role) ? body.role : "Read Only";
  const passwordHash = await hashPassword(body.password);
  const result = db.prepare("INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)")
    .run(cleanText(body.username), cleanText(body.email), passwordHash, role, body.active === false ? "pending" : "active");
  audit(req, "user_created", { entityType: "user", entityId: result.lastInsertRowid, message: `User ${body.username} created` });
  res.json({ user: db.prepare("SELECT id, username, email, role, status FROM users WHERE id = ?").get(result.lastInsertRowid) });
}));

app.post("/api/users/:id/approve", requirePermission("write"), (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Only Admin can approve users" });
  db.prepare("UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  audit(req, "user_approved", { entityType: "user", entityId: Number(req.params.id), message: "User approved" });
  res.json({ ok: true });
});

app.post("/api/users/:id/disable", requirePermission("write"), (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Only Admin can disable users" });
  db.prepare("UPDATE users SET status = 'disabled', disabled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  destroyUserSessions(req.params.id);
  audit(req, "user_disabled", { entityType: "user", entityId: Number(req.params.id), message: "User disabled and sessions revoked" });
  res.json({ ok: true });
});

app.post("/api/users/:id/password-reset", requirePermission("write"), (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Only Admin can generate reset links" });
  const token = createOneTimeToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)")
    .run(hashResetToken(token.raw), req.params.id, expires, req.user.id);
  audit(req, "password_reset_generated", { entityType: "user", entityId: Number(req.params.id), message: "Password reset link generated" });
  res.json({ resetUrl: `${config.adminBaseUrl.replace(/\/$/, "")}/reset.html?token=${token.raw}`, expiresAt: expires });
});

app.post("/api/password-reset/complete", acceptLimiter, asyncRoute(async (req, res) => {
  const body = z.object({ token: z.string().min(20), password: z.string().min(10) }).parse(req.body);
  const reset = db.prepare("SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')")
    .get(hashResetToken(body.token));
  if (!reset) return res.status(400).json({ error: "Reset link is invalid or expired" });
  const passwordHash = await hashPassword(body.password);
  db.prepare("UPDATE users SET password_hash = ?, password_reset_required = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(passwordHash, reset.user_id);
  db.prepare("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(reset.id);
  destroyUserSessions(reset.user_id);
  audit(req, "password_reset_completed", { entityType: "user", entityId: reset.user_id, message: "Password reset completed" });
  res.json({ ok: true });
}));

app.get("/api/analytics", requirePermission("analytics"), (req, res) => {
  const range = ["7d", "30d", "all"].includes(String(req.query.range || "")) ? req.query.range : "7d";
  const modifier = range === "7d" ? "-7 days" : range === "30d" ? "-30 days" : null;
  const where = modifier ? "WHERE ae.created_at >= datetime('now', ?)" : "";
  const tableWhere = modifier ? "WHERE created_at >= datetime('now', ?)" : "";
  const args = modifier ? [modifier] : [];
  const totals = db.prepare(`SELECT COALESCE(event_type, 'unknown') AS event_type, COUNT(*) AS count FROM analytics_events ${tableWhere} GROUP BY event_type`).all(...args);
  const topPages = db.prepare(`SELECT COALESCE(NULLIF(path, ''), 'Unknown') AS path, COUNT(*) AS count FROM analytics_events ${tableWhere} GROUP BY COALESCE(NULLIF(path, ''), 'Unknown') ORDER BY count DESC LIMIT 10`).all(...args);
  const topProducts = db.prepare(`
    SELECT COALESCE(p.name, 'Deleted product #' || ae.product_id) AS name, COUNT(*) AS count
    FROM analytics_events ae
    LEFT JOIN products p ON p.id = ae.product_id
    ${where} ${where ? "AND" : "WHERE"} ae.product_id IS NOT NULL
    GROUP BY ae.product_id
    ORDER BY count DESC LIMIT 10
  `).all(...args);
  const topDownloads = db.prepare(`
    SELECT COALESCE(d.name, 'Deleted download #' || ae.download_id) AS name, COUNT(*) AS count
    FROM analytics_events ae
    LEFT JOIN download_objects d ON d.id = ae.download_id
    ${where} ${where ? "AND" : "WHERE"} ae.download_id IS NOT NULL
    GROUP BY ae.download_id
    ORDER BY count DESC LIMIT 10
  `).all(...args);
  const marketplaceClicks = db.prepare(`
    SELECT COALESCE(p.name, 'Unknown product') AS name, COUNT(*) AS count
    FROM analytics_events ae
    LEFT JOIN products p ON p.id = ae.product_id
    ${where} ${where ? "AND" : "WHERE"} ae.event_type = 'marketplace_click'
    GROUP BY COALESCE(ae.product_id, ae.path, 'unknown')
    ORDER BY count DESC LIMIT 10
  `).all(...args);
  const recent = db.prepare(`SELECT * FROM analytics_events ${tableWhere} ORDER BY created_at DESC LIMIT 50`).all(...args).map((event) => {
    let metadata = {};
    try {
      metadata = event.metadata ? JSON.parse(event.metadata) : {};
    } catch {
      metadata = {};
    }
    return { ...event, metadata };
  });
  res.json({ range, totals, topPages, topProducts, topDownloads, marketplaceClicks, recent });
});

app.post("/api/track", (req, res) => {
  const body = z.object({
    eventType: z.enum(["page_view", "product_view", "download_click", "marketplace_click", "qr_opened", "version_history_viewed", "software_bundle_download", "contact_form_submission"]),
    path: z.string().optional(),
    productId: z.number().optional(),
    downloadId: z.number().optional(),
    metadata: z.record(z.any()).optional()
  }).parse(req.body);
  db.prepare("INSERT INTO analytics_events (event_type, path, product_id, download_id, metadata) VALUES (?, ?, ?, ?, ?)")
    .run(body.eventType, cleanText(body.path), body.productId || null, body.downloadId || null, JSON.stringify(body.metadata || {}));
  res.json({ ok: true });
});

app.post("/api/contact-submissions", publicWriteLimiter, (req, res) => {
  const body = z.object({
    name: z.string().min(1).max(120),
    email: z.string().email().max(200),
    productId: z.number().nullable().optional(),
    message: z.string().min(1).max(4000),
    metadata: z.record(z.any()).optional()
  }).parse(req.body);
  const result = db.prepare(`
    INSERT INTO contact_submissions (name, email, product_id, message, metadata, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cleanText(body.name), cleanText(body.email), body.productId || null, cleanText(body.message), JSON.stringify(body.metadata || {}), req.ip || "");
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.get("/api/contact-submissions", requirePermission("read"), (_req, res) => {
  const submissions = db.prepare(`
    SELECT cs.*, p.name AS product_name
    FROM contact_submissions cs
    LEFT JOIN products p ON p.id = cs.product_id
    ORDER BY cs.created_at DESC
    LIMIT 100
  `).all();
  res.json({ submissions });
});

app.post("/api/publish", requirePermission("publish"), asyncRoute(async (req, res) => {
  const result = await publishSite(req.user.id);
  audit(req, "publish_success", { entityType: "publish", message: "Static site published", metadata: { generatedBundles: result.generatedBundles || [] } });
  res.json(result);
}));

app.get("/api/publish-events", requireAuth, (_req, res) => {
  res.json({ events: db.prepare("SELECT * FROM publish_events ORDER BY created_at DESC LIMIT 20").all() });
});

app.get("/api/audit-events", requirePermission("write"), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 200);
  const eventType = cleanText(req.query.eventType);
  const user = cleanText(req.query.user);
  const search = cleanText(req.query.search);
  const clauses = [];
  const args = [];
  if (eventType) {
    clauses.push("ae.event_type = ?");
    args.push(eventType);
  }
  if (user) {
    clauses.push("u.username LIKE ?");
    args.push(`%${user}%`);
  }
  if (search) {
    clauses.push("(ae.message LIKE ? OR ae.entity_type LIKE ? OR ae.event_type LIKE ?)");
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const events = db.prepare(`
    SELECT ae.id, ae.event_type, ae.entity_type, ae.entity_id, ae.message, ae.metadata, ae.created_at,
      u.username
    FROM audit_events ae
    LEFT JOIN users u ON u.id = ae.user_id
    ${where}
    ORDER BY ae.created_at DESC
    LIMIT ?
  `).all(...args, limit);
  res.json({ events });
});

app.get("/api/publish/preview", requirePermission("publish"), (_req, res) => {
  const products = db.prepare("SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.archived = 0").all();
  const downloads = db.prepare("SELECT * FROM download_objects WHERE archived = 0").all();
  const bundles = listSoftwareBundles();
  const settings = getSettings();
  const warnings = [];
  for (const product of products.filter((item) => ["ready", "published"].includes(item.publish_state) || item.status === "published")) {
    const imageCount = db.prepare("SELECT COUNT(*) AS count FROM product_images WHERE product_id = ?").get(product.id).count;
    const bundleCount = db.prepare("SELECT COUNT(*) AS count FROM product_support_packs WHERE product_id = ?").get(product.id).count;
    if (!imageCount) warnings.push({ entityType: "product", entityId: product.id, message: `${product.name} has no product images.` });
    if (!product.category_id) warnings.push({ entityType: "product", entityId: product.id, message: `${product.name} has no category.` });
    if (!product.marketplace_url) warnings.push({ entityType: "product", entityId: product.id, message: `${product.name} has no marketplace URL.` });
    if (!bundleCount) warnings.push({ entityType: "product", entityId: product.id, message: `${product.name} has no Software Bundle.` });
    if (product.stock_tracking && Number(product.stock_count || 0) <= 0) warnings.push({ entityType: "product", entityId: product.id, message: `${product.name} is published but stock is zero.` });
    if (!product.short_description) warnings.push({ entityType: "product", entityId: product.id, message: `${product.name} is missing a short description.` });
  }
  for (const download of downloads) {
    const latestCount = db.prepare("SELECT COUNT(*) AS count FROM download_versions WHERE download_id = ? AND is_latest = 1").get(download.id).count;
    if (!latestCount) warnings.push({ entityType: "download", entityId: download.id, message: `${download.name} has no latest version.` });
  }
  for (const bundle of bundles) {
    const localFileCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM support_pack_downloads spd
      JOIN download_versions v ON v.download_id = spd.download_id
      WHERE spd.support_pack_id = ? AND v.is_latest = 1 AND v.file_id IS NOT NULL
    `).get(bundle.id).count;
    if (bundle.auto_generate_zip && !localFileCount) warnings.push({ entityType: "software_bundle", entityId: bundle.id, message: `${bundle.name} has no local files to ZIP.` });
  }
  if (!settings.supportEmail && !settings.supportLink) warnings.push({ entityType: "settings", message: "Support/contact info is missing." });
  if (!settings.brandName) warnings.push({ entityType: "settings", message: "Brand/store name is missing." });
  const recentPublishEvents = db.prepare("SELECT * FROM publish_events ORDER BY created_at DESC LIMIT 5").all();
  res.json({
    counts: { products: products.length, downloads: downloads.length, softwareBundles: bundles.length },
    warnings,
    recentPublishEvents,
    ready: warnings.length === 0
  });
});

function demoSvg(title, subtitle, background = "#eaf3ff", accent = "#0b6bcb") {
  const safeTitle = cleanText(title);
  const safeSubtitle = cleanText(subtitle);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800" role="img" aria-label="${safeTitle}">
  <rect width="1200" height="800" fill="${background}"/>
  <rect x="72" y="72" width="1056" height="656" rx="28" fill="#ffffff" stroke="${accent}" stroke-width="8"/>
  <circle cx="980" cy="190" r="58" fill="${accent}" opacity="0.18"/>
  <rect x="150" y="180" width="420" height="250" rx="24" fill="${accent}" opacity="0.16"/>
  <rect x="650" y="210" width="300" height="36" rx="18" fill="${accent}" opacity="0.26"/>
  <rect x="650" y="285" width="420" height="28" rx="14" fill="${accent}" opacity="0.18"/>
  <rect x="650" y="345" width="360" height="28" rx="14" fill="${accent}" opacity="0.18"/>
  <text x="150" y="560" font-family="Arial, sans-serif" font-size="52" font-weight="700" fill="#17202a">${safeTitle}</text>
  <text x="150" y="625" font-family="Arial, sans-serif" font-size="30" fill="#667085">${safeSubtitle}</text>
</svg>`;
}

function ensureDemoFile(originalName, storedName, mimeType, content) {
  const normalizedStoredName = `demo/${storedName}`;
  const fullPath = path.join(config.uploadsDir, "demo", storedName);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (!fs.existsSync(fullPath)) fs.writeFileSync(fullPath, content);
  const size = fs.statSync(fullPath).size;
  const existing = db.prepare("SELECT * FROM files WHERE stored_name = ?").get(normalizedStoredName);
  if (existing) {
    db.prepare("UPDATE files SET original_name = ?, stored_name = ?, path = ?, mime_type = ?, size = ? WHERE id = ?")
      .run(originalName, normalizedStoredName, fullPath, mimeType, size, existing.id);
    return db.prepare("SELECT * FROM files WHERE id = ?").get(existing.id);
  }
  const result = db.prepare(`
    INSERT INTO files (original_name, stored_name, path, mime_type, size)
    VALUES (?, ?, ?, ?, ?)
  `).run(originalName, normalizedStoredName, fullPath, mimeType, size);
  return db.prepare("SELECT * FROM files WHERE id = ?").get(result.lastInsertRowid);
}

function ensureCategory(slug, name, description) {
  const existing = db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug);
  if (existing) {
    db.prepare("UPDATE categories SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(name, description, existing.id);
    return db.prepare("SELECT * FROM categories WHERE id = ?").get(existing.id);
  }
  const result = db.prepare("INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)")
    .run(name, slug, description);
  return db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid);
}

function ensureDownloadObject({ slug, name, type, shortDescription, externalUrl = "" }) {
  const existing = db.prepare("SELECT * FROM download_objects WHERE slug = ?").get(slug);
  if (existing) {
    db.prepare(`
      UPDATE download_objects
      SET name = ?, type = ?, short_description = ?, external_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, type, shortDescription, externalUrl, existing.id);
    return db.prepare("SELECT * FROM download_objects WHERE id = ?").get(existing.id);
  }
  const result = db.prepare(`
    INSERT INTO download_objects (name, slug, type, short_description, external_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, slug, type, shortDescription, externalUrl);
  return db.prepare("SELECT * FROM download_objects WHERE id = ?").get(result.lastInsertRowid);
}

function ensureDownloadVersion(downloadId, version) {
  if (version.isLatest) db.prepare("UPDATE download_versions SET is_latest = 0 WHERE download_id = ?").run(downloadId);
  const existing = db.prepare("SELECT * FROM download_versions WHERE download_id = ? AND version_number = ?")
    .get(downloadId, version.versionNumber);
  if (existing) {
    db.prepare(`
      UPDATE download_versions SET
        release_date = ?, file_id = ?, external_url = ?, release_notes = ?, is_latest = ?,
        deprecated = ?, warning_text = ?, file_size = ?, checksum = ?
      WHERE id = ?
    `).run(
      version.releaseDate,
      version.fileId || null,
      version.externalUrl || "",
      version.releaseNotes,
      version.isLatest ? 1 : 0,
      version.deprecated ? 1 : 0,
      version.warningText || "",
      version.fileSize || "",
      version.checksum || "",
      existing.id
    );
    return db.prepare("SELECT * FROM download_versions WHERE id = ?").get(existing.id);
  }
  const result = db.prepare(`
    INSERT INTO download_versions
    (download_id, version_number, release_date, file_id, external_url, release_notes, is_latest, deprecated, warning_text, file_size, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    downloadId,
    version.versionNumber,
    version.releaseDate,
    version.fileId || null,
    version.externalUrl || "",
    version.releaseNotes,
    version.isLatest ? 1 : 0,
    version.deprecated ? 1 : 0,
    version.warningText || "",
    version.fileSize || "",
    version.checksum || ""
  );
  return db.prepare("SELECT * FROM download_versions WHERE id = ?").get(result.lastInsertRowid);
}

function ensureSupportPack({ slug, name, description, downloadIds }) {
  const existing = db.prepare("SELECT * FROM support_packs WHERE slug = ?").get(slug);
  const packId = existing
    ? existing.id
    : db.prepare("INSERT INTO support_packs (name, slug, description, auto_generate_zip) VALUES (?, ?, ?, 1)").run(name, slug, description).lastInsertRowid;
  db.prepare("UPDATE support_packs SET name = ?, description = ?, auto_generate_zip = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(name, description, packId);
  const insert = db.prepare("INSERT OR IGNORE INTO support_pack_downloads (support_pack_id, download_id) VALUES (?, ?)");
  for (const downloadId of downloadIds) insert.run(packId, downloadId);
  return db.prepare("SELECT * FROM support_packs WHERE id = ?").get(packId);
}

function ensureProduct(data) {
  const existing = db.prepare("SELECT * FROM products WHERE slug = ?").get(data.slug);
  const values = [
    data.name,
    data.slug,
    data.sku,
    data.versionLabel,
    data.categoryId,
    data.marketplaceUrl,
    data.shortDescription,
    data.longDescription,
    "published",
    data.featured ? 1 : 0,
    data.publishState || "published",
    data.stockTracking ? 1 : 0,
    data.stockCount ?? null,
    data.stockLowThreshold ?? 5,
    data.stockDisplayMode || "friendly",
    data.stockSource || "manual",
    data.sortOrder || 0
  ];
  const productId = existing
    ? existing.id
    : db.prepare(`
      INSERT INTO products
      (name, slug, sku, version_label, category_id, marketplace_url, short_description, long_description, status, featured,
       publish_state, stock_tracking, stock_count, stock_low_threshold, stock_display_mode, stock_source, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...values).lastInsertRowid;
  if (existing) {
    db.prepare(`
      UPDATE products SET
        name = ?, slug = ?, sku = ?, version_label = ?, category_id = ?, marketplace_url = ?,
        short_description = ?, long_description = ?, status = ?, featured = ?, publish_state = ?,
        stock_tracking = ?, stock_count = ?, stock_low_threshold = ?, stock_display_mode = ?, stock_source = ?,
        sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(...values, productId);
  }
  return db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
}

function linkProductImage(productId, fileId, kind, sortOrder) {
  const existing = db.prepare("SELECT id FROM product_images WHERE product_id = ? AND file_id = ? AND kind = ?")
    .get(productId, fileId, kind);
  if (existing) {
    db.prepare("UPDATE product_images SET sort_order = ? WHERE id = ?").run(sortOrder, existing.id);
    return;
  }
  db.prepare("INSERT INTO product_images (product_id, file_id, kind, sort_order) VALUES (?, ?, ?, ?)")
    .run(productId, fileId, kind, sortOrder);
}

function linkProductSupportPack(productId, supportPackId) {
  db.prepare("INSERT OR IGNORE INTO product_support_packs (product_id, support_pack_id) VALUES (?, ?)")
    .run(productId, supportPackId);
}

function linkRelatedProduct(productId, relatedProductId, sortOrder = 0) {
  if (Number(productId) === Number(relatedProductId)) return;
  db.prepare(`
    INSERT INTO related_products (product_id, related_product_id, sort_order)
    VALUES (?, ?, ?)
    ON CONFLICT(product_id, related_product_id) DO UPDATE SET sort_order = excluded.sort_order
  `).run(productId, relatedProductId, sortOrder);
}

app.post("/api/sample-data", requirePermission("write"), (req, res) => {
  const settings = getSettings();
  if (!settings.brandName || settings.brandName.startsWith("Kairix Demo")) setSetting("brandName", "Kairix Demo Support");
  if (!settings.introText) setSetting("introText", "Find product information, manuals, apps, firmware, setup files and support downloads.");
  if (!settings.defaultMarketplaceLabel) setSetting("defaultMarketplaceLabel", "Buy on AliExpress");
  if (!settings.marketplaceUrl) setSetting("marketplaceUrl", "https://example.com/kairix-demo-store");
  if (!settings.footerText || settings.footerText.startsWith("Demo content.")) setSetting("footerText", "Demo content. Replace this footer in Settings.");
  if (!settings.contactFormEnabled) setSetting("contactFormEnabled", "true");
  const tx = db.transaction(() => {
    const smartControllers = ensureCategory("smart-controllers", "Smart Controllers", "Bluetooth and WiFi control products with apps, firmware and setup tools.");
    const cameraAccessories = ensureCategory("camera-accessories", "Camera Accessories", "Demo camera control cables and setup accessories.");

    const demoFiles = {
      controllerGallery1: ensureDemoFile("Demo Bluetooth Controller - Image 1.svg", "demo-bluetooth-controller-image-1.svg", "image/svg+xml", demoSvg("Demo Bluetooth Controller", "Product image 1", "#eaf3ff", "#0b6bcb")),
      controllerGallery2: ensureDemoFile("Demo Bluetooth Controller - Image 2.svg", "demo-bluetooth-controller-image-2.svg", "image/svg+xml", demoSvg("Bluetooth Controller Ports", "Product image 2", "#f4f7fb", "#0f766e")),
      controllerGallery3: ensureDemoFile("Demo Bluetooth Controller - Image 3.svg", "demo-bluetooth-controller-image-3.svg", "image/svg+xml", demoSvg("Bluetooth Controller Package", "Product image 3", "#fff7ed", "#b44818")),
      controllerDesc: ensureDemoFile("Demo Bluetooth Controller - Wiring Diagram.svg", "demo-bluetooth-controller-wiring-diagram.svg", "image/svg+xml", demoSvg("Controller Wiring Diagram", "Full-width description image", "#eef6ff", "#075bbb")),
      controllerSetup: ensureDemoFile("Demo Bluetooth Controller - App Setup.svg", "demo-bluetooth-controller-app-setup.svg", "image/svg+xml", demoSvg("Controller App Setup", "Setup screenshot", "#ecfdf3", "#067647")),
      relayGallery1: ensureDemoFile("Demo WiFi Relay Board - Image 1.svg", "demo-wifi-relay-board-image-1.svg", "image/svg+xml", demoSvg("Demo WiFi Relay Board", "Product image 1", "#eff8ff", "#0b6bcb")),
      relayGallery2: ensureDemoFile("Demo WiFi Relay Board - Image 2.svg", "demo-wifi-relay-board-image-2.svg", "image/svg+xml", demoSvg("Relay Board Terminals", "Product image 2", "#f4f3ff", "#6941c6")),
      relayGallery3: ensureDemoFile("Demo WiFi Relay Board - Image 3.svg", "demo-wifi-relay-board-image-3.svg", "image/svg+xml", demoSvg("Relay Board Mounting", "Product image 3", "#f0fdf4", "#15803d")),
      relayDesc: ensureDemoFile("Demo WiFi Relay Board - Wiring Diagram.svg", "demo-wifi-relay-board-wiring-diagram.svg", "image/svg+xml", demoSvg("Relay Board Wiring Diagram", "Full-width description image", "#f8fafc", "#334155")),
      relaySetup: ensureDemoFile("Demo WiFi Relay Board - Firmware Setup.svg", "demo-wifi-relay-board-firmware-setup.svg", "image/svg+xml", demoSvg("Relay Firmware Setup", "Setup screenshot", "#fff7ed", "#c2410c")),
      cableGallery1: ensureDemoFile("Demo Camera Cable - Image 1.svg", "demo-camera-cable-image-1.svg", "image/svg+xml", demoSvg("Demo Camera Control Cable", "Product image 1", "#f7fee7", "#4d7c0f")),
      cableGallery2: ensureDemoFile("Demo Camera Cable - Image 2.svg", "demo-camera-cable-image-2.svg", "image/svg+xml", demoSvg("Camera Cable Connectors", "Product image 2", "#fdf2f8", "#be185d")),
      cableGallery3: ensureDemoFile("Demo Camera Cable - Image 3.svg", "demo-camera-cable-image-3.svg", "image/svg+xml", demoSvg("Camera Cable In Use", "Product image 3", "#eef2ff", "#4338ca")),
      cableDesc: ensureDemoFile("Demo Camera Cable - Compatibility.svg", "demo-camera-cable-compatibility.svg", "image/svg+xml", demoSvg("Camera Cable Compatibility", "Full-width description image", "#f8fafc", "#475569")),
      cableSetup: ensureDemoFile("Demo Camera Cable - Setup.svg", "demo-camera-cable-setup.svg", "image/svg+xml", demoSvg("Camera Cable Setup", "Setup screenshot", "#ecfeff", "#0891b2")),
      android110: ensureDemoFile("Controller Mobile App 1.1.0 DEMO.txt", "controller-mobile-app-1.1.0-demo.txt", "text/plain", "DEMO placeholder for Controller Mobile App 1.1.0.\nUse the real APK or store link in production.\n"),
      android100: ensureDemoFile("Controller Mobile App 1.0.0 DEMO.txt", "controller-mobile-app-1.0.0-demo.txt", "text/plain", "DEMO placeholder for Controller Mobile App 1.0.0 previous release.\n"),
      windows200: ensureDemoFile("Controller Windows Utility 2.0.0 DEMO.txt", "controller-windows-utility-2.0.0-demo.txt", "text/plain", "DEMO placeholder for Windows installer 2.0.0.\n"),
      windows150: ensureDemoFile("Controller Windows Utility 1.5.0 DEMO.txt", "controller-windows-utility-1.5.0-demo.txt", "text/plain", "DEMO placeholder for Windows installer 1.5.0 previous release.\n"),
      firmware320: ensureDemoFile("Relay Board Firmware 3.2.0 DEMO.txt", "relay-board-firmware-3.2.0-demo.txt", "text/plain", "DEMO placeholder for firmware 3.2.0.\n"),
      firmware300: ensureDemoFile("Relay Board Firmware 3.0.0 DEMO.txt", "relay-board-firmware-3.0.0-demo.txt", "text/plain", "DEMO placeholder for firmware 3.0.0 previous release.\n"),
      controllerManual2026: ensureDemoFile("Bluetooth Controller Manual 2026.1 DEMO.txt", "bluetooth-controller-manual-2026.1-demo.txt", "text/plain", "DEMO manual placeholder for Bluetooth Controller Manual 2026.1.\n"),
      controllerManual2025: ensureDemoFile("Bluetooth Controller Manual 2025.4 DEMO.txt", "bluetooth-controller-manual-2025.4-demo.txt", "text/plain", "DEMO manual placeholder for Bluetooth Controller Manual 2025.4.\n"),
      relayManual2026: ensureDemoFile("Relay Board Manual 2026.1 DEMO.txt", "relay-board-manual-2026.1-demo.txt", "text/plain", "DEMO manual placeholder for Relay Board Manual 2026.1.\n"),
      cableGuide2026: ensureDemoFile("Camera Cable Quick Start Guide 2026.1 DEMO.txt", "camera-cable-quick-start-guide-2026.1-demo.txt", "text/plain", "DEMO quick start guide placeholder for Camera Cable 2026.1.\n")
    };

    const downloads = {
      android: ensureDownloadObject({ slug: "controller-mobile-app", name: "Controller Mobile App", type: "Android", shortDescription: "Android setup app for Bluetooth controller and relay products.", externalUrl: "https://example.com/controller-mobile-app" }),
      ios: ensureDownloadObject({ slug: "controller-ios-app", name: "Controller iOS App", type: "iOS", shortDescription: "iOS App Store link for controller setup.", externalUrl: "https://example.com/app-store/controller-ios-app" }),
      windows: ensureDownloadObject({ slug: "controller-windows-utility", name: "Controller Windows Utility", type: "Windows", shortDescription: "Desktop utility for configuration, diagnostics and firmware preparation." }),
      firmware: ensureDownloadObject({ slug: "relay-board-firmware", name: "Relay Board Firmware", type: "Firmware", shortDescription: "Firmware package for the demo WiFi relay board." }),
      controllerManual: ensureDownloadObject({ slug: "bluetooth-controller-manual", name: "Bluetooth Controller Manual", type: "Manual", shortDescription: "Manual and wiring notes for the demo Bluetooth controller." }),
      relayManual: ensureDownloadObject({ slug: "relay-board-manual", name: "Relay Board Manual", type: "Manual", shortDescription: "Manual and setup notes for the demo relay board." }),
      cableGuide: ensureDownloadObject({ slug: "camera-cable-quick-start-guide", name: "Camera Cable Quick Start Guide", type: "Manual", shortDescription: "Quick start guide for the demo camera control cable." })
    };

    ensureDownloadVersion(downloads.android.id, { versionNumber: "1.1.0", releaseDate: "2026-06-15", fileId: demoFiles.android110.id, releaseNotes: "<p>Latest demo Android app with improved pairing guidance.</p>", isLatest: true, fileSize: "Demo TXT" });
    ensureDownloadVersion(downloads.android.id, { versionNumber: "1.0.0", releaseDate: "2025-11-20", fileId: demoFiles.android100.id, releaseNotes: "<p>Initial demo Android app release.</p>", deprecated: true, warningText: "Previous demo release.", fileSize: "Demo TXT" });
    ensureDownloadVersion(downloads.ios.id, { versionNumber: "1.1.0", releaseDate: "2026-06-15", externalUrl: "https://example.com/app-store/controller-ios-app", releaseNotes: "<p>Latest demo iOS App Store listing.</p>", isLatest: true, fileSize: "External link" });
    ensureDownloadVersion(downloads.windows.id, { versionNumber: "2.0.0", releaseDate: "2026-05-10", fileId: demoFiles.windows200.id, releaseNotes: "<p>New diagnostics view and simplified device scan.</p>", isLatest: true, fileSize: "Demo TXT" });
    ensureDownloadVersion(downloads.windows.id, { versionNumber: "1.5.0", releaseDate: "2025-09-18", fileId: demoFiles.windows150.id, releaseNotes: "<p>Previous Windows configuration utility.</p>", deprecated: true, fileSize: "Demo TXT" });
    ensureDownloadVersion(downloads.firmware.id, { versionNumber: "3.2.0", releaseDate: "2026-04-02", fileId: demoFiles.firmware320.id, releaseNotes: "<p>Latest demo relay firmware with stability notes.</p>", isLatest: true, fileSize: "Demo TXT", checksum: "demo-sha256-placeholder" });
    ensureDownloadVersion(downloads.firmware.id, { versionNumber: "3.0.0", releaseDate: "2025-12-08", fileId: demoFiles.firmware300.id, releaseNotes: "<p>Previous firmware package for compatibility testing.</p>", deprecated: true, warningText: "Use latest firmware unless support asks otherwise.", fileSize: "Demo TXT" });
    ensureDownloadVersion(downloads.controllerManual.id, { versionNumber: "2026.1", releaseDate: "2026-01-12", fileId: demoFiles.controllerManual2026.id, releaseNotes: "<p>Updated wiring, pairing and troubleshooting notes.</p>", isLatest: true, fileSize: "Demo TXT" });
    ensureDownloadVersion(downloads.controllerManual.id, { versionNumber: "2025.4", releaseDate: "2025-08-01", fileId: demoFiles.controllerManual2025.id, releaseNotes: "<p>Previous manual revision.</p>", deprecated: true, fileSize: "Demo TXT" });
    ensureDownloadVersion(downloads.relayManual.id, { versionNumber: "2026.1", releaseDate: "2026-02-05", fileId: demoFiles.relayManual2026.id, releaseNotes: "<p>Relay wiring and safe setup guide.</p>", isLatest: true, fileSize: "Demo TXT" });
    ensureDownloadVersion(downloads.cableGuide.id, { versionNumber: "2026.1", releaseDate: "2026-03-22", fileId: demoFiles.cableGuide2026.id, releaseNotes: "<p>Camera cable quick start and compatibility notes.</p>", isLatest: true, fileSize: "Demo TXT" });

    const bluetoothPack = ensureSupportPack({
      slug: "bluetooth-controller-support-pack",
      name: "Bluetooth Controller Support Pack",
      description: "Apps, desktop utility and manual for the demo Bluetooth controller.",
      downloadIds: [downloads.android.id, downloads.ios.id, downloads.windows.id, downloads.controllerManual.id]
    });
    const relayPack = ensureSupportPack({
      slug: "relay-board-support-pack",
      name: "Relay Board Support Pack",
      description: "Apps, Windows utility, firmware and manual for the demo relay board.",
      downloadIds: [downloads.android.id, downloads.windows.id, downloads.firmware.id, downloads.relayManual.id]
    });
    const cablePack = ensureSupportPack({
      slug: "camera-cable-support-pack",
      name: "Camera Cable Support Pack",
      description: "Quick start guide for the demo camera control cable.",
      downloadIds: [downloads.cableGuide.id]
    });

    const bluetoothProduct = ensureProduct({
      slug: "demo-bluetooth-controller",
      name: "Demo Bluetooth Controller",
      sku: "KX-CTRL-001",
      versionLabel: "v1 hardware",
      categoryId: smartControllers.id,
      marketplaceUrl: "https://example.com/products/demo-bluetooth-controller",
      shortDescription: "A demo Bluetooth controller with mobile app setup, Windows utility and manual downloads.",
      longDescription: "<p>The demo Bluetooth controller shows how a product support page can combine product photos, setup screenshots, app downloads, manuals, marketplace links and related products.</p><p>Use this sample to test gallery thumbnails, Software Bundles, QR codes and version history links.</p>",
      featured: true,
      stockTracking: true,
      stockCount: 12,
      stockLowThreshold: 5,
      stockDisplayMode: "friendly",
      sortOrder: 0
    });
    const relayProduct = ensureProduct({
      slug: "demo-wifi-relay-board",
      name: "Demo WiFi Relay Board",
      sku: "KX-RELAY-004",
      versionLabel: "v2 board",
      categoryId: smartControllers.id,
      marketplaceUrl: "https://example.com/products/demo-wifi-relay-board",
      shortDescription: "A demo WiFi relay board with firmware, desktop utility and wiring documentation.",
      longDescription: "<p>The demo relay board page is useful for testing firmware downloads, warnings on older versions and related controller products.</p><p>It includes wiring diagrams, setup screenshots and latest support-pack downloads.</p>",
      featured: true,
      stockTracking: true,
      stockCount: 4,
      stockLowThreshold: 5,
      stockDisplayMode: "friendly",
      sortOrder: 1
    });
    const cableProduct = ensureProduct({
      slug: "demo-camera-control-cable",
      name: "Demo Camera Control Cable",
      sku: "KX-CAM-CBL",
      versionLabel: "Rev A",
      categoryId: cameraAccessories.id,
      marketplaceUrl: "https://example.com/products/demo-camera-control-cable",
      shortDescription: "A demo camera cable with compatibility images and a quick start guide.",
      longDescription: "<p>The demo camera control cable shows how accessories can have a simpler Software Bundle while still linking back to related controller products.</p>",
      featured: false,
      stockTracking: true,
      stockCount: 0,
      stockLowThreshold: 5,
      stockDisplayMode: "friendly",
      sortOrder: 2
    });

    [
      [bluetoothProduct.id, [demoFiles.controllerGallery1, demoFiles.controllerGallery2, demoFiles.controllerGallery3], "gallery"],
      [bluetoothProduct.id, [demoFiles.controllerDesc], "description"],
      [bluetoothProduct.id, [demoFiles.controllerSetup], "setup"],
      [relayProduct.id, [demoFiles.relayGallery1, demoFiles.relayGallery2, demoFiles.relayGallery3], "gallery"],
      [relayProduct.id, [demoFiles.relayDesc], "description"],
      [relayProduct.id, [demoFiles.relaySetup], "setup"],
      [cableProduct.id, [demoFiles.cableGallery1, demoFiles.cableGallery2, demoFiles.cableGallery3], "gallery"],
      [cableProduct.id, [demoFiles.cableDesc], "description"],
      [cableProduct.id, [demoFiles.cableSetup], "setup"]
    ].forEach(([productId, files, kind]) => files.forEach((file, index) => linkProductImage(productId, file.id, kind, index)));

    linkProductSupportPack(bluetoothProduct.id, bluetoothPack.id);
    linkProductSupportPack(relayProduct.id, relayPack.id);
    linkProductSupportPack(cableProduct.id, cablePack.id);
    linkRelatedProduct(bluetoothProduct.id, relayProduct.id, 0);
    linkRelatedProduct(relayProduct.id, bluetoothProduct.id, 0);
    linkRelatedProduct(cableProduct.id, bluetoothProduct.id, 0);
  });
  tx();
  res.json({ ok: true });
});

app.use("/uploads", express.static(config.uploadsDir, {
  index: false,
  dotfiles: "deny",
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
}));
app.use("/preview", express.static(config.generatedSiteDir));
app.use(express.static(path.join(config.adminSrcDir, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(config.adminSrcDir, "public", "index.html"));
});

app.use((error, _req, res, _next) => {
  const status = error.name === "ZodError" ? 400 : 500;
  res.status(status).json({
    error: status === 500 ? "Server error" : "Invalid request",
    details: error.name === "ZodError" ? error.errors : error.message
  });
});

cleanupExpiredSessions();
setInterval(cleanupExpiredSessions, 60 * 60 * 1000).unref();

app.listen(config.port, () => {
  fs.mkdirSync(config.generatedSiteDir, { recursive: true });
  console.log(`Kairix Express Page Builder admin listening on http://localhost:${config.port}`);
});
