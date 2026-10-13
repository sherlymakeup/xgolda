"use client";

import {
  Code2,
  Eye,
  FileAudio,
  FileCode2,
  Image as ImageIcon,
  Loader2,
  Play,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  compileArtifact,
  getArtifact,
  listArtifacts,
  type ArtifactMeta,
} from "@/lib/client-api";

interface Props {
  onClose: () => void;
  refreshKey: number;
}

type MediaKind = "image" | "audio" | null;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a"]);

/** Deteksi jenis media dari ekstensi filename. */
function mediaKind(filename: string): MediaKind {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  return null;
}

/** Bangun srcDoc iframe: import blob dari kode ESM hasil compile + React via esm.sh. */
function buildPreviewDoc(compiledCode: string): string {
  const escaped = compiledCode
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script type="importmap">
{"imports":{
  "react":"https://esm.sh/react@18.3.1",
  "react-dom":"https://esm.sh/react-dom@18.3.1",
  "react-dom/client":"https://esm.sh/react-dom@18.3.1/client"
}}
</script>
<style>body{margin:0;padding:16px;background:#0a0a0a;color:#f4f4f5;font-family:system-ui,sans-serif;}#err{color:#ff8a8a;font:12px monospace;white-space:pre-wrap;}</style>
</head>
<body>
<div id="root"></div>
<div id="err"></div>
<script type="module">
import * as React from "react";
import { createRoot } from "react-dom/client";
window.React = React;
try {
  const code = \`${escaped}\`;
  const url = URL.createObjectURL(new Blob([code], {type:"text/javascript"}));
  const mod = await import(url);
  const App = mod.default || mod.App;
  if (!App) throw new Error("Tidak ada default export — pastikan komponen di-export default.");
  createRoot(document.getElementById("root")).render(React.createElement(App));
} catch (e) {
  document.getElementById("err").textContent = "Preview error: " + (e && e.message ? e.message : e);
}
</scr` + `ipt>
</body>
</html>`;
}

export default function ArtifactStudio({ onClose, refreshKey }: Props) {
  const [list, setList] = useState<ArtifactMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("");
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState("");

  const reload = async () => {
    try {
      setList(await listArtifacts());
    } catch {
      /* abaikan */
    }
  };

  useEffect(() => {
    reload();
  }, [refreshKey]);

  const open = async (id: string) => {
    setSelectedId(id);
    setPreviewDoc(null);
    setCompileError("");
    const meta = list.find((a) => a.id === id);
    const fname = meta?.filename ?? "";
    setFilename(fname);
    // File media tidak perlu dimuat sebagai teks (biner) — langsung preview mentah
    if (mediaKind(fname)) {
      setSource("");
      return;
    }
    try {
      const a = await getArtifact(id);
      setSource(a.sourceCode);
      setFilename(a.filename);
    } catch {
      setSource("// Gagal memuat artifact");
    }
  };

  const runPreview = async () => {
    if (!selectedId) return;
    setCompiling(true);
    setCompileError("");
    try {
      const r = await compileArtifact(selectedId, source);
      if (r.code) {
        setPreviewDoc(buildPreviewDoc(r.code));
      } else {
        setCompileError(r.detail || r.error || "Compile gagal");
      }
    } catch (e) {
      setCompileError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompiling(false);
    }
  };

  const kind = mediaKind(filename);
  const rawUrl = selectedId ? `/api/artifacts/${selectedId}/raw` : "";

  return (
    <aside className="h-full w-full md:w-[420px] shrink-0 border-l border-line-hair bg-obsidian-950 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-line-hair">
        <FileCode2 size={15} className="text-signal" />
        <span className="font-mono text-[11px] tracking-[0.08em] text-ink-mute flex-1">
          ARTIFACT STUDIO
        </span>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-obsidian-800"
          aria-label="Tutup studio"
        >
          <X size={14} />
        </button>
      </div>

      {!selectedId ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {list.length === 0 && (
            <p className="text-xs text-ink-faint px-2 py-6 leading-relaxed">
              Belum ada artifact.
              <br />
              Minta agen membuatkan kode — file tersimpan otomatis di sini.
            </p>
          )}
          {list.map((a) => {
            const kind = mediaKind(a.filename);
            const ListIcon =
              kind === "image" ? ImageIcon : kind === "audio" ? FileAudio : Code2;
            return (
              <button
                key={a.id}
                onClick={() => open(a.id)}
                className="w-full flex items-center gap-2.5 rounded-xl border border-line-hair bg-obsidian-900 hover:border-line-soft px-3 py-2.5 text-left transition-colors"
              >
                <ListIcon size={14} className="text-ink-mute shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink truncate">{a.filename}</span>
                  <span className="block font-mono text-[10px] text-ink-faint">
                    {a.language} · {new Date(a.updatedAt).toLocaleString("id-ID")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-line-hair">
            <button
              onClick={() => {
                setSelectedId(null);
                setPreviewDoc(null);
              }}
              className="text-xs text-ink-mute hover:text-ink font-mono"
            >
              ← Kembali
            </button>
            <span className="text-sm text-ink truncate flex-1">{filename}</span>
            {!kind && (
              <button
                onClick={runPreview}
                disabled={compiling}
                className="flex items-center gap-1.5 rounded-full bg-ink text-void text-xs font-medium px-3 py-1.5 hover:bg-[#e4e4e7] disabled:opacity-40 transition-all"
              >
                {compiling ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Play size={13} />
                )}
                Preview
              </button>
            )}
          </div>

          {kind === "image" ? (
            <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-void min-h-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={rawUrl}
                alt={filename}
                className="max-h-full max-w-full object-contain rounded-xl border border-line-hair"
              />
            </div>
          ) : kind === "audio" ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 min-h-0">
              <div className="w-16 h-16 rounded-2xl bg-obsidian-800 border border-line-soft flex items-center justify-center">
                <FileAudio size={26} className="text-signal" />
              </div>
              <p className="text-sm text-ink-mute font-mono truncate max-w-full">
                {filename}
              </p>
              <audio controls src={rawUrl} className="w-full max-w-sm" />
            </div>
          ) : (
            <>
              {compileError && (
                <p className="mx-3 mt-2 text-[11px] font-mono text-red-400 whitespace-pre-wrap">
                  {compileError}
                </p>
              )}

              {previewDoc ? (
                <div className="flex-1 flex flex-col min-h-0">
                  <p className="px-3 py-1.5 font-mono text-[10px] tracking-widest text-ink-faint border-b border-line-hair flex items-center gap-1.5">
                    <Eye size={11} /> LIVE PREVIEW
                  </p>
                  <iframe
                    title="preview"
                    srcDoc={previewDoc}
                    sandbox="allow-scripts"
                    className="flex-1 w-full bg-obsidian-900 min-h-[280px]"
                  />
                </div>
              ) : (
                <pre className="flex-1 overflow-auto p-3.5 font-mono text-[12px] leading-relaxed text-ink-dim whitespace-pre-wrap break-words">
                  {source}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
