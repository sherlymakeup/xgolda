import { nanoid } from "nanoid";
import { gatewayModel, gatewayPost, saveBinaryArtifact } from "./gateway.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";
import { arg } from "./types.ts";

async function generateImage(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const prompt = arg(args.prompt).trim();
  if (!prompt) return { ok: false, output: "ERROR: 'prompt' wajib diisi" };
  const size = arg(args.size, "1024x1024").trim();
  if (!/^\d+x\d+$/.test(size)) {
    return { ok: false, output: "ERROR: 'size' harus format LEBARxTINGGI, mis. 1024x1024" };
  }

  const model = await gatewayModel("IMAGE_MODEL");
  const r = await gatewayPost({
    path: "/v1/images/generations",
    body: { model, prompt, size, response_format: "b64_json" },
    timeoutMs: 120000,
  });
  if (!r.ok) return { ok: false, output: `ERROR: ${r.error}` };

  const b64 = r.json?.data?.[0]?.b64_json;
  if (!b64 || typeof b64 !== "string") {
    return { ok: false, output: "ERROR: gateway tidak mengembalikan gambar (b64_json kosong)" };
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, output: "ERROR: data gambar rusak (base64 tidak valid)" };
  }
  if (buf.length === 0) {
    return { ok: false, output: "ERROR: data gambar kosong" };
  }

  const filename = `img-${nanoid(8)}.png`;
  await saveBinaryArtifact(filename, buf, "png", ctx.sessionId);
  return {
    ok: true,
    output: `Gambar tersimpan: ${filename} (${buf.length} bytes)${ctx.sessionId ? " — salinan ada di folder workspace thread" : ""}. Buka di Artifacts & Studio untuk pratinjau.`,
  };
}

export const imageGenTool: ToolDefinition = {
  name: "generate_image",
  description:
    "Gunakan ketika user meminta dibuatkan gambar, ilustrasi, atau foto (mis. 'buatkan gambar kucing astronot', 'generate image of...'). Menghasilkan gambar PNG via gateway dan menyimpannya sebagai artifact yang bisa dipratinjau di Studio. Jangan dipakai untuk mengedit/membaca gambar yang sudah ada.",
  parameters: {
    prompt: { type: "string", description: "Deskripsi gambar (boleh Inggris agar hasil lebih baik)", required: true },
    size: { type: "string", description: "Ukuran LEBARxTINGGI, mis. 1024x1024 (default)" },
  },
  handler: async (args, ctx) => generateImage(args, ctx),
};
