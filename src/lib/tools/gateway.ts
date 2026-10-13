/**
 * Helper bersama untuk memanggil 9Router gateway dari tool agen.
 * Endpoint & nama model SELALU dari getConfig() (UI > .env > default),
 * token dari env.gatewayToken(). Tidak pernah throw — selalu return result.
 */
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { getDb } from "../../db/index.ts";
import { artifacts } from "../../db/schema.ts";
import { getConfig, type ConfigKey } from "../config.ts";
import { env } from "../env.ts";
import { getSessionWorkspace } from "../agent/workspace.ts";
import { assertSafePath, ensureArtifactsDir } from "../security/path-jail.ts";

export interface GatewayCall {
  path: string;
  body: Record<string, unknown>;
  timeoutMs: number;
}

export type GatewayResult =
  | { ok: true; status: number; json: any; raw: Buffer }
  | { ok: false; status: number; error: string };

/** POST JSON ke gateway. Binary response (mp3/png) dikembalikan via `raw`. */
export async function gatewayPost(call: GatewayCall): Promise<GatewayResult> {
  let base: string;
  let token: string;
  try {
    const cfg = await getConfig();
    base = cfg.values.INTERNAL_INFERENCE_ENDPOINT.replace(/\/+$/, "");
    token = env.gatewayToken();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, error: `Konfigurasi gateway: ${msg}` };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), call.timeoutMs);
  try {
    const res = await fetch(`${base}${call.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(call.body),
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `Gateway HTTP ${res.status}: ${buf.toString("utf8").slice(0, 300)}`,
      };
    }
    let json: any = null;
    try {
      json = JSON.parse(buf.toString("utf8"));
    } catch {
      /* respons binary (audio/gambar) — pakai raw */
    }
    return { ok: true, status: res.status, json, raw: buf };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /abort/i.test(msg);
    return {
      ok: false,
      status: 0,
      error: timedOut
        ? `Gateway timeout setelah ${call.timeoutMs}ms`
        : `Gateway error: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Ambil nama model untuk satu capability dari config efektif. */
export async function gatewayModel(
  key: Extract<ConfigKey, "WEB_SEARCH_MODEL" | "WEB_FETCH_MODEL" | "IMAGE_MODEL" | "TTS_MODEL">
): Promise<string> {
  const cfg = await getConfig();
  return cfg.values[key];
}

/**
 * Simpan file binary (gambar/audio) ke ./storage/artifacts/ + catat di DB artifacts.
 * Bila sessionId ada, file JUGA disalin ke folder workspace thread
 * (<AGENT_WORKSPACE_ROOT>/<sessionId>/) — supaya file hasil generate muncul
 * di Explorer/Studio WORKSPACE & lolos verifikasi disk (yang hanya memeriksa
 * folder workspace). Salinan workspace best-effort: gagal menyalin tidak
 * menggagalkan tool (copy utama di artifacts store sudah tersimpan).
 * Mengembalikan nama file.
 */
export async function saveBinaryArtifact(
  filename: string,
  data: Buffer,
  language: string,
  sessionId?: string
): Promise<string> {
  ensureArtifactsDir();
  const target = assertSafePath(filename);
  fs.writeFileSync(target, data);
  const now = Date.now();
  await getDb().insert(artifacts).values({
    id: nanoid(),
    sessionId: sessionId ?? null,
    filename,
    language,
    sourceCode: "",
    createdAt: now,
    updatedAt: now,
  });
  if (sessionId) {
    try {
      const wsDir = await getSessionWorkspace(sessionId);
      fs.writeFileSync(path.join(wsDir, path.basename(filename)), data);
    } catch {
      /* abaikan — copy utama di artifacts store sudah tersimpan */
    }
  }
  return filename;
}
