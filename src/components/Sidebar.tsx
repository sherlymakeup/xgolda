"use client";

import { MessageSquarePlus, Trash2, X } from "lucide-react";
import type { Session } from "@/lib/client-api";

interface Props {
  sessions: Session[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  open,
  onClose,
}: Props) {
  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed md:static z-40 h-full w-[260px] shrink-0 border-r border-line-hair bg-obsidian-950 flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-ink text-void flex items-center justify-center font-bold text-sm">
              X
            </div>
            <span className="font-semibold tracking-tight">XGOLDA</span>
          </div>
          <button
            onClick={onClose}
            className="md:hidden w-7 h-7 flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-obsidian-800"
            aria-label="Tutup sidebar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={onNew}
            className="w-full flex items-center gap-2 rounded-xl border border-line-hair bg-obsidian-950 hover:bg-obsidian-850 hover:border-line-soft px-3 py-2.5 text-sm text-ink transition-colors"
          >
            <MessageSquarePlus size={16} className="text-ink-mute" />
            Chat baru
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {sessions.length === 0 && (
            <p className="px-3 py-6 text-xs text-ink-faint leading-relaxed">
              Belum ada percakapan.
              <br />
              Mulai dari Omnibox di bawah.
            </p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-1 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
                s.id === activeId
                  ? "bg-obsidian-800 text-ink"
                  : "text-ink-mute hover:bg-obsidian-900 hover:text-ink"
              }`}
              onClick={() => onSelect(s.id)}
            >
              <span className="flex-1 truncate">{s.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-md text-ink-faint hover:text-red-400 hover:bg-obsidian-700 transition-all"
                aria-label="Hapus sesi"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-line-hair">
          <p className="font-mono text-[10px] tracking-widest text-ink-faint">
            LOCALHOST ONLY
          </p>
          <p className="font-mono text-[10px] text-ink-faint mt-0.5">
            127.0.0.1:3000
          </p>
        </div>
      </aside>
    </>
  );
}
