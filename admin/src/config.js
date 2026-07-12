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

function requireProductionSecret(name, value) {
  const secret = String(value || "").trim();
  if (process.env.NODE_ENV !== "production") return secret;
  if (!secret || badProductionSecrets.has(secret)) {
    throw new Error(`${name} must be set to a long random value in production.`);
  }
  return secret;
}

const sessionSecret = requireProductionSecret("SESSION_SECRET", process.env.SESSION_SECRET || "local-dev-change-me");
const encryptionSecret = requireProductionSecret(
  "ENCRYPTION_SECRET",
  process.env.ENCRYPTION_SECRET || process.env.SESSION_SECRET || "local-dev-change-me"
);

if (process.env.NODE_ENV === "production" && sessionSecret === encryptionSecret) {
  throw new Error("SESSION_SECRET and ENCRYPTION_SECRET must be different long random values in production.");
}

export const config = {
  projectRoot,
  adminSrcDir,
  port: Number(process.env.PORT || 8080),
  databasePath: resolveFromRoot(process.env.DATABASE_PATH, "./data/kairix.sqlite"),
  uploadsDir: resolveFromRoot(process.env.UPLOADS_DIR, "./uploads"),
  generatedSiteDir: resolveFromRoot(process.env.GENERATED_SITE_DIR, "./generated-site"),
  generatedSiteBuildDir: resolveFromRoot(process.env.PUBLIC_BUILD_TEMP_DIR, "./.cache/generated-site-build"),
  backupsDir: resolveFromRoot(process.env.BACKUPS_DIR, "./data/backups"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:4321",
  publicSiteBasePath: process.env.PUBLIC_SITE_BASE_PATH ?? "/preview",
  adminBaseUrl: process.env.ADMIN_BASE_URL || "http://localhost:8080",
  encryptionSecret,
  aliexpressAuthUrl: process.env.ALIEXPRESS_AUTH_URL || "",
  aliexpressTokenUrl: process.env.ALIEXPRESS_TOKEN_URL || "",
  aliexpressApiUrl: process.env.ALIEXPRESS_API_URL || "",
  trustProxy: boolEnv("TRUST_PROXY", false),
  cookieSecure: boolEnv("COOKIE_SECURE", process.env.NODE_ENV === "production"),
  sampleDataToolsEnabled: boolEnv("ENABLE_SAMPLE_DATA_TOOLS", process.env.NODE_ENV !== "production"),
  sessionSecret,
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  allowedUploadMimeTypes: new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/svg+xml",
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-msdownload",
    "application/vnd.microsoft.portable-executable",
    "application/x-apple-diskimage",
    "application/octet-stream",
    "text/plain"
  ]),
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
  riskyUploadExtensions: new Set([".exe", ".dmg", ".pkg", ".msi", ".bin", ".hex", ".uf2"])
};
