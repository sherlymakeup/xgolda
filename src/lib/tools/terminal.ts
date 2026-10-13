import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ARTIFACTS_DIR, ensureArtifactsDir } from "../security/path-jail.ts";
import { getSessionWorkspace, isInside } from "../agent/workspace.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";
import { arg, num } from "./types.ts";
import { getConfig } from "../config.ts";
import { classifyCommand } from "./terminal-guard.ts";
import { requestApproval } from "../agent/approval.ts";

const MAX_OUTPUT = 20000;

/**
 * terminal_exec — akses shell penuh untuk agen (pengganti sandbox_run).
 *
 * THREAT MODEL (keputusan user 2026-10-13, diperketat 2026-10-13):
 * terminal laptop = sandbox perintah, TAPI working directory di-jail ke
 * folder workspace sesi (<AGENT_WORKSPACE_ROOT>/<sessionId>/).
 * Agen boleh menjalankan perintah apa pun sebagai user, namun TIDAK bisa
 * keluar dari folder sesinya (cwd absolute ke luar ditolak).
 *
 * Yang tetap dijaga:
 * - timeout + kill paksa (Windows: taskkill /T agar child ikut mati)
 * - output dibatasi 20KB
 * - env disaring (API token dkk. tidak diwariskan → tidak bocor ke log)
 * - setiap perintah tercatat di tool_executions & terlihat di AgentPanel
 */

export function defaultShell(): { command: string; args: string[] } {
  if (process.platform === "win32") {
    // PowerShell bawaan Windows 11; -NoProfile agar cepat & deterministik
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command"],
    };
  }
  return { command: "bash", args: ["-lc"] };
}

/** Env yang diwariskan — secret disaring agar tak bocor ke log tool. */
function scrubbedEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/key|token|secret|password|auth/i.test(k)) continue;
    out[k] = v;
  }
  if (process.env.PATH) out.PATH = process.env.PATH;
  if (process.env.SystemRoot) out.SystemRoot = process.env.SystemRoot; // Windows
  return out;
}

function killTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === "win32") {
    // taskkill /T = bunuh juga seluruh child process
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
      });
      killer.on("error", () => {
        try {
          child.kill("SIGKILL");
        } catch { /* abaikan */ }
      });
      return;
    } catch { /* fallback di bawah */ }
  }
  try {
    child.kill("SIGKILL");
  } catch { /* abaikan */ }
}

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const sh = defaultShell();
    const child = spawn(sh.command, [...sh.args, command], {
      shell: false, // satu level shell saja (powershell/bash), tanpa shell-in-shell
      cwd,
      env: scrubbedEnv() as NodeJS.ProcessEnv,
      timeout: timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const done = (v: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // beri waktu kill bekerja, lalu paksa selesai
      setTimeout(
        () =>
          done({ stdout, stderr, exitCode: null, timedOut: true }),
        2000
      );
    }, timeoutMs);
    // Timer Node tidak boleh menahan proses induk tetap hidup
    (timer as unknown as { unref?: () => void }).unref?.();

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8").slice(0, MAX_OUTPUT - stdout.length);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8").slice(0, MAX_OUTPUT - stderr.length);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      done({
        stdout,
        stderr: stderr + `\nSPAWN_ERROR: ${err.message}`,
        exitCode: null,
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!timedOut && Date.now() - started >= timeoutMs) timedOut = true;
      done({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}

async function terminalExec(
  args: Record<string, unknown>,
  ctx: ToolContext = {}
): Promise<ToolResult> {
  const command = arg(args.command).trim();
  if (!command) return { ok: false, output: "ERROR: 'command' wajib diisi" };

  // APPROVAL GATE: perintah berbahaya butuh persetujuan user dulu
  const classification = classifyCommand(command);
  if (classification.dangerous) {
    const decision = await requestApproval({
      runId: ctx.runId,
      sessionId: ctx.sessionId,
      toolName: "terminal_exec",
      command,
      args: { command, cwd: arg(args.cwd, ""), timeoutMs: num(args.timeoutMs, 0) },
      reason: classification.reason ?? "perintah berbahaya",
    });
    if (decision !== "approved") {
      const why =
        decision === "expired"
          ? "tidak ada keputusan dalam batas waktu"
          : decision === "rejected" && !ctx.runId
            ? "tidak ada konteks run untuk meminta persetujuan"
            : "user menolak";
      return {
        ok: false,
        output:
          `DITOLAK (${decision}): perintah berbahaya tidak dijalankan — ${why}.\n` +
          `Perintah: ${command.slice(0, 300)}\n` +
          `Alasan flag: ${classification.reason}\n` +
          `Jelaskan ke user kenapa perintah ini perlu, atau tawarkan alternatif yang lebih aman.`,
      };
    }
  }

  const cfg = await getConfig();
  const execTimeout = num(cfg.values.EXECUTION_TIMEOUT_MS, 15000);
  const timeoutMs = Math.min(
    Math.max(num(args.timeoutMs, execTimeout), 1000),
    Math.max(execTimeout, 60000)
  );

  // cwd di-jail ke folder workspace sesi: default = folder sesi,
  // override hanya boleh relatif di dalamnya (absolute ke luar ditolak).
  const base = ctx.sessionId
    ? await getSessionWorkspace(ctx.sessionId)
    : ensureArtifactsDir();
  const rawCwd = arg(args.cwd, "");
  const cwd = rawCwd ? path.resolve(base, rawCwd) : base;
  if (!isInside(base, cwd)) {
    return { ok: false, output: "ERROR: ACCESS_DENIED: cwd di luar folder workspace sesi" };
  }
  if (!fs.existsSync(cwd)) {
    return { ok: false, output: `ERROR: cwd tidak ada: ${cwd}` };
  }
  // JAIL JUGA ISI COMMAND: path absolut di dalam perintah (mis. `> C:\Users\dirga\test.md`)
  // bisa lolos dari jail cwd dan menulis ke luar folder. Tolak path absolut
  // yang keluar dari workspace — pakai path relatif terhadap folder sesi.
  // Lookbehind (?<![A-Za-z]) mencegah URL seperti https:// ikut tertangkap.
  const absInCommand =
    command.match(
      /(?<![A-Za-z])(?:[A-Za-z]:[\\/]|\\\\[A-Za-z0-9._-]+[\\/])[^\s"'<>|&;]*/g
    ) ?? [];
  for (const p of absInCommand) {
    if (!isInside(base, path.resolve(p))) {
      return {
        ok: false,
        output:
          `ERROR: ACCESS_DENIED: path absolut di dalam perintah keluar dari folder workspace sesi: ${p}\n` +
          `Folder sesi: ${base}\n` +
          `Pakai path RELATIF terhadap folder sesi (mis. "test.md"), bukan path absolut.`,
      };
    }
  }

  const started = Date.now();
  const r = await runCommand(command, cwd, timeoutMs);
  const durationMs = Date.now() - started;

  if (r.timedOut) {
    return {
      ok: false,
      output:
        `TIMEOUT setelah ${durationMs}ms (proses di-kill).\n` +
        `--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
      durationMs,
    };
  }
  return {
    ok: r.exitCode === 0,
    output:
      `exit_code=${r.exitCode} (${durationMs}ms) [${cwd}]\n` +
      `--- stdout ---\n${r.stdout || "(kosong)"}\n` +
      `--- stderr ---\n${r.stderr || "(kosong)"}`,
    exitCode: r.exitCode ?? undefined,
    durationMs,
  };
}

export const terminalExecTool: ToolDefinition = {
  name: "terminal_exec",
  description:
    "Jalankan perintah shell penuh (PowerShell di Windows, bash di Linux/macOS) dengan timeout & kill otomatis. " +
    "Berjalan di folder kerja sesi ini (di-jail, tidak bisa keluar). " +
    "Perintah BERBAHAYA (hapus massal, format, shutdown, ubah registry, pipe kode remote) butuh persetujuan user dulu via approval gate. " +
    "Untuk coding, build, install, git, dan verifikasi. Berjalan sebagai user.",
  parameters: {
    command: {
      type: "string",
      description: "Perintah shell lengkap, mis. 'python train.py --epochs 5'",
      required: true,
    },
    cwd: {
      type: "string",
      description: "Subfolder relatif di dalam folder kerja sesi (default: folder sesi itu sendiri)",
    },
    timeoutMs: {
      type: "number",
      description: "Timeout ms (default dari env, maks 60 dtk kecuali env lebih besar)",
    },
  },
  handler: async (args, ctx) => terminalExec(args, ctx),
};
