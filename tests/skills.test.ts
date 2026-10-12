import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSkillCatalogText,
  listSkills,
  parseSkillFile,
  readSkill,
  refreshSkills,
} from "../src/lib/skills/loader.ts";
import { skillReadTool } from "../src/lib/tools/skill-read.ts";

describe("skill loader", () => {
  it("parse frontmatter", () => {
    const p = parseSkillFile(
      '---\nname: contoh\ndescription: "Contoh skill"\n---\n\n# Isi\nHalo'
    );
    assert.equal(p.name, "contoh");
    assert.equal(p.description, "Contoh skill");
    assert.match(p.body, /# Isi/);
  });

  it("tanpa frontmatter tetap terbaca", () => {
    const p = parseSkillFile("# Judul\nIsi biasa");
    assert.equal(p.name, "");
    assert.match(p.body, /Judul/);
  });

  it("skill bawaan ditemukan", () => {
    refreshSkills();
    const names = listSkills().map((s) => s.name);
    assert.ok(names.includes("artifact-guidelines"));
    assert.ok(names.includes("sqlite-guide"));
  });

  it("readSkill mengembalikan body", () => {
    const s = readSkill("sqlite-guide");
    assert.match(s.body, /agent_runs/);
    assert.ok(s.description.length > 0);
  });

  it("nama tak dikenal / invalid ditolak", () => {
    assert.throws(() => readSkill("tidak-ada-skill"), /tidak ditemukan/);
    assert.throws(() => readSkill("../../x"), /tidak valid/);
    assert.throws(() => readSkill(""), /tidak valid/);
  });

  it("katalog teks untuk prompt", () => {
    const cat = getSkillCatalogText();
    assert.match(cat, /artifact-guidelines/);
    assert.match(cat, /sqlite-guide/);
  });
});

describe("read_skill tool", () => {
  it("handler mengembalikan isi skill", async () => {
    const r = await skillReadTool.handler({ name: "artifact-guidelines" }, {});
    assert.equal(r.ok, true);
    assert.match(r.output, /export default/);
  });

  it("nama kosong ditolak", async () => {
    const r = await skillReadTool.handler({ name: "" }, {});
    assert.equal(r.ok, false);
  });
});
