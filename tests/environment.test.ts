import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectEnvProfile,
  formatEnvBlock,
  getEnvProfile,
} from "../src/lib/agent/environment.ts";
import { systemInfoTool } from "../src/lib/tools/system-info.ts";

describe("environment profile", () => {
  it("collectEnvProfile mengembalikan nilai wajar", async () => {
    const p = await collectEnvProfile();
    assert.ok(p.os.length > 0);
    assert.ok(p.cores >= 1);
    assert.ok(p.ramGB >= 1);
    assert.ok(Array.isArray(p.runtimes));
    // node harus terdeteksi karena test jalan di node
    assert.ok(p.runtimes.some((r) => r.name === "node"));
  });

  it("formatEnvBlock memuat baris kunci", async () => {
    const p = await collectEnvProfile();
    const b = formatEnvBlock(p);
    assert.match(b, /OS:/);
    assert.match(b, /RAM:/);
    assert.match(b, /Runtime\/SDK terdeteksi/);
  });

  it("getEnvProfile memakai cache (panggilan kedua instan)", async () => {
    const a = await getEnvProfile();
    const t0 = Date.now();
    const b = await getEnvProfile();
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(a.os, b.os);
  });

  it("tool system_info jalan tanpa error", async () => {
    const r = await systemInfoTool.handler({}, {});
    assert.equal(r.ok, true);
    assert.match(r.output, /OS:/);
  });
});
