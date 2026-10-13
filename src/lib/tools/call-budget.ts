import type { ToolContext } from "./types.ts";

/**
 * Budget panggilan per run untuk tool riset (web_search, web_fetch).
 * Riset yang sah butuh beberapa panggilan, tapi tanpa batas agen bisa
 * muter riset tanpa henti (puluhan panggilan, konteks membengkak, token
 * kebakar). Bila budget habis, tool menolak — agen harus berhenti riset
 * dan susun jawaban final dari hasil yang sudah ada.
 * Beda dengan generate-guard (1x sukses + 1x retry): riset dihitung per
 * panggilan, sukses maupun gagal, karena tiap panggilan riset membebani
 * konteks apa pun hasilnya.
 */
const MAX_CALLS: Record<string, number> = {
  web_search: 5,
  web_fetch: 8,
};
const counts = new Map<string, { n: number; at: number }>();

/**
 * Klaim 1 slot panggilan. Kembalikan pesan error bila budget habis,
 * null bila boleh jalan (panggilan langsung dihitung).
 */
export function checkCallBudget(tool: string, ctx?: ToolContext): string | null {
  const max = MAX_CALLS[tool];
  if (max === undefined) return null;
  const key = `${tool}::${ctx?.runId ?? ctx?.sessionId ?? "global"}`;
  // Sapu hitungan run lama (>1 jam) supaya Map tidak bocor memori.
  const cutoff = Date.now() - 3600_000;
  counts.forEach((v, k) => {
    if (v.at < cutoff) counts.delete(k);
  });
  let s = counts.get(key);
  if (!s) {
    s = { n: 0, at: Date.now() };
    counts.set(key, s);
  }
  if (s.n >= max) {
    return `ERROR: budget ${tool} habis (${max}x per run). BERHENTI riset — susun jawaban final dari hasil yang sudah didapat, jangan panggil ${tool} lagi.`;
  }
  s.n++;
  return null;
}
