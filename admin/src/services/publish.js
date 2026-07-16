import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import slugify from "slugify";
import JSZip from "jszip";
import { config } from "../config.js";
import { db } from "../db.js";
import { buildExportData } from "./exportData.js";
import { storageProvider } from "../providers/storage.js";
import { createDeployProvider, redactSecrets } from "../providers/deploy.js";
import { runProcess } from "./processRunner.js";
import { isPathInside, SiteValidationError, validateGeneratedSite } from "./siteValidation.js";
import { withPublishLock } from "./publishLock.js";
export { cancelActivePublish, PublishInProgressError, publishStatus, withPublishLock } from "./publishLock.js";

function stripAnsi(value) {
  return String(value || "").replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function summarizeBuildOutput(output) {
  const clean = stripAnsi(output);
  const pagesMatch = clean.match(/(\d+)\s+page\(s\)\s+built(?:\s+in\s+([0-9.]+(?:ms|s)))?/i);
  const parts = ["Static site published"];
  if (pagesMatch?.[1]) parts.push(`${pagesMatch[1]} page(s) built`);
  if (pagesMatch?.[2]) parts.push(`duration ${pagesMatch[2]}`);
  return parts.join(" - ");
}

function appVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(config.projectRoot, "package.json"), "utf8"));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function assertSafeBuildRoot() {
  const buildDir = path.resolve(config.generatedSiteBuildDir);
  const projectRoot = path.resolve(config.projectRoot);
  const generatedDir = path.resolve(config.generatedSiteDir);
  if (!isPathInside(projectRoot, generatedDir)) {
    throw new SiteValidationError("GENERATED_SITE_DIR must be inside the application project area.");
  }
  if (buildDir === projectRoot || buildDir === generatedDir || !isPathInside(projectRoot, buildDir) || isPathInside(generatedDir, buildDir)) {
    throw new SiteValidationError("PUBLIC_BUILD_TEMP_DIR must be inside the project and separate from the live generated site.");
  }
  await fs.ensureDir(buildDir);
  if ((await fs.lstat(buildDir)).isSymbolicLink()) throw new SiteValidationError("PUBLIC_BUILD_TEMP_DIR must not be a symlink.");
  const [projectReal, buildReal] = await Promise.all([fs.realpath(projectRoot), fs.realpath(buildDir)]);
  if (!isPathInside(projectReal, buildReal)) throw new SiteValidationError("PUBLIC_BUILD_TEMP_DIR resolves outside the project.");
}

