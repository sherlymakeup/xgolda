import fs from "node:fs";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { artifacts } from "@/db/schema";
import {
  assertSafePath,
  ensureArtifactsDir,
} from "@/lib/security/path-jail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["tsx", "jsx"].includes(ext)) return "tsx";
  if (["ts", "mts", "cts"].includes(ext)) return "ts";
  if (["js", "mjs", "cjs"].includes(ext)) return "js";
  if (ext === "py") return "python";
  if (["css", "json", "md", "html", "sql"].includes(ext)) return ext;
  return "text";
}

/** GET /api/artifacts — daftar artifact. */
export async function GET() {
  const db = getDb();
  const rows = await db
    .select()
    .from(artifacts)
    .orderBy(desc(artifacts.updatedAt));
  return Response.json({
    artifacts: rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      language: r.language,
      sessionId: r.sessionId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
}

/**
 * POST /api/artifacts — simpan artifact baru (DB + file di ./storage/artifacts/).
 * Body: { filename, sourceCode, sessionId?, language? }
 * Urutan: insert DB dulu → tulis file → bila tulis gagal, baris DB dihapus
 * (kompensasi) supaya tidak ada file yatim / baris tanpa file. Nama duplikat
 * ditolak (409) agar tidak menimpa artifact lain diam-diam.
 */
export async function POST(req: NextRequest) {
  let body: {
    filename?: string;
    sourceCode?: string;
    sessionId?: string;
    language?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const filename = (body.filename || "").trim();
  const sourceCode = body.sourceCode ?? "";
  if (!filename) {
    return Response.json({ error: "filename wajib" }, { status: 400 });
  }
  // Batas ukuran: artifact teks tanpa batas = pengisian disk dari satu POST.
  const MAX_SOURCE_BYTES = 1 * 1024 * 1024;
  if (Buffer.byteLength(sourceCode, "utf8") > MAX_SOURCE_BYTES) {
    return Response.json({ error: "sourceCode maksimal 1MB" }, { status: 413 });
  }

  let target: string;
  try {
    ensureArtifactsDir();
    target = assertSafePath(filename);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Path tidak valid" },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  const dup = await db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(eq(artifacts.filename, filename))
    .limit(1);
  if (dup.length > 0) {
    return Response.json(
      { error: `filename sudah ada: ${filename} (pakai nama lain)` },
      { status: 409 }
    );
  }
  try {
    await db.insert(artifacts).values({
      id,
      sessionId: body.sessionId,
      filename,
      language: body.language || detectLanguage(filename),
      sourceCode,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    return Response.json(
      { error: "Gagal menyimpan artifact (sessionId tidak valid?)" },
      { status: 400 }
    );
  }
  try {
    fs.writeFileSync(target, sourceCode, "utf8");
  } catch (e) {
    // Kompensasi: file gagal ditulis → hapus baris DB agar tidak yatim.
    await db.delete(artifacts).where(eq(artifacts.id, id));
    return Response.json(
      { error: e instanceof Error ? e.message : "Gagal menulis file" },
      { status: 500 }
    );
  }
  return Response.json({ id, filename }, { status: 201 });
}
