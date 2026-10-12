# AUDIT.md — Security Audit + Design Fidelity Review

**Project:** XGOLDA — AI Agent Workspace (Next.js 14, SQLite better-sqlite3 + drizzle)
**Tanggal:** 2026-10-13
**Scope:** `src/` (read-only review), DESIGN.md (`/tmp/xgolda/.../obsidian_intelligence/DESIGN.md`)
**Threat model:** aplikasi localhost-only (bind `127.0.0.1:3000`), agen = agen milik user sendiri,
inference via gateway OpenAI-compatible di `http://localhost:20128/v1`.

## Verdict

**Tidak ada temuan critical.**

Ringkasan: 1 High, 3 Medium, 6 Low, 6 Info. Path jail solid, zero-leak hampir penuh
(1 celah di reasoning stream), sandbox subprocess aman untuk threat model lokal,
tidak ada secret/env yang bocor ke client. Design fidelity tinggi — 9 penyimpangan,
semuanya minor (tidak ada yang merusak bahasa desain "Obsidian Intelligence").

---

## A. SECURITY FINDINGS

### [High] S-01 — `sqlite_query` bukan benar-benar read-only: WITH-CTE bisa DELETE/UPDATE
**Lokasi:** `src/lib/tools/sqlite-query.ts:5` (regex `READ_ONLY`)

```ts
const READ_ONLY = /^\s*(select|with|pragma|explain)\b/i;
```

Filter hanya mengecek kata pertama. SQLite (≥3.35, termasuk yang di-bundle
better-sqlite3 v12) mendukung **data-modifying CTE**, sehingga query berikut
lolos filter dan MENGHAPUS data:

```sql
WITH d AS (DELETE FROM messages RETURNING *) SELECT * FROM d;
WITH u AS (UPDATE sessions SET title='pwned' RETURNING *) SELECT * FROM u;
```

**Dampak:** tool yang dikontrak sebagai "read-only" bisa dipakai model (sengaja,
bug, atau via prompt injection dari output tool) untuk menghapus/mengubah
seluruh isi database — riwayat chat, sessions, artifacts metadata.

**Rekomendasi (konkret):**
1. Tambahkan blocklist kata kerja tulis di SELURUH statement, bukan cuma prefix:
   ```ts
   const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|trigger|writable_schema)\b/i;
   if (FORBIDDEN.test(sql)) return { ok: false, output: "ERROR: statement tulis dilarang" };
   ```
2. Tolak multi-statement: `if (sql.trim().replace(/;+\s*$/, "").includes(";")) return error`.
3. Batasi `PRAGMA` ke allowlist baca saja (lihat S-02), atau hapus `pragma` dari
   `READ_ONLY` dan sediakan daftar eksplisit: `table_info`, `table_list`,
   `index_list`, `foreign_key_list`.

### [Medium] S-02 — `PRAGMA` yang diizinkan bisa mengubah perilaku database
**Lokasi:** `src/lib/tools/sqlite-query.ts:5`

`PRAGMA` lolos filter prefix, padahal banyak PRAGMA bersifat tulis/konfigurasi:
`PRAGMA journal_mode=DELETE;`, `PRAGMA foreign_keys=OFF;`,
`PRAGMA writable_schema=ON;`, `PRAGMA synchronous=OFF;`. Tidak menghapus baris
data secara langsung, tapi bisa melemahkan integritas (mis. mematikan
foreign_keys lalu operasi lain merusak relasi) atau mengubah mode jurnal.

**Rekomendasi:** allowlist PRAGMA baca-saja:
```ts
const SAFE_PRAGMA = /^\s*pragma\s+(table_info|table_list|index_list|index_info|foreign_key_list|database_list|journal_mode)\s*(\(\s*['"]?\w+['"]?\s*\))?\s*;?\s*$/i;
```
Catatan: `journal_mode` tanpa `=` hanya membaca — tetap izinkan bentuk baca saja.

### [Medium] S-03 — Zero-leak bocor: `reasoning_content` tidak di-strip dari nama provider
**Lokasi:** `src/lib/ai/client.ts:100-104` (`streamChat`), `src/lib/ai/client.ts:173-179` (`chatOnce`)

`stripProviderNames()` hanya diterapkan ke `content`, TIDAK ke reasoning:
- `streamChat`: `delta.reasoning_content` di-emit mentah ke SSE → tampil di
  ThoughtEngine (user-facing).
