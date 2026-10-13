"use client";

import { Brain, Code2, Cpu, Globe } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface ModePillsProps {
  mode: string;
  onChange: (m: string) => void;
  /** Nama model asli dari env (via /api/config) untuk pil pertama. */
  modelLabel?: string;
  /** Varian ramping untuk satu baris dengan kontrol lain. */
  compact?: boolean;
}

interface Mode {
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Pil mode omnibox: [nama model asli] / Think / Web / Code.
 * Pil aktif memakai border cyan + glow sesuai spec "Active / Accent".
 */
export default function ModePills({ mode, onChange, modelLabel, compact }: ModePillsProps) {
  const MODES: Mode[] = [
    { id: "standard", label: modelLabel || "Model", icon: Cpu },
    { id: "think", label: "Think", icon: Brain },
    { id: "web", label: "Web", icon: Globe },
    { id: "code", label: "Code", icon: Code2 },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Mode">
      {MODES.map((m) => {
        const active = mode === m.id;
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m.id)}
            className={`shrink-0 flex items-center gap-1 rounded-full font-medium border transition-all ${
              compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
            } ${
              active
                ? "bg-obsidian-850 border-signal/60 text-signal shadow-signal-glow"
                : "bg-transparent border-line-hair text-ink-mute hover:border-line-soft hover:text-ink"
            }`}
          >
            <Icon size={compact ? 11 : 13} className="shrink-0" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
