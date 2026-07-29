import test from "node:test";
import assert from "node:assert/strict";
import { requireProductionSecret, validateProductionConfiguration } from "../src/config.js";

test("production secrets reject missing, known-default, short, and reused values at startup", () => {
  assert.throws(() => requireProductionSecret("SESSION_SECRET", "", "production"), /at least 32 characters/);
  assert.throws(() => requireProductionSecret("SESSION_SECRET", "replace-with-long-random-secret", "production"), /at least 32 characters/);
  assert.throws(() => requireProductionSecret("SESSION_SECRET", "short", "production"), /at least 32 characters/);
  assert.equal(requireProductionSecret("SESSION_SECRET", "x".repeat(32), "production"), "x".repeat(32));
  assert.equal(requireProductionSecret("SESSION_SECRET", "local", "development"), "local");
});

test("Cloudflare production relationships require HTTPS, root base path, split origins, and no public tunnel host", () => {
  const issues = validateProductionConfiguration({
    nodeEnv: "production",
    adminBaseUrl: "https://support.example.test",
    publicBaseUrl: "http://support.example.test",
    publicSiteBasePath: "/preview",
    deployProvider: "cloudflare-pages",
    cookieSecure: false,
    trustProxy: false,
    publicHostname: "support.example.test"
  });
  assert.ok(issues.some((issue) => issue.includes("COOKIE_SECURE")));
  assert.ok(issues.some((issue) => issue.includes("PUBLIC_BASE_URL must use HTTPS")));
  assert.ok(issues.some((issue) => issue.includes("PUBLIC_SITE_BASE_PATH must be empty")));
  assert.ok(issues.some((issue) => issue.includes("PUBLIC_HOSTNAME must be empty")));
});

test("valid Cloudflare production relationship passes", () => {
  assert.deepEqual(validateProductionConfiguration({
    nodeEnv: "production",
    adminBaseUrl: "https://admin.example.test",
    publicBaseUrl: "https://support.example.test",
    publicSiteBasePath: "",
    deployProvider: "cloudflare-pages",
    cookieSecure: true,
    trustProxy: true,
    publicHostname: ""
  }), []);
});

test("Cloudflare Workers production relationship requires HTTPS root output and no public tunnel host", () => {
  const issues = validateProductionConfiguration({
    nodeEnv: "production",
    adminBaseUrl: "https://admin.example.test",
    publicBaseUrl: "https://xpress-01.example.workers.dev/preview/",
    publicSiteBasePath: "/preview",
    deployProvider: "cloudflare-workers",
    cookieSecure: true,
    trustProxy: true,
    publicHostname: "private.example.test"
  });
  assert.ok(issues.some((issue) => issue.includes("origin URL without a path")));
  assert.ok(issues.some((issue) => issue.includes("PUBLIC_SITE_BASE_PATH must be empty")));
  assert.ok(issues.some((issue) => issue.includes("PUBLIC_HOSTNAME must be empty")));
});

test("valid Cloudflare Workers production relationship passes", () => {
  assert.deepEqual(validateProductionConfiguration({
    nodeEnv: "production",
    adminBaseUrl: "https://admin.example.test",
    publicBaseUrl: "https://xpress-01.example.workers.dev",
    publicSiteBasePath: "",
    deployProvider: "cloudflare-workers",
    cookieSecure: true,
    trustProxy: true,
    publicHostname: ""
  }), []);
});

test("production bind policy rejects wildcard, empty, and externally reachable bindings", () => {
  for (const adminBindIp of ["", "0.0.0.0", "::", "192.168.1.20"]) {
    const issues = validateProductionConfiguration({
      nodeEnv: "production",
      adminBaseUrl: "https://manager.example.test",
      publicBaseUrl: "https://xpress-01.example.workers.dev",
      publicSiteBasePath: "",
      deployProvider: "cloudflare-workers",
      cookieSecure: true,
      trustProxy: true,
      publicHostname: "",
      adminBindIp,
      previewBindIp: "127.0.0.1"
    });
    assert.ok(issues.some((issue) => issue.includes("ADMIN_BIND_IP")));
  }
  assert.ok(validateProductionConfiguration({
    nodeEnv: "production",
    adminBaseUrl: "https://manager.example.test",
    publicBaseUrl: "https://xpress-01.example.workers.dev",
    publicSiteBasePath: "",
    deployProvider: "cloudflare-workers",
    cookieSecure: true,
    trustProxy: true,
    publicHostname: "",
    adminBindIp: "127.0.0.1",
    previewBindIp: "0.0.0.0"
  }).some((issue) => issue.includes("PREVIEW_BIND_IP")));
});

test("deliberate admin bind override does not weaken preview bind enforcement", () => {
  const issues = validateProductionConfiguration({
    nodeEnv: "production",
    adminBaseUrl: "https://manager.example.test",
    publicBaseUrl: "https://xpress-01.example.workers.dev",
    publicSiteBasePath: "",
    deployProvider: "cloudflare-workers",
    cookieSecure: true,
    trustProxy: true,
    publicHostname: "",
    adminBindIp: "192.168.1.20",
    previewBindIp: "127.0.0.1",
    allowInsecureAdminBind: true
  });
  assert.equal(issues.some((issue) => issue.includes("ADMIN_BIND_IP")), false);
});

test("admin origin and expected hostname cannot be derived from an unsafe Host value", () => {
  const issues = validateProductionConfiguration({
    nodeEnv: "production",
    adminBaseUrl: "https://manager.example.test/attacker?next=1",
    adminHostname: "different.example.test",
    publicBaseUrl: "https://xpress-01.example.workers.dev",
    publicSiteBasePath: "",
    deployProvider: "cloudflare-workers",
    cookieSecure: true,
    trustProxy: true,
    publicHostname: "",
    adminBindIp: "127.0.0.1",
    previewBindIp: "127.0.0.1"
  });
  assert.ok(issues.some((issue) => issue.includes("origin URL")));
  assert.ok(issues.some((issue) => issue.includes("ADMIN_HOSTNAME must match")));
});
