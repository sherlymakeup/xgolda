/**
 * Bus event in-memory per agent run — untuk SSE streaming ke client.
 * Single-process (localhost), tidak untuk multi-instance.
 */

export type RunEvent =
  | { type: "plan"; steps: { step: number; title: string; description: string; tool: string | null }[] }
  | { type: "token"; text: string }
  | { type: "final"; text: string }
  | { type: "done"; status: "completed" | "failed" }
  | { type: "error"; message: string };

type Listener = (e: RunEvent) => void;

const subs = new Map<string, Set<Listener>>();

export function emitRunEvent(runId: string, e: RunEvent): void {
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
