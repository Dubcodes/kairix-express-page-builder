import test from "node:test";
import assert from "node:assert/strict";
import { resolveSecret } from "../src/services/secrets.js";

test("secret files take precedence and remove only trailing newline characters", () => {
  const value = resolveSecret("SESSION_SECRET", {
    env: {
      SESSION_SECRET: "environment-value",
      SESSION_SECRET_FILE: "/run/secrets/session"
    },
    readFileSync: () => "  valid internal spaces remain  \r\n\n"
  });
  assert.equal(value, "  valid internal spaces remain  ");
});

test("environment secrets remain backward compatible without whitespace mutation", () => {
  assert.equal(resolveSecret("SESSION_SECRET", {
    env: { SESSION_SECRET: "  environment secret with spaces  " }
  }), "  environment secret with spaces  ");
});

test("missing, unreadable, and empty secret files fail without exposing values", () => {
  for (const [code, message] of [["ENOENT", /does not exist/], ["EACCES", /could not be read/]]) {
    assert.throws(() => resolveSecret("SESSION_SECRET", {
      env: { SESSION_SECRET_FILE: "/private/secret" },
      readFileSync: () => {
        const error = new Error("sensitive operating-system detail");
        error.code = code;
        throw error;
      }
    }), message);
  }
  assert.throws(() => resolveSecret("SESSION_SECRET", {
    env: { SESSION_SECRET_FILE: "/private/secret" },
    readFileSync: () => "\r\n"
  }), /is empty/);
});
