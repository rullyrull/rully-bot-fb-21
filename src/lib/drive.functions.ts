import { createServerFn } from "@tanstack/react-start";

export const listDriveFolderVideos = createServerFn({ method: "POST" })
  .inputValidator((input: {
    folderUrl: string;
    channelId?: string | null;
    channelTitle?: string | null;
  }) => {
    if (!input?.folderUrl?.trim()) throw new Error("Link folder Google Drive wajib diisi.");
    return {
      folderUrl: input.folderUrl.trim(),
      channelId: input.channelId?.trim() || null,
      channelTitle: input.channelTitle?.trim() || null,
    };
  })
  .handler(async ({ data }) => {
    const { parseDriveFolderId, listFolderVideos, listFolderVideosDeep, getDriveFolderName } =
      await import("./drive.server");
    const { resolveChannelFolderId } = await import("./channel-folders.server");
    const { getDriveAccessToken } = await import("./youtube.server");
    const parsed = parseDriveFolderId(data.folderUrl);
    if (!parsed) throw new Error("Link folder Google Drive tidak valid.");
    let accessToken: string;
    try {
      accessToken = await getDriveAccessToken(data.channelId);
    } catch (error) {
      // Belum ada koneksi atau token lama sudah tidak valid: beri instruksi
      // yang sesuai, bukan menyatakan Drive belum pernah dihubungkan.
      return {
        folderId: parsed,
        folderName: null as string | null,
        folders: [] as Awaited<ReturnType<typeof listFolderVideosDeep>>["folders"],
        videos: [] as Awaited<ReturnType<typeof listFolderVideosDeep>>["videos"],
        needsAuth: true as boolean,
        authMessage:
          error instanceof Error
            ? error.message
            : "Hubungkan ulang akun Google Drive untuk memuat folder.",
      };
    }
    const folderId = await resolveChannelFolderId({
      folderUrl: data.folderUrl,
      channelId: data.channelId,
      channelTitle: data.channelTitle,
      accessToken,
    });
    // Tampilkan isi folder ini saja (persis seperti di Google Drive):
    // subfolder ditampilkan sebagai folder, bukan digabung isinya.
    const entries = await listFolderVideos(folderId, accessToken);
    const folders = entries.filter((e) => e.mimeType === "application/vnd.google-apps.folder");
    const videos = entries.filter((e) => e.mimeType !== "application/vnd.google-apps.folder");
    const folderName = await getDriveFolderName(folderId, accessToken);
    return {
      folderId,
      folderName,
      folders,
      videos,
      needsAuth: false as boolean,
      authMessage: null as string | null,
    };
  });


/**
 * Antre semua video di satu folder Drive ke slot jam harian
 * (mis. 06:00, 13:00, 19:00 → video 1, 2, 3, lalu lanjut besok).
 */

/**
 * Jadwalkan video pilihan (urutan sesuai daftar) ke slot jam harian.
 * Video ke-1 → slot pertama, video ke-2 → slot kedua, dst; lanjut hari berikutnya.
 */
