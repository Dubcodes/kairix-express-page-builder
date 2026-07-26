import test from "node:test";
import assert from "node:assert/strict";
import { ProcessExecutionError } from "../src/services/processRunner.js";
import {
  ensureSafePublishError,
  formatPublishFailure
} from "../src/services/publishDiagnostics.js";

test("publish diagnostics include stage, exit code, and bounded redacted subprocess stderr", () => {
  const cloudflareToken = "cloudflare-token-that-must-not-appear";
  const sessionSecret = "session-secret-that-must-not-appear";
  const error = new ProcessExecutionError("Process exited with code 1.", {
    code: 1,
    stderr: `\u001b[31mEACCES: permission denied ${cloudflareToken}\u001b[0m`,
    stdout: `build context ${sessionSecret}`
  });
  const diagnostic = formatPublishFailure({
    jobId: "job-123",
    stage: "build",
    error,
    env: {
      CLOUDFLARE_API_TOKEN: cloudflareToken,
      SESSION_SECRET: sessionSecret
    },
    maxLength: 300
  });
  assert.match(diagnostic, /^\[publish job-123\] build failed \(exit 1\):/);
  assert.match(diagnostic, /EACCES: permission denied/);
  assert.equal(diagnostic.includes("\u001b"), false);
  assert.equal(diagnostic.includes(cloudflareToken), false);
  assert.equal(diagnostic.includes(sessionSecret), false);
  assert.ok(diagnostic.length <= 300);
});

test("raw subprocess diagnostics never become the browser-facing publish message", () => {
  const error = new ProcessExecutionError("Process exited with code 1.", {
    code: 1,
    stderr: "private filesystem detail"
  });
  ensureSafePublishError(error);
  assert.equal(error.publicMessage, "Publish failed. Review the redacted server diagnostics.");
  assert.equal(error.publicMessage.includes(error.stderr), false);
});
