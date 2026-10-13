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

export interface VerifiedEvidence {
  /** Nama file yang benar-benar tertulis OK (dari history tool). */
  written: string[];
  /** Nama tool yang mengembalikan ok:true (boleh duplikat). */
  succeeded: string[];
  /** Deskripsi tool yang gagal. */
  failed: string[];
}

// Pola klaim "file sudah dibuat/ditulis/disusun/..."
const CLAIMS_FILE_RE =
  /(sudah|telah|berhasil).{0,30}(dibuat|ditulis|disusun|disiapkan|tersimpan|terbuat)|(file|berkas|dokumen).{0,40}(dibuat|ditulis|disusun|disiapkan|tersimpan)/i;

// Pola klaim "gagal / tidak bisa / belum berhasil"
const CLAIMS_FAILURE_RE =
  /(gagal|belum bisa|tidak dapat|belum berhasil|tidak berhasil|belum dapat|belum mengembalikan|belum tersedia)/i;

/** Draf pendek tanpa substansi (batas untuk kasus klaim gagal). */
const SHORT_DRAFT = 300;

export function verifyFinalAnswer(draft: string, ev: VerifiedEvidence): string {
  const claimsFile = CLAIMS_FILE_RE.test(draft);
  const claimsFailure = CLAIMS_FAILURE_RE.test(draft);
  const hasSuccess = ev.written.length > 0 || ev.succeeded.length > 0;

  // Kasus 1: klaim file dibuat tapi TIDAK ada file terverifikasi.
  // Jangan hapus isi draf — tambahkan koreksi kejujuran di bawahnya.
  if (claimsFile && ev.written.length === 0) {
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
