const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.env.PUBLIC_SCAN_ROOT || "generated-site");
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
  { label: "Cloudflare API token env name", pattern: /CLOUDFLARE_API_TOKEN/ },
  { label: "obvious env secret name", pattern: /\b(?:DATABASE_PATH|COOKIE_SECURE|TRUST_PROXY|ADMIN_BASE_URL|TOKEN_SECRET|API_SECRET|PRIVATE_KEY)\b/ }
];

if (process.env.PUBLIC_SCAN_STATIC_ONLY === "true") {
  checks.push(
    { label: "private analytics API dependency", pattern: /\/api\/track\b/ },
    { label: "private contact API dependency", pattern: /\/api\/contact-submissions\b/ },
    { label: "Page Manager API route", pattern: /(?:["'(=:\s]|^)\/api\// },
    { label: "localhost reference", pattern: /\b(?:localhost|127\.0\.0\.1)\b/i },
    { label: "RFC1918 10/8 address", pattern: /\b10(?:\.\d{1,3}){3}\b/ },
    { label: "RFC1918 172.16/12 address", pattern: /\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b/ },
    { label: "RFC1918 192.168/16 address", pattern: /\b192\.168(?:\.\d{1,3}){2}\b/ },
    { label: "private Page Manager port", pattern: /(?::|%3A)(?:8040|4321)\b/i },
    { label: "local preview path", pattern: /\/preview\//i },
    { label: "Portainer reference", pattern: /\bPortainer\b/i },
    { label: "Docker reference", pattern: /\bDocker\b/i },
    { label: "Docker service hostname", pattern: /\b(?:https?:\/\/)?(?:admin|public-preview):\d+\b/i },
    { label: "container filesystem path", pattern: /(?:^|["'\s])\/app\/(?:data|uploads|generated-site|node_modules)\b/i },
    { label: "secret-file path", pattern: /\/run\/kairix-secrets\b/i },
    { label: "SQLite path", pattern: /(?:^|["'\s])[^"'\s]*\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm))?\b/i },
    { label: "Windows local filesystem path", pattern: /\b[A-Z]:\\(?:Users|projects|app)\\/i }
  );
}

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
