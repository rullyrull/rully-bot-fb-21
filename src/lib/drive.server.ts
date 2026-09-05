/**
 * Server-only: baca isi folder Google Drive memakai token OAuth Google
 * yang sudah tersimpan di aplikasi (login lewat tombol "Hubungkan YouTube").
 * Tidak memakai konektor eksternal, jadi tetap jalan setelah di-remix.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export function parseDriveFolderId(input: string): string | null {
  const url = (input ?? "").trim();
  if (!url) return null;
  const m =
    url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/) ?? url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m?.[1]) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;
  return null;
}

export type DriveVideo = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  thumbnail: string | null;
  webViewLink: string;
};

export async function listFolderVideos(
  folderId: string,
  accessToken: string,
): Promise<DriveVideo[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and (mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.folder')`,
    fields: "files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink)",
    pageSize: "200",
    orderBy: "folder,modifiedTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      let reason = "";
      try {
        const parsed = JSON.parse(body) as {
          error?: { message?: string; errors?: Array<{ reason?: string }> };
        };
        reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.message ?? "";
      } catch {
        reason = body;
      }
      if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reason)) {
        throw new Error(
          "Google Drive API belum diaktifkan pada project Google Cloud OAuth ini. Aktifkan Google Drive API, tunggu beberapa menit, lalu coba lagi.",
        );
      }
      if (
        /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(
          reason,
        )
      ) {
        throw new Error(
          'Belum ada izin Google Drive. Klik "Hubungkan Google Drive" di panel akun, login dengan akun Google biasa (bukan Brand Account), lalu setujui izin Drive.',
        );
      }
      throw new Error(
        `Akses Google Drive ditolak [${res.status}]${reason ? `: ${reason.slice(0, 220)}` : "."}`,
      );
    }
    throw new Error(`Gagal membaca folder Drive [${res.status}]: ${body.slice(0, 300)}`);
  }
  const json = JSON.parse(body) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      thumbnailLink?: string;
      webViewLink?: string;
    }>;
  };
  return (json.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? Number(f.size) : null,
    modifiedTime: f.modifiedTime ?? null,
    thumbnail: f.thumbnailLink ?? null,
    webViewLink: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
  }));
}

/** Nama folder Drive (null bila tidak bisa dibaca). */
export async function getDriveFolderName(
  folderId: string,
  accessToken: string,
): Promise<string | null> {
  const res = await fetch(
    `${DRIVE_API}/files/${folderId}?fields=name&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { name?: string };
  return json.name ?? null;
}

/**
 * Cari subfolder dengan nama tertentu di dalam sebuah folder (rekursif ringan).
 * Kembalikan ID folder pertama yang cocok (tidak peduli huruf besar/kecil).
 */
export async function findSubfolderByName(
  parentId: string,
  name: string,
  accessToken: string,
  maxDepth = 2,
): Promise<string | null> {
  // Normalisasi spasi + case supaya "UAS 2" = "uas2" = "UAS  2".
  // Tetap exact setelah normalisasi: "uah" TIDAK cocok dengan "uah2".
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  const target = normalize(name);
  let queue: Array<{ id: string; depth: number }> = [{ id: parentId, depth: 0 }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const next: typeof queue = [];
    for (const item of queue) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      let entries: DriveVideo[] = [];
      try {
        entries = await listFolderVideos(item.id, accessToken);
      } catch {
        continue;
      }
      const folders = entries.filter((e) => e.mimeType === "application/vnd.google-apps.folder");
      const hit = folders.find((f) => normalize(f.name) === target);
      if (hit) return hit.id;
      if (item.depth < maxDepth) {
        for (const f of folders) next.push({ id: f.id, depth: item.depth + 1 });
      }
    }
    queue = next;
  }
  return null;
}

/** Unduh file Drive dengan token OAuth (untuk file yang tidak publik). */
export async function fetchDriveFileWithToken(fileId: string, accessToken: string) {
  return fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/** Metadata minimum untuk transfer video bertahap tanpa memuat seluruh file ke RAM. */
export async function getDriveFileDownloadInfo(fileId: string, accessToken: string) {
  const res = await fetch(
    `${DRIVE_API}/files/${fileId}?fields=size,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Gagal membaca ukuran file Google Drive [${res.status}]: ${body.slice(0, 200)}`,
    );
  }
  const info = JSON.parse(body) as { size?: string; mimeType?: string };
  const size = Number(info.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Ukuran file Google Drive tidak tersedia atau file kosong.");
  }
  return { size, mimeType: info.mimeType ?? "video/mp4" };
}

/** Ambil sebagian byte file Drive. Google Drive mendukung HTTP Range. */
export async function fetchDriveFileRangeWithToken(
  fileId: string,
  accessToken: string,
  start: number,
  end: number,
) {
  return fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: `bytes=${start}-${end}`,
    },
  });
}

/**
 * Ambil metadata video (dimensi & durasi) dari Google Drive.
 * Best-effort: kembalikan null kalau token tidak punya izin Drive
 * atau metadata belum tersedia.
 */
export async function getDriveVideoMeta(
  fileId: string,
  accessToken: string,
): Promise<{ width: number; height: number; durationMs: number | null } | null> {
  try {
    const res = await fetch(
      `${DRIVE_API}/files/${fileId}?fields=videoMediaMetadata(width,height,durationMillis)&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
    };
    const meta = json.videoMediaMetadata;
    if (!meta?.width || !meta?.height) return null;
    return {
      width: meta.width,
      height: meta.height,
      durationMs: meta.durationMillis ? Number(meta.durationMillis) : null,
    };
  } catch {
    return null;
  }
}

