import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
  CloudflarePagesDeployProvider,
  CloudflareWorkersDeployProvider,
  DeployConfigurationError,
  LocalDeployProvider,
  createDeployProvider,
  parseWorkersWranglerOutput,
  parseWranglerOutput,
  publicSiteUrl,
  redactSecrets,
  validateCloudflareConfig,
  validateCloudflareWorkersConfig
} from "../src/providers/deploy.js";

const valid = {
  accountId: "0123456789abcdef0123456789abcdef",
  projectName: "kairix-pages",
  branch: "main",
  apiToken: "test-token-value-that-is-never-real",
  publicBaseUrl: "https://support.example.test",
  publicSiteBasePath: ""
};

const validWorkers = {
  accountId: "0123456789abcdef0123456789abcdef",
  workerName: "xpress-01",
  apiToken: "test-worker-token-value-that-is-never-real",
  publicBaseUrl: "https://xpress-01.example.workers.dev",
  publicSiteBasePath: ""
};

test("provider factory selects local and rejects unknown providers", () => {
  assert.ok(createDeployProvider({ deployProvider: "local" }) instanceof LocalDeployProvider);
  assert.ok(createDeployProvider({ deployProvider: "cloudflare-pages", ...valid }) instanceof CloudflarePagesDeployProvider);
  assert.ok(createDeployProvider({ deployProvider: "cloudflare-workers", ...validWorkers }) instanceof CloudflareWorkersDeployProvider);
  assert.throws(() => createDeployProvider({ deployProvider: "shell;calc" }), DeployConfigurationError);
});

test("local provider remains independent of Cloudflare configuration", async () => {
  const provider = new LocalDeployProvider({
    publicBaseUrl: "http://localhost:4321",
    publicSiteBasePath: "/preview"
  });
  assert.deepEqual(await provider.preflight(), { ok: true, provider: "local" });
  const result = await provider.deploy({ outputDir: "generated" });
  assert.equal(result.provider, "local");
  assert.equal(result.mode, "local-preview");
  assert.equal(result.publicUrl, "http://localhost:4321/preview/");
});

test("public deployment URLs join base paths once and keep Cloudflare at root", () => {
  assert.equal(publicSiteUrl("http://192.168.0.238:8040", "/preview/"), "http://192.168.0.238:8040/preview/");
  assert.equal(publicSiteUrl("http://192.168.0.238:8040/preview/", "/preview"), "http://192.168.0.238:8040/preview/");
  assert.equal(publicSiteUrl("https://support.example.test", ""), "https://support.example.test/");
});

test("Cloudflare configuration rejects missing, invalid, and injection-shaped values", () => {
  assert.throws(() => validateCloudflareConfig({}), /requires account ID/i);
  assert.throws(() => validateCloudflareConfig({ ...valid, accountId: "../account" }), /32-character hexadecimal/i);
  assert.throws(() => validateCloudflareConfig({ ...valid, projectName: "project;calc" }), /CLOUDFLARE_PAGES_PROJECT/);
  assert.throws(() => validateCloudflareConfig({ ...valid, branch: "main --help" }), /CLOUDFLARE_PAGES_BRANCH/);
  assert.throws(() => validateCloudflareConfig({ ...valid, branch: "../main" }), /CLOUDFLARE_PAGES_BRANCH/);
});

