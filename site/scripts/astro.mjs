import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import { prepareViteCacheDir } from "./vite-cache.mjs";

process.env.ASTRO_TELEMETRY_DISABLED = "1";
process.env.VITE_CACHE_DIR = await prepareViteCacheDir();

const require = createRequire(import.meta.url);
const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workDir = process.env.ASTRO_WORK_DIR
  ? path.resolve(process.env.ASTRO_WORK_DIR)
  : siteDir;
await fs.promises.mkdir(workDir, { recursive: true });
const astroPackagePath = require.resolve("astro/package.json");
const astroPackage = JSON.parse(fs.readFileSync(astroPackagePath, "utf8"));
const astroCliPath = path.resolve(path.dirname(astroPackagePath), astroPackage.bin.astro);
const astroArgs = [astroCliPath, ...process.argv.slice(2)];
let proxyConfigPath = null;
if (workDir !== siteDir) {
  proxyConfigPath = path.join(
    workDir,
    `.kairix-astro-${process.pid}-${crypto.randomUUID()}.config.mjs`
  );
  await fs.promises.writeFile(
    proxyConfigPath,
    `export { default } from ${JSON.stringify(pathToFileURL(path.join(siteDir, "astro.config.mjs")).href)};\n`,
    { flag: "wx" }
  );
  astroArgs.push("--config", path.basename(proxyConfigPath));
}

const child = spawn(process.execPath, astroArgs, {
  cwd: workDir,
  stdio: "inherit",
  env: process.env,
  shell: false,
  windowsHide: true
});

child.on("exit", (code, signal) => {
  if (proxyConfigPath) fs.rmSync(proxyConfigPath, { force: true });
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
