/**
 * Next.js instrumentation: jalan sekali saat server start.
 * Rekonsiliasi run/approval yatim dari proses sebelumnya.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { reconcileOnStartup } = await import("./lib/agent/reconcile.ts");
      await reconcileOnStartup();
    } catch (e) {
      console.error(
        "[instrumentation] reconcile startup gagal:",
        e instanceof Error ? e.message : e
      );
    }
  }
}
