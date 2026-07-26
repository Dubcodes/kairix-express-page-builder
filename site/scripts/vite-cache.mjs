import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = path.resolve(siteDir, "..");

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveViteCacheDir(env = process.env, {
  temporaryDir = os.tmpdir(),
  applicationDir = projectDir
} = {}) {
  const configured = String(env.VITE_CACHE_DIR || "").trim();
  const cacheDir = configured
    ? path.resolve(applicationDir, configured)
    : path.join(path.resolve(temporaryDir), "kairix-vite-site");

  if (!isPathInside(temporaryDir, cacheDir)) {
    throw new Error("VITE_CACHE_DIR must resolve inside the operating-system temporary directory.");
  }
  return cacheDir;
}

export async function prepareViteCacheDir(options = {}) {
  const cacheDir = resolveViteCacheDir(options.env || process.env, options);
  await fs.mkdir(cacheDir, { recursive: true });
  const stat = await fs.lstat(cacheDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("VITE_CACHE_DIR must be a real writable directory.");
  }

  for (const entry of await fs.readdir(cacheDir, { withFileTypes: true })) {
    if (entry.name.startsWith("deps_temp_")) {
      await fs.rm(path.join(cacheDir, entry.name), { recursive: true, force: true });
    }
  }

  const probe = path.join(cacheDir, `.kairix-write-${process.pid}-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(probe, "ok", { flag: "wx" });
  } finally {
    await fs.rm(probe, { force: true });
  }
  return cacheDir;
}
