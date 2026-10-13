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
import type { OpenAITool, ToolDefinition, ToolHandler } from "./types.ts";

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

/** Konversi definisi tool ke format OpenAI function calling (native). */
export function toOpenAITools(): OpenAITool[] {
  return TOOL_DEFINITIONS.map((t) => {
    const properties: Record<string, { type: string; description: string }> =
      {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(t.parameters)) {
      properties[k] = { type: v.type, description: v.description };
      if (v.required) required.push(k);
    }
    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: { type: "object" as const, properties, required },
      },
    };
  });
}

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
