const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve("generated-site");
const textExtensions = new Set([".html", ".js", ".css", ".json", ".xml", ".txt", ".svg"]);
const checks = [
  { label: "adminBaseUrl", pattern: /adminBaseUrl/ },
  { label: "adminBase_url", pattern: /adminBase_url/ },
  { label: "admin-base-url", pattern: /admin-base-url/ },
  { label: "Page Manager", pattern: /Page Manager/ },
  { label: "Buy Me a Coffee", pattern: /Buy Me a Coffee/i },
  { label: "buymeacoffee", pattern: /buymeacoffee/i },
  { label: "/api/users", pattern: /\/api\/users\b/ },
  { label: "/api/invites", pattern: /\/api\/invites\b/ },
  { label: "/api/backups", pattern: /\/api\/backups\b/ },
  { label: "/api/audit-events", pattern: /\/api\/audit-events\b/ },
  { label: "kairix_session", pattern: /kairix_session/ },
  { label: "kairix_csrf", pattern: /kairix_csrf/ },
  { label: "SESSION_SECRET", pattern: /SESSION_SECRET/ },
  { label: "ENCRYPTION_SECRET", pattern: /ENCRYPTION_SECRET/ },
  { label: "ALIEXPRESS secret/env name", pattern: /ALIEXPRESS_[A-Z_]+/ },
  { label: "obvious env secret name", pattern: /\b(?:DATABASE_PATH|COOKIE_SECURE|TRUST_PROXY|ADMIN_BASE_URL|TOKEN_SECRET|API_SECRET|PRIVATE_KEY)\b/ }
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else yield fullPath;
  }
}

if (!fs.existsSync(root)) {
  console.log("generated-site does not exist; run npm run check or publish first.");
  process.exit(0);
}

const findings = [];
for (const file of walk(root)) {
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const check of checks) {
    if (check.pattern.test(text)) findings.push(`${path.relative(root, file)}: ${check.label}`);
  }
}

if (findings.length) {
  console.error("Public output scan failed:");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log("Public output scan passed.");