async function hashFile(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function generateSoftwareBundleZips() {
  const bundles = db.prepare("SELECT * FROM support_packs WHERE archived = 0 AND auto_generate_zip = 1 ORDER BY sort_order, name").all();
  const generated = [];
  for (const bundle of bundles) {
    const latestLocalFiles = db.prepare(`
      SELECT d.name AS download_name, v.version_number, f.*
      FROM support_pack_downloads spd
      JOIN download_objects d ON d.id = spd.download_id
      JOIN download_versions v ON v.download_id = d.id
      JOIN files f ON f.id = v.file_id
      WHERE spd.support_pack_id = ? AND d.archived = 0
      ORDER BY v.is_latest DESC, date(v.release_date) DESC, v.id DESC
    `).all(bundle.id);
    const uniqueByDownload = new Map();
    for (const file of latestLocalFiles) {
      if (!uniqueByDownload.has(file.download_name)) uniqueByDownload.set(file.download_name, file);
    }
    const files = [...uniqueByDownload.values()].filter((file) => file.path && fs.existsSync(file.path));
    if (!files.length) {
      db.prepare("UPDATE support_packs SET bundle_file_id = NULL WHERE id = ?").run(bundle.id);
      continue;
    }

    const zip = new JSZip();
    for (const file of files) {
      const safeName = `${slugify(file.download_name, { lower: true, strict: true }) || "download"}-${file.version_number || "latest"}-${file.original_name}`;
      zip.file(safeName, await fs.readFile(file.path));
    }
    zip.file("README.txt", `Demo Software Bundle: ${bundle.name}\nGenerated: ${new Date().toISOString()}\nExternal app store or marketplace links are listed on the public page and are not included inside this ZIP.\n`);

    const storedName = `bundles/${slugify(bundle.name, { lower: true, strict: true }) || "software-bundle"}-latest.zip`;
    const outputPath = path.join(config.uploadsDir, storedName);
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    const size = (await fs.stat(outputPath)).size;
    const contentHash = await hashFile(outputPath);
    const existing = db.prepare("SELECT * FROM files WHERE stored_name = ?").get(storedName);
    const fileId = existing
      ? existing.id
      : db.prepare("INSERT INTO files (original_name, stored_name, path, mime_type, size, content_hash) VALUES (?, ?, ?, ?, ?, ?)")
        .run(`${bundle.name} latest.zip`, storedName, outputPath, "application/zip", size, contentHash).lastInsertRowid;
    if (existing) {
      db.prepare("UPDATE files SET original_name = ?, path = ?, mime_type = ?, size = ?, content_hash = ? WHERE id = ?")
        .run(`${bundle.name} latest.zip`, outputPath, "application/zip", size, contentHash, existing.id);
    }
    db.prepare("UPDATE support_packs SET bundle_file_id = ? WHERE id = ?").run(fileId, bundle.id);
    generated.push({ id: bundle.id, name: bundle.name, fileId });
  }
  return generated;
}

function recordAudit(userId, eventType, { jobId, message, startedAt, metadata = {} }) {
  db.prepare(`
    INSERT INTO audit_events (user_id, event_type, entity_type, message, metadata)
    VALUES (?, ?, 'publish', ?, ?)
  `).run(userId, eventType, message, JSON.stringify({
    jobId,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...metadata
  }));
}

function recordPublishEvent(userId, status, payload) {
  db.prepare("INSERT INTO publish_events (status, message, created_by) VALUES (?, ?, ?)")
    .run(status, JSON.stringify(payload), userId);
}

async function gitMetadata(runProcessImpl = runProcess) {
  try {
    const [commit, status, subject] = await Promise.all([
      runProcessImpl("git", ["rev-parse", "HEAD"], { cwd: config.projectRoot, timeoutMs: 5_000, maxOutputBytes: 4_096 }),
      runProcessImpl("git", ["status", "--porcelain"], { cwd: config.projectRoot, timeoutMs: 5_000, maxOutputBytes: 32_768 }),
      runProcessImpl("git", ["log", "-1", "--pretty=%s"], { cwd: config.projectRoot, timeoutMs: 5_000, maxOutputBytes: 4_096 })
    ]);
    return {
      commit: commit.stdout.trim(),
      dirty: Boolean(status.stdout.trim()),
      message: subject.stdout.trim().slice(0, 100)
    };
  } catch {
    return { commit: null, dirty: false, message: "Kairix static-site publish" };
  }
}

async function promoteGeneratedSite(stagingDir) {
  const target = path.resolve(config.generatedSiteDir);
  const parent = path.dirname(target);
  const backup = path.join(parent, `.kairix-previous-${crypto.randomUUID()}`);
  await fs.ensureDir(parent);
  if (await fs.pathExists(target)) {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SiteValidationError("Live generated-site path must be a real directory.");
    await fs.rename(target, backup);
  }
  try {
    await fs.rename(stagingDir, target);
  } catch (error) {
    if (await fs.pathExists(backup)) await fs.rename(backup, target);
    throw error;
  }
  await fs.remove(backup).catch((error) => {
    console.error(`Previous generated-site cleanup failed: ${error.message}`);
  });
}

export async function cleanupPublishTemp() {
  await assertSafeBuildRoot();
  for (const entry of await fs.readdir(config.generatedSiteBuildDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("publish-")) {
      await fs.remove(path.join(config.generatedSiteBuildDir, entry.name));
    }
  }
}

export async function publishSite(userId = null, dependencies = {}) {
  return withPublishLock(userId, async ({ jobId, startedAt, signal }) => {
    const runProcessImpl = dependencies.runProcessImpl || runProcess;
    const deployProvider = dependencies.deployProvider || createDeployProvider(config, dependencies.deployDependencies);
    const buildRoot = path.resolve(config.generatedSiteBuildDir);
    const jobDir = path.join(buildRoot, `publish-${jobId}`);
    const outputDir = path.join(jobDir, "site");
    const wranglerOutputPath = path.join(jobDir, "wrangler-output.ndjson");
    let stage = "preflight";
    let generatedBundles = [];
    recordAudit(userId, "publish_started", { jobId, message: "Publish started", startedAt, metadata: { provider: deployProvider.name } });
    try {
      await assertSafeBuildRoot();
      await deployProvider.preflight({ signal });
      await fs.ensureDir(outputDir);
      generatedBundles = await generateSoftwareBundleZips();
      const data = await buildExportData();
      const dataPath = path.join(config.projectRoot, "site", "src", "data", "content.json");
      const publicUploadsDir = path.join(config.projectRoot, "site", "public", "uploads");
      await fs.ensureDir(path.dirname(dataPath));
      await fs.writeJson(dataPath, data, { spaces: 2 });
      await storageProvider.copyToPublic(publicUploadsDir);

      stage = "build";
      const build = await runProcessImpl(process.execPath, [path.join(config.projectRoot, "site", "scripts", "astro.mjs"), "build"], {
        cwd: config.projectRoot,
        env: {
          ...process.env,
          ASTRO_OUT_DIR: outputDir,
          PUBLIC_BASE_URL: config.publicBaseUrl,
          PUBLIC_SITE_BASE_PATH: config.publicSiteBasePath
        },
        timeoutMs: config.cloudflareDeployTimeoutMs,
        maxOutputBytes: 256 * 1024,
        signal
      });
      const buildSummary = summarizeBuildOutput(`${build.stdout}\n${build.stderr}`);
      recordAudit(userId, "publish_build_completed", {
        jobId,
        message: "Static-site build completed",
        startedAt,
        metadata: { provider: deployProvider.name, buildDurationMs: build.durationMs }
      });

      stage = "validation";
      const validation = await validateGeneratedSite(outputDir, {
        approvedRoot: buildRoot,
        maxFiles: config.publishMaxFiles,
        maxTotalBytes: config.publishMaxTotalBytes,
        maxFileBytes: config.publishMaxFileBytes
      });
      const git = await gitMetadata(runProcessImpl);

      stage = "deployment";
      if (deployProvider.name === "cloudflare-pages") {
        recordAudit(userId, "cloudflare_deployment_started", {
          jobId,
          message: "Cloudflare deployment started",
          startedAt,
          metadata: { projectName: config.cloudflarePagesProject, branch: config.cloudflarePagesBranch }
        });
      }
      const deployment = await deployProvider.deploy({
        outputDir,
        outputFilePath: wranglerOutputPath,
        git,
        message: git.message || `Kairix publish ${jobId.slice(0, 8)}`,
        signal
      });
      if (deployProvider.name === "cloudflare-pages") {
        recordAudit(userId, "cloudflare_deployment_completed", {
          jobId,
          message: "Cloudflare deployment completed",
          startedAt,
          metadata: {
            deploymentId: deployment.deploymentId,
            deploymentUrl: deployment.deploymentUrl,
            projectName: deployment.projectName,
            branch: deployment.branch || config.cloudflarePagesBranch
          }
        });
      }

      stage = "promotion";
      await promoteGeneratedSite(outputDir);
      const result = {
        ok: true,
        ...deployment,
        outputDir: config.generatedSiteDir,
        jobId,
        generatedBundles,
        build: {
          summary: buildSummary,
          durationMs: build.durationMs,
          fileCount: validation.fileCount,
          totalBytes: validation.totalBytes
        }
      };
      recordPublishEvent(userId, "success", {
        summary: deployment.message,
        appVersion: appVersion(),
        jobId,
        provider: deployment.provider,
        mode: deployment.mode,
        publicUrl: deployment.publicUrl,
        deploymentId: deployment.deploymentId || null,
        deploymentUrl: deployment.deploymentUrl || null,
        build: result.build
      });
      return result;
    } catch (error) {
      const eventType = {
        validation: "publish_validation_failed",
        deployment: "publish_deployment_failed",
        promotion: "publish_preview_promotion_failed"
      }[stage] || "publish_failed";
      const safeError = redactSecrets(error.message || error, [config.cloudflareApiToken]).slice(0, 4_000);
      recordAudit(userId, eventType, {
        jobId,
        message: stage === "validation" ? "Generated-site validation failed" : "Publish or deployment failed",
        startedAt,
        metadata: { provider: deployProvider.name, stage, code: error.code || "PUBLISH_FAILED" }
      });
      recordPublishEvent(userId, "failure", {
        summary: error.publicMessage || "Publish failed. Review server diagnostics.",
        appVersion: appVersion(),
        jobId,
        provider: deployProvider.name,
        stage,
        code: error.code || "PUBLISH_FAILED"
      });
      console.error(`[publish ${jobId}] ${safeError}`);
      throw error;
    } finally {
      await fs.remove(jobDir).catch((cleanupError) => {
        console.error(`[publish ${jobId}] Temporary file cleanup failed: ${cleanupError.message}`);
      });
    }
  }, { recordAuditImpl: dependencies.lockDependencies?.recordAuditImpl || recordAudit });
}
