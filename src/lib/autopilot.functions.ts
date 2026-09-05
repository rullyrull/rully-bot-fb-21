import { createServerFn } from "@tanstack/react-start";

export const listAutopilots = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("channel_autopilot")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const saveAutopilot = createServerFn({ method: "POST" })
  .inputValidator((input: {
    channelId: string;
    channelTitle?: string | null;
    folderUrl: string;
    slotTimes: string;
    timezone?: string;
    kind?: string;
    privacy?: string;
    maxPerScan?: number;
    enabled?: boolean;
  }) => {
    if (!input?.channelId?.trim()) throw new Error("Channel wajib dipilih.");
    if (!input?.folderUrl?.trim()) throw new Error("Link folder Google Drive wajib diisi.");
    if (!input?.slotTimes?.trim()) throw new Error("Isi minimal satu slot jam, contoh 06:00.");
    return {
      channelId: input.channelId.trim(),
      channelTitle: input.channelTitle?.trim() || null,
      folderUrl: input.folderUrl.trim(),
      slotTimes: input.slotTimes.trim(),
      timezone: input.timezone?.trim() || "Asia/Makassar",
      kind: input.kind === "reels" ? "reels" : "video",
      privacy: ["private", "unlisted", "public"].includes(input.privacy ?? "")
        ? input.privacy!
        : "public",
      maxPerScan: Math.min(Math.max(Number(input.maxPerScan ?? 20) || 20, 1), 100),
      enabled: input.enabled ?? true,
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { parseSlotTimes } = await import("./schedule.server");
    parseSlotTimes(data.slotTimes);

    const { error } = await supabaseAdmin.from("channel_autopilot").upsert(
      {
        channel_id: data.channelId,
        channel_title: data.channelTitle,
        folder_url: data.folderUrl,
        slot_times: data.slotTimes,
        timezone: data.timezone,
        kind: data.kind,
        privacy: data.privacy,
        max_per_scan: data.maxPerScan,
        enabled: data.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setAutopilotEnabled = createServerFn({ method: "POST" })
  .inputValidator((input: { channelId: string; enabled: boolean }) => {
    if (!input?.channelId?.trim()) throw new Error("Channel wajib dipilih.");
    return { channelId: input.channelId.trim(), enabled: Boolean(input.enabled) };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("channel_autopilot")
      .update({ enabled: data.enabled, updated_at: new Date().toISOString() })
      .eq("channel_id", data.channelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAutopilot = createServerFn({ method: "POST" })
  .inputValidator((input: { channelId: string }) => {
    if (!input?.channelId?.trim()) throw new Error("Channel wajib dipilih.");
    return { channelId: input.channelId.trim() };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("channel_autopilot")
      .delete()
      .eq("channel_id", data.channelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Jalankan pemindaian Drive sekarang untuk semua channel aktif. */
export const runAutopilotScan = createServerFn({ method: "POST" }).handler(async () => {
  const { scanAllAutopilots } = await import("./autopilot.server");
  return await scanAllAutopilots();
});
