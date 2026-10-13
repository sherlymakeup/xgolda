import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listWorkspaceFiles } from "../src/lib/workspace-files.ts";
import {
  mimeForFile,
  previewKind,
  formatSize,
} from "../src/lib/file-meta.ts";

describe("workspace-files", () => {
  let tmp = "";
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
    fs.writeFileSync(path.join(tmp, "test.md"), "# halo");
    fs.writeFileSync(path.join(tmp, "data.json"), "{}");
    fs.mkdirSync(path.join(tmp, "sub"));
    fs.writeFileSync(path.join(tmp, "sub", "foto.png"), "PNGDATA");
  });
  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("listWorkspaceFiles menemukan file rekursif", () => {
    const files = listWorkspaceFiles(tmp);
    const paths = files.map((f) => f.path).sort();
    assert.deepEqual(paths, ["data.json", "sub/foto.png", "test.md"]);
    assert.ok(files.every((f) => f.size > 0 && f.mtime > 0));
  });

  it("listWorkspaceFiles aman untuk folder tak ada", () => {
    assert.deepEqual(listWorkspaceFiles(path.join(tmp, "tak-ada")), []);
  });

  it("mimeForFile + previewKind", () => {
    assert.equal(mimeForFile("a.md"), "text/plain; charset=utf-8");
    assert.equal(mimeForFile("a.PNG"), "image/png");
    assert.equal(mimeForFile("a.mp3"), "audio/mpeg");
    assert.equal(mimeForFile("a.xyz"), "application/octet-stream");
    assert.equal(previewKind("a.md"), "text");
    assert.equal(previewKind("a.png"), "image");
    assert.equal(previewKind("a.mp3"), "audio");
    assert.equal(previewKind("a.mp4"), "video");
    assert.equal(previewKind("a.zip"), "other");
  });

  it("formatSize", () => {
    assert.equal(formatSize(500), "500 B");
    assert.equal(formatSize(2048), "2.0 KB");
    assert.equal(formatSize(3 * 1024 * 1024), "3.0 MB");
  });
});
