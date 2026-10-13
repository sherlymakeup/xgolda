import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { agentRuns } from "@/db/schema";
import { subscribeRun, subscribeRunWithReplay, type RunEvent } from "@/lib/agent/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/stream?runId=<id> — SSE: token jawaban final + status run.
 * Client (AgentPanel) subscribe untuk streaming respons agen.
 */
export async function GET(req: NextRequest) {
  const runId = new URL(req.url).searchParams.get("runId");
  if (!runId) {
    return Response.json({ error: "runId wajib" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  if (rows.length === 0) {
    return Response.json({ error: "Run tidak ditemukan" }, { status: 404 });
  }
  const run = rows[0];
  const alreadyDone = run.status === "completed" || run.status === "failed";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: RunEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* controller sudah ditutup */
        }
      };
      // Snapshot: bila run sudah selesai, langsung kirim hasil final
      if (alreadyDone) {
        if (run.resultText) send({ type: "final", text: run.resultText });
        send({ type: "done", status: run.status as "completed" | "failed" });
        controller.close();
        return;
      }
      const { unsubscribe: unsub, buffered } = subscribeRunWithReplay(runId, send);
      // Replay event yang sudah ter-emit sebelum subscribe (ack/plan/done)
      for (const e of buffered) send(e);
      // Keepalive agar koneksi tidak diputus diam-diam
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          /* abaikan */
        }
      }, 15000);
      const cleanup = () => {
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {
          /* abaikan */
        }
      };
      // Bila run selesai di jeda antara baca DB dan subscribe, buffer
      // berisi `done` — tutup stream setelah replay (mirip closer).
      if (buffered.some((e) => e.type === "done")) {
        setTimeout(cleanup, 500);
      }
      req.signal.addEventListener("abort", cleanup);
      // Tutup otomatis saat run selesai (hemat koneksi)
      const closer = subscribeRun(runId, (e) => {
        if (e.type === "done") {
          setTimeout(() => {
            closer();
            cleanup();
          }, 500);
        }
      });
    },
    cancel() {
      /* cleanup via abort listener */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
