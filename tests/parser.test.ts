import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ThinkStreamParser,
  extractToolCalls,
  parseThinkTags,
} from "../src/lib/ai/parser.ts";

describe("ThinkStreamParser", () => {
  it("memisahkan think dan content utuh", () => {
    const p = new ThinkStreamParser();
    const a = p.push("Halo <think>menalar dulu</think> dunia");
    const b = p.flush();
    assert.equal(a.reasoning + b.reasoning, "menalar dulu");
    assert.equal(a.content + b.content, "Halo  dunia");
  });

  it("tahan tag terpotong antar chunk", () => {
    const p = new ThinkStreamParser();
    const chunks = ["Hel", "lo <th", "ink>nalar", " dalam</th", "ink> ya"];
    let r = "";
    let c = "";
    for (const ch of chunks) {
      const o = p.push(ch);
      r += o.reasoning;
      c += o.content;
    }
    const t = p.flush();
    assert.equal(r + t.reasoning, "nalar dalam");
    assert.equal(c + t.content, "Hello  ya");
  });

  it("tanpa tag = semua content", () => {
    const out = parseThinkTags("jawaban biasa");
    assert.equal(out.content, "jawaban biasa");
    assert.equal(out.reasoning, "");
  });

  it("think tidak ditutup tetap jadi reasoning", () => {
    const p = new ThinkStreamParser();
    const a = p.push("<think>belum selesai");
    const t = p.flush();
    assert.equal(a.reasoning + t.reasoning, "belum selesai");
    assert.equal(a.content + t.content, "");
  });
});

describe("extractToolCalls", () => {
  it("ekstrak satu toolcall valid", () => {
    const { calls, cleaned } = extractToolCalls(
      'Baik <toolcall>{"name": "fs_list_artifacts", "args": {}}</toolcall> selesai'
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "fs_list_artifacts");
    assert.deepEqual(calls[0].args, {});
    assert.ok(!cleaned.includes("toolcall"));
    assert.ok(cleaned.includes("Baik"));
  });

  it("JSON rusak diabaikan, tidak crash", () => {
    const { calls } = extractToolCalls(
      '<toolcall>{"name": oops}</toolcall> teks'
    );
    assert.equal(calls.length, 0);
  });

  it("tanpa toolcall = kosong", () => {
    const { calls, cleaned } = extractToolCalls("halo dunia");
    assert.equal(calls.length, 0);
    assert.equal(cleaned, "halo dunia");
  });
});
