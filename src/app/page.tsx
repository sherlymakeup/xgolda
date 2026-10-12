"use client";

import { FileCode2, Menu, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import AgentPanel from "@/components/AgentPanel";
import ArtifactStudio from "@/components/ArtifactStudio";
import MessageItem from "@/components/MessageItem";
import Omnibox from "@/components/Omnibox";
import Sidebar from "@/components/Sidebar";
import {
  deleteSession,
  getSession,
  listSessions,
  startAgentRun,
  streamChatRequest,
  type ChatMessage,
  type Session,
} from "@/lib/client-api";

const DEFAULT_MODEL = "deepseek-ai/DeepSeek-R1";

interface ActiveRun {
  runId: string;
  goal: string;
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
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions());
    } catch {
      /* abaikan */
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamMsg, runs]);

  const loadSession = async (id: string) => {
    try {
      const { messages } = await getSession(id);
      setActiveId(id);
      setMessages(messages);
      setRuns([]);
      setError("");
      setSidebarOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const newChat = () => {
    setActiveId(undefined);
    setMessages([]);
    setRuns([]);
    setStreamMsg({ reasoning: "", content: "" });
    setError("");
    setSidebarOpen(false);
  };

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    if (id === activeId) newChat();
    refreshSessions();
  };

  const handleSend = async (
    text: string,
    opts: { agentMode: boolean; model: string }
  ) => {
    setError("");
    if (opts.agentMode) {
      // Mode agen otonom: tampilkan panel, polling status
      try {
        const { runId } = await startAgentRun(text, activeId, opts.model);
        setRuns((r) => [...r, { runId, goal: text }]);
        setStudioKey((k) => k + 1); // agen mungkin menulis artifact
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
        { sessionId: activeId, message: text, model: opts.model },
        (e) => {
          if (e.type === "session") {
            finalSessionId = e.sessionId;
            setActiveId(e.sessionId);
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

        {/* Area chat */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[48rem] px-4 md:px-6 py-8">
            {isEmpty ? (
              <div className="min-h-[50vh] flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-ink text-void flex items-center justify-center font-bold text-2xl mb-5">
                  X
                </div>
                <h1 className="text-4xl md:text-5xl font-semibold tracking-[-0.03em] mb-3">
                  XGOLDA
                </h1>
                <p className="text-ink-mute text-[15px] max-w-md leading-relaxed mb-8">
                  Workspace AI lokal — penalaran transparan, agen otonom,
                  dan code studio. Semua berjalan di PC ini.
                </p>
                <div className="w-full max-w-2xl">
                  <Omnibox
                    onSend={handleSend}
                    streaming={streaming}
                    defaultModel={DEFAULT_MODEL}
                  />
                </div>
                <div className="flex flex-wrap justify-center gap-2 mt-6">
                  {[
                    "Jelaskan cara kerja Chain-of-Thought",
                    "Buatkan komponen React kartu profil neon",
                    "Query: berapa sesi tersimpan di database?",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() =>
                        handleSend(s, { agentMode: false, model: DEFAULT_MODEL })
                      }
                      className="text-xs text-ink-mute border border-line-hair rounded-full px-3.5 py-2 hover:border-line-soft hover:text-ink transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6 pb-6">
                {messages.map((m) => (
                  <MessageItem key={m.id} message={m} />
                ))}

                {runs.map((r) => (
                  <AgentPanel
                    key={r.runId}
                    runId={r.runId}
                    goal={r.goal}
                    onClose={() =>
                      setRuns((list) => list.filter((x) => x.runId !== r.runId))
                    }
                  />
                ))}

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
            )}
          </div>
        </div>

        {/* Omnibox bawah (saat sudah ada isi) */}
        {!isEmpty && (
          <div className="shrink-0 border-t border-line-hair bg-void/95 backdrop-blur">
            <div className="mx-auto w-full max-w-[48rem] px-4 md:px-6 py-4">
              {streaming ? (
                <button
                  onClick={stopStreaming}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl border border-line-soft bg-obsidian-950 py-3 text-sm text-ink-mute hover:text-ink hover:border-line-mid transition-colors"
                >
                  <Square size={13} className="fill-current" />
                  Hentikan generasi
                </button>
              ) : (
                <Omnibox
                  onSend={handleSend}
                  streaming={streaming}
                  defaultModel={DEFAULT_MODEL}
                />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Artifact Studio kanan */}
      {studioOpen && (
        <ArtifactStudio onClose={() => setStudioOpen(false)} refreshKey={studioKey} />
      )}
    </div>
  );
}
