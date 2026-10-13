"use client";

import {
  CheckCircle2,
  ChevronDown,
  Circle,
  FolderGit2,
  Loader2,
  Play,
  ShieldAlert,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  decideApproval,
  getAgentStatus,
  type AgentRunStatus,
  type ChatMessage,
} from "@/lib/client-api";
import type { RunEvent } from "@/lib/agent/bus";
import MessageItem from "./MessageItem";

interface Props {
  runId: string;
  onClose: () => void;
  /** Dipanggil sekali saat run selesai/gagal — untuk refresh daftar pesan. */
  onDone?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Antre",
  planning: "Menyusun rencana",
  running: "Berjalan",
  completed: "Selesai",
  failed: "Gagal",
};

export default function AgentPanel({ runId, onClose, onDone }: Props) {
  const [status, setStatus] = useState<AgentRunStatus | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Teks jawaban final yang di-stream via SSE (token per token). */
  const [streamText, setStreamText] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneFired = useRef(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await getAgentStatus(runId);
        if (!alive) return;
        setStatus(s);
        if (s.run.status === "completed" || s.run.status === "failed") {
          if (timer.current) clearInterval(timer.current);
          if (!doneFired.current) {
            doneFired.current = true;
            onDone?.();
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    timer.current = setInterval(poll, 2000);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [runId]);

  // SSE: streaming token jawaban final agen (real-time, bukan polling)
  useEffect(() => {
    const es = new EventSource(`/api/agent/stream?runId=${encodeURIComponent(runId)}`);
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as RunEvent;
        if (e.type === "token") {
          setStreamText((t) => t + e.text);
        } else if (e.type === "final") {
          setStreamText(e.text);
          es.close();
        } else if (e.type === "done" || e.type === "error") {
          // Beri jeda agar token terakhir sempat dirender
          setTimeout(() => es.close(), 1000);
        }
      } catch {
        /* abaikan frame rusak */
      }
    };
    es.onerror = () => {
      /* EventSource reconnect otomatis; biarkan */
    };
    return () => es.close();
  }, [runId]);

  const runStatus = status?.run.status ?? "queued";
  const done = runStatus === "completed" || runStatus === "failed";
  // Bubble jawaban: streaming dulu, fallback ke resultText dari status
  const finalText = streamText || status?.run.resultText || "";
  const finalMessage: ChatMessage = {
    id: `${runId}-final`,
    sessionId: "",
    role: "assistant",
    content: finalText,
    reasoningContent: "",
    createdAt: Date.now(),
  };

  return (
    <>
    <div className="rounded-xl border border-signal/40 bg-obsidian-950 shadow-signal-glow overflow-hidden rise-in">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line-hair">
        <span
          className={`w-1.5 h-1.5 rounded-full bg-signal shrink-0 ${!done ? "pip-live" : ""}`}
        />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.08em] text-signal">
            AGENT · {STATUS_LABEL[runStatus] ?? runStatus}
            {runStatus === "running" && status
              ? ` · LANGKAH ${status.run.currentStep}`
              : ""}
          </p>
          {status?.run.workspaceDir && (
            <p
              className="font-mono text-[10px] text-ink-faint truncate flex items-center gap-1"
              title={status.run.workspaceDir}
            >
              <FolderGit2 size={10} className="shrink-0" />
              {status.run.workspaceDir}
            </p>
          )}
        </div>
        {!done ? (
          <Loader2 size={13} className="text-signal animate-spin shrink-0" />
        ) : runStatus === "completed" ? (
          <CheckCircle2 size={13} className="text-green-400 shrink-0" />
        ) : (
          <XCircle size={13} className="text-red-400 shrink-0" />
        )}
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-obsidian-800"
          aria-label="Tutup panel agen"
        >
          <X size={13} />
        </button>
      </div>

      <div className="max-h-56 overflow-y-auto px-3 py-2 space-y-1.5">
        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Approval gate — perintah berbahaya menunggu keputusan */}
        {status && status.approvals.length > 0 && (
          <div className="space-y-2 mb-3">
            <p className="font-mono text-[10px] tracking-widest text-amber-300/80 mb-1 flex items-center gap-1.5">
              <ShieldAlert size={11} /> PERSETUJUAN DIBUTUHKAN
            </p>
            {status.approvals.map((a) => (
              <div
                key={a.id}
                className="rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2.5"
              >
                <p className="text-[11px] text-amber-200/90 font-medium">
                  {a.reason}
                </p>
                <pre className="font-mono text-[11px] text-ink whitespace-pre-wrap break-words mt-1.5 max-h-24 overflow-y-auto">
                  {a.command}
                </pre>
                {a.status === "pending" ? (
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => decideApproval(a.id, "approved").catch((e) => setError(e.message))}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs font-medium hover:bg-emerald-500/30 transition-colors"
                    >
                      Setujui
                    </button>
                    <button
                      onClick={() => decideApproval(a.id, "rejected").catch((e) => setError(e.message))}
                      className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-400/40 text-red-200 text-xs font-medium hover:bg-red-500/30 transition-colors"
                    >
                      Tolak
                    </button>
                  </div>
                ) : (
                  <p className="font-mono text-[10px] mt-2 text-ink-faint">
                    {a.status === "approved"
                      ? "✓ disetujui"
                      : a.status === "rejected"
                        ? "✗ ditolak"
                        : "⏱ kedaluwarsa (tanpa keputusan)"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Rencana — ringkas */}
        {status && status.plan.length > 0 && (
          <div className="mb-2">
            <p className="font-mono text-[9px] tracking-[0.15em] text-ink-faint mb-1">
              RENCANA
            </p>
            <div className="space-y-0.5">
              {status.plan.map((p, i) => {
                // Centang jujur: hanya langkah yang benar-benar dilewati.
                // Jangan tandai semua selesai hanya karena run berakhir.
                const stepDone = status.run.currentStep > p.step;
                return (
                  <div key={i} className="flex items-center gap-1.5 text-[11px] leading-tight">
                    {stepDone ? (
                      <CheckCircle2 size={11} className="text-signal shrink-0" />
                    ) : (
                      <Circle size={11} className="text-ink-faint shrink-0" />
                    )}
                    <span className={`truncate ${stepDone ? "text-ink-mute" : "text-ink-faint"}`}>
                      {p.title}
                      {p.tool && (
                        <span className="font-mono text-[9px] text-signal/80 ml-1">
                          {p.tool}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Langkah tool */}
        {status?.steps.map((s) => {
          const isOpen = expanded === s.id;
          let resultOk: boolean | null = null;
          let resultText = "";
          try {
            const r = s.result as { ok?: boolean; output?: string };
            if (r && typeof r === "object") {
              resultOk = r.ok ?? null;
              resultText = String(r.output ?? "").slice(0, 2000);
            }
          } catch {
            /* abaikan */
          }
          return (
            <div
              key={s.id}
              className="rounded-lg border border-line-hair bg-obsidian-900 overflow-hidden"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : s.id)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-obsidian-850 transition-colors"
              >
                <Wrench size={11} className="text-signal shrink-0" />
                <span className="font-mono text-[11px] text-ink truncate flex-1">
                  {s.toolName}
                </span>
                <span className="font-mono text-[9px] text-ink-faint shrink-0">
                  {s.durationMs}ms
                </span>
                {resultOk === true && (
                  <CheckCircle2 size={11} className="text-green-400 shrink-0" />
                )}
                {resultOk === false && (
                  <XCircle size={11} className="text-red-400 shrink-0" />
                )}
                <ChevronDown
                  size={11}
                  className={`text-ink-faint shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="px-2.5 pb-2">
                  <pre className="font-mono text-[10px] text-ink-mute whitespace-pre-wrap break-words bg-void rounded-md p-2 border border-line-hair max-h-40 overflow-y-auto">
                    {resultText || "(kosong)"}
                  </pre>
                </div>
              )}
            </div>
          );
        })}

        {status && status.run.error && (
          <p className="text-[11px] text-red-400 font-mono">{status.run.error}</p>
        )}

        {!status && !error && (
          <p className="text-[11px] text-ink-faint font-mono flex items-center gap-2">
            <Play size={11} /> Menghubungi agen…
          </p>
        )}
      </div>
    </div>
    {/* Bubble jawaban agen — tepat di bawah plan box-nya */}
    {finalText && (
      <MessageItem message={finalMessage} streaming={!done && !!streamText} />
    )}
    </>
  );
}
