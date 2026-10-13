import { chatOnce } from "../ai/client.ts";
import { buildPlannerPrompt } from "../ai/prompt-templates.ts";

export interface PlanStep {
  step: number;
  title: string;
  description: string;
  tool: string | null;
}

/** Minta model menghasilkan plan tree JSON untuk sebuah goal. */
export async function generatePlan(
  goal: string,
  model?: string
): Promise<PlanStep[]> {
  const { content } = await chatOnce(
    [
      {
        role: "system",
        content:
          "Kamu adalah perencana tugas. Balas HANYA dengan JSON array valid.",
      },
      { role: "user", content: buildPlannerPrompt(goal) },
    ],
    { model, temperature: 0.3 }
  );

  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  // Model kadang membungkus JSON dengan prosa ("Berikut rencananya: [...]").
  // Coba parse langsung, lalu fallback: ekstrak substring [ ... ].
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end <= start) {
      throw new Error("Planner: JSON array tidak ditemukan");
    }
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  }
  if (!Array.isArray(parsed)) throw new Error("Planner: bukan JSON array");
  return parsed.map((s, i) => ({
    step: typeof s.step === "number" ? s.step : i + 1,
    title: String(s.title ?? `Langkah ${i + 1}`),
    description: String(s.description ?? ""),
    tool: typeof s.tool === "string" ? s.tool : null,
  }));
}