test("Cloudflare Workers configuration requires safe credentials, name, HTTPS root URL, and root base path", () => {
  assert.throws(() => validateCloudflareWorkersConfig({}), /requires account ID/i);
  assert.throws(() => validateCloudflareWorkersConfig({ ...validWorkers, accountId: "../account" }), /32-character hexadecimal/i);
  assert.throws(() => validateCloudflareWorkersConfig({ ...validWorkers, workerName: "xpress;calc" }), /CLOUDFLARE_WORKER_NAME/);
  assert.throws(() => validateCloudflareWorkersConfig({ ...validWorkers, publicBaseUrl: "http://xpress.example.test" }), /absolute HTTPS root URL/);
  assert.throws(() => validateCloudflareWorkersConfig({ ...validWorkers, publicBaseUrl: "https://xpress.example.test/preview/" }), /absolute HTTPS root URL/);
  assert.throws(
    () => new CloudflareWorkersDeployProvider({ ...validWorkers, publicSiteBasePath: "/preview" }).validatedOptions(),
    /PUBLIC_SITE_BASE_PATH must be empty/
  );
  assert.equal(validateCloudflareWorkersConfig(validWorkers).workerName, "xpress-01");
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

test("Workers output parser returns Worker name, version ID, and workers.dev target", () => {
  const parsed = parseWorkersWranglerOutput([
    "not-json",
    JSON.stringify({ type: "future-record" }),
    JSON.stringify({
      type: "deploy",
      version: 1,
      worker_name: "xpress-01",
      version_id: "12345678-1234-1234-1234-123456789abc",
      targets: [{ url: "xpress-01.example.workers.dev" }]
    })
  ].join("\n"), "xpress-01");
  assert.equal(parsed.workerName, "xpress-01");
  assert.equal(parsed.versionId, "12345678-1234-1234-1234-123456789abc");
  assert.equal(parsed.deploymentId, parsed.versionId);
  assert.equal(parsed.deploymentUrl, "https://xpress-01.example.workers.dev");
  assert.equal(parsed.malformedRecordCount, 1);
  assert.throws(() => parseWorkersWranglerOutput('{"type":"unknown"}'), /without a Worker deploy result/i);
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

test("Cloudflare Workers preflight authenticates to the account and safely identifies the Worker", async () => {
  const calls = [];
  const provider = new CloudflareWorkersDeployProvider(validWorkers, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ success: true, result: [{ id: "another-worker" }, { id: "xpress-01" }] })
      };
    }
  });
  const result = await provider.preflight();
  assert.equal(result.workerName, "xpress-01");
  assert.equal(result.workerExists, true);
  assert.match(calls[0].url, /\/accounts\/0123456789abcdef0123456789abcdef\/workers\/scripts$/);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${validWorkers.apiToken}`);

  const createResult = await new CloudflareWorkersDeployProvider(validWorkers, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, result: [] }) })
  }).preflight();
  assert.equal(createResult.workerExists, false);
});

test("Cloudflare Workers preflight rejects missing credentials and unauthorised tokens safely", async () => {
  assert.throws(
    () => new CloudflareWorkersDeployProvider({ ...validWorkers, apiToken: "" }).validatedOptions(),
    /requires account ID/i
  );
  const provider = new CloudflareWorkersDeployProvider(validWorkers, {
    fetchImpl: async () => ({ ok: false, status: 403 })
  });
  await assert.rejects(provider.preflight(), (error) => {
    assert.equal(error.code, "CLOUDFLARE_AUTH_FAILED");
    assert.equal(String(error.message).includes(validWorkers.apiToken), false);
    return true;
  });
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
    assert.equal(result.publicUrl, `${valid.publicBaseUrl}/`);
  } finally {
    await fs.remove(temp);
  }
});

test("Cloudflare Workers deploy uses validated assets, environment authentication, and writable temp paths", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-workers-deploy-test-"));
  const outputDir = path.join(temp, "site");
  const outputFilePath = path.join(temp, "wrangler.ndjson");
  await fs.ensureDir(outputDir);
  let invocation;
  const provider = new CloudflareWorkersDeployProvider(validWorkers, {
    compatibilityDate: "2026-07-29",
    wranglerCliPath: path.join(temp, "wrangler-dist", "cli.js"),
    runProcessImpl: async (command, args, options) => {
      invocation = { command, args, options };
      await fs.writeFile(outputFilePath, `${JSON.stringify({
        type: "deploy",
        version: 1,
        worker_name: "xpress-01",
        version_id: "12345678-1234-1234-1234-123456789abc",
        targets: ["https://xpress-01.example.workers.dev"]
      })}\n`);
      return { code: 0, stdout: "done", stderr: "", durationMs: 10 };
    }
  });
  try {
    const result = await provider.deploy({ outputDir, outputFilePath, message: "Publish test" });
    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.options.cwd, temp);
    assert.equal(invocation.options.env.CLOUDFLARE_ACCOUNT_ID, validWorkers.accountId);
    assert.equal(invocation.options.env.CLOUDFLARE_API_TOKEN, validWorkers.apiToken);
    assert.equal(invocation.options.env.XDG_CONFIG_HOME, "/tmp/kairix-wrangler/config");
    assert.equal(invocation.options.env.XDG_CACHE_HOME, "/tmp/kairix-wrangler/cache");
    assert.equal(invocation.options.env.CI, "true");
    assert.equal(invocation.args.includes(validWorkers.apiToken), false);
    assert.deepEqual(
      invocation.args.slice(invocation.args.indexOf("deploy"), invocation.args.indexOf("--message")),
      ["deploy", "--assets", path.resolve(outputDir), "--name", "xpress-01", "--compatibility-date", "2026-07-29"]
    );
    assert.equal(invocation.args.includes("--keep-vars"), true);
    assert.equal(invocation.args.includes("--no-autoconfig"), true);
    assert.equal(result.provider, "cloudflare-workers");
    assert.equal(result.providerLabel, "Cloudflare Workers");
    assert.equal(result.workerName, "xpress-01");
    assert.equal(result.deploymentId, "12345678-1234-1234-1234-123456789abc");
    assert.equal(result.publicUrl, `${validWorkers.publicBaseUrl}/`);
  } finally {
    await fs.remove(temp);
  }
});

test("failed Cloudflare Workers deployment is redacted and produces no success result", async () => {
  let outputRead = false;
  const provider = new CloudflareWorkersDeployProvider(validWorkers, {
    runProcessImpl: async () => {
      const error = new Error(`upload failed with ${validWorkers.apiToken}`);
      error.stderr = `Authorization: Bearer ${validWorkers.apiToken}`;
      throw error;
    },
    fsImpl: {
      readFile: async () => {
        outputRead = true;
        return "";
      }
    }
  });
  await assert.rejects(provider.deploy({ outputDir: ".", outputFilePath: "unused" }), (error) => {
    assert.equal(error.code, "CLOUDFLARE_DEPLOY_FAILED");
    assert.equal(error.publicMessage, "Cloudflare Workers deployment failed. It was not retried automatically.");
    assert.equal(String(error.message).includes(validWorkers.apiToken), false);
    return true;
  });
  assert.equal(outputRead, false);
});

test("remote deployment completes before last-known-good site promotion", async () => {
  const publishSource = await fs.readFile(new URL("../src/services/publish.js", import.meta.url), "utf8");
  const deploymentIndex = publishSource.indexOf("await deployProvider.deploy({");
  const promotionIndex = publishSource.indexOf("await promoteGeneratedSite(outputDir);");
  assert.notEqual(deploymentIndex, -1);
  assert.notEqual(promotionIndex, -1);
  assert.ok(deploymentIndex < promotionIndex, "site promotion must remain after successful deployment");
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
