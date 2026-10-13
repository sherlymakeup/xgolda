/**
 * Verifikasi DETERMINISTIK jawaban final agen terhadap bukti tool.
 *
 * Menggantikan critic LLM (yang terbukti 3x merusak jawaban: klaim sukses
 * palsu lolos, klaim gagal palsu, dan "tidak bisa dipastikan" padahal
 * bukti ada). Verifikasi ini hanya mengintervensi bila ada KONTRADIKSI
 * yang terbukti dari data — bukan penilaian model.
 *
 * - Klaim file dibuat tapi tidak ada file terverifikasi → tandai belum
 *   terverifikasi (isi draf dipertahankan, kejujuran ditambahkan).
 * - Klaim gagal (draf pendek tanpa substansi) tapi bukti menunjukkan
 *   sukses → ganti dengan laporan fakta.
 * - Selain itu draf dibiarkan apa adanya.
 */

import fs from "node:fs";
import path from "node:path";

export interface VerifiedEvidence {
  /** Nama file yang benar-benar tertulis OK (dari history tool). */
  written: string[];
  /** Nama tool yang mengembalikan ok:true (boleh duplikat). */
  succeeded: string[];
  /** Deskripsi tool yang gagal. */
  failed: string[];
  /** Nama file (basename) yang ADA di folder workspace (dari disk). */
  diskFiles?: string[];
}

// Pola klaim "file sudah dibuat/ditulis/disusun/..."
const CLAIMS_FILE_RE =
  /(sudah|telah|berhasil).{0,30}(dibuat|ditulis|disusun|disiapkan|tersimpan|terbuat)|(file|berkas|dokumen).{0,40}(dibuat|ditulis|disusun|disiapkan|tersimpan)|\b(membuat|menulis|menyimpan|membikin|membuatkan)\s+[\w.\-\\/]+\.(md|txt|json|py|js|ts|tsx|jsx|html|css|csv|log|xml|yaml|yml|sh|bat|ps1|pdf|png|jpg|jpeg|mp3|wav|mp4)\b/i;

// Pola klaim "gagal / tidak bisa / belum berhasil"
const CLAIMS_FAILURE_RE =
  /(gagal|belum bisa|tidak dapat|belum berhasil|tidak berhasil|belum dapat|belum mengembalikan|belum tersedia)/i;

// Goal yang meminta PEMBUATAN file (bukan baca) — untuk disk-check di loop
const CREATE_GOAL_RE =
  /\b(buat|buatkan|tulis|tuliskan|simpan|generate|create|write|bikin|buatin|bikinin|buatlah)\b/i;

/** Draf pendek tanpa substansi (batas untuk kasus klaim gagal). */
const SHORT_DRAFT = 300;

/** Ekstrak nama file (basename) dari teks — untuk cek keberadaan di disk. */
export function extractFilenames(text: string): string[] {
  const re =
    /\b([A-Za-z0-9_][\w.\-\\/]*\.(md|txt|json|py|js|ts|tsx|jsx|html|css|csv|log|xml|yaml|yml|sh|bat|ps1|pdf|png|jpg|jpeg|mp3|wav|mp4))\b/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const base = m[1].split(/[\\/]/).pop();
    if (base) out.add(base.toLowerCase());
  }
  return Array.from(out);
}

/** Cek apakah path target berada di dalam base (tanpa dependensi config). */
function isInsideDir(base: string, target: string): boolean {
  const b = path.resolve(base).toLowerCase();
  const t = path.resolve(target).toLowerCase();
  return t === b || t.startsWith(b + path.sep);
}

/**
 * File mana dari daftar yang TIDAK ada di folder workspace.
 * Disk adalah ground truth — bukan kata-kata model, bukan output tool.
 */
export function missingOnDisk(
  filenames: string[],
  workspaceDir: string
): string[] {
  if (!workspaceDir) return [];
  return filenames.filter((f) => {
    const target = path.resolve(workspaceDir, f);
    if (!isInsideDir(workspaceDir, target)) return false;
    return !fs.existsSync(target);
  });
}

/** Apakah goal ini meminta pembuatan file (bukan sekadar baca)? */
export function isCreateGoal(goal: string): boolean {
  return CREATE_GOAL_RE.test(goal) && extractFilenames(goal).length > 0;
}

export function verifyFinalAnswer(draft: string, ev: VerifiedEvidence): string {
  const claimsFile = CLAIMS_FILE_RE.test(draft);
  const claimsFailure = CLAIMS_FAILURE_RE.test(draft);
  const hasSuccess = ev.written.length > 0 || ev.succeeded.length > 0;

  // Kasus 1: klaim file dibuat tapi TIDAK ada file terverifikasi.
  // Cek disk dulu — file yang ditulis via terminal_exec juga sah asal
  // benar-benar ada di folder workspace. Kalau ada di disk → klaim didukung.
  if (claimsFile && ev.written.length === 0) {
    const draftFiles = extractFilenames(draft);
    const onDisk =
      draftFiles.length > 0 &&
      (ev.diskFiles ?? []).length > 0 &&
      draftFiles.every((f) => (ev.diskFiles ?? []).includes(f));
    if (onDisk) return draft;
    const cause =
      ev.failed.length > 0
        ? ` Penyebab dari tool: ${ev.failed.join("; ")}`
        : "";
    return (
      `${draft}\n\n⚠️ Koreksi sistem: klaim file di atas belum terverifikasi ` +
      `— tidak ada file yang tercatat tertulis di folder workspace.${cause}`
    );
  }

  // Kasus 2: klaim gagal (draf pendek, tanpa substansi) tapi bukti
  // menunjukkan pekerjaan berhasil → ganti dengan laporan fakta.
  if (claimsFailure && draft.length < SHORT_DRAFT && hasSuccess) {
    const files =
      ev.written.length > 0 ? ` File dibuat: ${ev.written.join(", ")}.` : "";
    const tools =
      ev.succeeded.length > 0
        ? ` Tool berhasil: ${Array.from(new Set(ev.succeeded)).join(", ")}.`
        : "";
    return `Selesai.${files}${tools}`;
  }

  return draft;
}
