# Skills XGOLDA

Direktori ini berisi **SKILL.md** — panduan pola kerja yang bisa dibaca agen
via tool `read_skill`. Setiap skill = satu folder:

```
skills/
  <nama-skill>/SKILL.md
```

## Format SKILL.md

```markdown
---
name: nama-skill          # huruf kecil, angka, strip (wajib, unik)
description: Satu baris menjelaskan kapan skill ini dipakai
---

# Judul Skill
Isi panduan... (markdown bebas, maks ~20.000 karakter)
```

## Cara kerja

1. Saat agent loop dimulai, **katalog skill** (nama + deskripsi) otomatis
   disuntik ke system prompt agen.
2. Agen WAJIB memanggil `read_skill` dengan nama skill yang relevan
   SEBELUM memakai pola kerja yang diatur skill tersebut.
3. Tambah skill baru kapan saja: buat folder + SKILL.md, lalu restart
   server (atau panggil `refreshSkills()` bila tersedia).

## Contoh bawaan

- `artifact-guidelines` — konvensi menulis komponen React untuk Artifact Studio.
- `sqlite-guide` — skema 6 tabel database XGOLDA + aturan read-only.
