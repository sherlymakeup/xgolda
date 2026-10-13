import fs from "node:fs";
import path from "node:path";
import { eq, ne } from "drizzle-orm";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { agentRuns, messages, sessions, vectorMetadata } from "@/db/schema";
import { getWorkspaceRoot } from "@/lib/agent/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOADS_DIR = path.resolve(process.cwd(), "storage", "uploads");
const UPLOAD_EXTS = ["png", "jpg", "webp", "gif"];

function parseAttachmentIds(raw: string): string[] {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr)
      ? arr.filter((a) => a && typeof a.id === "string").map((a) => a.id as string)
      : [];
  } catch {
    return [];
  }
}

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
  const updated = await db
    .update(sessions)
    .set(patch)
    .where(eq(sessions.id, params.id))
    .returning({ id: sessions.id });
  if (updated.length === 0) {
    return Response.json({ error: "Sesi tidak ditemukan" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

/** DELETE /api/sessions/[id] — hapus sesi + seluruh sampahnya.
 * Sesi tidak ditemukan → 404 (sebelumnya selalu ok:true).
 * Yang dibersihkan: run sesi (cascade tool_executions + approvals),
 * memori sesi (vector_metadata source memory:<sid>), file upload yang
 * hanya dirujuk sesi ini, folder workspace sesi, lalu sesi (cascade
 * messages). Artifact sesi dibiarkan (set null) — output GENERATED tetap
 * bisa dilihat setelah sesi dihapus.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = getDb();
  const sid = params.id;
  const existing = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sid))
    .limit(1);
  if (existing.length === 0) {
    return Response.json({ error: "Sesi tidak ditemukan" }, { status: 404 });
  }

  // 1. Upload: hapus file yang HANYA dirujuk pesan sesi ini.
  try {
    const mine = await db
      .select({ attachmentsJson: messages.attachmentsJson })
      .from(messages)
      .where(eq(messages.sessionId, sid));
    const myIds = new Set<string>();
    for (const m of mine) for (const id of parseAttachmentIds(m.attachmentsJson)) myIds.add(id);
    if (myIds.size > 0) {
      const others = await db
        .select({ attachmentsJson: messages.attachmentsJson })
        .from(messages)
        .where(ne(messages.sessionId, sid));
      const stillReferenced = new Set<string>();
      for (const m of others) {
        for (const id of parseAttachmentIds(m.attachmentsJson)) stillReferenced.add(id);
      }
      for (const id of Array.from(myIds)) {
        if (stillReferenced.has(id)) continue;
        for (const ext of UPLOAD_EXTS) {
          try {
            const p = path.join(UPLOADS_DIR, `${id}.${ext}`);
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch {
            /* abaikan */
          }
        }
      }
    }
  } catch {
    /* cleanup upload gagal bukan fatal */
  }

  // 2. Run sesi ini (cascade: tool_executions + approvals via runId).
  await db.delete(agentRuns).where(eq(agentRuns.sessionId, sid));
  // 3. Memori jangka panjang sesi ini.
  await db.delete(vectorMetadata).where(eq(vectorMetadata.source, `memory:${sid}`));
  // 4. Folder workspace sesi (termasuk .delegates/).
  try {
    const root = await getWorkspaceRoot();
    fs.rmSync(path.join(root, sid), { recursive: true, force: true });
  } catch {
    /* abaikan */
  }
  // 5. Sesi (cascade: messages).
  await db.delete(sessions).where(eq(sessions.id, sid));
  return Response.json({ ok: true });
}
