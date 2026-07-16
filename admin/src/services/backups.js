import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { config } from "../config.js";
import { db, getSettings } from "../db.js";

function backupFilename(kind = "manual") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `kairix-${kind}-${stamp}-${crypto.randomBytes(3).toString("hex")}.zip`;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function createBackup({ kind = "manual", createdBy = null } = {}) {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const filename = backupFilename(kind);
  const filepath = path.join(config.backupsDir, filename);
  const temporaryDatabase = path.join(config.backupsDir, `.backup-${crypto.randomUUID()}.sqlite`);
  const temporaryArchive = `${filepath}.${crypto.randomUUID()}.tmp`;
  let committed = false;
  try {
    await db.backup(temporaryDatabase);
    const databaseBuffer = await fs.promises.readFile(temporaryDatabase);
    const manifest = {
      app: "Kairix Express Page Builder",
      formatVersion: 2,
      kind,
      createdAt: new Date().toISOString(),
      contents: ["manifest.json", "settings.json", "database.sqlite"],
      databaseSha256: sha256(databaseBuffer)
    };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("settings.json", JSON.stringify(getSettings(), null, 2));
    zip.file("database.sqlite", databaseBuffer);
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await fs.promises.writeFile(temporaryArchive, buffer, { flag: "wx" });
    await fs.promises.rename(temporaryArchive, filepath);
    const size = (await fs.promises.stat(filepath)).size;
    db.prepare("INSERT INTO backup_snapshots (filename, kind, manifest_json, size, created_by) VALUES (?, ?, ?, ?, ?)")
      .run(filename, kind, JSON.stringify(manifest), size, createdBy);
    committed = true;
    return { filename, filepath, size, manifest };
  } finally {
    await Promise.all([
      fs.promises.rm(temporaryDatabase, { force: true }),
      fs.promises.rm(temporaryArchive, { force: true }),
      committed ? Promise.resolve() : fs.promises.rm(filepath, { force: true })
    ]);
  }
}

export function listBackups() {
  return db.prepare("SELECT id, filename, kind, size, created_at FROM backup_snapshots ORDER BY created_at DESC LIMIT 50").all();
}

export async function inspectBackup(filename) {
  const safeName = path.basename(filename);
  if (safeName !== filename || !/^kairix-[a-z0-9_-]+-[a-z0-9TZ.-]+\.zip$/i.test(safeName)) {
    const error = new Error("Invalid backup filename");
    error.statusCode = 400;
    throw error;
  }
  const filepath = path.join(config.backupsDir, safeName);
  if (!fs.existsSync(filepath)) {
    const error = new Error("Backup not found");
    error.statusCode = 404;
    throw error;
  }
  const stat = await fs.promises.stat(filepath);
  if (!stat.isFile() || stat.size > 1024 * 1024 * 1024) throw new Error("Backup is not a valid archive file");
  const zip = await JSZip.loadAsync(await fs.promises.readFile(filepath), { checkCRC32: true });
  const manifestFile = zip.file("manifest.json");
  const databaseFile = zip.file("database.sqlite");
  if (!manifestFile || !databaseFile) throw new Error("Backup is missing its manifest or database snapshot");
  const manifest = JSON.parse(await manifestFile.async("string"));
  if (manifest.app !== "Kairix Express Page Builder") throw new Error("Backup manifest belongs to a different application");
  let integrity = "legacy-unverified";
  if (manifest.databaseSha256) {
    const databaseBuffer = await databaseFile.async("nodebuffer");
    if (sha256(databaseBuffer) !== manifest.databaseSha256) throw new Error("Backup database integrity check failed");
    integrity = "verified";
  }
  return {
    filename: safeName,
    manifest,
    integrity,
    entries: Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  };
}
