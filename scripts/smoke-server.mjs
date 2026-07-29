import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import Database from "better-sqlite3";

const projectRoot = path.resolve(".");
const smokeRoot = path.join(projectRoot, ".cache", `server-smoke-${crypto.randomUUID()}`);
const port = 8091;
const origin = `http://127.0.0.1:${port}`;
const publicOrigin = "https://manager.example.test";
const proxyHeaders = {
  Host: "manager.example.test",
  "X-Forwarded-Host": "manager.example.test",
  "X-Forwarded-Proto": "https",
  "X-Forwarded-For": "203.0.113.9"
};
await fs.ensureDir(smokeRoot);

const child = spawn(process.execPath, [path.join(projectRoot, "admin", "src", "server.js")], {
  cwd: projectRoot,
  shell: false,
  windowsHide: true,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    DATABASE_PATH: path.join(smokeRoot, "kairix.sqlite"),
    UPLOADS_DIR: path.join(smokeRoot, "uploads"),
    GENERATED_SITE_DIR: path.join(smokeRoot, "generated-site"),
    PUBLIC_BUILD_TEMP_DIR: path.join(smokeRoot, "publish-staging"),
    BACKUPS_DIR: path.join(smokeRoot, "backups"),
    DEPLOY_PROVIDER: "local",
    PUBLIC_BASE_URL: publicOrigin,
    PUBLIC_SITE_BASE_PATH: "/preview",
    ADMIN_BASE_URL: publicOrigin,
    ADMIN_HOSTNAME: "manager.example.test",
    ADMIN_BIND_IP: "127.0.0.1",
    PREVIEW_BIND_IP: "127.0.0.1",
    TRUST_PROXY: "true",
    COOKIE_SECURE: "true",
    SESSION_SECRET: "server-smoke-session-secret-000000000000000000",
    ENCRYPTION_SECRET: "server-smoke-encryption-secret-111111111111111",
    ENABLE_SAMPLE_DATA_TOOLS: "false"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let logs = "";
const capture = (chunk) => { logs = (logs + chunk.toString()).slice(-32_768); };
child.stdout.on("data", capture);
child.stderr.on("data", capture);

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Temporary server did not become healthy.");
}

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
    headers: { ...proxyHeaders, ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${body.error || "unknown error"}`);
  return { response, body };
}

try {
  await waitForServer();
  const adminDocument = await fetch(origin, { headers: proxyHeaders });
  if (adminDocument.headers.get("cache-control") !== "no-store") throw new Error("Admin document is missing no-store.");
  if (!String(adminDocument.headers.get("content-security-policy") || "").includes("frame-ancestors 'none'")) {
    throw new Error("Admin document is missing strict CSP.");
  }
  const wrongHost = await fetch(`${origin}/api/me`, { headers: { Host: "attacker.example" } });
  if (wrongHost.status !== 421) throw new Error("Unexpected Host header was not rejected.");
  await jsonRequest("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: publicOrigin },
    body: JSON.stringify({ brandName: "Smoke Test", marketplaceUrl: "", username: "smoke-admin", email: "", password: "smoke-test-password" })
  });
  const login = await jsonRequest("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: publicOrigin },
    body: JSON.stringify({ username: "smoke-admin", password: "smoke-test-password" })
  });
  const sessionCookie = login.response.headers.getSetCookie().find((value) => value.startsWith("kairix_session=")) || "";
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax"]) {
    if (!sessionCookie.includes(attribute)) throw new Error(`Session cookie is missing ${attribute}.`);
  }
  const cookies = login.response.headers.getSetCookie().map((value) => value.split(";", 1)[0]);
  const cookieHeader = cookies.join("; ");
  const me = await jsonRequest("/api/me", { headers: { Cookie: cookieHeader } });
  const authenticatedHeaders = {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    "X-CSRF-Token": me.body.csrfToken,
    Origin: publicOrigin
  };
  const uploadForm = new FormData();
  uploadForm.append("files", new Blob(["safe smoke upload"], { type: "text/plain" }), "smoke.txt");
  const uploaded = await jsonRequest("/api/files/upload", {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "X-CSRF-Token": me.body.csrfToken,
      Origin: publicOrigin
    },
    body: uploadForm
  });
  if (uploaded.body.files?.length !== 1) throw new Error("Authenticated upload smoke failed.");
  const rawUpload = await fetch(`${origin}${uploaded.body.files[0].url}`, { headers: proxyHeaders });
  if (rawUpload.status !== 401) throw new Error("Raw upload was accessible without Page Manager authentication.");
  const rejectedOrigin = await fetch(`${origin}/api/publish`, {
    method: "POST",
    headers: {
      ...proxyHeaders,
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "X-CSRF-Token": me.body.csrfToken,
      Origin: "https://attacker.example"
    },
    body: "{}"
  });
  if (rejectedOrigin.status !== 403) throw new Error("Cross-origin authenticated write was not rejected.");
  const backup = await jsonRequest("/api/backups", { method: "POST", headers: authenticatedHeaders, body: "{}" });
  const inspected = await jsonRequest(`/api/backups/${encodeURIComponent(backup.body.backup.filename)}/inspect`, { headers: { Cookie: cookieHeader } });
  if (inspected.body.backup.integrity !== "verified") throw new Error("Backup integrity smoke failed.");
  const publish = await jsonRequest("/api/publish", {
    method: "POST",
    headers: authenticatedHeaders,
    body: "{}"
  });
  if (publish.body.provider !== "local" || publish.body.mode !== "local-preview") throw new Error("Local publish provider was not used.");
  if (!await fs.pathExists(path.join(smokeRoot, "generated-site", "index.html"))) throw new Error("Local publish did not create index.html.");
  const preview = await fetch(`${origin}/preview/`, { headers: proxyHeaders });
  if (!preview.ok || !String(preview.headers.get("content-type") || "").includes("text/html")) throw new Error("Local preview smoke failed.");
  await jsonRequest("/api/users", {
    method: "POST",
    headers: authenticatedHeaders,
    body: JSON.stringify({
      username: "pending-smoke-user",
      email: "",
      password: "pending-smoke-password",
      role: "Read Only",
      active: false
    })
  });
  const failedLogins = [];
  for (const [username, password] of [
    ["missing-smoke-user", "wrong-or-unavailable-password"],
    ["pending-smoke-user", "pending-smoke-password"]
  ]) {
    const response = await fetch(`${origin}/api/login`, {
      method: "POST",
      headers: { ...proxyHeaders, "Content-Type": "application/json", Origin: publicOrigin },
      body: JSON.stringify({ username, password })
    });
    failedLogins.push({ status: response.status, body: await response.json() });
  }
  if (
    failedLogins.some((result) => result.status !== 401)
    || failedLogins.some((result) => result.body.error !== failedLogins[0].body.error)
  ) {
    throw new Error("Login failure responses reveal account state.");
  }
  const verificationDb = new Database(path.join(smokeRoot, "kairix.sqlite"), { readonly: true });
  try {
    const loginAudit = verificationDb.prepare(
      "SELECT ip_address FROM audit_events WHERE event_type = 'login_success' ORDER BY id DESC LIMIT 1"
    ).get();
    if (loginAudit?.ip_address !== "203.0.113.9") {
      throw new Error(`Trusted proxy client address was not recorded as expected: ${loginAudit?.ip_address || "(missing)"}`);
    }
    const publishEvent = verificationDb.prepare(
      "SELECT status, message FROM publish_events ORDER BY id DESC LIMIT 1"
    ).get();
    const publishMetadata = JSON.parse(publishEvent?.message || "{}");
    if (publishEvent?.status !== "success" || publishMetadata.provider !== "local") {
      throw new Error("Successful local publish event was not recorded.");
    }
  } finally {
    verificationDb.close();
  }
  console.log(`Server smoke passed on port ${port}; published ${publish.body.build.fileCount} files with ${publish.body.provider}.`);
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await fs.remove(smokeRoot);
}
