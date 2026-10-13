import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Thread obrolan. */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Percakapan baru"),
  model: text("model").notNull().default("deepseek-ai/DeepSeek-R1"),
  temperature: real("temperature").notNull().default(0.7),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Riwayat chat. reasoningContent menampung output CoT. */
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
  content: text("content").notNull().default(""),
  reasoningContent: text("reasoning_content").notNull().default(""),
  toolName: text("tool_name"),
  createdAt: integer("created_at").notNull(),
});

/** Eksekusi autonomous agent. */
export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  goal: text("goal").notNull(),
  status: text("status", {
    enum: ["queued", "planning", "running", "completed", "failed"],
  })
    .notNull()
    .default("queued"),
  planTreeJson: text("plan_tree_json").notNull().default("[]"),
  currentStep: integer("current_step").notNull().default(0),
  error: text("error"),
  /** Jawaban final agen — ditampilkan di panel & API status. */
  resultText: text("result_text"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  finishedAt: integer("finished_at"),
});

/** Audit log pemanggilan tool oleh agen. */
export const toolExecutions = sqliteTable("tool_executions", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => agentRuns.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => sessions.id, {
    onDelete: "cascade",
  }),
  toolName: text("tool_name").notNull(),
  argsJson: text("args_json").notNull().default("{}"),
  resultJson: text("result_json").notNull().default("{}"),
  durationMs: integer("duration_ms").notNull().default(0),
  exitCode: integer("exit_code"),
  createdAt: integer("created_at").notNull(),
});

/** Override konfigurasi dari UI (halaman Update Config) — mengalahkan nilai .env. */
export const appConfig = sqliteTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Berkas kode TSX/TS/Python yang ditulis agen ke ./storage/artifacts/. */
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  filename: text("filename").notNull(),
  language: text("language").notNull().default("tsx"),
  sourceCode: text("source_code").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Pemetaan embedding teks untuk pencarian semantik lokal (in-process cosine). */
export const vectorMetadata = sqliteTable("vector_metadata", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  embeddingJson: text("embedding_json").notNull(),
  dim: integer("dim").notNull(),
  source: text("source"),
  createdAt: integer("created_at").notNull(),
});

/** Persetujuan user untuk perintah berbahaya (approval gate). */
export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => agentRuns.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => sessions.id, {
    onDelete: "cascade",
  }),
  toolName: text("tool_name").notNull(),
  command: text("command").notNull(),
  argsJson: text("args_json").notNull().default("{}"),
  reason: text("reason").notNull(),
  status: text("status", {
    enum: ["pending", "approved", "rejected", "expired"],
  })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at").notNull(),
  decidedAt: integer("decided_at"),
});

export type Session = typeof sessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type ToolExecution = typeof toolExecutions.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type VectorMetadata = typeof vectorMetadata.$inferSelect;
