import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  assertValidSessionId,
  assertWorkspacePath,
  getSessionWorkspace,
  getWorkspaceRoot,
  isInside,
} from "../src/lib/agent/workspace.ts";

const SID = `test-ws-${nanoid(8)}`;

describe("agent workspace jail", () => {
  after(() => {
    // Bersihkan folder sesi test
    getWorkspaceRoot().then((root) => {
      const dir = path.join(root, SID);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  it("membuat folder sesi di dalam root", async () => {
    const root = await getWorkspaceRoot();
    const dir = await getSessionWorkspace(SID);
    assert.ok(dir.startsWith(root));
    assert.ok(fs.existsSync(dir));
    assert.ok(dir.endsWith(SID));
  });

  it("menerima path relatif & nested", async () => {
    const dir = await getSessionWorkspace(SID);
    const t1 = await assertWorkspacePath(SID, "hasil.md");
    const t2 = await assertWorkspacePath(SID, "laporan/hasil.md");
    assert.ok(isInside(dir, t1));
    assert.ok(isInside(dir, t2));
  });

  it("menolak escape (..) dan absolute path", async () => {
    await assert.rejects(() => assertWorkspacePath(SID, "../evil.md"), /ACCESS_DENIED/);
    await assert.rejects(() => assertWorkspacePath(SID, "a/../../evil.md"), /ACCESS_DENIED/);
    await assert.rejects(() => assertWorkspacePath(SID, "/etc/passwd"), /ACCESS_DENIED/);
  });

  it("menolak sessionId jahat", () => {
    assert.throws(() => assertValidSessionId("../../x"), /ACCESS_DENIED/);
    assert.throws(() => assertValidSessionId(""), /ACCESS_DENIED/);
    assert.doesNotThrow(() => assertValidSessionId("abc-123_XYZ"));
  });

  it("fs tools menulis di dalam workspace sesi, tidak bisa kabur", async () => {
    const { fsWriteTool, fsReadTool, fsListTool } = await import(
      "../src/lib/tools/fs-operations.ts"
    );
    const ctx = { sessionId: SID };
    const w = await fsWriteTool.handler({ filename: "sub/catatan.md", content: "halo" }, ctx);
    assert.equal(w.ok, true);
    const dir = await getSessionWorkspace(SID);
    assert.ok(fs.existsSync(path.join(dir, "sub", "catatan.md")));

    const r = await fsReadTool.handler({ filename: "sub/catatan.md" }, ctx);
    assert.equal(r.ok, true);
    assert.match(r.output, /halo/);

    const bad = await fsWriteTool.handler({ filename: "../../kabur.md", content: "x" }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.output, /ACCESS_DENIED/);

    const l = await fsListTool.handler({}, ctx);
    assert.equal(l.ok, true);
    assert.match(l.output, /sub\//);
  });

  it("terminal menolak cwd di luar workspace sesi", async () => {
    const { terminalExecTool } = await import("../src/lib/tools/terminal.ts");
    const r = await terminalExecTool.handler(
      { command: "echo hi", cwd: "/tmp" },
      { sessionId: SID }
    );
    assert.equal(r.ok, false);
    assert.match(r.output, /ACCESS_DENIED/);
  });

  it("terminal cwd default = folder sesi (perintah aman jalan)", async () => {
    const { terminalExecTool } = await import("../src/lib/tools/terminal.ts");
    const dir = await getSessionWorkspace(SID);
    const r = await terminalExecTool.handler({ command: "pwd" }, { sessionId: SID });
    assert.equal(r.ok, true);
    assert.match(r.output.trim(), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

describe("history persisten (tidak hilang/duplikat)", () => {
  it("buildChatContext: urutan kronologis, tanpa duplikat, lampiran jadi vision parts", async () => {
    const { getDb } = await import("../src/db/index.ts");
    const { messages, sessions } = await import("../src/db/schema.ts");
    const { buildChatContext } = await import("../src/lib/agent/context.ts");
    const db = getDb();
    const sid = `hist-${nanoid(8)}`;
    const now = Date.now();
    await db.insert(sessions).values({ id: sid, title: "test", createdAt: now, updatedAt: now });
    // Buat file lampiran dummy di uploads
    const upDir = path.resolve(process.cwd(), "storage", "uploads");
    fs.mkdirSync(upDir, { recursive: true });
    const imgId = nanoid(16);
    fs.writeFileSync(path.join(upDir, `${imgId}.png`), Buffer.from("fakepng"));

    await db.insert(messages).values([
      { id: nanoid(), sessionId: sid, role: "user", content: "pesan satu", createdAt: now },
      {
        id: nanoid(),
        sessionId: sid,
        role: "user",
        content: "lihat gambar ini",
        attachmentsJson: JSON.stringify([{ id: imgId }]),
        createdAt: now + 1,
      },
      { id: nanoid(), sessionId: sid, role: "assistant", content: "jawaban", createdAt: now + 2 },
    ]);
    const ctx = await buildChatContext(sid);
    // system + 3 pesan, urutan kronologis
    assert.equal(ctx.length, 4);
    assert.equal(ctx[0].role, "system");
    assert.equal((ctx[1].content as string), "pesan satu");
    // Pesan dengan lampiran → content parts (text + image_url)
    const parts = ctx[2].content as Array<{ type: string; image_url?: { url: string } }>;
    assert.ok(Array.isArray(parts));
    assert.equal(parts[0].type, "text");
    assert.equal(parts[1].type, "image_url");
    assert.match(parts[1].image_url!.url, /^data:image\/png;base64,/);
    assert.equal(ctx[3].role, "assistant");
    // Tidak ada duplikat id konten
    const texts = ctx.slice(1).map((m) => (typeof m.content === "string" ? m.content : m.content[0]));
    assert.equal(new Set(texts.map(String)).size, 3);

    fs.unlinkSync(path.join(upDir, `${imgId}.png`));
    const { eq } = await import("drizzle-orm");
    await db.delete(messages).where(eq(messages.sessionId, sid));
    await db.delete(sessions).where(eq(sessions.id, sid));
  });
});

describe("summarizeToolHistory", () => {
  it("batas total 12000 karakter + delimiter tool-output, entri lama dipotong", async () => {
    const { summarizeToolHistory } = await import("../src/lib/agent/context.ts");
    const execs = Array.from({ length: 30 }, (_, i) => ({
      toolName: "web_fetch",
      argsJson: JSON.stringify({ url: `https://example.com/${i}` }),
      resultJson: JSON.stringify({ ok: true, output: "x".repeat(1400) }),
      ok: true,
    }));
    const out = summarizeToolHistory(execs);
    assert.ok(out.length <= 13000, `kepanjangan: ${out.length}`);
    assert.match(out, /<tool-output>/);
    assert.match(out, /dipotong/);
    assert.ok(out.includes("[30] web_fetch"), "entri terbaru dipertahankan");
    assert.ok(!out.includes("[1] web_fetch"), "entri terlama dibuang");
  });
});
