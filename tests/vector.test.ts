import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity } from "../src/db/vector.ts";

describe("cosineSimilarity", () => {
  it("vektor identik = 1", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  });

  it("vektor ortogonal = 0", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  });

  it("vektor berlawanan = -1", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9);
  });

  it("dimensi beda / kosong = 0", () => {
    assert.equal(cosineSimilarity([1, 2], [1]), 0);
    assert.equal(cosineSimilarity([], []), 0);
  });
});
