import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./index.ts";
import { vectorMetadata } from "./schema.ts";
import { getEmbedding } from "../lib/ai/client.ts";

/** Cosine similarity in-process (tanpa ekstensi native). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Simpan embedding teks ke vector_metadata. */
export async function addEmbedding(
  text: string,
  source?: string
): Promise<string> {
  const vec = await getEmbedding(text);
  const db = getDb();
  const id = nanoid();
  await db.insert(vectorMetadata).values({
    id,
    text,
    embeddingJson: JSON.stringify(vec),
    dim: vec.length,
    source,
    createdAt: Date.now(),
  });
  return id;
}

/** Cari teks paling mirip dengan query (brute-force cosine, cukup untuk skala lokal). */
export async function searchSimilar(
  query: string,
  topK = 5
): Promise<{ id: string; text: string; score: number; source: string | null }[]> {
  const qvec = await getEmbedding(query);
  const db = getDb();
  const rows = await db.select().from(vectorMetadata);
  const scored = rows.map((r) => {
    let vec: number[] = [];
    try {
      vec = JSON.parse(r.embeddingJson);
    } catch {
      vec = [];
    }
    return {
      id: r.id,
      text: r.text,
      score: cosineSimilarity(qvec, vec),
      source: r.source,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, topK));
}

/** Hapus satu entri embedding. */
export async function deleteEmbedding(id: string): Promise<boolean> {
  const db = getDb();
  const res = await db.delete(vectorMetadata).where(eq(vectorMetadata.id, id));
  return (res.changes ?? 0) > 0;
}
