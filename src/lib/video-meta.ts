/** Bangun judul & deskripsi otomatis dari nama file Google Drive. */

const BASE_TAGS = ["reels", "fbreels", "fyp"];

const EXTRA_TAGS = [
  "viral",
  "trending",
  "foryou",
  "videoviral",
  "explore",
  "viralvideo",
  "trendingreels",
];

const STOPWORDS = new Set([
  "dan", "yang", "untuk", "dengan", "di", "ke", "dari", "pada", "atau", "the",
  "and", "for", "with", "you", "your", "video", "final", "copy", "new", "edit",
  "fix", "part", "ver", "hd", "full", "mp4", "mov", "raw", "export", "render",
]);

export function baseNameFromFile(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordTags(base: string) {
  const words = base
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w));

  const tags: string[] = [];
  for (const w of words) {
    if (!tags.includes(w)) tags.push(w);
  }
  // gabungan dua kata pertama sebagai tagar frasa
  if (words.length >= 2) {
    const phrase = words.slice(0, 2).join("");
    if (!tags.includes(phrase)) tags.unshift(phrase);
  }
  return tags.slice(0, 8);
}

/** Preset judul & sumber video per channel. */
type ChannelPreset = {
  match: RegExp;
  prefix: string;
  source: string;
  tags: string[];
};

const CHANNEL_PRESETS: ChannelPreset[] = [
  {
    match: /felix\s*siauw/i,
    prefix: "Barakallah Ustadz Felix Siauw - ",
    source: "Sumber video dari YouTube Ustadz Felix Siauw Official",
    tags: ["ustadzfelixsiauw", "felixsiauw", "kajianislam", "dakwahislam"],
  },
  {
    match: /nasehat\s*dakwah/i,
    prefix: "",
    source: "Sumber video dari YouTube Nasehat Dakwah Official",
    tags: ["nasehatdakwah", "nasihatislami", "kajianislam", "dakwahislam"],
  },
  {
    match: /uah|adi\s*hidayat/i,
    prefix: "Barakallah Ustadz Adi Hidayat - ",
    source: "Sumber video dari YouTube Adi Hidayat Official",
    tags: ["ustadzadihidayat", "uah", "kajianislam", "ceramahsingkat"],
  },
  {
    match: /uas|abdul\s*somad/i,
    prefix: "Barakallah Ustadz Abdul Somad - ",
    source: "Sumber video dari YouTube Ustadz Abdul Somad Official",
    tags: ["ustadzabdulsomad", "uas", "kajianislam", "ceramahsingkat"],
  },
  {
    match: /resep\s*herbal|zaidul\s*akbar/i,
    prefix: "Barakallah Dr Zaidul Akbar - ",
    source: "Sumber video dari YouTube dr. Zaidul Akbar Official",
    tags: ["zaidulakbar", "jsr", "resepherbal", "hidupsehat"],
  },
];

export function findChannelPreset(channelTitle?: string | null) {
  const name = (channelTitle ?? "").trim();
  if (!name) return null;
  return CHANNEL_PRESETS.find((p) => p.match.test(name)) ?? null;
}

export function buildTitle(fileName: string, channelTitle?: string | null) {
  const base = baseNameFromFile(fileName);
  const preset = findChannelPreset(channelTitle);
  const suffix = " #Reels";
  const prefix = preset?.prefix ?? "";
  const room = 100 - suffix.length - prefix.length;
  return `${prefix}${base.slice(0, Math.max(room, 10)).trim()}${suffix}`;
}

/** Maksimal 4 hashtag relevan + #Reels (Facebook menekan distribusi bila over-tagging). */
export function buildHashtags(fileName: string, channelTitle?: string | null) {
  const base = baseNameFromFile(fileName);
  const preset = findChannelPreset(channelTitle);
  const pool = [...(preset?.tags ?? []), ...keywordTags(base), "reels"];
  const unique: string[] = [];
  for (const t of pool) {
    const tag = t.replace(/[^\p{L}\p{N}]/gu, "");
    if (tag && !unique.includes(tag)) unique.push(tag);
    if (unique.length === 4) break;
  }
  if (!unique.includes("reels")) unique.push("reels");
  return unique.slice(0, 5).map((t) => `#${t}`);
}

export function buildDescription(fileName: string, channelTitle?: string | null) {
  const base = baseNameFromFile(fileName);
  const preset = findChannelPreset(channelTitle);
  const headline = `${preset?.prefix ?? ""}${base}`;
  const lines = [
    headline,
    "Tonton sampai habis, ambil satu pelajaran, lalu bagikan ke keluarga & sahabat agar manfaatnya makin luas!",
    preset?.source ?? "Sumber video dari kanal resmi pemilik konten",
    "Jangan lupa like 👍, komentar 💬, share 🔁, dan ikuti halaman ini supaya tidak ketinggalan video terbaru.",
    buildHashtags(fileName, channelTitle).join(" "),
  ];
  return lines.filter(Boolean).join("\n\n");
}


