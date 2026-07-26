import fs from "node:fs";
import path from "node:path";
import { sampleContent } from "../data/sampleContent.js";

export class PublicContentError extends Error {
  constructor(message, options = {}) {
    super(`Exported site content could not be loaded: ${message}`, options);
    this.name = "PublicContentError";
    this.code = "PUBLIC_CONTENT_INVALID";
  }
}

function fail(message, cause) {
  throw new PublicContentError(message, cause ? { cause } : {});
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function validateContentStructure(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) fail("the JSON root must be an object.");
  if (!content.settings || typeof content.settings !== "object" || Array.isArray(content.settings)) {
    fail("the JSON must contain a settings object.");
  }
  if (typeof content.settings.brandName !== "string") fail("settings.brandName must be a string.");
  for (const field of ["categories", "products", "downloads", "supportPacks", "softwareBundles"]) {
    if (!Array.isArray(content[field])) fail(`${field} must be an array.`);
  }
  return content;
}

function validatePathComponents(root, contentPath) {
  const relative = path.relative(root, contentPath);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") fail("the configured content file does not exist.");
      fail("the configured content file is unreadable.", error);
    }
    if (stat.isSymbolicLink()) fail("symlinks are not allowed in the configured content path.");
  }
}

export function loadPublicContent(env = process.env) {
  const useSample = String(env.KAIRIX_USE_SAMPLE_CONTENT || "").toLowerCase() === "true";
  if (useSample) {
    if (env.NODE_ENV === "production") fail("sample content is disabled in production.");
    return validateContentStructure(sampleContent);
  }

  const contentValue = String(env.KAIRIX_CONTENT_PATH || "").trim();
  const rootValue = String(env.KAIRIX_CONTENT_ROOT || "").trim();
  if (!contentValue) fail("KAIRIX_CONTENT_PATH is required.");
  if (!rootValue) fail("KAIRIX_CONTENT_ROOT is required.");
  if (!path.isAbsolute(contentValue) || !path.isAbsolute(rootValue)) {
    fail("the configured content path and root must be absolute.");
  }

  const contentPath = path.resolve(contentValue);
  const root = path.resolve(rootValue);
  if (!isPathInside(root, contentPath)) fail("the configured content path must be inside the publish job directory.");

  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    if (error.code === "ENOENT") fail("the publish job directory does not exist.");
    fail("the publish job directory is unreadable.", error);
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("the publish job root must be a real directory.");
  validatePathComponents(root, contentPath);

  let contentStat;
  let rootReal;
  let contentReal;
  try {
    contentStat = fs.lstatSync(contentPath);
    rootReal = fs.realpathSync(root);
    contentReal = fs.realpathSync(contentPath);
  } catch (error) {
    fail("the configured content file is unreadable.", error);
  }
  if (!contentStat.isFile() || contentStat.isSymbolicLink()) fail("the configured content input must be a regular file.");
  if (!isPathInside(rootReal, contentReal)) fail("the configured content file resolves outside the publish job directory.");

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(contentPath, "utf8"));
  } catch (error) {
    fail(error instanceof SyntaxError ? "the configured content JSON is malformed." : "the configured content file is unreadable.", error);
  }
  return validateContentStructure(parsed);
}
