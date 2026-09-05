/**
 * Pemetaan channel YouTube → nama folder Google Drive sumber video.
 * Setiap channel HANYA boleh mengambil video dari folder miliknya sendiri.
 */

export const CHANNEL_FOLDER_BY_ID: Record<string, string> = {
  "UC2ETose1YBtmRL3J5GH2m8w": "Ustadz Abdul Somad Dakwah",
  "UC4a-WcXrern7Ruwftg8t1bQ": "UAS Dakwah",
  "UCpRIWXCPSDRegxd8_486WnA": "Ustadz Hanan Attaki Video",
  "UCJchFyHK43MsFCBxikpB11Q": "UAH Dakwah",
  "UC0uzZzz8Cput1xzfJHMIt0g": "UAH Dakwah id",
  "UCvCzniqYlYnq4h1F6k522fg": "Habib Jafar Video",
};

export const CHANNEL_FOLDER_BY_TITLE: Record<string, string> = {
  "ustadz abdul somad dakwah": "Ustadz Abdul Somad Dakwah",
  "uas dakwah": "UAS Dakwah",
  "ust dasad latief dakwah": "Ust Dasad Latief Dakwah",
  "ustadz hanan attaki video": "Ustadz Hanan Attaki Video",
  "habib jafar video": "Habib Jafar Video",
  "dr zaidul akbar resep": "DZA 2",
  // "UAH Dakwah" dipetakan lewat ID karena ada 2 channel dengan judul sama.
};

/** Kode folder Drive untuk channel tertentu (null bila belum dipetakan). */
export function folderCodeForChannel(
  channelId?: string | null,
  channelTitle?: string | null,
): string | null {
  if (channelId && CHANNEL_FOLDER_BY_ID[channelId]) return CHANNEL_FOLDER_BY_ID[channelId]!;
  const title = (channelTitle ?? "").trim().toLowerCase();
  if (title && CHANNEL_FOLDER_BY_TITLE[title]) return CHANNEL_FOLDER_BY_TITLE[title]!;
  return null;
}
