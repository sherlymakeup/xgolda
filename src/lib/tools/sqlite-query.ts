import { getRawDb } from "../../db/index.ts";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { arg, num } from "./types.ts";

const MAX_ROWS = 200;

// Kata kerja tulis — dilarang di SELURUH statement (bukan cuma kata pertama),
// karena SQLite mendukung data-modifying CTE:
//   WITH d AS (DELETE FROM messages RETURNING *) SELECT * FROM d;
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|trigger|analyze)\b/i;

// PRAGMA baca-saja yang diizinkan (bentuk tulis seperti journal_mode=DELETE ditolak).
// journal_mode SENGAJA tidak ada: bentuk fungsi PRAGMA journal_mode(WAL) lolos
// regex lama dan mengubah mode jurnal (tulis). ANALYZE juga dilarang (menulis sqlite_stat*).
const SAFE_PRAGMA =
  /^\s*pragma\s+(table_info|table_list|index_list|index_info|foreign_key_list|database_list|table_xinfo)\s*(\(\s*['"]?\w+['"]?\s*\))?\s*;?\s*$/i;

const HAS_LIMIT = /\blimit\s+\d+\s*;?\s*$/i;

/**
 * Tool: jalankan query baca (read-only) ke database SQLite lokal XGOLDA.
 * Dilarang: statement tulis, multi-statement, PRAGMA tulis/konfigurasi.
 */
async function sqliteQuery(
  args: Record<string, unknown>
): Promise<ToolResult> {
  let sql = arg(args.sql).trim();
  if (!sql) {
    return { ok: false, output: "ERROR: parameter 'sql' wajib diisi" };
  }

  // Tolak multi-statement (titik-koma di tengah)
  const stripped = sql.replace(/;+\s*$/, "");
  if (stripped.includes(";")) {
    return { ok: false, output: "ERROR: multi-statement tidak diizinkan" };
  }

  // Blocklist kata kerja tulis di seluruh statement (tutup celah WITH ... DELETE)
  if (FORBIDDEN.test(sql)) {
    return {
      ok: false,
      output: "ERROR: statement tulis dilarang (hanya baca).",
    };
  }

  const isPragma = /^\s*pragma\b/i.test(sql);
  if (isPragma && !SAFE_PRAGMA.test(sql)) {
    return {
      ok: false,
      output: "ERROR: hanya PRAGMA baca-saja yang diizinkan.",
    };
  }
  if (!isPragma && !/^\s*(select|with|explain)\b/i.test(sql)) {
    return {
      ok: false,
      output: "ERROR: hanya query baca (SELECT/WITH/EXPLAIN) yang diizinkan.",
    };
  }

  const limit = Math.min(Math.max(num(args.limit, 50), 1), MAX_ROWS);

  // Paksa LIMIT di level SQL agar tidak load seluruh tabel ke memori
  let finalSql = sql;
  if (!isPragma && !HAS_LIMIT.test(sql)) {
    finalSql = `${stripped} LIMIT ${limit}`;
  }

  try {
    const db = getRawDb();
    const stmt = db.prepare(finalSql);
    const rows = stmt.all().slice(0, limit) as Record<string, unknown>[];
    return {
      ok: true,
      output: JSON.stringify(
        { rows, rowCount: rows.length, truncated: rows.length >= limit },
        null,
        2
      ),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: `ERROR: ${msg.slice(0, 500)}` };
  }
}

export const sqliteQueryTool: ToolDefinition = {
  name: "sqlite_query",
  description:
    "Jalankan query SQL read-only (SELECT/WITH/EXPLAIN, PRAGMA baca-saja) ke database lokal XGOLDA. Tabel: sessions, messages, agent_runs, tool_executions, artifacts, vector_metadata.",
  parameters: {
    sql: { type: "string", description: "Query SQL read-only", required: true },
    limit: { type: "number", description: "Maks baris (default 50, maks 200)" },
  },
  handler: async (args) => sqliteQuery(args),
};
