/**
 * Retry dengan exponential backoff + jitter untuk panggilan gateway.
 * Retry HANYA untuk: 429, 5xx, network error, timeout.
 * TIDAK retry untuk: 400/401/403/404 (kesalahan permanen) dan abort user.
 */

export interface RetryOptions {
  attempts?: number; // default 3
  baseMs?: number; // default 1000
  signal?: AbortSignal; // signal user (bukan timeout internal)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

function isUserAbort(err: unknown, userSignal?: AbortSignal): boolean {
  if (userSignal?.aborted) return true;
  return (
    err instanceof DOMException && err.name === "AbortError" && !!userSignal
  );
}

function isRetryable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "TimeoutError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|econnreset|econnrefused|enotfound|etimedout|eai_again|fetch failed|network|socket hang up/i.test(
    msg
  );
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, Math.floor(opts.attempts ?? 3));
  const baseMs = Math.max(0, opts.baseMs ?? 1000);
  let lastErr: unknown = new Error("withRetry: tidak ada attempt");

  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (isUserAbort(e, opts.signal)) throw e; // user batal — jangan retry

      const status = statusOf(e);
      // 4xx permanen (kecuali 429) — jangan retry
      if (
        status !== undefined &&
        status !== 429 &&
        status >= 400 &&
        status < 500
      ) {
        throw e;
      }
      if (status === undefined && !isRetryable(e)) throw e;

      if (i === attempts - 1) throw e; // attempt terakhir — menyerah
      const delay = baseMs * 2 ** i + Math.random() * 250; // backoff + jitter
      await sleep(delay, opts.signal);
    }
  }
  throw lastErr;
}
