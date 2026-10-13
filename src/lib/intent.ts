/**
 * Deteksi intent tugas eksekusi dari pesan user (client-safe, tanpa dep Node).
 *
 * Dipakai Omnibox/page untuk otomatis mengalihkan pesan yang jelas-jelas
 * berupa perintah eksekusi ("buatkan folder MARKO...") ke agent mode,
 * tanpa user harus menyalakan toggle Agent manual.
 *
 * Catatan keamanan: auto-route TIDAK melewati approval gate — perintah
 * berbahaya tetap minta persetujuan per-command di dalam agent loop.
 */

const FILLER_RE = /^(tolong|mohon|coba|ayo|please)\s+/i;

/** Pola tanya/penjelasan → tetap di mode chat biasa. Dicek DULUAN. */
const QUESTION_RE =
  /^(apa|siapa|kapan|dimana|di mana|kenapa|mengapa|bagaimana|gimana|jelaskan|jelasin|terangkan|ceritakan|definisi|arti|maksud|bandingkan|bedanya|apa beda|ringkas|rangkum|terjemahkan|translate|summarize|explain|what|why|how|who|when|where|which)\b/i;

/** Kata kerja imperatif eksekusi (ID + EN) → layak jadi agent task. */
const TASK_RE =
  /^(buatkan|buat|bikin|bikinkan|jalankan|eksekusi|run|install|instal|pasang|hapus|delete|remove|bersihkan|download|unduh|upload|unggah|pindah|pindahkan|move|salin|copy|rename|ganti nama|edit|tulis|write|simpan|save|generate|create|make|compile|kompilasi|build|deploy|backup|cadangkan|cari|carikan|find|search|list|tampilkan|buka|open|cek|periksa|check|start|mulai|stop|hentikan|berhenti|restart|update|perbarui|upgrade|konfigurasi|konfigurasikan|setup|scaffold|tambah|tambahkan|kurangi|fix|perbaiki|refactor|optimasi|analisis|scan|ubah)\b/i;

/**
 * True bila teks terlihat seperti perintah eksekusi, bukan pertanyaan.
 * Heuristik berbasis kata kerja awal kalimat — murah dan cukup akurat
 * untuk bahasa percakapan sehari-hari.
 */
export function looksLikeTask(text: string): boolean {
  const t = text.trim().replace(FILLER_RE, "").trim();
  if (!t) return false;
  if (QUESTION_RE.test(t)) return false;
  return TASK_RE.test(t);
}
