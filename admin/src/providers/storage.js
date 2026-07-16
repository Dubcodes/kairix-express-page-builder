import fs from "fs-extra";
import path from "node:path";
import { config } from "../config.js";

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

  async copyToPublic(publicUploadsDir) {
    const pending = [this.root];
    while (pending.length) {
      const directory = pending.pop();
      const directoryStat = await fs.lstat(directory);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error("Uploads root must be a real directory.");
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        const stat = await fs.lstat(entryPath);
        if (stat.isSymbolicLink()) throw new Error(`Upload symlink rejected: ${path.relative(this.root, entryPath)}`);
        if (stat.isDirectory()) pending.push(entryPath);
        else if (!stat.isFile()) throw new Error(`Special upload entry rejected: ${path.relative(this.root, entryPath)}`);
      }
    }
    await fs.emptyDir(publicUploadsDir);
    await fs.copy(this.root, publicUploadsDir, {
      filter: (src) => !src.endsWith(".gitkeep")
    });
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
