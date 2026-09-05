import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Facebook,
  LogOut,
  UploadCloud,
  CheckCircle2,
  XCircle,
  Plus,
  FolderOpen,
  Film,
  Loader2,
  CalendarClock,
  Clock,
  Trash2,
  ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  disconnectYoutube,
  getYoutubeAuthUrl,
  getYoutubeStatus,
  getAppSettings,
  listUploads,
  listYoutubeChannels,
  saveAppSettings,
  cancelScheduledUpload,
  cancelAllScheduledUploads,
  runDueUploads,
  getDriveAuthUrl,
  disconnectDrive,
} from "@/lib/youtube.functions";
import {
  listDriveFolderVideos,
  autoScheduleFolder,
  scheduleSelectedVideos,
} from "@/lib/drive.functions";
import { folderCodeForChannel } from "@/lib/channel-folders";


const DEFAULT_FOLDER_URL =
  "https://drive.google.com/drive/folders/1TxuGXApoNmA7FeCTHce9OsC4n6xvwJ56?usp=drive_link";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Drive to Facebook — Upload Video ke Fan Page" },
      {
        name: "description",
        content:
          "Tempel link Google Drive publik, hubungkan akun Facebook Anda, dan unggah videonya langsung ke Fan Page tanpa mengunduh manual.",
      },
      { property: "og:title", content: "Drive to Facebook — Upload Video ke Fan Page" },
      {
        property: "og:description",
        content:
          "Tempel link Google Drive publik dan unggah videonya langsung ke Fan Page Facebook Anda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const queryClient = useQueryClient();
  const statusFn = useServerFn(getYoutubeStatus);
  const uploadsFn = useServerFn(listUploads);
  const settingsFn = useServerFn(getAppSettings);
  const channelsFn = useServerFn(listYoutubeChannels);
  const resilient = {
    retry: 3,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8000),
    throwOnError: false,
  } as const;
  const status = useQuery({ queryKey: ["yt-status"], queryFn: () => statusFn(), ...resilient });
  const uploads = useQuery({ queryKey: ["yt-uploads"], queryFn: () => uploadsFn(), ...resilient });
  const settings = useQuery({ queryKey: ["yt-settings"], queryFn: () => settingsFn(), ...resilient });
  const saveSettingsFn = useServerFn(saveAppSettings);
  const channels = useQuery({
    queryKey: ["yt-channels"],
    queryFn: () => channelsFn(),
    ...resilient,
  });


  const authUrlFn = useServerFn(getYoutubeAuthUrl);
  const disconnectFn = useServerFn(disconnectYoutube);
  const cancelScheduleFn = useServerFn(cancelScheduledUpload);
  const cancelAllFn = useServerFn(cancelAllScheduledUploads);
  const runDueFn = useServerFn(runDueUploads);
  const autoScheduleFn = useServerFn(autoScheduleFolder);
  const scheduleSelectedFn = useServerFn(scheduleSelectedVideos);
  const listFolderFn = useServerFn(listDriveFolderVideos);
  const driveAuthUrlFn = useServerFn(getDriveAuthUrl);
  const disconnectDriveFn = useServerFn(disconnectDrive);

  const [folderUrl, setFolderUrl] = useState(DEFAULT_FOLDER_URL);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("public");
  const [channelId, setChannelId] = useState("");
  const [kind, setKind] = useState<"video" | "reels">("video");
  const [slotTimes, setSlotTimes] = useState("06:00,13:00,19:00");
  const [startDate, setStartDate] = useState("");
  const [maxVideos, setMaxVideos] = useState("50");
  const [timezone, setTimezone] = useState("Asia/Makassar");
  const [queue, setQueue] = useState<string[]>([]);
  const [redirectUri, setRedirectUri] = useState("");
  useEffect(() => {
    setRedirectUri(`${window.location.origin}/api/public/facebook/callback`);
  }, []);


  // Terapkan pengaturan tersimpan sekali saat dimuat, supaya tetap sama setelah remix.
  const [settingsApplied, setSettingsApplied] = useState(false);
  useEffect(() => {
    if (settingsApplied || !settings.data) return;
    setChannelId(settings.data.channelId);
    setKind(settings.data.kind === "reels" ? "reels" : "video");
    setPrivacy(settings.data.privacy || "public");
    if (settings.data.description) setDescription(settings.data.description);
    if (settings.data.slotTimes) setSlotTimes(settings.data.slotTimes);
    setSettingsApplied(true);
  }, [settings.data, settingsApplied]);

  useEffect(() => {
    const first = channels.data?.[0]?.id;
    if (settingsApplied && first && !channelId) setChannelId(first);
  }, [channels.data, channelId, settingsApplied]);

  const saveSettings = useMutation({
    mutationFn: () =>
      saveSettingsFn({
        data: {
          channelId,
          channelTitle: channels.data?.find((c) => c.id === channelId)?.title ?? null,
          kind,
          privacy,
          description,
        },
      }),
    onSuccess: () => {
      toast.success("Pengaturan default disimpan.");
      queryClient.invalidateQueries({ queryKey: ["yt-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fb_connected")) {
      toast.success("Fan Page Facebook berhasil terhubung.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    const err = params.get("fb_error") ?? params.get("yt_error");
    if (err) {
      toast.error(err);
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("drive_connected")) {
      toast.success("Google Drive terhubung.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const connectDrive = useMutation({
    mutationFn: () => driveAuthUrlFn(),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeDrive = useMutation({
    mutationFn: () => disconnectDriveFn(),
    onSuccess: () => {
      toast.success("Koneksi Google Drive dilepas.");
      queryClient.invalidateQueries({ queryKey: ["yt-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const connect = useMutation({
    mutationFn: () => authUrlFn({ data: { origin: window.location.origin } }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: (channelId?: string | null) => disconnectFn({ data: { channelId: channelId ?? null } }),
    onSuccess: (_res, channelId) => {
      toast.success(channelId ? "Fan Page diputus." : "Semua Fan Page diputus.");
      queryClient.invalidateQueries({ queryKey: ["yt-status"] });
      queryClient.invalidateQueries({ queryKey: ["yt-channels"] });
      setChannelId((current) => (!channelId || channelId === current ? "" : current));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const channelTitle = channels.data?.find((c) => c.id === channelId)?.title ?? null;


  const cancelSchedule = useMutation({
    mutationFn: (id: string) => cancelScheduleFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Jadwal dibatalkan.");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelAll = useMutation({
    mutationFn: (channelId: string | null) => cancelAllFn({ data: { channelId } }),
    onSuccess: (res) => {
      toast.success(`${res.deleted} jadwal dihapus.`);
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const autoSchedule = useMutation({
    mutationFn: () =>
      autoScheduleFn({
        data: {
          folderUrl,
          channelId,
          channelTitle,
          kind,
          privacy,
          slotTimes,
          timezone,
          startDate: startDate || null,
          maxVideos: Number(maxVideos) || 50,
        },
      }),
    onSuccess: (res) => {
      if (res.scheduled === 0) {
        toast.info("Semua video di folder ini sudah dijadwalkan sebelumnya.");
      } else {
        toast.success(
          `${res.scheduled} video dijadwalkan${res.skipped ? `, ${res.skipped} dilewati (duplikat)` : ""}.`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scheduleQueue = useMutation({
    mutationFn: () =>
      scheduleSelectedFn({
        data: {
          folderUrl,
          fileIds: queue,
          channelId,
          channelTitle,
          kind,
          privacy,
          slotTimes,
          timezone,
          startDate: startDate || null,
        },
      }),
    onSuccess: (res) => {
      if (res.scheduled === 0) {
        toast.info("Semua video pilihan sudah dijadwalkan sebelumnya.");
      } else {
        toast.success(`${res.scheduled} video dijadwalkan sesuai slot jam.`);
      }
      setQueue([]);
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Jalankan jadwal yang jatuh tempo saat halaman terbuka (selain cron eksternal).
  const scheduledItems = (uploads.data ?? []).filter((u) => u.status === "scheduled");
  // Kelompokkan jadwal per channel supaya daftar tetap ringkas.
  const scheduleGroups = Array.from(
    scheduledItems
      .reduce((map, item) => {
        const key = item.channel_title ?? "tanpa-channel";
        const group = map.get(key) ?? { key, title: item.channel_title ?? "Tanpa channel", items: [] as typeof scheduledItems };
        group.items.push(item);
        map.set(key, group);
        return map;
      }, new Map<string, { key: string; title: string; items: typeof scheduledItems }>())
      .values(),
  ).sort((a, b) => a.title.localeCompare(b.title, "id"));
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [showAllHistory, setShowAllHistory] = useState(false);


  const hasDue = scheduledItems.some(
    (u) => u.scheduled_at && new Date(u.scheduled_at).getTime() <= Date.now(),
  );
  useEffect(() => {
    if (!hasDue) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await runDueFn({});
        if (!cancelled && res.processed > 0) {
          toast.info(`${res.processed} jadwal upload dijalankan.`);
          queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
        }
      } catch {
        /* diamkan; akan dicoba lagi */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasDue, runDueFn, queryClient]);

  useEffect(() => {
    if (scheduledItems.length === 0) return;
    const timer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    }, 30_000);
    return () => clearInterval(timer);
  }, [scheduledItems.length, queryClient]);

  // Penghitung waktu tersisa (live tiap detik).
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (scheduledItems.length === 0) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [scheduledItems.length]);

  const formatRemaining = (iso: string | null) => {
    if (!iso) return null;
    let diff = Math.floor((new Date(iso).getTime() - nowTs) / 1000);
    if (diff <= 0) return "sedang diproses…";
    const d = Math.floor(diff / 86400);
    diff %= 86400;
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    const parts = [
      d > 0 ? `${d}h` : null,
      d > 0 || h > 0 ? `${h}j` : null,
      `${m}m`,
      d > 0 ? null : `${s}d`,
    ].filter(Boolean);
    return `${parts.join(" ")} lagi`;
  };




  const browseFolder = useMutation({
    mutationFn: (url: string) =>
      listFolderFn({ data: { folderUrl: url, channelId, channelTitle } }),
    onSuccess: (res) => {
      if (res.needsAuth) {
        toast.info(res.authMessage ?? "Hubungkan ulang akun Google Drive untuk memuat folder.");
      } else if (res.videos.length === 0) {
        toast.info("Tidak ada file video di folder ini.");
      } else {
        toast.success(`${res.videos.length} video ditemukan.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const folderVideos = browseFolder.data?.videos ?? [];
  const subFolders = browseFolder.data?.folders ?? [];

  const pickVideo = (file: { id: string; name: string; webViewLink: string }) => {
    setSelectedFileId(file.id);
  };

  const usedFileIds = new Set(
    (uploads.data ?? [])
      .filter((u) => ["scheduled", "uploading", "done"].includes(u.status))
      .map((u) => u.drive_file_id)
      .filter(Boolean) as string[],
  );
  const nextAvailable = folderVideos.find((f) => !usedFileIds.has(f.id));

  const tzLabel =
    timezone === "Asia/Jakarta" ? "WIB" : timezone === "Asia/Jayapura" ? "WIT" : "WITA";
  const slotList = slotTimes
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s));
  const toggleQueue = (id: string) =>
    setQueue((q) => (q.includes(id) ? q.filter((x) => x !== id) : [...q, id]));
  const slotLabelFor = (index: number) => {
    if (slotList.length === 0) return "-";
    const day = Math.floor(index / slotList.length);
    const slot = slotList[index % slotList.length];
    const dayLabel = day === 0 ? "Hari 1" : `Hari ${day + 1}`;
    return `${dayLabel} • ${slot} ${tzLabel}`;
  };
  const queueFiles = queue
    .map((id) => folderVideos.find((f) => f.id === id))
    .filter(Boolean) as typeof folderVideos;


  const connected = status.data?.connected ?? false;
  const configured = status.data?.configured ?? false;
  const accounts = status.data?.accounts ?? [];
  const driveConnected = status.data?.driveConnected ?? false;

  return (
    <main className="min-h-screen px-4 py-12">
      <Toaster />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-80"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-2xl space-y-8">
        <header className="space-y-3 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs tracking-widest text-muted-foreground uppercase">
            <Facebook className="size-4 text-primary" /> Drive → Fan Page Facebook
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">
            Unggah video Drive ke Fan Page Facebook
          </h1>
          <p className="text-muted-foreground">
            Tempel link Google Drive yang aksesnya publik, lalu sistem mengunggahnya langsung ke
            Fan Page Facebook Anda.
          </p>
        </header>


        <section
          className="rounded-2xl border border-border bg-card p-6"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">Akun Facebook</h2>
                <p className="text-sm text-muted-foreground">
                  {!configured
                    ? "Kredensial Facebook App belum diatur."
                    : connected
                      ? `${accounts.length} Fan Page terhubung`
                      : "Belum terhubung"}
                </p>
                {status.data?.redirectUri && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Redirect URI yang harus terdaftar di pengaturan Facebook App:{" "}
                    <code className="break-all rounded bg-muted px-1 py-0.5">
                      {status.data.redirectUri}
                    </code>
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  variant={connected ? "secondary" : "default"}
                  disabled={!configured || connect.isPending}
                  onClick={() => connect.mutate()}
                >
                  {connected ? <Plus className="size-4" /> : <Facebook className="size-4" />}
                  {connected ? "Hubungkan ulang" : "Login Facebook"}
                </Button>
                {connected && (
                  <Button variant="ghost" onClick={() => disconnect.mutate(null)}>
                    <LogOut className="size-4" /> Putuskan semua
                  </Button>
                )}
              </div>
            </div>

            {!connected && (
              <div className="space-y-2 rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  Error redirect_uri_mismatch? Tambahkan URI di bawah ke “Valid OAuth Redirect
                  URIs” pada pengaturan Facebook Login di Meta for Developers, lalu coba login
                  lagi.
                </p>
                <ul className="space-y-1">
                  {[redirectUri].map((uri) => (
                    <li key={uri} className="flex items-center gap-2">
                      <code className="break-all">{uri}</code>
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(redirectUri);
                    toast.success("URI disalin");
                  }}
                >
                  Salin URI
                </Button>
              </div>
            )}




            {accounts.length > 0 && (
              <ul className="space-y-2">
                {accounts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-2"
                  >
                    <span className="truncate text-sm">{a.title ?? a.id}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => disconnect.mutate(a.id)}
                    >
                      Putuskan
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Google Drive</p>
                  <p className="text-xs text-muted-foreground">
                    {driveConnected
                      ? "Izin Drive aktif — folder & file privat bisa dibaca."
                      : "Belum ada izin Drive. Hubungkan dengan akun Google biasa (bukan Brand Account)."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={driveConnected ? "secondary" : "default"}
                    disabled={!configured || connectDrive.isPending}
                    onClick={() => connectDrive.mutate()}
                  >
                    <FolderOpen className="size-4" />
                    {driveConnected ? "Hubungkan ulang" : "Hubungkan Google Drive"}
                  </Button>
                  {driveConnected && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={removeDrive.isPending}
                      onClick={() => removeDrive.mutate()}
                    >
                      Lepas
                    </Button>
                  )}
                </div>
              </div>

              <Label>Langkah 1 — Pilih Fan Page tujuan</Label>
              <Select value={channelId} onValueChange={setChannelId} disabled={!connected}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      channels.isLoading ? "Memuat Fan Page…" : "Pilih Fan Page Facebook"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {channels.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {connected && (
                <p className="text-xs text-muted-foreground">
                  Fan Page lain belum muncul? Klik "Hubungkan ulang" lalu login dengan akun
                  Facebook yang mengelola halaman tersebut.
                </p>
              )}
            </div>
          </div>
        </section>

        <section
          className="space-y-5 rounded-2xl border border-border bg-card p-6"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          <div className="space-y-2">
            <Label htmlFor="folder">Langkah 2 — Pilih video dari folder Google Drive</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderOpen className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="folder"
                  className="pl-9"
                  placeholder="https://drive.google.com/drive/folders/..."
                  value={folderUrl}
                  disabled={!channelId}
                  onChange={(e) => setFolderUrl(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={!channelId || !folderUrl.trim() || browseFolder.isPending}
                onClick={() => browseFolder.mutate(folderUrl)}
              >
                {browseFolder.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>Muat video</>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {channelId
                ? "Tempel link folder, lalu pilih video pertama yang tersedia di bawah — video yang sudah dijadwalkan/diunggah ditandai."
                : "Pilih Fan Page tujuan dulu di atas sebelum memuat folder."}
            </p>
            {folderCodeForChannel(channelId, channelTitle) && (
              <p className="text-xs text-primary">
                Fan Page ini hanya mengambil video dari folder{" "}
                <strong>{folderCodeForChannel(channelId, channelTitle)}</strong> (dicari otomatis di
                dalam link folder di atas).
              </p>
            )}

            {browseFolder.data?.folderName && (
              <p className="pt-1 text-xs text-muted-foreground">
                Folder aktif: <strong className="text-foreground">{browseFolder.data.folderName}</strong>
                {subFolders.length > 0 ? ` — ${subFolders.length} folder` : ""}
                {folderVideos.length > 0 ? ` — ${folderVideos.length} video` : ""}
              </p>
            )}

            {subFolders.length > 0 && (
              <ul className="mt-2 space-y-1 rounded-xl border border-border p-1">
                {subFolders.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setFolderUrl(f.webViewLink);
                        browseFolder.mutate(f.webViewLink);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <FolderOpen className="size-4 shrink-0 text-primary" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-muted-foreground">buka</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}


            {folderVideos.length > 0 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="text-xs text-muted-foreground">
                  {folderVideos.length - usedFileIds.size > 0
                    ? `${folderVideos.filter((f) => !usedFileIds.has(f.id)).length} video belum dijadwalkan`
                    : "Semua video sudah dijadwalkan"}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!nextAvailable}
                  onClick={() => nextAvailable && pickVideo(nextAvailable)}
                >
                  Pilih video pertama yang tersedia
                </Button>
              </div>
            )}

            {folderVideos.length > 0 && (
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
                {folderVideos.map((f) => (
                  <li key={f.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Tambah ke antrean jadwal"
                      onClick={() => toggleQueue(f.id)}
                      disabled={usedFileIds.has(f.id)}
                      className={`ml-1 flex size-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-medium transition-colors ${
                        queue.includes(f.id)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      } ${usedFileIds.has(f.id) ? "opacity-40" : ""}`}
                    >
                      {queue.includes(f.id) ? queue.indexOf(f.id) + 1 : "+"}
                    </button>
                    <button
                      type="button"
                      onClick={() => pickVideo(f)}
                      className={`flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        selectedFileId === f.id
                          ? "bg-primary/10 text-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      <Film className="size-4 shrink-0 text-muted-foreground" />
                      <span
                        className={`flex-1 truncate ${usedFileIds.has(f.id) ? "text-muted-foreground line-through" : ""}`}
                      >
                        {f.name}
                      </span>
                      {usedFileIds.has(f.id) && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                          sudah dijadwalkan
                        </span>
                      )}
                      {f.size != null && (
                        <span className="text-xs text-muted-foreground">
                          {(f.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      )}
                      {selectedFileId === f.id && (
                        <CheckCircle2 className="size-4 text-primary" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>




          <div className="space-y-3 rounded-xl border border-dashed border-border p-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" />
              <h3 className="text-sm font-medium">Jadwal slot harian</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Tandai video dengan tombol “+” pada daftar di atas sesuai urutan tayang, atau pilih
              jumlah video tertentu agar sistem menandainya secara otomatis. Video ke-1 masuk slot
              jam pertama, video ke-2 slot kedua, dan seterusnya (lanjut ke hari berikutnya bila
              slot habis).
            </p>
            <div className="space-y-2">
              <Label htmlFor="slot-times">Slot jam harian</Label>
              <Input
                id="slot-times"
                placeholder="06:00,13:00,19:00"
                value={slotTimes}
                onChange={(e) => setSlotTimes(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Jam ramai (3x)", value: "06:30,12:30,19:30" },
                  { label: "Prime time (2x)", value: "12:30,20:00" },
                  { label: "Subuh & malam", value: "05:00,20:30" },
                  { label: "Padat (4x)", value: "06:30,12:30,17:00,20:30" },
                ].map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    size="sm"
                    variant={slotTimes === preset.value ? "default" : "outline"}
                    onClick={() => setSlotTimes(preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Jam tayang terbaik untuk audiens Indonesia: 06:00–08:00, 12:00–13:00, dan
                19:00–22:00. Hindari jam sepi (01:00–05:00) dan jangan menumpuk lebih dari 3 video
                per hari agar impresi tiap video tidak terpecah.
              </p>

            </div>
            <div className="space-y-2">
              <Label>Zona waktu</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Asia/Jakarta">WIB (Asia/Jakarta)</SelectItem>
                  <SelectItem value="Asia/Makassar">WITA (Asia/Makassar)</SelectItem>
                  <SelectItem value="Asia/Jayapura">WIT (Asia/Jayapura)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="start-date">Tanggal mulai</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-videos">Jumlah video</Label>
                <Input
                  id="max-videos"
                  type="number"
                  min={1}
                  max={200}
                  value={maxVideos}
                  onChange={(e) => setMaxVideos(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!folderVideos.length}
                onClick={() => {
                  const count = Math.max(1, Math.min(Number(maxVideos) || 50, 200));
                  const available = folderVideos.filter((f) => !usedFileIds.has(f.id));
                  const next = available.slice(0, count);
                  setQueue((q) => Array.from(new Set([...q, ...next.map((f) => f.id)])));
                  if (next.length > 0) toast.info(`${next.length} video dipilih otomatis.`);
                }}
              >
                <Plus className="size-4" /> Pilih {maxVideos} video pertama
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={queue.length === 0}
                onClick={() => setQueue([])}
              >
                Kosongkan pilihan
              </Button>
            </div>

            {queueFiles.length > 0 && (
              <div className="space-y-1 rounded-lg border border-border p-2">
                {queueFiles.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <span className="w-5 shrink-0 text-muted-foreground">{i + 1}.</span>
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5">
                      {slotLabelFor(i)}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => toggleQueue(f.id)}>
                      Hapus
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Button
              type="button"
              className="w-full"
              disabled={
                !connected || !channelId || queue.length === 0 || scheduleQueue.isPending
              }
              onClick={() => scheduleQueue.mutate()}
            >
              {scheduleQueue.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarClock className="size-4" />
              )}
              {scheduleQueue.isPending
                ? "Menyimpan…"
                : `Simpan jadwal ${queue.length ? `(${queue.length} video)` : ""}`}
            </Button>

            <Button
              type="button"
              className="w-full"
              variant="secondary"
              disabled={!connected || !channelId || !folderUrl.trim() || autoSchedule.isPending}
              onClick={() => autoSchedule.mutate()}
            >
              {autoSchedule.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarClock className="size-4" />
              )}
              {autoSchedule.isPending
                ? "Membuat jadwal…"
                : `Jadwalkan ${maxVideos} video pertama otomatis`}
            </Button>
          </div>

        </section>

        {scheduledItems.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm tracking-widest text-muted-foreground uppercase">
                Jadwal upload ({scheduledItems.length})
              </h2>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={cancelAll.isPending}
                onClick={() => {
                  if (confirm("Hapus semua jadwal upload yang belum berjalan?"))
                    cancelAll.mutate(null);
                }}
              >
                Hapus semua
              </Button>
            </div>
            <ul className="space-y-2">
              {scheduleGroups.map((group) => {
                const open = openGroups[group.key] ?? false;
                const next = group.items
                  .map((i) => i.scheduled_at)
                  .filter(Boolean)
                  .sort()[0];
                return (
                  <li key={group.key} className="rounded-xl border border-border bg-card">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                      onClick={() => setOpenGroups((s) => ({ ...s, [group.key]: !open }))}
                    >
                      <CalendarClock className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {group.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {group.items.length}
                      </span>
                      <ChevronDown
                        className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </button>

                    {!open && next && (
                      <p className="px-4 pb-3 text-xs text-muted-foreground">
                        Berikutnya {new Date(next).toLocaleString("id-ID")}
                      </p>
                    )}

                    {open && (
                      <div className="flex justify-end border-t border-border px-4 py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={cancelAll.isPending}
                          onClick={() => {
                            if (confirm(`Hapus semua jadwal untuk ${group.title}?`))
                              cancelAll.mutate(group.items[0]?.channel_id ?? null);
                          }}
                        >
                          Hapus semua di Fan Page ini
                        </Button>
                      </div>
                    )}

                    {open && (
                      <ul className="border-t border-border">
                        {group.items.map((item) => (
                          <li
                            key={item.id}
                            className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{item.title}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {item.scheduled_at
                                  ? new Date(item.scheduled_at).toLocaleString("id-ID")
                                  : "Waktu belum diatur"}
                                {item.kind === "reels" ? " • Reels" : ""}
                                {item.scheduled_at ? ` • ${formatRemaining(item.scheduled_at)}` : ""}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={cancelSchedule.isPending}
                              onClick={() => cancelSchedule.mutate(item.id)}
                            >
                              Batalkan
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>

          </section>
        )}

        {(() => {
          const history = (uploads.data ?? []).filter((u) => u.status !== "scheduled");
          if (history.length === 0) return null;
          const shown = showAllHistory ? history : history.slice(0, 5);
          return (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm tracking-widest text-muted-foreground uppercase">
                  Riwayat upload
                </h2>
                <span className="text-xs text-muted-foreground">{history.length}</span>
              </div>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {shown.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                    {item.status === "done" ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-accent" />
                    ) : item.status === "error" ? (
                      <XCircle className="size-3.5 shrink-0 text-destructive" />
                    ) : (
                      <UploadCloud className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                    {item.status === "done" && item.video_id ? (
                      <a
                        className="shrink-0 text-xs text-muted-foreground underline"
                        href={`https://www.facebook.com/${item.channel_id ?? "watch"}/videos/${item.video_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Lihat
                      </a>
                    ) : (
                      <span className="shrink-0 truncate text-xs text-muted-foreground max-w-[40%]">
                        {item.error ?? item.status}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {history.length > 5 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => setShowAllHistory((v) => !v)}
                >
                  {showAllHistory ? "Tampilkan lebih sedikit" : `Tampilkan semua (${history.length})`}
                </button>
              )}
            </section>
          );
        })()}


      </div>
    </main>
  );
}
