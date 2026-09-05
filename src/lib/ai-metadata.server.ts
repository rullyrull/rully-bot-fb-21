/**
 * Server-only: buat judul & deskripsi Facebook yang lebih menarik dengan AI,
 * berdasarkan nama file di Google Drive dan konteks Fan Page.
 * Kalau AI gagal / tidak tersedia, pemanggil memakai judul bawaan.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type AiMeta = { title: string; description: string; tags: string[] };

function cleanFileName(name: string) {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateVideoMetadata(input: {
  fileName: string;
  channelTitle: string | null;
  kind: "video" | "reels";
  /** Ringkasan pola yang terbukti berhasil di channel ini (hasil analisa performa). */
  guidance?: string | null;
}): Promise<AiMeta | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;

  const topic = cleanFileName(input.fileName);
  const prompt = [
    `Kamu editor konten Facebook berbahasa Indonesia untuk Fan Page dakwah "${input.channelTitle ?? "-"}".`,
    `Topik video (dari nama file): "${topic}".`,
    input.kind === "reels"
      ? "Format: Facebook Reels vertikal, durasi pendek."
      : "Format: video biasa.",
    input.guidance
      ? `Pelajaran dari performa video halaman ini (WAJIB diikuti):\n${input.guidance}`
      : "",
    "Buat metadata yang natural dan mengundang klik, TANPA clickbait berlebihan, TANPA huruf kapital semua, TANPA kata 'viral/fyp/trending'.",
    "Balas HANYA JSON dengan bentuk:",
    '{"title": "judul maksimal 80 karakter", "description": "2-4 kalimat deskripsi natural", "tags": ["maks 10 tag relevan"]}',
  ].filter(Boolean).join("\n");


  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`AI metadata gagal [${res.status}]: ${body}`);
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as Partial<AiMeta>;
    const title = (parsed.title ?? "").trim();
    if (!title) return null;

    return {
      title: title.slice(0, 95),
      description: (parsed.description ?? "").trim().slice(0, 3000),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === "string").slice(0, 10)
        : [],
    };
  } catch (err) {
    console.error("AI metadata error:", err);
    return null;
  }
}
