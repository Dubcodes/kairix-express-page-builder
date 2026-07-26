import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { verifyPublicFavicon } from "./check-public-favicon.mjs";

const repositoryRoot = path.resolve(".");
await fs.ensureDir(path.join(repositoryRoot, ".cache"));
const scratch = await fs.mkdtemp(path.join(repositoryRoot, ".cache", "live-content-scratch-"));
const outputRoot = path.join(repositoryRoot, ".cache", "live-content-build");
const uploadsBackup = path.join(scratch, "public-uploads-backup");
const publicUploads = path.join(repositoryRoot, "site", "public", "uploads");

process.env.NODE_ENV = "production";
process.env.SESSION_SECRET = "live-content-check-session-secret-000000000000000000";
process.env.ENCRYPTION_SECRET = "live-content-check-encryption-secret-111111111111111";
process.env.COOKIE_SECURE = "false";
process.env.DATABASE_PATH = path.join(scratch, "data", "verification.sqlite");
process.env.UPLOADS_DIR = path.join(scratch, "uploads");
process.env.DEPLOY_PROVIDER = "local";
process.env.PUBLIC_BASE_URL = "http://localhost:8080";
process.env.PUBLIC_SITE_BASE_PATH = "/preview";
process.env.ENABLE_SAMPLE_DATA_TOOLS = "false";

const [{ db, setSetting }, { buildExportData }, { storageProvider }, { runProcess }, { validateGeneratedSite }] = await Promise.all([
  import("../admin/src/db.js"),
  import("../admin/src/services/exportData.js"),
  import("../admin/src/providers/storage.js"),
  import("../admin/src/services/processRunner.js"),
  import("../admin/src/services/siteValidation.js")
]);

const expectedStrings = ["Banana Madness", "Welcome to my banana", "Bananas"];
const forbiddenStrings = [
  "Demo Bluetooth Controller",
  "Kairix Demo Support",
  "Sample category for local testing",
  "Demo content. Replace from the admin panel.",
  "Demo content. Replace this footer in Settings."
];

async function addManagedSvg(storedName, originalName, label) {
  const absolutePath = path.join(process.env.UPLOADS_DIR, ...storedName.split("/"));
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#f6d64a"/><text x="20" y="95">${label}</text></svg>`;
  await fs.outputFile(absolutePath, body);
  const result = db.prepare(`
    INSERT INTO files (original_name, stored_name, path, mime_type, size, content_hash)
    VALUES (?, ?, ?, 'image/svg+xml', ?, ?)
  `).run(originalName, storedName, absolutePath, Buffer.byteLength(body), crypto.createHash("sha256").update(body).digest("hex"));
  return Number(result.lastInsertRowid);
}

async function readHtmlFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        files.push({ path: fullPath, html: await fs.readFile(fullPath, "utf8") });
      }
    }
  }
  return files;
}

async function buildVariant(name, sourceData, { basePath, publicBaseUrl, runtimeApiEnabled }) {
  const jobDir = path.join(scratch, `publish-${name}`);
  const contentPath = path.join(jobDir, "input", "content.json");
  const outputDir = path.join(outputRoot, name);
  const data = structuredClone(sourceData);
  data.siteBasePath = basePath;
  data.publicBaseUrl = publicBaseUrl;
  data.runtimeApiEnabled = runtimeApiEnabled;
  data.settings.contactFormEnabled = runtimeApiEnabled && data.settings.contactFormEnabled;
  if (!runtimeApiEnabled) {
    for (const product of data.products) {
      product.public_url = `${publicBaseUrl.replace(/\/$/, "")}/products/${product.slug}/`;
      product.support_qr = "";
    }
  }
  await fs.outputJson(contentPath, data, { spaces: 2 });
  await fs.emptyDir(outputDir);
  await runProcess(process.execPath, [path.join(repositoryRoot, "site", "scripts", "astro.mjs"), "build"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ASTRO_OUT_DIR: outputDir,
      ASTRO_WORK_DIR: jobDir,
      PUBLIC_BASE_URL: publicBaseUrl,
      PUBLIC_SITE_BASE_PATH: basePath,
      KAIRIX_CONTENT_ROOT: jobDir,
      KAIRIX_CONTENT_PATH: contentPath,
      KAIRIX_USE_SAMPLE_CONTENT: "false"
    },
    timeoutMs: 120_000,
    maxOutputBytes: 256 * 1024
  });

  const validation = await validateGeneratedSite(outputDir, { approvedRoot: outputRoot });
  const favicon = await verifyPublicFavicon(outputDir, basePath, "/uploads/customer/banana-favicon.svg");
  const htmlFiles = await readHtmlFiles(outputDir);
  const combined = htmlFiles.map((file) => file.html).join("\n");
  for (const value of expectedStrings) {
    if (!combined.includes(value)) throw new Error(`${name} output is missing expected database content: ${value}`);
  }
  for (const value of forbiddenStrings) {
    if (combined.includes(value)) throw new Error(`${name} output contains forbidden sample content: ${value}`);
  }
  const expectedHero = `${basePath}/uploads/customer/banana-hero.svg`;
  if (!combined.includes(expectedHero)) throw new Error(`${name} output is missing the selected hero image: ${expectedHero}`);
  for (const file of htmlFiles) {
    if (!file.html.includes("Banana Madness")) {
      throw new Error(`${name} page is missing customer branding: ${path.relative(outputDir, file.path)}`);
    }
  }
  if (runtimeApiEnabled && !combined.includes("/api/track")) throw new Error("Local output is missing local analytics behavior.");
  if (!runtimeApiEnabled && combined.includes("/api/track")) throw new Error("Cloudflare output contains the private analytics API.");
  if (runtimeApiEnabled && !combined.includes("/api/contact-submissions")) throw new Error("Local output is missing the enabled local contact form.");
  if (!runtimeApiEnabled && combined.includes("/api/contact-submissions")) throw new Error("Cloudflare output contains the private contact API.");
  if (!combined.includes("banana-help@example.test")) throw new Error(`${name} output lost the saved public contact method.`);
  if (!runtimeApiEnabled && combined.includes("/preview/")) throw new Error("Cloudflare output contains a local /preview/ path.");

  return {
    name,
    outputDir,
    pages: htmlFiles.length,
    files: validation.fileCount,
    faviconPages: favicon.pageCount
  };
}

