import fs from "node:fs";
import path from "node:path";
import { getRawDb } from "@/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/db/stats — health check SQLite + hitungan baris per tabel. */
export async function GET() {
  try {
    const raw = getRawDb();
    const tables = [
      "sessions",
      "messages",
      "agent_runs",
      "tool_executions",
      "artifacts",
      "vector_metadata",
    ];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const row = raw.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as {
          c: number;
        };
        counts[t] = row.c;
      } catch {
        counts[t] = -1; // tabel belum ada (migrasi belum jalan)
      }
    }

    const dbPath = path.isAbsolute(env.sqliteDbPath)
      ? env.sqliteDbPath
      : path.resolve(process.cwd(), env.sqliteDbPath);
    let sizeBytes: number | null = null;
    try {
      sizeBytes = fs.statSync(dbPath).size;
    } catch {
      sizeBytes = null;
    }

    const journalMode = (
      raw.prepare("PRAGMA journal_mode").get() as { journal_mode: string }
    ).journal_mode;

    return Response.json({
      ok: true,
      sizeBytes,
      journalMode,
      counts,
    });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
