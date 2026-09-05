/**
 * Server-only helpers untuk OAuth YouTube + upload video dari Google Drive.
 * Jangan import file ini dari komponen React.
 */

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
/** Izin Google Drive diminta terpisah (Brand Account tidak punya Drive).
 *  Butuh scope penuh `drive` agar file bisa dihapus permanen setelah upload. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
/** Baris khusus di tabel akun untuk menyimpan token Google Drive. */
export const DRIVE_ACCOUNT_ID = "__drive__";

function normalizeGoogleCredential(
  raw: string | undefined,
  key: "client_id" | "client_secret",
) {
  if (!raw) return undefined;
  const value = raw.trim();

  const embedded =
    key === "client_id"
      ? value.match(/[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com/)?.[0]
      : value.match(/GOCSPX-[A-Za-z0-9_-]+/)?.[0];
  if (embedded) return embedded;

  try {
    const parsed = JSON.parse(value) as {
      web?: Record<string, unknown>;
      installed?: Record<string, unknown>;
      client_id?: unknown;
      client_secret?: unknown;
    };
    const candidate = parsed.web?.[key] ?? parsed.installed?.[key] ?? parsed[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  } catch {
    // Nilai biasanya berupa string biasa, bukan JSON.
  }

  const withoutPrefix = value.replace(
    new RegExp(`^(?:GOOGLE_OAUTH_)?${key.toUpperCase()}\\s*[=:]\\s*`, "i"),
    "",
  );
  return withoutPrefix.replace(/^["']|["']$/g, "").trim() || undefined;
}

export function getGoogleCredentials() {
  const clientId = normalizeGoogleCredential(
    process.env["GOOGLE_OAUTH_CLIENT_ID"],
    "client_id",
  );
  const clientSecret = normalizeGoogleCredential(
    process.env["GOOGLE_OAUTH_CLIENT_SECRET"],
    "client_secret",
  );
  return { clientId, clientSecret };
}

/**
 * Redirect URI selalu mengikuti origin aplikasi yang sedang dipakai,
 * supaya setelah login Google kembali ke halaman yang sama (bukan proyek lain).
 */
export function redirectUriFor(origin?: string | null) {
  const base = (origin ?? "").replace(/\/$/, "");
  if (!base) throw new Error("Origin aplikasi tidak diketahui untuk redirect OAuth.");
  return `${base}/api/public/youtube/callback`;
}

export function parseDriveFileId(input: string): string | null {
  const url = (input ?? "").trim();
  if (!url) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{10,})/,
    /\/document\/d\/([a-zA-Z0-9_-]{10,})/,
    /\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
    /\/uc\?[^ ]*id=([a-zA-Z0-9_-]{10,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  // bare ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;
  // last resort: longest id-looking segment in the URL
  const candidates = url.match(/[a-zA-Z0-9_-]{25,}/g);
  if (candidates?.length) {
    return candidates.sort((a, b) => b.length - a.length)[0];
  }
  return null;
}


export function driveDownloadUrl(fileId: string) {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

type AccountRow = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  channel_id: string;
  channel_title: string | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function loadAccounts(): Promise<AccountRow[]> {
  const db = await admin();
  const { data, error } = await db
    .from("youtube_account")
    .select("access_token, refresh_token, expires_at, channel_id, channel_title")
    .neq("channel_id", DRIVE_ACCOUNT_ID)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as AccountRow[] | null) ?? [];
}

async function loadAccountById(channelId: string): Promise<AccountRow | null> {
  const db = await admin();
  const { data } = await db
    .from("youtube_account")
    .select("access_token, refresh_token, expires_at, channel_id, channel_title")
    .eq("channel_id", channelId)
    .maybeSingle();
  return (data as AccountRow | null) ?? null;
}

export async function hasDriveConnection(): Promise<boolean> {
  const account = await loadAccountById(DRIVE_ACCOUNT_ID);
  if (!account) return false;
  try {
    // Jangan hanya memeriksa keberadaan token di database. Setelah OAuth Client
    // diganti, refresh token lama masih tersimpan tetapi tidak lagi dapat dipakai.
    await validTokenFor(account);
    return true;
  } catch {
    return false;
  }
}

export async function loadAccount(channelId?: string | null): Promise<AccountRow | null> {
  const accounts = await loadAccounts();
  if (channelId) {
    // fallback ke akun pertama kalau channel dipilih bukan channel utama akun manapun
    return accounts.find((a) => a.channel_id === channelId) ?? accounts[0] ?? null;
  }
  return accounts[0] ?? null;
}

export async function saveAccount(row: {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  channel_id: string;
  channel_title?: string | null;
}) {
  const db = await admin();
  const { error } = await db
    .from("youtube_account")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "channel_id" });
  if (error) throw error;
}

export async function deleteAccount(channelId?: string | null) {
  const db = await admin();
  if (channelId) {
    await db.from("youtube_account").delete().eq("channel_id", channelId);
    return;
  }
  await db.from("youtube_account").delete().neq("channel_id", DRIVE_ACCOUNT_ID);
}

export async function exchangeCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getGoogleCredentials();
  if (!clientId || !clientSecret) throw new Error("Kredensial Google OAuth belum diatur.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Token exchange gagal [${res.status}]: ${body}`);
  return JSON.parse(body) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleCredentials();
  if (!clientId || !clientSecret) throw new Error("Kredensial Google OAuth belum diatur.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (/invalid_grant|invalid_client|unauthorized_client/i.test(body)) {
      throw new Error(
        'Koneksi Google Drive sudah kedaluwarsa atau berasal dari OAuth Client lama. Klik "Hubungkan Google Drive" untuk menyambungkan ulang.',
      );
    }
    throw new Error(`Refresh token Google Drive gagal [${res.status}]. Hubungkan ulang Google Drive.`);
  }
  return JSON.parse(body) as { access_token: string; expires_in: number };
}

async function validTokenFor(account: AccountRow): Promise<string> {
  const expiresAt = new Date(account.expires_at).getTime();
  if (expiresAt - Date.now() > 60_000) return account.access_token;

  const refreshed = await refreshAccessToken(account.refresh_token);
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await saveAccount({
    access_token: refreshed.access_token,
    refresh_token: account.refresh_token,
    expires_at: newExpiry,
    channel_id: account.channel_id,
    channel_title: account.channel_title,
  });
  return refreshed.access_token;
}

/** Ambil access token yang valid, refresh otomatis kalau sudah mau habis. */
export async function getValidAccessToken(channelId?: string | null): Promise<string> {
  const account = await loadAccount(channelId);
  if (!account)
    throw new Error(
      "Belum ada akun Google yang terhubung. Klik \"Hubungkan Google Drive\" / \"Hubungkan YouTube\" di halaman utama dulu.",
    );
  return validTokenFor(account);
}

/**
 * Token untuk operasi Google Drive: pakai koneksi Drive khusus bila ada,
 * kalau belum ada baru jatuh ke token channel (biasanya tanpa izin Drive).
 */
export async function getDriveAccessToken(channelId?: string | null): Promise<string> {
  const drive = await loadAccountById(DRIVE_ACCOUNT_ID);
  if (drive) return validTokenFor(drive);
  return getValidAccessToken(channelId ?? null);
}

export async function listChannels(accessToken: string) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`Gagal mengambil daftar channel [${res.status}]: ${body}`);
  const json = JSON.parse(body) as {
    items?: Array<{ id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }>;
  };
  return (json.items ?? []).map((i) => ({
    id: i.id,
    title: i.snippet.title,
    thumbnail: i.snippet.thumbnails?.default?.url ?? null,
  }));
}

