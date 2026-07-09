import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
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
  hashInviteToken,
  hashPassword,
  isValidRole,
  requireAuth,
  requirePermission,
  sessionCookieOptions,
  verifyPassword
} from "./middleware/auth.js";
import { cookieParser } from "./middleware/cookies.js";
import { storageProvider } from "./providers/storage.js";
import { publishSite } from "./services/publish.js";

const app = express();
await storageProvider.ensureReady();

if (config.trustProxy) app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser);
app.use(authMiddleware);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
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
    if (!config.allowedUploadMimeTypes.has(file.mimetype)) {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  }
});

function cleanText(value) {
  return sanitizeHtml(String(value || ""), { allowedTags: [], allowedAttributes: {} }).trim();
}

function cleanRich(value) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "a", "h2", "h3", "blockquote", "code", "pre"],
    allowedAttributes: { a: ["href", "target", "rel"] }
  });
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
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const session = createSession(user.id);
  res.cookie("kairix_session", session.token, sessionCookieOptions());
  res.json({ ok: true, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
}));

app.post("/api/logout", (req, res) => {
  destroySession(req.cookies?.kairix_session);
  res.clearCookie("kairix_session", { path: "/" });
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({
    user: req.user || null,
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
    "theme",
    "defaultMarketplaceLabel",
    "footerText"
  ];
  for (const field of fields) setSetting(field, field.includes("Text") ? cleanRich(req.body[field]) : cleanText(req.body[field]));
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
    ORDER BY p.updated_at DESC
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
    status: z.enum(["draft", "published"]).default("draft"),
    featured: z.boolean().optional(),
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
      (name, slug, sku, version_label, category_id, marketplace_url, short_description, long_description, status, featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanText(body.name),
      slug,
      cleanText(body.sku),
      cleanText(body.versionLabel),
      body.categoryId || null,
      cleanText(body.marketplaceUrl),
      cleanText(body.shortDescription),
      cleanRich(body.longDescription),
      body.status,
      body.featured ? 1 : 0
    );
    saveProductRelations(result.lastInsertRowid, body);
    return result.lastInsertRowid;
  });
  const id = tx();
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
        short_description = ?, long_description = ?, status = ?, featured = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name,
      slug,
      cleanText(body.sku),
      cleanText(body.versionLabel),
      body.categoryId || null,
      cleanText(body.marketplaceUrl),
      cleanText(body.shortDescription),
      cleanRich(body.longDescription),
      body.status === "published" ? "published" : "draft",
      body.featured ? 1 : 0,
      id
    );
    saveProductRelations(id, body);
  });
  tx();
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

