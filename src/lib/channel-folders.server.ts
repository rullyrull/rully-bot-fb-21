/**
 * Server-only: pastikan setiap channel hanya membaca folder Drive miliknya
 * (mis. Ustadz Felix Siauw → folder UFS). Folder dicari berdasarkan nama
 * di dalam link folder yang diberikan, jadi tidak perlu ID folder manual.
 */

import { folderCodeForChannel } from "./channel-folders";
import {
  findSubfolderByName,
  getDriveFolderName,
  parseDriveFolderId,
} from "./drive.server";

/**
 * Kembalikan ID folder Drive yang benar untuk channel ini.
 * Kalau link yang diberikan sudah folder kodenya, dipakai langsung.
 * Kalau link berupa folder induk, dicari subfolder dengan kode channel.
 */
export async function resolveChannelFolderId(opts: {
  folderUrl: string;
  channelId?: string | null;
  channelTitle?: string | null;
  accessToken: string;
}): Promise<string> {
  const baseId = parseDriveFolderId(opts.folderUrl);
  if (!baseId) throw new Error("Link folder Google Drive tidak valid.");

  const code = folderCodeForChannel(opts.channelId, opts.channelTitle);
  if (!code) return baseId;

  const baseName = (await getDriveFolderName(baseId, opts.accessToken)) ?? "";
  if (baseName.trim().toUpperCase().replace(/\s+/g, "") === code.replace(/\s+/g, "")) return baseId;

  const found = await findSubfolderByName(baseId, code, opts.accessToken);
  if (found) return found;

  throw new Error(
    `Folder "${code}" tidak ditemukan di dalam folder Drive ini. Channel ini hanya boleh mengambil video dari folder ${code}.`,
  );
}
