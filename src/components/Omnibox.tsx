"use client";

import { ArrowUp, Bot, Paperclip } from "lucide-react";
import { useState } from "react";

interface Props {
  onSend: (text: string, opts: { agentMode: boolean; model: string }) => void;
  streaming: boolean;
  defaultModel: string;
}

export default function Omnibox({ onSend, streaming, defaultModel }: Props) {
  const [text, setText] = useState("");
  const [agentMode, setAgentMode] = useState(false);
  const [model, setModel] = useState(defaultModel);
  const [editingModel, setEditingModel] = useState(false);

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    onSend(t, { agentMode, model });
    setText("");
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
            agentMode
              ? "Perintah untuk agen otonom… mis. buatkan komponen React tombol neon"
              : "Tanya apa saja…"
          }
          rows={1}
          className="w-full bg-transparent resize-none outline-none px-5 pt-4 pb-1 text-[15px] placeholder:text-ink-faint max-h-40"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <div className="flex items-center gap-2 px-3 pb-3 pt-1">
          {/* Model selector pill */}
          {editingModel ? (
            <input
              autoFocus
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => setEditingModel(false)}
              onKeyDown={(e) => e.key === "Enter" && setEditingModel(false)}
              className="font-mono text-[11px] bg-obsidian-850 border border-line-soft rounded-full px-3 py-1.5 outline-none w-52"
            />
          ) : (
            <button
              onClick={() => setEditingModel(true)}
              title="Klik untuk ubah model"
              className="font-mono text-[11px] text-ink-mute border border-line-hair rounded-full px-3 py-1.5 hover:border-line-soft hover:text-ink transition-colors truncate max-w-52"
            >
              {model}
            </button>
          )}

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

          <button
            title="Lampiran (segera hadir)"
            disabled
            className="w-8 h-8 flex items-center justify-center rounded-full text-ink-faint opacity-40 cursor-not-allowed"
          >
            <Paperclip size={15} />
          </button>

          <div className="flex-1" />

          {/* Submit */}
          <button
            onClick={submit}
            disabled={!text.trim() || streaming}
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
