import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
  CloudflarePagesDeployProvider,
  DeployConfigurationError,
  LocalDeployProvider,
  createDeployProvider,
  parseWranglerOutput,
  redactSecrets,
  validateCloudflareConfig
} from "../src/providers/deploy.js";

const valid = {
  accountId: "0123456789abcdef0123456789abcdef",
  projectName: "kairix-pages",
  branch: "main",
  apiToken: "test-token-value-that-is-never-real",
  publicBaseUrl: "https://support.example.test"
};

test("provider factory selects local and rejects unknown providers", () => {
  assert.ok(createDeployProvider({ deployProvider: "local" }) instanceof LocalDeployProvider);
  assert.throws(() => createDeployProvider({ deployProvider: "shell;calc" }), DeployConfigurationError);
});

test("local provider remains independent of Cloudflare configuration", async () => {
  const provider = new LocalDeployProvider({ publicBaseUrl: "http://localhost:4321" });
  assert.deepEqual(await provider.preflight(), { ok: true, provider: "local" });
  const result = await provider.deploy({ outputDir: "generated" });
  assert.equal(result.provider, "local");
  assert.equal(result.mode, "local-preview");
});

test("Cloudflare configuration rejects missing, invalid, and injection-shaped values", () => {
  assert.throws(() => validateCloudflareConfig({}), /requires account ID/i);
  assert.throws(() => validateCloudflareConfig({ ...valid, accountId: "../account" }), /32-character hexadecimal/i);
  assert.throws(() => validateCloudflareConfig({ ...valid, projectName: "project;calc" }), /CLOUDFLARE_PAGES_PROJECT/);
  assert.throws(() => validateCloudflareConfig({ ...valid, branch: "main --help" }), /CLOUDFLARE_PAGES_BRANCH/);
  assert.throws(() => validateCloudflareConfig({ ...valid, branch: "../main" }), /CLOUDFLARE_PAGES_BRANCH/);
});

test("Wrangler output parser tolerates unknown and malformed records", () => {
  const parsed = parseWranglerOutput([
    "not-json",
    JSON.stringify({ type: "future-record", value: 1 }),
    JSON.stringify({ type: "pages-deploy", deployment_id: "dep-1", url: "https://dep.pages.dev" }),
    JSON.stringify({
      type: "pages-deploy-detailed",
      deployment_id: "dep-1",
      url: "https://dep.pages.dev",
      alias: "https://main.project.pages.dev",
      environment: "production",
      production_branch: "main",
      timestamp: "2026-07-17T00:00:00.000Z"
    })
  ].join("\n"));
  assert.equal(parsed.deploymentId, "dep-1");
  assert.equal(parsed.environment, "production");
  assert.deepEqual(parsed.aliases, ["https://main.project.pages.dev"]);
  assert.equal(parsed.malformedRecordCount, 1);
});

test("missing pages-deploy output fails with a controlled error", () => {
  assert.throws(() => parseWranglerOutput("bad\n{\"type\":\"unknown\"}"), /without a pages-deploy result/i);
});

test("Cloudflare preflight verifies the existing project non-interactively", async () => {
  const calls = [];
  const provider = new CloudflarePagesDeployProvider(valid, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ success: true, result: { name: valid.projectName } }) };
    }
  });
  const result = await provider.preflight();
  assert.equal(result.projectName, valid.projectName);
  assert.match(calls[0].url, /\/pages\/projects\/kairix-pages$/);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${valid.apiToken}`);
});

test("Cloudflare deploy invokes installed Wrangler without shell or token arguments", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-deploy-test-"));
  const outputFilePath = path.join(temp, "wrangler.ndjson");
  let invocation;
  const provider = new CloudflarePagesDeployProvider(valid, {
    wranglerCliPath: path.join(temp, "wrangler-dist", "cli.js"),
    runProcessImpl: async (command, args, options) => {
      invocation = { command, args, options };
      await fs.writeFile(outputFilePath, `${JSON.stringify({
        type: "pages-deploy-detailed",
        deployment_id: "deployment-123",
        url: "https://deployment.pages.dev",
        alias: "https://main.kairix-pages.pages.dev",
        environment: "production",
        production_branch: "main"
      })}\n`);
      return { code: 0, stdout: "done", stderr: "", durationMs: 10 };
    }
  });
  try {
    const result = await provider.deploy({
      outputDir: temp,
      outputFilePath,
      git: { commit: "abcdef1234567890", dirty: true },
      message: "Publish test"
    });
    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.options.env.CLOUDFLARE_API_TOKEN, valid.apiToken);
    assert.equal(invocation.args.includes(valid.apiToken), false);
    assert.equal(invocation.args.includes("--project-name"), true);
    assert.equal(result.deploymentId, "deployment-123");
    assert.equal(result.publicUrl, valid.publicBaseUrl);
  } finally {
    await fs.remove(temp);
  }
});

test("Wrangler non-zero failures and timeout errors are redacted", async () => {
  for (const timedOut of [false, true]) {
    const provider = new CloudflarePagesDeployProvider(valid, {
      runProcessImpl: async () => {
        const error = new Error(`failed with ${valid.apiToken}`);
        error.stderr = `Authorization: Bearer ${valid.apiToken}`;
        error.timedOut = timedOut;
        throw error;
      }
    });
    await assert.rejects(provider.deploy({ outputDir: ".", outputFilePath: "unused" }), (error) => {
      assert.equal(String(error.message).includes(valid.apiToken), false);
      assert.equal(error.code, timedOut ? "CLOUDFLARE_DEPLOY_TIMEOUT" : "CLOUDFLARE_DEPLOY_FAILED");
      return true;
    });
  }
  assert.equal(redactSecrets(`token=${valid.apiToken}`, [valid.apiToken]).includes(valid.apiToken), false);
});
