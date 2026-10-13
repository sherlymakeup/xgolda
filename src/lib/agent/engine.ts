import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/index.ts";
import { agentRuns, messages, toolExecutions } from "../../db/schema.ts";
import { chatOnce } from "../ai/client.ts";
import { env } from "../env.ts";
import { extractToolCalls } from "../ai/parser.ts";
import {
  buildAgentSystemPrompt,
  buildStepPrompt,
} from "../ai/prompt-templates.ts";
import { toGatewayError } from "../security/sanitization.ts";
import { TOOL_MAP, getToolManifest, hasTool } from "../tools/registry.ts";
import { getSkillCatalogText } from "../skills/loader.ts";
import { generatePlan } from "./planner.ts";
import { summarizeToolHistory } from "./context.ts";

export interface AgentRunOptions {
  runId: string;
  goal: string;
  sessionId?: string;
  model?: string;
}

/**
 * Autonomous loop: Plan -> Execute Step -> Evaluate.
 * Berjalan sebagai background task; status bisa di-poll via DB.
 */
export async function runAgentLoop(opts: AgentRunOptions): Promise<void> {
  const db = getDb();
  const model = opts.model || env.defaultModel;
  const maxSteps = env.agentMaxSteps;
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
    const systemPrompt = buildAgentSystemPrompt(
      getToolManifest(),
      getSkillCatalogText()
    );
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

      for (const call of calls) {
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
          continue;
        }
        const started = Date.now();
        let result: { ok: boolean; output: string; exitCode?: number; durationMs?: number };
        try {
          const r = await TOOL_MAP[call.name](call.args, {
            runId: opts.runId,
            sessionId: opts.sessionId,
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
      }

      // Bila model menyertakan teks final bersama toolcall terakhir, simpan kandidatnya
      if (cleaned) finalAnswer = cleaned;
    }

    if (step >= maxSteps && !finalAnswer) {
      finalAnswer =
        "Langkah maksimum tercapai. Riwayat eksekusi tool tersimpan dan bisa dilihat di status run.";
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
