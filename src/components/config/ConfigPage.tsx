"use client";

import {
  Bot,
  CheckCircle2,
  Cpu,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Source = "ui" | "env" | "default";

interface RowDef {
  key: string;
  label: string;
  hint?: string;
}

interface SectionDef {
  title: string;
  icon: LucideIcon;
  blurb: string;
  rows: RowDef[];
}

const SECTIONS: SectionDef[] = [
  {
    title: "Gateway",
    icon: Cpu,
    blurb: "Endpoint 9Router lokal & model per kemampuan.",
    rows: [
      { key: "INTERNAL_INFERENCE_ENDPOINT", label: "Inference Endpoint", hint: "URL basis OpenAI-compatible 9Router di PC ini." },
      { key: "DEFAULT_MODEL", label: "Model Chat Default", hint: "Dipakai chat & agent bila tidak dipilih manual." },
      { key: "EMBEDDING_MODEL", label: "Model Embedding", hint: "Untuk vector search / memori semantik." },
      { key: "WEB_SEARCH_MODEL", label: "Model Web Search", hint: "Tool web_search agen." },
      { key: "WEB_FETCH_MODEL", label: "Model Web Fetch", hint: "Tool web_fetch agen (URL → markdown)." },
      { key: "IMAGE_MODEL", label: "Model Image Generation", hint: "Tool generate_image agen." },
      { key: "TTS_MODEL", label: "Model Text-to-Speech", hint: "Tool text_to_speech agen." },
    ],
  },
  {
    title: "Agent",
    icon: Bot,
    blurb: "Batas loop otonom & safety gate.",
    rows: [
      { key: "AGENT_MAX_STEPS", label: "Max Steps per Run", hint: "Batas iterasi plan → execute → evaluate." },
      { key: "EXECUTION_TIMEOUT_MS", label: "Execution Timeout (ms)", hint: "terminal_exec dibunuh otomatis melewati batas ini." },
      { key: "APPROVAL_TIMEOUT_MS", label: "Approval Timeout (ms)", hint: "Perintah berbahaya kedaluwarsa tanpa keputusan." },
    ],
  },
  {
    title: "Retry",
    icon: RefreshCw,
    blurb: "Kebijakan retry gateway.",
    rows: [
      { key: "AI_RETRY_ATTEMPTS", label: "Retry Attempts", hint: "Berlaku untuk 429 / 5xx / network error." },
      { key: "AI_RETRY_BASE_MS", label: "Retry Base Delay (ms)", hint: "Digandakan tiap percobaan, plus jitter." },
    ],
  },
];

function SourceBadge({ source }: { source: Source }) {
  if (source === "ui")
    return (
      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full border border-signal/50 text-signal bg-signal/10 shrink-0">
        UI
      </span>
    );
  return (
    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full border border-line-soft text-ink-faint shrink-0">
      {source === "env" ? "ENV" : "DEFAULT"}
    </span>
  );
}

export default function ConfigPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, Source>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/config");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Gagal memuat config");
      setValues(j.values ?? {});
      setSources(j.sources ?? {});
      setDrafts(j.values ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const save = async (key: string) => {
    setSavingKey(key);
    setError("");
    try {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: drafts[key] ?? "" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Gagal menyimpan");
      setToast(`Tersimpan ✓ — ${key} berlaku langsung tanpa restart.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  };

  const reset = async (key: string) => {
    setSavingKey(key);
    setError("");
    try {
      const r = await fetch(`/api/config?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Gagal mereset");
      setToast(`Reset ✓ — ${key} kembali mengikuti .env/default.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="w-full bg-void">
      <div className="mx-auto w-full max-w-4xl px-4 md:px-6 py-6 md:py-8">
        {/* Header */}
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-ink-faint flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-signal shadow-pip-glow" />
          XGOLDA
          <span className="text-line-mid">/</span>
          <span>Update Config</span>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          Update Config
        </h1>

        {/* Notice */}
        <div className="mt-5 rounded-2xl border border-line-hair bg-obsidian-950 px-4 py-3.5 flex items-start gap-3">
          <Info size={15} className="text-signal shrink-0 mt-0.5" />
          <p className="text-xs text-ink-mute leading-relaxed">
            Perubahan via halaman ini tersimpan <strong className="text-ink">persisten</strong> &amp;
            berlaku <strong className="text-ink">LANGSUNG tanpa restart server</strong> (mengalahkan .env).
            Secret tidak bisa diubah dari sini — tetap via <code className="font-mono text-signal/90">.env.local</code>.
          </p>
        </div>

        {toast && (
          <div className="mt-4 rounded-2xl border border-signal/40 bg-signal/5 px-4 py-3 flex items-center gap-2.5">
            <CheckCircle2 size={15} className="text-signal shrink-0" />
            <p className="text-xs text-ink">{toast}</p>
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-2xl border border-red-900/60 bg-red-950/30 px-4 py-3">
            <p className="font-mono text-xs text-red-400">{error}</p>
          </div>
        )}

        {loading ? (
          <p className="mt-8 text-xs text-ink-faint font-mono flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" /> Memuat konfigurasi…
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <section
                  key={section.title}
                  className="rounded-2xl border border-line-hair bg-obsidian-950 px-5 md:px-6 py-2"
                >
                  <div className="flex items-center gap-3 pt-4 pb-1">
                    <div className="w-9 h-9 rounded-xl bg-obsidian-800 border border-line-soft flex items-center justify-center shrink-0">
                      <Icon size={16} className="text-signal" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-ink">
                        {section.title}
                      </h2>
                      <p className="text-xs text-ink-faint mt-0.5">
                        {section.blurb}
                      </p>
                    </div>
                  </div>
                  <div className="pb-2">
                    {section.rows.map((row) => {
                      const source: Source = sources[row.key] ?? "default";
                      const busy = savingKey === row.key;
                      return (
                        <div
                          key={row.key}
                          className="py-4 border-b border-line-hair last:border-0"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm text-ink font-medium">
                              {row.label}
                            </p>
                            <SourceBadge source={source} />
                          </div>
                          <p className="font-mono text-[10px] text-ink-faint mt-1">
                            {row.key}
                          </p>
                          {row.hint && (
                            <p className="text-xs text-ink-faint mt-1">
                              {row.hint}
                            </p>
                          )}
                          <div className="flex flex-col sm:flex-row gap-2 mt-2.5">
                            <input
                              value={drafts[row.key] ?? ""}
                              onChange={(e) =>
                                setDrafts((d) => ({
                                  ...d,
                                  [row.key]: e.target.value,
                                }))
                              }
                              spellCheck={false}
                              className="flex-1 min-w-0 font-mono text-xs bg-obsidian-900 border border-line-hair rounded-lg px-3 py-2.5 text-ink outline-none focus:border-signal/60 transition-colors"
                            />
                            <div className="flex gap-2 shrink-0">
                              <button
                                onClick={() => save(row.key)}
                                disabled={busy}
                                className="flex items-center gap-1.5 rounded-lg bg-ink text-void text-xs font-medium px-3.5 py-2.5 hover:bg-[#e4e4e7] disabled:opacity-40 transition-all"
                              >
                                {busy ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Save size={13} />
                                )}
                                Simpan
                              </button>
                              {source === "ui" && (
                                <button
                                  onClick={() => reset(row.key)}
                                  disabled={busy}
                                  title="Kembalikan mengikuti .env/default"
                                  className="flex items-center gap-1.5 rounded-lg border border-line-soft text-ink-mute text-xs px-3.5 py-2.5 hover:text-ink hover:border-line-mid disabled:opacity-40 transition-all"
                                >
                                  <RotateCcw size={13} />
                                  Reset
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <p className="font-mono text-[10px] text-ink-faint mt-6 text-center">
          XGOLDA runs fully on localhost — configuration never leaves this PC.
        </p>
      </div>
    </div>
  );
}
