"use client";

import { FileCode2, Menu, Square, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import AgentPanel from "@/components/AgentPanel";
import ArtifactStudio from "@/components/ArtifactStudio";
import MessageItem from "@/components/MessageItem";
import Omnibox from "@/components/Omnibox";
import Sidebar, { type View } from "@/components/Sidebar";
import Hero from "@/components/home/Hero";
import SuggestionCards from "@/components/home/SuggestionCards";
import AgentHub from "@/components/hub/AgentHub";
import AgentTerminalPanel from "@/components/AgentTerminalPanel";
import SettingsPage from "@/components/settings/SettingsPage";
import ConfigPage from "@/components/config/ConfigPage";
import { looksLikeTask } from "@/lib/intent";
import {
  deleteSession,
  getSession,
  listSessions,
  startAgentRun,
  streamChatRequest,
  type Attachment,
  type ChatMessage,
  type Session,
} from "@/lib/client-api";

interface ActiveRun {
  runId: string;
  goal: string;
  createdAt: number;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamMsg, setStreamMsg] = useState({ reasoning: "", content: "" });
  const [latencyMs, setLatencyMs] = useState<number | undefined>();
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioKey, setStudioKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<View>("workspace");
  const [mode, setMode] = useState("standard");
  const [defaultModel, setDefaultModel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState("");
  // Drawer terminal kontekstual: auto-tampil saat agen memakai terminal_exec
  const [termOpen, setTermOpen] = useState(false);
  const [termActive, setTermActive] = useState(false);
  const termAutoKey = useRef("");

  // Muat konfigurasi model dari server (nilai env asli)
  useEffect(() => {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c?.model) setDefaultModel(c.model);
        if (c?.endpoint) setEndpoint(c.endpoint);
      })
      .catch(() => {});
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const runIdsKey = runs.map((r) => r.runId).sort().join(",");
  // Reset penanda auto-open saat tidak ada run aktif
  useEffect(() => {
    if (runs.length === 0) {
      termAutoKey.current = "";
      setTermActive(false);
    }
  }, [runs.length]);

  const handleTermActivity = useCallback(
    (active: boolean) => {
      setTermActive(active);
      if (active && termAutoKey.current !== runIdsKey) {
        termAutoKey.current = runIdsKey;
        setTermOpen(true);
      }
    },
    [runIdsKey]
  );

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions());
    } catch {
      /* abaikan */
    }
  }, []);

  useEffect(() => {
    refreshSessions();
    // Thread isolation: buka ?thread=<id> langsung masuk thread itu
    const tid = new URLSearchParams(window.location.search).get("thread");
    if (tid) loadSession(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamMsg, runs]);

  /** Sinkron URL ?thread=<id> dua arah (bookmarkable, refresh tidak nyasar). */
  const syncThreadUrl = (id?: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("thread", id);
    else url.searchParams.delete("thread");
    window.history.replaceState(null, "", url.toString());
  };

  const loadSession = async (id: string) => {
    try {
      abortRef.current?.abort(); // ganti thread = hentikan stream yang jalan
      const { messages } = await getSession(id);
      setActiveId(id);
      setMessages(messages);
      setRuns([]);
      setError("");
      setView("workspace");
      setSidebarOpen(false);
      syncThreadUrl(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    setActiveId(undefined);
    setMessages([]);
    setRuns([]);
    setStreamMsg({ reasoning: "", content: "" });
    setError("");
    setView("workspace");
    setSidebarOpen(false);
    syncThreadUrl(undefined);
  };

  const navigate = (v: View) => {
    setView(v);
    setError("");
  };

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    if (id === activeId) newChat();
    refreshSessions();
  };

  const handleSend = async (
    text: string,
    opts: { agentMode: boolean; model: string; mode: string; attachments?: Attachment[] }
  ) => {
    setError("");
    setView("workspace");
    const attachments = opts.attachments || [];
    // Safety net: SuggestionCards mem-bypass Omnibox, jadi deteksi juga di sini.
    const useAgent = opts.agentMode || looksLikeTask(text);
    // Mode web/code memaksa agent mode; web dapat instruksi riset via terminal
    const goal =
      opts.mode === "web"
        ? `Gunakan web (curl via terminal) bila perlu informasi terkini. ${text}`
        : text || "Analisis gambar terlampir dan jelaskan isinya.";
    if (useAgent) {
      // Mode agen otonom: tampilkan panel, polling status
      try {
        // Pastikan selalu ada sesi — jawaban final butuh sessionId agar tersimpan
        let sid = activeId;
        if (!sid) {
          const r = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: text.slice(0, 60) || "Percakapan baru",
            }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "Gagal membuat sesi");
          sid = j.id;
          setActiveId(sid);
          refreshSessions();
        }
        syncThreadUrl(sid);
        const { runId } = await startAgentRun(goal, sid, opts.model, text);
        setRuns((r) => [...r, { runId, goal: text, createdAt: Date.now() }]);
        // Tampilkan pesan user langsung; jawaban final dimuat ulang saat run selesai
        setMessages((m) => [
          ...m,
          {
            id: `local-u-${Date.now()}`,
            sessionId: sid ?? "",
            role: "user",
            content: text,
            reasoningContent: "",
            attachmentsJson: JSON.stringify(attachments.map((a) => ({ id: a.id }))),
            createdAt: Date.now(),
          },
        ]);
        setStudioKey((k) => k + 1); // agen mungkin menulis artifact
        if (opts.mode === "code") setStudioOpen(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    // Mode chat streaming biasa
    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      sessionId: activeId ?? "",
      role: "user",
      content: text,
      reasoningContent: "",
      attachmentsJson: JSON.stringify(attachments.map((a) => ({ id: a.id }))),
      createdAt: Date.now(),
    };
    setMessages((m) => [...m, userMsg]);
    setStreaming(true);
    setStreamMsg({ reasoning: "", content: "" });
    setLatencyMs(undefined);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = Date.now();
    let acc = { reasoning: "", content: "" };
    let finalSessionId = activeId;
    let assistantId = `local-a-${Date.now()}`;

    try {
      await streamChatRequest(
        {
          sessionId: activeId,
          message: text,
          model: opts.model,
          attachments: attachments.map((a) => ({ id: a.id })),
        },
        (e) => {
          if (e.type === "session") {
            finalSessionId = e.sessionId;
            setActiveId(e.sessionId);
            syncThreadUrl(e.sessionId);
          } else if (e.type === "reasoning") {
            acc.reasoning += e.delta;
            setStreamMsg({ ...acc });
          } else if (e.type === "content") {
            acc.content += e.delta;
            setStreamMsg({ ...acc });
          } else if (e.type === "done") {
            assistantId = e.messageId || assistantId;
            setLatencyMs(e.latencyMs);
          } else if (e.type === "error") {
            throw new Error(`${e.error} (${e.code})`);
          }
        },
        ctrl.signal
      );
      // Selesai: pindahkan stream ke daftar pesan
      if (acc.content || acc.reasoning) {
        setMessages((m) => [
          ...m,
          {
            id: assistantId,
            sessionId: finalSessionId ?? "",
            role: "assistant",
            content: acc.content,
            reasoningContent: acc.reasoning,
            createdAt: Date.now(),
          },
        ]);
      }
      setStreamMsg({ reasoning: "", content: "" });
      refreshSessions();
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError(e instanceof Error ? e.message : String(e));
      }
      setStreamMsg({ reasoning: "", content: "" });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
  };

  const isEmpty = messages.length === 0 && runs.length === 0 && !streaming;
  const showHome = view === "workspace" && isEmpty;

  const omnibox = (
    <Omnibox
      onSend={handleSend}
      streaming={streaming}
      defaultModel={defaultModel}
      mode={mode}
      onModeChange={setMode}
      modelLabel={defaultModel}
    />
  );

  return (
    <div className="flex h-screen overflow-hidden bg-void">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={loadSession}
        onNew={newChat}
        onDelete={handleDelete}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        view={view}
        onNavigate={navigate}
        studioOpen={studioOpen}
        onToggleStudio={() => {
          setStudioOpen(!studioOpen);
          setStudioKey((k) => k + 1);
        }}
      />

      {/* Kolom tengah */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="flex items-center gap-2 px-4 py-3 border-b border-line-hair shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-ink-mute hover:text-ink hover:bg-obsidian-800"
            aria-label="Buka sidebar"
          >
            <Menu size={17} />
          </button>
          <span className="md:hidden font-semibold tracking-tight text-sm">
            XGOLDA
          </span>
          <div className="flex-1" />
          {/* Indikator ringkas pengganti panel telemetri */}
          <span className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-ink-faint">
            <span className="w-1.5 h-1.5 rounded-full bg-signal pip-live" />
            LIVE
            {typeof latencyMs === "number" && (
              <span className="text-ink-mute">· {latencyMs}ms</span>
            )}
          </span>
          <button
            onClick={() => setTermOpen((v) => !v)}
            title="Aktivitas terminal agen"
            className={`relative w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
              termOpen
                ? "text-signal bg-obsidian-850"
                : "text-ink-mute hover:text-ink hover:bg-obsidian-800"
            }`}
          >
            <Terminal size={15} />
            {termActive && !termOpen && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-signal pip-live" />
            )}
          </button>
          <span className="hidden md:block font-mono text-[10px] tracking-[0.15em] text-ink-faint">
            {view === "hub"
              ? "AGENT HUB & MCP"
              : view === "settings"
                ? "SETTINGS"
                : view === "config"
                  ? "UPDATE CONFIG"
                  : "AGENTIC WORKSPACE"}
          </span>
          <button
            onClick={() => {
              setStudioOpen(!studioOpen);
              setStudioKey((k) => k + 1);
            }}
            title="Artifact Studio"
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all ${
              studioOpen
                ? "border-signal text-signal bg-obsidian-850"
                : "border-line-hair text-ink-mute hover:border-line-soft hover:text-ink"
            }`}
          >
            <FileCode2 size={13} />
            <span className="hidden sm:inline">Studio</span>
          </button>
        </header>

        {/* Area konten */}
        {view === "hub" ? (
          <div className="flex-1 overflow-y-auto">
            <AgentHub />
          </div>
        ) : view === "settings" ? (
          <div className="flex-1 overflow-y-auto">
            <SettingsPage model={defaultModel} endpoint={endpoint} />
          </div>
        ) : view === "config" ? (
          <div className="flex-1 overflow-y-auto">
            <ConfigPage />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              {showHome ? (
                <div className="min-h-full flex flex-col items-center justify-center px-4 md:px-6 py-10">
                  <Hero />
                  <div className="w-full max-w-2xl mt-8">{omnibox}</div>
                  <div className="w-full max-w-2xl mt-8">
                    <SuggestionCards
                      onPick={(t) =>
                        handleSend(t, {
                          agentMode: false,
                          model: defaultModel,
                          mode,
                        })
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="mx-auto w-full max-w-[52rem] px-4 md:px-6 py-8">
                  <div className="w-full min-w-0">
                    <div className="space-y-6 pb-6">
                      {(() => {
                        // Timeline per-bubble: pesan & run agen diurut kronologis.
                        // Urutan tiap run: [user bubble] → [plan box] → [bubble jawaban].
                        // Pesan jawaban final (runId terisi) yang run-nya masih aktif
                        // tidak dirender di alur pesan — bubble-nya dirender panel
                        // tepat di bawah plan box-nya.
                        const activeRunIds = new Set(runs.map((r) => r.runId));
                        type TimelineItem =
                          | { kind: "message"; key: string; at: number; message: ChatMessage }
                          | { kind: "run"; key: string; at: number; run: ActiveRun };
                        const timeline: TimelineItem[] = [];
                        for (const m of messages) {
                          if (m.role === "assistant" && m.runId && activeRunIds.has(m.runId))
                            continue;
                          timeline.push({ kind: "message", key: m.id, at: m.createdAt, message: m });
                        }
                        for (const r of runs) {
                          timeline.push({ kind: "run", key: r.runId, at: r.createdAt, run: r });
                        }
                        timeline.sort((a, b) => a.at - b.at);
                        return timeline.map((item) =>
                          item.kind === "message" ? (
                            <MessageItem key={item.key} message={item.message} />
                          ) : (
                            <AgentPanel
                              key={item.key}
                              runId={item.run.runId}
                              onClose={() =>
                                setRuns((list) =>
                                  list.filter((x) => x.runId !== item.run.runId)
                                )
                              }
                              onDone={() => {
                                // Run selesai: muat ulang pesan sesi agar jawaban final
                                // tersimpan persisten (ditampilkan setelah reload)
                                const sid = activeId;
                                if (sid) {
                                  getSession(sid)
                                    .then(({ messages }) => setMessages(messages))
                                    .catch(() => {});
                                  refreshSessions();
                                }
                              }}
                            />
                          )
                        );
                      })()}

                      {streaming && (
                        <MessageItem
                          message={{
                            id: "streaming",
                            sessionId: "",
                            role: "assistant",
                            content: streamMsg.content,
                            reasoningContent: streamMsg.reasoning,
                            createdAt: Date.now(),
                          }}
                          streaming
                          latencyMs={latencyMs}
                        />
                      )}

                      {error && (
                        <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3">
                          <p className="font-mono text-xs text-red-400">{error}</p>
                        </div>
                      )}
                      <div ref={bottomRef} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Omnibox bawah (saat sudah ada isi) */}
            {!showHome && (
              <div className="shrink-0 border-t border-line-hair bg-void/95 backdrop-blur">
                <div className="mx-auto w-full max-w-[52rem] px-4 md:px-6 py-4">
                  {streaming ? (
                    <button
                      onClick={stopStreaming}
                      className="w-full flex items-center justify-center gap-2 rounded-2xl border border-line-soft bg-obsidian-950 py-3 text-sm text-ink-mute hover:text-ink hover:border-line-mid transition-colors"
                    >
                      <Square size={13} className="fill-current" />
                      Hentikan generasi
                    </button>
                  ) : (
                    omnibox
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Drawer terminal kontekstual (auto-tampil saat agen pakai terminal) */}
      <AgentTerminalPanel
        runIds={runs.map((r) => r.runId)}
        open={termOpen}
        onClose={() => setTermOpen(false)}
        onActivityChange={handleTermActivity}
      />

      {/* Artifact Studio kanan */}
      {studioOpen && (
        <ArtifactStudio onClose={() => setStudioOpen(false)} refreshKey={studioKey} sessionId={activeId} />
      )}
    </div>
  );
}
