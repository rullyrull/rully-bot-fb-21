import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Link2,
  UploadCloud,
  CheckCircle2,
  XCircle,
  FolderOpen,
  Film,
  Loader2,
  CalendarClock,
  Clock,
  Trash2,
  ArrowLeft,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  getYoutubeStatus,
  getAppSettings,
  listUploads,
  listYoutubeChannels,
  saveAppSettings,
  uploadFromDrive,
  scheduleUpload,
  cancelScheduledUpload,
  runDueUploads,
} from "@/lib/youtube.functions";
import {
  listDriveFolderVideos,
  autoScheduleFolder,
  scheduleSelectedVideos,
} from "@/lib/drive.functions";
import {
  listAutopilots,
  saveAutopilot,
  setAutopilotEnabled,
  runAutopilotScan,
} from "@/lib/autopilot.functions";
import { buildDescription, buildTitle } from "@/lib/video-meta";

const DEFAULT_FOLDER_URL =
  "https://drive.google.com/drive/folders/1IzcsZbKEKGRgs4Gc6wcsjKFJeNTUU4Q1?usp=drive_link";

export const Route = createFileRoute("/channel/$channelId")({
  head: () => ({
    meta: [
      { title: "Pilih Video & Jadwal Unggah — Drive to Facebook" },
      {
        name: "description",
        content:
          "Pilih video dari folder Google Drive untuk Fan Page yang dipilih, atur detail unggahan, lalu jadwalkan tayang otomatis.",
      },
      { property: "og:title", content: "Pilih Video & Jadwal Unggah — Drive to Facebook" },
      {
        property: "og:description",
        content:
          "Pilih video dari folder Google Drive dan jadwalkan unggahannya ke Fan Page Facebook pilihan Anda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChannelWorkspace,
});

function ChannelWorkspace() {
  const { channelId } = Route.useParams();
  const queryClient = useQueryClient();

  const statusFn = useServerFn(getYoutubeStatus);
  const uploadsFn = useServerFn(listUploads);
  const settingsFn = useServerFn(getAppSettings);
  const channelsFn = useServerFn(listYoutubeChannels);
  const status = useQuery({ queryKey: ["yt-status"], queryFn: () => statusFn() });
  const uploads = useQuery({ queryKey: ["yt-uploads"], queryFn: () => uploadsFn() });
  const settings = useQuery({ queryKey: ["yt-settings"], queryFn: () => settingsFn() });
  const channels = useQuery({ queryKey: ["yt-channels"], queryFn: () => channelsFn() });

  const saveSettingsFn = useServerFn(saveAppSettings);
  const uploadFn = useServerFn(uploadFromDrive);
  const listFolderFn = useServerFn(listDriveFolderVideos);
  const scheduleFn = useServerFn(scheduleUpload);
  const cancelScheduleFn = useServerFn(cancelScheduledUpload);
  const runDueFn = useServerFn(runDueUploads);
  const autoScheduleFn = useServerFn(autoScheduleFolder);
  const scheduleSelectedFn = useServerFn(scheduleSelectedVideos);
  const listAutopilotsFn = useServerFn(listAutopilots);
  const saveAutopilotFn = useServerFn(saveAutopilot);
  const setAutopilotEnabledFn = useServerFn(setAutopilotEnabled);
  const runAutopilotScanFn = useServerFn(runAutopilotScan);
  const autopilots = useQuery({ queryKey: ["autopilots"], queryFn: () => listAutopilotsFn() });
  const autopilot = autopilots.data?.find((a) => a.channel_id === channelId) ?? null;

  const [driveUrl, setDriveUrl] = useState("");
  const [folderUrl, setFolderUrl] = useState(DEFAULT_FOLDER_URL);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("public");
  const [kind, setKind] = useState<"video" | "reels">("video");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [slotTimes, setSlotTimes] = useState("06:00,13:00,19:00");
  const [startDate, setStartDate] = useState("");
  const [maxVideos, setMaxVideos] = useState("50");
  const [timezone, setTimezone] = useState("Asia/Makassar");
  const [queue, setQueue] = useState<string[]>([]);

  const [settingsApplied, setSettingsApplied] = useState(false);
  useEffect(() => {
    if (settingsApplied || !settings.data) return;
    setKind(settings.data.kind === "reels" ? "reels" : "video");
    setPrivacy(settings.data.privacy);
    if (settings.data.description) setDescription(settings.data.description);
    if (settings.data.slotTimes) setSlotTimes(settings.data.slotTimes);
    setSettingsApplied(true);
  }, [settings.data, settingsApplied]);

  const connected = status.data?.connected ?? false;
  const channelTitle = channels.data?.find((c) => c.id === channelId)?.title ?? null;

  const saveSettings = useMutation({
    mutationFn: () =>
      saveSettingsFn({
        data: { channelId, channelTitle, kind, privacy, description },
      }),
    onSuccess: () => {
      toast.success("Pengaturan default disimpan.");
      queryClient.invalidateQueries({ queryKey: ["yt-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAuto = useMutation({
    mutationFn: (enabled: boolean) =>
      saveAutopilotFn({
        data: {
          channelId,
          channelTitle,
          folderUrl,
          slotTimes,
          timezone,
          kind,
          privacy,
          maxPerScan: Number(maxVideos) || 20,
          enabled,
        },
      }),
    onSuccess: () => {
      toast.success("Autopilot channel ini disimpan.");
      queryClient.invalidateQueries({ queryKey: ["autopilots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAuto = useMutation({
    mutationFn: (enabled: boolean) => setAutopilotEnabledFn({ data: { channelId, enabled } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["autopilots"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const scanNow = useMutation({
    mutationFn: () => runAutopilotScanFn(),
    onSuccess: (res) => {
      const total = res.results.reduce((sum, r) => sum + r.scheduled, 0);
      toast.success(`Pemindaian selesai: ${total} video baru masuk antrean.`);
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
      queryClient.invalidateQueries({ queryKey: ["autopilots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const upload = useMutation({
    mutationFn: () =>
      uploadFn({
        data: { driveUrl, title, description, privacy, channelId, channelTitle, kind },
      }),
    onSuccess: (res) => {
      toast.success(
        kind === "reels"
          ? "Reels berhasil diunggah. Facebook mungkin memerlukan waktu untuk memprosesnya."
          : "Video berhasil diunggah ke Fan Page Facebook!",
      );
      setDriveUrl("");
      setSelectedFileId("");
      setTitle("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
      window.open(res.url, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["yt-uploads"] }),
  });

  const schedule = useMutation({
    mutationFn: () =>
      scheduleFn({
        data: {
          driveUrl,
          title,
          description,
          privacy,
          channelId,
          channelTitle,
          kind,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        `Jadwal dibuat untuk ${new Date(res.scheduledAt as string).toLocaleString("id-ID")}.`,
      );
      setDriveUrl("");
      setSelectedFileId("");
      setTitle("");
      setScheduledAt("");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelSchedule = useMutation({
    mutationFn: (id: string) => cancelScheduleFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Jadwal dibatalkan.");
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

  const scheduledItems = (uploads.data ?? []).filter((u) => u.status === "scheduled");
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
    setDriveUrl(file.webViewLink);
    setTitle(buildTitle(file.name, channelTitle));
    setDescription(buildDescription(file.name, channelTitle));
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

  return (
    <main className="min-h-screen px-4 py-12">
      <Toaster />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-80"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-2xl space-y-8">
        <header className="space-y-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft className="size-4" /> Kembali ke pilih Fan Page
            </Link>
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight">
            {channelTitle ?? "Fan Page terpilih"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Langkah 2 — pilih video dari folder Drive, lalu Langkah 3 & 4 untuk detail dan waktu
            unggah.
          </p>
        </header>

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
                  onChange={(e) => setFolderUrl(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={!folderUrl.trim() || browseFolder.isPending}
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
              Tempel link folder, lalu pilih video pertama yang tersedia di bawah — video yang
              sudah dijadwalkan/diunggah ditandai.
            </p>

            {subFolders.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {subFolders.map((f) => (
                  <Button
                    key={f.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFolderUrl(f.webViewLink);
                      browseFolder.mutate(f.webViewLink);
                    }}
                  >
                    <FolderOpen className="size-3.5" /> {f.name}
                  </Button>
                ))}
              </div>
            )}

            {folderVideos.length > 0 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="text-xs text-muted-foreground">
                  {folderVideos.filter((f) => !usedFileIds.has(f.id)).length > 0
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
              Tandai video dengan tombol “+” pada daftar di atas sesuai urutan tayang, lalu simpan.
              Video ke-1 masuk slot jam pertama, video ke-2 slot kedua, dan seterusnya (lanjut ke
              hari berikutnya bila slot habis).
            </p>
            <div className="space-y-2">
              <Label htmlFor="slot-times">Slot jam harian</Label>
              <Input
                id="slot-times"
                placeholder="06:00,13:00,19:00"
                value={slotTimes}
                onChange={(e) => setSlotTimes(e.target.value)}
              />
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
                <Label htmlFor="max-videos">Jumlah maksimal video</Label>
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
              disabled={!connected || queue.length === 0 || scheduleQueue.isPending}
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
              disabled={!connected || !folderUrl.trim() || autoSchedule.isPending}
              onClick={() => autoSchedule.mutate()}
            >
              {autoSchedule.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarClock className="size-4" />
              )}
              {autoSchedule.isPending
                ? "Membuat jadwal…"
                : "Atau jadwalkan semua video di folder otomatis"}
            </Button>
          </div>

          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              <h3 className="text-sm font-medium">Autopilot Google Drive</h3>
              <span
                className={`ml-auto rounded-full border px-2 py-0.5 text-xs ${
                  autopilot?.enabled
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {autopilot ? (autopilot.enabled ? "Aktif" : "Nonaktif") : "Belum diatur"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Sistem memeriksa folder Drive channel ini otomatis setiap 5 menit. Setiap video baru yang
              Anda tambahkan ke folder langsung masuk antrean upload pada slot jam berikutnya, memakai
              setelan folder, slot jam, zona waktu, jenis, dan privasi di atas.

            </p>
            {autopilot && (
              <p className="text-xs text-muted-foreground">
                Pemeriksaan terakhir:{" "}
                {autopilot.last_scan_at
                  ? new Date(autopilot.last_scan_at).toLocaleString("id-ID")
                  : "belum pernah"}
                {autopilot.last_scan_result ? ` — ${autopilot.last_scan_result}` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!folderUrl.trim() || saveAuto.isPending}
                onClick={() => saveAuto.mutate(true)}
              >
                {saveAuto.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {autopilot ? "Simpan & aktifkan autopilot" : "Aktifkan autopilot"}
              </Button>
              {autopilot?.enabled && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={toggleAuto.isPending}
                  onClick={() => toggleAuto.mutate(false)}
                >
                  Nonaktifkan
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!connected || scanNow.isPending}
                onClick={() => scanNow.mutate()}
              >
                {scanNow.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {scanNow.isPending ? "Memindai…" : "Periksa Drive sekarang"}
              </Button>
            </div>
          </div>



          <div className="space-y-2">
            <Label htmlFor="drive">Link Google Drive (akses publik)</Label>
            <div className="relative">
              <Link2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="drive"
                className="pl-9"
                placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Langkah 3 — Jenis unggahan</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={kind === "video" ? "default" : "secondary"}
                onClick={() => setKind("video")}
              >
                Video biasa
              </Button>
              <Button
                type="button"
                variant={kind === "reels" ? "default" : "secondary"}
                onClick={() => setKind("reels")}
              >
                Reels
              </Button>
            </div>
            {kind === "reels" && (
              <p className="text-xs text-muted-foreground">
                Facebook Reels menerima file vertikal atau persegi berdurasi maksimal 3 menit.
                Sistem akan memeriksa metadata Drive bila tersedia dan menambahkan tagar #Reels
                otomatis.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Judul video</Label>
            <Input
              id="title"
              placeholder="Judul yang akan tampil di Facebook"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Deskripsi (opsional)</Label>
            <Textarea
              id="desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Unggahan ke Fan Page selalu tampil publik di halaman Anda.
          </p>

          <div className="space-y-2">
            <Label>Langkah 4 — Waktu unggah</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={mode === "now" ? "default" : "secondary"}
                onClick={() => setMode("now")}
              >
                <UploadCloud className="size-4" /> Upload sekarang
              </Button>
              <Button
                type="button"
                variant={mode === "schedule" ? "default" : "secondary"}
                onClick={() => setMode("schedule")}
              >
                <CalendarClock className="size-4" /> Jadwalkan
              </Button>
            </div>
            {mode === "schedule" && (
              <div className="space-y-2 pt-1">
                <Label htmlFor="schedule-at">Tanggal & jam unggah</Label>
                <Input
                  id="schedule-at"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "+1 jam", ms: 3_600_000 },
                    { label: "+3 jam", ms: 3 * 3_600_000 },
                    { label: "Besok pagi", ms: null },
                  ].map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const d = new Date();
                        if (preset.ms) d.setTime(d.getTime() + preset.ms);
                        else {
                          d.setDate(d.getDate() + 1);
                          d.setHours(8, 0, 0, 0);
                        }
                        const pad = (n: number) => String(n).padStart(2, "0");
                        setScheduledAt(
                          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                        );
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Jadwal memakai zona waktu perangkat Anda. Unggahan dijalankan otomatis saat
                  waktunya tiba (halaman ini juga memicu jadwal yang jatuh tempo saat dibuka).
                </p>
              </div>
            )}
          </div>

          <Button
            variant="secondary"
            className="w-full"
            disabled={saveSettings.isPending}
            onClick={() => saveSettings.mutate()}
          >
            Simpan sebagai pengaturan default
          </Button>

          {mode === "now" ? (
            <Button
              className="w-full"
              size="lg"
              disabled={!connected || upload.isPending}
              onClick={() => upload.mutate()}
            >
              <UploadCloud className="size-4" />
              {upload.isPending
                ? "Mengunggah…"
                : kind === "reels"
                  ? "Upload Reels"
                  : "Upload ke Fan Page"}
            </Button>
          ) : (
            <Button
              className="w-full"
              size="lg"
              disabled={!connected || !scheduledAt || schedule.isPending}
              onClick={() => schedule.mutate()}
            >
              <CalendarClock className="size-4" />
              {schedule.isPending ? "Menyimpan jadwal…" : "Jadwalkan upload"}
            </Button>
          )}
          {!connected && (
            <p className="text-center text-xs text-muted-foreground">
              Login akun Facebook dulu untuk mengaktifkan tombol upload.
            </p>
          )}
        </section>

        {scheduledItems.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm tracking-widest text-muted-foreground uppercase">
              Jadwal upload
            </h2>
            <ul className="space-y-2">
              {scheduledItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <Clock className="mt-0.5 size-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.scheduled_at
                        ? new Date(item.scheduled_at).toLocaleString("id-ID")
                        : "Menunggu"}
                      {item.channel_title ? ` • ${item.channel_title}` : ""}
                      {item.kind === "reels" ? " • Reels" : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancelSchedule.isPending}
                    onClick={() => cancelSchedule.mutate(item.id)}
                  >
                    <Trash2 className="size-4" /> Batalkan
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(uploads.data?.filter((u) => u.status !== "scheduled").length ?? 0) > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm tracking-widest text-muted-foreground uppercase">
              Riwayat upload
            </h2>
            <ul className="space-y-2">
              {uploads.data
                ?.filter((u) => u.status !== "scheduled")
                .map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                  >
                    {item.status === "done" ? (
                      <CheckCircle2 className="mt-0.5 size-4 text-accent" />
                    ) : item.status === "error" ? (
                      <XCircle className="mt-0.5 size-4 text-destructive" />
                    ) : (
                      <UploadCloud className="mt-0.5 size-4 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.status === "done" && item.video_id ? (
                          <a
                            className="underline"
                            href={`https://www.facebook.com/${item.channel_id ?? "watch"}/videos/${item.video_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Lihat di Facebook
                          </a>
                        ) : (
                          (item.error ?? item.status)
                        )}
                      </p>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
