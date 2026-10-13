import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { TOOL_DEFINITIONS, TOOL_MAP, getToolManifest, toOpenAITools } from "../src/lib/tools/registry.ts";
import { webSearchTool } from "../src/lib/tools/web-search.ts";
import { webFetchTool } from "../src/lib/tools/web-fetch.ts";
import { imageGenTool } from "../src/lib/tools/image-gen.ts";
import { ttsTool } from "../src/lib/tools/tts.ts";
import { saveBinaryArtifact } from "../src/lib/tools/gateway.ts";
import { getSessionWorkspace } from "../src/lib/agent/workspace.ts";
import { assertSafePath } from "../src/lib/security/path-jail.ts";
import { getDb } from "../src/db/index.ts";
import { artifacts, sessions } from "../src/db/schema.ts";

/**
 * Hanya jalur validasi (tanpa network/gateway). Dijalankan via:
 *   node --test tests/gateway-tools.test.ts
 */
describe("gateway tools — registrasi", () => {
  it("toOpenAITools: format function calling valid untuk semua tool", () => {
    const tools = toOpenAITools();
    assert.equal(tools.length, TOOL_DEFINITIONS.length);
    for (const t of tools) {
      assert.equal(t.type, "function");
      assert.ok(t.function.name.length > 0);
      assert.ok(t.function.description.length > 0);
      assert.equal(t.function.parameters.type, "object");
      assert.ok(typeof t.function.parameters.properties === "object");
      assert.ok(Array.isArray(t.function.parameters.required));
    }
    // Spot-check: fs_write_artifact wajib punya filename + content
    const w = tools.find((t) => t.function.name === "fs_write_artifact");
    assert.ok(w);
    assert.ok("filename" in w.function.parameters.properties);
    assert.ok("content" in w.function.parameters.properties);
    assert.ok(w.function.parameters.required.includes("filename"));
  });

  it("keempat tool terdaftar di registry", () => {
    for (const name of ["web_search", "web_fetch", "generate_image", "text_to_speech"]) {
      assert.ok(TOOL_MAP[name], `${name} harus ada di TOOL_MAP`);
    }
    assert.equal(TOOL_DEFINITIONS.length >= 10, true);
  });

  it("deskripsi diawali 'Gunakan ketika'", () => {
    for (const t of [webSearchTool, webFetchTool, imageGenTool, ttsTool]) {
      assert.ok(
        t.description.startsWith("Gunakan ketika"),
        `${t.name}: deskripsi harus diawali "Gunakan ketika"`
      );
    }
  });

  it("manifest memuat keempat tool baru", () => {
    const m = getToolManifest();
    for (const name of ["web_search", "web_fetch", "generate_image", "text_to_speech"]) {
      assert.ok(m.includes(name), `manifest harus memuat ${name}`);
    }
  });
});

describe("gateway tools — validasi argumen", () => {
  it("web_search menolak query kosong & search_type invalid", async () => {
    let r = await webSearchTool.handler({}, {});
    assert.equal(r.ok, false);
    assert.match(r.output, /query/);
    r = await webSearchTool.handler({ query: "x", search_type: "video" }, {});
    assert.equal(r.ok, false);
    assert.match(r.output, /search_type/);
  });

  it("web_fetch menolak url kosong & non-http", async () => {
    let r = await webFetchTool.handler({}, {});
    assert.equal(r.ok, false);
    r = await webFetchTool.handler({ url: "ftp://x/y" }, {});
    assert.equal(r.ok, false);
    assert.match(r.output, /http/);
  });

  it("web_fetch menolak host privat/loopback (SSRF)", async () => {
    const cases = [
      "http://127.0.0.1:3000/api/config",
      "http://localhost:3000/",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.1/admin",
      "http://10.0.0.5/",
    ];
    for (const url of cases) {
      const r = await webFetchTool.handler({ url }, {});
      assert.equal(r.ok, false, `${url} harus ditolak`);
      assert.match(r.output, /ditolak|privat/);
    }
  });

  it("generate_image menolak prompt kosong & size invalid", async () => {
    let r = await imageGenTool.handler({}, {});
    assert.equal(r.ok, false);
    r = await imageGenTool.handler({ prompt: "kucing", size: "besar" }, {});
    assert.equal(r.ok, false);
    assert.match(r.output, /size/);
  });

  it("text_to_speech menolak text kosong & kepanjangan", async () => {
    let r = await ttsTool.handler({}, {});
    assert.equal(r.ok, false);
    r = await ttsTool.handler({ text: "a".repeat(4001) }, {});
    assert.equal(r.ok, false);
    assert.match(r.output, /4000/);
  });
});

describe("saveBinaryArtifact — mirror ke workspace thread", () => {
  it("menyalin file generate ke folder workspace sesi (bukan cuma artifacts store)", async () => {
    const sid = `test-mirror-${nanoid(8)}`;
    const filename = `mirror-${nanoid(8)}.mp3`;
    const data = Buffer.from("fake-mp3-bytes");
    try {
      // artifacts.sessionId FK → sessions.id: bikin baris sesi dulu
      const now = Date.now();
      await getDb().insert(sessions).values({ id: sid, createdAt: now, updatedAt: now });
      await saveBinaryArtifact(filename, data, "mp3", sid);

      const wsDir = await getSessionWorkspace(sid);
      const wsFile = path.join(wsDir, filename);
      assert.ok(fs.existsSync(wsFile), "salinan workspace harus ada");
      assert.equal(fs.readFileSync(wsFile).toString(), "fake-mp3-bytes");
      assert.ok(fs.existsSync(assertSafePath(filename)), "copy artifacts store harus ada");
    } finally {
      await getDb().delete(artifacts).where(eq(artifacts.filename, filename));
      await getDb().delete(sessions).where(eq(sessions.id, sid));
      fs.rmSync(assertSafePath(filename), { force: true });
      const wsDir = await getSessionWorkspace(sid);
      fs.rmSync(path.join(wsDir, filename), { force: true });
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
  });

  it("tanpa sessionId tidak menyalin ke workspace (tidak throw)", async () => {
    const filename = `mirror-${nanoid(8)}.mp3`;
    try {
      await saveBinaryArtifact(filename, Buffer.from("x"), "mp3");
      assert.ok(fs.existsSync(assertSafePath(filename)));
    } finally {
      await getDb().delete(artifacts).where(eq(artifacts.filename, filename));
      fs.rmSync(assertSafePath(filename), { force: true });
    }
  });
});
