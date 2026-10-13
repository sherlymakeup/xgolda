import {
  collectEnvProfile,
  formatEnvBlock,
} from "../agent/environment.ts";
import type { ToolDefinition, ToolResult } from "./types.ts";

/**
 * system_info — info spek PC & runtime/SDK yang terinstall.
 * Probe fresh (tanpa cache) agar akurat setelah install sesuatu.
 */
async function systemInfo(): Promise<ToolResult> {
  try {
    const profile = await collectEnvProfile();
    return { ok: true, output: formatEnvBlock(profile) };
  } catch (e) {
    return {
      ok: false,
      output: `ERROR: gagal membaca info sistem: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export const systemInfoTool: ToolDefinition = {
  name: "system_info",
  description:
    "Dapatkan info spek PC (OS, CPU, RAM, disk) & daftar runtime/SDK yang terinstall (node, python, git, docker, java, dotnet, go, rust). " +
    "Gunakan untuk cek ulang environment — mis. setelah menginstall sesuatu, atau sebelum memilih toolchain.",
  parameters: {},
  handler: async () => systemInfo(),
};
