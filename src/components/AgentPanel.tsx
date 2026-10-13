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
  renderMarkdown,
  type AgentRunStatus,
} from "@/lib/client-api";

interface Props {
  runId: string;
  goal: string;
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

export default function AgentPanel({ runId, goal, onClose, onDone }: Props) {
  const [status, setStatus] = useState<AgentRunStatus | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
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

  const runStatus = status?.run.status ?? "queued";
  const done = runStatus === "completed" || runStatus === "failed";

  return (
    <div className="rounded-2xl border border-signal/40 bg-obsidian-950 shadow-signal-glow overflow-hidden rise-in">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line-hair">
        <span
          className={`w-2 h-2 rounded-full bg-signal shrink-0 ${!done ? "pip-live" : ""}`}
        />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] tracking-[0.08em] text-signal">
            AGENT · {STATUS_LABEL[runStatus] ?? runStatus}
            {runStatus === "running" && status
              ? ` · LANGKAH ${status.run.currentStep}`
              : ""}
          </p>
          <p className="text-sm text-ink-mute truncate mt-0.5">{goal}</p>
          {status?.run.workspaceDir && (
            <p
              className="font-mono text-[10px] text-ink-faint truncate mt-0.5 flex items-center gap-1"
              title={status.run.workspaceDir}
            >
              <FolderGit2 size={11} className="shrink-0" />
              {status.run.workspaceDir}
            </p>
          )}
        </div>
        {!done ? (
          <Loader2 size={15} className="text-signal animate-spin shrink-0" />
        ) : runStatus === "completed" ? (
          <CheckCircle2 size={15} className="text-green-400 shrink-0" />
        ) : (
          <XCircle size={15} className="text-red-400 shrink-0" />
        )}
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-obsidian-800"
          aria-label="Tutup panel agen"
        >
          <X size={14} />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto px-4 py-3 space-y-2">
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

        {/* Rencana */}
        {status && status.plan.length > 0 && (
          <div className="space-y-1 mb-3">
            <p className="font-mono text-[10px] tracking-widest text-ink-faint mb-1.5">
              RENCANA
            </p>
            {status.plan.map((p, i) => {
              const stepDone =
                status.run.currentStep > p.step || done;
              return (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {stepDone ? (
                    <CheckCircle2 size={13} className="text-signal mt-0.5 shrink-0" />
                  ) : (
                    <Circle size={13} className="text-ink-faint mt-0.5 shrink-0" />
                  )}
                  <span className={stepDone ? "text-ink-mute" : "text-ink-faint"}>
                    {p.title}
                    {p.tool && (
                      <span className="font-mono text-[10px] text-signal/80 ml-1.5">
                        {p.tool}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
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
              className="rounded-xl border border-line-hair bg-obsidian-900 overflow-hidden"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : s.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-obsidian-850 transition-colors"
              >
                <Wrench size={13} className="text-signal shrink-0" />
                <span className="font-mono text-xs text-ink truncate flex-1">
                  {s.toolName}
                </span>
                <span className="font-mono text-[10px] text-ink-faint shrink-0">
                  {s.durationMs}ms
                </span>
                {resultOk === true && (
                  <CheckCircle2 size={13} className="text-green-400 shrink-0" />
                )}
                {resultOk === false && (
                  <XCircle size={13} className="text-red-400 shrink-0" />
                )}
                <ChevronDown
                  size={13}
                  className={`text-ink-faint shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="px-3 pb-3">
                  <pre className="font-mono text-[11px] text-ink-mute whitespace-pre-wrap break-words bg-void rounded-lg p-2.5 border border-line-hair max-h-48 overflow-y-auto">
                    {resultText || "(kosong)"}
                  </pre>
                </div>
              )}
            </div>
          );
        })}

        {status && status.run.error && (
          <p className="text-xs text-red-400 font-mono">{status.run.error}</p>
        )}

        {/* Jawaban final agen */}
        {done && status?.run.resultText && (
          <div className="mt-3">
            <p className="font-mono text-[10px] tracking-widest text-signal mb-1.5">
              HASIL
            </p>
            <div
              className="prose-xgolda text-sm text-ink bg-void rounded-xl border border-line-hair px-3.5 py-3 break-words"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(status.run.resultText),
              }}
            />
          </div>
        )}

        {!status && !error && (
          <p className="text-xs text-ink-faint font-mono flex items-center gap-2">
            <Play size={12} /> Menghubungi agen…
          </p>
        )}
      </div>
    </div>
  );
}
