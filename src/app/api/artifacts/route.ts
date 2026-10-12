import fs from "node:fs";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { artifacts } from "@/db/schema";
import {
  assertSafePath,
  ensureArtifactsDir,
} from "@/lib/security/path-jail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["tsx", "jsx"].includes(ext)) return "tsx";
  if (["ts", "mts", "cts"].includes(ext)) return "ts";
  if (["js", "mjs", "cjs"].includes(ext)) return "js";
  if (ext === "py") return "python";
  if (["css", "json", "md", "html", "sql"].includes(ext)) return ext;
  return "text";
}

/** GET /api/artifacts — daftar artifact. */
export async function GET() {
  const db = getDb();
  const rows = await db
    .select()
    .from(artifacts)
    .orderBy(desc(artifacts.updatedAt));
  return Response.json({
    artifacts: rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      language: r.language,
      sessionId: r.sessionId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
}

/**
 * POST /api/artifacts — simpan artifact baru (DB + file di ./storage/artifacts/).
 * Body: { filename, sourceCode, sessionId?, language? }
 */
export async function POST(req: NextRequest) {
  let body: {
    filename?: string;
    sourceCode?: string;
    sessionId?: string;
    language?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const filename = (body.filename || "").trim();
  const sourceCode = body.sourceCode ?? "";
  if (!filename) {
    return Response.json({ error: "filename wajib" }, { status: 400 });
  }

  let target: string;
  try {
    ensureArtifactsDir();
    target = assertSafePath(filename);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Path tidak valid" },
      { status: 400 }
    );
  }
  fs.writeFileSync(target, sourceCode, "utf8");

  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  await db.insert(artifacts).values({
    id,
    sessionId: body.sessionId,
    filename,
    language: body.language || detectLanguage(filename),
    sourceCode,
    createdAt: now,
    updatedAt: now,
  });
  return Response.json({ id, filename }, { status: 201 });
}
