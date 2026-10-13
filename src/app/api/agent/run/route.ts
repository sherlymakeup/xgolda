import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
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
  let body: {
    goal?: string;
    sessionId?: string;
    model?: string;
    userText?: string;
    attachments?: { id?: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const goal = (body.goal || "").trim();
  if (!goal) {
    return Response.json({ error: "Goal kosong" }, { status: 400 });
  }
  // Lampiran gambar (vision): validasi id, maks 4 — disimpan ke pesan user
  // agar agen menerima gambar via buildChatContext DAN thumbnail tetap ada
  // setelah reload (sebelumnya attachments tidak pernah sampai ke agen).
  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .filter((a) => a && typeof a.id === "string" && /^[A-Za-z0-9_-]{8,32}$/.test(a.id))
    .slice(0, 4)
    .map((a) => ({ id: a.id as string }));

  const db = getDb();
  // Rate limit: maks 3 run aktif bersamaan — banjir run tak terbatas
  // menghabiskan biaya LLM + CPU + DB (tanpa auth, proses lokal mana pun
  // bisa memicu run).
  const active = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(inArray(agentRuns.status, ["queued", "planning", "running"]));
  if (active.length >= 3) {
    return Response.json(
      { error: "Terlalu banyak run aktif (maks 3) — tunggu satu selesai." },
      { status: 429 }
    );
  }
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
      attachmentsJson: JSON.stringify(attachments),
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
