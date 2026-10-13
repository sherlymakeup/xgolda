import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../src/db/index.ts";
import { agentRuns } from "../src/db/schema.ts";

describe("agent result_text", () => {
  it("menyimpan & membaca kembali jawaban final run", async () => {
    const db = getDb();
    const runId = nanoid();
    const now = Date.now();
    await db.insert(agentRuns).values({
      id: runId,
      goal: "test goal",
      status: "completed",
      resultText: "Jawaban final **tebal**",
      createdAt: now,
      updatedAt: now,
      finishedAt: now,
    });
    const rows = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].resultText, "Jawaban final **tebal**");
    await db.delete(agentRuns).where(eq(agentRuns.id, runId));
  });

  it("kolom opsional: run lama tanpa result_text terbaca null", async () => {
    const db = getDb();
    const runId = nanoid();
    const now = Date.now();
    await db.insert(agentRuns).values({
      id: runId,
      goal: "test goal",
      status: "failed",
      error: "boom",
      createdAt: now,
      updatedAt: now,
    });
    const rows = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    assert.equal(rows[0].resultText, null);
    await db.delete(agentRuns).where(eq(agentRuns.id, runId));
  });
});
