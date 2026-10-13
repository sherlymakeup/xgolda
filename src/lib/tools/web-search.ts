import { gatewayModel, gatewayPost } from "./gateway.ts";
import type { ToolDefinition, ToolResult } from "./types.ts";
import { arg, num } from "./types.ts";

async function webSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const query = arg(args.query).trim();
  if (!query) return { ok: false, output: "ERROR: 'query' wajib diisi" };
  const maxResults = Math.min(Math.max(num(args.max_results, 5), 1), 20);
  const searchType = arg(args.search_type, "web").toLowerCase();
  if (searchType !== "web" && searchType !== "news") {
    return { ok: false, output: "ERROR: 'search_type' harus 'web' atau 'news'" };
  }

  const model = await gatewayModel("WEB_SEARCH_MODEL");
  const r = await gatewayPost({
    path: "/v1/search",
    body: { model, query, max_results: maxResults, search_type: searchType },
    timeoutMs: 30000,
  });
  if (!r.ok) return { ok: false, output: `ERROR: ${r.error}` };

  const items: unknown[] = Array.isArray(r.json?.results) ? r.json.results : [];
  const results = items.slice(0, 8).map((it: any) => ({
    title: String(it?.title ?? ""),
    url: String(it?.url ?? ""),
    snippet: String(it?.snippet ?? it?.content ?? "").slice(0, 300),
  }));
  if (results.length === 0) return { ok: true, output: "Tidak ada hasil." };

  const lines = results.map(
    (x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`
  );
  return { ok: true, output: lines.join("\n") };
}

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Gunakan ketika user meminta berita terkini, riset internet, atau data dari web (mis. 'cari berita tentang X', 'riset harga Y'). Mencari di web via gateway dan mengembalikan judul, URL, dan cuplikan. Untuk membaca ISI PENUH sebuah halaman dari hasil ini, lanjutkan dengan web_fetch.",
  parameters: {
    query: { type: "string", description: "Kata kunci pencarian", required: true },
    max_results: { type: "number", description: "Jumlah hasil, 1-20 (default 5)" },
    search_type: { type: "string", description: "'web' atau 'news' (default 'web')" },
  },
  handler: async (args) => webSearch(args),
};
