import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const testDir = path.dirname(fileURLToPath(import.meta.url));

test("ISO expiry comparisons use SQLite date conversion rather than lexical datetime comparison", () => {
  const database = new Database(":memory:");
  const expiredEarlierToday = new Date(Date.now() - 60_000).toISOString();
  const active = database.prepare("SELECT julianday(?) > julianday('now') AS active").get(expiredEarlierToday).active;
  assert.equal(active, 0);
  database.close();

  for (const relative of ["../src/middleware/auth.js", "../src/db.js", "../src/server.js"]) {
    const source = fs.readFileSync(path.resolve(testDir, relative), "utf8");
    assert.doesNotMatch(source, /expires_at\s*(?:>|<=)\s*datetime\('now'\)/);
  }
});
