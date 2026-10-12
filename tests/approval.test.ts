import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../src/db/index.ts";
import { approvals, agentRuns, sessions } from "../src/db/schema.ts";
import { requestApproval, decideApproval } from "../src/lib/agent/approval.ts";
import { terminalExecTool } from "../src/lib/tools/terminal.ts";

const IS_WIN = process.platform === "win32";
const db = getDb();
const sessionId = nanoid();
const runId = nanoid();

before(async () => {
  const now = Date.now();
  await db
    .insert(sessions)
    .values({ id: sessionId, title: "test approval", createdAt: now, updatedAt: now });
  await db.insert(agentRuns).values({
    id: runId,
    sessionId,
    goal: "test approval gate",
    status: "running",
    createdAt: now,
    updatedAt: now,
  });
});

after(async () => {
  await db.delete(approvals).where(eq(approvals.runId, runId));
  await db.delete(agentRuns).where(eq(agentRuns.id, runId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
});

describe("approval gate", () => {
  it("perintah berbahaya → pending → approved → jalan", async () => {
    const cmd = IS_WIN ? "Write-Output 'dihapus'" : "echo dihapus";
    // 'rm -rf' palsu: flag berbahaya, tapi perintah aman yang diuji eksekusinya
    const dangerousEcho = IS_WIN
      ? `Write-Output 'x'; # rm -rf`
      : `echo x # rm -rf`;
    assert.equal(
      (await import("../src/lib/tools/terminal-guard.ts")).classifyCommand(dangerousEcho).dangerous,
      true
    );

    const promise = terminalExecTool.handler(
      { command: dangerousEcho },
      { runId, sessionId }
    );
    // beri waktu tool insert approval, lalu setujui
    await new Promise((r) => setTimeout(r, 1200));
    const rows = await db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));
    const pending = rows.find((a) => a.status === "pending");
    assert.ok(pending, "approval pending harus tercatat di DB");
    assert.ok(pending!.reason.length > 0);
    const ok = await decideApproval(pending!.id, "approved");
    assert.equal(ok, true);

    const result = await promise;
    assert.equal(result.ok, true);
    assert.match(result.output, /x/);
    void cmd;
  });

  it("perintah berbahaya → rejected → tidak jalan", async () => {
    const promise = terminalExecTool.handler(
      { command: IS_WIN ? "Write-Output 'y'; # del /s" : "echo y # rm -rf" },
      { runId, sessionId }
    );
    await new Promise((r) => setTimeout(r, 1200));
    const rows = await db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));
    const pending = rows.filter((a) => a.status === "pending").pop();
    assert.ok(pending);
    await decideApproval(pending!.id, "rejected");
    const result = await promise;
    assert.equal(result.ok, false);
    assert.match(result.output, /DITOLAK/);
  });

  it("tanpa keputusan → expired (fail-closed)", async () => {
    const t0 = Date.now();
    const result = await requestApproval(
      {
        runId,
        sessionId,
        toolName: "terminal_exec",
        command: "rm -rf /tmp/xyz-test",
        args: {},
        reason: "test",
      },
      { timeoutMs: 2500 }
    );
    const dt = Date.now() - t0;
    assert.equal(result, "expired");
    assert.ok(dt >= 2000 && dt < 10000, `waktu tunggu aneh: ${dt}ms`);
  });

  it("tanpa runId → langsung rejected (fail-closed)", async () => {
    const result = await terminalExecTool.handler(
      { command: IS_WIN ? "Write-Output 'z'; # format D:" : "echo z # dd of=/dev/x" },
      {}
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /DITOLAK/);
  });

  it("decideApproval hanya dari pending", async () => {
    const ok1 = await decideApproval("id-tidak-ada", "approved");
    assert.equal(ok1, false);
    // yang sudah expired tidak bisa diubah
    const expired = await db
      .select()
      .from(approvals)
      .where(eq(approvals.status, "expired"))
      .limit(1);
    if (expired.length > 0) {
      const ok2 = await decideApproval(expired[0].id, "approved");
      assert.equal(ok2, false);
    }
  });

  it("perintah normal tidak kena gate", async () => {
    const result = await terminalExecTool.handler(
      { command: IS_WIN ? "Write-Output 'aman'" : "echo aman" },
      { runId, sessionId }
    );
    assert.equal(result.ok, true);
    assert.match(result.output, /aman/);
  });
});
