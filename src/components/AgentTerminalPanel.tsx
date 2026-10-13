"use client";

import { CheckCircle2, Loader2, Terminal, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAgentStatus, type AgentRunStatus } from "@/lib/client-api";

interface Props {
  runIds: string[];
  open: boolean;
  onClose: () => void;
  /** Dipanggil saat ada/tidak ada aktivitas terminal (untuk auto-open). */
  onActivityChange: (active: boolean) => void;
}

interface TermStep {
  runId: string;
  goal: string;
  id: string;
  command: string;
  output: string;
  ok: boolean | null;
  durationMs?: number;
  createdAt: number;
}

/**
 * Drawer kanan kontekstual: otomatis tampil saat agen memakai terminal_exec.
 * Menampilkan progres perintah terminal per run (live via polling).
 */
export default function AgentTerminalPanel({ runIds, open, onClose, onActivityChange }: Props) {
  const [terms, setTerms] = useState<TermStep[]>([]);
  const lastActive = useRef(false);

  useEffect(() => {
    if (runIds.length === 0) {
      setTerms([]);
      if (lastActive.current) {
        lastActive.current = false;
        onActivityChange(false);
      }
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const statuses: AgentRunStatus[] = await Promise.all(
          runIds.map((id) => getAgentStatus(id).catch(() => null))
        ).then((r) => r.filter(Boolean) as AgentRunStatus[]);
        if (!alive) return;
        const list: TermStep[] = [];
        for (const s of statuses) {
          for (const st of s.steps) {
            if (st.toolName !== "terminal_exec") continue;
            let command = "";
            let output = "";
            let ok: boolean | null = null;
            try {
              const a = st.args as { command?: string };
              command = String(a?.command ?? "");
              const r = st.result as { ok?: boolean; output?: string };
              ok = r?.ok ?? null;
              output = String(r?.output ?? "").slice(0, 4000);
            } catch {
              /* abaikan */
            }
            list.push({
              runId: s.run.id,
              goal: s.run.goal,
              id: st.id,
              command,
              output,
              ok,
              durationMs: st.durationMs,
              createdAt: st.createdAt,
            });
          }
        }
        list.sort((a, b) => a.createdAt - b.createdAt);
        setTerms(list);
        const active = list.length > 0;
        if (active !== lastActive.current) {
          lastActive.current = active;
          onActivityChange(active);
        }
      } catch {
        /* abaikan — polling berikutnya coba lagi */
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [runIds.join(","), onActivityChange]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // In-flow (seperti Studio): ikut menggeser kolom chat, bukan overlay.
  // Eksklusivitas Studio XOR Terminal diatur di page.tsx.
  return (
    <div className="h-full w-full md:w-[340px] shrink-0 border-l border-line-hair bg-obsidian-950 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line-hair shrink-0">
        <Terminal size={14} className="text-signal shrink-0" />
        <p className="font-mono text-[11px] tracking-[0.12em] text-ink flex-1">
          TERMINAL ACTIVITY
        </p>
        {terms.some((t) => t.ok === null) && (
          <Loader2 size={13} className="text-signal animate-spin shrink-0" />
        )}
        <button
          onClick={onClose}
          aria-label="Tutup panel terminal"
          className="w-7 h-7 flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-obsidian-800"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {terms.length === 0 && (
          <p className="font-mono text-[11px] text-ink-faint px-1">
            Belum ada perintah terminal dari agen.
          </p>
        )}
        {terms.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-line-hair bg-void overflow-hidden"
          >
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-line-hair">
              {t.ok === true ? (
                <CheckCircle2 size={12} className="text-green-400 shrink-0" />
              ) : t.ok === false ? (
                <XCircle size={12} className="text-red-400 shrink-0" />
              ) : (
                <Loader2 size={12} className="text-signal animate-spin shrink-0" />
              )}
              <span className="font-mono text-[10px] text-ink-faint truncate flex-1">
                {t.goal.slice(0, 48)}
              </span>
              {typeof t.durationMs === "number" && (
                <span className="font-mono text-[10px] text-ink-faint shrink-0">
                  {t.durationMs}ms
                </span>
              )}
            </div>
            <pre className="font-mono text-[11px] text-signal px-3 pt-2 whitespace-pre-wrap break-words">
              $ {t.command}
            </pre>
            {t.output && (
              <pre className="font-mono text-[11px] text-ink-mute px-3 pb-2.5 pt-1 whitespace-pre-wrap break-words max-h-44 overflow-y-auto">
                {t.output}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
