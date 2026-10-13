import { addEmbedding, searchSimilar } from "../../db/vector.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";
import { arg, num } from "./types.ts";

/**
 * remember — simpan fakta/informasi penting ke memori jangka panjang.
 * Disimpan sebagai embedding di vector_metadata (source: "memory:<sessionId>").
 */
async function remember(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const fact = arg(args.fact).trim();
  if (!fact) return { ok: false, output: "ERROR: 'fact' wajib diisi" };
  if (fact.length > 2000) {
    return { ok: false, output: "ERROR: fakta maksimal 2000 karakter, ringkas dulu" };
  }
  try {
    const id = await addEmbedding(fact, `memory:${ctx.sessionId ?? "global"}`);
    return { ok: true, output: `OK: tersimpan di memori jangka panjang (id ${id.slice(0, 8)}…)` };
  } catch (e) {
    return {
      ok: false,
      output: `ERROR: gagal menyimpan: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * recall — cari memori jangka panjang yang relevan dengan query.
 */
async function recall(
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> {
  const query = arg(args.query).trim();
  if (!query) return { ok: false, output: "ERROR: 'query' wajib diisi" };
  const limit = Math.min(Math.max(num(args.limit, 5), 1), 10);
  try {
    const hits = await searchSimilar(query, limit);
    // Saring skor terlalu rendah (noise)
    const relevant = hits.filter((h) => h.score > 0.3);
    if (relevant.length === 0) {
      return { ok: true, output: "(tidak ada memori yang relevan)" };
    }
    return {
      ok: true,
      output: relevant
        .map((h, i) => `[${i + 1}] (skor ${h.score.toFixed(2)}) ${h.text}`)
        .join("\n"),
    };
  } catch (e) {
    return {
      ok: false,
      output: `ERROR: gagal mencari: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export const rememberTool: ToolDefinition = {
  name: "remember",
  description:
    "Simpan fakta penting ke MEMORI JANGKA PANJANG (preferensi user, keputusan, konteks proyek). " +
    "Gunakan ketika user menyampaikan sesuatu yang harus diingat di luar sesi ini. " +
    "Jangan simpan hal sepele atau rahasia (token, password).",
  parameters: {
    fact: {
      type: "string",
      description: "Fakta ringkas yang disimpan, mis. 'User lebih suka deploy via Vercel'",
      required: true,
    },
  },
  handler: async (args, ctx) => remember(args, ctx),
};

export const recallTool: ToolDefinition = {
  name: "recall",
  description:
    "Cari memori jangka panjang yang relevan dengan query (pencarian semantik). " +
    "Gunakan ketika butuh konteks lama: preferensi user, keputusan sebelumnya, info proyek.",
  parameters: {
    query: { type: "string", description: "Kata kunci/pernyataan yang dicari", required: true },
    limit: { type: "number", description: "Maks hasil (default 5, maks 10)" },
  },
  handler: async (args, ctx) => recall(args, ctx),
};
