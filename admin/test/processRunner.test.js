import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runProcess } from "../src/services/processRunner.js";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kills = [];
  child.kill = (signal) => {
    child.kills.push(signal);
    setImmediate(() => child.emit("close", null, signal));
    return true;
  };
  return child;
}

test("process runner bounds captured output", async () => {
  const child = fakeChild();
  const promise = runProcess("mock", [], { maxOutputBytes: 5, spawnImpl: () => child });
  child.stdout.emit("data", Buffer.from("123456789"));
  child.stderr.emit("data", Buffer.from("abcdefghi"));
  child.emit("close", 0, null);
  const result = await promise;
  assert.equal(result.stdout, "12345");
  assert.equal(result.stderr, "abcde");
});

test("process runner terminates and reports a timeout", async () => {
  const child = fakeChild();
  await assert.rejects(runProcess("mock", [], { timeoutMs: 5, spawnImpl: () => child }), (error) => {
    assert.equal(error.timedOut, true);
    assert.equal(error.code, "PROCESS_TIMEOUT");
    return true;
  });
  assert.deepEqual(child.kills, ["SIGTERM"]);
});
