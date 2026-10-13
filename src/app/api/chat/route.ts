import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { messages, sessions } from "@/db/schema";
import { streamChat } from "@/lib/ai/client";
import { buildChatSystemPrompt } from "@/lib/ai/prompt-templates";
import { buildChatContext } from "@/lib/agent/context";
import { getConfig } from "@/lib/config";
import { toGatewayError } from "@/lib/security/sanitization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  sessionId?: string;
  message: string;
  model?: string;
  temperature?: number;
  /** ID upload gambar (dari POST /api/uploads) — maks 4 per pesan. */
  attachments?: { id: string }[];
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/chat — SSE streaming: reasoning + content + done.
 * Body: { sessionId?, message, model?, temperature? }
 */
export async function POST(req: NextRequest) {
  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const userText = (body.message || "").trim();
  // Validasi lampiran: hanya ID nanoid valid, maks 4
  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .filter((a) => a && typeof a.id === "string" && /^[A-Za-z0-9_-]{8,32}$/.test(a.id))
    .slice(0, 4)
    .map((a) => ({ id: a.id }));
  if (!userText && attachments.length === 0) {
    return Response.json({ error: "Pesan kosong" }, { status: 400 });
  }

  const db = getDb();
  const now = Date.now();

  // Buat sesi baru bila belum ada
  let sessionId = body.sessionId;
  if (sessionId) {
    const existing = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (existing.length === 0) sessionId = undefined;
  }
  if (!sessionId) {
    sessionId = nanoid();
    const cfg = await getConfig();
    await db.insert(sessions).values({
      id: sessionId,
      title: userText.slice(0, 60) || "Percakapan baru",
      model: body.model || cfg.values.DEFAULT_MODEL,
      temperature: body.temperature ?? 0.7,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.id, sessionId));
  }
  const sid = sessionId;

  await db.insert(messages).values({
    id: nanoid(),
    sessionId: sid,
    role: "user",
    content: userText,
    attachmentsJson: JSON.stringify(attachments),
    createdAt: now,
  });

  const history = await buildChatContext(sid, await buildChatSystemPrompt());
  const started = Date.now();
  let reasoning = "";
  let content = "";
  const assistantId = nanoid();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const push = (data: unknown) =>
        controller.enqueue(enc.encode(sse(data)));
      try {
        // Kirim sessionId dulu agar frontend bisa attach
        push({ type: "session", sessionId: sid });

        await streamChat(history, {
          model: body.model,
          temperature: body.temperature,
          signal: req.signal,
          onEvent: async (e) => {
            if (e.type === "reasoning") {
              reasoning += e.delta;
              push({ type: "reasoning", delta: e.delta });
            } else if (e.type === "content") {
              content += e.delta;
              push({ type: "content", delta: e.delta });
            } else {
              push(e);
            }
          },
        });

        const latencyMs = Date.now() - started;
        push({
          type: "done",
          tokens: 0,
          latencyMs,
          sessionId: sid,
          messageId: assistantId,
        });
        // Terminator mentah sesuai kontrak SSE (bukan JSON)
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          // Client menutup koneksi — simpan parsial lalu selesai
        } else {
          const gw = toGatewayError(e);
          push({ type: "error", error: gw.error, code: gw.code });
        }
      } finally {
        // Simpan pesan asisten (lengkap atau parsial)
        try {
          if (reasoning || content) {
            await db.insert(messages).values({
              id: assistantId,
              sessionId: sid,
              role: "assistant",
              content,
              reasoningContent: reasoning,
              createdAt: Date.now(),
            });
            await db
              .update(sessions)
              .set({ updatedAt: Date.now() })
              .where(eq(sessions.id, sid));
          }
        } catch (dbErr) {
          console.error(
            "[chat] gagal simpan pesan:",
            dbErr instanceof Error ? dbErr.message : dbErr
          );
        }
        controller.close();
      }
    },
    cancel() {
      // req.signal sudah diteruskan ke fetch gateway
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** GET /api/chat?sessionId=... — ambil riwayat pesan sesi. */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId wajib" }, { status: 400 });
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt);
  return Response.json({ messages: rows });
}
