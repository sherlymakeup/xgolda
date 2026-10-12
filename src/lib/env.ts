/** Konfigurasi runtime terpusat — semua dari environment variables. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`ENV_MISSING: ${name} belum di-set di .env.local`);
  return v;
}

export const env = {
  port: parseInt(process.env.PORT || "3000", 10),
  inferenceEndpoint: (process.env.INTERNAL_INFERENCE_ENDPOINT ||
    "http://localhost:20128/v1").replace(/\/+$/, ""),
  gatewayToken: () => required("AI_GATEWAY_TOKEN"),
  defaultModel: process.env.DEFAULT_MODEL || "deepseek-ai/DeepSeek-R1",
  embeddingEndpoint: (
    process.env.EMBEDDING_ENDPOINT ||
    process.env.INTERNAL_INFERENCE_ENDPOINT ||
    "http://127.0.0.1:8000/v1"
  ).replace(/\/+$/, ""),
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  sqliteDbPath: process.env.SQLITE_DB_PATH || "./data/xgolda.db",
  executionTimeoutMs: parseInt(process.env.EXECUTION_TIMEOUT_MS || "15000", 10),
  agentMaxSteps: parseInt(process.env.AGENT_MAX_STEPS || "12", 10),
  aiRetryAttempts: parseInt(process.env.AI_RETRY_ATTEMPTS || "3", 10),
  aiRetryBaseMs: parseInt(process.env.AI_RETRY_BASE_MS || "1000", 10),
  approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS || "300000", 10),
};
