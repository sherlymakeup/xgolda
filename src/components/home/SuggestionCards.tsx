"use client";

import { FlaskConical, GitBranch, Lightbulb, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SuggestionCardsProps {
  onPick: (text: string) => void;
}

interface Suggestion {
  text: string;
  icon: LucideIcon;
}

const SUGGESTIONS: Suggestion[] = [
  {
    text: "Research the latest breakthroughs in agentic AI",
    icon: FlaskConical,
  },
  {
    text: "Analyze code repository & create autonomous test plan",
    icon: GitBranch,
  },
  {
    text: "Summarize market sentiment on AI semiconductors",
    icon: TrendingUp,
  },
  {
    text: "Brainstorm a production system design with low latency",
    icon: Lightbulb,
  },
];

/**
 * Grid kartu "Suggested Objectives" di home.
 * Klik kartu → panggil onPick dengan teks lengkap.
 */
export default function SuggestionCards({ onPick }: SuggestionCardsProps) {
  return (
    <div className="w-full">
      <p className="font-mono text-[10px] tracking-[0.12em] text-ink-faint mb-2.5">
        SUGGESTED OBJECTIVES
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {SUGGESTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.text}
              onClick={() => onPick(s.text)}
              className="group flex items-start gap-2.5 text-left rounded-xl border border-line-hair bg-obsidian-950 px-3.5 py-3 hover:border-line-mid hover:bg-obsidian-900 transition-all"
            >
              <Icon
                size={14}
                className="text-ink-faint group-hover:text-signal mt-0.5 shrink-0 transition-colors"
              />
              <span className="text-[13px] leading-snug text-ink-mute group-hover:text-ink transition-colors">
                {s.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
