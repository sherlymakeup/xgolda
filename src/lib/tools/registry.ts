import { fsListTool, fsReadTool, fsWriteTool } from "./fs-operations.ts";
import { imageGenTool } from "./image-gen.ts";
import { delegateTaskTool } from "./delegate.ts";
import { rememberTool, recallTool } from "./memory.ts";
import { systemInfoTool } from "./system-info.ts";
import { skillReadTool } from "./skill-read.ts";
import { sqliteQueryTool } from "./sqlite-query.ts";
import { terminalExecTool } from "./terminal.ts";
import { ttsTool } from "./tts.ts";
import { webFetchTool } from "./web-fetch.ts";
import { webSearchTool } from "./web-search.ts";
import type { ToolDefinition, ToolHandler } from "./types.ts";

/** Semua tool yang tersedia untuk agen. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  sqliteQueryTool,
  fsWriteTool,
  fsReadTool,
  fsListTool,
  terminalExecTool,
  skillReadTool,
  webSearchTool,
  webFetchTool,
  imageGenTool,
  ttsTool,
  delegateTaskTool,
  rememberTool,
  recallTool,
  systemInfoTool,
];

export const TOOL_MAP: Record<string, ToolHandler> = Object.fromEntries(
  TOOL_DEFINITIONS.map((t) => [t.name, t.handler])
);

/** Manifest tool untuk disuntik ke system prompt agen (single source of truth). */
export function getToolManifest(): string {
  return TOOL_DEFINITIONS.map((t) => {
    const params = Object.entries(t.parameters)
      .map(
        ([name, p]) =>
          `    - ${name} (${p.type}${p.required ? ", wajib" : ""}): ${p.description}`
      )
      .join("\n");
    return `- ${t.name}: ${t.description}\n${params}`;
  }).join("\n");
}

export function hasTool(name: string): boolean {
  return name in TOOL_MAP;
}
