const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.env.PUBLIC_SCAN_ROOT || "generated-site");
const configuredBasePath = process.env.PUBLIC_SCAN_BASE_PATH ?? "/preview";
const basePath = `/${String(configuredBasePath).replace(/^\/+|\/+$/g, "")}`.replace(/^\/$/, "");
const findings = [];

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile()) yield fullPath;
  }
}

function candidateExists(candidate) {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, "index.html"))) return true;
  if (!path.extname(candidate) && fs.existsSync(`${candidate}.html`)) return true;
  return false;
}

function checkReference(sourceFile, reference) {
  const value = String(reference || "").trim();
  if (!value || value.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return;
  const withoutSuffix = value.split(/[?#]/)[0];
  let pathname = withoutSuffix;
  try {
    pathname = decodeURIComponent(withoutSuffix);
  } catch {
    findings.push(`${path.relative(root, sourceFile)}: invalid URL encoding in ${value}`);
    return;
  }
  if (pathname.startsWith("/")) {
    if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) pathname = pathname.slice(basePath.length) || "/";
    const candidate = path.resolve(root, `.${pathname}`);
    if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) {
      findings.push(`${path.relative(root, sourceFile)}: path escapes output root: ${value}`);
    } else if (!candidateExists(candidate)) {
      findings.push(`${path.relative(root, sourceFile)}: missing ${value}`);
    }
    return;
  }
  const candidate = path.resolve(path.dirname(sourceFile), pathname);
  if (!candidate.startsWith(`${root}${path.sep}`) || !candidateExists(candidate)) {
    findings.push(`${path.relative(root, sourceFile)}: missing ${value}`);
  }
}

if (!fs.existsSync(root)) {
  console.error(`Static output does not exist: ${root}`);
  process.exit(1);
}

for (const file of walk(root)) {
  const extension = path.extname(file).toLowerCase();
  if (![".html", ".css"].includes(extension)) continue;
  const text = fs.readFileSync(file, "utf8");
  const expressions = extension === ".html"
    ? [/(?:href|src)\s*=\s*["']([^"']+)["']/gi]
    : [/url\(\s*["']?([^"')]+)["']?\s*\)/gi];
  for (const expression of expressions) {
    for (const match of text.matchAll(expression)) checkReference(file, match[1]);
  }
}

if (findings.length) {
  console.error("Static link check failed:");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log("Static link check passed.");
