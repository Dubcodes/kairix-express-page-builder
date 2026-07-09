import path from "node:path";
import { spawn } from "node:child_process";
import fs from "fs-extra";
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

export async function publishSite(userId = null) {
  const deployProvider = new LocalDeployProvider();
  try {
    const data = await buildExportData();
    const dataPath = path.join(config.projectRoot, "site", "src", "data", "content.json");
    const publicUploadsDir = path.join(config.projectRoot, "site", "public", "uploads");
    await fs.ensureDir(path.dirname(dataPath));
    await fs.writeJson(dataPath, data, { spaces: 2 });
    await storageProvider.copyToPublic(publicUploadsDir);
    await fs.emptyDir(config.generatedSiteDir);
    const output = await run("npm", ["run", "build", "--workspace", "site"]);
    const result = await deployProvider.deploy();
    db.prepare("INSERT INTO publish_events (status, message, created_by) VALUES (?, ?, ?)").run("success", output.slice(-2000), userId);
    return { ok: true, ...result, output };
  } catch (error) {
    db.prepare("INSERT INTO publish_events (status, message, created_by) VALUES (?, ?, ?)").run("failure", String(error.message || error).slice(0, 4000), userId);
    throw error;
  }
}
