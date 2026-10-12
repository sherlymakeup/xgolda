"use client";

import { Bot, Cpu, Info, RefreshCw, type LucideIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Defaults mirrored from src/lib/env.ts.                              */
/* The server reads .env.local at startup; these are the fallback      */
/* values shown here for reference.                                    */
/* ------------------------------------------------------------------ */
const DEFAULTS = {
  inferenceEndpoint: "http://localhost:20128/v1",
  defaultModel: "deepseek-ai/DeepSeek-R1",
  temperature: "0.7",
  agentMaxSteps: "12",
  executionTimeoutMs: "15,000",
  approvalTimeoutMs: "300,000",
  aiRetryAttempts: "3",
  aiRetryBaseMs: "1,000",
} as const;

interface SettingRow {
  label: string;
  envVar: string;
  value: string;
  hint?: string;
}

interface SettingSection {
  title: string;
  icon: LucideIcon;
  blurb: string;
  rows: SettingRow[];
}

const SECTIONS: SettingSection[] = [
  {
    title: "Neural Engine Gateway",
    icon: Cpu,
    blurb:
      "Local 9Router inference endpoint. The gateway token is never displayed here.",
    rows: [
      {
        label: "Inference Endpoint",
        envVar: "INTERNAL_INFERENCE_ENDPOINT",
        value: DEFAULTS.inferenceEndpoint,
        hint: "OpenAI-compatible base URL on this PC.",
      },
      {
        label: "Default Model",
        envVar: "DEFAULT_MODEL",
        value: DEFAULTS.defaultModel,
      },
      {
        label: "Temperature",
        envVar: "sessions.temperature",
        value: DEFAULTS.temperature,
        hint: "Per-session default for new chats.",
      },
    ],
  },
  {
    title: "Agent",
    icon: Bot,
    blurb: "Autonomous loop limits and safety gates.",
    rows: [
      {
        label: "Max Steps per Run",
        envVar: "AGENT_MAX_STEPS",
        value: DEFAULTS.agentMaxSteps,
        hint: "Hard cap on plan → execute → evaluate iterations.",
      },
      {
        label: "Execution Timeout",
        envVar: "EXECUTION_TIMEOUT_MS",
        value: `${DEFAULTS.executionTimeoutMs} ms`,
        hint: "terminal_exec is killed automatically past this limit.",
      },
      {
        label: "Approval Timeout",
        envVar: "APPROVAL_TIMEOUT_MS",
        value: `${DEFAULTS.approvalTimeoutMs} ms (5 min)`,
        hint: "Dangerous commands expire unapproved past this limit.",
      },
    ],
  },
  {
    title: "Retry & Resilience",
    icon: RefreshCw,
    blurb: "Gateway retry policy with exponential backoff and jitter.",
    rows: [
      {
        label: "Retry Attempts",
        envVar: "AI_RETRY_ATTEMPTS",
        value: DEFAULTS.aiRetryAttempts,
        hint: "Applies to 429 / 5xx / network errors only.",
      },
      {
        label: "Retry Base Delay",
        envVar: "AI_RETRY_BASE_MS",
        value: `${DEFAULTS.aiRetryBaseMs} ms`,
        hint: "Doubles per attempt, plus up to 250 ms jitter.",
      },
    ],
  },
];

function SettingRowView({ row }: { row: SettingRow }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 py-4 border-b border-line-hair last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-ink">{row.label}</p>
        <p className="font-mono text-[10px] text-ink-faint mt-1">{row.envVar}</p>
        {row.hint && (
          <p className="text-xs text-ink-faint mt-1">{row.hint}</p>
        )}
      </div>
      <code className="font-mono text-xs text-signal bg-obsidian-900 border border-line-hair rounded-lg px-3 py-2 whitespace-nowrap overflow-x-auto max-w-full shrink-0">
        {row.value}
      </code>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="w-full bg-void">
      <div className="mx-auto w-full max-w-4xl px-4 md:px-6 py-6 md:py-8">
        {/* Header */}
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-ink-faint flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-signal shadow-pip-glow" />
          XGOLDA
          <span className="text-line-mid">/</span>
          <span>Configuration</span>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          Settings
        </h1>

        {/* Env notice */}
        <div className="mt-5 rounded-2xl border border-line-hair bg-obsidian-950 px-4 py-3.5 flex items-start gap-3">
          <Info size={15} className="text-signal shrink-0 mt-0.5" />
          <p className="text-xs text-ink-mute leading-relaxed">
            Values below are read-only. They are configured in{" "}
            <code className="font-mono text-signal/90">.env.local</code> and
            loaded when the server starts — restart the server after any
            change. Secrets are never shown on this page.
          </p>
        </div>

        {/* Sections */}
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
                  {section.rows.map((row) => (
                    <SettingRowView key={row.envVar} row={row} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* Footer */}
        <p className="font-mono text-[10px] text-ink-faint mt-6 text-center">
          XGOLDA runs fully on localhost — configuration never leaves this PC.
        </p>
      </div>
    </div>
  );
}
