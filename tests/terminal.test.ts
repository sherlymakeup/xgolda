import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { terminalExecTool } from "../src/lib/tools/terminal.ts";

const IS_WIN = process.platform === "win32";

describe("terminal_exec", () => {
  it("menjalankan perintah & menangkap stdout", async () => {
    const r = await terminalExecTool.handler(
      { command: IS_WIN ? "Write-Output 'halo bos'" : "echo 'halo bos'" },
      {}
    );
    assert.equal(r.ok, true);
    assert.match(r.output, /halo bos/);
    assert.match(r.output, /exit_code=0/);
  });

  it("exit code non-nol → ok:false", async () => {
    const r = await terminalExecTool.handler(
      { command: IS_WIN ? "exit 3" : "exit 3" },
      {}
    );
    assert.equal(r.ok, false);
    assert.match(r.output, /exit_code=3/);
  });

  it("command kosong ditolak", async () => {
    const r = await terminalExecTool.handler({ command: "   " }, {});
    assert.equal(r.ok, false);
    assert.match(r.output, /wajib diisi/);
  });

  it("cwd absolut di luar workspace ditolak (jail)", async () => {
    const r = await terminalExecTool.handler(
      { command: "echo x", cwd: "/jalan/yang/tidak/ada/xyz123" },
      {}
    );
    assert.equal(r.ok, false);
    assert.match(r.output, /ACCESS_DENIED/);
  });

  it("cwd relatif yang tidak ada tetap ditolak", async () => {
    const r = await terminalExecTool.handler(
      { command: "echo x", cwd: "tidak-ada-xyz123" },
      {}
    );
    assert.equal(r.ok, false);
    assert.match(r.output, /cwd tidak ada/);
  });

  it("timeout membunuh proses", async () => {
    const cmd = IS_WIN
      ? "Start-Sleep -Seconds 30"
      : "sleep 30";
    const t0 = Date.now();
    const r = await terminalExecTool.handler(
      { command: cmd, timeoutMs: 2500 },
      {}
    );
    const dt = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.match(r.output, /TIMEOUT/);
    assert.ok(dt < 15000, `kill terlalu lama: ${dt}ms`);
  });

  it("env secret TIDAK diwariskan ke child", async () => {
    process.env.XGOLDA_TEST_TOKEN = "rahasia-123";
    try {
      const cmd = IS_WIN
        ? "Write-Output \"tok=$env:XGOLDA_TEST_TOKEN\""
        : "echo \"tok=$XGOLDA_TEST_TOKEN\"";
      const r = await terminalExecTool.handler({ command: cmd }, {});
      assert.ok(
        !r.output.includes("rahasia-123"),
        "token bocor ke output child!"
      );
    } finally {
      delete process.env.XGOLDA_TEST_TOKEN;
    }
  });

  it("perintah multi-baris / pipe jalan (shell beneran)", async () => {
    const cmd = IS_WIN
      ? "Write-Output 'a'; Write-Output 'b'"
      : "echo a; echo b";
    const r = await terminalExecTool.handler({ command: cmd }, {});
    assert.equal(r.ok, true);
    assert.match(r.output, /a/);
    assert.match(r.output, /b/);
  });
});
