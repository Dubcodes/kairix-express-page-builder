import path from "node:path";
import fs from "fs-extra";
import JSZip from "jszip";

const allowedExtensions = new Set([
  ".html", ".css", ".js", ".json", ".xml", ".txt", ".svg", ".png", ".jpg", ".jpeg",
  ".webp", ".gif", ".avif", ".ico", ".pdf", ".zip", ".bin", ".hex", ".uf2", ".exe",
  ".dmg", ".pkg", ".msi", ".webmanifest", ".woff", ".woff2", ".ttf", ".eot"
]);

const forbiddenPathPatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.git(?:\/|$)/i,
  /(^|\/)node_modules(?:\/|$)/i,
  /(^|\/)functions(?:\/|$)/i,
  /(^|\/)(?:backups?|sessions?|logs?)(?:\/|$)/i,
  /(?:^|\/)(?:package(?:-lock)?\.json|server\.(?:js|mjs|cjs|ts)|wrangler\.(?:toml|jsonc?)|_worker\.js|_routes\.json)$/i,
  /\.(?:sqlite|sqlite3|db|db3)(?:-(?:wal|shm))?$/i,
  /\.(?:wal|shm|log|pem|key|p12|pfx|map|bak|backup)$/i
];

const sensitiveContentPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:CLOUDFLARE_API_TOKEN|SESSION_SECRET|ENCRYPTION_SECRET|DATABASE_PATH|ALIEXPRESS_[A-Z_]*(?:SECRET|TOKEN))\b/,
  /\b(?:api[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9._~-]{16,}["']/i,
  /\baccess_token_encrypted\b|\brefresh_token_encrypted\b/i
];

const textExtensions = new Set([".html", ".css", ".js", ".json", ".xml", ".txt", ".svg", ".webmanifest"]);

export class SiteValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SiteValidationError";
    this.code = "SITE_VALIDATION_FAILED";
    this.statusCode = 400;
    this.publicMessage = "Generated site validation failed. Review the server diagnostics and try again.";
    Object.assign(this, details);
  }
}

export function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function validateZipArchive(fullPath, relativePath) {
  let archive;
  try {
    archive = await JSZip.loadAsync(await fs.readFile(fullPath));
  } catch {
    throw new SiteValidationError(`Unreadable or encrypted ZIP archive rejected: ${relativePath}`);
  }
  const entries = Object.values(archive.files);
  if (entries.length > 10_000) throw new SiteValidationError(`ZIP archive has too many entries: ${relativePath}`);
  let uncompressedBytes = 0;
  for (const entry of entries) {
    const entryPath = String(entry.name || "").replaceAll("\\", "/");
    const normalized = path.posix.normalize(entryPath);
    if (normalized.startsWith("../") || normalized.startsWith("/") || normalized.includes("/../")) {
      throw new SiteValidationError(`ZIP path traversal rejected in ${relativePath}: ${entryPath}`);
    }
    if (!entry.dir && forbiddenPathPatterns.some((pattern) => pattern.test(normalized))) {
      throw new SiteValidationError(`Forbidden file inside ZIP rejected in ${relativePath}: ${entryPath}`);
    }
    const permissions = typeof entry.unixPermissions === "string" ? Number.parseInt(entry.unixPermissions, 8) : Number(entry.unixPermissions || 0);
    if ((permissions & 0o170000) === 0o120000) throw new SiteValidationError(`Symlink inside ZIP rejected: ${relativePath}`);
    uncompressedBytes += Number(entry?._data?.uncompressedSize || 0);
    if (uncompressedBytes > 500 * 1024 * 1024) throw new SiteValidationError(`ZIP archive expands beyond the safety limit: ${relativePath}`);
  }
}

export async function assertSafeStagingPath(stagingDir, approvedRoot) {
  const staging = path.resolve(stagingDir);
  const approved = path.resolve(approvedRoot);
  if (!isPathInside(approved, staging)) {
    throw new SiteValidationError("Publish staging path must be inside the approved build area.");
  }
  if ((await fs.lstat(approved)).isSymbolicLink()) {
    throw new SiteValidationError("Approved build area must not be a symlink.");
  }
  const approvedReal = await fs.realpath(approved);
  const stagingReal = await fs.realpath(staging);
  if (!isPathInside(approvedReal, stagingReal)) {
    throw new SiteValidationError("Publish staging path resolves outside the approved build area.");
  }
}

export async function validateGeneratedSite(root, {
  approvedRoot,
  maxFiles = 20_000,
  maxTotalBytes = 500 * 1024 * 1024,
  maxFileBytes = 100 * 1024 * 1024
} = {}) {
  if (!await fs.pathExists(root)) throw new SiteValidationError("Generated output directory does not exist.");
  await assertSafeStagingPath(root, approvedRoot);

  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new SiteValidationError("Generated output root must be a real directory.");
  }
  if (!await fs.pathExists(path.join(root, "index.html"))) {
    throw new SiteValidationError("Generated output is missing index.html.");
  }

  let fileCount = 0;
  let totalBytes = 0;
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(root, fullPath).replaceAll("\\", "/");
      const stat = await fs.lstat(fullPath);
      if (stat.isSymbolicLink()) throw new SiteValidationError(`Symlink rejected: ${relative}`);
      if (stat.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!stat.isFile()) throw new SiteValidationError(`Special filesystem entry rejected: ${relative}`);
      if (forbiddenPathPatterns.some((pattern) => pattern.test(relative))) {
        throw new SiteValidationError(`Forbidden generated file rejected: ${relative}`);
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(extension)) throw new SiteValidationError(`Unexpected generated file type rejected: ${relative}`);
      fileCount += 1;
      totalBytes += stat.size;
      if (fileCount > maxFiles) throw new SiteValidationError(`Generated output exceeds the ${maxFiles} file limit.`);
      if (stat.size > maxFileBytes) throw new SiteValidationError(`Generated file exceeds the per-file limit: ${relative}`);
      if (totalBytes > maxTotalBytes) throw new SiteValidationError("Generated output exceeds the total size limit.");
      if (textExtensions.has(extension) && stat.size <= 5 * 1024 * 1024) {
        const content = await fs.readFile(fullPath, "utf8");
        if (sensitiveContentPatterns.some((pattern) => pattern.test(content))) {
          throw new SiteValidationError(`Sensitive material detected in generated file: ${relative}`);
        }
      }
      if (extension === ".zip") await validateZipArchive(fullPath, relative);
      files.push(relative);
    }
  }
  if (!fileCount) throw new SiteValidationError("Generated output is empty.");
  return { fileCount, totalBytes, files };
}
