import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";

const projectRoot = path.resolve(".");
const smokeRoot = path.join(projectRoot, ".cache", `server-smoke-${crypto.randomUUID()}`);
const port = 8091;
const origin = `http://127.0.0.1:${port}`;
await fs.ensureDir(smokeRoot);

const child = spawn(process.execPath, [path.join(projectRoot, "admin", "src", "server.js")], {
  cwd: projectRoot,
  shell: false,
  windowsHide: true,
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(port),
    DATABASE_PATH: path.join(smokeRoot, "kairix.sqlite"),
    UPLOADS_DIR: path.join(smokeRoot, "uploads"),
    GENERATED_SITE_DIR: path.join(smokeRoot, "generated-site"),
    PUBLIC_BUILD_TEMP_DIR: path.join(smokeRoot, "publish-staging"),
    BACKUPS_DIR: path.join(smokeRoot, "backups"),
    DEPLOY_PROVIDER: "local",
    PUBLIC_BASE_URL: origin,
    PUBLIC_SITE_BASE_PATH: "/preview",
    ADMIN_BASE_URL: origin,
    TRUST_PROXY: "false",
    COOKIE_SECURE: "false",
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
  const response = await fetch(`${origin}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${body.error || "unknown error"}`);
  return { response, body };
}

try {
  await waitForServer();
  await jsonRequest("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brandName: "Smoke Test", marketplaceUrl: "", username: "smoke-admin", email: "", password: "smoke-test-password" })
  });
  const login = await jsonRequest("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "smoke-admin", password: "smoke-test-password" })
  });
  const cookies = login.response.headers.getSetCookie().map((value) => value.split(";", 1)[0]);
  const cookieHeader = cookies.join("; ");
  const me = await jsonRequest("/api/me", { headers: { Cookie: cookieHeader } });
  const authenticatedHeaders = {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    "X-CSRF-Token": me.body.csrfToken
  };
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
  const preview = await fetch(`${origin}/preview/`);
  if (!preview.ok || !String(preview.headers.get("content-type") || "").includes("text/html")) throw new Error("Local preview smoke failed.");
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
