import { addEmbedding, deleteEmbedding, findEmbeddingByIdPrefix, searchSimilar } from "../../db/vector.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";
import { arg, num } from "./types.ts";

/**
 * Ambang relevansi memori — SATU sumber kebenaran (sebelumnya dua magic
 * number tak konsisten: engine 0.35, tool recall 0.3).
 *
 * Catatan kalibrasi: cosine similarity embedding bersifat anisotropik —
 * teks yang tidak terkait pun sering mencetak 0.3–0.6. Floor 0.35 saja
 * tidak cukup, makanya ditambah aturan margin relatif (lihat
 * filterRelevantMemories): hit jauh di bawah hit terbaik ikut dibuang
 * walau lolos floor.
 */
export const MEMORY_SCORE_FLOOR = 0.35;
/** Hit dengan skor > MARGIN di bawah hit terbaik dianggap ekor noise. */
export const MEMORY_MARGIN = 0.15;
/** Batas karakter per memori di blok auto-recall (system prompt tiap run). */
export const MEMORY_AUTO_RECALL_MAX_CHARS = 500;

export interface MemoryHit {
  id: string;
  text: string;
  score: number;
  source: string | null;
}

/** Normalisasi untuk dedup: lowercase, buang non-alfanumerik, rapatkan spasi. */
export function normalizeMemoryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Saring hit recall: buang di bawah floor, buang ekor jauh di bawah hit
 * terbaik (margin relatif), buang duplikat teks (normalisasi). Urutan
 * skor dipertahankan (terbaik dulu).
 */
export function filterRelevantMemories<T extends MemoryHit>(hits: T[]): T[] {
  if (hits.length === 0) return [];
  const top = Math.max(...hits.map((h) => h.score));
  const cutoff = Math.max(MEMORY_SCORE_FLOOR, top - MEMORY_MARGIN);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const h of hits) {
    if (h.score < cutoff) continue;
    const key = normalizeMemoryText(h.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/**
 * remember — simpan fakta/informasi penting ke memori jangka panjang.
 * Disimpan sebagai embedding di vector_metadata (source: "memory:<sessionId>").
 * Dedup: fakta yang sama (normalisasi) tidak disimpan dua kali.
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
    // Dedup saat tulis — topK besar supaya duplikat tidak terdesak keluar
    // oleh hit lain (skor duplikat ≈ 1.0, tapi urutan bisa kalah jumlah).
    const existing = await searchSimilar(fact, 20);
    const key = normalizeMemoryText(fact);
    if (existing.some((h) => normalizeMemoryText(h.text) === key)) {
      return { ok: true, output: "OK: fakta sudah ada di memori (duplikat tidak disimpan)" };
    }
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
 * Output menyertakan id pendek tiap hit supaya forget_memory bisa merujuknya.
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
    const relevant = filterRelevantMemories(hits);
    if (relevant.length === 0) {
      return { ok: true, output: "(tidak ada memori yang relevan)" };
    }
    return {
      ok: true,
      output: relevant
        .map((h) => `[id:${h.id.slice(0, 8)}] (skor ${h.score.toFixed(2)}) ${h.text}`)
        .join("\n"),
    };
  } catch (e) {
    return {
      ok: false,
      output: `ERROR: gagal mencari: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * forget_memory — hapus satu memori jangka panjang.
 * Pakai `id` (dari output recall) bila tahu persis; atau `query` untuk
 * menghapus hit terbaik yang relevan. Hanya SATU entri per panggilan
 * (anti hapus massal tak sengaja).
 */
async function forgetMemory(
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> {
  const id = arg(args.id).trim();
  const query = arg(args.query).trim();
  if (!id && !query) {
    return { ok: false, output: "ERROR: 'id' atau 'query' wajib diisi" };
  }
  try {
    if (id) {
      // Terima id penuh atau awalan (output recall menampilkan 8 karakter).
      let targetId = id;
      if (id.length < 8 || id.length > 64) {
        return { ok: false, output: "ERROR: 'id' tidak valid" };
      }
      if (id.length < 21) {
        const found = await findEmbeddingByIdPrefix(id);
        if (!found) return { ok: false, output: `ERROR: tidak ada memori dengan id ${id}` };
        targetId = found;
      }
      const ok = await deleteEmbedding(targetId);
      return ok
        ? { ok: true, output: `OK: memori ${id} dihapus` }
        : { ok: false, output: `ERROR: tidak ada memori dengan id ${id}` };
    }
    const hits = filterRelevantMemories(await searchSimilar(query, 20));
    if (hits.length === 0) {
      return { ok: true, output: "(tidak ada memori yang cocok untuk dihapus)" };
    }
    const best = hits[0];
    await deleteEmbedding(best.id);
    return { ok: true, output: `OK: memori dihapus: "${best.text.slice(0, 120)}"` };
  } catch (e) {
    return {
      ok: false,
      output: `ERROR: gagal menghapus: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export const rememberTool: ToolDefinition = {
  name: "remember",
  description:
    "Simpan fakta penting ke MEMORI JANGKA PANJANG (preferensi user, keputusan, konteks proyek). " +
    "Gunakan ketika user menyampaikan sesuatu yang harus diingat di luar sesi ini. " +
    "Fakta yang sama tidak disimpan dua kali. " +
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

export const forgetMemoryTool: ToolDefinition = {
  name: "forget_memory",
  description:
    "Hapus SATU memori jangka panjang yang salah/kedaluwarsa. " +
    "Pakai 'id' dari output recall bila tahu persis, atau 'query' untuk menghapus hit terbaik yang relevan. " +
    "Gunakan ketika user mengoreksi fakta lama ('sekarang gue pakai X, bukan Y') — hapus memori lama yang bertentangan.",
  parameters: {
    id: { type: "string", description: "ID memori dari output recall (penuh atau 8 karakter pertama)" },
    query: { type: "string", description: "Cari memori yang cocok lalu hapus hit terbaiknya" },
  },
  handler: async (args, ctx) => forgetMemory(args, ctx),
};
