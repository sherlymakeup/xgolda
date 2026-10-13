import dns from "node:dns/promises";
import { gatewayModel, gatewayPost } from "./gateway.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";
import { arg, num } from "./types.ts";
import { checkCallBudget } from "./call-budget.ts";

/** Apakah IP ini privat/loopback/link-local/reserved (tidak boleh di-fetch). */
function isPrivateIP(ip: string): boolean {
  // IPv6
  if (ip.includes(":")) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb")) return true; // fe80::/10
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // fc00::/7
    // ::ffff:a.b.c.d → cek bagian IPv4-nya
    const m = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIP(m[1]);
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local (metadata cloud!)
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && (b === 0 || b === 168)) || // 192.0.0.0/24 + 192.168/16
    (a === 198 && (b === 18 || b === 19 || b === 51)) || // benchmarking + TEST-NET-2
    (a === 203 && b === 0) || // TEST-NET-3
    a >= 224 // multicast + reserved
  );
}

/**
 * Tolak hostname yang mengarah ke jaringan privat/loopback/link-local
 * (SSRF: admin router, metadata cloud 169.254.169.254, localhost).
 * Lapisan XGOLDA saja — gateway sebaiknya juga memfilter (TOCTOU/DNS
 * rebinding tidak bisa dicegah total dari sisi ini). DNS gagal/timeout
 * → fail-closed (tolak), karena fetch-nya juga akan gagal.
 */
async function isPrivateHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (isPrivateIP(host)) return true;
  try {
    const addrs = await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS_TIMEOUT")), 3000)
      ),
    ]);
    return addrs.some((a) => isPrivateIP(a.address));
  } catch {
    return true; // DNS gagal/timeout → tolak (fail-closed)
  }
}

async function webFetch(args: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult> {
  const url = arg(args.url).trim();
  if (!url) return { ok: false, output: "ERROR: 'url' wajib diisi" };
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, output: "ERROR: 'url' harus diawali http:// atau https://" };
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, output: "ERROR: 'url' tidak valid" };
  }
  if (await isPrivateHost(hostname)) {
    return {
      ok: false,
      output: `ERROR: host '${hostname}' ditolak (privat/loopback/tidak dapat di-resolve) — web_fetch hanya untuk URL publik.`,
    };
  }
  // Budget riset per run (maks 8x) — URL yang ditolak SSRF di atas tidak menghabiskan budget.
  const blocked = checkCallBudget("web_fetch", ctx);
  if (blocked) return { ok: false, output: blocked };
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
    "Gunakan ketika perlu membaca ISI PENUH sebuah halaman web/URL (artikel, dokumentasi, halaman berita) — mengubah URL menjadi teks markdown. Biasanya dipakai setelah web_search menemukan URL yang relevan. Jangan dipakai untuk file lokal (pakai fs_read_artifact). Budget: maks 8x panggilan per goal — fetch hanya halaman yang benar-benar relevan, jangan fetch berulang tanpa henti.",
  parameters: {
    url: { type: "string", description: "URL lengkap http(s)://...", required: true },
    max_characters: { type: "number", description: "Batas karakter (default 6000, maks 50000)" },
  },
  handler: async (args, ctx) => webFetch(args, ctx),
};