export const scheduleSelectedVideos = createServerFn({ method: "POST" })
  .inputValidator((input: {
    folderUrl: string;
    fileIds: string[];
    channelId?: string | null;
    channelTitle?: string | null;
    kind?: string;
    privacy?: string;
    slotTimes: string;
    timezone?: string;
    startDate?: string | null;
  }) => {
    if (!input?.folderUrl?.trim()) throw new Error("Link folder Google Drive wajib diisi.");
    if (!Array.isArray(input?.fileIds) || input.fileIds.length === 0)
      throw new Error("Pilih minimal satu video.");
    if (!input?.slotTimes?.trim()) throw new Error("Isi minimal satu slot jam, contoh 06:00.");
    return {
      folderUrl: input.folderUrl.trim(),
      fileIds: input.fileIds.slice(0, 200),
      channelId: input.channelId?.trim() || null,
      channelTitle: input.channelTitle?.trim() || null,
      kind: input.kind === "reels" ? ("reels" as const) : ("video" as const),
      privacy: ["private", "unlisted", "public"].includes(input.privacy ?? "")
        ? (input.privacy as "private" | "unlisted" | "public")
        : ("public" as const),
      slotTimes: input.slotTimes.trim(),
      timezone: input.timezone?.trim() || "Asia/Makassar",
      startDate: input.startDate?.trim() || null,
    };
  })
  .handler(async ({ data }) => {
    const { listFolderVideosDeep } = await import("./drive.server");
    const { resolveChannelFolderId } = await import("./channel-folders.server");
    const { getDriveAccessToken } = await import("./youtube.server");
    const { buildSlotSchedule } = await import("./schedule.server");
    const { decorateForKind } = await import("./upload-runner.server");
    const { buildTitle, buildDescription } = await import("./video-meta");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const accessToken = await getDriveAccessToken(data.channelId);
    const folderId = await resolveChannelFolderId({
      folderUrl: data.folderUrl,
      channelId: data.channelId,
      channelTitle: data.channelTitle,
      accessToken,
    });
    const files = (await listFolderVideosDeep(folderId, accessToken)).videos;
    const byId = new Map(files.map((f) => [f.id, f]));
    const picked = data.fileIds.map((id) => byId.get(id)).filter(Boolean) as typeof files;
    if (picked.length === 0) throw new Error("Video pilihan tidak ditemukan di folder ini.");

    // Lewati video yang sudah dijadwalkan / diunggah.
    const { data: existing } = await supabaseAdmin
      .from("uploads")
      .select("drive_file_id")
      .in("status", ["scheduled", "uploading", "done"])
      .in("drive_file_id", picked.map((f) => f.id));
    const taken = new Set((existing ?? []).map((r) => r.drive_file_id));
    const pending = picked.filter((f) => !taken.has(f.id));
    if (pending.length === 0)
      return { scheduled: 0, skipped: picked.length, items: [] as Array<{ title: string; scheduledAt: string }> };

    const times = buildSlotSchedule({
      count: pending.length,
      slotTimes: data.slotTimes,
      timeZone: data.timezone,
      startDate: data.startDate,
    });

    const rows = pending.map((file, index) => {
      const { title, description } = decorateForKind({
        driveUrl: file.webViewLink,
        title: buildTitle(file.name, data.channelTitle),
        description: buildDescription(file.name, data.channelTitle),
        privacy: data.privacy,
        channelId: data.channelId,
        kind: data.kind,
      });
      return {
        drive_url: file.webViewLink,
        drive_file_id: file.id,
        title,
        description,
        privacy: data.privacy,
        status: "scheduled",
        scheduled_at: times[index]!.toISOString(),
        kind: data.kind,
        channel_id: data.channelId,
        channel_title: data.channelTitle,
      };
    });

    const { data: inserted, error } = await supabaseAdmin
      .from("uploads")
      .insert(rows)
      .select("title, scheduled_at");
    if (error) throw new Error(error.message);

    const { rememberAutopilot } = await import("./autopilot.server");
    await rememberAutopilot({
      channelId: data.channelId,
      channelTitle: data.channelTitle,
      folderUrl: data.folderUrl,
      slotTimes: data.slotTimes,
      timezone: data.timezone,
      kind: data.kind,
      privacy: data.privacy,
    });

    return {
      scheduled: inserted?.length ?? 0,
      skipped: picked.length - pending.length,
      items: (inserted ?? []).map((r) => ({ title: r.title, scheduledAt: r.scheduled_at! })),
    };
  });
