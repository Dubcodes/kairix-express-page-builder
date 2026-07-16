import path from "node:path";
import { createRequire } from "node:module";
import fs from "fs-extra";
import { config } from "../config.js";
import { runProcess } from "../services/processRunner.js";

const require = createRequire(import.meta.url);
const wranglerPackagePath = require.resolve("wrangler/package.json");
const defaultWranglerCliPath = path.join(path.dirname(wranglerPackagePath), "wrangler-dist", "cli.js");
const transientStatuses = new Set([429, 500, 502, 503, 504]);

export class DeployConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DeployConfigurationError";
    this.code = "DEPLOY_CONFIGURATION_INVALID";
    this.statusCode = 400;
    this.publicMessage = message;
  }
}

export class DeploymentError extends Error {
  constructor(message, { code = "DEPLOYMENT_FAILED", statusCode = 502, publicMessage, cause } = {}) {
    super(message);
    this.name = "DeploymentError";
    this.code = code;
    this.statusCode = statusCode;
    this.publicMessage = publicMessage || "Cloudflare Pages deployment failed. Review the redacted server diagnostics before retrying.";
    this.cause = cause;
  }
}

export function redactSecrets(value, secrets = []) {
  let redacted = String(value || "");
  for (const secret of secrets.filter(Boolean)) redacted = redacted.split(String(secret)).join("[REDACTED]");
  return redacted
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

export function validateCloudflareConfig(options) {
  const accountId = String(options.accountId || "").trim();
  const projectName = String(options.projectName || "").trim();
  const branch = String(options.branch || "main").trim();
  const apiToken = String(options.apiToken || "").trim();
  if (!accountId || !projectName || !branch || !apiToken) {
    throw new DeployConfigurationError("Cloudflare Pages publishing requires account ID, project name, branch, and API token environment variables.");
  }
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new DeployConfigurationError("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID.");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(projectName)) {
    throw new DeployConfigurationError("CLOUDFLARE_PAGES_PROJECT must be 1-58 lowercase letters, numbers, or hyphens and cannot start or end with a hyphen.");
  }
  if (branch.length > 100 || !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/.test(branch) || branch.includes("..") || branch.includes("//")) {
    throw new DeployConfigurationError("CLOUDFLARE_PAGES_BRANCH contains unsupported characters or path segments.");
  }
  return { accountId, projectName, branch, apiToken };
}

export function parseWranglerOutput(text) {
  const records = [];
  const malformed = [];
  for (const line of String(text || "").split(/\r?\n/).filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object") records.push(record);
    } catch {
      malformed.push(line.slice(0, 200));
    }
  }
  const detailed = [...records].reverse().find((record) => record.type === "pages-deploy-detailed");
  const basic = [...records].reverse().find((record) => record.type === "pages-deploy");
  const result = detailed || basic;
  if (!result) throw new DeploymentError("Wrangler completed without a pages-deploy result record.", {
    code: "WRANGLER_OUTPUT_INVALID",
    publicMessage: "Cloudflare returned an unrecognised deployment result. Check the server diagnostics before retrying."
  });
  const aliases = Array.isArray(result.aliases)
    ? result.aliases
    : [result.alias, ...(Array.isArray(basic?.aliases) ? basic.aliases : [])].filter(Boolean);
  return {
    deploymentId: result.deployment_id || null,
    deploymentUrl: result.url || null,
    aliases: [...new Set(aliases)],
    environment: result.environment || null,
    branch: result.production_branch || null,
    deployedAt: result.timestamp || basic?.timestamp || null,
    malformedRecordCount: malformed.length
  };
}

export class LocalDeployProvider {
  constructor(options = config) {
    this.options = options;
    this.name = "local";
  }

  async preflight() {
    return { ok: true, provider: this.name };
  }

  async deploy({ outputDir }) {
    return {
      provider: this.name,
      mode: "local-preview",
      outputDir,
      publicUrl: this.options.publicBaseUrl,
      message: "Static site generated for the local preview."
    };
  }
}

export class CloudflarePagesDeployProvider {
  constructor(options = {}, dependencies = {}) {
    this.options = {
      accountId: options.cloudflareAccountId ?? options.accountId,
      projectName: options.cloudflarePagesProject ?? options.projectName,
      branch: options.cloudflarePagesBranch ?? options.branch ?? "main",
      apiToken: options.cloudflareApiToken ?? options.apiToken,
      timeoutMs: options.cloudflareDeployTimeoutMs ?? options.timeoutMs ?? 10 * 60 * 1000,
      preflightTimeoutMs: options.cloudflarePreflightTimeoutMs ?? 15_000,
      publicBaseUrl: options.publicBaseUrl || ""
    };
    this.dependencies = {
      fetchImpl: dependencies.fetchImpl || globalThis.fetch,
      runProcessImpl: dependencies.runProcessImpl || runProcess,
      wranglerCliPath: dependencies.wranglerCliPath || defaultWranglerCliPath,
      fsImpl: dependencies.fsImpl || fs,
      waitImpl: dependencies.waitImpl || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    };
    this.name = "cloudflare-pages";
  }

