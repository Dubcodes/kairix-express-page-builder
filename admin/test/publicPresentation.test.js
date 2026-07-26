import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
  invitationLinkNote,
  renderLinkResult
} from "../src/public/assets/linkResult.js";
import { verifyPublicFavicon } from "../../scripts/check-public-favicon.mjs";

test("publish link presentation omits invitation-only wording", () => {
  const html = renderLinkResult("Local preview", "http://localhost:8040/preview/");
  assert.match(html, /href="http:\/\/localhost:8040\/preview\/"/);
  assert.match(html, /data-copy-value="http:\/\/localhost:8040\/preview\/"/);
  assert.equal(html.includes(invitationLinkNote), false);
  assert.equal(renderLinkResult("Invite URL", "https://admin.example.test/invite", {
    note: invitationLinkNote
  }).includes(invitationLinkNote), true);
});

test("admin and public default favicons use the same Kairix asset", async () => {
  const adminFavicon = path.resolve("admin/src/public/assets/favicon.svg");
  const publicFavicon = path.resolve("site/public/favicon.svg");
  assert.equal(await fs.readFile(publicFavicon, "utf8"), await fs.readFile(adminFavicon, "utf8"));
});

test("favicon verifier checks every generated page for local and root deployments", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-favicon-test-"));
  try {
    await fs.outputFile(path.join(temp, "favicon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    for (const relative of ["index.html", "products/demo/index.html"]) {
      await fs.outputFile(
        path.join(temp, relative),
        "<!doctype html><html><head><link rel=\"icon\" href=\"/preview/favicon.svg\"></head></html>"
      );
    }
    const local = await verifyPublicFavicon(temp, "/preview/");
    assert.equal(local.pageCount, 2);
    assert.equal(local.href, "/preview/favicon.svg");

    for (const relative of ["index.html", "products/demo/index.html"]) {
      await fs.outputFile(
        path.join(temp, relative),
        "<!doctype html><html><head><link rel=\"icon\" href=\"/favicon.svg\"></head></html>"
      );
    }
    const cloudflare = await verifyPublicFavicon(temp, "");
    assert.equal(cloudflare.pageCount, 2);
    assert.equal(cloudflare.href, "/favicon.svg");
  } finally {
    await fs.remove(temp);
  }
});
