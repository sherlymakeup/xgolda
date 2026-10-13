import fs from "node:fs";
import path from "node:path";
import type { WorkspaceFile } from "./file-meta.ts";

/**
 * Server-only: baca daftar file di folder workspace.
 * Helper tampilan (mime/preview/size) ada di ./file-meta.ts (aman untuk client).
 */

const MAX_FILES = 300;

/** Daftar semua file di folder workspace (rekursif), terbaru dulu. */
export function listWorkspaceFiles(dir: string): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  const walk = (d: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      const rp = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full, rp);
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(full);
          files.push({ path: rp, size: st.size, mtime: st.mtimeMs });
        } catch {
          /* abaikan file yang hilang di tengah jalan */
        }
      }
    }
  };
  walk(dir, "");
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}
