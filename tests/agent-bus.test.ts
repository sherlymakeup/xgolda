import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitRunEvent, subscribeRun, type RunEvent } from "../src/lib/agent/bus.ts";
import fs from "node:fs";
import path from "node:path";

describe("agent bus (SSE)", () => {
  it("subscribe menerima event yang di-emit ke runId yang sama", () => {
    const got: RunEvent[] = [];
    const unsub = subscribeRun("run-1", (e) => got.push(e));
    emitRunEvent("run-1", { type: "token", text: "halo" });
    emitRunEvent("run-1", { type: "token", text: " bos" });
    emitRunEvent("run-2", { type: "token", text: "jangan sampai sini" });
    assert.equal(got.length, 2);
    assert.deepEqual(got[0], { type: "token", text: "halo" });
    unsub();
  });

  it("unsubscribe berhenti menerima", () => {
    const got: RunEvent[] = [];
    const unsub = subscribeRun("run-x", (e) => got.push(e));
    unsub();
    emitRunEvent("run-x", { type: "token", text: "x" });
    assert.equal(got.length, 0);
  });

  it("emit ke runId tanpa subscriber tidak error", () => {
    assert.doesNotThrow(() => emitRunEvent("tak-ada", { type: "done", status: "completed" }));
  });

  it("listener yang throw tidak merusak emit lain", () => {
    const got: RunEvent[] = [];
    const u1 = subscribeRun("run-e", () => {
      throw new Error("rusak");
    });
    const u2 = subscribeRun("run-e", (e) => got.push(e));
    emitRunEvent("run-e", { type: "final", text: "ok" });
    assert.equal(got.length, 1);
    u1();
    u2();
  });
});

describe("migrasi 0006", () => {
  it("file migrasi run_id ada dan menambahkan kolomnya", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "drizzle/0006_stormy_stryfe.sql"),
      "utf8"
    );
    assert.match(sql, /ADD.*run_id/i);
  });
});