export async function fetchChannelInfo(accessToken: string) {
  const empty = { id: null as string | null, title: null as string | null };
  const fetchChannels = async (query: string) => {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&${query}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const body = await res.text();
    if (!res.ok) {
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
          "YouTube Data API v3 belum diaktifkan pada project Google Cloud dari Client ID ini. Buka Google Cloud Console → APIs & Services → Library → aktifkan \"YouTube Data API v3\", tunggu beberapa menit, lalu coba hubungkan channel lagi.",
        );
      }
      throw new Error(
        `YouTube menolak permintaan channel [${res.status}]${reason ? `: ${reason.slice(0, 220)}` : "."}`,
      );
    }
    const json = JSON.parse(body) as {
      items?: Array<{ id: string; snippet: { title: string } }>;
    };
    return json.items ?? [];
  };

  // Brand Account yang dipilih di pemilih akun Google biasanya muncul via mine=true.
  const mine = await fetchChannels("mine=true");
  if (mine[0]) return { id: mine[0].id, title: mine[0].snippet.title };

  // Fallback: sebagian Brand Account hanya terlihat lewat managedByMe=true.
  const managed = await fetchChannels("managedByMe=true&maxResults=50");
  if (managed.length === 1) return { id: managed[0]!.id, title: managed[0]!.snippet.title };
  return empty;
}

