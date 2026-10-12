"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface Props {
  reasoning: string;
  streaming: boolean;
  latencyMs?: number;
}

/** Accordion "Thought Engine" — collapsible Chain-of-Thought. */
export default function ThoughtEngine({ reasoning, streaming, latencyMs }: Props) {
  const [open, setOpen] = useState(false);
  if (!reasoning && !streaming) return null;

  const secs =
    latencyMs !== undefined ? (latencyMs / 1000).toFixed(1) : null;

  return (
    <div className="rounded-xl border border-line-hair bg-obsidian-950 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-obsidian-900 transition-colors"
      >
        <span
          className={`w-1 h-1 rounded-full bg-signal shrink-0 ${
            streaming ? "pip-live" : ""
          }`}
        />
        <span className="font-mono text-[11px] tracking-[0.08em] text-ink-mute">
          THOUGHT PROCESS{secs ? ` [${secs}s]` : streaming ? " …" : ""}
        </span>
        <span className="flex-1" />
        <ChevronDown
          size={14}
          className={`text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5">
          <div className="border-l border-line-soft pl-3.5">
            <pre className="font-mono text-[13px] leading-relaxed text-ink-mute whitespace-pre-wrap break-words">
              {reasoning}
              {streaming && <span className="text-signal">▍</span>}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
