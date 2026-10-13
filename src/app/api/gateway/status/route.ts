import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { at: number; data: unknown } | null = null;
const TTL_MS = 5 * 60 * 1000;

/**
 * GET /api/gateway/status — kesehatan gateway + jumlah model per kemampuan.
 * → { ok, latencyMs, models: { chat, image, tts, embedding, web, stt, vision } }
 */
export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json({ ...(cache.data as object), cached: true });
  }
  const cfg = await getConfig();
  const base = cfg.values.INTERNAL_INFERENCE_ENDPOINT;
  const headers = { Authorization: `Bearer ${env.gatewayToken()}` };
  try {
    const t0 = Date.now();
    const health = await fetch(`${base.replace(/\/v1$/, "")}/api/health`, {
      headers,
      signal: AbortSignal.timeout(15000),
    }).then((r) => r.json()).catch(() => null);
    const caps = ["chat", "image", "tts", "embedding", "web", "stt"] as const;
    const counts: Record<string, number> = {};
    await Promise.all(
      caps.map(async (c) => {
        try {
          const p = c === "chat" ? "/models" : `/models/${c}`;
          const r = await fetch(`${base}${p}`, {
            headers,
            signal: AbortSignal.timeout(20000),
          });
          const j = await r.json();
          counts[c] = Array.isArray(j.data) ? j.data.length : 0;
        } catch {
          counts[c] = 0;
        }
      })
    );
    // vision: endpoint discovery terpisah
    try {
      const r = await fetch(`${base}/models/image-to-text`, {
        headers,
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      counts["vision"] = Array.isArray(j.data) ? j.data.length : 0;
    } catch {
      counts["vision"] = 0;
    }
    const data = {
      ok: health?.ok === true,
      latencyMs: Date.now() - t0,
      endpoint: base,
      models: counts,
      cached: false,
    };
    cache = { at: now, data };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), models: {} },
      { status: 502 }
    );
  }
}
