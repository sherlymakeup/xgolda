"use client";

import { Activity } from "lucide-react";

export interface TelemetryStats {
  latencyMs: number;
  reqPerSec: number;
  misses: number;
  testsPassed: number;
  testsTotal: number;
  tokensUsed: string;
  pipeline: string;
}

interface TelemetryPanelProps {
  stats?: Partial<TelemetryStats>;
}

const DEFAULT_STATS: TelemetryStats = {
  latencyMs: 18,
  reqPerSec: 5410,
  misses: 0,
  testsPassed: 24,
  testsTotal: 24,
  tokensUsed: "1.4K",
  pipeline: "Redis Pipeline (10ms)",
};

const TEST_ROWS = [
  { name: "test_concurrent_payment_lock", time: "0.04s" },
  { name: "test_cache_stampede_thundering_herd", time: "0.11s" },
  { name: "test_vector_search_recall", time: "0.08s" },
  { name: "test_agent_plan_tree_depth", time: "0.06s" },
];

/** Kurva densitas probabilitas latency — path SVG halus dari titik-titik. */
function buildWavePath(width: number, height: number): string {
  const pts: Array<[number, number]> = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // campuran dua puncak gaussian → bentuk organik ala grafik latency
    const g1 = Math.exp(-Math.pow((t - 0.32) * 6.5, 2)) * 0.75;
    const g2 = Math.exp(-Math.pow((t - 0.68) * 9.0, 2)) * 1.0;
    const wobble = Math.sin(t * 22) * 0.02;
    const v = Math.min(1, g1 + g2 + wobble + 0.03);
    pts.push([t * width, height - v * (height - 6) - 3]);
  }
  // smooth via quadratic midpoints
  let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const xc = ((pts[i][0] + pts[i + 1][0]) / 2).toFixed(1);
    const yc = ((pts[i][1] + pts[i + 1][1]) / 2).toFixed(1);
    d += ` Q ${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)} ${xc},${yc}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0].toFixed(1)},${last[1].toFixed(1)}`;
  return d;
}

const WAVE = buildWavePath(260, 96);

/**
 * Panel telemetri kanan (lebar ~300px): stat latency, waveform SVG,
 * daftar test, dan token stats. Data default mock yang masuk akal.
 */
export default function TelemetryPanel({ stats }: TelemetryPanelProps) {
  const s: TelemetryStats = { ...DEFAULT_STATS, ...stats };

  return (
    <aside className="w-[300px] shrink-0 rounded-2xl border border-line-hair bg-obsidian-950 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line-hair">
        <span className="w-1.5 h-1.5 rounded-full bg-signal pip-live shrink-0" />
        <p className="font-mono text-[10px] tracking-[0.12em] text-signal flex-1">
          SESSION TELEMETRY
        </p>
        <span className="font-mono text-[10px] tracking-widest text-emerald-400 border border-emerald-400/30 bg-emerald-400/10 rounded-full px-2 py-0.5">
          LIVE
        </span>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto">
        {/* Stat besar */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-line-hair bg-obsidian-900 px-2.5 py-2.5">
            <p className="font-mono text-[9px] tracking-widest text-ink-faint mb-1">
              LATENCY
            </p>
            <p className="text-xl font-semibold text-ink tabular-nums">
              {s.latencyMs}
              <span className="text-[11px] font-normal text-ink-faint ml-0.5">ms</span>
            </p>
          </div>
          <div className="rounded-xl border border-line-hair bg-obsidian-900 px-2.5 py-2.5">
            <p className="font-mono text-[9px] tracking-widest text-ink-faint mb-1">
              REQ/S
            </p>
            <p className="text-xl font-semibold text-ink tabular-nums">
              {s.reqPerSec.toLocaleString("en-US")}
            </p>
          </div>
          <div className="rounded-xl border border-line-hair bg-obsidian-900 px-2.5 py-2.5">
            <p className="font-mono text-[9px] tracking-widest text-ink-faint mb-1">
              MISSES
            </p>
            <p className="text-xl font-semibold text-ink tabular-nums">{s.misses}</p>
          </div>
        </div>

        {/* Waveform */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Activity size={12} className="text-signal shrink-0" />
            <p className="font-mono text-[10px] tracking-[0.08em] text-ink-mute">
              LATENCY PROBABILITY DENSITY & WAVEFORM
            </p>
          </div>
          <div className="rounded-xl border border-line-hair bg-void p-2 overflow-hidden">
            <svg
              viewBox="0 0 260 96"
              className="w-full h-24 block"
              role="img"
              aria-label="Latency waveform"
            >
              <defs>
                <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#00f0ff" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* grid */}
              {[0.25, 0.5, 0.75].map((t) => (
                <line
                  key={t}
                  x1="0"
                  y1={96 * t}
                  x2="260"
                  y2={96 * t}
                  stroke="#1e1e24"
                  strokeWidth="1"
                />
              ))}
              {[0.2, 0.4, 0.6, 0.8].map((t) => (
                <line
                  key={t}
                  x1={260 * t}
                  y1="0"
                  x2={260 * t}
                  y2="96"
                  stroke="#1e1e24"
                  strokeWidth="1"
                  strokeOpacity="0.5"
                />
              ))}
              <path d={`${WAVE} L 260,96 L 0,96 Z`} fill="url(#waveFill)" />
              <path
                d={WAVE}
                fill="none"
                stroke="#00f0ff"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <p className="font-mono text-[10px] text-signal/90 mt-1.5 px-1">
              {s.pipeline}
            </p>
          </div>
        </div>

        {/* Tests */}
        <div>
          <p className="font-mono text-[10px] tracking-[0.08em] text-ink-mute mb-2">
            {s.testsPassed} / {s.testsTotal} TESTS PASSED
          </p>
          <div className="rounded-xl border border-line-hair bg-obsidian-900 px-3 py-2 space-y-1.5">
            {TEST_ROWS.map((t) => (
              <div
                key={t.name}
                className="flex items-baseline gap-1.5 font-mono text-[10px]"
              >
                <span className="text-ink-faint truncate">{t.name}</span>
                <span className="flex-1 border-b border-dotted border-line-soft -translate-y-0.5" />
                <span className="text-emerald-400 shrink-0">
                  PASSED [{t.time}]
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Token stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-line-hair bg-obsidian-900 px-3 py-2.5">
            <p className="font-mono text-[9px] tracking-widest text-ink-faint mb-1">
              TOKENS
            </p>
            <p className="text-base font-semibold text-ink tabular-nums">
              {s.tokensUsed}
            </p>
          </div>
          <div className="rounded-xl border border-line-hair bg-obsidian-900 px-3 py-2.5">
            <p className="font-mono text-[9px] tracking-widest text-ink-faint mb-1">
              CACHE MISS
            </p>
            <p className="text-base font-semibold text-ink tabular-nums">
              {s.misses}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