  validatedOptions() {
    return { ...this.options, ...validateCloudflareConfig(this.options) };
  }

  async preflight({ signal } = {}) {
    const options = this.validatedOptions();
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/pages/projects/${encodeURIComponent(options.projectName)}`;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.preflightTimeoutMs);
      try {
        const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
        const response = await this.dependencies.fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${options.apiToken}`, Accept: "application/json" },
          signal: requestSignal
        });
        if (response.ok) {
          const payload = await response.json();
          if (!payload?.success || payload?.result?.name !== options.projectName) {
            throw new DeploymentError("Cloudflare project preflight returned an unexpected response.", {
              code: "CLOUDFLARE_PREFLIGHT_INVALID",
              publicMessage: "Cloudflare Pages project preflight returned an unexpected response."
            });
          }
          return { ok: true, provider: this.name, projectName: options.projectName };
        }
        if (response.status === 401 || response.status === 403) {
          throw new DeploymentError("Cloudflare project preflight was not authorised.", {
            code: "CLOUDFLARE_AUTH_FAILED",
            statusCode: 502,
            publicMessage: "Cloudflare rejected the configured account or API token."
          });
        }
        if (response.status === 404) {
          throw new DeploymentError("Cloudflare Pages project was not found.", {
            code: "CLOUDFLARE_PROJECT_NOT_FOUND",
            statusCode: 400,
            publicMessage: "The configured Cloudflare Pages project does not exist or is inaccessible."
          });
        }
        if (!transientStatuses.has(response.status) || attempt === 2) {
          throw new DeploymentError(`Cloudflare project preflight failed with HTTP ${response.status}.`, { code: "CLOUDFLARE_PREFLIGHT_FAILED" });
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (error instanceof DeploymentError) throw error;
        lastError = error;
        if (attempt === 2) {
          throw new DeploymentError("Cloudflare project preflight could not reach the API.", {
            code: error?.name === "AbortError" ? "CLOUDFLARE_PREFLIGHT_TIMEOUT" : "CLOUDFLARE_PREFLIGHT_NETWORK",
            cause: error,
            publicMessage: "Cloudflare project preflight could not reach the API. No upload was started."
          });
        }
      } finally {
        clearTimeout(timer);
      }
      await this.dependencies.waitImpl(200 * (attempt + 1));
    }
    throw lastError;
  }

  async deploy({ outputDir, outputFilePath, git = {}, message = "Kairix static-site publish", signal }) {
    const options = this.validatedOptions();
    const args = [
      "--no-warnings",
      this.dependencies.wranglerCliPath,
      "pages",
      "deploy",
      outputDir,
      "--project-name",
      options.projectName,
      "--branch",
      options.branch,
      "--commit-message",
      String(message).slice(0, 120),
      `--commit-dirty=${git.dirty ? "true" : "false"}`
    ];
    if (git.commit && /^[a-f0-9]{7,64}$/i.test(git.commit)) args.push("--commit-hash", git.commit);
    const env = {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: options.accountId,
      CLOUDFLARE_API_TOKEN: options.apiToken,
      WRANGLER_OUTPUT_FILE_PATH: outputFilePath,
      WRANGLER_LOG_SANITIZE: "true",
      WRANGLER_SEND_METRICS: "false",
      NO_COLOR: "1",
      CI: "true"
    };
    try {
      await this.dependencies.runProcessImpl(process.execPath, args, {
        cwd: outputDir,
        env,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: 256 * 1024,
        signal
      });
      const structuredOutput = await this.dependencies.fsImpl.readFile(outputFilePath, "utf8");
      const parsed = parseWranglerOutput(structuredOutput);
      return {
        provider: this.name,
        mode: "cloudflare-production",
        projectName: options.projectName,
        publicUrl: this.options.publicBaseUrl || parsed.deploymentUrl,
        message: "Static site deployed to Cloudflare Pages.",
        ...parsed
      };
    } catch (error) {
      if (error instanceof DeploymentError) throw error;
      const diagnostic = redactSecrets(`${error.message || error}\n${error.stderr || ""}`, [options.apiToken]).slice(0, 4_000);
      throw new DeploymentError(diagnostic, {
        code: error.timedOut ? "CLOUDFLARE_DEPLOY_TIMEOUT" : "CLOUDFLARE_DEPLOY_FAILED",
        cause: error,
        publicMessage: error.timedOut
          ? "Cloudflare deployment timed out. It may still have been created; inspect Cloudflare before retrying."
          : "Cloudflare deployment failed. It was not retried automatically."
      });
    }
  }
}

export function createDeployProvider(options = config, dependencies = {}) {
  const name = String(options.deployProvider || "local").trim().toLowerCase();
  if (name === "local") return new LocalDeployProvider(options);
  if (name === "cloudflare-pages") return new CloudflarePagesDeployProvider(options, dependencies);
  throw new DeployConfigurationError(`Unsupported DEPLOY_PROVIDER: ${name || "(blank)"}. Use local or cloudflare-pages.`);
}
