import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TOOL_DEFINITIONS, TOOL_MAP, getToolManifest } from "../src/lib/tools/registry.ts";
import { webSearchTool } from "../src/lib/tools/web-search.ts";
import { webFetchTool } from "../src/lib/tools/web-fetch.ts";
import { imageGenTool } from "../src/lib/tools/image-gen.ts";
import { ttsTool } from "../src/lib/tools/tts.ts";

/**
 * Hanya jalur validasi (tanpa network/gateway). Dijalankan via:
 *   node --test tests/gateway-tools.test.ts
 */
describe("gateway tools — registrasi", () => {
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
