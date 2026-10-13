import { NextRequest, NextResponse } from "next/server";
import {
  clearConfigOverride,
  getConfig,
  isEditableKey,
  setConfigOverride,
} from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/config — konfigurasi efektif (UI > .env > default) + sumber tiap nilai.
 * Tidak pernah mengembalikan secret.
 */
export async function GET() {
  const cfg = await getConfig();
  return NextResponse.json({
    model: cfg.values.DEFAULT_MODEL,
    endpoint: cfg.values.INTERNAL_INFERENCE_ENDPOINT,
    values: cfg.values,
    sources: cfg.sources,
  });
}

/**
 * PUT /api/config — simpan override dari UI. Body: { key, value }.
 * Berlaku langsung tanpa restart. Key harus ada di allowlist.
 */
export async function PUT(req: NextRequest) {
  let body: { key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const key = String(body.key || "");
  if (!isEditableKey(key)) {
    return NextResponse.json({ error: `Key tidak diizinkan: ${key}` }, { status: 400 });
  }
  try {
    await setConfigOverride(key, String(body.value ?? ""));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, key });
}

/**
 * DELETE /api/config?key=X — hapus override, kembali ke .env/default.
 */
export async function DELETE(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!isEditableKey(key)) {
    return NextResponse.json({ error: `Key tidak diizinkan: ${key}` }, { status: 400 });
  }
  await clearConfigOverride(key);
  return NextResponse.json({ ok: true, key });
}
