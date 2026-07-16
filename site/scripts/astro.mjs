import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

process.env.ASTRO_TELEMETRY_DISABLED = "1";

const require = createRequire(import.meta.url);
const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const astroPackagePath = require.resolve("astro/package.json");
const astroPackage = JSON.parse(fs.readFileSync(astroPackagePath, "utf8"));
const astroCliPath = path.resolve(path.dirname(astroPackagePath), astroPackage.bin.astro);

const child = spawn(process.execPath, [astroCliPath, ...process.argv.slice(2)], {
  cwd: siteDir,
  stdio: "inherit",
  env: process.env,
  shell: false,
  windowsHide: true
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
