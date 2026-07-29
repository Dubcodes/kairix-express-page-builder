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

test("Kairix favicon remains admin-only", async () => {
  const adminFavicon = path.resolve("admin/src/public/assets/favicon.svg");
  const publicFavicon = path.resolve("site/public/favicon.svg");
  assert.equal((await fs.readFile(adminFavicon, "utf8")).includes("<svg"), true);
  assert.equal(await fs.pathExists(publicFavicon), false);
});

test("invite and reset pages use external scripts compatible with strict CSP", async () => {
  for (const [page, script] of [["invite.html", "invite.js"], ["reset.html", "reset.js"]]) {
    const html = await fs.readFile(path.resolve("admin/src/public", page), "utf8");
    assert.match(html, new RegExp(`<script src="/assets/${script}" type="module"></script>`));
    assert.equal(/<script>(?:.|[\r\n])*?<\/script>/i.test(html), false);
  }
});

test("favicon verifier checks customer and absent favicon policies on every page", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kairix-favicon-test-"));
  try {
    await fs.outputFile(path.join(temp, "uploads", "customer", "banana.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    for (const relative of ["index.html", "products/demo/index.html"]) {
      await fs.outputFile(
        path.join(temp, relative),
        "<!doctype html><html><head><link rel=\"icon\" href=\"/preview/uploads/customer/banana.svg\"></head></html>"
      );
    }
    const local = await verifyPublicFavicon(temp, "/preview/", "/uploads/customer/banana.svg");
    assert.equal(local.pageCount, 2);
    assert.equal(local.href, "/preview/uploads/customer/banana.svg");

    for (const relative of ["index.html", "products/demo/index.html"]) {
      await fs.outputFile(
        path.join(temp, relative),
        "<!doctype html><html><head><link rel=\"icon\" href=\"/uploads/customer/banana.svg\"></head></html>"
      );
    }
    const cloudflare = await verifyPublicFavicon(temp, "", "/uploads/customer/banana.svg");
    assert.equal(cloudflare.pageCount, 2);
    assert.equal(cloudflare.href, "/uploads/customer/banana.svg");

    for (const relative of ["index.html", "products/demo/index.html"]) {
      await fs.outputFile(path.join(temp, relative), "<!doctype html><html><head></head></html>");
    }
    const noFavicon = await verifyPublicFavicon(temp, "", "");
    assert.equal(noFavicon.configured, false);
  } finally {
    await fs.remove(temp);
  }
});
