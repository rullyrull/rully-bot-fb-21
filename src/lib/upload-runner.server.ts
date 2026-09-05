/**
 * Server-only: eksekusi satu pekerjaan upload Drive → Fan Page Facebook.
 * Dipakai oleh upload langsung maupun pemroses jadwal.
 */

export type UploadJob = {
  driveUrl: string;
  title: string;
  description: string;
  privacy: "private" | "unlisted" | "public";
  channelId: string | null;
  kind: "video" | "reels";
};

/** Validasi khusus Reels (rasio & durasi) sebelum upload. */
export async function assertReelsCompatible(fileId: string, channelId: string | null) {
  const { getDriveAccessToken } = await import("./youtube.server");
  const { getDriveVideoMeta } = await import("./drive.server");
  const accessToken = await getDriveAccessToken(channelId);
  const meta = await getDriveVideoMeta(fileId, accessToken);

  if (!meta) {
    throw new Error(
      "Tidak bisa membaca dimensi & durasi file dari Google Drive, jadi Facebook berisiko menempatkannya sebagai video biasa. Pastikan file benar-benar file video di Drive (bukan shortcut/link) dan akun terhubung punya izin Google Drive, lalu coba lagi.",
    );
  }
  if (meta.width > meta.height) {
    throw new Error(
      `File ini landscape (${meta.width}×${meta.height}), sehingga Facebook akan memasukkannya sebagai video biasa. Gunakan video vertikal (mis. 1080×1920).`,
    );
  }
  if (meta.durationMs === null) {
    throw new Error(
      "Durasi file tidak terbaca dari Google Drive. Facebook Reels hanya menerima video maksimal 180 detik, jadi unggahan dihentikan agar tidak menjadi video biasa.",
    );
  }
  if (meta.durationMs > 180_000) {
    const durationSeconds = Math.ceil(meta.durationMs / 1000);
    throw new Error(
      `Durasi file ${durationSeconds} detik. Facebook Reels hanya menerima video maksimal 180 detik (3 menit).`,
    );
  }
}

const STOPWORDS = new Set([
  "yang","dan","di","ke","dari","untuk","dengan","ini","itu","pada","the","a","an","of","in","on","for","to","is","are",
]);

/**
 * Tag relevan dari judul saja.
 * Tag generik ("viral", "fyp", "trending") sengaja TIDAK dipakai:
 * Facebook menilainya sebagai tag-stuffing dan justru menekan distribusi,
 * sehingga video hasil sistem tampil jauh lebih sedikit dibanding upload manual.
 */
