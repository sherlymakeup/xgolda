import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { messages, sessions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions/[id] — detail sesi + pesan. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = getDb();
  const s = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, params.id))
    .limit(1);
  if (s.length === 0) {
    return Response.json({ error: "Sesi tidak ditemukan" }, { status: 404 });
  }
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, params.id))
    .orderBy(messages.createdAt);
  return Response.json({ session: s[0], messages: msgs });
}

/** PATCH /api/sessions/[id] — rename / pin. Body: { title?, pinned? } */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const patch: Partial<{ title: string; pinned: boolean; updatedAt: number }> = {
    updatedAt: Date.now(),
  };
  if (typeof body.title === "string") patch.title = body.title.slice(0, 120);
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  const db = getDb();
  await db.update(sessions).set(patch).where(eq(sessions.id, params.id));
  return Response.json({ ok: true });
}

/** DELETE /api/sessions/[id] — hapus sesi + pesan (cascade). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, params.id));
  return Response.json({ ok: true });
}
