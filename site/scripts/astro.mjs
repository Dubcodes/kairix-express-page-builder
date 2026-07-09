import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.ASTRO_TELEMETRY_DISABLED = "1";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, "..");
const bin = process.platform === "win32"
  ? path.resolve(siteDir, "..", "node_modules", ".bin", "astro.cmd")
  : path.resolve(siteDir, "..", "node_modules", ".bin", "astro");

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
