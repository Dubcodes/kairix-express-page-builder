import fs from "fs-extra";
import path from "node:path";
import { config } from "../config.js";

const temporarySuffixPattern = /\.(?:tmp|temp|part|swp|bak)$/i;
const filesystemMetadataNames = new Set(["thumbs.db", "ehthumbs.db", "desktop.ini"]);

export function isSafeManagedUploadPath(storedName) {
  const value = String(storedName || "");
  if (!value || value.startsWith("/") || value.endsWith("/") || value.includes("\\") || value.includes("//")) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  const segments = value.split("/");
  if (segments.some((segment) => (
    !segment
    || segment === "."
    || segment === ".."
    || segment.startsWith(".")
    || segment.endsWith("~")
    || temporarySuffixPattern.test(segment)
    || filesystemMetadataNames.has(segment.toLowerCase())
  ))) return false;
  return true;
}

async function inspectManagedFile(root, storedName) {
  const segments = storedName.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") return { missing: true };
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Managed upload symlink rejected: ${storedName}`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Managed upload path component is not a directory: ${storedName}`);
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      throw new Error(`Managed upload is not a regular file: ${storedName}`);
    }
  }
  return { sourcePath: current };
}

async function inventoryUnmanagedEntries(root, managedNames) {
  const summary = { excludedUnmanagedFiles: 0, excludedUnsafeEntries: 0, unreadableDirectories: 0 };
  const pending = [{ directory: root, relativeDirectory: "" }];
  while (pending.length) {
    const { directory, relativeDirectory } = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      summary.unreadableDirectories += 1;
      continue;
    }
    for (const entry of entries) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.name === ".gitkeep") continue;
      const fullPath = path.join(directory, entry.name);
      let stat;
      try {
        stat = await fs.lstat(fullPath);
      } catch {
        summary.excludedUnsafeEntries += 1;
        continue;
      }
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        summary.excludedUnsafeEntries += 1;
      } else if (stat.isDirectory()) {
        if (isSafeManagedUploadPath(`${relative}/placeholder`)) {
          pending.push({ directory: fullPath, relativeDirectory: relative });
        } else {
          summary.excludedUnsafeEntries += 1;
        }
      } else if (!isSafeManagedUploadPath(relative)) {
        summary.excludedUnsafeEntries += 1;
      } else if (!managedNames.has(relative)) {
        summary.excludedUnmanagedFiles += 1;
      }
    }
  }
  return summary;
}

export class LocalStorageProvider {
  constructor(root = config.uploadsDir) {
    this.root = root;
  }

  async ensureReady() {
    await fs.ensureDir(this.root);
  }

  publicPath(storedName) {
    return `/uploads/${storedName}`;
  }

  async copyToPublic(publicUploadsDir, fileRecords) {
    if (!Array.isArray(fileRecords)) throw new TypeError("Managed file records are required for public upload export.");
    await this.ensureReady();
    const rootStat = await fs.lstat(this.root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Uploads root must be a real directory.");

    const managedNames = new Set();
    let invalidRecords = 0;
    for (const record of fileRecords) {
      if (!isSafeManagedUploadPath(record?.stored_name)) {
        invalidRecords += 1;
        continue;
      }
      managedNames.add(record.stored_name);
    }

    const sources = [];
    let missingRecords = 0;
    for (const storedName of managedNames) {
      const inspected = await inspectManagedFile(this.root, storedName);
      if (inspected.missing) {
        missingRecords += 1;
        continue;
      }
      sources.push({ storedName, sourcePath: inspected.sourcePath });
    }

    const inventory = await inventoryUnmanagedEntries(this.root, managedNames);
    await fs.emptyDir(publicUploadsDir);
    for (const source of sources) {
      const destination = path.join(publicUploadsDir, ...source.storedName.split("/"));
      await fs.ensureDir(path.dirname(destination));
      await fs.copyFile(source.sourcePath, destination);
    }
    return {
      copiedFiles: sources.length,
      managedRecords: managedNames.size,
      invalidRecords,
      missingRecords,
      ...inventory
    };
  }
}

export class R2StorageProvider {
  constructor() {
    this.name = "Cloudflare R2";
  }

  async ensureReady() {
    throw new Error("R2StorageProvider is a v2 placeholder. Configure Cloudflare R2 before enabling.");
  }
}

export const storageProvider = new LocalStorageProvider();

export function toRelativeUploadPath(filePath) {
  return path.relative(config.uploadsDir, filePath).replaceAll("\\", "/");
}
