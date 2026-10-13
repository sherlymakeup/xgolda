import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config.ts";

/**
 * Folder kerja khusus agen per sesi/thread.
 *
 * Setiap thread mendapat folder sendiri:
 *   <AGENT_WORKSPACE_ROOT>/<sessionId>/
 * (mis. C:\Users\dirga\Documents\Workspace\<sessionId>\ di PC user)
 *
 * Semua tool file & terminal di-jail ke folder ini — agen tidak bisa
 * liar ke luar folder workspace sesi.
 */

/** Validasi ID sesi agar tidak bisa dipakai untuk path traversal. */
export function assertValidSessionId(sessionId: string): void {
  if (!sessionId || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
    throw new Error("ACCESS_DENIED: sessionId tidak valid");
  }
}

/** Root folder kerja agen (dari config; dibuat bila belum ada). */
export async function getWorkspaceRoot(): Promise<string> {
  const cfg = await getConfig();
  const root = path.resolve(cfg.values.AGENT_WORKSPACE_ROOT);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Folder kerja satu sesi/thread — dibuat otomatis saat pertama dipakai. */
export async function getSessionWorkspace(sessionId: string): Promise<string> {
  assertValidSessionId(sessionId);
  const dir = path.join(await getWorkspaceRoot(), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Cek apakah `target` berada di dalam `base` (case-insensitive, Windows-safe). */
export function isInside(base: string, target: string): boolean {
  const b = path.resolve(base).toLowerCase();
  const t = path.resolve(target).toLowerCase();
  return t === b || t.startsWith(b + path.sep);
}

/**
 * Jail path: nama file relatif (boleh pakai subdir, mis. "laporan/hasil.md")
 * → path absolut di dalam workspace sesi. Menolak absolute path & escape (..).
 */
export async function assertWorkspacePath(
  sessionId: string,
  filename: string
): Promise<string> {
  if (!filename || typeof filename !== "string") {
    throw new Error("ACCESS_DENIED: nama file tidak valid");
  }
  const dir = await getSessionWorkspace(sessionId);
  const target = path.resolve(dir, filename);
  if (!isInside(dir, target)) {
    throw new Error("ACCESS_DENIED: di luar folder workspace sesi ini");
  }
  return target;
}
