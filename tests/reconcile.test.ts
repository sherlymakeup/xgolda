import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../src/db/index.ts";
import { agentRuns, approvals } from "../src/db/schema.ts";
import { reconcileOnStartup } from "../src/lib/agent/reconcile.ts";

describe("reconcileOnStartup", () => {
  it("run nyangkut → failed, approval pending → expired", async () => {
    const db = getDb();
    const runId = `test-reconcile-${nanoid(8)}`;
    const now = Date.now();
    await db.insert(agentRuns).values({
      id: runId,
      sessionId: null,
      parentRunId: null,
      goal: "test reconcile",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(approvals).values({
      id: `test-appr-${nanoid(8)}`,
      runId,
      sessionId: null,
      toolName: "terminal_exec",
      command: "rm -rf x",
      reason: "test",
      status: "pending",
      createdAt: now,
    });
    try {
      const r = await reconcileOnStartup();
      assert.ok(r.failedRuns >= 1);
      assert.ok(r.expiredApprovals >= 1);
      const run = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.id, runId))
        .limit(1);
      assert.equal(run[0].status, "failed");
      const appr = await db
        .select()
        .from(approvals)
        .where(eq(approvals.runId, runId))
        .limit(1);
      assert.equal(appr[0].status, "expired");
    } finally {
      await db.delete(approvals).where(eq(approvals.runId, runId));
      await db.delete(agentRuns).where(eq(agentRuns.id, runId));
    }
  });
});

describe("migrasi 0007", () => {
  it("file migrasi index ada dan membuat index", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "drizzle/0007_xgolda_indexes.sql"),
      "utf8"
    );
    assert.match(sql, /CREATE INDEX `messages_session_id_idx`/i);
    assert.match(sql, /CREATE INDEX `agent_runs_status_idx`/i);
    assert.match(sql, /CREATE INDEX `vector_metadata_source_idx`/i);
  });
});
