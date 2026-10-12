"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface ThoughtAccordionProps {
  steps: string[];
  durationMs?: number;
  defaultOpen?: boolean;
}

/**
 * Accordion reasoning "Thought Engine": header dengan pip cyan 4px
 * berdenyut + label mono, body monospace dengan numbered steps.
 */
export default function ThoughtAccordion({
  steps,
  durationMs,
  defaultOpen = false,
}: ThoughtAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const secs =
    durationMs !== undefined ? `${(durationMs / 1000).toFixed(1)}s` : null;

  return (
    <div className="rounded-xl border border-line-hair bg-obsidian-950 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-obsidian-900 transition-colors"
      >
        <span className="w-1 h-1 rounded-full bg-signal pip-live shrink-0" />
        <span className="font-mono text-[11px] tracking-[0.08em] text-signal flex-1 truncate">
          THOUGHT PROCESS{secs ? ` [${secs}]` : ""}
        </span>
        <ChevronDown
          size={14}
          className={`text-ink-faint shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="px-3.5 pb-3.5">
          <ol className="border-l border-line-soft ml-1 pl-4 space-y-2">
            {steps.map((step, i) => (
              <li
                key={i}
                className="font-mono text-[13px] leading-relaxed text-ink-mute"
              >
                <span className="text-signal/80 mr-2 tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {step}
              </li>
            ))}
            {steps.length === 0 && (
              <li className="font-mono text-[13px] text-ink-faint">
                (no reasoning steps)
              </li>
            )}
          </ol>
        </div>
      )}
    </div>
  );
}
