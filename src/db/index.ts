import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema.ts";

let _db: BetterSQLite3Database<typeof schema> | null = null;
let _raw: Database.Database | null = null;

function resolveDbPath(): string {
  const configured = process.env.SQLITE_DB_PATH || "./data/xgolda.db";
  const resolved = path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

/**
 * Koneksi SQLite tunggal (singleton). Menerapkan PRAGMA anti file-locking
 * khusus Windows: busy_timeout + WAL mode.
 */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;
  const dbPath = resolveDbPath();
  _raw = new Database(dbPath);
  // Cegah SQLITE_BUSY / file locking di Windows (mandatory locking)
  _raw.pragma("busy_timeout = 5000");
  _raw.pragma("journal_mode = WAL");
  _db = drizzle(_raw, { schema });

  const shutdown = () => {
    try {
      _raw?.close();
    } catch {
      /* abaikan saat exit */
    }
    _db = null;
    _raw = null;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return _db;
}

/** Akses mentah better-sqlite3 bila dibutuhkan (mis. PRAGMA, health check). */
export function getRawDb(): Database.Database {
  getDb();
  if (!_raw) throw new Error("Database belum terinisialisasi");
  return _raw;
}
