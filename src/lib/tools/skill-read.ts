import { readSkill } from "../skills/loader.ts";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { arg } from "./types.ts";

async function readSkillTool(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = arg(args.name).trim().toLowerCase();
  if (!name) return { ok: false, output: "ERROR: 'name' wajib diisi" };
  try {
    const skill = readSkill(name);
    return {
      ok: true,
      output: `# SKILL: ${skill.name}\n${skill.description}\n\n${skill.body}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: `ERROR: ${msg}` };
  }
}

export const skillReadTool: ToolDefinition = {
  name: "read_skill",
  description:
    "Baca panduan skill (SKILL.md) berdasarkan nama. Wajib dibaca SEBELUM memakai pola kerja yang diatur skill tersebut.",
  parameters: {
    name: {
      type: "string",
      description: "Nama skill, mis. 'artifact-guidelines'",
      required: true,
    },
  },
  handler: async (args) => readSkillTool(args),
};
