import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/lib/client-api.ts";

test("heading + paragraf + bold/italic", () => {
  const html = renderMarkdown("# Judul\n\nHalo **tebal** dan *miring*.");
  assert.match(html, /<h1>Judul<\/h1>/);
  assert.match(html, /<strong>tebal<\/strong>/);
  assert.match(html, /<em>miring<\/em>/);
});

test("list unordered, ordered, dan bersarang", () => {
  const html = renderMarkdown("- a\n- b\n  - b1\n  - b2\n\n1. satu\n2. dua");
  assert.match(html, /<ul><li>a<\/li><li>b<ul><li>b1<\/li><li>b2<\/li><\/ul><\/li><\/ul>/);
  assert.match(html, /<ol><li>satu<\/li><li>dua<\/li><\/ol>/);
});

test("tabel GFM dengan alignment", () => {
  const html = renderMarkdown(
    "| Nama | Nilai |\n| :--- | ---: |\n| A | 10 |\n| B | 20 |"
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th style="text-align:left">Nama<\/th>/);
  assert.match(html, /<th style="text-align:right">Nilai<\/th>/);
  assert.match(html, /<td style="text-align:right">10<\/td>/);
});

test("blockquote, hr, strikethrough", () => {
  const html = renderMarkdown("> kutipan penting\n\n---\n\n~~coret~~");
  assert.match(html, /<blockquote><p>kutipan penting<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<del>coret<\/del>/);
});

test("link aman + javascript: ditolak", () => {
  const html = renderMarkdown("[docs](https://example.com) dan [jahat](javascript:alert(1))");
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noreferrer">docs<\/a>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /jahat/);
});

test("inline code tidak diproses sebagai bold; fence utuh", () => {
  const html = renderMarkdown("pakai `**bukan-bold**` lalu\n\n```js\nconst x = 1;\n```");
  assert.match(html, /<code>\*\*bukan-bold\*\*<\/code>/);
  assert.match(html, /<pre><code class="language-js">const x = 1;<\/code><\/pre>/);
});

test("XSS: tag HTML di-escape", () => {
  const html = renderMarkdown("<script>alert(1)</script> dan <img src=x onerror=alert(1)>");
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;script&gt;/);
});

test("baris tanpa baris kosong jadi satu paragraf dengan <br>", () => {
  const html = renderMarkdown("baris satu\nbaris dua");
  assert.match(html, /<p>baris satu<br>baris dua<\/p>/);
});
