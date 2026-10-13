import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { agentRuns, messages } from "@/db/schema";
import { runAgentLoop } from "@/lib/agent/engine";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/run — picu autonomous loop.
 * Body: { goal, sessionId?, model?, userText? } -> { runId } (langsung kembali, loop jalan di background)
 * Bila sessionId ada, pesan user ikut disimpan ke sesi agar riwayat chat utuh.
 */
export async function POST(req: NextRequest) {
  let body: { goal?: string; sessionId?: string; model?: string; userText?: string };
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
  const cfg = await getConfig();
  await db.insert(agentRuns).values({
    id: runId,
    sessionId: body.sessionId,
    goal,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });

  if (body.sessionId) {
    await db.insert(messages).values({
      id: nanoid(),
      sessionId: body.sessionId,
      role: "user",
      content: (body.userText || goal).slice(0, 4000),
      reasoningContent: "",
      createdAt: now,
    });
  }

  // Fire-and-forget: status bisa di-poll via GET /api/agent/[id]/status
  runAgentLoop({
    runId,
    goal,
    sessionId: body.sessionId,
    model: body.model || cfg.values.DEFAULT_MODEL,
  }).catch((e) => {
    console.error(
      "[agent/run] loop gagal:",
      e instanceof Error ? e.message : e
    );
  });

  return Response.json({ runId, status: "queued" }, { status: 202 });
}
