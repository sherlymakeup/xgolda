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
export function renderMarkdown(src: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks: string[] = [];
  // Ekstrak code fence dulu agar tidak diproses sebagai markdown
  const fenced = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    blocks.push(
      `<pre><code class="language-${esc(lang || "text")}">${esc(code.replace(/\n$/, ""))}</code></pre>`
    );
    return `\u0000${blocks.length - 1}\u0000`;
  });
  let html = esc(fenced);
  html = html
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/^\s*\d+\. (.*)$/gm, "<li>$1</li>");
  // Bungkus li berurutan
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // Paragraf: baris non-tag
  html = html
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return "";
      if (/^<(h\d|ul|li|pre|code)/.test(t)) return line;
      if (/^<\/|^<(strong|em)/.test(t)) return line;
      return `<p>${line}</p>`;
    })
    .join("\n");
  // Kembalikan code fence
  html = html.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
  return html;
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
