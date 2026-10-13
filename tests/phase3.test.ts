/**
 * Fase 3 "Albi-class": delegate_task, critic, memory, persona.
 * Bagian embedding/memory memakai mock gateway (port 20200).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const MOCK_PORT = 20200;
let mock: ChildProcess;

// Env HARUS di-set sebelum import modul src
process.env.INTERNAL_INFERENCE_ENDPOINT = `http://127.0.0.1:${MOCK_PORT}/v1`;
process.env.AI_GATEWAY_TOKEN = "test-token";

const { TOOL_DEFINITIONS } = await import("../src/lib/tools/registry.ts");
const { delegateTaskTool } = await import("../src/lib/tools/delegate.ts");
const { rememberTool, recallTool, forgetMemoryTool } = await import("../src/lib/tools/memory.ts");
const { filterRelevantMemories } = await import("../src/lib/tools/memory.ts");
const {
  buildAgentSystemPrompt,
  buildPlannerPrompt,
  deriveStyleHint,
} = await import("../src/lib/ai/prompt-templates.ts");
const { verifyFinalAnswer } = await import("../src/lib/agent/verify.ts");
const {
  extractFilenames,
  isCreateGoal,
  missingOnDisk,
} = await import("../src/lib/agent/verify.ts");
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

  it("registry punya 15 tools termasuk delegate/memory/forget_memory/system_info", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    assert.equal(TOOL_DEFINITIONS.length, 15);
    assert.ok(names.includes("delegate_task"));
    assert.ok(names.includes("remember"));
    assert.ok(names.includes("recall"));
    assert.ok(names.includes("forget_memory"));
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

  it("verifyFinalAnswer: klaim file tanpa bukti ditandai belum terverifikasi", () => {
    const out = verifyFinalAnswer("spec.md sudah disusun berisi OS dan CPU.", {
      written: [],
      succeeded: ["system_info"],
      failed: [],
    });
    assert.match(out, /belum terverifikasi/);
    assert.match(out, /sudah disusun/); // isi draf dipertahankan
  });

  it("verifyFinalAnswer: klaim gagal palsu diganti laporan fakta", () => {
    const out = verifyFinalAnswer(
      "Tool belum mengembalikan hasil, jadi test.md belum bisa dipastikan.",
      { written: ["test.md"], succeeded: ["fs_write_artifact"], failed: [] }
    );
    assert.match(out, /Selesai/);
    assert.match(out, /test\.md/);
    assert.doesNotMatch(out, /belum bisa dipastikan/);
  });

  it("verifyFinalAnswer: klaim gagal DIBIARKAN bila ada tool yang gagal (kasus 2)", () => {
    // system_info sukses + fs_write gagal + draf jujur "gagal" → jangan
    // ditimpa jadi "Selesai" palsu.
    const out = verifyFinalAnswer("Maaf, gagal menulis file.", {
      written: [],
      succeeded: ["system_info"],
      failed: ["fs_write_artifact: ERROR: disk penuh"],
    });
    assert.match(out, /gagal menulis file/);
    assert.doesNotMatch(out, /^Selesai/);
  });

  it("verifyFinalAnswer: klaim file via terminal tapi ADA di disk → dibiarkan", () => {
    const out = verifyFinalAnswer(
      "Perintah terminal sudah dijalankan untuk: Membuat test.md, Membaca ulang isi file.",
      { written: [], succeeded: ["terminal_exec"], failed: [], diskFiles: ["test.md"] }
    );
    assert.doesNotMatch(out, /belum terverifikasi/);
    assert.match(out, /Membuat test\.md/);
  });

  it("verifyFinalAnswer: klaim 'Membuat test.md' tapi TIDAK ada di disk → dikoreksi", () => {
    const out = verifyFinalAnswer(
      "Perintah terminal sudah dijalankan untuk: Membuat test.md.",
      { written: [], succeeded: ["terminal_exec"], failed: [], diskFiles: [] }
    );
    assert.match(out, /belum terverifikasi/);
  });

  it("extractFilenames + isCreateGoal + missingOnDisk (disk = ground truth)", () => {
    assert.deepEqual(extractFilenames("buat sebuah file test.md untuk tes"), ["test.md"]);
    assert.equal(isCreateGoal("buat sebuah file test.md untuk tes"), true);
    assert.equal(isCreateGoal("baca file test.md yang sudah ada"), false);
    // folder sementara: file ada vs tidak ada
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xgolda-verify-"));
    fs.writeFileSync(path.join(tmp, "test.md"), "x");
    assert.deepEqual(missingOnDisk(["test.md"], tmp), []);
    assert.deepEqual(missingOnDisk(["hilang.md"], tmp), ["hilang.md"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("verifyFinalAnswer: draf jujur dibiarkan apa adanya", () => {
    const draft = "test.md sudah dibuat di folder workspace.";
    const out = verifyFinalAnswer(draft, {
      written: ["test.md"],
      succeeded: ["fs_write_artifact"],
      failed: [],
    });
    assert.equal(out, draft);
    const honest = verifyFinalAnswer("Maaf bos, fs_write gagal karena path tidak valid.", {
      written: [],
      succeeded: [],
      failed: ["fs_write_artifact: ERROR path"],
    });
    assert.equal(honest, "Maaf bos, fs_write gagal karena path tidak valid.");
  });

  it("system prompt agen + planner memuat tanggal hari ini (anti-tebak tanggal)", () => {
    const today = new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());
    const agent = buildAgentSystemPrompt("TOOLS", "SKILLS", {
      workspaceDir: "/ws/abc",
    });
    assert.match(agent, /Hari ini:/);
    assert.ok(agent.includes(today), `agent prompt harus memuat ${today}`);
    const planner = buildPlannerPrompt("tulis file");
    assert.ok(planner.includes(today), `planner prompt harus memuat ${today}`);
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

  it("filterRelevantMemories: floor + margin relatif + dedup", () => {
    const hits = [
      { id: "a", text: "User suka kopi tubruk", score: 0.9, source: null },
      { id: "b", text: "user  SUKA kopi tubruk!", score: 0.85, source: null },
      { id: "c", text: "User alergi udang", score: 0.8, source: null },
      { id: "d", text: "Cuaca hari ini cerah", score: 0.4, source: null },
      { id: "e", text: "Noise rendah", score: 0.2, source: null },
    ];
    // cutoff = max(0.35, 0.9 - 0.15) = 0.75 → b dedup, d ekor, e di bawah floor
    assert.deepEqual(
      filterRelevantMemories(hits).map((h) => h.id),
      ["a", "c"]
    );
    // Tanpa hit kuat, floor yang berlaku: 0.5 & 0.45 lolos, 0.3 tidak
    const low = [
      { id: "x", text: "Satu", score: 0.5, source: null },
      { id: "y", text: "Dua", score: 0.45, source: null },
      { id: "z", text: "Tiga", score: 0.3, source: null },
    ];
    assert.deepEqual(
      filterRelevantMemories(low).map((h) => h.id),
      ["x", "y"]
    );
  });

  it("remember dedup: fakta sama (beda kapital/spasi) tidak disimpan 2x", async () => {
    const fact = `Fakta dedup fase3 ${Date.now()}: user minum kopi tubruk`;
    try {
      const w1 = await rememberTool.handler({ fact }, { sessionId: "s1" });
      assert.equal(w1.ok, true);
      assert.match(w1.output, /tersimpan/);
      const w2 = await rememberTool.handler(
        { fact: `  ${fact.toUpperCase()}  ` },
        { sessionId: "s1" }
      );
      assert.equal(w2.ok, true);
      assert.match(w2.output, /sudah ada/);
    } finally {
      const { searchSimilar } = await import("../src/db/vector.ts");
      const hits = await searchSimilar("Fakta dedup fase3", 20);
      for (const h of hits.filter((x) => x.text.includes("Fakta dedup fase3"))) {
        await deleteEmbedding(h.id);
      }
    }
  });

  it("forget_memory by id (awalan 8 karakter) menghapus memori", async () => {
    const fact = `Fakta forget-id fase3 ${Date.now()}: user tidak suka pedas`;
    const { searchSimilar } = await import("../src/db/vector.ts");
    try {
      const w = await rememberTool.handler({ fact }, { sessionId: "s1" });
      assert.equal(w.ok, true);
      const hits = await searchSimilar("Fakta forget-id fase3", 20);
      const target = hits.find((h) => h.text.includes("Fakta forget-id fase3"));
      assert.ok(target, "memori harus ketemu setelah remember");
      const del = await forgetMemoryTool.handler({ id: target.id.slice(0, 8) }, {});
      assert.equal(del.ok, true);
      const after = await searchSimilar("Fakta forget-id fase3", 20);
      assert.ok(!after.some((h) => h.text.includes("Fakta forget-id fase3")));
    } finally {
      const hits = await searchSimilar("Fakta forget-id fase3", 20);
      for (const h of hits.filter((x) => x.text.includes("Fakta forget-id fase3"))) {
        await deleteEmbedding(h.id);
      }
    }
  });

  it("forget_memory by query menghapus hit terbaik yang relevan", async () => {
    const fact = `Fakta forget-q fase3 ${Date.now()}: user alergi kacang`;
    const { searchSimilar } = await import("../src/db/vector.ts");
    try {
      await rememberTool.handler({ fact }, { sessionId: "s1" });
      const del = await forgetMemoryTool.handler(
        { query: "Fakta forget-q fase3 alergi kacang" },
        {}
      );
      assert.equal(del.ok, true);
      assert.match(del.output, /dihapus/);
      const after = await searchSimilar("Fakta forget-q fase3", 20);
      assert.ok(!after.some((h) => h.text.includes("Fakta forget-q fase3")));
    } finally {
      const hits = await searchSimilar("Fakta forget-q fase3", 20);
      for (const h of hits.filter((x) => x.text.includes("Fakta forget-q fase3"))) {
        await deleteEmbedding(h.id);
      }
    }
  });

  it("recall output menyertakan id (untuk forget_memory)", async () => {
    const fact = `Fakta recall-id fase3 ${Date.now()}: user suka teh melati`;
    const { searchSimilar } = await import("../src/db/vector.ts");
    try {
      await rememberTool.handler({ fact }, { sessionId: "s1" });
      const r = await recallTool.handler({ query: "Fakta recall-id fase3 teh melati" }, {});
      assert.equal(r.ok, true);
      assert.match(r.output, /teh melati/);
      assert.match(r.output, /\[id:[A-Za-z0-9_-]{8,}\]/);
    } finally {
      const hits = await searchSimilar("Fakta recall-id fase3", 20);
      for (const h of hits.filter((x) => x.text.includes("Fakta recall-id fase3"))) {
        await deleteEmbedding(h.id);
      }
    }
  });

  it("deriveStyleHint: bahasa + singkat + mendalam", () => {
    assert.match(deriveStyleHint("create a file for me please"), /Bahasa Inggris/);
    assert.doesNotMatch(deriveStyleHint("buatkan file laporan"), /Bahasa Inggris/);
    assert.doesNotMatch(deriveStyleHint("tolong create file"), /Bahasa Inggris/);
    assert.match(deriveStyleHint("halo bos"), /singkat/);
    const deep = deriveStyleHint("jelaskan detail cara kerja mesin ini secara lengkap");
    assert.match(deep, /mendalam/);
    assert.doesNotMatch(deep, /singkat/);
  });

  it("system prompt memuat styleHint adaptif", () => {
    const p = buildAgentSystemPrompt("TOOLS", "SKILLS", {
      workspaceDir: "/ws/abc",
      persona: "Panggil user 'bos'.",
      styleHint: "User menulis dalam Bahasa Inggris — jawab dalam Bahasa Inggris.",
    });
    assert.match(p, /PENYESUAIAN GAYA/);
    assert.match(p, /Bahasa Inggris/);
  });
});
