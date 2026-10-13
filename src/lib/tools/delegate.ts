import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { agentRuns } from "../../db/schema.ts";
import { getConfig, num } from "../config.ts";
import { runAgentLoop } from "../agent/engine.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";
import { arg } from "./types.ts";

/**
 * delegate_task — spawn subagent untuk mengerjakan subtugas secara otonom.
 *
 * - Berbagi sessionId (dan folder workspace sesi) dengan run induk.
 * - Workspace DIPARTISI: subagen menulis ke <workspace>/.delegates/<subRunId>/
 *   supaya delegate paralel tidak saling timpa file output (last-writer-wins).
 *   Induk bisa membaca hasil dari subfolder itu (masih di dalam jail sesi).
 * - Depth-limited: kedalaman maksimal dari AGENT_MAX_DEPTH (default 2).
 * - Budget langkah subagent = setengah dari induk (min 3).
 * - Timeout 6 menit: sinyal abort membatalkan loop subagen (hard-cancel,
 *   bukan Promise.race yang dilepas — subagen yatim tidak lagi terus jalan).
 * - Beberapa delegate_task dalam SATU langkah dijalankan PARALEL oleh engine.
 */
async function delegateTask(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const task = arg(args.task).trim();
  if (!task) return { ok: false, output: "ERROR: 'task' wajib diisi" };
  const context = arg(args.context, "").trim();

  const cfg = await getConfig();
  const maxDepth = num(cfg.values.AGENT_MAX_DEPTH, 2);
  const depth = ctx.depth ?? 0;
  if (depth >= maxDepth) {
    return {
      ok: false,
      output:
        `ERROR: batas kedalaman delegasi tercapai (${maxDepth}). ` +
        `Kerjakan langsung dengan tool yang ada, jangan delegasikan lagi.`,
    };
  }

  const parentMaxSteps = num(cfg.values.AGENT_MAX_STEPS, 12);
  const subMaxSteps = Math.max(3, Math.floor(parentMaxSteps / 2));
  const subRunId = nanoid();
  const goal = context ? `${task}\n\nKonteks dari induk: ${context}` : task;

  const db = getDb();
  const now = Date.now();
  await db.insert(agentRuns).values({
    id: subRunId,
    sessionId: ctx.sessionId ?? null,
    parentRunId: ctx.runId ?? null,
    goal: goal.slice(0, 500),
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });

  const DELEGATE_TIMEOUT_MS = 6 * 60 * 1000;
  let timedOut = false;
  // Sinyal pembatalan gabungan: timeout delegate + pembatalan run induk.
  const abortCtrl = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    abortCtrl.abort();
  }, DELEGATE_TIMEOUT_MS);
  timer.unref?.();
  const onParentAbort = () => abortCtrl.abort();
  ctx.signal?.addEventListener("abort", onParentAbort);
  // Partisi workspace: subagen menulis ke subfolder sendiri
  let subWorkspaceDir: string | undefined;
  try {
    if (ctx.sessionId) {
      const { getSessionWorkspace } = await import("../agent/workspace.ts");
      const parentDir = ctx.workspaceDir || (await getSessionWorkspace(ctx.sessionId));
      subWorkspaceDir = path.join(parentDir, ".delegates", subRunId);
      fs.mkdirSync(subWorkspaceDir, { recursive: true });
    }
  } catch {
    /* gagal partisi bukan fatal — subagen pakai workspace sesi */
    subWorkspaceDir = undefined;
  }
  try {
    await runAgentLoop({
      runId: subRunId,
      goal,
      sessionId: ctx.sessionId,
      model: ctx.model,
      depth: depth + 1,
      parentRunId: ctx.runId,
      maxSteps: subMaxSteps,
      signal: abortCtrl.signal,
      workspaceDir: subWorkspaceDir,
    });
  } catch (e) {
    return {
      ok: false,
      output: `ERROR: subagent gagal: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onParentAbort);
  }

  // Baca hasil subagent dari DB (final atau parsial)
  const rows = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, subRunId))
    .limit(1);
  const sub = rows[0];
  const answer = (sub?.resultText || "").slice(0, 3000);
  const status = sub?.status ?? "unknown";
  const head = timedOut
    ? `Subagent TIMEOUT setelah 6 menit (status: ${status}). Progres parsial:\n`
    : `Subagent selesai (status: ${status}).\n`;
  const folderNote = subWorkspaceDir
    ? `\n(File hasil subagen, bila ada, ada di .delegates/${subRunId}/ — baca dari sana, jangan asumsikan nama file di root workspace.)`
    : "";
  return {
    ok: status === "completed",
    output:
      head +
      (answer
        ? `Hasil:\n${answer}`
        : "(tidak ada jawaban final — cek langkah tool di status run)") +
      folderNote,
  };
}

export const delegateTaskTool: ToolDefinition = {
  name: "delegate_task",
  description:
    "Delegasikan subtugas ke SUBAGEN otonom (jalan dengan tool yang sama, di folder workspace sesi yang sama). " +
    "Gunakan ketika pekerjaan bisa dipecah paralel (mis. riset 3 topik sekaligus → 3 delegate_task dalam satu langkah = jalan paralel). " +
    "Subagen TIDAK bisa delegasi lagi bila batas kedalaman tercapai. Hasil dikembalikan sebagai ringkasan.",
  parameters: {
    task: {
      type: "string",
      description: "Tugas jelas & mandiri untuk subagen",
      required: true,
    },
    context: {
      type: "string",
      description: "Konteks/info latar yang perlu diketahui subagen",
    },
  },
  handler: async (args, ctx) => delegateTask(args, ctx),
};
