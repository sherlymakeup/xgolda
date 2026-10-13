/**
 * Budget riset per run: web_search maks 5x, web_fetch maks 8x.
 * Dijalankan: node --test tests/research-budget.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

const MOCK_PORT = 20196;
let mock: ChildProcess;

// Env HARUS di-set sebelum import modul src
process.env.INTERNAL_INFERENCE_ENDPOINT = `http://127.0.0.1:${MOCK_PORT}/v1`;
process.env.AI_GATEWAY_TOKEN = "test-token";

const { webSearchTool } = await import("../src/lib/tools/web-search.ts");
const { webFetchTool } = await import("../src/lib/tools/web-fetch.ts");

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

describe("Research budget per run", () => {
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

  it("web_search: 5x jalan, ke-6 ditolak (budget habis)", async () => {
    const ctx = { runId: "test-riset-search" };
    for (let i = 1; i <= 5; i++) {
      const r = await webSearchTool.handler({ query: `topik riset ${i}` }, ctx);
      assert.equal(r.ok, true, `panggilan ${i} harus sukses: ${r.output}`);
      assert.match(r.output, /Mock Result/);
    }
    const blocked = await webSearchTool.handler({ query: "topik riset 6" }, ctx);
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /budget web_search habis/);
  });

  it("web_fetch: 8x jalan, ke-9 ditolak (budget habis)", async () => {
    const ctx = { runId: "test-riset-fetch" };
    // IP literal publik → lewati DNS, deterministik (tidak butuh jaringan).
    for (let i = 1; i <= 8; i++) {
      const r = await webFetchTool.handler(
        { url: `https://93.184.216.34/halaman-${i}` },
        ctx
      );
      assert.equal(r.ok, true, `panggilan ${i} harus sukses: ${r.output}`);
      assert.match(r.output, /isi halaman mock/);
    }
    const blocked = await webFetchTool.handler(
      { url: "https://93.184.216.34/halaman-9" },
      ctx
    );
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /budget web_fetch habis/);
  });

  it("budget per run terpisah — run baru dapat budget baru", async () => {
    const r = await webSearchTool.handler({ query: "run lain" }, { runId: "test-riset-lain" });
    assert.equal(r.ok, true);
  });
});
