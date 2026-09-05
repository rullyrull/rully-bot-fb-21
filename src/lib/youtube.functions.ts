import { createServerFn } from "@tanstack/react-start";
import { validateUploadInput } from "./upload-input";

export const getYoutubeStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { getFacebookCredentials, facebookRedirectUri, loadPageAccounts } = await import("./facebook.server");
  const { hasDriveConnection } = await import("./youtube.server");
  const { getRequest } = await import("@tanstack/react-start/server");
  const redirectUri = facebookRedirectUri(new URL(getRequest().url).origin);
  const { appId, appSecret } = getFacebookCredentials();
  const configured = Boolean(appId && appSecret);
  if (!configured)
    return {
      configured: false,
      connected: false,
      driveConnected: false,
      channelTitle: null,
      accounts: [],
      redirectUri,
    };
  let accounts: Awaited<ReturnType<typeof loadPageAccounts>> = [];
  try {
    accounts = await loadPageAccounts();
  } catch (error) {
    // PGRST303 "JWT issued at future" = selisih jam antara server dan backend.
    // Coba sekali lagi setelah jeda singkat, lalu degradasi dengan aman.
    const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
    if (/issued at future/i.test(message)) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        accounts = await loadPageAccounts();
      } catch {
        return {
          configured: true,
          connected: false,
          driveConnected: false,
          channelTitle: null,
          accounts: [],
          redirectUri,
        };
      }
    } else {
      throw error;
    }
  }
  let driveConnected = false;
  try {
    driveConnected = await hasDriveConnection();
  } catch {
    driveConnected = false;
  }
  return {
    configured: true,
    connected: accounts.length > 0,
    driveConnected,
    channelTitle: accounts[0]?.channel_title ?? null,
    accounts: accounts.map((a) => ({ id: a.channel_id, title: a.channel_title })),
    redirectUri,
  };
});

export const getYoutubeAuthUrl = createServerFn({ method: "POST" })
  .handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const origin = new URL(getRequest().url).origin;
  const { buildFacebookAuthUrl } = await import("./facebook.server");
  return { url: buildFacebookAuthUrl(origin) };
});

/**
 * Login terpisah khusus izin Google Drive (pakai akun Google biasa, bukan
 * Brand Account) supaya daftar folder & unduhan file tetap bisa dibaca.
 */
export const getDriveAuthUrl = createServerFn({ method: "POST" }).handler(async () => {
  const { getGoogleCredentials, redirectUriFor, DRIVE_SCOPE } = await import("./youtube.server");
  const { getRequest } = await import("@tanstack/react-start/server");
  const origin = new URL(getRequest().url).origin;
  const { clientId, clientSecret } = getGoogleCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Kredensial Google OAuth belum diatur.");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(origin),
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent select_account",
    state: "drive",
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
});

export const disconnectDrive = createServerFn({ method: "POST" }).handler(async () => {
  const { deleteAccount, DRIVE_ACCOUNT_ID } = await import("./youtube.server");
  await deleteAccount(DRIVE_ACCOUNT_ID);
  return { ok: true };
});

export const listYoutubeChannels = createServerFn({ method: "GET" }).handler(async () => {
  // "Channel" kini berarti Fan Page Facebook; token halaman long-lived
  // disimpan di database saat login, jadi cukup dibaca dari sana.
  const { loadPageAccounts } = await import("./facebook.server");
  const pages = await loadPageAccounts();
  return pages.map((p) => ({
    id: p.channel_id,
    title: p.channel_title ?? p.channel_id,
    thumbnail: null as string | null,
  }));
});

export const getAppSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select(
      "default_channel_id, default_channel_title, default_kind, default_privacy, default_description, slot_times, timezone",
    )
    .eq("id", "default")
    .maybeSingle();
  return {
    channelId: data?.default_channel_id ?? "",
    channelTitle: data?.default_channel_title ?? "",
    kind: data?.default_kind === "reels" ? "reels" : "video",
    privacy: data?.default_privacy ?? "public",
    description: data?.default_description ?? "",
    slotTimes: data?.slot_times ?? "06:00,13:00,19:00",
    timezone: data?.timezone ?? "Asia/Jakarta",
  };
});

