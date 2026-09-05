/**
 * Server-only: OAuth Facebook Login + upload video ke Fan Page Facebook.
 * Jangan import file ini dari komponen React.
 *
 * Token Fan Page yang diambil dari token user long-lived tidak kedaluwarsa,
 * jadi tidak perlu mekanisme refresh seperti Google.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/** Izin yang dibutuhkan: melihat daftar Fan Page dan memposting video ke sana. */
const FB_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"].join(",");

export function getFacebookCredentials() {
  const appId = process.env["FACEBOOK_APP_ID"]?.trim() || undefined;
  const appSecret = process.env["FACEBOOK_APP_SECRET"]?.trim() || undefined;
  return { appId, appSecret };
}

export function facebookRedirectUri(origin?: string | null) {
  const base = (origin ?? "").replace(/\/$/, "");
  if (!base) throw new Error("Origin aplikasi tidak diketahui untuk redirect OAuth Facebook.");
  return `${base}/api/public/facebook/callback`;
}

/** Ambil origin publik, bukan alamat internal server preview seperti localhost. */
export function facebookPublicOrigin(request: Request) {
  const browserOrigin = request.headers.get("origin");
  if (browserOrigin && /^https?:\/\//i.test(browserOrigin)) return browserOrigin;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

export function buildFacebookAuthUrl(origin: string) {
  const { appId, appSecret } = getFacebookCredentials();
  if (!appId || !appSecret) throw new Error("Kredensial Facebook App belum diatur.");
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: facebookRedirectUri(origin),
    response_type: "code",
    scope: FB_SCOPES,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

/** Tukar kode OAuth menjadi access token user (umur pendek). */
export async function exchangeFacebookCode(code: string, redirectUri: string) {
  const { appId, appSecret } = getFacebookCredentials();
  if (!appId || !appSecret) throw new Error("Kredensial Facebook App belum diatur.");
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`Tukar kode Facebook gagal [${res.status}]: ${body}`);
  return JSON.parse(body) as { access_token: string; expires_in?: number };
}

/** Perpanjang token user menjadi long-lived (~60 hari). */
export async function extendUserToken(shortToken: string) {
  const { appId, appSecret } = getFacebookCredentials();
  if (!appId || !appSecret) throw new Error("Kredensial Facebook App belum diatur.");
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`Perpanjangan token Facebook gagal [${res.status}]: ${body}`);
  return JSON.parse(body) as { access_token: string; expires_in?: number };
}

export type FacebookPage = {
  id: string;
  name: string;
  access_token: string;
};

/** Daftar Fan Page yang dikelola akun, lengkap dengan token halamannya. */
export async function listManagedPages(userToken: string): Promise<FacebookPage[]> {
  const url = new URL(`${GRAPH}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", userToken);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Gagal mengambil daftar Fan Page [${res.status}]: ${body}. Pastikan Anda mengelola minimal satu Fan Page dan menyetujui izin pages_show_list.`,
    );
  }
  const json = JSON.parse(body) as { data?: FacebookPage[] };
  return json.data ?? [];
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Simpan token Fan Page (dipakai ulang tabel akun yang sudah ada). */
export async function savePageAccount(page: FacebookPage) {
  const db = await admin();
  const { error } = await db.from("youtube_account").upsert(
    {
      channel_id: page.id,
      channel_title: page.name,
      access_token: page.access_token,
      refresh_token: "",
      // Token halaman long-lived praktis tidak kedaluwarsa.
      expires_at: new Date(Date.now() + 55 * 24 * 3600 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel_id" },
  );
  if (error) throw error;
}

export async function loadPageAccounts() {
  const db = await admin();
  const { DRIVE_ACCOUNT_ID } = await import("./youtube.server");
  const { data, error } = await db
    .from("youtube_account")
    .select("access_token, channel_id, channel_title")
    .neq("channel_id", DRIVE_ACCOUNT_ID)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{
    access_token: string;
    channel_id: string;
    channel_title: string | null;
  }>;
}

/** Ambil token halaman untuk Fan Page tertentu (atau halaman pertama). */
export async function getPageAccessToken(pageId?: string | null) {
  const pages = await loadPageAccounts();
  const page = (pageId ? pages.find((p) => p.channel_id === pageId) : null) ?? pages[0];
  if (!page)
    throw new Error(
      'Belum ada Fan Page Facebook yang terhubung. Klik "Login Facebook" di halaman utama dulu.',
    );
  return { token: page.access_token, pageId: page.channel_id };
}

/**
 * Upload video dari Google Drive ke Fan Page Facebook.
 * Jalur utama: Facebook mengambil langsung dari URL unduhan Drive (file publik).
 * Fallback: unduh dulu pakai token Drive, lalu kirim sebagai multipart.
 */
export async function uploadDriveVideoToFacebook(opts: {
  fileId: string;
  title: string;
  description: string;
  pageId?: string | null;
}) {
  const { token, pageId } = await getPageAccessToken(opts.pageId ?? null);
  const { driveDownloadUrl } = await import("./youtube.server");

  const endpoint = `${GRAPH}/${pageId}/videos`;

  // 1) Coba lewat URL langsung (file Drive yang dibagikan publik).
  const viaUrl = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_url: driveDownloadUrl(opts.fileId),
      title: opts.title,
      description: opts.description,
      access_token: token,
    }),
  });
  if (viaUrl.ok) {
    const json = (await viaUrl.json()) as { id: string };
    return { videoId: json.id, pageId };
  }
  const urlError = await viaUrl.text();

  // 2) Fallback: unduh dari Drive dengan token, kirim sebagai multipart.
  const { getDriveAccessToken } = await import("./youtube.server");
  const { fetchDriveFileWithToken } = await import("./drive.server");
  const driveToken = await getDriveAccessToken(null);
  const driveRes = await fetchDriveFileWithToken(opts.fileId, driveToken);
  if (!driveRes.ok || !driveRes.body) {
    const detail = await driveRes.text().catch(() => "");
    throw new Error(
      `Upload lewat URL gagal [${viaUrl.status}]: ${urlError.slice(0, 300)} — dan unduhan Drive ikut gagal [${driveRes.status}]: ${detail.slice(0, 300)}`,
    );
  }
  const blob = await driveRes.blob();
  const form = new FormData();
  form.set("title", opts.title);
  form.set("description", opts.description);
  form.set("access_token", token);
  form.set("source", blob, "video.mp4");

  const viaUpload = await fetch(endpoint, { method: "POST", body: form });
  const uploadBody = await viaUpload.text();
  if (!viaUpload.ok) {
    throw new Error(
      `Upload ke Fan Page gagal [${viaUpload.status}]: ${uploadBody.slice(0, 500)} (percobaan via URL: [${viaUrl.status}] ${urlError.slice(0, 200)})`,
    );
  }
  const json = JSON.parse(uploadBody) as { id: string };
  return { videoId: json.id, pageId };
}

/** Link tonton untuk video yang sudah terunggah. */
export function facebookVideoUrl(pageId: string | null, videoId: string) {
  return pageId
    ? `https://www.facebook.com/${pageId}/videos/${videoId}`
    : `https://www.facebook.com/watch/?v=${videoId}`;
}
