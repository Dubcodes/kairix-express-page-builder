import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  output: "static",
  outDir: "../generated-site",
  site: process.env.PUBLIC_BASE_URL || "http://localhost:4321",
  base: process.env.PUBLIC_SITE_BASE_PATH ?? "/preview",
  integrations: [sitemap()],
  vite: {
    cacheDir: "../.cache/vite-site"
  }
});
