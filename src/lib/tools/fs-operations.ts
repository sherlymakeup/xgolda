import fs from "node:fs";
import path from "node:path";
import {
  ARTIFACTS_DIR,
  assertSafePath,
  ensureArtifactsDir,
} from "../security/path-jail.ts";
import {
  assertWorkspaceDirPath,
  assertWorkspacePath,
  getSessionWorkspace,
} from "../agent/workspace.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";
import { arg } from "./types.ts";

/**
 * Tentukan base dir tool file:
 * - Bila ada ctx.workspaceDir (subagen: subfolder .delegates) → pakai itu.
 * - Bila ada ctx.sessionId → folder workspace sesi itu (di-jail).
 * - Fallback (tanpa sesi) → ./storage/artifacts/ seperti dulu.
 */
async function resolveBase(ctx: ToolContext): Promise<{
  dir: string;
  jail: (filename: string) => Promise<string>;
  label: string;
}> {
  if (ctx.workspaceDir) {
    const dir = ctx.workspaceDir;
    return {
      dir,
      jail: (f) => assertWorkspaceDirPath(dir, f),
      label: "workspace subagen",
    };
  }
  if (ctx.sessionId) {
    const sid = ctx.sessionId;
    const dir = await getSessionWorkspace(sid);
    return {
      dir,
      jail: (f) => assertWorkspacePath(sid, f),
      label: "workspace sesi",
    };
  }
  ensureArtifactsDir();
  return { dir: ARTIFACTS_DIR, jail: async (f) => assertSafePath(f), label: "artifacts" };
}

async function fsWrite(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const filename = arg(args.filename);
  const content = arg(args.content);
  if (!filename) return { ok: false, output: "ERROR: 'filename' wajib diisi" };
  try {
    const { jail, label } = await resolveBase(ctx);
    const target = await jail(filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    // Verifikasi deterministik: baca balik ukuran file
    const st = fs.statSync(target);
    return {
      ok: true,
      output:
        `OK: tertulis ${content.length} karakter ke ${target} ` +
        `(terverifikasi ada, ${st.size} byte)`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: `ERROR: ${msg}` };
  }
}

async function fsRead(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const filename = arg(args.filename);
  if (!filename) return { ok: false, output: "ERROR: 'filename' wajib diisi" };
  try {
    const { jail } = await resolveBase(ctx);
    const target = await jail(filename);
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

async function fsList(ctx: ToolContext): Promise<ToolResult> {
  try {
    const { dir, label } = await resolveBase(ctx);
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .map((d) => {
        const full = path.join(dir, d.name);
        let size = 0;
        try {
          size = d.isFile() ? fs.statSync(full).size : 0;
        } catch {
          /* abaikan */
        }
        return { name: d.name + (d.isDirectory() ? "/" : ""), size };
      });
    return {
      ok: true,
      output: `Folder ${label} (${dir}):\n` + JSON.stringify(entries, null, 2),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: `ERROR: ${msg}` };
  }
}

export const fsWriteTool: ToolDefinition = {
  name: "fs_write_artifact",
  description:
    "Tulis file teks ke folder kerja sesi ini (boleh pakai subdir, mis. 'laporan/hasil.md'). Di-jail: tidak bisa keluar dari folder sesi.",
  parameters: {
    filename: { type: "string", description: "Nama file relatif, mis. app.tsx", required: true },
    content: { type: "string", description: "Isi file", required: true },
  },
  handler: async (args, ctx) => fsWrite(args, ctx),
};

export const fsReadTool: ToolDefinition = {
  name: "fs_read_artifact",
  description: "Baca file teks dari folder kerja sesi ini (maks 20.000 karakter).",
  parameters: {
    filename: { type: "string", description: "Nama file relatif", required: true },
  },
  handler: async (args, ctx) => fsRead(args, ctx),
};

export const fsListTool: ToolDefinition = {
  name: "fs_list_artifacts",
  description: "Daftar file & folder di folder kerja sesi ini.",
  parameters: {},
  handler: async (_args, ctx) => fsList(ctx),
};
