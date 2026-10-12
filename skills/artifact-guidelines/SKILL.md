---
name: artifact-guidelines
description: Konvensi menulis komponen React/TSX untuk Artifact Studio — WAJIB dibaca sebelum fs_write_artifact file TSX/JSX
---

# Artifact Guidelines

Panduan menulis komponen agar bisa di-preview di Artifact Studio
(`POST /api/artifacts/:id/compile` memakai esbuild, lalu di-render di iframe).

## Aturan keras

1. **Satu file, satu komponen.** Akhiri file dengan `export default`:
   ```tsx
   export default function KartuProfil() { ... }
   ```
   Preview hanya me-render **default export**. Named export lain diabaikan.
2. **Hanya dependensi `react`.** Jangan `import` library lain
   (tidak tersedia di iframe preview). `useState`, `useEffect` dll. boleh
   via `import { useState } from "react"`.
3. **Jangan akses `window`/`document`/`localStorage` saat render pertama**
   kecuali di dalam `useEffect` — hindari crash SSR-ish.
4. **Styling:** pakai inline `style={{...}}` atau class Tailwind sederhana.
   Jangan `@import` font eksternal di dalam komponen.

## Alur kerja yang benar

1. `read_skill` skill ini (kamu sedang melakukannya ✓).
2. Tulis file via `fs_write_artifact` (mis. `kartu-profil.tsx`).
3. Verifikasi via `terminal_exec`, mis:
   <toolcall>{"name": "terminal_exec", "args": {"command": "npx tsc --noEmit kartu-profil.tsx --jsx react --esModuleInterop --skipLibCheck", "cwd": "./storage/artifacts"}}</toolcall>
   atau untuk logika JS: `node -e "..."` / `node test-saya.mjs`.
4. Beri tahu user nama file-nya agar bisa dibuka di Artifact Studio → Preview.

## Contoh minimal valid

```tsx
export default function Halo() {
  return <h1 style={{ color: "#00f0ff" }}>Halo bos</h1>;
}
```
