/** Helper API + parser SSE untuk frontend. */

export interface Session {
  id: string;
  title: string;
  model: string;
  temperature: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  reasoningContent: string;
  toolName?: string | null;
  attachmentsJson?: string | null;
  /** Run agen penghasil pesan ini (jawaban final) — untuk layout timeline. */
  runId?: string | null;
  createdAt: number;
}

export async function listSessions(): Promise<Session[]> {
  const r = await fetch("/api/sessions");
  const j = await r.json();
  return j.sessions ?? [];
}

export async function getSession(id: string): Promise<{
  session: Session;
  messages: ChatMessage[];
}> {
  const r = await fetch(`/api/sessions/${id}`);
  if (!r.ok) throw new Error("Sesi tidak ditemukan");
  return r.json();
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`/api/sessions/${id}`, { method: "DELETE" });
}

export interface AgentRunStatus {
  run: {
    id: string;
    goal: string;
    status: string;
    currentStep: number;
    error?: string | null;
    resultText?: string | null;
    workspaceDir?: string | null;
  };
  plan: { step: number; title: string; description: string; tool: string | null }[];
  steps: {
    id: string;
    toolName: string;
    args: unknown;
    result: unknown;
    durationMs: number;
    exitCode?: number | null;
    createdAt: number;
  }[];
  approvals: {
    id: string;
    toolName: string;
    command: string;
    reason: string;
    status: "pending" | "approved" | "rejected" | "expired";
    createdAt: number;
    decidedAt?: number | null;
  }[];
}

export async function startAgentRun(
  goal: string,
  sessionId?: string,
  model?: string,
  userText?: string,
  attachments?: { id: string }[]
): Promise<{ runId: string }> {
  const r = await fetch("/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal, sessionId, model, userText, attachments }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Gagal memulai agent");
  return j;
}

export async function getAgentStatus(runId: string): Promise<AgentRunStatus> {
  const r = await fetch(`/api/agent/${runId}/status`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Gagal ambil status");
  return j;
}

export async function decideApproval(
  id: string,
  decision: "approved" | "rejected"
): Promise<void> {
  const r = await fetch(`/api/approvals/${id}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Gagal menyimpan keputusan");
}

export interface ArtifactMeta {
  id: string;
  filename: string;
  language: string;
  sessionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function listArtifacts(): Promise<ArtifactMeta[]> {
  const r = await fetch("/api/artifacts");
  const j = await r.json();
  return j.artifacts ?? [];
}

export async function getArtifact(id: string): Promise<
  ArtifactMeta & { sourceCode: string }
> {
  const r = await fetch(`/api/artifacts/${id}`);
  if (!r.ok) throw new Error("Artifact tidak ditemukan");
  return r.json();
}

export async function compileArtifact(
  id: string,
  sourceCode?: string
): Promise<{ code?: string; error?: string; detail?: string }> {
  const r = await fetch(`/api/artifacts/${id}/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sourceCode !== undefined ? { sourceCode } : {}),
  });
  return r.json();
}

/** Render markdown ringan (tanpa dep tambahan): code fence, inline code, bold, heading, list. */
/**
 * Renderer markdown ringan (tanpa dependensi) untuk bubble chat.
 * Mendukung: heading, paragraf, bold, italic, strikethrough, inline code,
 * code fence, link (hanya http/https/mailto — javascript: ditolak),
 * list unordered/ordered + bersarang, blockquote, hr, dan tabel GFM.
 * Aman dari XSS: seluruh input di-escape dulu; hanya tag yang dihasilkan
 * fungsi ini yang masuk HTML (dipakai via dangerouslySetInnerHTML).
 */
