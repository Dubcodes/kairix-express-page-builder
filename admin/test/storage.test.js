import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { isSafeManagedUploadPath, LocalStorageProvider } from "../src/providers/storage.js";

async function listFiles(root) {
  if (!await fs.pathExists(root)) return [];
  const files = [];
  const pending = [{ directory: root, relativeDirectory: "" }];
  while (pending.length) {
    const { directory, relativeDirectory } = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) pending.push({ directory: path.join(directory, entry.name), relativeDirectory: relative });
      else files.push(relative);
    }
  }
  return files.sort();
}

test("managed upload paths reject hidden, backup, temporary, and filesystem metadata names", () => {
  assert.equal(isSafeManagedUploadPath("manuals/nested/guide.pdf"), true);
  for (const storedName of [
    ".permission-test~",
    ".hidden",
    "nested/.hidden/image.png",
    "nested.tmp/image.png",
    "editor-backup.txt~",
    "upload.zip.tmp",
    "upload.zip.temp",
    "upload.zip.part",
    "draft.swp",
    "previous.bak",
    "Thumbs.db",
    "Thumbs.db/image.png",
    "desktop.ini"
  ]) {
    assert.equal(isSafeManagedUploadPath(storedName), false, storedName);
  }
});

test("public export copies only database-referenced files and generated bundles", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-storage-export-"));
  const uploads = path.join(temp, "uploads");
  const output = path.join(temp, "public-uploads");
  const files = new Map([
    ["managed.bin", "managed"],
    ["manuals/nested/guide.pdf", "nested"],
    ["bundles/support-latest.zip", "bundle"],
    ["orphan/orphan.pdf", "orphan"],
    [".permission-test~", "diagnostic"],
    [".hidden", "hidden"],
    ["editor-backup.txt~", "backup"],
    ["partial.zip.part", "partial"],
    ["scratch.tmp", "temporary"],
    ["swap.swp", "swap"],
    ["old.bak", "old"],
    ["Thumbs.db", "metadata"]
  ]);
  try {
    for (const [storedName, contents] of files) {
      await fs.outputFile(path.join(uploads, ...storedName.split("/")), contents);
    }
    await fs.outputFile(path.join(output, "stale.txt"), "stale");
    const provider = new LocalStorageProvider(uploads);
    const result = await provider.copyToPublic(output, [
      { id: 1, stored_name: "managed.bin" },
      { id: 2, stored_name: "manuals/nested/guide.pdf" },
      { id: 3, stored_name: "bundles/support-latest.zip" },
      { id: 4, stored_name: "missing/recorded.pdf" },
      { id: 5, stored_name: ".invalid-record" }
    ]);

    assert.deepEqual(await listFiles(output), [
      "bundles/support-latest.zip",
      "managed.bin",
      "manuals/nested/guide.pdf"
    ]);
    assert.equal(await fs.readFile(path.join(output, "manuals", "nested", "guide.pdf"), "utf8"), "nested");
    assert.equal(result.copiedFiles, 3);
    assert.equal(result.managedRecords, 4);
    assert.equal(result.invalidRecords, 1);
    assert.equal(result.missingRecords, 1);
    assert.equal(result.excludedUnmanagedFiles, 1);
    assert.equal(result.excludedUnsafeEntries, 8);
    assert.equal(await fs.pathExists(path.join(uploads, "orphan", "orphan.pdf")), true);
  } finally {
    await fs.remove(temp);
  }
});

test("unmanaged symlinks are excluded while database-referenced symlinks are rejected", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-storage-symlink-"));
  const uploads = path.join(temp, "uploads");
  const outside = path.join(temp, "outside");
  const output = path.join(temp, "public-uploads");
  try {
    await fs.outputFile(path.join(outside, "guide.pdf"), "outside");
    await fs.ensureDir(uploads);
    try {
      await fs.symlink(outside, path.join(uploads, "linked"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES"].includes(error.code)) {
        t.skip("Creating symlinks or junctions is not permitted on this host.");
        return;
      }
      throw error;
    }
    const provider = new LocalStorageProvider(uploads);
    const unmanagedResult = await provider.copyToPublic(output, []);
    assert.equal(unmanagedResult.excludedUnsafeEntries, 1);
    assert.deepEqual(await listFiles(output), []);
    await assert.rejects(
      provider.copyToPublic(output, [{ id: 1, stored_name: "linked/guide.pdf" }]),
      /symlink rejected/i
    );
    assert.deepEqual(await listFiles(output), []);
  } finally {
    await fs.remove(temp);
  }
});
