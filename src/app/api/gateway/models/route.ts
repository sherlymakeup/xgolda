import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cache 5 menit PER CAPABILITY agar dropdown model tidak menghantam gateway tiap buka. */
const cache = new Map<string, { at: number; data: { id: string; owned_by: string }[] }>();
const TTL_MS = 5 * 60 * 1000;

/**
 * GET /api/gateway/models?capability=chat|image|tts|embedding|web|stt
 * → { models: [{ id, owned_by }] } — daftar model asli dari gateway.
 */
export async function GET(req: NextRequest) {
  const capability = new URL(req.url).searchParams.get("capability") || "chat";
  const allowed = ["chat", "image", "tts", "embedding", "web", "stt"];
  if (!allowed.includes(capability)) {
    return NextResponse.json({ error: "capability tidak valid" }, { status: 400 });
  }
  const now = Date.now();
  const hit = cache.get(capability);
  if (hit && now - hit.at < TTL_MS) {
    return NextResponse.json({ models: hit.data, cached: true });
  }
  try {
    const cfg = await getConfig();
    const path = capability === "chat" ? "/models" : `/models/${capability}`;
    const r = await fetch(`${cfg.values.INTERNAL_INFERENCE_ENDPOINT}${path}`, {
      headers: { Authorization: `Bearer ${env.gatewayToken()}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`Gateway HTTP ${r.status}`);
    const j = await r.json();
    const models = (j.data || []).map((d: { id: string; owned_by: string }) => ({
      id: d.id,
      owned_by: d.owned_by || "?",
    }));
    cache.set(capability, { at: now, data: models });
    return NextResponse.json({ models, cached: false });
  } catch (e) {
    // Fallback: kembalikan model default agar UI tetap bisa dipakai
    const cfg = await getConfig();
    return NextResponse.json({
      models: [{ id: cfg.values.DEFAULT_MODEL, owned_by: "default" }],
      cached: false,
      warning: e instanceof Error ? e.message : String(e),
    });
  }
}