/** Hapus file Drive secara permanen (bukan ke Sampah). */
export async function deleteDriveFile(fileId: string, accessToken: string) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Gagal menghapus file Drive [${res.status}]: ${body.slice(0, 200)}`);
  }
  return true;
}

/**
 * Ambil semua video di folder termasuk isi subfolder (rekursif, dibatasi kedalaman).
 * Google Drive tidak mengembalikan isi subfolder pada satu query, jadi kita telusuri.
 */
export async function listFolderVideosDeep(
  folderId: string,
  accessToken: string,
  maxDepth = 3,
  maxFolders = 40,
): Promise<{ videos: DriveVideo[]; folders: DriveVideo[] }> {
  const rootEntries = await listFolderVideos(folderId, accessToken);
  const folders = rootEntries.filter((f) => f.mimeType === "application/vnd.google-apps.folder");
  const videos = rootEntries.filter((f) => f.mimeType !== "application/vnd.google-apps.folder");
  const seen = new Set<string>([folderId]);
  let queue = folders.map((f) => ({ id: f.id, depth: 1 }));
  let visited = 0;
  while (queue.length > 0 && visited < maxFolders) {
    const next: typeof queue = [];
    for (const item of queue) {
      if (visited >= maxFolders || seen.has(item.id)) continue;
      seen.add(item.id);
      visited++;
      let entries: DriveVideo[] = [];
      try {
        entries = await listFolderVideos(item.id, accessToken);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.mimeType === "application/vnd.google-apps.folder") {
          if (item.depth < maxDepth) next.push({ id: e.id, depth: item.depth + 1 });
        } else if (!videos.some((v) => v.id === e.id)) {
          videos.push(e);
        }
      }
    }
    queue = next;
  }
  return { videos, folders };
}

/** Ambil ID folder induk sebuah file Drive (null bila tidak diketahui). */
export async function getDriveFileParentId(
  fileId: string,
  accessToken: string,
): Promise<string | null> {
  const res = await fetch(
    `${DRIVE_API}/files/${fileId}?fields=parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    console.error("[drive parents]", fileId, res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const json = (await res.json()) as { parents?: string[] };
  return json.parents?.[0] ?? null;
}
