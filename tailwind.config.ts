import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Obsidian Intelligence — true black OLED
        void: "#000000",
        obsidian: {
          950: "#0a0a0a",
          900: "#0e0e0e",
          850: "#121214",
          800: "#1b1b1b",
          700: "#1f1f1f",
          600: "#2a2a2a",
          500: "#353535",
        },
        ink: {
          DEFAULT: "#f4f4f5",
          dim: "#e2e2e2",
          mute: "#a1a1aa",
          faint: "#71717a",
        },
        line: {
          hair: "#1e1e24",
          soft: "#27272a",
          mid: "#3f3f46",
        },
        signal: "#00f0ff", // cyan — reasoning telemetry & active states
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        "signal-glow": "0 0 24px -4px rgba(0, 240, 255, 0.08)",
        "pip-glow": "0 0 12px rgba(0, 240, 255, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
