/**
 * Server-only: pemindaian otomatis folder Google Drive per channel.
 * Setiap kali dijalankan, video baru yang belum pernah dijadwalkan
 * akan dimasukkan ke antrean upload pada slot jam berikutnya.
 */

export type AutopilotRow = {
  id: string;
  channel_id: string;
  channel_title: string | null;
  folder_url: string;
  slot_times: string;
  timezone: string;
  kind: string;
  privacy: string;
  max_per_scan: number;
  enabled: boolean;
  last_scan_at: string | null;
  last_scan_result: string | null;
};

/** Pindai satu konfigurasi autopilot dan jadwalkan video baru. */
export async function scanAutopilot(row: AutopilotRow) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { listFolderVideosDeep } = await import("./drive.server");
  const { resolveChannelFolderId } = await import("./channel-folders.server");
  const { getDriveAccessToken } = await import("./youtube.server");
  const { buildSlotSchedule } = await import("./schedule.server");
  const { decorateForKind } = await import("./upload-runner.server");
  const { buildTitle, buildDescription } = await import("./video-meta");

  const accessToken = await getDriveAccessToken(row.channel_id);
  const folderId = await resolveChannelFolderId({
    folderUrl: row.folder_url,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    accessToken,
  });
  const files = (await listFolderVideosDeep(folderId, accessToken)).videos;
  files.sort((a, b) => a.name.localeCompare(b.name, "id", { numeric: true }));

  if (files.length === 0) return { scheduled: 0, skipped: 0, items: [] as Array<{ title: string; scheduledAt: string }> };

  // Lewati video yang sudah pernah masuk antrean / diunggah.
  const { data: existing } = await supabaseAdmin
    .from("uploads")
    .select("drive_file_id")
    .eq("channel_id", row.channel_id)
    .in("status", ["scheduled", "uploading", "done"])
    .in("drive_file_id", files.map((f) => f.id));
  const taken = new Set((existing ?? []).map((r) => r.drive_file_id));

  const pending = files.filter((f) => !taken.has(f.id)).slice(0, row.max_per_scan);
  if (pending.length === 0) return { scheduled: 0, skipped: files.length, items: [] };

  // Lanjutkan antrean setelah jadwal terakhir channel ini agar slot tidak bentrok.
  const { data: lastRow } = await supabaseAdmin
    .from("uploads")
    .select("scheduled_at")
    .eq("channel_id", row.channel_id)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = new Date(Date.now() + 60_000);
  const lastAt = lastRow?.scheduled_at ? new Date(lastRow.scheduled_at) : null;
  const startAfter = lastAt && lastAt.getTime() > now.getTime() ? lastAt : now;

  const kind = row.kind === "reels" ? ("reels" as const) : ("video" as const);
  const privacy = (["private", "unlisted", "public"].includes(row.privacy)
    ? row.privacy
    : "public") as "private" | "unlisted" | "public";

  const times = buildSlotSchedule({
    count: pending.length,
    slotTimes: row.slot_times,
    timeZone: row.timezone,
    startAfter,
  });

  const { generateVideoMetadata } = await import("./ai-metadata.server");
  const { loadChannelGuidance } = await import("./analytics.server");
  const guidance = await loadChannelGuidance(row.channel_id).catch(() => null);

  const rows = await Promise.all(
    pending.map(async (file, index) => {
      // Judul/deskripsi dibuat AI dari nama file + pelajaran performa channel.
      const ai = await generateVideoMetadata({
        fileName: file.name,
        channelTitle: row.channel_title,
        kind,
        guidance,
      }).catch(() => null);


      const { title, description } = decorateForKind({
        driveUrl: file.webViewLink,
        title: ai?.title || buildTitle(file.name, row.channel_title),
        description: ai?.description || buildDescription(file.name, row.channel_title),
        privacy,
        channelId: row.channel_id,
        kind,
      });
      return {
        drive_url: file.webViewLink,
        drive_file_id: file.id,
        title,
        description,
        privacy,
        status: "scheduled",
        scheduled_at: times[index]!.toISOString(),
        kind,
        channel_id: row.channel_id,
        channel_title: row.channel_title,
      };
    }),
  );


  const { data: inserted, error } = await supabaseAdmin
    .from("uploads")
    .insert(rows)
    .select("title, scheduled_at");
  if (error) throw new Error(error.message);

  return {
    scheduled: inserted?.length ?? 0,
    skipped: files.length - pending.length,
    items: (inserted ?? []).map((r) => ({ title: r.title, scheduledAt: r.scheduled_at! })),
  };
}

