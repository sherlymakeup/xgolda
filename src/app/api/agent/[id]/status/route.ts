import { asc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { agentRuns, approvals, toolExecutions } from "@/db/schema";
import { getSessionWorkspace } from "@/lib/agent/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/agent/[id]/status — polling status run + langkah tool. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = getDb();
  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, params.id))
    .limit(1);
  if (runs.length === 0) {
    return Response.json({ error: "Run tidak ditemukan" }, { status: 404 });
  }
  const run = runs[0];
  let workspaceDir: string | null = null;
  try {
    if (run.sessionId) workspaceDir = await getSessionWorkspace(run.sessionId);
  } catch {
    /* abaikan */
  }
  const steps = await db
    .select()
    .from(toolExecutions)
    .where(eq(toolExecutions.runId, params.id))
    .orderBy(asc(toolExecutions.createdAt));

  let plan: unknown = [];
  try {
    plan = JSON.parse(run.planTreeJson || "[]");
  } catch {
    plan = [];
  }

  const approvalRows = await db
    .select()
    .from(approvals)
    .where(eq(approvals.runId, params.id))
    .orderBy(asc(approvals.createdAt));

  return Response.json({
    run: {
      id: run.id,
      goal: run.goal,
      status: run.status,
      currentStep: run.currentStep,
      error: run.error,
      resultText: run.resultText,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt,
      workspaceDir,
    },
    plan,
    steps: steps.map((s) => ({
      id: s.id,
      toolName: s.toolName,
      args: safeJson(s.argsJson),
      result: safeJson(s.resultJson),
      durationMs: s.durationMs,
      exitCode: s.exitCode,
      createdAt: s.createdAt,
    })),
    approvals: approvalRows.map((a) => ({
      id: a.id,
      toolName: a.toolName,
      command: a.command,
      reason: a.reason,
      status: a.status,
      createdAt: a.createdAt,
      decidedAt: a.decidedAt,
    })),
  });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
