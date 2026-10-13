import fs from "node:fs";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { artifacts } from "@/db/schema";
import { assertSafePath } from "@/lib/security/path-jail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function find(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, id))
    .limit(1);
  return { db, row: rows[0] };
}

/** GET /api/artifacts/[id] — baca satu artifact (DB; fallback baca file). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { row } = await find(params.id);
  if (!row) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });

  let sourceCode = row.sourceCode;
  try {
    const target = assertSafePath(row.filename);
    if (fs.existsSync(target)) sourceCode = fs.readFileSync(target, "utf8");
  } catch {
    /* pakai yang di DB */
  }
  return Response.json({
    id: row.id,
    filename: row.filename,
    language: row.language,
    sessionId: row.sessionId,
    sourceCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** PUT dihapus (2026-10-13): tidak ada pemanggil di codebase, dan menulis
 * sourceCode sebagai UTF-8 bisa merusak artifact biner (mp3/png).
 * Update artifact lewat POST /api/artifacts (buat baru) atau tool agen. */

/** DELETE /api/artifacts/[id] — hapus DB + file. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { db, row } = await find(params.id);
  if (!row) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  try {
    const target = assertSafePath(row.filename);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch {
    /* abaikan */
  }
  await db.delete(artifacts).where(eq(artifacts.id, params.id));
  return Response.json({ ok: true });
}
