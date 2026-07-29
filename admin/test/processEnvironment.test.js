import test from "node:test";
import assert from "node:assert/strict";
import { sanitizedChildEnvironment } from "../src/services/processEnvironment.js";

test("child environments omit ambient credentials and allow explicit narrow overrides", () => {
  const result = sanitizedChildEnvironment({
    PATH: "/usr/bin",
    SESSION_SECRET: "session",
    SESSION_SECRET_FILE: "/run/session",
    ENCRYPTION_SECRET: "encryption",
    CLOUDFLARE_API_TOKEN: "old-token",
    CLOUDFLARE_API_TOKEN_FILE: "/run/token",
    GITHUB_TOKEN: "github",
    DATABASE_PATH: "/app/data/database.sqlite"
  }, {
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "required-token"
  });
  assert.equal(result.PATH, "/usr/bin");
  assert.equal(result.DATABASE_PATH, "/app/data/database.sqlite");
  assert.equal(result.CLOUDFLARE_ACCOUNT_ID, "account");
  assert.equal(result.CLOUDFLARE_API_TOKEN, "required-token");
  assert.equal("SESSION_SECRET" in result, false);
  assert.equal("SESSION_SECRET_FILE" in result, false);
  assert.equal("ENCRYPTION_SECRET" in result, false);
  assert.equal("GITHUB_TOKEN" in result, false);
  assert.equal("CLOUDFLARE_API_TOKEN_FILE" in result, false);
});
