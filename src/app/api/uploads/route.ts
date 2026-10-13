import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { messages } from "@/db/schema";

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

/** Validasi magic bytes — MIME dari client (FormData) tidak bisa dipercaya. */
function magicMatches(buf: Buffer, ext: string): boolean {
  if (ext === "png") {
    return (
      buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
    );
  }
  if (ext === "jpg") {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (ext === "gif") {
    return (
      buf.length >= 6 &&
      (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a")
    );
  }
  if (ext === "webp") {
    return (
      buf.length >= 12 &&
      buf.toString("ascii", 0, 4) === "RIFF" &&
      buf.toString("ascii", 8, 12) === "WEBP"
    );
  }
  return false;
}

/**
 * Hapus file upload yatim (tidak dirujuk pesan mana pun) yang lebih tua
 * dari 7 hari — upload sebelumnya tidak pernah dibersihkan. Best-effort.
 */
async function sweepOrphanUploads(): Promise<void> {
  try {
    const db = getDb();
    const rows = await db.select({ attachmentsJson: messages.attachmentsJson }).from(messages);
    const referenced = new Set<string>();
    for (const r of rows) {
      try {
        const arr = JSON.parse(r.attachmentsJson || "[]");
        if (Array.isArray(arr)) {
          for (const a of arr) if (a && typeof a.id === "string") referenced.add(a.id);
        }
      } catch {
        /* abaikan baris rusak */
      }
    }
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(UPLOADS_DIR)) {
      const id = name.split(".")[0];
      const full = path.join(UPLOADS_DIR, name);
      if (referenced.has(id)) continue;
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        /* abaikan */
      }
    }
  } catch {
    /* sweep gagal bukan fatal */
  }
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
  if (!magicMatches(buf, ext)) {
    return NextResponse.json(
      { error: `Isi file tidak cocok dengan tipe ${mime} (magic bytes tidak valid)` },
      { status: 415 }
    );
  }
  fs.writeFileSync(path.join(ensureDir(), `${id}.${ext}`), buf);
  await sweepOrphanUploads();
  return NextResponse.json({ id, mime, size: file.size }, { status: 201 });
}
