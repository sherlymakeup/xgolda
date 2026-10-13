import { env } from "../env.ts";
import { getConfig, num } from "../config.ts";
import { stripProviderNames } from "../security/sanitization.ts";
import { ThinkStreamParser } from "./parser.ts";
import { withRetry } from "./retry.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type StreamEvent =
  | { type: "reasoning"; delta: string }
  | { type: "content"; delta: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> };

export interface StreamCallbacks {
  onEvent: (e: StreamEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export class GatewayError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
  }
}

/** Timeout default untuk fetch gateway (digabung dengan signal client). */
const GATEWAY_TIMEOUT_MS = 120_000;

function gatewaySignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(GATEWAY_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Bangun body chat/completions OpenAI-compatible. */
function buildBody(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  stream: boolean
) {
  return {
    model,
    messages,
    temperature,
    stream,
    // Minta reasoning eksplisit bila gateway mendukung (diabaikan bila tidak)
    reasoning: { effort: "medium" },
  };
}

/**
 * Streaming chat ke inference gateway (OpenAI-compatible SSE).
 * Menangani dua format penalaran:
 *  1. <think>...</think> di dalam delta.content
 *  2. delta.reasoning_content (format beberapa gateway)
 */
export async function streamChat(
  messages: ChatMessage[],
  opts: {
    model?: string;
    temperature?: number;
    signal?: AbortSignal;
    onEvent: (e: StreamEvent) => void | Promise<void>;
  }
): Promise<{ reasoning: string; content: string }> {
  const cfg = await getConfig();
  const model = opts.model || cfg.values.DEFAULT_MODEL;
  const temperature = opts.temperature ?? 0.7;
  const think = new ThinkStreamParser();
  let reasoning = "";
  let content = "";

  // Koneksi awal di-retry (429/5xx/network). Setelah stream berjalan,
  // error tidak di-retry agar delta tidak duplikat.
  const res = await withRetry(
    async () => {
      const r = await fetch(`${cfg.values.INTERNAL_INFERENCE_ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.gatewayToken()}`,
        },
        body: JSON.stringify(buildBody(messages, model, temperature, true)),
        signal: gatewaySignal(opts.signal),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new GatewayError(
          `Gateway HTTP ${r.status}: ${body.slice(0, 200)}`,
          r.status
        );
      }
      if (!r.body) throw new GatewayError("Gateway: body stream kosong");
      return r;
    },
    {
      attempts: num(cfg.values.AI_RETRY_ATTEMPTS, 3),
      baseMs: num(cfg.values.AI_RETRY_BASE_MS, 1000),
      signal: opts.signal,
    }
  );

  const stream = res.body;
  if (!stream) throw new GatewayError("Gateway: body stream kosong");
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const emit = async (e: StreamEvent) => {
    await opts.onEvent(e);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        let json: any;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = json?.choices?.[0]?.delta;
        if (!delta) continue;

        // Format 2: reasoning_content terpisah (zero-leak: strip nama provider juga)
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          const safeR = stripProviderNames(delta.reasoning_content);
          reasoning += safeR;
          await emit({ type: "reasoning", delta: safeR });
        }
        // Format 1: <think> di dalam content
        if (typeof delta.content === "string" && delta.content) {
          const { reasoning: r, content: c } = think.push(delta.content);
          if (r) {
            reasoning += r;
            await emit({ type: "reasoning", delta: r });
          }
          if (c) {
            // Jangan bocorkan nama provider ke stream pengguna
            const safe = stripProviderNames(c);
            content += safe;
            await emit({ type: "content", delta: safe });
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const tail = think.flush();
  if (tail.reasoning) {
    reasoning += tail.reasoning;
    await emit({ type: "reasoning", delta: tail.reasoning });
  }
  if (tail.content) {
    const safe = stripProviderNames(tail.content);
    content += safe;
    await emit({ type: "content", delta: safe });
  }
  return { reasoning, content };
}

/**
 * Chat non-streaming — dipakai agent loop (butuh teks utuh per step).
 */
export async function chatOnce(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; signal?: AbortSignal } = {}
): Promise<{ reasoning: string; content: string }> {
  const cfg = await getConfig();
  const model = opts.model || cfg.values.DEFAULT_MODEL;
  const temperature = opts.temperature ?? 0.7;

  // Idempoten — aman di-retry penuh
  const json: any = await withRetry(
    async () => {
      const res = await fetch(`${cfg.values.INTERNAL_INFERENCE_ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.gatewayToken()}`,
        },
        body: JSON.stringify(buildBody(messages, model, temperature, false)),
        signal: gatewaySignal(opts.signal),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new GatewayError(
          `Gateway HTTP ${res.status}: ${body.slice(0, 200)}`,
          res.status
        );
      }
      return res.json();
    },
    {
      attempts: num(cfg.values.AI_RETRY_ATTEMPTS, 3),
      baseMs: num(cfg.values.AI_RETRY_BASE_MS, 1000),
      signal: opts.signal,
    }
  );
  const msg = json?.choices?.[0]?.message ?? {};
  const think = new ThinkStreamParser();
  const fromContent = think.push(String(msg.content ?? ""));
  const tail = think.flush();
  // Zero-leak: nama provider tidak boleh bocor via reasoning maupun content
  const reasoning = stripProviderNames(
    (typeof msg.reasoning_content === "string" ? msg.reasoning_content : "") +
      fromContent.reasoning +
      tail.reasoning
  );
  const content = stripProviderNames(
    fromContent.content + tail.content
  );
  return { reasoning, content };
}

/** Embedding tunggal untuk vector search lokal. */
export async function getEmbedding(text: string): Promise<number[]> {
  const cfg = await getConfig();
  // EMBEDDING_ENDPOINT tetap didukung sebagai override khusus (env-only)
  const embEndpoint =
    (process.env.EMBEDDING_ENDPOINT || "").replace(/\/+$/, "") ||
    cfg.values.INTERNAL_INFERENCE_ENDPOINT;
  const json: any = await withRetry(
    async () => {
      const res = await fetch(`${embEndpoint}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.gatewayToken()}`,
        },
        body: JSON.stringify({ model: cfg.values.EMBEDDING_MODEL, input: text }),
        signal: gatewaySignal(),
      });
      if (!res.ok) {
        throw new GatewayError(`Embedding HTTP ${res.status}`, res.status);
      }
      return res.json();
    },
    {
      attempts: num(cfg.values.AI_RETRY_ATTEMPTS, 3),
      baseMs: num(cfg.values.AI_RETRY_BASE_MS, 1000),
    }
  );
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new GatewayError("Embedding: format tak dikenal");
  return vec as number[];
}
