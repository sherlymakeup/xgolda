/**
 * Mock inference gateway (OpenAI-compatible) untuk E2E test.
 * - POST /v1/chat/completions (stream / non-stream)
 * - POST /v1/embeddings
 * Dijalankan: node tests/mock-gateway.mjs [port]
 */
import http from "node:http";

const port = parseInt(process.argv[2] || "20199", 10);

// Scripted non-stream responses berdasarkan hitungan request chat
let chatCount = 0;

function sseChunk(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function handleChatCompletions(body, res) {
  chatCount++;
  if (body.stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // Simulasi <think> terpotong antar chunk (format DeepSeek-R1)
    const deltas = [
      "<thi",
      "nk>Analisis perminta",
      "an pengguna...</think>Hai, ini ",
      "jawaban **streaming**.",
    ];
    (async () => {
      for (const d of deltas) {
        res.write(
          sseChunk({ choices: [{ delta: { content: d }, index: 0 }] })
        );
        await new Promise((r) => setTimeout(r, 5));
      }
      res.write("data: [DONE]\n\n");
      res.end();
    })();
    return;
  }

  // Non-stream: pilih skrip berdasarkan isi prompt (deterministik)
  const sysAndUser = JSON.stringify(body.messages || []);
  let content;
  if (sysAndUser.includes("perencana tugas")) {
    // Planner
    content =
      '[{"step":1,"title":"Tulis file","description":"Tulis hello.txt","tool":"fs_write_artifact"}]';
  } else if (body.tools && sysAndUser.includes("tolak-tools")) {
    // Simulasi gateway/model yang TIDAK mendukung native tools
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: { message: "tools not supported by this model" } })
    );
    return;
  } else if (body.tools && sysAndUser.includes("(belum ada)")) {
    // Agent step 1 + native function calling: tool_calls terstruktur
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_e2e_1",
                  type: "function",
                  function: {
                    name: "fs_write_artifact",
                    arguments: JSON.stringify({
                      filename: "e2e-hello.txt",
                      content: "halo dari e2e",
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })
    );
    return;
  } else if (sysAndUser.includes("(belum ada)")) {
    // Agent step 1: panggil tool (protokol teks — untuk uji fallback)
    content =
      'Baik, saya tulis filenya.\n<toolcall>{"name": "fs_write_artifact", "args": {"filename": "e2e-hello.txt", "content": "halo dari e2e"}}</toolcall>';
  } else {
    // Agent step berikutnya: final
    content = "<think>File sudah tertulis.</think>Selesai! File e2e-hello.txt sudah dibuat.";
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] })
  );
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = req.url || "";
    if (req.method === "POST" && url.endsWith("/chat/completions")) {
      handleChatCompletions(JSON.parse(body || "{}"), res);
    } else if (req.method === "POST" && url.endsWith("/embeddings")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] })
      );
    } else if (req.method === "POST" && url.endsWith("/audio/speech")) {
      const bodyObj = JSON.parse(body || "{}");
      // Input berisi "GAGAL" → simulasi gateway error (untuk uji retry guard).
      if (String(bodyObj.input || "").includes("GAGAL")) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock tts failure" } }));
        return;
      }
      // Sukses: kembalikan byte MP3 palsu.
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(Buffer.from("ID3-mock-mp3-bytes"));
    } else if (req.method === "POST" && url.endsWith("/images/generations")) {
      const bodyObj = JSON.parse(body || "{}");
      // Prompt berisi "GAGAL" → simulasi gateway error (untuk uji retry guard).
      if (String(bodyObj.prompt || "").includes("GAGAL")) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock image failure" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }],
        })
      );
    } else if (req.method === "POST" && url.endsWith("/search")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          results: [
            { title: "Mock Result", url: "https://example.com/1", snippet: "cuplikan mock" },
          ],
        })
      );
    } else if (req.method === "POST" && url.endsWith("/web/fetch")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ title: "Mock Page", content: { text: "isi halaman mock" } })
      );
    } else if (req.method === "GET" && url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-r1" }] }));
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock-gateway listening on 127.0.0.1:${port}`);
  if (process.send) process.send("ready");
});
