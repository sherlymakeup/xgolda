import { NextRequest } from "next/server";
import { getSessionWorkspace } from "@/lib/agent/workspace";
import { listWorkspaceFiles } from "@/lib/workspace-files";

/**
 * GET /api/workspace-files?sessionId=<id>
 * Daftar file yang dibuat/dihasilkan agen di folder workspace thread ini.
 */
export async function GET(req: NextRequest) {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId wajib" }, { status: 400 });
  }
  try {
    const dir = await getSessionWorkspace(sessionId);
    return Response.json({ files: listWorkspaceFiles(dir) });
  } catch (e) {
    console.error("[workspace-files] list gagal:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Gagal membaca folder workspace" }, { status: 500 });
  }
}
