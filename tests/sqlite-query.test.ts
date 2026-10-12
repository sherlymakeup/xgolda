import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sqliteQueryTool } from "../src/lib/tools/sqlite-query.ts";

describe("sqlite_query — read-only enforcement (S-01/S-02)", () => {
  it("SELECT biasa lolos", async () => {
    const r = await sqliteQueryTool.handler({ sql: "SELECT 1 AS x" }, {});
    assert.equal(r.ok, true);
    assert.match(r.output, /"x": 1/);
  });

  it("DELETE via WITH-CTE diblokir", async () => {
    const r = await sqliteQueryTool.handler(
      { sql: "WITH d AS (DELETE FROM messages RETURNING *) SELECT * FROM d" },
      {}
    );
    assert.equal(r.ok, false);
    assert.match(r.output, /dilarang|tidak diizinkan/i);
  });

  it("UPDATE via WITH-CTE diblokir", async () => {
    const r = await sqliteQueryTool.handler(
      {
        sql: "WITH u AS (UPDATE sessions SET title='pwned' RETURNING *) SELECT * FROM u",
      },
      {}
    );
    assert.equal(r.ok, false);
  });

  it("multi-statement ditolak", async () => {
    const r = await sqliteQueryTool.handler(
      { sql: "SELECT 1; DROP TABLE sessions;" },
      {}
    );
    assert.equal(r.ok, false);
    assert.match(r.output, /multi-statement/i);
  });

  it("PRAGMA tulis ditolak", async () => {
    const r = await sqliteQueryTool.handler(
      { sql: "PRAGMA journal_mode=DELETE" },
      {}
    );
    assert.equal(r.ok, false);
  });

  it("PRAGMA baca diizinkan", async () => {
    const r = await sqliteQueryTool.handler(
      { sql: "PRAGMA table_info(sessions)" },
      {}
    );
    assert.equal(r.ok, true);
  });

  it("INSERT langsung ditolak", async () => {
    const r = await sqliteQueryTool.handler(
      { sql: "INSERT INTO sessions (id) VALUES ('x')" },
      {}
    );
    assert.equal(r.ok, false);
  });
});