/** Pindai semua channel yang autopilot-nya aktif. */
export async function scanAllAutopilots() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Pastikan channel yang sudah pernah dijadwalkan ikut dipantau otomatis.
  await backfillAutopilotsFromUploads().catch((e) => {
    console.error("[autopilot backfill] gagal:", e instanceof Error ? e.message : e);
    return 0;
  });
  const { data } = await supabaseAdmin
    .from("channel_autopilot")
    .select("*")
    .eq("enabled", true);

  const rows = (data ?? []) as AutopilotRow[];
  const results: Array<{
    channelId: string;
    channelTitle: string | null;
    scheduled: number;
    skipped: number;
    error?: string;
  }> = [];

  for (const row of rows) {
    try {
      const res = await scanAutopilot(row);
      results.push({
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        scheduled: res.scheduled,
        skipped: res.skipped,
      });
      await supabaseAdmin
        .from("channel_autopilot")
        .update({
          last_scan_at: new Date().toISOString(),
          last_scan_result: `${res.scheduled} video baru dijadwalkan`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        scheduled: 0,
        skipped: 0,
        error: message,
      });
      await supabaseAdmin
        .from("channel_autopilot")
        .update({
          last_scan_at: new Date().toISOString(),
          last_scan_result: `Gagal: ${message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  return { channels: results.length, results };
}

/**
 * Daftarkan/segarkan konfigurasi autopilot untuk sebuah channel.
 * Dipanggil setiap kali user menjadwalkan video dari folder Drive,
 * supaya pemeriksaan berkala langsung aktif tanpa langkah tambahan.
 */
export async function rememberAutopilot(input: {
  channelId?: string | null;
  channelTitle?: string | null;
  folderUrl: string;
  slotTimes: string;
  timezone: string;
  kind: string;
  privacy: string;
}) {
  if (!input.channelId || !input.folderUrl?.trim()) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upsertError } = await supabaseAdmin.from("channel_autopilot").upsert(
      {
        channel_id: input.channelId,
        channel_title: input.channelTitle ?? null,
        folder_url: input.folderUrl.trim(),
        slot_times: input.slotTimes,
        timezone: input.timezone,
        kind: input.kind,
        privacy: input.privacy,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" },
    );
    if (upsertError) console.error("[autopilot remember]", input.channelId, upsertError.message);
  } catch (err) {
    console.error("[autopilot remember] gagal:", err instanceof Error ? err.message : err);
  }
}

/**
 * Pulihkan konfigurasi autopilot yang belum ada:
 * untuk setiap channel yang pernah dijadwalkan tapi belum punya baris autopilot,
 * folder Drive-nya ditebak dari folder induk file yang pernah dijadwalkan.
 */
export async function backfillAutopilotsFromUploads() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getDriveFileParentId } = await import("./drive.server");
  const { getDriveAccessToken } = await import("./youtube.server");

  const [{ data: existing }, { data: uploads }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("channel_autopilot").select("channel_id"),
    supabaseAdmin
      .from("uploads")
      .select("channel_id, channel_title, drive_file_id, created_at")
      .not("channel_id", "is", null)
      .not("drive_file_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin.from("app_settings").select("slot_times, timezone, default_kind, default_privacy").limit(1),
  ]);

  const configured = new Set((existing ?? []).map((r) => r.channel_id));
  const seen = new Map<string, { title: string | null; fileId: string }>();
  for (const row of uploads ?? []) {
    const cid = row.channel_id!;
    if (cid === "__drive__" || configured.has(cid) || seen.has(cid)) continue;
    seen.set(cid, { title: row.channel_title ?? null, fileId: row.drive_file_id! });
  }
  console.error("[autopilot backfill] kandidat:", seen.size, "uploads:", (uploads ?? []).length, "existing:", configured.size);
  if (seen.size === 0) return 0;

  const s = settings?.[0];
  let created = 0;
  for (const [channelId, info] of seen) {
    try {
      const accessToken = await getDriveAccessToken(channelId);
      const parentId = await getDriveFileParentId(info.fileId, accessToken);
      if (!parentId) continue;
      await rememberAutopilot({
        channelId,
        channelTitle: info.title,
        folderUrl: `https://drive.google.com/drive/folders/${parentId}`,
        slotTimes: s?.slot_times ?? "06:00,13:00,19:00",
        timezone: s?.timezone ?? "Asia/Makassar",
        kind: s?.default_kind ?? "reels",
        privacy: s?.default_privacy ?? "public",
      });
      created += 1;
    } catch (err) {
      console.error("[autopilot backfill]", channelId, err instanceof Error ? err.message : err);
    }
  }
  return created;
}
