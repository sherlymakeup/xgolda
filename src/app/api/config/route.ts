import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/config — nilai konfigurasi publik dari server.
 * Hanya yang aman ditampilkan (model, endpoint). Token TIDAK PERNAH dikirim.
 */
export async function GET() {
  return NextResponse.json({
    model: env.defaultModel,
    endpoint: env.inferenceEndpoint,
  });
}
