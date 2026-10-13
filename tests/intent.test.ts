import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksLikeTask } from "../src/lib/intent.ts";

describe("looksLikeTask", () => {
  it("mendeteksi perintah eksekusi bahasa Indonesia", () => {
    assert.equal(looksLikeTask("Buatkan folder MARKO di folder Documents"), true);
    assert.equal(looksLikeTask("tolong buatkan file laporan.txt"), true);
    assert.equal(looksLikeTask("jalankan npm run build"), true);
    assert.equal(looksLikeTask("hapus file sampah di /tmp"), true);
    assert.equal(looksLikeTask("cari file yang namanya config"), true);
    assert.equal(looksLikeTask("download video dari url ini"), true);
  });

  it("mendeteksi perintah eksekusi bahasa Inggris", () => {
    assert.equal(looksLikeTask("create a react component"), true);
    assert.equal(looksLikeTask("Run the tests"), true);
    assert.equal(looksLikeTask("install express"), true);
    assert.equal(looksLikeTask("please delete this file"), true);
  });

  it("tidak menganggap pertanyaan sebagai task", () => {
    assert.equal(looksLikeTask("Jelaskan cara kerja Chain-of-Thought"), false);
    assert.equal(looksLikeTask("apa itu vector database?"), false);
    assert.equal(looksLikeTask("kenapa build-nya gagal?"), false);
    assert.equal(looksLikeTask("bagaimana cara membuat folder di powershell?"), false);
    assert.equal(looksLikeTask("What is RAG?"), false);
  });

  it("menangani string kosong dan filler", () => {
    assert.equal(looksLikeTask(""), false);
    assert.equal(looksLikeTask("   "), false);
    assert.equal(looksLikeTask("coba carikan file lama"), true);
  });
});
