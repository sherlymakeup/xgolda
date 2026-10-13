"use client";

import {
  Activity,
  BookOpen,
  Database,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Mic,
  Newspaper,
  Plug,
  ShieldCheck,
  Terminal,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

/* ------------------------------------------------------------------ */
/* Data — mirrors the real agent tool registry (src/lib/tools/registry) */
/* ------------------------------------------------------------------ */

type Category = "Database" | "Filesystem" | "Execution" | "Knowledge" | "Gateway";

interface ToolCard {
  name: string; // exact tool name from the registry
  title: string;
  description: string;
  icon: LucideIcon;
  category: Category;
}

const TOOLS: ToolCard[] = [
  {
    name: "sqlite_query",
    title: "SQLite Query",
    description:
      "Run read-only SQL (SELECT / WITH / EXPLAIN) against the local XGOLDA database. Write statements are blocked.",
    icon: Database,
    category: "Database",
  },
  {
    name: "terminal_exec",
    title: "Terminal Sandbox",
    description:
      "Full shell access (PowerShell / bash) with timeout and auto-kill. Dangerous commands pause for your approval first.",
    icon: Terminal,
    category: "Execution",
  },
  {
    name: "fs_write_artifact",
    title: "Write Artifact",
    description:
      "Write text files into ./storage/artifacts/. Paths are jailed — no traversal outside the sandbox.",
    icon: FilePlus2,
    category: "Filesystem",
  },
  {
    name: "fs_read_artifact",
    title: "Read Artifact",
    description:
      "Read text files from ./storage/artifacts/ (20,000 character cap per read).",
    icon: FileText,
    category: "Filesystem",
  },
  {
    name: "fs_list_artifacts",
    title: "List Artifacts",
    description: "List every file currently stored in ./storage/artifacts/.",
    icon: FolderOpen,
    category: "Filesystem",
  },
  {
    name: "read_skill",
    title: "Skill Reader",
    description:
      "Load a SKILL.md playbook. The agent must read the relevant skill before using its workflow pattern.",
    icon: BookOpen,
    category: "Knowledge",
  },
  {
    name: "web_search",
    title: "Web Search",
    description:
      "Search the live internet (Tavily/Exa via 9Router). Use for news, research, current events, and any data beyond the model's knowledge.",
    icon: Newspaper,
    category: "Gateway",
  },
  {
    name: "web_fetch",
    title: "Web Fetch",
    description:
      "Read the full content of a URL as markdown (Firecrawl/Jina via 9Router). Usually follows web_search to read a result in depth.",
    icon: Globe,
    category: "Gateway",
  },
  {
    name: "generate_image",
    title: "Image Generation",
    description:
      "Generate images from a text prompt (Gemini/FLUX via 9Router). Saved as PNG artifacts, previewable in the Studio.",
    icon: Image,
    category: "Gateway",
  },
  {
    name: "text_to_speech",
    title: "Text to Speech",
    description:
      "Convert text to spoken audio (Minimax/ElevenLabs via 9Router). Saved as MP3 artifacts — voiceovers and narration.",
    icon: Mic,
    category: "Gateway",
  },
];

const CATEGORIES: ("All" | Category)[] = [
  "All",
  "Database",
  "Filesystem",
  "Execution",
  "Knowledge",
  "Gateway",
];

/* Mock telemetry — clearly illustrative, not live measurements. */
const STATS: {
  label: string;
  value: string;
  sub: string;
  subClass: string;
  barClass: string;
  barWidth: string;
  icon: LucideIcon;
}[] = [
  {
    label: "Tools Online",
    value: "10 / 10",
    sub: "100% Ready",
    subClass: "text-signal",
    barClass: "bg-signal",
    barWidth: "w-full",
    icon: Zap,
  },
  {
    label: "Vector Store",
    value: "12,480",
    sub: "Vectors indexed",
    subClass: "text-ink-faint",
    barClass: "bg-signal/60",
    barWidth: "w-[68%]",
    icon: Database,
  },
  {
    label: "Tool Throughput",
    value: "1,284",
    sub: "calls logged · avg 1.2s",
    subClass: "text-ink-faint",
    barClass: "bg-signal/40",
    barWidth: "w-[45%]",
    icon: Activity,
  },
  {
    label: "Approval Gate",
    value: "Armed",
    sub: "Zero bypass",
    subClass: "text-signal",
    barClass: "bg-signal/80",
    barWidth: "w-[94%]",
    icon: ShieldCheck,
  },
];

/* ------------------------------------------------------------------ */
/* Small building blocks                                                */
/* ------------------------------------------------------------------ */

function Toggle({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        enabled
          ? "bg-signal/20 border-signal/60"
          : "bg-obsidian-800 border-line-soft"
      }`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full transition-all ${
          enabled
            ? "left-[18px] bg-signal shadow-pip-glow"
            : "left-[3px] bg-ink-faint"
        }`}
      />
    </button>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-ink-faint mb-3">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function AgentHub() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(TOOLS.map((t) => [t.name, true]))
  );
  const [filter, setFilter] = useState<(typeof CATEGORIES)[number]>("All");

  const visible =
    filter === "All" ? TOOLS : TOOLS.filter((t) => t.category === filter);
  const connectedCount = TOOLS.filter((t) => enabled[t.name]).length;

  return (
    <div className="w-full bg-void">
      <div className="mx-auto w-full max-w-6xl px-4 md:px-6 py-6 md:py-8">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-ink-faint flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-signal shadow-pip-glow" />
            XGOLDA Mesh v1.0
            <span className="text-line-mid">/</span>
            <span>Localhost</span>
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              Agent Hub &amp; MCP
            </h1>
            <span className="font-mono text-[11px] px-3 py-1 rounded-full border border-signal/40 text-signal bg-signal/5">
              {connectedCount} Connected / {TOOLS.length} Total
            </span>
          </div>
        </div>

        {/* Stat ribbon */}
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-line-hair bg-obsidian-950 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-faint">
                  {s.label}
                </p>
                <s.icon size={14} className="text-ink-faint" />
              </div>
              <p className="mt-2 text-2xl font-semibold text-ink">{s.value}</p>
              <p className={`font-mono text-[11px] mt-0.5 ${s.subClass}`}>
                {s.sub}
              </p>
              <div className="mt-2.5 h-1 rounded-full bg-obsidian-700 overflow-hidden">
                <div className={`h-full rounded-full ${s.barClass} ${s.barWidth}`} />
              </div>
            </div>
          ))}
        </div>

        {/* Filter chips */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          {CATEGORIES.map((c) => {
            const count =
              c === "All"
                ? TOOLS.length
                : TOOLS.filter((t) => t.category === c).length;
            const active = filter === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={`px-3.5 py-1.5 rounded-full font-mono text-[11px] transition-colors border ${
                  active
                    ? "bg-obsidian-700 border-signal/50 text-signal"
                    : "bg-obsidian-950 border-line-hair text-ink-faint hover:text-ink hover:border-line-soft"
                }`}
              >
                {c} ({count})
              </button>
            );
          })}
        </div>

        {/* Tool cards */}
        <div className="mt-6">
          <SectionLabel>Tool Registry</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {visible.map((t) => {
              const on = enabled[t.name];
              const Icon = t.icon;
              return (
                <div
                  key={t.name}
                  className="rounded-2xl border border-line-hair bg-obsidian-950 p-5 hover:border-line-soft transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-10 h-10 rounded-xl bg-obsidian-800 border border-line-soft flex items-center justify-center shrink-0">
                      <Icon size={18} className="text-signal" />
                    </div>
                    <Toggle
                      enabled={on}
                      onToggle={() =>
                        setEnabled((prev) => ({ ...prev, [t.name]: !prev[t.name] }))
                      }
                      label={`Toggle ${t.title}`}
                    />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-ink">
                    {t.title}
                  </h3>
                  <p className="font-mono text-[11px] text-signal/80 mt-1">
                    {t.name}
                  </p>
                  <p className="mt-2 text-sm text-ink-mute leading-relaxed">
                    {t.description}
                  </p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ink-faint">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          on ? "bg-signal shadow-pip-glow" : "bg-ink-faint"
                        }`}
                      />
                      {on ? "Connected" : "Disabled"}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                      {t.category}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Universal MCP Gateway */}
        <div className="mt-10">
          <SectionLabel>Universal MCP Gateway</SectionLabel>
          <div className="rounded-2xl border border-line-hair bg-obsidian-950 p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-5">
            <div className="w-11 h-11 rounded-xl bg-obsidian-800 border border-line-soft flex items-center justify-center shrink-0">
              <Plug size={20} className="text-signal" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-ink">
                Universal MCP Gateway
              </h3>
              <p className="mt-1.5 text-sm text-ink-mute leading-relaxed">
                Multiplex external Model Context Protocol servers into the
                agent tool manifest. Registered servers appear here as native
                tools.
              </p>
              <p className="font-mono text-[10px] text-ink-faint mt-2">
                No external MCP servers registered.
              </p>
            </div>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="shrink-0 px-5 py-2.5 rounded-full bg-obsidian-700 border border-line-soft text-ink-faint font-mono text-xs cursor-not-allowed opacity-60"
            >
              Register MCP Tools
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
