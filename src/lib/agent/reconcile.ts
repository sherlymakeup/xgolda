import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { agentRuns, approvals } from "../../db/schema.ts";

/**
 * Rekonsiliasi startup: run yang masih `queued/planning/running` saat
 * server restart tidak akan pernah selesai (loop-nya mati bersama proses
 * lama) — tandai `failed` supaya UI tidak polling selamanya. Approval
 * `pending` yang run-nya sudah tidak hidup ikut kedaluwarsa (tidak ada
 * yang bisa memutuskannya lagi).
 *
 * Dijalankan sekali dari instrumentation register() (Next.js).
 */
export async function reconcileOnStartup(): Promise<{
  failedRuns: number;
  expiredApprovals: number;
}> {
  const db = getDb();
  const now = Date.now();
  let failedRuns = 0;
  let expiredApprovals = 0;
  try {
    const stuck = await db
      .update(agentRuns)
      .set({
        status: "failed",
        error: "Server restart saat run berjalan — run dibatalkan.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(inArray(agentRuns.status, ["queued", "planning", "running"]))
      .returning({ id: agentRuns.id });
    failedRuns = stuck.length;
  } catch (e) {
    console.error(
      "[reconcile] gagal menandai run nyangkut:",
      e instanceof Error ? e.message : e
    );
  }
  try {
    const expired = await db
      .update(approvals)
      .set({ status: "expired", decidedAt: now })
      .where(eq(approvals.status, "pending"))
      .returning({ id: approvals.id });
    expiredApprovals = expired.length;
  } catch (e) {
    console.error(
      "[reconcile] gagal mengedaluarsakan approval:",
      e instanceof Error ? e.message : e
    );
  }
  if (failedRuns > 0 || expiredApprovals > 0) {
    console.log(
      `[reconcile] startup: ${failedRuns} run nyangkut → failed, ${expiredApprovals} approval pending → expired`
    );
  }
  return { failedRuns, expiredApprovals };
}
