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
