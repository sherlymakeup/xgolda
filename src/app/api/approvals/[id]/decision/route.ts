import { NextRequest } from "next/server";
import { decideApproval } from "@/lib/agent/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin check: keputusan approval hanya dari browser yang membuka
 * XGOLDA — bukan dari script lokal/cross-origin. Browser selalu mengirim
 * header Origin pada POST. Tanpa Origin → tolak (curl naive terblokir).
 * JUJUR: skrip lokal yang nekat BISA memalsukan Origin — ini speed bump,
 * bukan autentikasi penuh (tanpa login, localhost tidak bisa membedakan
 * browser vs skrip lokal). Lapisan utamanya: ID approval tidak bisa ditebak
 * (nanoid 21 karakter) dan gate ini menghentikan rantai enumerasi kasual.
 */
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * POST /api/approvals/[id]/decision — keputusan user atas approval gate.
 * Body: { decision: "approved" | "rejected" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSameOrigin(req)) {
    return Response.json(
      { error: "Origin tidak valid (same-origin only)" },
      { status: 403 }
    );
  }
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
