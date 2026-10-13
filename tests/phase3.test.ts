/**
 * Fase 3 "Albi-class": delegate_task, critic, memory, persona.
 * Bagian embedding/memory memakai mock gateway (port 20200).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

const MOCK_PORT = 20200;
let mock: ChildProcess;

// Env HARUS di-set sebelum import modul src
process.env.INTERNAL_INFERENCE_ENDPOINT = `http://127.0.0.1:${MOCK_PORT}/v1`;
process.env.AI_GATEWAY_TOKEN = "test-token";

const { TOOL_DEFINITIONS } = await import("../src/lib/tools/registry.ts");
const { delegateTaskTool } = await import("../src/lib/tools/delegate.ts");
const { rememberTool, recallTool } = await import("../src/lib/tools/memory.ts");
const {
  buildAgentSystemPrompt,
  buildCriticPrompt,
} = await import("../src/lib/ai/prompt-templates.ts");
const { deleteEmbedding } = await import("../src/db/vector.ts");

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

describe("Fase 3", () => {
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

  it("registry punya 14 tools termasuk delegate/memory/system_info", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    assert.equal(TOOL_DEFINITIONS.length, 14);
    assert.ok(names.includes("delegate_task"));
    assert.ok(names.includes("remember"));
    assert.ok(names.includes("recall"));
    assert.ok(names.includes("system_info"));
  });

  it("delegate_task menolak bila batas kedalaman tercapai", async () => {
    const r = await delegateTaskTool.handler({ task: "riset x" }, { depth: 99, runId: "r1" });
    assert.equal(r.ok, false);
    assert.match(r.output, /batas kedalaman delegasi/);
  });

  it("delegate_task menolak task kosong", async () => {
    const r = await delegateTaskTool.handler({ task: "  " }, { depth: 0 });
    assert.equal(r.ok, false);
    assert.match(r.output, /wajib diisi/);
  });

  it("buildCriticPrompt memuat goal + draf", () => {
    const p = buildCriticPrompt("buatkan laporan", "draf jawaban");
    assert.match(p, /buatkan laporan/);
    assert.match(p, /draf jawaban/);
    assert.match(p, /halusinasi/);
  });

  it("system prompt memuat persona + memori", () => {
    const p = buildAgentSystemPrompt("TOOLS", "SKILLS", {
      workspaceDir: "/ws/abc",
      persona: "Panggil user 'bos'.",
      memories: "- User suka kopi tubruk",
    });
    assert.match(p, /Panggil user 'bos'/);
    assert.match(p, /User suka kopi tubruk/);
    assert.match(p, /\/ws\/abc/);
    assert.match(p, /DILARANG mengakses file di luar/);
  });

  it("remember → recall menemukan fakta", async () => {
    const fact = `Fakta unik fase3 ${Date.now()}: user alergi udang`;
    const w = await rememberTool.handler({ fact }, { sessionId: "s1" });
    assert.equal(w.ok, true);

    const r = await recallTool.handler({ query: "alergi makanan user apa" }, {});
    assert.equal(r.ok, true);
    assert.match(r.output, /alergi udang/);

    // Bersihkan: ambil id via recall lalu hapus
    const { searchSimilar } = await import("../src/db/vector.ts");
    const hits = await searchSimilar("alergi udang", 5);
    for (const h of hits.filter((x) => x.text.includes("Fakta unik fase3"))) {
      await deleteEmbedding(h.id);
    }
  });

  it("remember menolak fakta kosong / terlalu panjang", async () => {
    const e1 = await rememberTool.handler({ fact: "  " }, {});
    assert.equal(e1.ok, false);
    const e2 = await rememberTool.handler({ fact: "x".repeat(2001) }, {});
    assert.equal(e2.ok, false);
  });
});