export const saveAppSettings = createServerFn({ method: "POST" })
  .inputValidator((input: {
    channelId?: string | null;
    channelTitle?: string | null;
    kind?: string;
    privacy?: string;
    description?: string;
    slotTimes?: string;
    timezone?: string;
  }) => ({
    channelId: input.channelId?.trim() || null,
    channelTitle: input.channelTitle?.trim() || null,
    kind: input.kind === "reels" ? "reels" : "video",
    privacy: ["private", "unlisted", "public"].includes(input.privacy ?? "")
      ? input.privacy!
      : "public",
    description: (input.description ?? "").slice(0, 4500),
    slotTimes: input.slotTimes?.trim() || "06:00,13:00,19:00",
    timezone: input.timezone?.trim() || "Asia/Jakarta",
  }))
  .handler(async ({ data }) => {
    const { parseSlotTimes } = await import("./schedule.server");
    parseSlotTimes(data.slotTimes); // validasi format HH:MM
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert(
      {
        id: "default",
        default_channel_id: data.channelId,
        default_channel_title: data.channelTitle,
        default_kind: data.kind,
        default_privacy: data.privacy,
        default_description: data.description,
        slot_times: data.slotTimes,
        timezone: data.timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const disconnectYoutube = createServerFn({ method: "POST" })
  .inputValidator((input?: { channelId?: string | null }) => ({
    channelId: input?.channelId?.trim() || null,
  }))
  .handler(async ({ data }) => {
    const { deleteAccount } = await import("./youtube.server");
    await deleteAccount(data.channelId);
    return { ok: true };
  });

export const listUploads = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("uploads")
    .select(
      "id, title, drive_url, drive_file_id, status, video_id, error, created_at, scheduled_at, kind, channel_title, channel_id",
    )
    .order("created_at", { ascending: false })
    .limit(30);
  return data ?? [];
});


export const uploadFromDrive = createServerFn({ method: "POST" })
  .inputValidator(validateUploadInput)
  .handler(async ({ data }) => {
    const { decorateForKind, runUploadRow } = await import("./upload-runner.server");
    const { parseDriveFileId } = await import("./youtube.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { title, description } = decorateForKind({
      driveUrl: data.driveUrl,
      title: data.title,
      description: data.description,
      privacy: data.privacy,
      channelId: data.channelId,
      kind: data.kind,
    });

    const { data: row } = await supabaseAdmin
      .from("uploads")
      .insert({
        drive_url: data.driveUrl,
        drive_file_id: parseDriveFileId(data.driveUrl),
        title,
        description,
        privacy: data.privacy,
        status: "uploading",
        kind: data.kind,
        channel_id: data.channelId,
        channel_title: data.channelTitle,
      })
      .select("id")
      .single();

    if (!row?.id) throw new Error("Gagal membuat catatan upload.");

    return await runUploadRow(row.id, {
      driveUrl: data.driveUrl,
      title,
      description,
      privacy: data.privacy,
      channelId: data.channelId,
      kind: data.kind,
    });
  });

/** Simpan pekerjaan upload untuk dijalankan pada waktu tertentu. */
export const scheduleUpload = createServerFn({ method: "POST" })
  .inputValidator(validateUploadInput)
  .handler(async ({ data }) => {
    if (!data.scheduledAt) throw new Error("Waktu jadwal wajib diisi.");
    const { decorateForKind } = await import("./upload-runner.server");
    const { parseDriveFileId } = await import("./youtube.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!parseDriveFileId(data.driveUrl)) throw new Error("Link Google Drive tidak valid.");

    const { title, description } = decorateForKind({
      driveUrl: data.driveUrl,
      title: data.title,
      description: data.description,
      privacy: data.privacy,
      channelId: data.channelId,
      kind: data.kind,
    });

    const { data: row, error } = await supabaseAdmin
      .from("uploads")
      .insert({
        drive_url: data.driveUrl,
        drive_file_id: parseDriveFileId(data.driveUrl),
        title,
        description,
        privacy: data.privacy,
        status: "scheduled",
        scheduled_at: data.scheduledAt,
        kind: data.kind,
        channel_id: data.channelId,
        channel_title: data.channelTitle,
      })
      .select("id, scheduled_at")
      .single();
    if (error) throw new Error(error.message);
    return { id: row?.id ?? null, scheduledAt: row?.scheduled_at ?? data.scheduledAt };
  });

/** Batalkan satu jadwal yang belum berjalan. */
export const cancelScheduledUpload = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("ID jadwal wajib diisi.");
    return { id: input.id };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("uploads")
      .delete()
      .eq("id", data.id)
      .eq("status", "scheduled");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Hapus semua jadwal yang belum berjalan (opsional: hanya satu channel). */
export const cancelAllScheduledUploads = createServerFn({ method: "POST" })
  .inputValidator((input?: { channelId?: string | null }) => ({
    channelId: input?.channelId ?? null,
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("uploads").delete().eq("status", "scheduled");
    if (data.channelId) q = q.eq("channel_id", data.channelId);
    const { data: rows, error } = await q.select("id");
    if (error) throw new Error(error.message);
    return { deleted: rows?.length ?? 0 };
  });

/** Jalankan semua jadwal yang sudah jatuh tempo. */
export const runDueUploads = createServerFn({ method: "POST" }).handler(async () => {
  const { processDueUploads } = await import("./upload-runner.server");
  return await processDueUploads();
});

