import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOADS_DIR = path.resolve(process.cwd(), "storage", "uploads");
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function ensureDir(): string {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}

/**
 * POST /api/uploads — upload gambar untuk vision chat.
 * multipart/form-data, field "file". Hanya gambar ≤10MB.
 * → { id, mime, size }
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body harus multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Field 'file' wajib diisi" }, { status: 400 });
  }
  const mime = (file.type || "").toLowerCase();
  const ext = ALLOWED[mime];
  if (!ext) {
    return NextResponse.json(
      { error: `Tipe file tidak didukung: ${mime || "?"}. Hanya PNG/JPEG/WebP/GIF.` },
      { status: 415 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File maksimal 10MB" }, { status: 413 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File kosong" }, { status: 400 });
  }
  const id = nanoid(16);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(ensureDir(), `${id}.${ext}`), buf);
  return NextResponse.json({ id, mime, size: file.size }, { status: 201 });
}
