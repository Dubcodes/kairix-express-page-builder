import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { loadPublicContent, PublicContentError } from "../../site/src/lib/contentLoader.js";

const bananaContent = {
  settings: {
    brandName: "Banana Madness",
    homeHeroTitle: "Banana Madness",
    introText: "Welcome to my banana"
  },
  categories: [],
  products: [],
  downloads: [],
  supportPacks: [],
  softwareBundles: []
};

async function withContentRoot(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-content-loader-"));
  try {
    const contentPath = path.join(root, "input", "content.json");
    await fs.outputJson(contentPath, bananaContent);
    return await callback({ root, contentPath });
  } finally {
    await fs.remove(root);
  }
}

test("explicit content loads independently of the process working directory", async () => {
  await withContentRoot(({ root, contentPath }) => {
    const content = loadPublicContent({
      NODE_ENV: "production",
      KAIRIX_CONTENT_ROOT: root,
      KAIRIX_CONTENT_PATH: contentPath
    });
    assert.equal(content.settings.brandName, "Banana Madness");
    assert.equal(content.settings.introText, "Welcome to my banana");
  });
});

test("production content loading fails closed for missing, malformed, and invalid input", async () => {
  assert.throws(
    () => loadPublicContent({ NODE_ENV: "production" }),
    /Exported site content could not be loaded: KAIRIX_CONTENT_PATH is required/
  );
  await withContentRoot(async ({ root, contentPath }) => {
    await fs.writeFile(contentPath, "{broken");
    assert.throws(
      () => loadPublicContent({ NODE_ENV: "production", KAIRIX_CONTENT_ROOT: root, KAIRIX_CONTENT_PATH: contentPath }),
      /content JSON is malformed/
    );
    await fs.writeJson(contentPath, { settings: { brandName: "Banana Madness" } });
    assert.throws(
      () => loadPublicContent({ NODE_ENV: "production", KAIRIX_CONTENT_ROOT: root, KAIRIX_CONTENT_PATH: contentPath }),
      /categories must be an array/
    );
  });
});

test("content outside the approved job directory is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-approved-root-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-outside-root-"));
  try {
    const contentPath = path.join(outside, "content.json");
    await fs.writeJson(contentPath, bananaContent);
    assert.throws(
      () => loadPublicContent({ NODE_ENV: "production", KAIRIX_CONTENT_ROOT: root, KAIRIX_CONTENT_PATH: contentPath }),
      /must be inside the publish job directory/
    );
  } finally {
    await fs.remove(root);
    await fs.remove(outside);
  }
});

test("sample content requires the explicit development switch", () => {
  assert.throws(
    () => loadPublicContent({ NODE_ENV: "development" }),
    PublicContentError
  );
  const sample = loadPublicContent({
    NODE_ENV: "development",
    KAIRIX_USE_SAMPLE_CONTENT: "true"
  });
  assert.ok(sample.products.length > 0);
  assert.throws(
    () => loadPublicContent({ NODE_ENV: "production", KAIRIX_USE_SAMPLE_CONTENT: "true" }),
    /sample content is disabled in production/
  );
});
