import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { assertWorkspacePath } from "@/lib/agent/workspace";
import { mimeForFile } from "@/lib/file-meta";

/**
 * GET /api/workspace-files/raw?sessionId=<id>&path=<relatif>
 * Serve satu file dari workspace thread (preview/download).
 * Path divalidasi lewat jail — tidak bisa keluar folder sesi.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const sessionId = sp.get("sessionId");
  const rel = sp.get("path");
  if (!sessionId || !rel) {
    return Response.json({ error: "sessionId & path wajib" }, { status: 400 });
  }
  let target: string;
  try {
    target = await assertWorkspacePath(sessionId, rel);
  } catch {
    return Response.json({ error: "Path tidak valid" }, { status: 403 });
  }
  try {
    const st = fs.statSync(target);
    if (!st.isFile()) {
      return Response.json({ error: "Bukan file" }, { status: 404 });
    }
    if (st.size > 50 * 1024 * 1024) {
      return Response.json({ error: "File terlalu besar untuk preview" }, { status: 413 });
    }
    const buf = fs.readFileSync(target);
    const body = new Uint8Array(buf);
    return new Response(body, {
      headers: {
        "Content-Type": mimeForFile(rel),
        "Content-Disposition": `inline; filename="${encodeURIComponent(path.basename(rel))}"`,
        "Content-Length": String(st.size),
      },
    });
  } catch {
    return Response.json({ error: "File tidak ditemukan" }, { status: 404 });
  }
}
