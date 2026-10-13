import type { ToolContext } from "./types.ts";

/**
 * Guard anti-generate-berulang (deterministik, BUKAN sekadar prompt),
 * dipakai tool generate AI (text_to_speech, generate_image):
 * per run + per tool, generate boleh SUKSES maks 1x. Bila gagal, 1x retry
 * (total maks 2 percobaan). Panggilan berikutnya ditolak dengan pesan yang
 * mengarahkan agen berhenti & tulis jawaban final.
 * Tanpa ini, model bisa mengulang generate berkali-kali (10+ file, token
 * kebakar) karena mengira tiap langkah perlu generate lagi.
 * Sengaja TIDAK dipakai untuk fs_write_artifact — itu tangan agen untuk
 * semua pekerjaan file (kode, dokumen), bukan generate AI.
 */
interface GenerateRunState {
  attempts: number;
  succeeded: boolean;
  label: string;
  at: number;
}
const states = new Map<string, GenerateRunState>();

function keyFor(tool: string, ctx: ToolContext): string {
  return `${tool}::${ctx.runId ?? ctx.sessionId ?? "global"}`;
}

/**
 * Klaim 1 slot percobaan. Kembalikan pesan error bila budget habis,
 * null bila boleh jalan (percobaan langsung dihitung).
 */
export function claimGenerateSlot(tool: string, ctx: ToolContext): string | null {
  const key = keyFor(tool, ctx);
  // Sapu state run lama (>1 jam) supaya Map tidak bocor memori.
  const cutoff = Date.now() - 3600_000;
  states.forEach((v, k) => {
    if (v.at < cutoff) states.delete(k);
  });
  let s = states.get(key);
  if (!s) {
    s = { attempts: 0, succeeded: false, label: "", at: Date.now() };
    states.set(key, s);
  }
  if (s.succeeded) {
    return `ERROR: ${tool} untuk run ini SUDAH berhasil (${s.label}). JANGAN panggil ${tool} lagi — pakai hasil tersebut dan tulis jawaban final.`;
  }
  if (s.attempts >= 2) {
    return `ERROR: ${tool} sudah 2x percobaan (1 generate + 1 retry) dan gagal. JANGAN panggil lagi — laporkan kegagalan ke user di jawaban final.`;
  }
  s.attempts++;
  return null;
}

/** Tandai generate berhasil (label = nama file hasil). */
export function markGenerateDone(tool: string, ctx: ToolContext, label: string): void {
  const s = states.get(keyFor(tool, ctx));
  if (s) {
    s.succeeded = true;
    s.label = label;
  }
}
