---
name: sqlite-guide
description: Skema 6 tabel database XGOLDA + aturan read-only tool sqlite_query — baca sebelum query database
---

# SQLite Guide

Database lokal XGOLDA (`./data/xgolda.db`). Tool `sqlite_query` **read-only**:
hanya `SELECT`/`WITH`/`EXPLAIN` dan `PRAGMA` baca-saja yang lolos.
Statement tulis, multi-statement, dan PRAGMA konfigurasi DITOLAK.

## Skema

- **sessions**(id, title, model, temperature, pinned, created_at, updated_at)
  — thread obrolan.
- **messages**(id, session_id, role, content, reasoning_content, tool_name,
  created_at) — role: user/assistant/system/tool.
- **agent_runs**(id, session_id, goal, status, plan_tree_json, current_step,
  error, created_at, updated_at, finished_at)
  — status: queued/planning/running/completed/failed.
- **tool_executions**(id, run_id, session_id, tool_name, args_json,
  result_json, duration_ms, exit_code, created_at) — audit log tool.
- **artifacts**(id, session_id, filename, language, source_code, created_at,
  updated_at).
- **vector_metadata**(id, text, embedding_json, dim, source, created_at).

## Contoh query aman

```sql
SELECT id, title, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 10;
SELECT tool_name, duration_ms FROM tool_executions WHERE run_id = '...' ORDER BY created_at;
PRAGMA table_info(messages);
```

## Larangan

- Jangan `SELECT *` tanpa `LIMIT` di tabel besar (otomatis dibatasi 200 baris).
- Jangan mencoba `WITH ... DELETE/UPDATE` — terdeteksi dan ditolak.
- Kolom waktu dalam **milidetik epoch** (integer).
