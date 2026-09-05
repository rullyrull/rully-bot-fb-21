/**
 * Server-only: analisa performa video yang sudah tayang, lalu ubah
 * strategi (judul/deskripsi + jam tayang) untuk postingan berikutnya.
 * Semua otomatis, tanpa konfirmasi user.
 */

export type StatRow = {
  video_id: string;
  channel_id: string | null;
  title: string | null;
  kind: string | null;
  published_at: string | null;
  views: number;
  likes: number;
  comments: number;
};

/** Ambil statistik video langsung dari YouTube Data API (maks 50 id per panggilan). */
async function fetchStats(videoIds: string[], accessToken: string) {
  const out: Array<{
    id: string;
    title: string;
    publishedAt: string | null;
    views: number;
    likes: number;
    comments: number;
  }> = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "statistics,snippet");
    url.searchParams.set("id", batch.join(","));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`YouTube stats gagal [${res.status}]: ${await res.text()}`);
    const json = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet?: { title?: string; publishedAt?: string };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      }>;
    };
    for (const item of json.items ?? []) {
      out.push({
        id: item.id,
        title: item.snippet?.title ?? "",
        publishedAt: item.snippet?.publishedAt ?? null,
        views: Number(item.statistics?.viewCount ?? 0),
        likes: Number(item.statistics?.likeCount ?? 0),
        comments: Number(item.statistics?.commentCount ?? 0),
      });
    }
  }
  return out;
}

/** Segarkan statistik semua video yang sudah tayang (maks 60 terbaru per channel). */
export async function collectVideoStats(minAgeMinutes = 30) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getValidAccessToken } = await import("./youtube.server");

  // Hemat kuota API: cukup segarkan tiap 30 menit, bukan tiap menit.
  const { data: fresh } = await supabaseAdmin
    .from("video_stats")
    .select("checked_at")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fresh?.checked_at && Date.now() - new Date(fresh.checked_at).getTime() < minAgeMinutes * 60_000) {
    return { channels: 0, videos: 0, skipped: true };
  }


  const { data: uploads } = await supabaseAdmin
    .from("uploads")
    .select("video_id, channel_id, channel_title, title, kind, created_at")
    .eq("status", "done")
    .not("video_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);

  const byChannel = new Map<string, Array<{ videoId: string; title: string; kind: string }>>();
  for (const row of uploads ?? []) {
    const cid = row.channel_id ?? "";
    if (!cid || cid === "__drive__") continue;
    const list = byChannel.get(cid) ?? [];
    if (list.length >= 60) continue;
    list.push({ videoId: row.video_id!, title: row.title, kind: row.kind });
    byChannel.set(cid, list);
  }

  let updated = 0;
  for (const [channelId, items] of byChannel) {
    try {
      const token = await getValidAccessToken(channelId);
      const stats = await fetchStats(items.map((i) => i.videoId), token);
      if (stats.length === 0) continue;
      const kinds = new Map(items.map((i) => [i.videoId, i.kind]));
      const { error } = await supabaseAdmin.from("video_stats").upsert(
        stats.map((s) => ({
          video_id: s.id,
          channel_id: channelId,
          title: s.title,
          kind: kinds.get(s.id) ?? null,
          published_at: s.publishedAt,
          views: s.views,
          likes: s.likes,
          comments: s.comments,
          checked_at: new Date().toISOString(),
        })),
        { onConflict: "video_id" },
      );
      if (error) throw new Error(error.message);
      updated += stats.length;
    } catch (err) {
      console.error("[analytics stats]", channelId, err instanceof Error ? err.message : err);
    }
  }
  return { channels: byChannel.size, videos: updated };
}

/** Jam lokal (channel) dari timestamp UTC. */
function localHour(iso: string, timeZone: string) {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(
      new Date(iso),
    );
    return Number(h);
  } catch {
    return new Date(iso).getUTCHours();
  }
}

