import { NextRequest } from "next/server";
import { decideApproval } from "@/lib/agent/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/approvals/[id]/decision — keputusan user atas approval gate.
 * Body: { decision: "approved" | "rejected" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: { decision?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const decision = body.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return Response.json(
      { error: "decision harus 'approved' atau 'rejected'" },
      { status: 400 }
    );
  }
  const ok = await decideApproval(params.id, decision);
  if (!ok) {
    return Response.json(
      { error: "Approval tidak ditemukan atau sudah diputuskan" },
      { status: 409 }
    );
  }
  return Response.json({ ok: true, decision });
}
