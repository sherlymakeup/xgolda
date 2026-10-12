import fs from "node:fs";
import path from "node:path";

export interface Skill {
  name: string;
  description: string;
  /** Isi markdown penuh (tanpa frontmatter). */
  body: string;
}

/** Direktori skills di root project: skills/<nama>/SKILL.md */
export const SKILLS_DIR = path.resolve(process.cwd(), "skills");

const VALID_NAME = /^[a-z0-9][a-z0-9-]{1,60}$/;

let cache: Skill[] | null = null;

/** Parse frontmatter YAML sederhana (name:, description:). */
export function parseSkillFile(raw: string): { name: string; description: string; body: string } {
  let body = raw;
  let name = "";
  let description = "";
  const fm = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fm) {
    body = raw.slice(fm[0].length);
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^\s*(name|description)\s*:\s*(.+?)\s*$/);
      if (m) {
        const val = m[2].replace(/^["']|["']$/g, "");
        if (m[1] === "name") name = val;
        else description = val;
      }
    }
  }
  return { name, description, body: body.trim() };
}

function loadAll(): Skill[] {
  const out: Skill[] = [];
  if (!fs.existsSync(SKILLS_DIR)) return out;
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!VALID_NAME.test(e.name)) continue;
    const file = path.join(SKILLS_DIR, e.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = parseSkillFile(raw);
      const name = parsed.name || e.name;
      if (!VALID_NAME.test(name)) continue;
      out.push({
        name,
        description: parsed.description || "(tanpa deskripsi)",
        body: parsed.body.slice(0, 20000),
      });
    } catch {
      /* skill rusak — lewati, jangan crash */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Daftar semua skill (di-cache per proses). */
export function listSkills(): Skill[] {
  if (!cache) cache = loadAll();
  return cache;
}

/** Muat ulang dari disk (mis. setelah user menambah skill baru). */
export function refreshSkills(): Skill[] {
  cache = loadAll();
  return cache;
}

/** Baca isi penuh satu skill berdasarkan nama. */
export function readSkill(name: string): Skill {
  if (!VALID_NAME.test(name)) {
    throw new Error(`SKILL tidak valid: '${name}'`);
  }
  const found = listSkills().find((s) => s.name === name);
  if (!found) {
    const available = listSkills()
      .map((s) => s.name)
      .join(", ");
    throw new Error(
      `SKILL '${name}' tidak ditemukan. Tersedia: ${available || "(kosong)"}`
    );
  }
  return found;
}

/** Teks katalog untuk disuntik ke system prompt agen. */
export function getSkillCatalogText(): string {
  const skills = listSkills();
  if (skills.length === 0) return "(belum ada skill — lihat skills/README.md)";
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}
