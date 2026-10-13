import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearConfigOverride,
  getConfig,
  isEditableKey,
  setConfigOverride,
} from "../src/lib/config.ts";

describe("config overrides", () => {
  it("menolak key di luar allowlist", () => {
    assert.equal(isEditableKey("AI_GATEWAY_TOKEN"), false);
    assert.equal(isEditableKey("SQLITE_DB_PATH"), false);
    assert.equal(isEditableKey("PORT"), false);
    assert.equal(isEditableKey("DEFAULT_MODEL"), true);
    assert.equal(isEditableKey("WEB_SEARCH_MODEL"), true);
  });

  it("prioritas UI > env > default", async () => {
    // Pastikan bersih dulu
    await clearConfigOverride("TTS_MODEL").catch(() => {});
    const before = await getConfig();
    assert.ok(["env", "default"].includes(before.sources.TTS_MODEL));

    await setConfigOverride("TTS_MODEL", "test/voice-x");
    const after = await getConfig();
    assert.equal(after.values.TTS_MODEL, "test/voice-x");
    assert.equal(after.sources.TTS_MODEL, "ui");

    await clearConfigOverride("TTS_MODEL");
    const reverted = await getConfig();
    assert.equal(reverted.sources.TTS_MODEL, before.sources.TTS_MODEL);
    assert.equal(reverted.values.TTS_MODEL, before.values.TTS_MODEL);
  });

  it("setConfigOverride menolak key rahasia", async () => {
    await assert.rejects(() => setConfigOverride("AI_GATEWAY_TOKEN", "x"));
  });

  it("key env-only tidak bisa diubah via API & override DB lama diabaikan", async () => {
    assert.equal(isEditableKey("INTERNAL_INFERENCE_ENDPOINT"), false);
    assert.equal(isEditableKey("AGENT_WORKSPACE_ROOT"), false);
    await assert.rejects(() =>
      setConfigOverride("INTERNAL_INFERENCE_ENDPOINT", "https://evil.example")
    );
    // Simulasikan override DB lama (sebelum key jadi env-only): getConfig
    // WAJIB mengabaikannya — endpoint tidak boleh dibelokkan.
    const { getDb } = await import("../src/db/index.ts");
    const { appConfig } = await import("../src/db/schema.ts");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    await db
      .insert(appConfig)
      .values({ key: "INTERNAL_INFERENCE_ENDPOINT", value: "https://evil.example", updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: appConfig.key,
        set: { value: "https://evil.example", updatedAt: Date.now() },
      });
    try {
      const cfg = await getConfig();
      assert.notEqual(cfg.values.INTERNAL_INFERENCE_ENDPOINT, "https://evil.example");
      assert.notEqual(cfg.sources.INTERNAL_INFERENCE_ENDPOINT, "ui");
    } finally {
      await db.delete(appConfig).where(eq(appConfig.key, "INTERNAL_INFERENCE_ENDPOINT"));
    }
  });
});
