import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { config } from "../config.js";
import { db, getSettings } from "../db.js";

function backupFilename(kind = "manual") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `kairix-${kind}-${stamp}.zip`;
}

export async function createBackup({ kind = "manual", createdBy = null } = {}) {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const filename = backupFilename(kind);
  const filepath = path.join(config.backupsDir, filename);
  const manifest = {
    app: "Kairix Express Page Builder",
    kind,
    createdAt: new Date().toISOString(),
    contents: ["manifest.json", "settings.json", "database.sqlite"]
  };
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("settings.json", JSON.stringify(getSettings(), null, 2));
  if (fs.existsSync(config.databasePath)) {
    zip.file("database.sqlite", fs.readFileSync(config.databasePath));
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(filepath, buffer);
  const size = fs.statSync(filepath).size;
  db.prepare("INSERT INTO backup_snapshots (filename, kind, manifest_json, size, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(filename, kind, JSON.stringify(manifest), size, createdBy);
  return { filename, filepath, size, manifest };
}

export function listBackups() {
  return db.prepare("SELECT id, filename, kind, size, created_at FROM backup_snapshots ORDER BY created_at DESC LIMIT 50").all();
}

export async function inspectBackup(filename) {
  const safeName = path.basename(filename);
  const filepath = path.join(config.backupsDir, safeName);
  if (!fs.existsSync(filepath)) {
    const error = new Error("Backup not found");
    error.status = 404;
    throw error;
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(filepath));
  const manifest = zip.file("manifest.json") ? JSON.parse(await zip.file("manifest.json").async("string")) : {};
  return {
    filename: safeName,
    manifest,
    entries: Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  };
}
