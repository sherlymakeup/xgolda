export interface ToolContext {
  runId?: string;
  sessionId?: string;
  /** Kedalaman delegasi (0 = run utama). */
  depth?: number;
  /** Model yang dipakai run ini (untuk subagent). */
  model?: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  exitCode?: number;
  durationMs?: number;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  /** Skema parameter sederhana untuk prompt (JSON Schema ringkas). */
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  handler: ToolHandler;
}

function arg(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export { arg, num };
