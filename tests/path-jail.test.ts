import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ARTIFACTS_DIR, assertSafePath } from "../src/lib/security/path-jail.ts";

describe("path-jail", () => {
  it("nama file normal lolos", () => {
    const p = assertSafePath("app.tsx");
    assert.equal(p, path.join(ARTIFACTS_DIR, "app.tsx"));
  });

  it("traversal POSIX tidak bisa keluar jail", () => {
    // basename me-strip traversal -> "passwd", tetap di dalam jail (aman).
    const p = assertSafePath("../../etc/passwd");
    assert.equal(path.basename(p), "passwd");
    assert.ok(p.startsWith(ARTIFACTS_DIR), `keluar jail: ${p}`);
  });

  it("traversal Windows tidak bisa keluar jail", () => {
    const p = assertSafePath("..\\..\\windows\\x");
    assert.ok(p.startsWith(ARTIFACTS_DIR), `keluar jail: ${p}`);
    if (process.platform === "win32") {
      assert.equal(path.basename(p), "x");
    }
  });

  it("drive letter injection tidak bisa keluar jail", () => {
    // Di Windows: basename("C:\\x\\y.txt") = "y.txt" -> tetap di jail (aman, lolos wajar).
    // Di POSIX: backslash bukan separator -> seluruh string jadi nama file -> tetap di jail.
    // Properti keamanan: TIDAK BOLEH ada hasil di luar ARTIFACTS_DIR.
    const p = assertSafePath("C:\\x\\y.txt");
    assert.ok(p.startsWith(ARTIFACTS_DIR), `keluar jail: ${p}`);
    if (process.platform === "win32") {
      assert.equal(path.basename(p), "y.txt");
    }
  });

  it("nama kosong diblokir", () => {
    assert.throws(() => assertSafePath(""), /ACCESS_DENIED/);
  });

  it("basename dipakai: subdir di-strip jadi nama file", () => {
    const p = assertSafePath("sub/dir/file.txt");
    assert.equal(path.basename(p), "file.txt");
    assert.ok(p.startsWith(ARTIFACTS_DIR));
  });
});
