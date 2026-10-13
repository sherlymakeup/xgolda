"use client";

import { Bot, User } from "lucide-react";
import { renderMarkdown, type ChatMessage } from "@/lib/client-api";
import ThoughtEngine from "./ThoughtEngine";

interface Props {
  message: ChatMessage;
  streaming?: boolean;
  latencyMs?: number;
}

/** Parse attachmentsJson dengan aman → [{id}] (maks 4). */
function parseAttachments(json?: string | null): { id: string }[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.id === "string")
      .slice(0, 4)
      .map((x) => ({ id: x.id as string }));
  } catch {
    return [];
  }
}

export default function MessageItem({ message, streaming, latencyMs }: Props) {
  if (message.role === "user") {
    const atts = parseAttachments(message.attachmentsJson);
    return (
      <div className="rise-in flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-obsidian-800 border border-line-hair px-4 py-3">
          {atts.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {atts.map((a) => (
                <a
                  key={a.id}
                  href={`/api/uploads/${a.id}/raw`}
                  target="_blank"
                  rel="noreferrer"
                  title="Buka gambar di tab baru"
                >
                  <img
                    src={`/api/uploads/${a.id}/raw`}
                    alt="attachment"
                    className="w-24 h-24 rounded-xl object-cover border border-line-soft hover:border-line-mid transition-colors"
                  />
                </a>
              ))}
            </div>
          )}
          {message.content && (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rise-in flex gap-3">
      <div className="w-7 h-7 rounded-lg bg-ink text-void flex items-center justify-center shrink-0 mt-0.5">
        {message.role === "tool" ? <Bot size={14} /> : <span className="font-bold text-xs">X</span>}
      </div>
      <div className="flex-1 min-w-0 space-y-2.5">
        {message.reasoningContent && (
          <ThoughtEngine
            reasoning={message.reasoningContent}
            streaming={!!streaming}
            latencyMs={latencyMs}
          />
        )}
        {message.content ? (
          <div
            className="prose-xgolda text-[15px] text-ink break-words"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        ) : (
          streaming && <span className="text-signal font-mono">▍</span>
        )}
        {streaming && message.content && (
          <span className="text-signal font-mono">▍</span>
        )}
      </div>
    </div>
  );
}

/** Ikon kecil untuk pesan sistem/tool bila dibutuhkan */
export function RoleIcon({ role }: { role: string }) {
  return role === "user" ? <User size={14} /> : <Bot size={14} />;
}
