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
});
