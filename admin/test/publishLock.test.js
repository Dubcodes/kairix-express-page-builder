import test from "node:test";
import assert from "node:assert/strict";
import { publishStatus, withPublishLock } from "../src/services/publishLock.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("a parallel publish is rejected with 409 and an audit callback", async () => {
  const gate = deferred();
  const audits = [];
  const first = withPublishLock(1, async () => gate.promise);
  assert.ok(publishStatus()?.jobId);
  await assert.rejects(
    withPublishLock(2, async () => "never", { recordAuditImpl: (...args) => audits.push(args) }),
    (error) => error.statusCode === 409 && error.code === "PUBLISH_IN_PROGRESS"
  );
  assert.equal(audits[0][1], "publish_rejected_active");
  gate.resolve("done");
  assert.equal(await first, "done");
  assert.equal(publishStatus(), null);
});

test("publish lock is released after failure", async () => {
  await assert.rejects(withPublishLock(1, async () => { throw new Error("build failed"); }), /build failed/);
  assert.equal(publishStatus(), null);
  assert.equal(await withPublishLock(1, async () => "recovered"), "recovered");
});
