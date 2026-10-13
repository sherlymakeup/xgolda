import fs from "node:fs";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { artifacts } from "@/db/schema";
import { assertSafePath } from "@/lib/security/path-jail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

/**
 * GET /api/artifacts/[id]/raw — serve byte mentah untuk preview media
 * (gambar & audio). Hanya ekstensi media yang diizinkan.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, params.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  }
  const ext = row.filename.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext];
  if (!mime) {
    return Response.json(
      { error: "Tipe file tidak didukung untuk preview mentah" },
      { status: 415 }
    );
  }
  let target: string;
  try {
    target = assertSafePath(row.filename);
  } catch {
    return Response.json({ error: "Path tidak aman" }, { status: 400 });
  }
  if (!fs.existsSync(target)) {
    return Response.json({ error: "File tidak ada" }, { status: 404 });
  }
  const buf = fs.readFileSync(target);
  return new Response(buf, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=60",
    },
  });
}
