/**
 * Parser incremental untuk Chain-of-Thought ala DeepSeek-R1.
 * Memisahkan <think>...</think> menjadi stream "reasoning",
 * sisanya menjadi stream "content". Tahan terhadap tag yang
 * terpotong di tengah chunk SSE.
 */

export interface ThinkParseResult {
  reasoning: string;
  content: string;
}

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

export class ThinkStreamParser {
  private buffer = "";
  private inThink = false;

  /**
   * Dorong satu potongan teks mentah dari model.
   * Mengembalikan delta reasoning & content yang sudah pasti.
   */
  push(chunk: string): ThinkParseResult {
    this.buffer += chunk;
    let reasoning = "";
    let content = "";

    for (;;) {
      if (!this.inThink) {
        const openIdx = this.buffer.indexOf(OPEN_TAG);
        if (openIdx === -1) {
          // Mungkin prefix "<thi" di ujung buffer — tahan dulu
          const hold = trailingPartialTag(this.buffer, OPEN_TAG);
          const safe = this.buffer.slice(0, this.buffer.length - hold);
          content += safe;
          this.buffer = this.buffer.slice(this.buffer.length - hold);
          break;
        }
        content += this.buffer.slice(0, openIdx);
        this.buffer = this.buffer.slice(openIdx + OPEN_TAG.length);
        this.inThink = true;
      } else {
        const closeIdx = this.buffer.indexOf(CLOSE_TAG);
        if (closeIdx === -1) {
          const hold = trailingPartialTag(this.buffer, CLOSE_TAG);
          const safe = this.buffer.slice(0, this.buffer.length - hold);
          reasoning += safe;
          this.buffer = this.buffer.slice(this.buffer.length - hold);
          break;
        }
        reasoning += this.buffer.slice(0, closeIdx);
        this.buffer = this.buffer.slice(closeIdx + CLOSE_TAG.length);
        this.inThink = false;
      }
    }
    return { reasoning, content };
  }

  /** Kosongkan sisa buffer di akhir stream. */
  flush(): ThinkParseResult {
    const rest = this.buffer;
    this.buffer = "";
    // Sisa "<thi" yang tidak pernah jadi tag dianggap konten biasa
    return this.inThink ? { reasoning: rest, content: "" } : { reasoning: "", content: rest };
  }
}

/** Panjang suffix buffer yang merupakan prefix dari tag (tag terpotong). */
function trailingPartialTag(buffer: string, tag: string): number {
  const max = Math.min(buffer.length, tag.length - 1);
  for (let len = max; len > 0; len--) {
    if (tag.startsWith(buffer.slice(buffer.length - len))) return len;
  }
  return 0;
}

/** Versi non-streaming: parse seluruh teks sekaligus. */
export function parseThinkTags(text: string): ThinkParseResult {
  const p = new ThinkStreamParser();
  const out = p.push(text);
  const tail = p.flush();
  return {
    reasoning: out.reasoning + tail.reasoning,
    content: out.content + tail.content,
  };
}

export interface ToolCallIntent {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Ekstrak intent pemanggilan tool dari teks model.
 * Format: <toolcall>{"name": "...", "args": {...}}</toolcall>
 * Mengembalikan sisa teks tanpa blok toolcall.
 */
export function extractToolCalls(text: string): {
  calls: ToolCallIntent[];
  cleaned: string;
} {
  const calls: ToolCallIntent[] = [];
  const re = /<toolcall>\s*([\s\S]*?)\s*<\/toolcall>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed.name === "string") {
        calls.push({
          name: parsed.name,
          args:
            parsed.args && typeof parsed.args === "object" ? parsed.args : {},
        });
      }
    } catch {
      // JSON rusak — abaikan blok ini, jangan crash
    }
  }
  const cleaned = text.replace(re, "").trim();
  return { calls, cleaned };
}