/** Cari jam tayang dengan rata-rata view tertinggi. */
export function bestHoursFrom(rows: StatRow[], timeZone: string, want = 3) {
  const buckets = new Map<number, { total: number; n: number }>();
  for (const r of rows) {
    if (!r.published_at) continue;
    const h = localHour(r.published_at, timeZone);
    const b = buckets.get(h) ?? { total: 0, n: 0 };
    b.total += r.views;
    b.n += 1;
    buckets.set(h, b);
  }
  const ranked = [...buckets.entries()]
    .filter(([, b]) => b.n >= 2)
    .map(([h, b]) => ({ hour: h, avg: b.total / b.n }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, want)
    .map((x) => x.hour)
    .sort((a, b) => a - b);
  return ranked.map((h) => `${String(h).padStart(2, "0")}:30`);
}

/** Minta AI merangkum pola judul yang berhasil vs gagal. */
async function askGuidance(input: {
  channelTitle: string | null;
  top: StatRow[];
  bottom: StatRow[];
}): Promise<string | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;
  const fmt = (r: StatRow) => `- "${r.title}" — ${r.views} view, ${r.likes} like`;
  const prompt = [
    `Kamu analis pertumbuhan YouTube untuk channel dakwah "${input.channelTitle ?? "-"}".`,
    "Video dengan performa TERBAIK:",
    input.top.map(fmt).join("\n"),
    "Video dengan performa TERBURUK:",
    input.bottom.map(fmt).join("\n"),
    "Simpulkan pola konkret yang membuat judul/deskripsi berhasil di channel ini (panjang judul, gaya kalimat, kata pemicu emosi, penggunaan tanda tanya/angka, topik yang laku, hal yang harus dihindari).",
    "Balas maksimal 8 poin singkat berbahasa Indonesia dalam bentuk daftar, langsung bisa dipakai sebagai instruksi penulisan judul berikutnya. Tanpa basa-basi.",
  ].join("\n");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.7-flash",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    // 402/403 = kredit habis / diblokir: berhenti tanpa retry.
    console.error(`[analytics guidance] gagal ${res.status}: ${await res.text()}`);
    return null;
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (json.choices?.[0]?.message?.content ?? "").trim() || null;
}

/**
 * Perbarui strategi tiap channel: pola judul (AI) + jam tayang terbaik (data),
 * lalu terapkan langsung ke konfigurasi autopilot channel tersebut.
 * Hanya diperbarui bila insight terakhir sudah lebih dari 6 jam.
 */
export async function refreshChannelInsights(minAgeMinutes = 360) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: autopilots } = await supabaseAdmin
    .from("channel_autopilot")
    .select("channel_id, channel_title, timezone, slot_times, enabled")
    .eq("enabled", true);

  const { data: existing } = await supabaseAdmin
    .from("channel_insights")
    .select("channel_id, updated_at");
  const lastRun = new Map((existing ?? []).map((r) => [r.channel_id, r.updated_at]));

  const results: Array<{ channelId: string; applied: boolean; bestHours?: string; note?: string }> = [];

  for (const ap of autopilots ?? []) {
    const prev = lastRun.get(ap.channel_id);
    if (prev && Date.now() - new Date(prev).getTime() < minAgeMinutes * 60_000) continue;

    try {
      const { data: statsRaw } = await supabaseAdmin
        .from("video_stats")
        .select("video_id, channel_id, title, kind, published_at, views, likes, comments")
        .eq("channel_id", ap.channel_id)
        .order("published_at", { ascending: false })
        .limit(80);

      const stats = (statsRaw ?? []) as StatRow[];
      if (stats.length < 5) {
        results.push({ channelId: ap.channel_id, applied: false, note: "data belum cukup" });
        continue;
      }

      const sorted = [...stats].sort((a, b) => b.views - a.views);
      const top = sorted.slice(0, 8);
      const bottom = sorted.slice(-8).reverse();
      const avgViews = stats.reduce((s, r) => s + r.views, 0) / stats.length;

      const guidance = await askGuidance({
        channelTitle: ap.channel_title,
        top,
        bottom,
      }).catch(() => null);

      const hours = bestHoursFrom(stats, ap.timezone || "Asia/Makassar");
      const bestHours = hours.length >= 2 ? hours.join(",") : null;

      await supabaseAdmin.from("channel_insights").upsert(
        {
          channel_id: ap.channel_id,
          channel_title: ap.channel_title,
          guidance,
          best_hours: bestHours,
          sample_size: stats.length,
          avg_views: Math.round(avgViews),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "channel_id" },
      );

      // Terapkan jam tayang terbaik ke autopilot channel ini.
      if (bestHours && bestHours !== ap.slot_times && stats.length >= 8) {
        await supabaseAdmin
          .from("channel_autopilot")
          .update({ slot_times: bestHours, updated_at: new Date().toISOString() })
          .eq("channel_id", ap.channel_id);
      }

      results.push({ channelId: ap.channel_id, applied: true, ...(bestHours ? { bestHours } : {}) });
    } catch (err) {
      console.error("[analytics insights]", ap.channel_id, err instanceof Error ? err.message : err);
      results.push({
        channelId: ap.channel_id,
        applied: false,
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { channels: results.length, results };
}

/** Ambil panduan tertulis untuk channel (dipakai saat membuat judul baru). */
export async function loadChannelGuidance(channelId: string | null | undefined) {
  if (!channelId) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("channel_insights")
    .select("guidance, best_hours, avg_views, sample_size")
    .eq("channel_id", channelId)
    .maybeSingle();
  return data?.guidance ?? null;
}
