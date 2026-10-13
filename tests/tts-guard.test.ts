/**
 * Guard anti-generate-berulang TTS: 1x sukses maks per run, 1x retry bila gagal.
 * Dijalankan: node --test tests/tts-guard.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MOCK_PORT = 20198;
let mock: ChildProcess;

// Env HARUS di-set sebelum import modul src
process.env.INTERNAL_INFERENCE_ENDPOINT = `http://127.0.0.1:${MOCK_PORT}/v1`;
process.env.AI_GATEWAY_TOKEN = "test-token";

const { ttsTool } = await import("../src/lib/tools/tts.ts");
const { getDb } = await import("../src/db/index.ts");
const { artifacts } = await import("../src/db/schema.ts");
const { eq } = await import("drizzle-orm");

const createdFiles: string[] = [];

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

describe("TTS guard: 1x generate + 1x retry", () => {
  before(async () => {
    mock = spawn("node", ["tests/mock-gateway.mjs", String(MOCK_PORT)], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    await waitForReady(mock);
  });

  after(async () => {
    mock?.kill();
    // Bersihkan artifact test (file + baris DB).
    for (const f of createdFiles) {
      try {
        fs.unlinkSync(path.join(process.cwd(), "storage/artifacts", f));
      } catch {
        /* sudah tidak ada */
      }
      try {
        await getDb().delete(artifacts).where(eq(artifacts.filename, f));
      } catch {
        /* abaikan */
      }
    }
  });

  it("panggilan ke-2 dan ke-3 setelah sukses ditolak (SUDAH berhasil)", async () => {
    const ctx = { runId: "test-tts-sukses" };
    const r1 = await ttsTool.handler({ text: "Halo dunia." }, ctx);
    assert.equal(r1.ok, true);
    const m = r1.output.match(/(tts-[A-Za-z0-9_-]+\.mp3)/);
    assert.ok(m, `nama file harus ada di output: ${r1.output}`);
    createdFiles.push(m[1]);

    const r2 = await ttsTool.handler({ text: "Halo dunia lagi." }, ctx);
    assert.equal(r2.ok, false);
    assert.match(r2.output, /SUDAH berhasil/);

    const r3 = await ttsTool.handler({ text: "Halo dunia ketiga." }, ctx);
    assert.equal(r3.ok, false);
    assert.match(r3.output, /SUDAH berhasil/);
  });

  it("gagal: 1 retry diizinkan, percobaan ke-3 ditolak", async () => {
    const ctx = { runId: "test-tts-gagal" };
    const r1 = await ttsTool.handler({ text: "GAGAL sengaja" }, ctx);
    assert.equal(r1.ok, false);
    assert.doesNotMatch(r1.output, /2x percobaan/);

    const r2 = await ttsTool.handler({ text: "GAGAL sengaja" }, ctx);
    assert.equal(r2.ok, false);
    assert.doesNotMatch(r2.output, /2x percobaan/);

    const r3 = await ttsTool.handler({ text: "GAGAL sengaja" }, ctx);
    assert.equal(r3.ok, false);
    assert.match(r3.output, /2x percobaan/);
  });
});
