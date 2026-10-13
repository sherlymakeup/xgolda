import fs from "node:fs";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/index.ts";
import { agentRuns, messages, toolExecutions } from "../../db/schema.ts";
import { chatOnce, GatewayError } from "../ai/client.ts";
import type { ChatMessage } from "../ai/client.ts";
import { getConfig, num } from "../config.ts";
import { extractToolCalls } from "../ai/parser.ts";
import {
  buildAgentSystemPrompt,
  buildStepPrompt,
  deriveStyleHint,
} from "../ai/prompt-templates.ts";
import { filterRelevantMemories, MEMORY_AUTO_RECALL_MAX_CHARS } from "../tools/memory.ts";
import { toGatewayError } from "../security/sanitization.ts";
import { TOOL_MAP, getToolManifest, hasTool, toOpenAITools } from "../tools/registry.ts";
import { getSkillCatalogText } from "../skills/loader.ts";
import { generatePlan } from "./planner.ts";
import { summarizeToolHistory } from "./context.ts";
import { getSessionWorkspace } from "./workspace.ts";
import {
  verifyFinalAnswer,
  extractFilenames,
  isCreateGoal,
  missingOnDisk,
} from "./verify.ts";
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
  /** Sinyal pembatalan (timeout delegate / pembatalan induk). */
  signal?: AbortSignal;
  /** Override folder workspace (subagen pakai subfolder .delegates/<subRunId>). */
  workspaceDir?: string;
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

  // Satu sinyal pembatalan gabungan: sinyal eksternal (timeout delegate /
  // pembatalan induk) + deadline internal. Diteruskan ke chatOnce supaya
  // panggilan gateway yang sedang jalan ikut dibatalkan — bukan cuma
  // dicek antar-langkah.
  const abortCtrl = new AbortController();
  const deadlineTimer = setTimeout(() => abortCtrl.abort(), RUN_TIMEOUT_MS);
  deadlineTimer.unref?.();
  const onExternalAbort = () => abortCtrl.abort();
  opts.signal?.addEventListener("abort", onExternalAbort);
  const throwIfAborted = () => {
    if (abortCtrl.signal.aborted) {
      throw new Error("AGENT_ABORTED: run dibatalkan (timeout/pembatalan)");
    }
  };

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
    throwIfAborted();
    // --- ACK: konfirmasi penerimaan goal — WAJIB respons asli dari gateway,
    // bukan template hardcoded. Hanya untuk run utama (bukan subagent).
    if (depth === 0) {
      try {
        const persona = (cfg.values.AGENT_PERSONA || "").trim();
        const styleHint = deriveStyleHint(opts.goal);
        const ackInstruction = styleHint.includes("Bahasa Inggris")
          ? "Reply with ONE short sentence (max 15 words) confirming you accept this goal and will work on it. Do NOT start working, do NOT explain the plan — only confirm acceptance."
          : "Balas dengan SATU kalimat konfirmasi singkat (maksimal 15 kata) bahwa kamu menerima goal ini dan akan mengerjakannya. JANGAN mulai mengerjakan, JANGAN menjelaskan rencana — hanya konfirmasi penerimaan.";
        const { content: ack } = await chatOnce(
          [
            {
              role: "user",
              content:
                `Kamu adalah XGOLDA Agent. User baru saja memberi goal berikut:\n\n${opts.goal}\n\n` +
                `${ackInstruction} ` +
                `${persona ? `Gaya: ${persona} ` : ""}${styleHint}`,
            },
          ],
          { model, temperature: 0.5, signal: abortCtrl.signal }
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
    // Folder kerja sesi (di-jail) — diberitahukan ke model via system prompt.
    // Subagen pakai override workspaceDir (subfolder .delegates/<subRunId>)
    // supaya delegate paralel tidak saling timpa file output.
    let workspaceDir = opts.workspaceDir || "";
    try {
      if (!workspaceDir && opts.sessionId) {
        workspaceDir = await getSessionWorkspace(opts.sessionId);
      }
    } catch {
      /* fallback: prompt pakai teks generik */
    }
    // Auto-recall: cari memori jangka panjang yang relevan dengan goal.
    // filterRelevantMemories: floor + margin relatif + dedup. Tiap memori
    // dipotong 500 karakter supaya blok memori tidak membengkak di prompt.
    let memoryBlock = "";
    try {
      const { searchSimilar } = await import("../../db/vector.ts");
      const hits = await searchSimilar(opts.goal, 5);
      const relevant = filterRelevantMemories(hits);
      if (relevant.length > 0) {
        memoryBlock = relevant
          .map((h) =>
            h.text.length > MEMORY_AUTO_RECALL_MAX_CHARS
              ? `- ${h.text.slice(0, MEMORY_AUTO_RECALL_MAX_CHARS)}…`
              : `- ${h.text}`
          )
          .join("\n");
      }
    } catch {
      /* memori gagal bukan fatal — lanjut tanpa memori */
    }
    const persona = (cfg.values.AGENT_PERSONA || "").trim();
    const styleHint = deriveStyleHint(opts.goal);
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
      styleHint,
      memories: memoryBlock,
      environment,
    });
    // Konteks percakapan thread ini (pesan-pesan sebelumnya + lampiran
    // gambar sebagai vision parts) — tanpa ini follow-up seperti
    // "lanjutkan / perbaiki yang tadi" gagal karena agen buta riwayat.
    let baseMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
    if (opts.sessionId) {
      try {
        const { buildChatContext } = await import("./context.ts");
        const ctxMessages = await buildChatContext(opts.sessionId, systemPrompt);
        if (ctxMessages.length > 1) baseMessages = ctxMessages;
      } catch {
        /* konteks gagal bukan fatal — lanjut tanpa riwayat */
      }
    }
    const history: {
      toolName: string;
      argsJson: string;
      resultJson: string;
      ok: boolean;
    }[] = [];

    let finalAnswer = "";
    let step = 0;
    // Run berakhir prematur (deadline/maxSteps) → currentStep di akhir
    // mencerminkan langkah yang benar-benar jalan, bukan total plan.
    let endedEarly = false;
    // Catatan sistem untuk iterasi berikutnya (mis. toolcall malformed)
    let systemNote = "";
    // Native function calling (Opencode-style) — bila gateway/model tidak
    // mendukung `tools` (HTTP 400), fallback permanen ke protokol teks.
    const nativeTools = toOpenAITools();
    let useNativeTools = true;

    while (step < maxSteps) {
      step++;
      throwIfAborted();
      if (Date.now() > deadline) {
        endedEarly = true;
        finalAnswer =
          "Batas waktu 10 menit tercapai. Riwayat eksekusi tool tersimpan dan bisa dilihat di status run.";
        break;
      }
      await setStatus("running", { currentStep: step });

      const stepMessages: ChatMessage[] = [
        ...baseMessages,
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
      ];
      let stepResult;
      try {
        stepResult = await chatOnce(stepMessages, {
          model,
          temperature: 0.4,
          tools: useNativeTools ? nativeTools : undefined,
          signal: abortCtrl.signal,
        });
      } catch (e) {
        if (
          useNativeTools &&
          e instanceof GatewayError &&
          e.status === 400
        ) {
          // Gateway/model menolak `tools` — fallback ke protokol teks
          useNativeTools = false;
          console.error(
            "[agent] gateway menolak tools native (400), fallback ke protokol teks"
          );
          stepResult = await chatOnce(stepMessages, {
            model,
            temperature: 0.4,
            signal: abortCtrl.signal,
          });
        } else {
          throw e;
        }
      }
      const { content } = stepResult;
      systemNote = ""; // terkonsumsi

      // Utamakan tool_calls terstruktur; teks <toolcall> hanya cadangan
      // bila model tidak memakai function calling.
      const { calls: textCalls, cleaned, malformed: textMalformed } =
        extractToolCalls(content);
      const calls =
        stepResult.toolCalls.length > 0 ? stepResult.toolCalls : textCalls;
      // Native tool_call ber-argumen rusak TIDAK boleh di-drop diam-diam —
      // sebelumnya malformed native tidak pernah dibaca engine.
      const nativeMalformed = stepResult.malformedToolCalls ?? 0;
      const malformed =
        stepResult.toolCalls.length > 0 ? nativeMalformed : textMalformed;

      // Toolcall malformed = tool TIDAK pernah dieksekusi. JANGAN jadikan
      // jawaban final (itu yang bikin agen klaim "sudah dibuat" padahal tidak).
      // Beri tahu model dan beri kesempatan memperbaiki.
      if (malformed > 0) {
        systemNote =
          `PERINGATAN SISTEM: ${malformed} pemanggilan tool yang kamu kirim ` +
          `GAGAL di-parse dan BELUM dijalankan sama sekali. ` +
          (nativeMalformed > 0
            ? `Function calling native-nya ber-argumen JSON tidak valid — kirim ulang dengan arguments JSON valid. `
            : `Blok <toolcall>-nya ber-JSON tidak valid (biasanya newline/quote di dalam ` +
              `string args tidak di-escape) — kirim ulang dengan JSON valid: escape newline jadi \\n dan ` +
              `tanda kutip jadi \\" di dalam string. `) +
          `JANGAN mengklaim tool sudah dijalankan sebelum kamu menerima hasil tool.`;
      }

      if (calls.length === 0) {
        if (malformed > 0) {
          // Semua toolcall rusak — ulangi, jangan jadikan jawaban final
          continue;
        }
        finalAnswer = cleaned || content;
        // VERIFIKASI DISK (ground truth): bila goal meminta pembuatan file,
        // file itu WAJIB ada di folder workspace. Kalau tidak ada, jawaban
        // final dibatalkan — model disuruh menulis ulang via fs_write_artifact.
        // Ini menangkap kasus agen "verifikasi" via terminal dari folder yang
        // salah, atau klaim sukses tanpa pernah menulis.
        if (isCreateGoal(opts.goal) && step < maxSteps) {
          const missing = missingOnDisk(
            extractFilenames(opts.goal),
            workspaceDir
          );
          if (missing.length > 0) {
            systemNote =
              `VERIFIKASI DISK GAGAL: file ${missing.join(", ")} TIDAK ADA ` +
              `di folder workspace (${workspaceDir}). Klaim "sudah dibuat" SALAH — ` +
              `jangan mengulang klaim itu. Tulis ulang file tersebut dengan ` +
              `fs_write_artifact (JANGAN pakai terminal_exec untuk menulis file), ` +
              `lalu verifikasi dengan fs_read_artifact.`;
            finalAnswer = "";
            continue;
          }
        }
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
            signal: abortCtrl.signal,
            workspaceDir: workspaceDir || undefined,
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

      // delegate_task jalan PARALEL (subagen independen); tool lain sekuensial.
      // Batas 4 delegate paralel per langkah — fan-out tak terbatas
      // membanjiri gateway/CPU/DB dan membuat subagen yatim.
      const delegates = calls.filter((c) => c.name === "delegate_task");
      const rest = calls.filter((c) => c.name !== "delegate_task");
      for (const call of rest) {
        await execOne(call);
      }
      const MAX_PARALLEL_DELEGATES = 4;
      for (const call of delegates.slice(MAX_PARALLEL_DELEGATES)) {
        const result = {
          ok: false,
          output:
            "ERROR: terlalu banyak delegate_task paralel dalam satu langkah (maks 4) — kerjakan sisanya di langkah berikutnya.",
        };
        await logTool(call.name, call.args, result);
        history.push({
          toolName: call.name,
          argsJson: JSON.stringify(call.args),
          resultJson: JSON.stringify(result),
          ok: false,
        });
      }
      await Promise.all(delegates.slice(0, MAX_PARALLEL_DELEGATES).map((call) => execOne(call)));

      // Bila model menyertakan teks final bersama toolcall terakhir, simpan kandidatnya
      if (cleaned) finalAnswer = cleaned;
    }

    if (step >= maxSteps && !finalAnswer) {
      endedEarly = true;
      finalAnswer =
        "Langkah maksimum tercapai. Riwayat eksekusi tool tersimpan dan bisa dilihat di status run.";
    }

    // VERIFIKASI DETERMINISTIK (menggantikan critic LLM): cocokkan klaim
    // jawaban final dengan bukti tool. Hanya mengintervensi bila ada
    // kontradiksi yang terbukti — selain itu draf dibiarkan apa adanya.
    // TIDAK ada gate history.length — run tanpa tool call pun harus
    // diverifikasi (klaim file tanpa tool call apa pun = belum terverifikasi).
    if (finalAnswer && cfg.values.AGENT_CRITIC_ENABLED !== "0") {
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
      finalAnswer = verifyFinalAnswer(finalAnswer, {
        written,
        succeeded,
        failed,
        diskFiles: (() => {
          try {
            return fs
              .readdirSync(workspaceDir, { recursive: true })
              .map((e) => String(e).split(/[\\/]/).pop()?.toLowerCase() ?? "")
              .filter(Boolean);
          } catch {
            return [];
          }
        })(),
      });
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
    // walau tanpa sessionId. currentStep: run yang berakhir prematur
    // (deadline/maxSteps) memakai langkah yang benar-benar jalan — bukan
    // total plan + 1 (yang bikin semua langkah tampil centang).
    let totalPlanSteps = 0;
    try {
      totalPlanSteps = (JSON.parse(planTreeJson) as unknown[]).length;
    } catch {
      /* abaikan */
    }
    await setStatus("completed", {
      finishedAt: Date.now(),
      currentStep: endedEarly ? Math.min(step, totalPlanSteps) : totalPlanSteps + 1,
      ...(finalAnswer ? { resultText: finalAnswer } : {}),
    });
    emitRunEvent(opts.runId, { type: "done", status: "completed" });
  } catch (e) {
    const gw = toGatewayError(e);
    const msg = `${gw.error} (${gw.code})`;
    // Best-effort: bila penanda `failed` ikut throw (DB locked/disk penuh),
    // run tidak boleh nyangkut `running` selamanya tanpa pemberitahuan.
    try {
      await setStatus("failed", {
        error: msg,
        finishedAt: Date.now(),
      });
      emitRunEvent(opts.runId, {
        type: "error",
        message: msg,
      });
      emitRunEvent(opts.runId, { type: "done", status: "failed" });
    } catch (inner) {
      console.error(
        "[agent] gagal menandai run failed:",
        inner instanceof Error ? inner.message : inner
      );
    }
  } finally {
    clearTimeout(deadlineTimer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}
