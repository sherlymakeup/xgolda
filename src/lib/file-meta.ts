/** Helper murni (aman dipakai client & server): tanpa node:fs. */

export interface WorkspaceFile {
  /** path relatif terhadap folder workspace sesi, pakai "/" */
  path: string;
  size: number;
  mtime: number;
}

const MIME: Record<string, string> = {
  md: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  ts: "text/typescript; charset=utf-8",
  py: "text/x-python; charset=utf-8",
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  pdf: "application/pdf",
};

export function mimeForFile(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return MIME[ext] || "application/octet-stream";
}

/** Kategori preview: text | image | audio | video | other */
export function previewKind(filename: string): "text" | "image" | "audio" | "video" | "other" {
  const mime = mimeForFile(filename);
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml") || mime.includes("yaml"))
    return "text";
  return "other";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
