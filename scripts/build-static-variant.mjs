import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import { verifyPublicFavicon } from "./check-public-favicon.mjs";

const values = Object.fromEntries(process.argv.slice(2).map((item) => {
  const index = item.indexOf("=");
  return index === -1 ? [item, ""] : [item.slice(0, index), item.slice(index + 1)];
}));
const provider = values.provider || "local";
const basePath = values.base ?? (provider === "local" ? "/preview" : "");
const publicBaseUrl = values.url || (provider === "local" ? "http://localhost:8080" : "https://public.example.test");
const outputDir = path.resolve(values.out || `.cache/verify-${provider}`);
const jobDir = path.resolve(values.job || `.cache/static-variant-${provider}-${process.pid}`);
const contentPath = path.join(jobDir, "input", "content.json");
const publicDir = path.join(jobDir, "public");

process.env.NODE_ENV = "production";
process.env.DEPLOY_PROVIDER = provider;
process.env.PUBLIC_SITE_BASE_PATH = basePath;
process.env.PUBLIC_BASE_URL = publicBaseUrl;
process.env.ASTRO_OUT_DIR = outputDir;
process.env.ASTRO_WORK_DIR = jobDir;
process.env.ASTRO_PUBLIC_DIR = publicDir;
process.env.KAIRIX_CONTENT_ROOT = jobDir;
process.env.KAIRIX_CONTENT_PATH = contentPath;
process.env.KAIRIX_USE_SAMPLE_CONTENT = "false";
if (["cloudflare-pages", "cloudflare-workers"].includes(provider)) {
  process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
  process.env.CLOUDFLARE_API_TOKEN = crypto.randomBytes(32).toString("hex");
}
if (provider === "cloudflare-pages") {
  process.env.CLOUDFLARE_PAGES_PROJECT = "verification-project";
  process.env.CLOUDFLARE_PAGES_BRANCH = "main";
}
if (provider === "cloudflare-workers") {
  process.env.CLOUDFLARE_WORKER_NAME = "verification-worker";
}

const [{ config }, { db }, { buildExportData }, { runProcess }, { storageProvider }] = await Promise.all([
  import("../admin/src/config.js"),
  import("../admin/src/db.js"),
  import("../admin/src/services/exportData.js"),
  import("../admin/src/services/processRunner.js"),
  import("../admin/src/providers/storage.js")
]);
const data = await buildExportData();
try {
  await fs.outputJson(contentPath, data, { spaces: 2 });
  const managedFiles = db.prepare("SELECT id, stored_name FROM files ORDER BY id").all();
  await storageProvider.copyToPublic(path.join(publicDir, "uploads"), managedFiles);
  await fs.emptyDir(outputDir);
  const result = await runProcess(process.execPath, [path.join(config.projectRoot, "site", "scripts", "astro.mjs"), "build"], {
    cwd: config.projectRoot,
    env: process.env,
    timeoutMs: 120_000,
    maxOutputBytes: 256 * 1024
  });
  const favicon = await verifyPublicFavicon(outputDir, basePath, data.settings.favicon);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(favicon.configured
    ? `Verified customer favicon on ${favicon.pageCount} generated page(s) at ${favicon.href}.`
    : `Verified no-public-favicon policy on ${favicon.pageCount} generated page(s).`);
} finally {
  await fs.remove(jobDir);
}
