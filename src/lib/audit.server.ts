/**
 * Server-only: audit 1 jam setelah video tayang.
 * Aturan:
 * - Jika 1 jam setelah upload view masih < 100 (atau video diblokir/ditolak YouTube),
 *   video dihapus dari YouTube lalu digantikan video baru dari folder Drive channel.
 * - Jika view sudah mencapai 100, biarkan dan lanjut ke jadwal berikutnya.
 */

const MIN_VIEWS = 100;
const AUDIT_AFTER_MINUTES = 60;
const AUDIT_WINDOW_HOURS = 24; // jangan audit video yang sudah terlalu lama

type VideoCheck = {
  views: number;
  blocked: boolean;
  reason: string | null;
  exists: boolean;
};

/** Ambil view + status pemblokiran satu video. */
async function checkVideo(videoId: string, accessToken: string): Promise<VideoCheck> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics,status,contentDetails");
  url.searchParams.set("id", videoId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gagal cek video [${res.status}]: ${await res.text()}`);
  const json = (await res.json()) as {
    items?: Array<{
      statistics?: { viewCount?: string };
      status?: { uploadStatus?: string; rejectionReason?: string; privacyStatus?: string };
      contentDetails?: { regionRestriction?: { blocked?: string[] } };
    }>;
  };
  const item = json.items?.[0];
  if (!item) return { views: 0, blocked: false, reason: "video tidak ditemukan", exists: false };

  const views = Number(item.statistics?.viewCount ?? 0);
  const uploadStatus = item.status?.uploadStatus ?? "";
  const rejection = item.status?.rejectionReason ?? null;
  const regionBlocked = (item.contentDetails?.regionRestriction?.blocked ?? []).length > 0;
  const blocked = uploadStatus === "rejected" || uploadStatus === "failed" || !!rejection || regionBlocked;

  return {
    views,
    blocked,
    reason: blocked ? (rejection ?? (regionBlocked ? "diblokir di sebagian wilayah" : uploadStatus)) : null,
    exists: true,
  };
}

/** Hapus video dari YouTube. */
async function deleteVideo(videoId: string, accessToken: string) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${videoId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Gagal hapus video [${res.status}]: ${await res.text()}`);
  }
}

/** Jadwalkan satu video pengganti dari folder channel secepatnya. */
async function queueReplacement(channelId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { scanAutopilot } = await import("./autopilot.server");
  const { data } = await supabaseAdmin
    .from("channel_autopilot")
    .select("*")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!data) return false;
  const res = await scanAutopilot({
    id: data.id,
    channel_id: data.channel_id,
    channel_title: data.channel_title,
    folder_url: data.folder_url,
    slot_times: data.slot_times,
    timezone: data.timezone,
    kind: data.kind,
    privacy: data.privacy,
    max_per_scan: 1,
    enabled: data.enabled,
    last_scan_at: data.last_scan_at,
    last_scan_result: data.last_scan_result,
  });
  return res.scheduled > 0;
}

/**
 * Periksa semua video yang sudah tayang lebih dari 1 jam dan belum pernah diaudit.
 */
export async function auditPublishedUploads(limit = 10) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getValidAccessToken } = await import("./youtube.server");

  const cutoff = new Date(Date.now() - AUDIT_AFTER_MINUTES * 60_000).toISOString();
  const oldest = new Date(Date.now() - AUDIT_WINDOW_HOURS * 3_600_000).toISOString();

  const { data } = await supabaseAdmin
    .from("uploads")
    .select("id, video_id, channel_id, channel_title, title, published_at, updated_at, audited_at")
    .eq("status", "done")
    .is("audited_at", null)
    .not("video_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(200);

  const rows = (data ?? [])
    .filter((row) => {
      const publishedAt = row.published_at ?? row.updated_at;
      return publishedAt <= cutoff && publishedAt >= oldest;
    })
    .slice(0, limit);
  const results: Array<{
    videoId: string;
    views?: number;
    action: "kept" | "removed" | "error";
    reason?: string;
    replaced?: boolean;
  }> = [];

  for (const row of rows) {
    const videoId = row.video_id;
    if (!videoId) continue;
    try {
      const token = await getValidAccessToken(row.channel_id);
      const check = await checkVideo(videoId, token);

      const shouldRemove = check.exists && (check.views < MIN_VIEWS || check.blocked);

      if (!check.exists) {
        await supabaseAdmin
          .from("uploads")
          .update({ audited_at: new Date().toISOString(), audit_result: "video tidak ditemukan di YouTube" })
          .eq("id", row.id);
        results.push({ videoId, action: "error", reason: "tidak ditemukan" });
        continue;
      }

      if (!shouldRemove) {
        await supabaseAdmin
          .from("uploads")
          .update({
            audited_at: new Date().toISOString(),
            audit_result: `Lolos audit 1 jam — ${check.views} view`,
          })
          .eq("id", row.id);
        results.push({ videoId, views: check.views, action: "kept" });
        continue;
      }

      await deleteVideo(videoId, token);
      const reason = check.blocked
        ? `terblokir (${check.reason})`
        : `hanya ${check.views} view dalam 1 jam`;

      let replaced = false;
      if (row.channel_id) {
        replaced = await queueReplacement(row.channel_id).catch(() => false);
      }

      await supabaseAdmin
        .from("uploads")
        .update({
          status: "removed",
          audited_at: new Date().toISOString(),
          audit_result: `Dihapus otomatis: ${reason}${replaced ? " — pengganti dijadwalkan" : ""}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      results.push({ videoId, views: check.views, action: "removed", reason, replaced });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[audit]", videoId, message);
      results.push({ videoId, action: "error", reason: message });
    }
  }

  return { checked: rows.length, results };
}
