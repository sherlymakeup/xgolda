/**
 * E2E test dengan mock gateway: streaming client, embedding, agent loop.
 * Dijalankan terpisah: node --test tests/e2e-gateway.test.ts
 * (tidak termasuk dalam `npm test` default agar tidak butuh server)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MOCK_PORT = 20199;
let mock: ChildProcess;

// Env HARUS di-set sebelum import modul src (env.ts dibaca saat load)
process.env.INTERNAL_INFERENCE_ENDPOINT = `http://127.0.0.1:${MOCK_PORT}/v1`;
process.env.AI_GATEWAY_TOKEN = "e2e-test-token";

const { streamChat, chatOnce, getEmbedding } = await import(
  "../src/lib/ai/client.ts"
);
const { runAgentLoop } = await import("../src/lib/agent/engine.ts");
const { getDb } = await import("../src/db/index.ts");
const { addEmbedding, searchSimilar, deleteEmbedding } = await import(
  "../src/db/vector.ts"
);
const { agentRuns, toolExecutions, messages } = await import(
  "../src/db/schema.ts"
);
const { eq } = await import("drizzle-orm");
const { nanoid } = await import("nanoid");

function waitForReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mock timeout")), 8000);
    child.on("message", (m) => {
      if (m === "ready") {
        clearTimeout(t);
        resolve();
      }
    });
    child.on("error", reject);
  });
}

describe("E2E mock gateway", () => {
  before(async () => {
    mock = spawn("node", ["tests/mock-gateway.mjs", String(MOCK_PORT)], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    await waitForReady(mock);
  });

  after(() => {
    mock?.kill();
  });

  it("streamChat: <think> terpotong antar chunk terpisah benar", async () => {
    const events: { type: string; delta?: string }[] = [];
    const { reasoning, content } = await streamChat(
      [{ role: "user", content: "halo" }],
      { onEvent: (e) => void events.push(e) }
    );
    assert.equal(reasoning, "Analisis permintaan pengguna...");
    assert.ok(content.includes("jawaban **streaming**"));
    assert.ok(!content.includes("<think>"), "tag think bocor ke content");
    const types = events.map((e) => e.type);
    assert.ok(types.includes("reasoning"));
    assert.ok(types.includes("content"));
  });

  it("chatOnce: non-stream + strip think", async () => {
    const { reasoning, content } = await chatOnce([
      { role: "user", content: "tes" },
    ]);
    // chatOnce pertama (non-stream, bukan planner) -> skrip final mock
    assert.ok(reasoning.length > 0 || content.length > 0);
    assert.ok(!content.includes("<think>"));
  });

  it("getEmbedding: format OpenAI-compatible", async () => {
    const vec = await getEmbedding("halo dunia");
    assert.deepEqual(vec, [0.1, 0.2, 0.3, 0.4]);
  });

  it("runAgentLoop: plan -> tool -> completed, tercatat di DB", async () => {
    const db = getDb();
    const runId = nanoid();
    const now = Date.now();
    await db.insert(agentRuns).values({
      id: runId,
      goal: "tulis file hello",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    await runAgentLoop({ runId, goal: "tulis file hello" });

    const runs = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    assert.equal(runs[0].status, "completed");
    const plan = JSON.parse(runs[0].planTreeJson);
    assert.ok(Array.isArray(plan) && plan.length === 1);

    const tools = await db
      .select()
      .from(toolExecutions)
      .where(eq(toolExecutions.runId, runId));
    assert.equal(tools.length, 1);
    assert.equal(tools[0].toolName, "fs_write_artifact");

    const filePath = path.resolve(
      process.cwd(),
      "storage",
      "artifacts",
      "e2e-hello.txt"
    );
    assert.ok(fs.existsSync(filePath), "file tool tidak tertulis");
    assert.equal(fs.readFileSync(filePath, "utf8"), "halo dari e2e");

    // Cleanup
    fs.unlinkSync(filePath);
    await db.delete(toolExecutions).where(eq(toolExecutions.runId, runId));
    await db.delete(agentRuns).where(eq(agentRuns.id, runId));
  });

  it("runAgentLoop: gateway tolak tools native (400) -> fallback protokol teks", async () => {
    const db = getDb();
    const runId = nanoid();
    const now = Date.now();
    await db.insert(agentRuns).values({
      id: runId,
      goal: "tolak-tools: tulis file hello",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    await runAgentLoop({ runId, goal: "tolak-tools: tulis file hello" });

    const runs = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    assert.equal(runs[0].status, "completed");

    const tools = await db
      .select()
      .from(toolExecutions)
      .where(eq(toolExecutions.runId, runId));
    assert.equal(tools.length, 1);
    assert.equal(tools[0].toolName, "fs_write_artifact");

    const filePath = path.resolve(
      process.cwd(),
      "storage",
      "artifacts",
      "e2e-hello.txt"
    );
    assert.ok(fs.existsSync(filePath), "file tool tidak tertulis via fallback");
    assert.equal(fs.readFileSync(filePath, "utf8"), "halo dari e2e");

    // Cleanup
    fs.unlinkSync(filePath);
    await db.delete(toolExecutions).where(eq(toolExecutions.runId, runId));
    await db.delete(agentRuns).where(eq(agentRuns.id, runId));
  });

  it("vector: add -> search -> delete", async () => {
    const id = await addEmbedding("dokumen e2e tentang kucing", "e2e");
    const hits = await searchSimilar("kucing", 3);
    assert.ok(hits.length >= 1);
    assert.ok(hits[0].id === id);
    assert.ok(await deleteEmbedding(id));
  });

  it("chatOnce tanpa token: error mapping generik (zero-leak)", async () => {
    delete process.env.AI_GATEWAY_TOKEN;
    // env.gatewayToken() dipanggil per-request -> harus throw ENV_MISSING
    await assert.rejects(
      () => chatOnce([{ role: "user", content: "x" }]),
      /ENV_MISSING/
    );
    process.env.AI_GATEWAY_TOKEN = "e2e-test-token";
  });
});
