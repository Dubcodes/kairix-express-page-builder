import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const thisFile = fileURLToPath(import.meta.url);
const adminSrcDir = path.dirname(thisFile);
const projectRoot = path.resolve(adminSrcDir, "..", "..");

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function positiveIntEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function resolveFromRoot(value, fallback) {
  const input = value || fallback;
  return path.isAbsolute(input) ? input : path.resolve(projectRoot, input);
}

const badProductionSecrets = new Set([
  "change-this-long-random-secret",
  "change-this-long-random-secret-too",
  "local-dev-change-me",
  "use-a-long-random-secret",
  "use-a-different-long-random-secret",
  "replace-with-long-random-secret",
  "replace-with-different-long-random-secret"
]);

export function requireProductionSecret(name, value, nodeEnv = process.env.NODE_ENV) {
  const secret = String(value || "").trim();
  if (nodeEnv !== "production") return secret;
  if (secret.length < 32 || badProductionSecrets.has(secret)) {
    throw new Error(`${name} must be set to a random value of at least 32 characters in production.`);
  }
  return secret;
}

const sessionSecret = requireProductionSecret("SESSION_SECRET", process.env.SESSION_SECRET || "local-dev-change-me");
const encryptionSecret = requireProductionSecret(
  "ENCRYPTION_SECRET",
  process.env.ENCRYPTION_SECRET || process.env.SESSION_SECRET || "local-dev-change-me"
);
const trustProxy = boolEnv("TRUST_PROXY", false);
const cookieSecure = boolEnv("COOKIE_SECURE", process.env.NODE_ENV === "production");
const sampleDataToolsEnabled = boolEnv("ENABLE_SAMPLE_DATA_TOOLS", process.env.NODE_ENV !== "production");
const deployProvider = String(process.env.DEPLOY_PROVIDER || "local").trim().toLowerCase();
const publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:4321";
const publicSiteBasePath = process.env.PUBLIC_SITE_BASE_PATH ?? "/preview";
const adminBaseUrl = process.env.ADMIN_BASE_URL || "http://localhost:8080";

if (!new Set(["local", "cloudflare-pages"]).has(deployProvider)) {
  throw new Error("DEPLOY_PROVIDER must be local or cloudflare-pages.");
}

if (deployProvider === "cloudflare-pages") {
  for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_PAGES_PROJECT", "CLOUDFLARE_API_TOKEN"]) {
    if (!String(process.env[name] || "").trim()) throw new Error(`${name} is required when DEPLOY_PROVIDER=cloudflare-pages.`);
  }
}

if (process.env.NODE_ENV === "production" && sessionSecret === encryptionSecret) {
  throw new Error("SESSION_SECRET and ENCRYPTION_SECRET must be different long random values in production.");
}

if (process.env.NODE_ENV === "production" && cookieSecure && !trustProxy) {
  console.warn("COOKIE_SECURE=true with TRUST_PROXY=false. Behind HTTPS tunnels or reverse proxies, set TRUST_PROXY=true so secure cookies work correctly.");
}

if (process.env.NODE_ENV === "production" && sampleDataToolsEnabled) {
  console.warn("ENABLE_SAMPLE_DATA_TOOLS=true in production. Disable it before sharing the Page Manager with clients.");
}

export function validateProductionConfiguration({
  nodeEnv,
  adminBaseUrl: adminUrlValue,
  publicBaseUrl: publicUrlValue,
  publicSiteBasePath: basePath,
  deployProvider: provider,
  cookieSecure: secureCookies,
  trustProxy: proxyTrusted,
  publicHostname
}) {
  if (nodeEnv !== "production") return [];
  const issues = [];
  let adminUrl;
  let publicUrl;
  try {
    adminUrl = new URL(adminUrlValue);
  } catch {
    issues.push("ADMIN_BASE_URL must be an absolute http(s) URL.");
  }
  try {
    publicUrl = new URL(publicUrlValue);
  } catch {
    issues.push("PUBLIC_BASE_URL must be an absolute http(s) URL.");
  }
  if (adminUrl && !["http:", "https:"].includes(adminUrl.protocol)) issues.push("ADMIN_BASE_URL must use http or https.");
  if (publicUrl && !["http:", "https:"].includes(publicUrl.protocol)) issues.push("PUBLIC_BASE_URL must use http or https.");
  if (adminUrl?.protocol === "https:" && !secureCookies) issues.push("COOKIE_SECURE must be true when ADMIN_BASE_URL uses HTTPS.");
  if (secureCookies && !proxyTrusted) issues.push("TRUST_PROXY must be true when secure cookies are used behind the production reverse proxy.");
  if (provider === "cloudflare-pages") {
    if (publicUrl?.protocol !== "https:") issues.push("PUBLIC_BASE_URL must use HTTPS for Cloudflare Pages publishing.");
    if (basePath !== "") issues.push("PUBLIC_SITE_BASE_PATH must be empty for a root Cloudflare Pages deployment.");
    if (adminUrl && publicUrl && adminUrl.origin === publicUrl.origin) issues.push("ADMIN_BASE_URL and PUBLIC_BASE_URL must use different origins for Cloudflare Pages publishing.");
    if (String(publicHostname || "").trim()) issues.push("PUBLIC_HOSTNAME must be empty in Cloudflare Pages mode; the private server must not receive public-site traffic.");
  }
  return issues;
}

