import fs from "node:fs";
import {
  ARTIFACTS_DIR,
  assertSafePath,
  ensureArtifactsDir,
} from "../security/path-jail.ts";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { arg } from "./types.ts";

async function fsWrite(args: Record<string, unknown>): Promise<ToolResult> {
  const filename = arg(args.filename);
  const content = arg(args.content);
  if (!filename) return { ok: false, output: "ERROR: 'filename' wajib diisi" };
  try {
    ensureArtifactsDir();
    const target = assertSafePath(filename);
    fs.writeFileSync(target, content, "utf8");
    return {
      ok: true,
      output: `OK: tertulis ${content.length} karakter ke ${filename}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: `ERROR: ${msg}` };
  }
}

async function fsRead(args: Record<string, unknown>): Promise<ToolResult> {
  const filename = arg(args.filename);
  if (!filename) return { ok: false, output: "ERROR: 'filename' wajib diisi" };
  try {
    const target = assertSafePath(filename);
    if (!fs.existsSync(target)) {
      return { ok: false, output: `ERROR: file '${filename}' tidak ditemukan` };
    }
    const content = fs.readFileSync(target, "utf8");
    const max = 20000;
    const truncated = content.length > max;
    return {
      ok: true,
      output: truncated
        ? content.slice(0, max) + `\n...[dipotong, total ${content.length} karakter]`
        : content,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: `ERROR: ${msg}` };
  }
}

async function fsList(): Promise<ToolResult> {
  try {
    ensureArtifactsDir();
    const files = fs
      .readdirSync(ARTIFACTS_DIR, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => {
        const st = fs.statSync(`${ARTIFACTS_DIR}/${d.name}`);
        return { name: d.name, size: st.size };
      });
    return { ok: true, output: JSON.stringify(files, null, 2) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: `ERROR: ${msg}` };
  }
}

export const fsWriteTool: ToolDefinition = {
  name: "fs_write_artifact",
  description:
    "Tulis file teks ke ./storage/artifacts/ (di-jail, anti path traversal).",
  parameters: {
    filename: { type: "string", description: "Nama file, mis. app.tsx", required: true },
    content: { type: "string", description: "Isi file", required: true },
  },
  handler: async (args) => fsWrite(args),
};

export const fsReadTool: ToolDefinition = {
  name: "fs_read_artifact",
  description: "Baca file teks dari ./storage/artifacts/ (maks 20.000 karakter).",
  parameters: {
    filename: { type: "string", description: "Nama file", required: true },
  },
  handler: async (args) => fsRead(args),
};

export const fsListTool: ToolDefinition = {
  name: "fs_list_artifacts",
  description: "Daftar semua file di ./storage/artifacts/.",
  parameters: {},
  handler: async () => fsList(),
};
