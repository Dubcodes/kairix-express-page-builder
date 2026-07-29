import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const adminPackage = JSON.parse(fs.readFileSync(path.join(root, "admin", "package.json"), "utf8"));
const sitePackage = JSON.parse(fs.readFileSync(path.join(root, "site", "package.json"), "utf8"));
const logicalLines = dockerfile
  .replace(/\\\r?\n\s*/g, " ")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

function copyOperands(line) {
  const tokens = line.split(/\s+/);
  if (tokens[0]?.toUpperCase() !== "COPY") return null;
  const operands = tokens.slice(1).filter((token) => !token.startsWith("--"));
  return operands.length === 2 ? operands : null;
}

const dependencyCopies = logicalLines
  .map((line, index) => ({ line, index, operands: copyOperands(line) }))
  .filter(({ line, operands }) => operands && /(?:^|\s)--from=dependencies(?:\s|$)/.test(line));
const appCopy = dependencyCopies.find(({ operands }) => {
  const [source, destination] = operands.map((value) => value.replace(/\/+$/, ""));
  return source === "/app" && destination === "/app";
});

if (!appCopy) {
  throw new Error("Dockerfile must copy the complete dependency-stage /app workspace layout into runtime /app.");
}

const optionalNestedCopy = dependencyCopies.find(({ operands }) =>
  /^\/app\/(?:admin|site)\/node_modules\/?$/i.test(operands[0])
);
if (optionalNestedCopy) {
  throw new Error(`Dockerfile must not require an optional nested workspace dependency directory: ${optionalNestedCopy.line}`);
}

const sourceCopy = logicalLines
  .map((line, index) => ({ index, operands: copyOperands(line) }))
  .find(({ operands }) => operands?.[0] === "." && operands?.[1] === ".");
if (!sourceCopy || sourceCopy.index <= appCopy.index) {
  throw new Error("Application source must be copied after the dependency-stage workspace layout.");
}

if (!/npm ci\s+--omit=dev\b/.test(dockerfile.replace(/\\\r?\n\s*/g, " "))) {
  throw new Error("Docker dependency stage must install production dependencies with npm ci --omit=dev.");
}
if (!logicalLines.some((line) => /^USER\s+node$/i.test(line))) {
  throw new Error("Docker runtime stage must retain non-root USER node.");
}
if (!logicalLines.some((line) => /^ENV\s+VITE_CACHE_DIR=\/tmp\/kairix-vite-site$/i.test(line))) {
  throw new Error("Docker runtime must place the production Vite cache under /tmp.");
}
if (!logicalLines.some((line) => /^ENV\s+XDG_CONFIG_HOME=\/tmp\/kairix-wrangler\/config$/i.test(line))) {
  throw new Error("Docker runtime must place Wrangler configuration under /tmp.");
}
if (!logicalLines.some((line) => /^ENV\s+XDG_CACHE_HOME=\/tmp\/kairix-wrangler\/cache$/i.test(line))) {
  throw new Error("Docker runtime must place Wrangler cache files under /tmp.");
}
if (!/VITE_CACHE_DIR:\s*\$\{VITE_CACHE_DIR:-\/tmp\/kairix-vite-site\}/.test(compose)) {
  throw new Error("Compose must default VITE_CACHE_DIR to the ephemeral /tmp cache.");
}
if (!/XDG_CONFIG_HOME:\s*\$\{XDG_CONFIG_HOME:-\/tmp\/kairix-wrangler\/config\}/.test(compose)) {
  throw new Error("Compose must default Wrangler configuration to /tmp.");
}
if (!/XDG_CACHE_HOME:\s*\$\{XDG_CACHE_HOME:-\/tmp\/kairix-wrangler\/cache\}/.test(compose)) {
  throw new Error("Compose must default Wrangler cache files to /tmp.");
}
if (!/\/tmp:uid=1000,gid=1000,mode=1777/.test(compose)) {
  throw new Error("Compose must retain the node-writable /tmp tmpfs.");
}
if (!/^\d+\.\d+\.\d+$/.test(String(adminPackage.dependencies?.wrangler || ""))) {
  throw new Error("Wrangler must remain an exact-pinned runtime dependency.");
}
if (!sitePackage.dependencies?.astro) {
  throw new Error("Astro must remain a site runtime dependency available to the publish build.");
}

console.log("Docker workspace dependency transfer check passed.");
