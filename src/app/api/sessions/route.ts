import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { messages, sessions } from "@/db/schema";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions — daftar sesi (terbaru dulu). */
export async function GET() {
  const db = getDb();
  const rows = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.updatedAt))
    .limit(100);
  return Response.json({ sessions: rows });
}

/** POST /api/sessions — buat sesi baru. Body opsional: { title?, model?, temperature? } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  await db.insert(sessions).values({
    id,
    title: String(body.title || "Percakapan baru").slice(0, 120),
    model: String(body.model || env.defaultModel),
    temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
    createdAt: now,
    updatedAt: now,
  });
  return Response.json({ id }, { status: 201 });
}
