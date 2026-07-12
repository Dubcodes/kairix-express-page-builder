import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "fs-extra";
import slugify from "slugify";
import JSZip from "jszip";
import { config } from "../config.js";
import { db } from "../db.js";
import { buildExportData } from "./exportData.js";
import { storageProvider } from "../providers/storage.js";
import { LocalDeployProvider } from "../providers/deploy.js";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: config.projectRoot,
      shell: process.platform === "win32",
      env: process.env,
      ...options
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output || `${command} exited with code ${code}`));
    });
  });
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function summarizeBuildOutput(output) {
  const clean = stripAnsi(output);
  const pagesMatch = clean.match(/(\d+)\s+page\(s\)\s+built(?:\s+in\s+([0-9.]+(?:ms|s)))?/i);
  const parts = ["Static site published"];
  if (pagesMatch?.[1]) parts.push(`${pagesMatch[1]} page(s) built`);
  if (pagesMatch?.[2]) parts.push(`duration ${pagesMatch[2]}`);
  return parts.join(" - ");
}

function assertSafeBuildDir() {
  const buildDir = path.resolve(config.generatedSiteBuildDir);
  const projectRoot = path.resolve(config.projectRoot);
  const generatedDir = path.resolve(config.generatedSiteDir);
  if (buildDir === projectRoot || buildDir === generatedDir || !path.relative(projectRoot, buildDir) || path.relative(projectRoot, buildDir).startsWith("..")) {
    throw new Error("PUBLIC_BUILD_TEMP_DIR must be a safe temporary directory inside the project and separate from GENERATED_SITE_DIR.");
  }
}

async function hashFile(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function generateSoftwareBundleZips() {
  const bundles = db.prepare("SELECT * FROM support_packs WHERE archived = 0 AND auto_generate_zip = 1 ORDER BY sort_order, name").all();
  const generated = [];
  for (const bundle of bundles) {
    const latestLocalFiles = db.prepare(`
      SELECT d.name AS download_name, v.version_number, f.*
      FROM support_pack_downloads spd
      JOIN download_objects d ON d.id = spd.download_id
      JOIN download_versions v ON v.download_id = d.id
      JOIN files f ON f.id = v.file_id
      WHERE spd.support_pack_id = ? AND d.archived = 0
      ORDER BY v.is_latest DESC, date(v.release_date) DESC, v.id DESC
    `).all(bundle.id);
    const uniqueByDownload = new Map();
    for (const file of latestLocalFiles) {
      if (!uniqueByDownload.has(file.download_name)) uniqueByDownload.set(file.download_name, file);
    }
    const files = [...uniqueByDownload.values()].filter((file) => file.path && fs.existsSync(file.path));
    if (!files.length) {
      db.prepare("UPDATE support_packs SET bundle_file_id = NULL WHERE id = ?").run(bundle.id);
      continue;
    }

    const zip = new JSZip();
    for (const file of files) {
      const safeName = `${slugify(file.download_name, { lower: true, strict: true }) || "download"}-${file.version_number || "latest"}-${file.original_name}`;
      zip.file(safeName, await fs.readFile(file.path));
    }
    zip.file("README.txt", `Demo Software Bundle: ${bundle.name}\nGenerated: ${new Date().toISOString()}\nExternal app store or marketplace links are listed on the public page and are not included inside this ZIP.\n`);

    const storedName = `bundles/${slugify(bundle.name, { lower: true, strict: true }) || "software-bundle"}-latest.zip`;
    const outputPath = path.join(config.uploadsDir, storedName);
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    const size = (await fs.stat(outputPath)).size;
    const contentHash = await hashFile(outputPath);
    const existing = db.prepare("SELECT * FROM files WHERE stored_name = ?").get(storedName);
    const fileId = existing
      ? existing.id
      : db.prepare("INSERT INTO files (original_name, stored_name, path, mime_type, size, content_hash) VALUES (?, ?, ?, ?, ?, ?)")
        .run(`${bundle.name} latest.zip`, storedName, outputPath, "application/zip", size, contentHash).lastInsertRowid;
    if (existing) {
      db.prepare("UPDATE files SET original_name = ?, path = ?, mime_type = ?, size = ?, content_hash = ? WHERE id = ?")
        .run(`${bundle.name} latest.zip`, outputPath, "application/zip", size, contentHash, existing.id);
    }
    db.prepare("UPDATE support_packs SET bundle_file_id = ? WHERE id = ?").run(fileId, bundle.id);
    generated.push({ id: bundle.id, name: bundle.name, fileId });
  }
  return generated;
}

export async function publishSite(userId = null) {
  const deployProvider = new LocalDeployProvider();
  try {
    assertSafeBuildDir();
    const generatedBundles = await generateSoftwareBundleZips();
    const data = await buildExportData();
    const dataPath = path.join(config.projectRoot, "site", "src", "data", "content.json");
    const publicUploadsDir = path.join(config.projectRoot, "site", "public", "uploads");
    await fs.ensureDir(path.dirname(dataPath));
    await fs.writeJson(dataPath, data, { spaces: 2 });
    await storageProvider.copyToPublic(publicUploadsDir);
    await fs.ensureDir(config.generatedSiteBuildDir);
    await fs.emptyDir(config.generatedSiteBuildDir);
    const output = await run("npm", ["run", "build", "--workspace", "site"], {
      env: {
        ...process.env,
        ASTRO_OUT_DIR: config.generatedSiteBuildDir
      }
    });
    await fs.emptyDir(config.generatedSiteDir);
    await fs.copy(config.generatedSiteBuildDir, config.generatedSiteDir);
    const result = await deployProvider.deploy();
    db.prepare("INSERT INTO publish_events (status, message, created_by) VALUES (?, ?, ?)").run("success", summarizeBuildOutput(output), userId);
    return { ok: true, ...result, output, generatedBundles };
  } catch (error) {
    db.prepare("INSERT INTO publish_events (status, message, created_by) VALUES (?, ?, ?)").run("failure", String(error.message || error).slice(0, 4000), userId);
    throw error;
  }
}
