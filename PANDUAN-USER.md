# XGOLDA — Panduan Setup & Pakai (Windows 11)

> Buat bos. XGOLDA itu AI agent workspace yang jalan **100% lokal di PC lu** — chat dengan penalaran transparan (Chain-of-Thought), mode agen otonom yang bisa nulis file & jalanin kode, sama code studio buat preview. Data nggak keluar dari PC.

---

## 0. Update (tiap abis `git pull`)

```powershell
cd xgolda-workspace
git pull
npx drizzle-kit migrate   # WAJIB tiap update — skema database bisa berubah
npm run dev
```

Kalau lupa migrate, fitur baru yang butuh kolom/tabel baru bakal error.

---

## 1. Prasyarat

- **Windows 11** 64-bit
- **Node.js v20+ LTS** — cek: buka PowerShell, ketik `node -v`. Belum ada? Download di [nodejs.org](https://nodejs.org) (pilih LTS).
- **npm** — ikut kepasang bareng Node.js (`npm -v` buat cek).
- **9Router sudah jalan** di `http://localhost:20128/v1` — ini otaknya XGOLDA. Kalau belum jalan, start dulu sebelum lanjut.

---

## 2. Setup dari Nol

Buka **PowerShell** (bukan CMD), lalu jalanin satu per satu:

```powershell
# 1. Masuk ke folder project
cd xgolda-workspace

# 2. Install dependencies
npm install

# 3. Bikin file .env.local dari contoh
Copy-Item .env.example .env.local
```

**4. Isi API key 9Router.** Buka `.env.local` pakai Notepad/VS Code, cari baris:

```
AI_GATEWAY_TOKEN=isi-token-9router-di-sini
```

Ganti `isi-token-9router-di-sini` dengan API key 9Router lu. **Paste manual, jangan share ke siapa-siapa, jangan taruh di chat.**

```powershell
# 5. Generate & jalankan migrasi database
npx drizzle-kit generate
npx drizzle-kit migrate

# 6. Gas server
npm run dev
```

**7. Buka browser:** [http://localhost:3000](http://localhost:3000)

Udah. Harusnya muncul tampilan XGOLDA item-hitam.

> Catatan: `npm run dev` nge-bind ke `127.0.0.1` — cuma bisa diakses dari PC lu sendiri, nggak bisa dari HP/laptop lain. Itu disengaja (lihat bagian keamanan).

---

## 3. Penjelasan Variabel `.env`

Semua di `.env.local`. Yang wajib diisi cuma `AI_GATEWAY_TOKEN`, sisanya default-nya udah bener.

| Variabel | Default | Artinya |
|---|---|---|
| `PORT` | `3000` | Port server XGOLDA |
| `INTERNAL_INFERENCE_ENDPOINT` | `http://localhost:20128/v1` | URL gateway 9Router (format OpenAI-compatible) |
| `AI_GATEWAY_TOKEN` | *(wajib diisi)* | API key 9Router lu. Tanpa ini semua chat = error |
| `DEFAULT_MODEL` | `deepseek-ai/DeepSeek-R1` | Model default yang dipakai chat & agen |
| `EMBEDDING_ENDPOINT` | *(kosong = ikut inference endpoint)* | Endpoint khusus embedding, kalau 9Router lu pisah layanannya |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Model embedding buat vector search |
| `SQLITE_DB_PATH` | `./data/xgolda.db` | Lokasi file database SQLite |
| `EXECUTION_TIMEOUT_MS` | `15000` | Batas waktu tool `terminal_exec` jalanin perintah (15 detik, auto-kill kalau lewat) |
| `AGENT_MAX_STEPS` | `12` | Langkah maksimum mode Agent per satu perintah |

Ganti model? Tinggal ubah `DEFAULT_MODEL` — atau klik pill nama model di Omnibox, bisa diketik langsung.

---

## 4. Cara Pakai Singkat

### Thread (per-chat isolated)
Tiap chat adalah **thread terpisah** — kayak side chat: konteks tidak bocor antar thread, riwayat tersimpan persisten di database (tidak ada data di localStorage). URL-nya bookmarkable: `http://127.0.0.1:3000/?thread=<id>`. Pindah thread otomatis menghentikan streaming yang sedang jalan.

### Folder kerja agen (di-jail per thread)
Agen **hanya boleh kerja** di folder khusus per thread:

```
C:\Users\dirga\Documents\Workspace\<thread-id>\
```

Semua file yang ditulis agen (`fs_write`), dibaca, dan semua perintah `terminal_exec` berjalan di dalam folder itu — **tidak bisa keluar** (path `..` maupun absolute ke luar ditolak sistem). Folder thread-nya tampil di panel Agent ("working dir"). Root folder bisa diubah di halaman **Update Config** (`AGENT_WORKSPACE_ROOT`).

### Chat biasa
Ketik di **Omnibox** (kolom input bawah), Enter buat kirim. Kalau model-nya reasoning (kayak DeepSeek-R1), proses berpikirnya muncul di accordion **THOUGHT PROCESS** — bisa dibuka-tutup, ada timer-nya. Klik ikon **paperclip** buat lampirkan gambar (vision) — model yang support vision bisa "melihat" gambarnya. Klik **pil model** buat ganti model dari daftar asli gateway (searchable).

### Mode Agent (toggle di Omnibox)
Klik tombol **Agent** di Omnibox sampe nyala cyan, terus kasih perintah, misal:

> "buatkan komponen React kartu profil neon, simpan sebagai profile-card.tsx"

Agen bakal: nyusun rencana → eksekusi langkah per langkah pakai tools (baca/tulis file, query database, jalanin kode buat verifikasi) → lapor hasil. Tiap langkah tool-nya kelihatan di panel, bisa di-klik buat lihat output mentahnya.

### Artifact Studio + Preview
Klik tombol **Studio** di kanan atas. File yang ditulis agen tersimpan fisik di folder workspace thread-nya (`C:\Users\dirga\Documents\Workspace\<thread-id>\`) — bisa lu buka langsung dari Explorer. File yang di-generate sistem (gambar/TTS) tersimpan di `./storage/artifacts/` dan bisa di-download dari UI. Klik file → lihat kodenya → klik **Preview** buat render live. Buat komponen React, pastikan ada `export default` biar ke-render.

### Vector search
Agen punya akses pencarian semantik lokal — misal lu suruh dia nyimpen & nyari-nyari catatan, dia pakai embedding buat nyari yang paling mirip maknanya, bukan sekadar keyword. Nggak perlu setting apa-apa selama `EMBEDDING_MODEL` didukung gateway lu.

---

## 5. Troubleshooting

### (a) `npm install` error node-gyp / minta VS Build Tools
Ini gara-gara `better-sqlite3` (database driver) butuh compile C++ native. Dua jalan:

1. **Install Visual Studio Build Tools** — download dari situs Microsoft, centang *"Desktop development with C++"*, terus ulang `npm install`. Buka PowerShell baru setelah install.
2. **Fallback `@libsql/client`** (tanpa compile sama sekali):
   ```powershell
   npm install @libsql/client
   ```
   Terus ganti driver di `src/db/index.ts` sesuai runbook (`xgolda_windows_11_localhost_runbook.md` di paket desain).

### (b) Chat error "Inference Gateway Temporarily Busy" / timeout
- Cek 9Router jalan: buka `http://localhost:20128/v1/models` di browser — harusnya balik JSON, bukan error koneksi.
- Cek `AI_GATEWAY_TOKEN` di `.env.local` udah keisi bener (bukan placeholder).
- Cek `INTERNAL_INFERENCE_ENDPOINT` bener ngarah ke port 20128.
- Abis ubah `.env.local`, **restart** `npm run dev` (Ctrl+C, jalanin lagi).

### (c) Port 3000 udah dipakai aplikasi lain
Ubah `PORT` di `.env.local`, misal `PORT=3001`, restart server, buka `http://localhost:3001`.

### (d) Database error / tabel nggak ada
Jalanin ulang migrasi:
```powershell
npx drizzle-kit migrate
```
Cek kesehatan database kapan aja: buka `http://localhost:3000/api/db/stats` — harusnya balik JSON `{"ok": true, ...}`.

---

## 6. Catatan Keamanan

- **Server cuma dengerin `127.0.0.1`** (`npm run dev` / `npm start` udah di-set `-H 127.0.0.1`). Orang lain di jaringan yang sama **nggak bisa** buka XGOLDA lu. Jangan diubah ke `0.0.0.0` kecuali lu paham risikonya.
- **Semua data lokal:** chat & riwayat di `./data/xgolda.db`, file agen di `./storage/artifacts/`. Backup dua folder itu = backup semuanya.
- **JANGAN commit/push `.env.local`** — isinya API key. File `.gitignore` udah nge-block, tapi tetap jangan di-share mentah ke siapa pun.
- Nama penyedia/model di balik gateway **nggak pernah** dikirim ke response — error gateway selalu dibungkus jadi pesan generik.
- Tool `terminal_exec` kasih agen akses shell penuh (PowerShell di Windows): timeout + auto-kill (di Windows pakai `taskkill /T` biar child process ikut mati), output dibatasi 20KB, dan environment variable berisi kata kunci/token/secret **disaring** sebelum perintah jalan (biar token nggak bocor ke log).
- **Jujur soal "sandbox":** `terminal_exec` BUKAN sandbox beneran kayak Docker — dia jalan sebagai user Windows lu (sama kayak Claude Code/Cursor). Isolasi filesystem & network total tidak feasible tanpa hak admin, dan pattern-guard sengaja TIDAK dipasang (teater melawan shell beneran). Threat model yang lu pilih: **terminal laptop = sandbox**. Yang menjagamu: (1) model yang lu percaya, (2) SEMUA perintah kelihatan di AgentPanel — kalau agen jalanin yang aneh-aneh, lu langsung lihat. Jangan pernah jalankan agent run dari goal yang ditempel dari sumber tak dikenal tanpa baca dulu.

### Approval gate (perintah berbahaya)

- Kalau agen mau menjalankan perintah **berbahaya** — hapus massal/rekursif (`rm -rf`, `Remove-Item -Recurse`, `del /s`, `rd /s`), format/partisi (`format`, `Clear-Disk`, `dd of=/dev/`), shutdown/restart, ubah registry (`reg add/delete`), kelola akun (`net user`), ambil alih permission (`takeown`, `icacls`), atau eksekusi kode remote via pipe (`curl ... | sh`, `IEX(...)`) — perintahnya **TIDAK langsung jalan**.
- AgentPanel munculin kartu **"PERSETUJUAN DIBUTUHKAN"** berisi perintahnya + alasan kenapa di-flag, dengan tombol **Setujui** / **Tolak**.
- Agen nunggu keputusan lu (default 5 menit, atur via `APPROVAL_TIMEOUT_MS`). Kalau lu tolak atau waktunya habis → perintah dibatalkan, agen cari jalan lain.
- Perintah normal (install, build, git, python, baca file) jalan langsung tanpa gate.
- Jujur: deteksinya heuristik pola — anti-kecelakaan, bukan anti-sabotase canggih. Obfuskasi masih bisa lolos, jadi kartu approval + AgentPanel yang transparan tetap pertahanan utamamu.

---

## Retry otomatis gateway

Kalau 9Router/penyedia upstream lagi 429 (rate limit), 5xx, atau koneksi putus,
XGOLDA **otomatis retry** dengan exponential backoff + jitter:

- `AI_RETRY_ATTEMPTS=3` — jumlah percobaan (default 3)
- `AI_RETRY_BASE_MS=1000` — jeda dasar antar percobaan, digandakan tiap retry

Yang TIDAK di-retry (langsung error): 400/401/403/404 — itu kesalahan permanen
(token salah, request ngaco), retry pun percuma. Timeout per-request 120 detik,
timeout keseluruhan satu agent run 10 menit.

## Skills agen

Agen bisa membaca panduan pola kerja dari folder `skills/`:

```
skills/
  artifact-guidelines/SKILL.md   → konvensi nulis komponen buat Artifact Studio
  sqlite-guide/SKILL.md          → skema 6 tabel + aturan read-only
```

Cara kerja: katalog skill otomatis masuk ke system prompt agen. Kalau goal
bersinggungan dengan skill, agen WAJIB baca dulu via tool `read_skill`.
Mau nambah skill sendiri? Bikin folder `skills/<nama>/SKILL.md` pakai format
frontmatter di `skills/README.md`, terus restart server. Gampang.

---

Selamat ngoprek, bos. Kalau ada yang aneh, cek bagian troubleshooting dulu — 90% masalah = 9Router belum jalan atau token belum keisi. ☕
