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

/** PUT /api/artifacts/[id] — update source (DB + file). Body: { sourceCode, filename? } */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { db, row } = await find(params.id);
  if (!row) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });

  let body: { sourceCode?: string; filename?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const filename = (body.filename || row.filename).trim();
  const sourceCode = body.sourceCode ?? row.sourceCode;
  const renamed = filename !== row.filename;

  try {
    const target = assertSafePath(filename);
    fs.writeFileSync(target, sourceCode, "utf8");
    // S-07: bila rename, hapus file lama agar tidak jadi yatim di disk
    if (renamed) {
      try {
        const oldTarget = assertSafePath(row.filename);
        if (oldTarget !== target && fs.existsSync(oldTarget)) {
          fs.unlinkSync(oldTarget);
        }
      } catch {
        /* abaikan — file lama tidak kritis */
      }
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Path tidak valid" },
      { status: 400 }
    );
  }
  await db
    .update(artifacts)
    .set({ filename, sourceCode, updatedAt: Date.now() })
    .where(eq(artifacts.id, params.id));
  return Response.json({ ok: true });
}

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
