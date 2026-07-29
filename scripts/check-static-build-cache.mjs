import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { runProcess } from "../admin/src/services/processRunner.js";
import { verifyPublicFavicon } from "./check-public-favicon.mjs";

const repositoryRoot = path.resolve(".");
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-static-cache-check-"));
const readOnlyRoot = path.join(sandbox, "application");
const siteRoot = path.join(readOnlyRoot, "site");
const cacheDir = path.join(sandbox, "cache", "kairix-vite-site");
const outputDir = path.join(sandbox, "output");
const contentRoot = path.join(sandbox, "publish-job");
const contentPath = path.join(contentRoot, "input", "content.json");
const publicDir = path.join(sandbox, "public");

async function makeTreeReadOnly(target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(target)) {
      await makeTreeReadOnly(path.join(target, entry));
    }
    await fs.chmod(target, 0o555);
    return;
  }
  await fs.chmod(target, 0o444);
}

async function makeTreeWritable(target) {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await fs.chmod(target, 0o755);
    for (const entry of await fs.readdir(target)) {
      await makeTreeWritable(path.join(target, entry));
    }
    return;
  }
  await fs.chmod(target, 0o644);
}

try {
  await fs.copy(path.join(repositoryRoot, "site"), siteRoot, {
    filter: (source) => !/(?:^|[\\/])(?:node_modules|\.astro)(?:[\\/]|$)/.test(source)
  });
  await fs.symlink(
    path.join(repositoryRoot, "node_modules"),
    path.join(sandbox, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );
  await fs.outputJson(contentPath, {
    publicBaseUrl: "http://localhost:8080",
    siteBasePath: "/preview",
    runtimeApiEnabled: true,
    settings: {
      brandName: "Static cache verification",
      introText: "Explicit build input",
      theme: "clean-light"
    },
    categories: [],
    products: [],
    downloads: [],
    supportPacks: [],
    softwareBundles: []
  });
  await fs.ensureDir(publicDir);
  if (process.platform !== "win32") {
    await makeTreeReadOnly(readOnlyRoot);
    await fs.access(readOnlyRoot, fs.constants.R_OK | fs.constants.X_OK);
  }

  await runProcess(process.execPath, [path.join(siteRoot, "scripts", "astro.mjs"), "build"], {
    cwd: readOnlyRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ASTRO_WORK_DIR: sandbox,
      VITE_CACHE_DIR: cacheDir,
      ASTRO_OUT_DIR: outputDir,
      ASTRO_PUBLIC_DIR: publicDir,
      PUBLIC_BASE_URL: "http://localhost:8080",
      PUBLIC_SITE_BASE_PATH: "/preview",
      KAIRIX_CONTENT_ROOT: contentRoot,
      KAIRIX_CONTENT_PATH: contentPath,
      KAIRIX_USE_SAMPLE_CONTENT: "false"
    },
    timeoutMs: 120_000,
    maxOutputBytes: 256 * 1024
  });

  if (!await fs.pathExists(path.join(outputDir, "index.html"))) {
    throw new Error("Read-only-root static build did not produce index.html.");
  }
  if (!await fs.pathExists(cacheDir)) {
    throw new Error("Read-only-root static build did not prepare the temporary Vite cache.");
  }
  if (await fs.pathExists(path.join(readOnlyRoot, ".cache"))) {
    throw new Error("Static build created a cache under the read-only application root.");
  }
  if (await fs.pathExists(path.join(siteRoot, ".astro"))) {
    throw new Error("Static build wrote Astro working state under the read-only source tree.");
  }
  await verifyPublicFavicon(outputDir, "/preview", "");
  const rootMode = process.platform === "win32"
    ? "isolated-root static build passed; POSIX runs additionally enforce a read-only application root"
    : "read-only-root static build passed";
  console.log(`${rootMode} with cache ${cacheDir} and output ${outputDir}.`);
} finally {
  if (process.platform !== "win32" && await fs.pathExists(readOnlyRoot)) {
    await makeTreeWritable(readOnlyRoot).catch(() => {});
  }
  await fs.remove(sandbox);
}
