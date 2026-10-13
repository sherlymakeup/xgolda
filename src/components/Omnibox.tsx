"use client";

import { ArrowUp, Bot, ChevronDown, Loader2, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ModePills from "./home/ModePills";
import { looksLikeTask } from "@/lib/intent";
import {
  listGatewayModels,
  uploadImage,
  type Attachment,
} from "@/lib/client-api";

interface Props {
  onSend: (
    text: string,
    opts: {
      agentMode: boolean;
      model: string;
      mode: string;
      attachments?: Attachment[];
    }
  ) => void;
  streaming: boolean;
  /** Nama model dari server (/api/config) — nilai env asli, bukan hardcode. */
  defaultModel: string;
  mode: string;
  onModeChange: (m: string) => void;
  /** Label untuk pil model pertama (nama model asli, boleh dipendekkan). */
  modelLabel: string;
}

const PLACEHOLDERS: Record<string, string> = {
  standard: "Tanya apa saja…",
  think: "Tanya dengan penalaran mendalam…",
  web: "Cari info terkini / riset web… (agen akan pakai curl via terminal)",
  code: "Perintah untuk agen otonom… mis. buatkan komponen React tombol neon",
};

export default function Omnibox({
  onSend,
  streaming,
  defaultModel,
  mode,
  onModeChange,
  modelLabel,
}: Props) {
  const [text, setText] = useState("");
  const [agentMode, setAgentMode] = useState(false);
  const [model, setModel] = useState("");

  // --- Model dropdown (daftar dinamis dari gateway) ---
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<{ id: string; owned_by: string }[] | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState("");

  // --- Lampiran gambar (vision) ---
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Sinkron sekali saat nama model asli tiba dari server;
  // pilihan manual user setelah itu tidak ditimpa.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (defaultModel && !syncedRef.current) {
      setModel(defaultModel);
      syncedRef.current = true;
    }
  }, [defaultModel]);

  const toggleModelDropdown = () => {
    const next = !modelOpen;
    setModelOpen(next);
    if (next) setModelFilter("");
    if (next && models === null && !modelLoading) {
      setModelLoading(true);
      setModelError("");
      listGatewayModels("chat")
        .then((list) => {
          setModels(list);
          setModelLoading(false);
        })
        .catch((e) => {
          setModelError(e instanceof Error ? e.message : String(e));
          setModelLoading(false);
        });
    }
  };

  const filteredModels = (models ?? []).filter((m) =>
    m.id.toLowerCase().includes(modelFilter.trim().toLowerCase())
  );

  const pickFiles = () => fileRef.current?.click();

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(
      0,
      Math.max(0, 4 - attachments.length)
    );
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      for (const f of files) {
        const r = await uploadImage(f);
        setAttachments((a) =>
          a.length < 4 ? [...a, { id: r.id, mime: r.mime }] : a
        );
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((a) => a.filter((x) => x.id !== id));

  const canSubmit = (text.trim() !== "" || attachments.length > 0) && !streaming;

  const submit = () => {
    const t = text.trim();
    if ((!t && attachments.length === 0) || streaming) return;
    // Auto-route: perintah eksekusi langsung jadi agent task (toggle ikut nyala
    // sebagai penanda). Approval gate tetap berlaku untuk perintah berbahaya.
    const taskLike = looksLikeTask(t);
    if (taskLike) setAgentMode(true);
    const forceAgent =
      agentMode || taskLike || mode === "web" || mode === "code";
    onSend(t, {
      agentMode: forceAgent,
      model: model || defaultModel,
      mode,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    setText("");
    setAttachments([]);
    setModelOpen(false);
  };

  const handleModeChange = (m: string) => {
    onModeChange(m);
    if (m === "web" || m === "code") setAgentMode(true);
  };

  return (
    <div className="w-full">
      <div
        className={`rounded-2xl border bg-obsidian-950 transition-all ${
          agentMode
            ? "border-signal/60 shadow-signal-glow"
            : "border-line-hair focus-within:border-line-mid"
        }`}
      >
        {/* Attachment thumbnails */}
        {(attachments.length > 0 || uploading || uploadError) && (
          <div className="flex items-center gap-1.5 px-4 pt-2.5 flex-wrap">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="relative w-12 h-12 rounded-lg overflow-hidden border border-line-soft shrink-0"
              >
                <img
                  src={`/api/uploads/${a.id}/raw`}
                  alt="attachment"
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => removeAttachment(a.id)}
                  aria-label="Hapus lampiran"
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-void/80 border border-line-soft flex items-center justify-center text-ink-mute hover:text-ink transition-colors"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {uploading && (
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-faint">
                <Loader2 size={12} className="animate-spin" /> uploading…
              </span>
            )}
            {uploadError && (
              <span className="font-mono text-[11px] text-red-400">
                {uploadError}
              </span>
            )}
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            agentMode && mode !== "web" && mode !== "code"
              ? "Perintah untuk agen otonom… mis. buatkan komponen React tombol neon"
              : (PLACEHOLDERS[mode] ?? "Tanya apa saja…")
          }
          rows={1}
          className="w-full bg-transparent resize-none outline-none px-4 pt-3 pb-1 text-sm placeholder:text-ink-faint max-h-40"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        {/* Satu baris kontrol: mode + model + agent + attach + kirim */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 pt-1">
          <ModePills mode={mode} onChange={handleModeChange} modelLabel={modelLabel} compact />
          {/* Model selector dropdown */}
          <div className="relative">
            <button
              onClick={toggleModelDropdown}
              title="Pilih model"
              className={`flex items-center gap-1.5 font-mono text-[11px] border rounded-full px-3 py-1.5 transition-colors truncate max-w-52 ${
                modelOpen
                  ? "text-signal border-signal/60 bg-obsidian-850"
                  : "text-ink-mute border-line-hair hover:border-line-soft hover:text-ink"
              }`}
            >
              <span className="truncate">{model || defaultModel || "…"}</span>
              <ChevronDown
                size={12}
                className={`shrink-0 transition-transform ${modelOpen ? "rotate-180" : ""}`}
              />
            </button>
            {modelOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setModelOpen(false)}
                />
                <div className="absolute bottom-full left-0 mb-2 w-80 max-w-[80vw] z-50 rounded-xl border border-line-soft bg-obsidian-900 shadow-2xl overflow-hidden flex flex-col">
                  <div className="p-2 border-b border-line-hair">
                    <input
                      autoFocus
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      placeholder="Filter models…"
                      className="w-full bg-obsidian-950 border border-line-hair rounded-lg px-3 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-line-soft"
                    />
                  </div>
                  <div className="overflow-y-auto max-h-64 py-1">
                    {modelLoading && (
                      <p className="flex items-center gap-2 px-3 py-3 font-mono text-[11px] text-ink-faint">
                        <Loader2 size={12} className="animate-spin" />
                        Loading models…
                      </p>
                    )}
                    {modelError && (
                      <p className="px-3 py-3 font-mono text-[11px] text-red-400 break-words">
                        {modelError}
                      </p>
                    )}
                    {!modelLoading &&
                      !modelError &&
                      filteredModels.length === 0 && (
                        <p className="px-3 py-3 font-mono text-[11px] text-ink-faint">
                          No models found.
                        </p>
                      )}
                    {filteredModels.map((m) => {
                      const active = m.id === (model || defaultModel);
                      return (
                        <button
                          key={m.id}
                          onClick={() => {
                            setModel(m.id);
                            syncedRef.current = true;
                            setModelOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 hover:bg-obsidian-850 transition-colors ${
                            active ? "bg-obsidian-850" : ""
                          }`}
                        >
                          <span
                            className={`block font-mono text-xs truncate ${
                              active ? "text-signal" : "text-ink"
                            }`}
                          >
                            {m.id}
                          </span>
                          <span className="block font-mono text-[10px] text-ink-faint truncate">
                            {m.owned_by}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Agent mode toggle */}
          <button
            onClick={() => setAgentMode(!agentMode)}
            title="Mode agen otonom (plan → tool → eksekusi)"
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium border transition-all ${
              agentMode
                ? "bg-obsidian-850 border-signal text-signal shadow-pip-glow"
                : "border-line-hair text-ink-mute hover:border-line-soft hover:text-ink"
            }`}
          >
            <Bot size={13} />
            Agent
          </button>

          {/* Image attachment (vision) */}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={onFiles}
          />
          <button
            onClick={pickFiles}
            title="Lampirkan gambar"
            disabled={uploading || attachments.length >= 4}
            className="w-8 h-8 flex items-center justify-center rounded-full text-ink-mute hover:text-ink hover:bg-obsidian-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Paperclip size={15} />
          </button>

          <div className="flex-1" />

          {/* Submit */}
          <button
            onClick={submit}
            disabled={!canSubmit}
            aria-label="Kirim"
            className="w-9 h-9 rounded-full bg-ink text-void flex items-center justify-center hover:bg-[#e4e4e7] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ArrowUp size={17} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      <p className="text-center font-mono text-[10px] text-ink-faint mt-2 tracking-wide">
        ENTER kirim · SHIFT+ENTER baris baru · berjalan lokal, data tidak keluar dari PC ini
      </p>
    </div>
  );
}
