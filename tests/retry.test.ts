import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../src/lib/ai/retry.ts";
import { GatewayError } from "../src/lib/ai/client.ts";

describe("withRetry", () => {
  it("sukses di attempt pertama tanpa delay", async () => {
    let n = 0;
    const r = await withRetry(async () => {
      n++;
      return "ok";
    });
    assert.equal(r, "ok");
    assert.equal(n, 1);
  });

  it("retry 429 lalu sukses", async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        n++;
        if (n < 3) throw new GatewayError("rate limit", 429);
        return "pulih";
      },
      { attempts: 3, baseMs: 5 }
    );
    assert.equal(r, "pulih");
    assert.equal(n, 3);
  });

  it("menyerah setelah attempts habis (500 terus)", async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            n++;
            throw new GatewayError("server error", 500);
          },
          { attempts: 3, baseMs: 5 }
        ),
      /server error/
    );
    assert.equal(n, 3);
  });

  it("TIDAK retry untuk 400/401", async () => {
    for (const status of [400, 401, 403, 404]) {
      let n = 0;
      await assert.rejects(
        () =>
          withRetry(
            async () => {
              n++;
              throw new GatewayError(`http ${status}`, status);
            },
            { attempts: 3, baseMs: 5 }
          ),
        new RegExp(`http ${status}`)
      );
      assert.equal(n, 1, `status ${status} harus 1 attempt`);
    }
  });

  it("retry network error (tanpa status)", async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        n++;
        if (n === 1) throw new Error("fetch failed: ECONNRESET");
        return "ok";
      },
      { attempts: 2, baseMs: 5 }
    );
    assert.equal(r, "ok");
    assert.equal(n, 2);
  });

  it("TIDAK retry error permanen tanpa status", async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            n++;
            throw new Error("ENV_MISSING: AI_GATEWAY_TOKEN");
          },
          { attempts: 3, baseMs: 5 }
        )
    );
    assert.equal(n, 1);
  });

  it("abort user menghentikan retry", async () => {
    const ctrl = new AbortController();
    let n = 0;
    const p = withRetry(
      async () => {
        n++;
        throw new GatewayError("busy", 503);
      },
      { attempts: 5, baseMs: 50, signal: ctrl.signal }
    );
    setTimeout(() => ctrl.abort(), 30);
    await assert.rejects(p, /Abort/);
    assert.ok(n < 5, "harus berhenti sebelum 5 attempt");
  });

  it("backoff bertambah (delay antar attempt)", async () => {
    const times: number[] = [];
    const baseMs = 60;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            times.push(Date.now());
            throw new GatewayError("x", 500);
          },
          { attempts: 3, baseMs }
        )
    );
    const d1 = times[1] - times[0];
    const d2 = times[2] - times[1];
    // Jitter hanya menambah: tiap delay >= basis backoff-nya (toleransi 25% untuk scheduling)
    assert.ok(d1 >= baseMs * 0.75, `d1=${d1} di bawah basis ${baseMs}`);
    assert.ok(d2 >= 2 * baseMs * 0.75, `d2=${d2} di bawah basis ${2 * baseMs}`);
  });
});
