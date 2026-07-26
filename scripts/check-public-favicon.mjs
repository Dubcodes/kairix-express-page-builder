import path from "node:path";
import fs from "fs-extra";
import { fileURLToPath } from "node:url";

function normalizedBasePath(value) {
  const cleaned = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  return cleaned ? `/${cleaned}` : "";
}

function linkAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/\b([a-z-]+)\s*=\s*(["'])(.*?)\2/gi)]
      .map((match) => [match[1].toLowerCase(), match[3]])
  );
}

export async function verifyPublicFavicon(outputRoot, basePath = "") {
  const root = path.resolve(outputRoot);
  const faviconPath = path.join(root, "favicon.svg");
  if (!await fs.pathExists(faviconPath) || !(await fs.stat(faviconPath)).isFile()) {
    throw new Error(`Generated public favicon is missing: ${faviconPath}`);
  }
  const expectedHref = `${normalizedBasePath(basePath)}/favicon.svg`;
  const htmlFiles = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) htmlFiles.push(fullPath);
    }
  }
  if (!htmlFiles.length) throw new Error(`Generated public output has no HTML pages: ${root}`);
  for (const htmlFile of htmlFiles) {
    const html = await fs.readFile(htmlFile, "utf8");
    const iconLinks = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((match) => linkAttributes(match[0]))
      .filter((attributes) => String(attributes.rel || "").split(/\s+/).includes("icon"));
    if (!iconLinks.some((attributes) => attributes.href === expectedHref)) {
      throw new Error(`Generated page has no favicon link to ${expectedHref}: ${path.relative(root, htmlFile)}`);
    }
  }
  return { faviconPath, href: expectedHref, pageCount: htmlFiles.length };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [root = "generated-site", basePath = "/preview"] = process.argv.slice(2);
  const result = await verifyPublicFavicon(root, basePath);
  console.log(`Public favicon check passed for ${result.pageCount} page(s) at ${result.href}.`);
}