export function renderMarkdown(src: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 1. Ekstrak code fence dulu agar tidak diproses sebagai markdown.
  const fenced: string[] = [];
  const noFence = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    fenced.push(
      `<pre><code class="language-${esc(lang || "text")}">${esc(code.replace(/\n$/, ""))}</code></pre>`
    );
    return `\\u0000${fenced.length - 1}\\u0000`;
  });

  // 2. Escape, lalu ekstrak inline code agar `**` dll. di dalamnya tidak diproses.
  let html = esc(noFence);
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_m, code) => {
    inlineCodes.push(`<code>${code}</code>`);
    return `\\u0001${inlineCodes.length - 1}\\u0001`;
  });

  // Format inline: link → bold → strikethrough → italic.
  const inline = (s: string): string => {
    let out = s.replace(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_m, text, url) =>
        /^(https?:\/\/|mailto:|#|\/)/i.test(url)
          ? `<a href="${url}" target="_blank" rel="noreferrer">${text}</a>`
          : text
    );
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    out = out.replace(/(^|[^\w])_([^_\n]+)_/g, "$1<em>$2</em>");
    return out;
  };

  // --- Parser blok ---
  const lines = html.split("\n");

  const splitRow = (line: string): string[] | null => {
    const t = line.trim();
    if (!t.startsWith("|")) return null;
    return t
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  };

  const parseTable = (i: number): { html: string; next: number } | null => {
    const header = splitRow(lines[i]);
    if (!header || i + 1 >= lines.length) return null;
    const sep = splitRow(lines[i + 1]);
    if (!sep || sep.length !== header.length) return null;
    const aligns: string[] = [];
    for (const c of sep) {
      const t = c.trim();
      if (!/^:?-{1,}:?$/.test(t)) return null;
      aligns.push(t.startsWith(":") && t.endsWith(":") ? "center" : t.endsWith(":") ? "right" : "left");
    }
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length) {
      const row = splitRow(lines[j]);
      if (!row) break;
      rows.push(row);
      j++;
    }
    const th = header
      .map((c, k) => `<th style="text-align:${aligns[k]}">${inline(c)}</th>`)
      .join("");
    const tb = rows
      .map(
        (row) =>
          `<tr>${row
            .map((c, k) => `<td style="text-align:${aligns[k] ?? "left"}">${inline(c)}</td>`)
            .join("")}</tr>`
      )
      .join("");
    return {
      html: `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`,
      next: j,
    };
  };

  interface ListItem {
    indent: number;
    ordered: boolean;
    text: string;
    children: ListItem[];
  }
  const parseList = (i: number): { html: string; next: number } => {
    const raw: ListItem[] = [];
    let j = i;
    while (j < lines.length) {
      const m = lines[j].match(/^( *)([-*]|\d+[.)])\s+(.*)$/);
      if (!m) break;
      raw.push({
        indent: m[1].length,
        ordered: /^\d/.test(m[2]),
        text: m[3],
        children: [],
      });
      j++;
    }
    // Bangun pohon bersarang dari indentasi (2 spasi = 1 level).
    const roots: ListItem[] = [];
    const stack: ListItem[] = [];
    for (const item of raw) {
      while (stack.length > 0 && stack[stack.length - 1].indent >= item.indent) {
        stack.pop();
      }
      if (stack.length === 0) roots.push(item);
      else stack[stack.length - 1].children.push(item);
      stack.push(item);
    }
    const renderItems = (items: ListItem[]): string => {
      let out = "";
      let k = 0;
      while (k < items.length) {
        const ordered = items[k].ordered;
        const tag = ordered ? "ol" : "ul";
        let inner = "";
        while (k < items.length && items[k].ordered === ordered) {
          const it = items[k];
          inner += `<li>${inline(it.text)}${it.children.length > 0 ? renderItems(it.children) : ""}</li>`;
          k++;
        }
        out += `<${tag}>${inner}</${tag}>`;
      }
      return out;
    };
    return { html: renderItems(roots), next: j };
  };

  const parseBlocks = (blockLines: string[]): string => {
    const out: string[] = [];
    let i = 0;
    while (i < blockLines.length) {
      const line = blockLines[i];
      const t = line.trim();
      if (!t) {
        i++;
        continue;
      }
      // Code fence (placeholder) — berdiri sendiri.
      if (t.includes("\\u0000")) {
        out.push(line);
        i++;
        continue;
      }
      // Heading
      const hm = t.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        const level = hm[1].length;
        out.push(`<h${level}>${inline(hm[2])}</h${level}>`);
        i++;
        continue;
      }
      // HR
      if (/^(\*\*\*|---|___)\s*$/.test(t)) {
        out.push("<hr>");
        i++;
        continue;
      }
      // Tabel GFM (header + separator)
      if (t.startsWith("|")) {
        const table = parseTable(i);
        if (table) {
          out.push(table.html);
          i = table.next;
          continue;
        }
      }
      // Blockquote (rekursif — isinya bisa list/paragraf).
      // `>` sudah ter-escape jadi `&gt;` sebelum parser blok jalan.
      if (t.startsWith("&gt;")) {
        const inner: string[] = [];
        while (i < blockLines.length && blockLines[i].trim().startsWith("&gt;")) {
          inner.push(blockLines[i].replace(/^\s*&gt;\s?/, ""));
          i++;
        }
        out.push(`<blockquote>${parseBlocks(inner)}</blockquote>`);
        continue;
      }
      // List
      if (/^( *)([-*]|\d+[.)])\s+/.test(line)) {
        const list = parseList(i);
        out.push(list.html);
        i = list.next;
        continue;
      }
      // Paragraf: gabung baris berurutan (soft break → <br>).
      const para: string[] = [line];
      i++;
      while (i < blockLines.length) {
        const nt = blockLines[i].trim();
        if (
          !nt ||
          nt.includes("\\u0000") ||
          /^(#{1,6})\s+/.test(nt) ||
          /^(\*\*\*|---|___)\s*$/.test(nt) ||
          nt.startsWith("&gt;") ||
          nt.startsWith("|") ||
          /^( *)([-*]|\d+[.)])\s+/.test(blockLines[i])
        ) {
          break;
        }
        para.push(blockLines[i]);
        i++;
      }
      out.push(`<p>${para.map((p) => inline(p.trim())).join("<br>")}</p>`);
    }
    return out.join("\n");
  };

  let rendered = parseBlocks(lines);

  // Kembalikan placeholder inline code & code fence.
  rendered = rendered.replace(/\\u0001(\d+)\\u0001/g, (_m, idx) => inlineCodes[Number(idx)]);
  rendered = rendered.replace(/\\u0000(\d+)\\u0000/g, (_m, idx) => fenced[Number(idx)]);
  return rendered;
}

/** Lampiran gambar untuk vision (upload via /api/uploads). */
export interface Attachment {
  id: string;
  mime: string;
}

export async function uploadImage(file: File): Promise<{ id: string; mime: string; size: number }> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/uploads", { method: "POST", body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Upload gagal (HTTP ${r.status})`);
  return j;
}

/** Daftar model gateway per kemampuan (untuk model picker). */
export async function listGatewayModels(
  capability: string
): Promise<{ id: string; owned_by: string }[]> {
  const r = await fetch(`/api/gateway/models?capability=${encodeURIComponent(capability)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return (j.models ?? []) as { id: string; owned_by: string }[];
}

/** Status kesehatan gateway (untuk halaman Settings). */
export async function getGatewayStatus(): Promise<{
  ok: boolean;
  latencyMs?: number;
  endpoint?: string;
  models: Record<string, number>;
}> {
  const r = await fetch("/api/gateway/status");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Gateway tidak terjangkau");
  return j;
}
