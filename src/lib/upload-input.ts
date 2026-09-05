/** Validator input upload (dipisah dari file server function agar aman saat split). */
export function validateUploadInput(input: {
  driveUrl: string;
  title: string;
  description?: string;
  privacy?: string;
  channelId?: string | null;
  channelTitle?: string | null;
  kind?: string;
  scheduledAt?: string | null;
}) {
  if (!input?.driveUrl?.trim()) throw new Error("Link Google Drive wajib diisi.");
  if (!input?.title?.trim()) throw new Error("Judul video wajib diisi.");
  const privacy = ["private", "unlisted", "public"].includes(input.privacy ?? "")
    ? (input.privacy as "private" | "unlisted" | "public")
    : ("public" as const);
  const kind = input.kind === "reels" ? ("reels" as const) : ("video" as const);
  let scheduledAt: string | null = null;
  if (input.scheduledAt) {
    const when = new Date(input.scheduledAt);
    if (Number.isNaN(when.getTime())) throw new Error("Waktu jadwal tidak valid.");
    if (when.getTime() < Date.now() - 60_000) throw new Error("Waktu jadwal sudah lewat.");
    scheduledAt = when.toISOString();
  }
  return {
    kind,
    channelId: input.channelId?.trim() || null,
    channelTitle: input.channelTitle?.trim() || null,
    driveUrl: input.driveUrl.trim(),
    title: input.title.trim().slice(0, 100),
    description: (input.description ?? "").slice(0, 4500),
    privacy,
    scheduledAt,
  };
}
