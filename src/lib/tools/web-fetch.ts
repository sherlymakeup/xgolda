import { gatewayModel, gatewayPost } from "./gateway.ts";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { arg, num } from "./types.ts";

async function webFetch(args: Record<string, unknown>): Promise<ToolResult> {
  const url = arg(args.url).trim();
  if (!url) return { ok: false, output: "ERROR: 'url' wajib diisi" };
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, output: "ERROR: 'url' harus diawali http:// atau https://" };
  }
  const maxChars = Math.min(Math.max(num(args.max_characters, 6000), 500), 50000);

  const model = await gatewayModel("WEB_FETCH_MODEL");
  const r = await gatewayPost({
    path: "/v1/web/fetch",
    body: { model, url, format: "markdown", max_characters: maxChars },
    timeoutMs: 45000,
  });
  if (!r.ok) return { ok: false, output: `ERROR: ${r.error}` };

  const title = String(r.json?.title ?? "");
  const rawText =
    typeof r.json?.content?.text === "string"
      ? r.json.content.text
      : typeof r.json?.content === "string"
        ? r.json.content
        : "";
  const text = rawText.slice(0, maxChars);
  if (!text) return { ok: false, output: "ERROR: konten kosong dari gateway" };
  return { ok: true, output: title ? `# ${title}\n\n${text}` : text };
}

export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description:
    "Gunakan ketika perlu membaca ISI PENUH sebuah halaman web/URL (artikel, dokumentasi, halaman berita) — mengubah URL menjadi teks markdown. Biasanya dipakai setelah web_search menemukan URL yang relevan. Jangan dipakai untuk file lokal (pakai fs_read_artifact).",
  parameters: {
    url: { type: "string", description: "URL lengkap http(s)://...", required: true },
    max_characters: { type: "number", description: "Batas karakter (default 6000, maks 50000)" },
  },
  handler: async (args) => webFetch(args),
};
