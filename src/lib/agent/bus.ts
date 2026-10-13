/**
 * Bus event in-memory per agent run — untuk SSE streaming ke client.
 * Single-process (localhost), tidak untuk multi-instance.
 */

export type RunEvent =
  | { type: "plan"; steps: { step: number; title: string; description: string; tool: string | null }[] }
  | { type: "ack"; text: string }
  | { type: "token"; text: string }
  | { type: "final"; text: string }
  | { type: "done"; status: "completed" | "failed" }
  | { type: "error"; message: string };

type Listener = (e: RunEvent) => void;

const subs = new Map<string, Set<Listener>>();

/**
 * Buffer replay: event terakhir per run (maks 200) — subscriber yang
 * terlambat (reconnect/flap jaringan) tetap dapat ack/plan yang sudah
 * ter-emit sebelum ia subscribe. Dihapus 60 detik setelah run `done`
 * (setelah itu snapshot DB di stream route yang melayani).
 */
const buffers = new Map<string, RunEvent[]>();
const MAX_BUFFERED = 200;

export function emitRunEvent(runId: string, e: RunEvent): void {
  let buf = buffers.get(runId);
  if (!buf) {
    buf = [];
    buffers.set(runId, buf);
  }
  buf.push(e);
  if (buf.length > MAX_BUFFERED) buf.shift();
  if (e.type === "done") {
    setTimeout(() => buffers.delete(runId), 60_000).unref?.();
  }
  const set = subs.get(runId);
  if (!set || set.size === 0) return;
  set.forEach((fn) => {
    try {
      fn(e);
    } catch {
      /* listener rusak — abaikan */
    }
  });
}

export function subscribeRun(runId: string, fn: Listener): () => void {
  let set = subs.get(runId);
  if (!set) {
    set = new Set();
    subs.set(runId, set);
  }
  set.add(fn);
  return () => {
    const s = subs.get(runId);
    if (s) {
      s.delete(fn);
      if (s.size === 0) subs.delete(runId);
    }
  };
}

/**
 * Subscribe + snapshot buffer secara atomik (satu tick JS — tidak ada celah
 * event hilang/duplikat di antara subscribe dan replay).
 */
export function subscribeRunWithReplay(
  runId: string,
  fn: Listener
): { unsubscribe: () => void; buffered: RunEvent[] } {
  const unsubscribe = subscribeRun(runId, fn);
  const buffered = [...(buffers.get(runId) ?? [])];
  return { unsubscribe, buffered };
}
