import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/index.ts";
import { agentRuns, messages, toolExecutions } from "../../db/schema.ts";
import { chatOnce } from "../ai/client.ts";
import { getConfig, num } from "../config.ts";
import { extractToolCalls } from "../ai/parser.ts";
import {
  buildAgentSystemPrompt,
  buildCriticPrompt,
  buildStepPrompt,
} from "../ai/prompt-templates.ts";
import { toGatewayError } from "../security/sanitization.ts";
import { TOOL_MAP, getToolManifest, hasTool } from "../tools/registry.ts";
import { getSkillCatalogText } from "../skills/loader.ts";
import { generatePlan } from "./planner.ts";
import { summarizeToolHistory } from "./context.ts";
import { getSessionWorkspace } from "./workspace.ts";

export interface AgentRunOptions {
  runId: string;
  goal: string;
  sessionId?: string;
  model?: string;
  /** Kedalaman delegasi (0 = run utama). */
  depth?: number;
  parentRunId?: string;
  /** Override budget langkah (untuk subagent). */
  maxSteps?: number;
}

/**
 * Autonomous loop: Plan -> Execute Step -> Evaluate.
 * Berjalan sebagai background task; status bisa di-poll via DB.
 */
export async function runAgentLoop(opts: AgentRunOptions): Promise<void> {
  const db = getDb();
  const cfg = await getConfig();
  const model = opts.model || cfg.values.DEFAULT_MODEL;
  const maxSteps = opts.maxSteps ?? num(cfg.values.AGENT_MAX_STEPS, 12);
  const depth = opts.depth ?? 0;
  // Batas waktu keseluruhan run: 10 menit — cegah status 'running' abadi
  // bila gateway hang di luar timeout per-request.
  const RUN_TIMEOUT_MS = 10 * 60 * 1000;
  const deadline = Date.now() + RUN_TIMEOUT_MS;

  const setStatus = async (
    status: "planning" | "running" | "completed" | "failed",
    patch: Partial<{ planTreeJson: string; currentStep: number; error: string; finishedAt: number; resultText: string }> = {}
  ) => {
    await db
      .update(agentRuns)
      .set({ status, updatedAt: Date.now(), ...patch })
      .where(eq(agentRuns.id, opts.runId));
  };

  const logTool = async (
    toolName: string,
    args: Record<string, unknown>,
    result: { ok: boolean; output: string; exitCode?: number; durationMs?: number }
  ) => {
    await db.insert(toolExecutions).values({
      id: nanoid(),
      runId: opts.runId,
      sessionId: opts.sessionId,
      toolName,
      argsJson: JSON.stringify(args).slice(0, 4000),
      resultJson: JSON.stringify({
        ok: result.ok,
        output: result.output.slice(0, 4000),
        exitCode: result.exitCode,
      }),
      durationMs: result.durationMs ?? 0,
      exitCode: result.exitCode,
      createdAt: Date.now(),
    });
  };

  try {
    // --- PLANNING ---
    await setStatus("planning");
    let planTreeJson = "[]";
    try {
      const plan = await generatePlan(opts.goal, model);
      planTreeJson = JSON.stringify(plan);
    } catch (e) {
      // Planner gagal bukan fatal — lanjut tanpa rencana (model atur sendiri)
      console.error(
        "[agent] planner gagal, lanjut tanpa plan:",
        e instanceof Error ? e.message : e
      );
    }
    await setStatus("running", { planTreeJson, currentStep: 0 });

    // --- EXECUTE LOOP ---
    // Folder kerja sesi (di-jail) — diberitahukan ke model via system prompt
    let workspaceDir = "";
    try {
      if (opts.sessionId) workspaceDir = await getSessionWorkspace(opts.sessionId);
    } catch {
      /* fallback: prompt pakai teks generik */
    }
    // Auto-recall: cari memori jangka panjang yang relevan dengan goal
    let memoryBlock = "";
    try {
      const { searchSimilar } = await import("../../db/vector.ts");
      const hits = await searchSimilar(opts.goal, 3);
      const relevant = hits.filter((h) => h.score > 0.35);
      if (relevant.length > 0) {
        memoryBlock = relevant.map((h) => `- ${h.text}`).join("\n");
      }
    } catch {
      /* memori gagal bukan fatal — lanjut tanpa memori */
    }
    const persona = (cfg.values.AGENT_PERSONA || "").trim();
    // Profil PC (cached 10 menit) — agen tahu spek & toolchain tanpa perlu nanya
    let environment = "";
    try {
      const { getEnvProfile, formatEnvBlock } = await import("./environment.ts");
      environment = formatEnvBlock(await getEnvProfile());
    } catch {
      /* profil gagal bukan fatal */
    }
    const systemPrompt = buildAgentSystemPrompt(getToolManifest(), getSkillCatalogText(), {
      workspaceDir,
      persona,
      memories: memoryBlock,
      environment,
    });
    const history: {
      toolName: string;
      argsJson: string;
      resultJson: string;
      ok: boolean;
    }[] = [];

    let finalAnswer = "";
    let step = 0;

    while (step < maxSteps) {
      step++;
      if (Date.now() > deadline) {
        finalAnswer =
          "Batas waktu 10 menit tercapai. Riwayat eksekusi tool tersimpan dan bisa dilihat di status run.";
        break;
      }
      await setStatus("running", { currentStep: step });

      const { content } = await chatOnce(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: buildStepPrompt(
              opts.goal,
              planTreeJson,
              step,
              summarizeToolHistory(history)
            ),
          },
        ],
        { model, temperature: 0.4 }
      );

      const { calls, cleaned } = extractToolCalls(content);

      if (calls.length === 0) {
        finalAnswer = cleaned || content;
        break;
      }

      const execOne = async (call: { name: string; args: Record<string, unknown> }) => {
        if (!hasTool(call.name)) {
          const result = {
            ok: false,
            output: `ERROR: tool '${call.name}' tidak dikenal`,
          };
          await logTool(call.name, call.args, result);
          history.push({
            toolName: call.name,
            argsJson: JSON.stringify(call.args),
            resultJson: JSON.stringify(result),
            ok: false,
          });
          return;
        }
        const started = Date.now();
        let result: { ok: boolean; output: string; exitCode?: number; durationMs?: number };
        try {
          const r = await TOOL_MAP[call.name](call.args, {
            runId: opts.runId,
            sessionId: opts.sessionId,
            depth,
            model,
          });
          result = { ...r, durationMs: r.durationMs ?? Date.now() - started };
        } catch (e) {
          result = {
            ok: false,
            output: `ERROR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
            durationMs: Date.now() - started,
          };
        }
        await logTool(call.name, call.args, result);
        history.push({
          toolName: call.name,
          argsJson: JSON.stringify(call.args),
          resultJson: JSON.stringify(result),
          ok: result.ok,
        });
      };

      // delegate_task jalan PARALEL (subagen independen); tool lain sekuensial
      const delegates = calls.filter((c) => c.name === "delegate_task");
      const rest = calls.filter((c) => c.name !== "delegate_task");
      for (const call of rest) {
        await execOne(call);
      }
      await Promise.all(delegates.map((call) => execOne(call)));

      // Bila model menyertakan teks final bersama toolcall terakhir, simpan kandidatnya
      if (cleaned) finalAnswer = cleaned;
    }

    if (step >= maxSteps && !finalAnswer) {
      finalAnswer =
        "Langkah maksimum tercapai. Riwayat eksekusi tool tersimpan dan bisa dilihat di status run.";
    }

    // CRITIC PASS: verifikasi independen sebelum jawaban final diserahkan.
    // Hanya bila ada eksekusi tool (ada bukti yang bisa diverifikasi).
    if (finalAnswer && history.length > 0 && cfg.values.AGENT_CRITIC_ENABLED !== "0") {
      try {
        const { content: corrected } = await chatOnce(
          [
            {
              role: "user",
              content: buildCriticPrompt(
                opts.goal,
                finalAnswer,
                summarizeToolHistory(history)
              ),
            },
          ],
          { model, temperature: 0.2 }
        );
        if (corrected.trim()) finalAnswer = corrected.trim();
      } catch (e) {
        console.error("[agent] critic gagal, pakai draf:", e instanceof Error ? e.message : e);
      }
    }

    // Simpan jawaban final sebagai pesan asisten di sesi (bila ada sessionId)
    if (opts.sessionId && finalAnswer) {
      await db.insert(messages).values({
        id: nanoid(),
        sessionId: opts.sessionId,
        role: "assistant",
        content: finalAnswer,
        reasoningContent: "",
        createdAt: Date.now(),
      });
    }

    // Simpan juga di baris run agar API status/panel bisa menampilkannya
    // walau tanpa sessionId.
    await setStatus("completed", {
      finishedAt: Date.now(),
      ...(finalAnswer ? { resultText: finalAnswer } : {}),
    });
  } catch (e) {
    const gw = toGatewayError(e);
    await setStatus("failed", {
      error: `${gw.error} (${gw.code})`,
      finishedAt: Date.now(),
    });
  }
}