export function buildViralTags(title: string, kind: "video" | "reels") {
  const keywords = title
    .toLowerCase()
    .replace(/#[\w]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  // Frasa dari judul (2 kata berurutan) lebih bernilai daripada kata acak.
  const phrases: string[] = [];
  for (let i = 0; i < Math.min(keywords.length - 1, 4); i += 1) {
    phrases.push(`${keywords[i]} ${keywords[i + 1]}`);
  }

  const base = kind === "reels" ? ["reels"] : [];
  return Array.from(new Set([...keywords.slice(0, 8), ...phrases, ...base]))
    .filter(Boolean)
    .slice(0, 12);
}

/** Deskripsi natural: isi + CTA singkat + maksimal 3 hashtag relevan. */
export function buildViralDescription(title: string, description: string, kind: "video" | "reels") {
  const existing = description?.trim();
  // Deskripsi yang sudah dirakit (mengandung hashtag) dipakai apa adanya.
  if (existing && /#\p{L}/u.test(existing)) return existing.slice(0, 4500);

  const hashtags = buildViralTags(title, kind)
    .filter((t) => !t.includes(" ") && t !== "reels")
    .slice(0, kind === "reels" ? 2 : 3)
    .map((t) => `#${t.replace(/[^\p{L}\p{N}]/gu, "")}`);
  if (kind === "reels") hashtags.push("#Reels");

  const body = existing || `${title.replace(/#\w+/g, "").trim()}`;
  const cta =
    kind === "reels"
      ? "Suka videonya? Ikuti halaman ini untuk video baru setiap hari."
      : "Ikuti halaman ini untuk video terbaru lainnya.";

  return [body, cta, hashtags.join(" ")].filter(Boolean).join("\n\n").slice(0, 4500);
}


/** Rapikan judul + deskripsi + tag agar siap tampil dan mudah ditemukan. */
export function decorateForKind(job: UploadJob) {
  const title =
    job.kind === "reels" && !/#reels/i.test(job.title)
      ? `${job.title} #Reels`.slice(0, 100)
      : job.title;
  const description = buildViralDescription(title, job.description, job.kind);
  return { title, description, tags: buildViralTags(title, job.kind) };
}


/** Jalankan upload untuk satu baris `uploads` yang sudah ada di database. */
export async function runUploadRow(rowId: string, job: UploadJob, alreadyClaimed = false) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { parseDriveFileId } = await import("./youtube.server");
  const { uploadDriveVideoToFacebook, facebookVideoUrl } = await import("./facebook.server");

  const fileId = parseDriveFileId(job.driveUrl);
  if (!fileId) throw new Error("Link Google Drive tidak valid.");

  if (!alreadyClaimed) {
    await supabaseAdmin
      .from("uploads")
      .update({ status: "uploading", error: null, updated_at: new Date().toISOString() })
      .eq("id", rowId);
  }

  try {
    if (job.kind === "reels") await assertReelsCompatible(fileId, job.channelId);

    const { videoId, pageId } = await uploadDriveVideoToFacebook({
      fileId,
      title: job.title,
      description: job.description,
      pageId: job.channelId,
    });
    // Hapus file sumber di Google Drive secara permanen setelah upload sukses.
    let driveDeleted = true;
    let driveDeleteError: string | null = null;
    try {
      const { getDriveAccessToken } = await import("./youtube.server");
      const { deleteDriveFile } = await import("./drive.server");
      const accessToken = await getDriveAccessToken(job.channelId);
      await deleteDriveFile(fileId, accessToken);
    } catch (delErr) {
      driveDeleted = false;
      driveDeleteError = delErr instanceof Error ? delErr.message : String(delErr);
    }

    await supabaseAdmin
      .from("uploads")
      .update({
        status: "done",
        video_id: videoId,
        published_at: new Date().toISOString(),
        error: driveDeleted ? null : `Upload sukses, tapi file Drive gagal dihapus: ${driveDeleteError}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId);
    return { videoId, url: facebookVideoUrl(pageId, videoId), driveDeleted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("uploads")
      .update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", rowId);
    throw new Error(message);
  }
}

/** Proses semua jadwal yang sudah jatuh tempo. */
export async function processDueUploads() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("uploads")
    .select("id, title, description, drive_url, privacy, channel_id, kind, scheduled_at")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(3);

  const rows = data ?? [];
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const row of rows) {
    // Klaim baris secara bersyarat: hanya satu proses yang boleh mengubah
    // status "scheduled" → "uploading", sehingga cron yang tumpang tindih
    // tidak mengunggah video yang sama dua kali.
    const { data: claimed } = await supabaseAdmin
      .from("uploads")
      .update({ status: "uploading", error: null, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("id");
    if (!claimed || claimed.length === 0) continue;
    try {
      await runUploadRow(row.id, {
        driveUrl: row.drive_url,
        title: row.title,
        description: row.description ?? "",
        privacy: (row.privacy as UploadJob["privacy"]) ?? "private",
        channelId: row.channel_id ?? null,
        kind: row.kind === "reels" ? "reels" : "video",
      }, true);
      results.push({ id: row.id, ok: true });
    } catch (err) {
      results.push({ id: row.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { processed: results.length, results };
}
