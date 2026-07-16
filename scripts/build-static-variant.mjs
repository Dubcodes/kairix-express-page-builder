import path from "node:path";
import fs from "fs-extra";

const values = Object.fromEntries(process.argv.slice(2).map((item) => {
  const index = item.indexOf("=");
  return index === -1 ? [item, ""] : [item.slice(0, index), item.slice(index + 1)];
}));
const provider = values.provider || "local";
const basePath = values.base ?? (provider === "local" ? "/preview" : "");
const publicBaseUrl = values.url || (provider === "local" ? "http://localhost:8080" : "https://public.example.test");
const outputDir = path.resolve(values.out || `.cache/verify-${provider}`);

process.env.NODE_ENV = "development";
process.env.DEPLOY_PROVIDER = provider;
process.env.PUBLIC_SITE_BASE_PATH = basePath;
process.env.PUBLIC_BASE_URL = publicBaseUrl;
process.env.ASTRO_OUT_DIR = outputDir;
if (provider === "cloudflare-pages") {
  process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
  process.env.CLOUDFLARE_PAGES_PROJECT = "verification-project";
  process.env.CLOUDFLARE_PAGES_BRANCH = "main";
  process.env.CLOUDFLARE_API_TOKEN = "verification-only-not-a-secret";
}

const [{ config }, { buildExportData }, { runProcess }, { storageProvider }] = await Promise.all([
  import("../admin/src/config.js"),
  import("../admin/src/services/exportData.js"),
  import("../admin/src/services/processRunner.js"),
  import("../admin/src/providers/storage.js")
]);
const data = await buildExportData();
await fs.writeJson(path.join(config.projectRoot, "site", "src", "data", "content.json"), data, { spaces: 2 });
await storageProvider.copyToPublic(path.join(config.projectRoot, "site", "public", "uploads"));
await fs.emptyDir(outputDir);
const result = await runProcess(process.execPath, [path.join(config.projectRoot, "site", "scripts", "astro.mjs"), "build"], {
  cwd: config.projectRoot,
  env: process.env,
  timeoutMs: 120_000,
  maxOutputBytes: 256 * 1024
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
