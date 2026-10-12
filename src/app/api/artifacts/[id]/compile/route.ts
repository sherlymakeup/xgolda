import { eq } from "drizzle-orm";
import * as esbuild from "esbuild";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { artifacts } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/artifacts/[id]/compile — compile TSX/TS in-memory via esbuild
 * untuk live preview di Code Studio. Body opsional: { sourceCode? }
 * (bila diisi, compile dari body tanpa menyimpan).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let sourceCode: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.sourceCode === "string") sourceCode = body.sourceCode;
  } catch {
    /* abaikan */
  }

  if (sourceCode === undefined) {
    const db = getDb();
    const rows = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, params.id))
      .limit(1);
    if (rows.length === 0) {
      return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
    }
    sourceCode = rows[0].sourceCode;
  }

  try {
    const result = await esbuild.transform(sourceCode, {
      loader: "tsx",
      target: "es2020",
      format: "esm",
      jsx: "transform",
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
    });
    return Response.json({ code: result.code, warnings: result.warnings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { error: "Compile gagal", detail: msg.slice(0, 1000) },
      { status: 422 }
    );
  }
}
