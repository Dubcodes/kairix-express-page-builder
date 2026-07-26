import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { prepareViteCacheDir, resolveViteCacheDir } from "../../site/scripts/vite-cache.mjs";

test("Vite cache defaults to the operating-system temporary directory", () => {
  const applicationDir = path.resolve("read-only-application");
  const cacheDir = resolveViteCacheDir({ NODE_ENV: "production" }, { applicationDir });
  assert.equal(cacheDir, path.join(path.resolve(os.tmpdir()), "kairix-vite-site"));
  assert.equal(cacheDir.startsWith(path.join(applicationDir, ".cache")), false);
});

test("Vite cache rejects configured paths outside the temporary directory", () => {
  const applicationDir = path.resolve("application-root");
  assert.throws(
    () => resolveViteCacheDir(
      { NODE_ENV: "production", VITE_CACHE_DIR: path.join(applicationDir, ".cache", "vite-site") },
      { applicationDir }
    ),
    /temporary directory/
  );
});

test("Vite cache preparation is writable and removes only stale Vite temp entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-vite-cache-test-"));
  const cacheDir = path.join(root, "kairix-vite-site");
  try {
    await fs.ensureDir(path.join(cacheDir, "deps_temp_stale"));
    await fs.outputFile(path.join(cacheDir, "keep", "marker.txt"), "keep");
    const prepared = await prepareViteCacheDir({
      env: { NODE_ENV: "production", VITE_CACHE_DIR: cacheDir },
      temporaryDir: root,
      applicationDir: path.join(root, "application")
    });
    assert.equal(prepared, cacheDir);
    assert.equal(await fs.pathExists(path.join(cacheDir, "deps_temp_stale")), false);
    assert.equal(await fs.readFile(path.join(cacheDir, "keep", "marker.txt"), "utf8"), "keep");
    await fs.outputFile(path.join(cacheDir, "write-check.txt"), "ok");
  } finally {
    await fs.remove(root);
  }
});
