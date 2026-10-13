import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { messages } from "../../db/schema.ts";
import type { ChatMessage, ContentPart } from "../ai/client.ts";
import { CHAT_SYSTEM_PROMPT } from "../ai/prompt-templates.ts";

const MAX_MESSAGES = 40;
const MAX_CHARS = 24000;
const UPLOADS_DIR = path.resolve(process.cwd(), "storage", "uploads");
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Ubah lampiran gambar → data URI untuk vision model. */
function attachmentToDataUrl(id: string): string | null {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) return null;
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    const p = path.join(UPLOADS_DIR, `${id}.${ext}`);
    if (fs.existsSync(p)) {
      const b64 = fs.readFileSync(p).toString("base64");
      return `data:${mime};base64,${b64}`;
    }
  }
  return null;
}

function parseAttachments(raw: string): { id: string }[] {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.filter((a) => a && typeof a.id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Sliding-window session memory: ambil N pesan terakhir,
 * potong agar total karakter dalam budget.
 */
export async function buildChatContext(
  sessionId: string,
  systemPrompt: string = CHAT_SYSTEM_PROMPT
): Promise<ChatMessage[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_MESSAGES);

  const chronological = rows.reverse();
  const chatMessages: ChatMessage[] = [];
  let chars = 0;

  for (const m of chronological) {
    if (m.role === "tool") continue;
    const role = m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
    let content: string | ContentPart[] = m.content;
    // Sertakan reasoning asisten sebagai konteks ringkas bila ada
    if (m.role === "assistant" && m.reasoningContent) {
      content = `[penalaran sebelumnya: ${m.reasoningContent.slice(0, 800)}]\n${m.content}`;
    }
    // Vision: lampiran gambar → content parts (data URI)
    if (m.role === "user") {
      const atts = parseAttachments(m.attachmentsJson || "[]");
      const parts: ContentPart[] = [{ type: "text", text: m.content }];
      for (const a of atts.slice(0, 4)) {
        const url = attachmentToDataUrl(a.id);
        if (url) parts.push({ type: "image_url", image_url: { url } });
      }
      if (parts.length > 1) content = parts;
    }
    const contentLen = typeof content === "string" ? content.length : m.content.length + 2000;
    if (chars + contentLen > MAX_CHARS) {
      // Potong pesan terlama dulu: hentikan penambahan dari awal
      // (karena chronological, kita skip pesan ini dan lanjut — jaga urutan)
      continue;
    }
    chars += contentLen;
    chatMessages.push({ role, content });
  }

  return [{ role: "system", content: systemPrompt }, ...chatMessages];
}

/** Batas total karakter ringkasan history di prompt langkah (bukan cuma per-entri). */
const MAX_HISTORY_CHARS = 12000;

/** Ringkas riwayat eksekusi tool menjadi teks untuk prompt langkah agen. */
export function summarizeToolHistory(
  executions: { toolName: string; argsJson: string; resultJson: string; ok: boolean }[]
): string {
  if (executions.length === 0) return "";
  const parts = executions.map((e, i) => {
    const out = e.resultJson.slice(0, 1500);
    // Output tool dibungkus delimiter eksplisit: isinya DATA tak tepercaya,
    // bukan instruksi (anti prompt injection — lihat aturan 11 system prompt).
    return `[${i + 1}] ${e.toolName}(${e.argsJson.slice(0, 300)}) => ${e.ok ? "OK" : "GAGAL"}\n<tool-output>\n${out}\n</tool-output>`;
  });
  // Potong entri TERLAMA dulu sampai dalam budget (paling baru dipertahankan).
  let total = parts.reduce((s, p) => s + p.length, 0);
  let start = 0;
  while (total > MAX_HISTORY_CHARS && start < parts.length - 1) {
    total -= parts[start].length;
    start++;
  }
  const kept = parts.slice(start);
  return (
    (start > 0 ? `[... ${start} entri tool awal dipotong agar prompt tetap ringkas ...]\n\n` : "") +
    kept.join("\n\n")
  );
}
