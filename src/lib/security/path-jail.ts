import fs from "node:fs";
import path from "node:path";

/**
 * Direktori jail untuk semua file yang ditulis/dibaca agen.
 * Cross-platform: selalu via path.resolve — tidak ada hardcode slash.
 */
export const ARTIFACTS_DIR = path.resolve(process.cwd(), "storage", "artifacts");

export function ensureArtifactsDir(): string {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  return ARTIFACTS_DIR;
}

/**
 * Validasi nama file agar tidak bisa keluar dari ARTIFACTS_DIR.
 * Mencegah path traversal POSIX (../) maupun Windows (..\ , C:\, UNC \\).
 */
export function assertSafePath(filename: string): string {
  if (!filename || typeof filename !== "string") {
    throw new Error("ACCESS_DENIED: nama file tidak valid");
  }
  // basename membuang semua komponen direktori: "a/../../b" -> "b",
  // "C:\\x\\y" -> "y", "\\\\server\\share" -> "share"
  const cleanName = path.basename(filename);
  if (!cleanName || cleanName === "." || cleanName === "..") {
    throw new Error("ACCESS_DENIED: nama file tidak valid");
  }
  const targetPath = path.resolve(ARTIFACTS_DIR, cleanName);
  // Perbandingan case-insensitive (Windows filesystem tidak case-sensitive)
  const base = ARTIFACTS_DIR.toLowerCase();
  const target = targetPath.toLowerCase();
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("ACCESS_DENIED: Path traversal terdeteksi");
  }
  return targetPath;
}
