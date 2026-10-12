import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { agentRuns } from "@/db/schema";
import { runAgentLoop } from "@/lib/agent/engine";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/run — picu autonomous loop.
 * Body: { goal, sessionId?, model? } -> { runId } (langsung kembali, loop jalan di background)
 */
export async function POST(req: NextRequest) {
  let body: { goal?: string; sessionId?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const goal = (body.goal || "").trim();
  if (!goal) {
    return Response.json({ error: "Goal kosong" }, { status: 400 });
  }

  const db = getDb();
  const runId = nanoid();
  const now = Date.now();
  await db.insert(agentRuns).values({
    id: runId,
    sessionId: body.sessionId,
    goal,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });

  // Fire-and-forget: status bisa di-poll via GET /api/agent/[id]/status
  runAgentLoop({
    runId,
    goal,
    sessionId: body.sessionId,
    model: body.model || env.defaultModel,
  }).catch((e) => {
    console.error(
      "[agent/run] loop gagal:",
      e instanceof Error ? e.message : e
    );
  });

  return Response.json({ runId, status: "queued" }, { status: 202 });
}
