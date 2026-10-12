import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { messages } from "../../db/schema.ts";
import type { ChatMessage } from "../ai/client.ts";
import { CHAT_SYSTEM_PROMPT } from "../ai/prompt-templates.ts";

const MAX_MESSAGES = 40;
const MAX_CHARS = 24000;

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
    let content = m.content;
    // Sertakan reasoning asisten sebagai konteks ringkas bila ada
    if (m.role === "assistant" && m.reasoningContent) {
      content = `[penalaran sebelumnya: ${m.reasoningContent.slice(0, 800)}]\n${content}`;
    }
    if (chars + content.length > MAX_CHARS) {
      // Potong pesan terlama dulu: hentikan penambahan dari awal
      // (karena chronological, kita skip pesan ini dan lanjut — jaga urutan)
      continue;
    }
    chars += content.length;
    chatMessages.push({ role, content });
  }

  return [{ role: "system", content: systemPrompt }, ...chatMessages];
}

/** Ringkas riwayat eksekusi tool menjadi teks untuk prompt langkah agen. */
export function summarizeToolHistory(
  executions: { toolName: string; argsJson: string; resultJson: string; ok: boolean }[]
): string {
  if (executions.length === 0) return "";
  return executions
    .map((e, i) => {
      const out = e.resultJson.slice(0, 1500);
      return `[${i + 1}] ${e.toolName}(${e.argsJson.slice(0, 300)}) => ${e.ok ? "OK" : "GAGAL"}\n${out}`;
    })
    .join("\n\n");
}