app.post("/api/downloads/:id/versions", requirePermission("files"), (req, res) => {
  const body = z.object({
    versionNumber: z.string().min(1),
    releaseDate: z.string().optional(),
    fileId: z.number().nullable().optional(),
    externalUrl: z.string().optional(),
    releaseNotes: z.string().optional(),
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
      cleanRich(body.releaseNotes),
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

app.get("/api/support-packs", requireAuth, (_req, res) => {
  const packs = db.prepare("SELECT * FROM support_packs ORDER BY name").all().map((pack) => ({
    ...pack,
    downloadIds: db.prepare("SELECT download_id FROM support_pack_downloads WHERE support_pack_id = ?").all(pack.id).map((row) => row.download_id)
  }));
  res.json({ packs });
});

app.post("/api/support-packs", requirePermission("write"), (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    description: z.string().optional(),
    downloadIds: z.array(z.number()).optional()
  }).parse(req.body);
  const slug = makeSlug(body.name, "support_packs");
  const tx = db.transaction(() => {
    const result = db.prepare("INSERT INTO support_packs (name, slug, description) VALUES (?, ?, ?)")
      .run(cleanText(body.name), slug, cleanText(body.description));
    const insert = db.prepare("INSERT OR IGNORE INTO support_pack_downloads (support_pack_id, download_id) VALUES (?, ?)");
    (body.downloadIds || []).forEach((downloadId) => insert.run(result.lastInsertRowid, downloadId));
    return result.lastInsertRowid;
  });
  const id = tx();
  res.json({ pack: db.prepare("SELECT * FROM support_packs WHERE id = ?").get(id) });
});

app.post("/api/invites", requirePermission("write"), (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Only Admin can create invite links" });
  const body = z.object({
    role: z.string().optional(),
    email: z.string().optional(),
    expiresHours: z.number().optional()
  }).parse(req.body);
  const role = isValidRole(body.role) ? body.role : "Read Only";
  const token = createOneTimeToken();
  const expires = new Date(Date.now() + (body.expiresHours || 48) * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO invites (token_hash, role, email, expires_at, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(token.hash, role, cleanText(body.email), expires, req.user.id);
  res.json({ inviteUrl: `${config.adminBaseUrl.replace(/\/$/, "")}/invite.html?token=${token.raw}`, role, expiresAt: expires });
});

app.post("/api/invites/accept", asyncRoute(async (req, res) => {
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
    const result = db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)")
      .run(cleanText(body.username), cleanText(body.email), passwordHash, invite.role);
    db.prepare("UPDATE invites SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(invite.id);
    return result.lastInsertRowid;
  });
  tx();
  res.json({ ok: true });
}));

app.get("/api/analytics", requirePermission("analytics"), (_req, res) => {
  const totals = db.prepare("SELECT event_type, COUNT(*) AS count FROM analytics_events GROUP BY event_type").all();
  const recent = db.prepare("SELECT * FROM analytics_events ORDER BY created_at DESC LIMIT 50").all();
  res.json({
    totals,
    recent,
    note: "Generated static pages can emit tracking events to this admin endpoint when the admin app is reachable."
  });
});

app.post("/api/track", (req, res) => {
  const body = z.object({
    eventType: z.enum(["page_view", "product_view", "download_click", "marketplace_click", "qr_opened", "version_history_viewed"]),
    path: z.string().optional(),
    productId: z.number().optional(),
    downloadId: z.number().optional(),
    metadata: z.record(z.any()).optional()
  }).parse(req.body);
  db.prepare("INSERT INTO analytics_events (event_type, path, product_id, download_id, metadata) VALUES (?, ?, ?, ?, ?)")
    .run(body.eventType, cleanText(body.path), body.productId || null, body.downloadId || null, JSON.stringify(body.metadata || {}));
  res.json({ ok: true });
});

app.post("/api/publish", requirePermission("publish"), asyncRoute(async (req, res) => {
  const result = await publishSite(req.user.id);
  res.json(result);
}));

app.get("/api/publish-events", requireAuth, (_req, res) => {
  res.json({ events: db.prepare("SELECT * FROM publish_events ORDER BY created_at DESC LIMIT 20").all() });
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
    : db.prepare("INSERT INTO support_packs (name, slug, description) VALUES (?, ?, ?)").run(name, slug, description).lastInsertRowid;
  db.prepare("UPDATE support_packs SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
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
    data.featured ? 1 : 0
  ];
  const productId = existing
    ? existing.id
    : db.prepare(`
      INSERT INTO products (name, slug, sku, version_label, category_id, marketplace_url, short_description, long_description, status, featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...values).lastInsertRowid;
  if (existing) {
    db.prepare(`
      UPDATE products SET
        name = ?, slug = ?, sku = ?, version_label = ?, category_id = ?, marketplace_url = ?,
        short_description = ?, long_description = ?, status = ?, featured = ?, updated_at = CURRENT_TIMESTAMP
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
      longDescription: "<p>The demo Bluetooth controller shows how a product support page can combine product photos, setup screenshots, app downloads, manuals, marketplace links and related products.</p><p>Use this sample to test gallery thumbnails, support packs, QR codes and version history links.</p>",
      featured: true
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
      featured: true
    });
    const cableProduct = ensureProduct({
      slug: "demo-camera-control-cable",
      name: "Demo Camera Control Cable",
      sku: "KX-CAM-CBL",
      versionLabel: "Rev A",
      categoryId: cameraAccessories.id,
      marketplaceUrl: "https://example.com/products/demo-camera-control-cable",
      shortDescription: "A demo camera cable with compatibility images and a quick start guide.",
      longDescription: "<p>The demo camera control cable shows how accessories can have a simpler support pack while still linking back to related controller products.</p>",
      featured: false
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
