import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/index.ts";
import { approvals } from "../../db/schema.ts";
import { env } from "../../lib/env.ts";

export type ApprovalDecision = "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  runId?: string;
  sessionId?: string;
  toolName: string;
  command: string;
  args: Record<string, unknown>;
  reason: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Minta persetujuan user untuk aksi berbahaya, lalu TUNGGU keputusan.
 * - Mengembalikan "approved" bila user menyetujui.
 * - "rejected" bila user menolak; "expired" bila timeout tanpa keputusan.
 * - Fail-closed: tanpa runId (tidak ada konteks approval) → "rejected".
 */
export async function requestApproval(
  input: ApprovalRequest,
  opts: { timeoutMs?: number } = {}
): Promise<ApprovalDecision> {
  if (!input.runId) return "rejected";

  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  await db.insert(approvals).values({
    id,
    runId: input.runId,
    sessionId: input.sessionId,
    toolName: input.toolName,
    command: input.command.slice(0, 2000),
    argsJson: JSON.stringify(input.args).slice(0, 2000),
    reason: input.reason,
    status: "pending",
    createdAt: now,
  });

  const timeoutMs = Math.max(5000, opts.timeoutMs ?? env.approvalTimeoutMs);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    await sleep(1000);
    const rows = await db
      .select({ status: approvals.status })
      .from(approvals)
      .where(eq(approvals.id, id))
      .limit(1);
    const status = rows[0]?.status;
    if (status === "approved" || status === "rejected") {
      return status;
    }
    if (Date.now() >= deadline) {
      await db
        .update(approvals)
        .set({ status: "expired", decidedAt: Date.now() })
        .where(eq(approvals.id, id));
      return "expired";
    }
  }
}

/** Keputusan user via API. Hanya dari pending → approved/rejected. */
export async function decideApproval(
  id: string,
  decision: "approved" | "rejected"
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(eq(approvals.id, id))
    .limit(1);
  if (rows.length === 0 || rows[0].status !== "pending") return false;
  await db
    .update(approvals)
    .set({ status: decision, decidedAt: Date.now() })
    .where(eq(approvals.id, id));
  return true;
}
