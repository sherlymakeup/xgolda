/**
 * Konfigurasi efektif XGOLDA — dibaca per-request (bukan sekali saat start).
 *
 * Urutan prioritas: UI (tabel app_config, diubah via halaman Update Config)
 *   > .env.local > default bawaan.
 * Perubahan via UI berlaku LANGSUNG tanpa restart server.
 *
 * Keamanan: hanya key di EDITABLE_CONFIG_KEYS yang boleh diubah via UI.
 * Secret (AI_GATEWAY_TOKEN), path DB, dan PORT TIDAK BOLEH via UI.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.ts";
import { appConfig } from "../db/schema.ts";

/** Key yang boleh diubah via UI. */
export const EDITABLE_CONFIG_KEYS = [
  "DEFAULT_MODEL",
  "INTERNAL_INFERENCE_ENDPOINT",
  "EMBEDDING_MODEL",
  "WEB_SEARCH_MODEL",
  "WEB_FETCH_MODEL",
  "IMAGE_MODEL",
  "TTS_MODEL",
  "AGENT_MAX_STEPS",
  "EXECUTION_TIMEOUT_MS",
  "APPROVAL_TIMEOUT_MS",
  "AI_RETRY_ATTEMPTS",
  "AI_RETRY_BASE_MS",
] as const;

export type ConfigKey = (typeof EDITABLE_CONFIG_KEYS)[number];

const DEFAULTS: Record<ConfigKey, string> = {
  DEFAULT_MODEL: "deepseek-ai/DeepSeek-R1",
  INTERNAL_INFERENCE_ENDPOINT: "http://localhost:20128/v1",
  EMBEDDING_MODEL: "text-embedding-3-small",
  WEB_SEARCH_MODEL: "tavily/search",
  WEB_FETCH_MODEL: "tavily/fetch",
  IMAGE_MODEL: "gemini/gemini-3-pro-image-preview",
  TTS_MODEL: "minimax/speech-2.8-turbo",
  AGENT_MAX_STEPS: "12",
  EXECUTION_TIMEOUT_MS: "15000",
  APPROVAL_TIMEOUT_MS: "300000",
  AI_RETRY_ATTEMPTS: "3",
  AI_RETRY_BASE_MS: "1000",
};

export type ConfigSource = "ui" | "env" | "default";

export interface ResolvedConfig {
  values: Record<ConfigKey, string>;
  sources: Record<ConfigKey, ConfigSource>;
}

function envMap(): Record<ConfigKey, string | undefined> {
  return {
    DEFAULT_MODEL: process.env.DEFAULT_MODEL,
    INTERNAL_INFERENCE_ENDPOINT: process.env.INTERNAL_INFERENCE_ENDPOINT,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    WEB_SEARCH_MODEL: process.env.WEB_SEARCH_MODEL,
    WEB_FETCH_MODEL: process.env.WEB_FETCH_MODEL,
    IMAGE_MODEL: process.env.IMAGE_MODEL,
    TTS_MODEL: process.env.TTS_MODEL,
    AGENT_MAX_STEPS: process.env.AGENT_MAX_STEPS,
    EXECUTION_TIMEOUT_MS: process.env.EXECUTION_TIMEOUT_MS,
    APPROVAL_TIMEOUT_MS: process.env.APPROVAL_TIMEOUT_MS,
    AI_RETRY_ATTEMPTS: process.env.AI_RETRY_ATTEMPTS,
    AI_RETRY_BASE_MS: process.env.AI_RETRY_BASE_MS,
  };
}

/** Resolve konfigurasi efektif. Murah (1 SELECT ke tabel kecil) — aman per-request. */
export async function getConfig(): Promise<ResolvedConfig> {
  let overrides: Record<string, string> = {};
  try {
    const rows = await getDb().select().from(appConfig);
    overrides = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    // Tabel belum ada (belum migrate) → fallback ke env/default.
  }
  const fromEnv = envMap();
  const values = {} as Record<ConfigKey, string>;
  const sources = {} as Record<ConfigKey, ConfigSource>;
  for (const k of EDITABLE_CONFIG_KEYS) {
    if (overrides[k] !== undefined && overrides[k] !== "") {
      values[k] = overrides[k];
      sources[k] = "ui";
    } else if (fromEnv[k] !== undefined && fromEnv[k] !== "") {
      values[k] = fromEnv[k] as string;
      sources[k] = "env";
    } else {
      values[k] = DEFAULTS[k];
      sources[k] = "default";
    }
  }
  return { values, sources };
}

export function isEditableKey(key: string): key is ConfigKey {
  return (EDITABLE_CONFIG_KEYS as readonly string[]).includes(key);
}

/** Simpan override dari UI. */
export async function setConfigOverride(key: string, value: string): Promise<void> {
  if (!isEditableKey(key)) throw new Error(`Key tidak diizinkan: ${key}`);
  const v = String(value).slice(0, 2000);
  await getDb()
    .insert(appConfig)
    .values({ key, value: v, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: v, updatedAt: Date.now() },
    });
}

/** Hapus override → kembali ke .env/default. */
export async function clearConfigOverride(key: string): Promise<void> {
  if (!isEditableKey(key)) throw new Error(`Key tidak diizinkan: ${key}`);
  await getDb().delete(appConfig).where(eq(appConfig.key, key));
}

/** Helper numerik — kembalikan default bila tidak valid. */
export function num(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
