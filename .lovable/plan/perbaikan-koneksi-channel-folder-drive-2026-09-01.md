# Perbaikan koneksi channel ↔ folder Drive

## Diagnosis
Pemetaan di `src/lib/channel-folders.ts` sudah sama persis dengan daftar yang Anda berikan
(Dakwah Pendek=UAS 2, Surga Untukmu=UAH 2, Nasehat Dakwah=UDL, Dakwah UAS=UAS,
Dr Zaidul Akbar Video=DZA 2, Dakwah UAH=UAH). Pencocokan subfolder juga sudah exact.
Jadi sumber "salah" kemungkinan besar salah satu dari:
1. Nama folder asli di Drive tidak persis sama dengan kodenya (mis. `UAS2` vs `UAS 2`, spasi ganda, huruf besar/kecil).
2. Tampilan "Muat video" di Langkah 2 menampilkan isi folder yang Anda tempel apa adanya, tidak otomatis masuk ke subfolder milik channel — sehingga terlihat seperti channel terhubung ke folder yang salah.

## Langkah
1. **Verifikasi nama folder asli di Drive**: panggil Drive API untuk membuat daftar subfolder di bawah folder induk `1TxuGXApoNmA7FeCTHce9OsC4n6xvwJ56`, lalu bandingkan dengan 8 kode channel. Tampilkan hasilnya di chat.
2. **Perbaiki pemetaan** di `src/lib/channel-folders.ts` bila ada nama folder asli yang berbeda dari kode (mis. `UAS2`).
3. **Buat pencocokan folder lebih toleran** di `findSubfolderByName` (`src/lib/drive.server.ts`): normalisasi spasi/case (mis. "uas 2" = "uas2" = "UAS  2") agar variasi penamaan tidak menggagalkan resolusi — tetap exact setelah normalisasi, jadi "UAH" tidak akan ketukar "UAH 2".
4. **Selaraskan tampilan "Muat video"** di `src/routes/index.tsx`: saat channel dipilih, daftar video langsung dibaca dari subfolder milik channel (memakai `resolveChannelFolderId` yang sama dengan autopilot), sehingga yang tampil di UI = yang dipindai autopilot.
5. **Uji end-to-end**: jalankan pemindaian manual lewat endpoint cron, pastikan tiap channel resolve ke foldernya tanpa error dan video baru (bila ada) masuk antrian; cek `last_scan_result` tiap channel.

## Teknis
- File yang diubah: `src/lib/channel-folders.ts`, `src/lib/drive.server.ts`, `src/lib/drive.functions.ts` (resolve subfolder untuk UI), `src/routes/index.tsx`.
- Tidak ada perubahan skema database.
- Verifikasi: `bunx tsgo --noEmit` bersih + hasil pemindaian per channel.