try {
  if (await fs.pathExists(publicUploads)) await fs.copy(publicUploads, uploadsBackup);

  const logoId = await addManagedSvg("customer/banana-logo.svg", "banana-logo.svg", "Banana logo");
  const faviconId = await addManagedSvg("customer/banana-favicon.svg", "banana-favicon.svg", "Banana favicon");
  const heroId = await addManagedSvg("customer/banana-hero.svg", "banana-hero.svg", "Banana hero");
  const productImageId = await addManagedSvg("products/bananas/gallery.svg", "bananas.svg", "Bananas");

  for (const [key, value] of Object.entries({
    brandName: "Banana Madness",
    logo: "/uploads/customer/banana-logo.svg",
    logoFileId: String(logoId),
    faviconFileId: String(faviconId),
    homeHeroTitle: "Banana Madness",
    homeHeroImage: "/uploads/customer/banana-hero.svg",
    introText: "Welcome to my banana",
    footerText: "Banana Madness customer footer",
    theme: "warm-simple",
    contactFormEnabled: "true",
    homeShowCategories: "true",
    homeShowFeaturedProducts: "true",
    homeShowSupportCta: "true"
  })) setSetting(key, value);
  db.prepare(
    "INSERT INTO contact_methods (label, type, value, visible) VALUES (?, 'email', ?, 1)"
  ).run("Banana support", "banana-help@example.test");

  const categoryId = Number(db.prepare(
    "INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)"
  ).run("Banana Catalogue", "banana-catalogue", "Customer banana products").lastInsertRowid);
  const productId = Number(db.prepare(`
    INSERT INTO products (
      name, slug, sku, category_id, marketplace_url, short_description, long_description,
      featured, stock_tracking, stock_count, stock_display_mode, publish_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 17, 'exact', 'published')
  `).run(
    "Bananas",
    "bananas",
    "BANANA-001",
    categoryId,
    "https://shop.example.test/bananas",
    "Actual database banana product",
    "<p>Saved product description</p>"
  ).lastInsertRowid);
  db.prepare(
    "INSERT INTO product_images (product_id, file_id, kind, sort_order) VALUES (?, ?, 'gallery', 0)"
  ).run(productId, productImageId);
  db.prepare(
    "INSERT INTO products (name, slug, publish_state) VALUES ('Hidden Draft', 'hidden-draft', 'draft')"
  ).run();

  const exported = await buildExportData();
  assertExportedIdentity(exported);
  const managedFiles = db.prepare("SELECT id, stored_name FROM files ORDER BY id").all();
  const uploadSummary = await storageProvider.copyToPublic(publicUploads, managedFiles);
  if (uploadSummary.copiedFiles !== 4) throw new Error(`Expected four managed verification uploads; copied ${uploadSummary.copiedFiles}.`);

  await fs.emptyDir(outputRoot);
  const results = [];
  results.push(await buildVariant("local", exported, {
    basePath: "/preview",
    publicBaseUrl: "http://localhost:8080",
    runtimeApiEnabled: true
  }));
  results.push(await buildVariant("cloudflare-root", exported, {
    basePath: "",
    publicBaseUrl: "https://banana-pages.example.test",
    runtimeApiEnabled: false
  }));
  for (const result of results) {
    console.log(`${result.name}: ${result.pages} HTML page(s), ${result.files} validated file(s), customer favicon on ${result.faviconPages} page(s), output ${result.outputDir}`);
  }
  console.log(`Expected strings found: ${expectedStrings.join(", ")}.`);
  console.log(`Demo strings absent: ${forbiddenStrings.join(", ")}.`);
} finally {
  db.close();
  await fs.remove(publicUploads);
  if (await fs.pathExists(uploadsBackup)) await fs.copy(uploadsBackup, publicUploads);
  await fs.remove(scratch);
}

function assertExportedIdentity(exported) {
  if (exported.settings.brandName !== "Banana Madness") throw new Error("Database export lost public site name.");
  if (exported.settings.homeHeroTitle !== "Banana Madness") throw new Error("Database export lost hero title.");
  if (exported.settings.introText !== "Welcome to my banana") throw new Error("Database export lost intro text.");
  if (exported.settings.homeHeroImage !== "/uploads/customer/banana-hero.svg") throw new Error("Database export lost hero image.");
  if (exported.settings.favicon !== "/uploads/customer/banana-favicon.svg") throw new Error("Database export lost selected favicon.");
  if (exported.products.length !== 1 || exported.products[0].name !== "Bananas") {
    throw new Error("Database export did not restrict catalogue output to the real published product.");
  }
}
