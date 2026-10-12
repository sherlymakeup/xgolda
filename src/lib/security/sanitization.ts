/**
 * Zero-leak directives: tidak ada secret / nama provider upstream yang boleh
 * bocor ke response JSON milik pengguna atau ke log yang terekspos.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9\-_]{8,}/g, // OpenAI-style keys
  /sk-or-[A-Za-z0-9\-_]{8,}/g,
  /(api[_-]?key\s*[:=]\s*["']?)[^"'\s&;]+/gi,
  /(bearer\s+)[A-Za-z0-9\-_.~+/=]{8,}/gi,
  /(token\s*[:=]\s*["']?)[^"'\s&;]{8,}/gi,
  /x-api-key\s*[:=]\s*["']?[^"'\s&;]+/gi,
];

/** Samarkan credential yang muncul di teks bebas (log, error message). */
export function maskSecrets(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_m, prefix?: string) =>
      prefix ? `${prefix}***` : "***"
    );
  }
  return out;
}

/** Samarkan secret di dalam struktur JSON-able sebelum di-log. */
export function sanitizeForLog(value: unknown): unknown {
  if (typeof value === "string") return maskSecrets(value);
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/key|token|secret|password|auth/i.test(k)) out[k] = "***";
      else out[k] = sanitizeForLog(v);
    }
    return out;
  }
  return value;
}

// Nama penyedia inference yang dilarang muncul di response pengguna.
const PROVIDER_NAMES = [
  "novita",
  "groq",
  "openai",
  "deepseek",
  "together",
  "fireworks",
  "anyscale",
  "openrouter",
  "9router",
  "vllm",
  "ollama",
];

/**
 * Bungkus error upstream menjadi pesan generik.
 * Tidak pernah menyertakan nama provider, URL endpoint, atau body mentah.
 */
export function toGatewayError(err: unknown): { error: string; code: string } {
  let raw = "";
  if (err instanceof Error) raw = err.message;
  else if (typeof err === "string") raw = err;

  // Log server-side saja, dengan secret disamarkan
  console.error("[gateway]", maskSecrets(raw).slice(0, 500));

  const lowered = raw.toLowerCase();
  const isTimeout =
    lowered.includes("timeout") ||
    lowered.includes("timed out") ||
    lowered.includes("etimedout") ||
    lowered.includes("econnaborted");
  const isAuth =
    lowered.includes("401") ||
    lowered.includes("unauthorized") ||
    lowered.includes("invalid api key");

  if (isAuth) {
    return { error: "Inference Gateway Unauthorized", code: "GATEWAY_AUTH" };
  }
  if (isTimeout) {
    return {
      error: "Inference Gateway Temporarily Busy",
      code: "GATEWAY_TIMEOUT",
    };
  }
  return { error: "Inference Gateway Temporarily Busy", code: "GATEWAY_ERROR" };
}

/** Pastikan tidak ada nama provider yang lolos ke teks user-facing. */
export function stripProviderNames(text: string): string {
  let out = text;
  for (const name of PROVIDER_NAMES) {
    out = out.replace(new RegExp(name, "gi"), "inference gateway");
  }
  return out;
}
