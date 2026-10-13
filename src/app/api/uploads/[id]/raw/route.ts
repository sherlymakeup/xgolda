import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOADS_DIR = path.resolve(process.cwd(), "storage", "uploads");
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * GET /api/uploads/[id]/raw — serve byte gambar untuk preview thumbnail.
 * ID tervalidasi alfanumerik (nanoid) → tidak ada path traversal.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params.id || "";
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
  }
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    const p = path.join(UPLOADS_DIR, `${id}.${ext}`);
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": mime,
          "Content-Length": String(buf.length),
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }
  return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
}
