/**
 * Server-only: hitung slot jam harian (mis. 06:00, 13:00, 19:00) pada zona waktu
 * tertentu dan ubah menjadi waktu UTC untuk disimpan di kolom `scheduled_at`.
 */

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - utcMs;
}

/** Ubah waktu dinding (wall time) pada zona waktu tertentu menjadi Date UTC. */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ms = guess - tzOffsetMs(guess, timeZone);
  ms = guess - tzOffsetMs(ms, timeZone);
  return new Date(ms);
}

/** Tanggal kalender "hari ini" menurut zona waktu tertentu. */
export function todayInZone(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = parts.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/** Ubah "06:00,13:00,19:00" menjadi daftar {hour, minute} terurut & unik. */
export function parseSlotTimes(input: string): Array<{ hour: number; minute: number }> {
  const slots = (input ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) throw new Error(`Format jam "${s}" tidak valid. Gunakan HH:MM, contoh 06:00.`);
      const hour = Number(m[1]);
      const minute = Number(m[2]);
      if (hour > 23 || minute > 59) throw new Error(`Jam "${s}" di luar rentang 00:00–23:59.`);
      return { hour, minute };
    });
  const unique = Array.from(new Set(slots.map((s) => s.hour * 60 + s.minute))).sort((a, b) => a - b);
  if (unique.length === 0) throw new Error("Isi minimal satu slot jam, contoh 06:00.");
  return unique.map((total) => ({ hour: Math.floor(total / 60), minute: total % 60 }));
}

/**
 * Buat `count` waktu jadwal berurutan: slot hari ini yang masih di depan,
 * lalu lanjut ke hari berikutnya, dst.
 */
export function buildSlotSchedule(options: {
  count: number;
  slotTimes: string;
  timeZone: string;
  startAfter?: Date;
  startDate?: string | null; // YYYY-MM-DD pada zona waktu tsb
}): Date[] {
  const { count, timeZone } = options;
  const slots = parseSlotTimes(options.slotTimes);
  const startAfter = options.startAfter ?? new Date(Date.now() + 60_000);

  let base = options.startDate?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? (() => {
        const [y, m, d] = options.startDate!.split("-").map(Number);
        return { year: y!, month: m!, day: d! };
      })()
    : todayInZone(timeZone, startAfter);

  const result: Date[] = [];
  for (let dayOffset = 0; dayOffset < 400 && result.length < count; dayOffset += 1) {
    // gunakan aritmetika tanggal UTC untuk berpindah hari kalender
    const cursor = new Date(Date.UTC(base.year, base.month - 1, base.day));
    cursor.setUTCDate(cursor.getUTCDate() + dayOffset);
    for (const slot of slots) {
      if (result.length >= count) break;
      const when = zonedWallTimeToUtc(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + 1,
        cursor.getUTCDate(),
        slot.hour,
        slot.minute,
        timeZone,
      );
      if (when.getTime() <= startAfter.getTime()) continue;
      result.push(when);
    }
  }
  return result;
}
