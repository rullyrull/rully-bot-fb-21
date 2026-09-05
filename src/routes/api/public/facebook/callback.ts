import { createFileRoute } from "@tanstack/react-router";

/**
 * Callback OAuth Facebook Login.
 * Setelah pengguna menyetujui izin, semua Fan Page yang ia kelola
 * disimpan (token halaman long-lived) lalu pengguna dikembalikan ke beranda.
 */
export const Route = createFileRoute("/api/public/facebook/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");
        const home = `${url.origin}/`;

        if (error || !code) {
          return Response.redirect(
            `${home}?fb_error=${encodeURIComponent(errorDescription ?? error ?? "missing_code")}`,
            302,
          );
        }

        try {
          const fb = await import("@/lib/facebook.server");
          const shortToken = await fb.exchangeFacebookCode(
            code,
            fb.facebookRedirectUri(url.origin),
          );
          const longToken = await fb.extendUserToken(shortToken.access_token);
          const pages = await fb.listManagedPages(longToken.access_token);
          if (pages.length === 0) {
            return Response.redirect(
              `${home}?fb_error=${encodeURIComponent(
                "Tidak menemukan Fan Page pada akun Facebook ini. Pastikan Anda admin/editor minimal satu Fan Page.",
              )}`,
              302,
            );
          }
          // Bersihkan akun lama (mis. sisa token YouTube) supaya daftar
          // hanya berisi Fan Page dari login terbaru ini.
          const { deleteAccount } = await import("@/lib/youtube.server");
          await deleteAccount(null);
          for (const page of pages) {
            await fb.savePageAccount(page);
          }
          return Response.redirect(`${home}?fb_connected=1`, 302);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return Response.redirect(`${home}?fb_error=${encodeURIComponent(message)}`, 302);
        }
      },
    },
  },
});
