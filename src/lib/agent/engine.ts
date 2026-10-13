import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/index.ts";
import { agentRuns, messages, toolExecutions } from "../../db/schema.ts";
import { chatOnce } from "../ai/client.ts";
import { getConfig, num } from "../config.ts";
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
import { getSessionWorkspace } from "./workspace.ts";
import { verifyFinalAnswer } from "./verify.ts";
import { emitRunEvent } from "./bus.ts";

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
    // --- ACK: konfirmasi penerimaan goal — WAJIB respons asli dari gateway,
    // bukan template hardcoded. Hanya untuk run utama (bukan subagent).
    if (depth === 0) {
      try {
        const persona = (cfg.values.AGENT_PERSONA || "").trim();
        const { content: ack } = await chatOnce(
          [
            {
              role: "user",
              content:
                `Kamu adalah XGOLDA Agent. User baru saja memberi goal berikut:\n\n${opts.goal}\n\n` +
                `Balas dengan SATU kalimat konfirmasi singkat (maksimal 15 kata) bahwa kamu menerima goal ini dan akan mengerjakannya. ` +
                `JANGAN mulai mengerjakan, JANGAN menjelaskan rencana — hanya konfirmasi penerimaan. ` +
                `Gunakan Bahasa Indonesia santai.${persona ? ` Gaya: ${persona.slice(0, 200)}` : ""}`,
            },
          ],
          { model, temperature: 0.5 }
        );
        const ackText = ack.trim().slice(0, 300);
        if (ackText) {
          emitRunEvent(opts.runId, { type: "ack", text: ackText });
        }
      } catch (e) {
        // Ack gagal bukan fatal — lanjut ke planning
        console.error("[agent] ack gagal:", e instanceof Error ? e.message : e);
      }
    }

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
    // Siarkan rencana ke client SSE
    try {
      const steps = JSON.parse(planTreeJson) as {
        step: number;
        title: string;
        description: string;
        tool: string | null;
      }[];
      emitRunEvent(opts.runId, { type: "plan", steps });
    } catch {
      /* abaikan */
    }

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
    // Catatan sistem untuk iterasi berikutnya (mis. toolcall malformed)
    let systemNote = "";

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
              summarizeToolHistory(history),
              systemNote
            ),
          },
        ],
        { model, temperature: 0.4 }
      );
      systemNote = ""; // terkonsumsi

      const { calls, cleaned, malformed } = extractToolCalls(content);

      // Toolcall malformed = tool TIDAK pernah dieksekusi. JANGAN jadikan
      // jawaban final (itu yang bikin agen klaim "sudah dibuat" padahal tidak).
      // Beri tahu model dan beri kesempatan memperbaiki.
      if (malformed > 0) {
        systemNote =
          `PERINGATAN SISTEM: ${malformed} blok <toolcall> yang kamu kirim ` +
          `GAGAL di-parse (JSON tidak valid — biasanya newline/quote di dalam ` +
          `string args tidak di-escape). Tool tersebut BELUM dijalankan sama sekali. ` +
          `Kirim ulang toolcall-nya dengan JSON valid: escape newline jadi \\n dan ` +
          `tanda kutip jadi \\" di dalam string. JANGAN mengklaim tool sudah ` +
          `dijalankan sebelum kamu menerima hasil tool.`;
      }

      if (calls.length === 0) {
        if (malformed > 0) {
          // Semua toolcall rusak — ulangi, jangan jadikan jawaban final
          continue;
        }
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

    // VERIFIKASI DETERMINISTIK (menggantikan critic LLM): cocokkan klaim
    // jawaban final dengan bukti tool. Hanya mengintervensi bila ada
    // kontradiksi yang terbukti — selain itu draf dibiarkan apa adanya.
    if (finalAnswer && history.length > 0 && cfg.values.AGENT_CRITIC_ENABLED !== "0") {
      const written: string[] = [];
      const failed: string[] = [];
      const succeeded: string[] = [];
      for (const h of history) {
        try {
          const args = JSON.parse(h.argsJson) as { filename?: string };
          const res = JSON.parse(h.resultJson) as { ok?: boolean; output?: string };
          if (h.toolName === "fs_write_artifact" && res.ok && args.filename) {
            written.push(String(args.filename));
          }
          if (res.ok === false) {
            failed.push(
              `${h.toolName}: ${String(res.output || "").slice(0, 200)}`
            );
          } else if (res.ok === true) {
            succeeded.push(h.toolName);
          }
        } catch {
          /* abaikan baris rusak */
        }
      }
      finalAnswer = verifyFinalAnswer(finalAnswer, { written, succeeded, failed });
    }

    // RECOVERY: bila jawaban final degenerate (kosong/sampah), coba satu
    // panggilan ringkasan dari bukti tool — jangan simpan "】 【." ke user.
    const meaningful = finalAnswer.replace(/[\s【】\[\]]/g, "");
    if (history.length > 0 && meaningful.length < 10) {
      try {
        const { content } = await chatOnce(
          [
            {
              role: "user",
              content:
                `Tulis jawaban final untuk user dalam Bahasa Indonesia.\n\n` +
                `GOAL: ${opts.goal}\n\n` +
                `RINGKASAN HASIL TOOL:\n${summarizeToolHistory(history)}\n\n` +
                `Tulis langsung: apa yang dikerjakan dan hasilnya. ` +
                `Jangan mengarang di luar bukti tool di atas.`,
            },
          ],
          { model, temperature: 0.4 }
        );
        if (content.trim().replace(/[\s【】\[\]]/g, "").length >= 10) {
          finalAnswer = content.trim();
        }
      } catch (e) {
        console.error("[agent] recovery gagal:", e instanceof Error ? e.message : e);
      }
    }

    // Siarkan jawaban final (terverifikasi) ke client SSE
    if (finalAnswer) {
      emitRunEvent(opts.runId, { type: "final", text: finalAnswer });
    }

    // Simpan jawaban final sebagai pesan asisten di sesi (bila ada sessionId),
    // ditautkan ke run ini untuk layout timeline per-bubble.
    if (opts.sessionId && finalAnswer) {
      await db.insert(messages).values({
        id: nanoid(),
        sessionId: opts.sessionId,
        role: "assistant",
        content: finalAnswer,
        reasoningContent: "",
        runId: opts.runId,
        createdAt: Date.now(),
      });
    }

    // Simpan juga di baris run agar API status/panel bisa menampilkannya
    // walau tanpa sessionId. currentStep = total plan + 1 → semua langkah plan
    // tampil centang (run selesai = rencana dijalankan sampai akhir).
    let totalPlanSteps = 0;
    try {
      totalPlanSteps = (JSON.parse(planTreeJson) as unknown[]).length;
    } catch {
      /* abaikan */
    }
    await setStatus("completed", {
      finishedAt: Date.now(),
      currentStep: totalPlanSteps + 1,
      ...(finalAnswer ? { resultText: finalAnswer } : {}),
    });
    emitRunEvent(opts.runId, { type: "done", status: "completed" });
  } catch (e) {
    const gw = toGatewayError(e);
    await setStatus("failed", {
      error: `${gw.error} (${gw.code})`,
      finishedAt: Date.now(),
    });
    emitRunEvent(opts.runId, {
      type: "error",
      message: `${gw.error} (${gw.code})`,
    });
    emitRunEvent(opts.runId, { type: "done", status: "failed" });
  }
}