const safetyIssues = validateProductionConfiguration({
  nodeEnv: process.env.NODE_ENV,
  adminBaseUrl,
  publicBaseUrl,
  publicSiteBasePath,
  deployProvider,
  cookieSecure,
  trustProxy,
  publicHostname: process.env.PUBLIC_HOSTNAME
});
safetyIssues.forEach((issue) => console.error(`Production safety check: ${issue}`));

export const config = {
  projectRoot,
  adminSrcDir,
  port: Number(process.env.PORT || 8080),
  databasePath: resolveFromRoot(process.env.DATABASE_PATH, "./data/kairix.sqlite"),
  uploadsDir: resolveFromRoot(process.env.UPLOADS_DIR, "./uploads"),
  generatedSiteDir: resolveFromRoot(process.env.GENERATED_SITE_DIR, "./generated-site"),
  generatedSiteBuildDir: resolveFromRoot(process.env.PUBLIC_BUILD_TEMP_DIR, "./.cache/generated-site-build"),
  backupsDir: resolveFromRoot(process.env.BACKUPS_DIR, "./data/backups"),
  publicBaseUrl,
  publicSiteBasePath,
  adminBaseUrl,
  adminHostname: process.env.ADMIN_HOSTNAME || "",
  publicHostname: process.env.PUBLIC_HOSTNAME || "",
  encryptionSecret,
  aliexpressAuthUrl: process.env.ALIEXPRESS_AUTH_URL || "",
  aliexpressTokenUrl: process.env.ALIEXPRESS_TOKEN_URL || "",
  aliexpressApiUrl: process.env.ALIEXPRESS_API_URL || "",
  trustProxy,
  cookieSecure,
  sampleDataToolsEnabled,
  sessionSecret,
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  allowedUploadExtensions: new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".svg",
    ".pdf",
    ".txt",
    ".zip",
    ".bin",
    ".hex",
    ".uf2",
    ".exe",
    ".dmg",
    ".pkg",
    ".msi"
  ]),
  allowedUploadMimeTypesByExtension: new Map([
    [".jpg", new Set(["image/jpeg"])],
    [".jpeg", new Set(["image/jpeg"])],
    [".png", new Set(["image/png"])],
    [".webp", new Set(["image/webp"])],
    [".gif", new Set(["image/gif"])],
    [".svg", new Set(["image/svg+xml"])],
    [".pdf", new Set(["application/pdf"])],
    [".txt", new Set(["text/plain"])],
    [".zip", new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream"])],
    [".bin", new Set(["application/octet-stream"])],
    [".hex", new Set(["application/octet-stream", "text/plain"])],
    [".uf2", new Set(["application/octet-stream"])],
    [".exe", new Set(["application/x-msdownload", "application/vnd.microsoft.portable-executable", "application/octet-stream"])],
    [".dmg", new Set(["application/x-apple-diskimage", "application/octet-stream"])],
    [".pkg", new Set(["application/octet-stream"])],
    [".msi", new Set(["application/x-msdownload", "application/octet-stream"])]
  ]),
  riskyUploadExtensions: new Set([".exe", ".dmg", ".pkg", ".msi", ".bin", ".hex", ".uf2"]),
  deployProvider,
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
  cloudflarePagesProject: process.env.CLOUDFLARE_PAGES_PROJECT || "",
  cloudflarePagesBranch: process.env.CLOUDFLARE_PAGES_BRANCH || "main",
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || "",
  cloudflareDeployTimeoutMs: positiveIntEnv("CLOUDFLARE_DEPLOY_TIMEOUT_MS", 10 * 60 * 1000, { min: 10_000, max: 60 * 60 * 1000 }),
  cloudflarePreflightTimeoutMs: positiveIntEnv("CLOUDFLARE_PREFLIGHT_TIMEOUT_MS", 15_000, { min: 1_000, max: 60_000 }),
  publishMaxFiles: positiveIntEnv("PUBLISH_MAX_FILES", 20_000, { min: 1, max: 100_000 }),
  publishMaxTotalBytes: positiveIntEnv("PUBLISH_MAX_TOTAL_MB", 500, { min: 1, max: 5_000 }) * 1024 * 1024,
  publishMaxFileBytes: positiveIntEnv("PUBLISH_MAX_FILE_MB", 25, { min: 1, max: 2_000 }) * 1024 * 1024,
  productionSafetyIssues: safetyIssues
};
