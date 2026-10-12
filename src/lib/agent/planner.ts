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
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Planner: bukan JSON array");
  return parsed.map((s, i) => ({
    step: typeof s.step === "number" ? s.step : i + 1,
    title: String(s.title ?? `Langkah ${i + 1}`),
    description: String(s.description ?? ""),
    tool: typeof s.tool === "string" ? s.tool : null,
  }));
}
