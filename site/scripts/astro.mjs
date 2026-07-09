import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.ASTRO_TELEMETRY_DISABLED = "1";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, "..");
const binName = process.platform === "win32" ? "astro.cmd" : "astro";
const candidates = [
  path.resolve(siteDir, "node_modules", ".bin", binName),
  path.resolve(siteDir, "..", "node_modules", ".bin", binName)
];
const bin = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];

const child = spawn(bin, process.argv.slice(2), {
  cwd: siteDir,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