/** Unduh dari Drive (link publik) lalu upload ke YouTube via resumable upload. */
export async function uploadDriveVideoToYouTube(opts: {
  fileId: string;
  title: string;
  description: string;
  privacy: "private" | "unlisted" | "public";
  channelId?: string | null;
  kind?: "video" | "reels";
  tags?: string[];
}) {
  const accessToken = await getValidAccessToken(opts.channelId ?? null);

  let driveRes = await fetch(driveDownloadUrl(opts.fileId));
  let contentType = driveRes.headers.get("content-type") ?? "";
  if (!driveRes.ok || !driveRes.body || contentType.includes("text/html")) {
    // Fallback: unduh lewat token Google Drive akun terhubung (file privat / butuh izin).
    const { fetchDriveFileWithToken } = await import("./drive.server");
    const driveToken = await getDriveAccessToken(opts.channelId ?? null);
    const viaGateway = await fetchDriveFileWithToken(opts.fileId, driveToken);
    if (!viaGateway.ok || !viaGateway.body) {
      const detail = await viaGateway.text().catch(() => "");
      throw new Error(
        `Gagal mengunduh file dari Google Drive [${viaGateway.status}]. Pastikan file dibagikan publik atau dapat diakses akun Drive yang terhubung. ${detail.slice(0, 300)}`,
      );
    }
    driveRes = viaGateway;
    contentType = viaGateway.headers.get("content-type") ?? "video/*";
  }
  const contentLength = driveRes.headers.get("content-length");

  // Privasi langsung sesuai permintaan. Menahan video sebagai "private" dulu
  // berisiko tersangkut (worker berhenti sebelum sempat publish) sehingga video
  // tidak pernah tayang. Perbaikan otomatis dijalankan lewat cron.
  const initialPrivacy = opts.privacy;

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": contentType || "video/*",
        ...(contentLength ? { "X-Upload-Content-Length": contentLength } : {}),
      },
      body: JSON.stringify({
        snippet: {
          title: opts.title,
          description: opts.description,
          // Tag relevan saja (maks 12). Tag generik memicu sinyal spam.
          tags: (opts.tags ?? []).slice(0, 12),
          // Kategori konsisten dengan upload manual (People & Blogs).
          categoryId: "22",
          // Bahasa membantu YouTube menyalurkan video ke audiens yang tepat.
          defaultLanguage: "id",
          defaultAudioLanguage: "id",
          ...(opts.channelId ? { channelId: opts.channelId } : {}),
        },
        status: {
          privacyStatus: initialPrivacy,
          selfDeclaredMadeForKids: false,
          embeddable: true,
          publicStatsViewable: true,
        },
      }),
    },
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Inisialisasi upload YouTube gagal [${initRes.status}]: ${err}`);
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube tidak mengembalikan URL upload.");

  const bodyInit: RequestInit = {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "video/*",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
    },
    body: contentLength ? driveRes.body : await driveRes.arrayBuffer(),
    // @ts-expect-error duplex diperlukan saat body berupa stream
    duplex: "half",
  };

  const uploadRes = await fetch(uploadUrl, bodyInit);
  const uploadBody = await uploadRes.text();
  if (!uploadRes.ok) {
    throw new Error(`Upload ke YouTube gagal [${uploadRes.status}]: ${uploadBody}`);
  }
  const video = JSON.parse(uploadBody) as { id: string };


  return video.id;
}

/** Ambil status privasi video di YouTube. */
async function getVideoPrivacy(videoId: string, accessToken: string) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    items?: Array<{ status?: { privacyStatus?: string } }>;
  };
  return json.items?.[0]?.status?.privacyStatus ?? null;
}


/** Ubah privasi video yang sudah terunggah. */
export async function setVideoPrivacy(
  videoId: string,
  privacy: "private" | "unlisted" | "public",
  accessToken: string,
) {
  const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=status", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: videoId,
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: false,
        embeddable: true,
        publicStatsViewable: true,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gagal mengubah privasi video [${res.status}]: ${body}`);
  }
}

/**
 * Perbaikan otomatis: video yang seharusnya publik tapi masih private
 * (mis. proses publish sebelumnya terputus) dikembalikan ke publik.
 */
export async function republishStuckPrivateVideos(limit = 25) {
  const db = await admin();
  const { data } = await db
    .from("uploads")
    .select("id, video_id, channel_id, privacy, status")
    .eq("status", "done")
    .eq("privacy", "public")
    .not("video_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as Array<{
    id: string;
    video_id: string;
    channel_id: string | null;
  }>;

  let fixed = 0;
  for (const row of rows) {
    try {
      const token = await getValidAccessToken(row.channel_id);
      const current = await getVideoPrivacy(row.video_id, token);
      if (current === "private") {
        await setVideoPrivacy(row.video_id, "public", token);
        fixed += 1;
      }
    } catch {
      // lewati video yang gagal diperiksa
    }
  }
  return { checked: rows.length, fixed };
}

