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
