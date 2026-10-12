"use client";

/**
 * Hero ala Grok — logo X besar di tengah, heading, dan subtext engine.
 * Dipakai di halaman home saat belum ada percakapan.
 */
export default function Hero() {
  return (
    <div className="flex flex-col items-center text-center rise-in">
      {/* Logo X */}
      <div className="w-14 h-14 rounded-2xl bg-obsidian-700 border border-line-soft flex items-center justify-center mb-5 shadow-signal-glow">
        <span className="text-ink font-bold text-2xl tracking-tight select-none">
          X
        </span>
      </div>

      <h1 className="text-3xl md:text-4xl font-medium tracking-tight text-ink">
        What do you want to know?
      </h1>

      <p className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 text-sm text-ink-mute">
        Powered by
        <span className="font-mono text-[11px] tracking-[0.04em] font-medium px-2.5 py-1 rounded-full bg-obsidian-850 border border-line-hair text-signal">
          XGOLDA Neural Engine (Reasoning)
        </span>
      </p>
    </div>
  );
}