export const autoScheduleFolder = createServerFn({ method: "POST" })
  .inputValidator((input: {
    folderUrl: string;
    channelId?: string | null;
    channelTitle?: string | null;
    kind?: string;
    privacy?: string;
    slotTimes: string;
    timezone?: string;
    startDate?: string | null;
    maxVideos?: number;
    order?: "name" | "modified";
  }) => {
    if (!input?.folderUrl?.trim()) throw new Error("Link folder Google Drive wajib diisi.");
    if (!input?.slotTimes?.trim()) throw new Error("Isi minimal satu slot jam, contoh 06:00.");
    return {
      folderUrl: input.folderUrl.trim(),
      channelId: input.channelId?.trim() || null,
      channelTitle: input.channelTitle?.trim() || null,
      kind: input.kind === "reels" ? ("reels" as const) : ("video" as const),
      privacy: ["private", "unlisted", "public"].includes(input.privacy ?? "")
        ? (input.privacy as "private" | "unlisted" | "public")
        : ("public" as const),
      slotTimes: input.slotTimes.trim(),
      timezone: input.timezone?.trim() || "Asia/Jakarta",
      startDate: input.startDate?.trim() || null,
      maxVideos: Math.min(Math.max(Number(input.maxVideos ?? 50) || 50, 1), 200),
      order: input.order === "modified" ? ("modified" as const) : ("name" as const),
    };
  })
  .handler(async ({ data }) => {
    const { listFolderVideosDeep } = await import("./drive.server");
    const { resolveChannelFolderId } = await import("./channel-folders.server");
    const { getDriveAccessToken } = await import("./youtube.server");
    const { buildSlotSchedule } = await import("./schedule.server");
    const { decorateForKind } = await import("./upload-runner.server");
    const { buildTitle, buildDescription } = await import("./video-meta");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const accessToken = await getDriveAccessToken(data.channelId);
    const folderId = await resolveChannelFolderId({
      folderUrl: data.folderUrl,
      channelId: data.channelId,
      channelTitle: data.channelTitle,
      accessToken,
    });
    const files = (await listFolderVideosDeep(folderId, accessToken)).videos;
    if (files.length === 0) throw new Error("Tidak ada file video di folder ini.");

    files.sort((a, b) =>
      data.order === "modified"
        ? (a.modifiedTime ?? "").localeCompare(b.modifiedTime ?? "")
        : a.name.localeCompare(b.name, "id", { numeric: true }),
    );

    // Lewati video yang sudah dijadwalkan / sedang diunggah / sudah selesai.
    const { data: existing } = await supabaseAdmin
      .from("uploads")
      .select("drive_file_id")
      .in("status", ["scheduled", "uploading", "done"])
      .in("drive_file_id", files.map((f) => f.id));
    const taken = new Set((existing ?? []).map((r) => r.drive_file_id));

    const pending = files.filter((f) => !taken.has(f.id)).slice(0, data.maxVideos);
    if (pending.length === 0) {
      return { scheduled: 0, skipped: files.length, items: [] as Array<{ title: string; scheduledAt: string }> };
    }

    const times = buildSlotSchedule({
      count: pending.length,
      slotTimes: data.slotTimes,
      timeZone: data.timezone,
      startDate: data.startDate,
    });

    const rows = pending.map((file, index) => {
      const { title, description } = decorateForKind({
        driveUrl: file.webViewLink,
        title: buildTitle(file.name, data.channelTitle),
        description: buildDescription(file.name, data.channelTitle),
        privacy: data.privacy,
        channelId: data.channelId,
        kind: data.kind,
      });
      return {
        drive_url: file.webViewLink,
        drive_file_id: file.id,
        title,
        description,
        privacy: data.privacy,
        status: "scheduled",
        scheduled_at: times[index]!.toISOString(),
        kind: data.kind,
        channel_id: data.channelId,
        channel_title: data.channelTitle,
      };
    });

    const { data: inserted, error } = await supabaseAdmin
      .from("uploads")
      .insert(rows)
      .select("title, scheduled_at");
    if (error) throw new Error(error.message);

    const { rememberAutopilot } = await import("./autopilot.server");
    await rememberAutopilot({
      channelId: data.channelId,
      channelTitle: data.channelTitle,
      folderUrl: data.folderUrl,
      slotTimes: data.slotTimes,
      timezone: data.timezone,
      kind: data.kind,
      privacy: data.privacy,
    });

    return {
      scheduled: inserted?.length ?? 0,
      skipped: files.length - pending.length,
      items: (inserted ?? []).map((r) => ({ title: r.title, scheduledAt: r.scheduled_at! })),
    };
  });
