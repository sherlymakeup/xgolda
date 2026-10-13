import { nanoid } from "nanoid";
import { gatewayModel, gatewayPost, saveBinaryArtifact } from "./gateway.ts";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";
import { arg } from "./types.ts";
import { claimGenerateSlot, markGenerateDone } from "./generate-guard.ts";

const MAX_TEXT = 4000;

async function textToSpeech(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const text = arg(args.text).trim();
  if (!text) return { ok: false, output: "ERROR: 'text' wajib diisi" };
  if (text.length > MAX_TEXT) {
    return { ok: false, output: `ERROR: 'text' maksimal ${MAX_TEXT} karakter (dapat ${text.length})` };
  }
  // Guard bersama (1x sukses maks / 2x percobaan bila gagal) — lihat generate-guard.ts.
  const blocked = claimGenerateSlot("text_to_speech", ctx);
  if (blocked) return { ok: false, output: blocked };
  // Model & voice terpisah: `voice` adalah ID voice (mis. ElevenLabs),
  // BUKAN model. Keduanya bisa di-override per panggilan via args,
  // atau default dari config (TTS_MODEL / TTS_VOICE, bisa diubah di
  // halaman Update Config tanpa restart).
  const model = arg(args.model).trim() || (await gatewayModel("TTS_MODEL"));
  const voice = arg(args.voice).trim() || (await gatewayModel("TTS_VOICE"));

  const body: Record<string, unknown> = { model, input: text };
  // Voice kosong → jangan kirim field-nya, biar gateway pakai default-nya.
  if (voice) body.voice = voice;
  const r = await gatewayPost({
    path: "/v1/audio/speech",
    body,
    timeoutMs: 120000,
  });
  if (!r.ok) return { ok: false, output: `ERROR: ${r.error}` };

  // Default respons = raw bytes mp3; varian json {audio: base64} juga didukung.
  let audio: Buffer | null = null;
  if (r.json && typeof r.json.audio === "string" && r.json.audio.length > 0) {
    audio = Buffer.from(r.json.audio, "base64");
  } else if (r.raw && r.raw.length > 0) {
    audio = r.raw;
  }
  if (!audio || audio.length === 0) {
    return { ok: false, output: "ERROR: audio kosong dari gateway" };
  }

  const filename = `tts-${nanoid(8)}.mp3`;
  await saveBinaryArtifact(filename, audio, "mp3", ctx.sessionId);
  markGenerateDone("text_to_speech", ctx, filename);
  return {
    ok: true,
    output: `Audio tersimpan: ${filename} (${audio.length} bytes)${ctx.sessionId ? " — salinan ada di folder workspace thread" : ""}. Buka di Artifacts & Studio untuk memutar.`,
  };
}

export const ttsTool: ToolDefinition = {
  name: "text_to_speech",
  description:
    "Gunakan ketika user meminta teks diubah menjadi suara, audio, voiceover, atau narasi (mis. 'bacakan teks ini', 'buatkan voiceover untuk...'). Menghasilkan file MP3 via gateway dan menyimpannya sebagai artifact yang bisa diputar di Studio. Jangan dipakai untuk transkrip (itu arah sebaliknya). PENTING: `text` HARUS persis sama dengan naskah yang user berikan — JANGAN parafrase, JANGAN tambah/kurangi satu kata pun, JANGAN ubah ejaan/tanda baca. MAKSIMAL 1x generate per goal + 1x retry bila gagal (sistem menolak panggilan berikutnya). Bila tool mengembalikan error 'SUDAH berhasil', JANGAN panggil lagi — pakai file tersebut dan tulis jawaban final. Naskah >4000 karakter ditolak tool; jangan pecah sendiri.",
  parameters: {
    text: { type: "string", description: "Teks yang dibacakan PERSIS APA ADANYA sesuai naskah user (maks 4000 karakter). JANGAN parafrase, tambah, atau kurangi.", required: true },
    model: { type: "string", description: "Model TTS opsional — kosongkan untuk default config TTS_MODEL" },
    voice: { type: "string", description: "ID voice opsional (mis. ID voice ElevenLabs) — kosongkan untuk default config TTS_VOICE" },
  },
  handler: async (args, ctx) => textToSpeech(args, ctx),
};