- `chatOnce`: `msg.reasoning_content` digabung mentah → disimpan ke
  `reasoningContent` → tampil di ThoughtEngine.

**Dampak:** melanggar zero-leak directive ("nama provider upstream dilarang
bocor ke response pengguna") — jika gateway/model menyebut "novita"/"groq"/dll
di dalam reasoning, nama itu tampil di UI dan tersimpan di DB.

**Rekomendasi:**
```ts
// streamChat, format 2:
const safeR = stripProviderNames(delta.reasoning_content);
reasoning += safeR;
await emit({ type: "reasoning", delta: safeR });
// chatOnce:
const reasoning = stripProviderNames(
  (typeof msg.reasoning_content === "string" ? msg.reasoning_content : "") +
  fromContent.reasoning + tail.reasoning
);
```

### [Medium] S-04 — Tidak ada timeout pada fetch ke gateway (hang selamanya)
**Lokasi:** `src/lib/ai/client.ts:60` (`streamChat`), `:155` (`chatOnce`), `:195` (`getEmbedding`)

`fetch` hanya memakai `opts.signal` (dari `req.signal` = disconnect client).
Jika gateway hang tanpa client disconnect, koneksi SSE menggantung selamanya
dan `runAgentLoop` (via `chatOnce`) macet di satu step tanpa pernah selesai —
run terjebak di status `running` permanen.

**Rekomendasi:**
```ts
const timeout = AbortSignal.timeout(120_000);
const signal = opts.signal
  ? AbortSignal.any([opts.signal, timeout])
  : timeout;
```
Dan di `engine.ts`, bungkus `runAgentLoop` dengan timeout keseluruhan
(mis. 10 menit) agar status tidak `running` abadi.

### [Low] S-05 — `stmt.all()` memuat seluruh hasil sebelum di-slice (risiko OOM)
**Lokasi:** `src/lib/tools/sqlite-query.ts:30`

```ts
const rows = stmt.all().slice(0, limit);
```

`SELECT * FROM messages` tanpa LIMIT memuat SEMUA baris ke memori dulu.
Untuk skala lokal saat ini aman, tapi `vector_metadata`/`messages` bisa tumbuh.

**Rekomendasi:** paksa LIMIT di level SQL bila query tidak punya LIMIT:
```ts
const hasLimit = /\blimit\s+\d+\s*;?\s*$/i.test(sql);
const finalSql = hasLimit ? sql : `${sql.replace(/;+\s*$/, "")} LIMIT ${limit}`;
const rows = db.prepare(finalSql).all();
```

### [Low] S-06 — `GET /api/db/stats` mengekspos absolute dbPath (berisi username Windows)
**Lokasi:** `src/app/api/db/stats/route.ts:40-46`

Response JSON menyertakan `dbPath` absolut, mis.
`C:\Users\<nama-user>\xgolda-workspace\data\xgolda.db`. Untuk localhost-only
yang melihat hanya user sendiri — risiko minimal, tapi path ini tidak
dibutuhkan client.

**Rekomendasi:** hapus `dbPath` dari response, atau samarkan home dir
(`~/.xgolda/...`).

### [Low] S-07 — Rename artifact via PUT meninggalkan file yatim di disk
**Lokasi:** `src/app/api/artifacts/[id]/route.ts:PUT`

Saat `filename` diubah, file baru ditulis tetapi file lama TIDAK dihapus —
menumpuk file yatim di `./storage/artifacts/` yang tidak tercatat di DB.

**Rekomendasi:** setelah tulis berhasil dan nama berubah, `fs.unlinkSync`
path lama (dalam try/catch).

### [Low] S-08 — Tidak ada auth/rate-limit/Origin check di API routes
**Lokasi:** `src/app/api/*`

Semua endpoint terbuka tanpa token. Dapat diterima untuk threat model
localhost-only (bind `127.0.0.1` di `package.json` scripts ✓), tetapi:
- proses lain di PC yang sama bisa memanggil API;
- halaman web jahat yang dibuka user bisa menembak `http://127.0.0.1:3000/api/*`
  via simple request (tidak ada Origin check).

**Rekomendasi (opsional, sesuai threat model):** tambahkan middleware yang menolak
request tanpa `Origin: http://127.0.0.1:3000` / `localhost:3000` untuk
method tulis (POST/PUT/DELETE). Dokumentasikan bahwa `npx next start` manual
tanpa `-H 127.0.0.1` akan bind `0.0.0.0` — selalu pakai script npm.

### [Low] S-09 — Sandbox: tanpa batas memori + akses network penuh
**Lokasi:** `src/lib/tools/sandbox-runner.ts`

Sudah baik: `shell: false` ✓, timeout ✓ (dengan fallback deteksi Windows),
env scrubbing ✓ (`key|token|secret|password|auth` disaring, PATH dipertahankan),
cwd di `os.tmpdir()` ✓, nama file temp `nanoid(8)` tak tertebak ✓,
cleanup di `finally` ✓, output dibatasi 20KB ✓.

Sisa celah (dalam threat model agen-lokal, dampak terbatas):
- Tidak ada batas memori — kode model seperti `'x' * 10**10` bisa OOM-kan PC.
  Rekomendasi: di Windows gunakan Job Objects; di Linux `ulimit -v` via
  `spawn` dengan `resourceLimits` tidak tersedia — alternatif: jalankan dengan
  `node --max-old-space-size` untuk Node, dan dokumentasikan batas untuk Python.
- Subprocess punya akses network penuh. Untuk agen lokal ini acceptable, tapi
  pertimbangkan memblokir egress bila nanti ada multi-user.

### [Info] S-10 — Temuan positif (tidak perlu tindakan)
- **Path jail** (`src/lib/security/path-jail.ts`): `basename` + `resolve` +
  perbandingan prefix case-insensitive menutup traversal POSIX (`../`),
  Windows (`..\`), drive letter (`C:\`), dan UNC (`\\server\share`) — pada
  KEDUA platform hasil selalu di dalam jail (di Linux, backslash menjadi
  bagian nama file, tetap di dalam jail). Celah sisa hanya kosmetik:
  ADS (`file:secret`), trailing dots/spaces, dan reserved names (`NUL`)
  di Windows — tidak ada yang lolos jail.
- **Authorization header** tidak pernah di-log; `toGatewayError` mengembalikan
  pesan generik (`GATEWAY_TIMEOUT`/`GATEWAY_AUTH`/`GATEWAY_ERROR`) tanpa nama
  provider, URL endpoint, atau body mentah. Secret di log server disamarkan.
- **Tidak ada endpoint yang mengembalikan secret/env ke client** — frontend
  hanya berkomunikasi via `/api/*`; endpoint inference + token hanya hidup di
  server. `.env.example` berisi placeholder (terverifikasi, bukan token asli);
  `.env.local` di `.gitignore` ✓.
- **XSS**: `renderMarkdown` (`src/lib/client-api.ts`) meng-escape `&<>`
  sebelum menyisipkan tag markdown; code fence di-escape terpisah — aman
  dipakai dengan `dangerouslySetInnerHTML`. Iframe preview artifact memakai
  `sandbox="allow-scripts"` tanpa `allow-same-origin` ✓.
- **esbuild transform** (`compile` route) tidak mengeksekusi kode — aman untuk
  input arbitrer.
- **Bind localhost**: script `dev`/`start` memakai `-H 127.0.0.1` ✓.
- **UTF-8 multi-byte** yang terbelah antar chunk stdout subprocess bisa rusak
  1 karakter (kosmetik).
- **`reasoning: { effort: "medium" }`** di body chat adalah param non-standar —
  harmless, diabaikan gateway yang tidak mendukung.

---

## B. DESIGN FIDELITY vs DESIGN.md ("Obsidian Intelligence")

Metode: bandingkan `tailwind.config.ts`, `globals.css`, `layout.tsx`,
`src/components/*.tsx`, `src/app/page.tsx` terhadap DESIGN.md.

**Kesimpulan: fidelity tinggi.** Bahasa desain terjaga: true-black canvas,
tier permukaan, hairline border, aksen cyan yang hemat, pill geometry,
Thought Engine accordion. 9 penyimpangan di bawah semuanya minor.

> Catatan spec: frontmatter DESIGN.md memakai token berbeda (`background:
> '#131313'`) dari bagian prose (`#000000` true black). Implementasi mengikuti
> prose — keputusan yang benar (sesuai "True Black OLED" di judul).

### [Low] D-01 — Font: Inter yang ter-render, bukan Geist
**Lokasi:** `src/app/layout.tsx:2`, `tailwind.config.ts` (fontFamily.sans)

`next/font/google` di Next 14 tidak mengekspor `Geist`, sehingga kode memakai
`Inter` dengan nama variabel `--font-geist`. Tailwind mengklaim `"Geist"` di
urutan pertama font stack, tetapi yang ter-render adalah Inter.
**Rekomendasi:** pakai package npm `geist` + `next/font/local` (font file
di-bundle — juga lebih tahan untuk build offline di PC user), atau terima
Inter dan ubah klaim di config.

### [Low] D-02 — Hover tombol primary: putih, spec `#e4e4e7`
**Lokasi:** `src/components/Omnibox.tsx` (`hover:bg-white`),
`src/components/ArtifactStudio.tsx` (tombol Preview)

Spec Buttons: primary `#f4f4f5` → hover `#e4e4e7` (sedikit digelapkan).
Implementasi hover ke `bg-white` (malah lebih terang).
**Rekomendasi:** `hover:bg-[#e4e4e7]`.

### [Low] D-03 — Pip Thought Engine 6px, spec 4px
**Lokasi:** `src/components/ThoughtEngine.tsx` (`w-1.5 h-1.5`)

Spec: "pulsing Cyan micro-pip (4px)". Minor.
**Rekomendasi:** `w-1 h-1` (4px).

### [Low] D-04 — Tidak ada mode collapsed 64px pada sidebar
**Lokasi:** `src/components/Sidebar.tsx`

Spec: "Full-bleed fixed left sidebar (64px collapsed, 260px expanded)".
Implementasi: 260px penuh atau tersembunyi (mobile). Tidak ada rail ikon 64px.
**Rekomendasi:** opsional — tambah tombol collapse ke rail 64px berisi ikon
saja (nice-to-have, bukan blocker).

### [Info] D-05 — Kolom chat tidak melebar ke 64rem saat Studio aktif
**Lokasi:** `src/app/page.tsx` (`max-w-[48rem]` + panel Studio 420px dock kanan)

Spec: main stream melebar 48rem → 64rem saat artifact aktif. Implementasi
mempertahankan 48rem dan men-dock Studio 420px di kanan. Interpretasi yang
wajar dan arguably lebih baik (konten chat tidak ikut melebar). Bukan masalah.

### [Info] D-06 — Omnibox selalu `rounded-2xl`
**Lokasi:** `src/components/Omnibox.tsx`

Spec: `rounded-2xl` hingga `rounded-full` tergantung state (pill saat
single-line 52px). Implementasi selalu `rounded-2xl`. Kosmetik minor.

### [Info] D-07 — Tombol lampiran nonaktif ("segera hadir")
**Lokasi:** `src/components/Omnibox.tsx` (Paperclip disabled)

Spec menempatkan "file/context attachments in the center". Placeholder yang
jujur — acceptable untuk v1.

### [Info] D-08 — Omnibox bawah tidak "floating bottom-pinned" di mobile
**Lokasi:** `src/app/page.tsx` (Omnibox bawah in-flow)

Spec mobile: "floating bottom-pinned omnibox". Implementasi me-render di
aliran normal bawah area chat. Fungsional sama; bukan masalah.

### [Info] D-09 — Hero 48px vs 56px spec
**Lokasi:** `src/app/page.tsx` (`text-4xl md:text-5xl`)

Spec `display-hero`: 56px/`-0.03em`. Implementasi: 48px (`text-5xl`) dengan
tracking `-0.03em` yang sudah benar. Selisih 8px, tidak material.

---

## C. Prioritas perbaikan yang disarankan

1. **S-01** (High) — blocklist statement tulis + tolak multi-statement di `sqlite_query`.
2. **S-03** (Medium) — terapkan `stripProviderNames` ke reasoning stream & `chatOnce`.
3. **S-04** (Medium) — timeout default 120s untuk fetch gateway + timeout
   keseluruhan `runAgentLoop`.
4. **S-02** (Medium) — allowlist PRAGMA baca-saja.
5. **S-05** (Low) — paksa LIMIT di level SQL.
6. **D-01/D-02** (Low) — font Geist via package npm; hover `#e4e4e7`.
7. Sisanya: S-06, S-07, S-08, S-09, D-03, D-04 — backlog.

---
*Audit dilakukan read-only terhadap `src/`. Tidak ada file source yang diubah.*
