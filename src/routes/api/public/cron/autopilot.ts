import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint terjadwal (dipanggil pg_cron):
 * 1. Pindai Google Drive untuk semua channel yang autopilot-nya aktif
 * 2. Proses antrean upload yang sudah jatuh tempo
 *
 * Diamankan dengan header `apikey` berisi publishable key project.
 */
async function handle(request: Request) {
  const apiKey = request.headers.get("apikey") ?? "";
  const expected = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? "";
  if (!expected || apiKey !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const [{ scanAllAutopilots }, { processDueUploads }] =
      await Promise.all([
        import("@/lib/autopilot.server"),
        import("@/lib/upload-runner.server"),
      ]);
    const scan = await scanAllAutopilots();
    const uploads = await processDueUploads();
    return new Response(JSON.stringify({ ok: true, scan, uploads }), {
      headers: { "Content-Type": "application/json" },
    });


  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/autopilot")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      GET: ({ request }) => handle(request),
    },
  },
});
