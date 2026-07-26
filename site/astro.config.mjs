import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveViteCacheDir } from "./scripts/vite-cache.mjs";

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const buildRoot = process.env.ASTRO_WORK_DIR
  ? path.resolve(process.env.ASTRO_WORK_DIR)
  : sourceRoot;

export default defineConfig({
  root: buildRoot,
  srcDir: path.join(sourceRoot, "src"),
  publicDir: path.join(sourceRoot, "public"),
  output: "static",
  outDir: process.env.ASTRO_OUT_DIR
    ? path.resolve(process.env.ASTRO_OUT_DIR)
    : path.resolve(sourceRoot, "../generated-site"),
  site: process.env.PUBLIC_BASE_URL || "http://localhost:4321",
  base: process.env.PUBLIC_SITE_BASE_PATH ?? "/preview",
  integrations: [sitemap()],
  vite: {
    cacheDir: resolveViteCacheDir()
  }
});
