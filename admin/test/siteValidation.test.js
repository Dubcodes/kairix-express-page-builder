import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import JSZip from "jszip";
import { validateGeneratedSite } from "../src/services/siteValidation.js";

async function fixture() {
  const approvedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-site-validation-"));
  const root = path.join(approvedRoot, "job", "site");
  await fs.ensureDir(root);
  await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Safe</title>");
  return { approvedRoot, root };
}

test("valid generated output is counted", async () => {
  const { approvedRoot, root } = await fixture();
  try {
    await fs.ensureDir(path.join(root, "assets"));
    await fs.writeFile(path.join(root, "assets", "app.js"), "console.log('safe')");
    const result = await validateGeneratedSite(root, { approvedRoot });
    assert.equal(result.fileCount, 2);
    assert.ok(result.totalBytes > 0);
  } finally {
    await fs.remove(approvedRoot);
  }
});

test("path traversal and output outside the approved root are rejected", async () => {
  const { approvedRoot } = await fixture();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-outside-"));
  await fs.writeFile(path.join(outside, "index.html"), "safe");
  try {
    await assert.rejects(validateGeneratedSite(outside, { approvedRoot }), /approved build area/i);
  } finally {
    await fs.remove(approvedRoot);
    await fs.remove(outside);
  }
});

test("forbidden files, source maps, and sensitive content are rejected", async () => {
  const cases = [
    [".env.production", "SECRET=value", /Forbidden generated file/],
    ["app.js.map", "{}", /Forbidden generated file/],
    ["_worker.js", "export default {}", /Forbidden generated file/],
    ["safe.json", '{"CLOUDFLARE_API_TOKEN":"nope"}', /Sensitive material/]
  ];
  for (const [name, content, expected] of cases) {
    const { approvedRoot, root } = await fixture();
    try {
      await fs.writeFile(path.join(root, name), content);
      await assert.rejects(validateGeneratedSite(root, { approvedRoot }), expected);
    } finally {
      await fs.remove(approvedRoot);
    }
  }
});

test("file-count, per-file, and total-size limits are enforced", async () => {
  const { approvedRoot, root } = await fixture();
  try {
    await fs.writeFile(path.join(root, "second.txt"), "12345");
    await assert.rejects(validateGeneratedSite(root, { approvedRoot, maxFiles: 1 }), /file limit/i);
    await assert.rejects(validateGeneratedSite(root, { approvedRoot, maxFileBytes: 4 }), /per-file limit/i);
    await assert.rejects(validateGeneratedSite(root, { approvedRoot, maxTotalBytes: 5 }), /total size limit/i);
  } finally {
    await fs.remove(approvedRoot);
  }
});

test("forbidden files nested inside ZIP downloads are rejected", async () => {
  const { approvedRoot, root } = await fixture();
  try {
    const zip = new JSZip();
    zip.file("safe/readme.txt", "safe");
    zip.file("nested/.env", "SECRET=value");
    await fs.writeFile(path.join(root, "bundle.zip"), await zip.generateAsync({ type: "nodebuffer" }));
    await assert.rejects(validateGeneratedSite(root, { approvedRoot }), /Forbidden file inside ZIP/);
  } finally {
    await fs.remove(approvedRoot);
  }
});

test("symlinks are rejected", async (t) => {
  const { approvedRoot, root } = await fixture();
  try {
    try {
      await fs.symlink(path.join(root, "index.html"), path.join(root, "linked.html"), "file");
    } catch (error) {
      if (["EPERM", "EACCES"].includes(error.code)) {
        const targetDir = path.join(root, "assets");
        await fs.ensureDir(targetDir);
        try {
          await fs.symlink(targetDir, path.join(root, "linked-assets"), "junction");
        } catch (junctionError) {
          if (["EPERM", "EACCES"].includes(junctionError.code)) {
            t.skip("Creating symlinks or junctions is not permitted on this Windows host.");
            return;
          }
          throw junctionError;
        }
      } else {
        throw error;
      }
    }
    await assert.rejects(validateGeneratedSite(root, { approvedRoot }), /Symlink rejected/i);
  } finally {
    await fs.remove(approvedRoot);
  }
});
