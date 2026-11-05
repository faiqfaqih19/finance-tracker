# Finance Tracker melalui WhatsApp (WAHA di MacBook)

Kirim foto nota atau teks transaksi dari WhatsApp pribadi **ke nomor WhatsApp bot**.
Bot membaca nota melalui Gemini, menyimpannya di tab Transaksi yang sama dengan
website Finance Tracker, lalu mencoba mengirim satu balasan konfirmasi.

WAHA tidak memerlukan langganan gateway. Komputer, listrik/internet, dan API AI
memiliki biaya/kuota tersendiri. Pakai API key Gemini yang sudah ada; kuota gratis
AI dapat habis dan tidak dijamin selalu tersedia. WAHA adalah integrasi WhatsApp
tidak resmi. Gunakan nomor khusus bot, jangan nomor utama untuk sesi bot.

## Yang perlu disiapkan

1. MacBook Anda (M1 Pro didukung) dengan [Docker Desktop untuk Apple Silicon](https://docs.docker.com/desktop/setup/install/mac-install/), sudah dibuka dan berjalan.
2. Nomor WhatsApp bot yang berbeda dari nomor pribadi pengirim nota. QR yang dipindai
   adalah dari akun nomor bot melalui WhatsApp → Perangkat tertaut.
3. URL deployment Apps Script **Finance Tracker** berakhiran `/exec`, bukan proyek
   Tahfizh. Ambil dari Terapkan → Kelola deployment pada proyek pencatat keuangan.
4. `SYNC_TOKEN` dan `GEMINI_API_KEY` yang sudah ada di Setelan proyek → Script Properties.
   Salin hanya ke pengaturan lokal saat ditanya. Jangan kirim ke chat atau GitHub.

Jika SYNC_TOKEN belum ada, buka menu Kelola Data website dan gunakan koneksi yang
sudah tersedia; alternatifnya jalankan fungsi `getOrCreateSyncToken` di proyek
Apps Script lama agar nilainya dibuat. Tidak perlu mengganti kode Apps Script,
mengubah header spreadsheet, atau menyalin skrip WA yang struktur kolomnya berbeda.

## Pemasangan

Buka Terminal di MacBook dan jalankan:

```bash
git clone --branch feat/waha-receipts https://github.com/faiqfaqih19/finance-tracker.git Finance-WhatsApp
cd Finance-WhatsApp/whatsapp
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD:/setup" -w /setup node:22-alpine node setup.mjs
docker compose up -d
```

Wizard menanyakan nomor **pengirim pribadi** (628…, tanpa +), URL /exec, token,
API key dan model AI. Input token/key disembunyikan. API key WAHA, password dashboard,
dan secret webhook dibuat acak. Semuanya disimpan di `.env` lokal, diabaikan Git.
Jika model default tidak tersedia untuk API key Anda, isi model multimodal yang
tersedia dari Google AI Studio. Tidak ada aktivasi paket AI berbayar oleh wizard.

Buka **http://localhost:3000/dashboard**. Pengguna: `admin`; password tersimpan pada
baris `WAHA_DASHBOARD_PASSWORD` dalam file `.env`. Gunakan editor lokal untuk melihatnya.
Dashboard mungkin meminta koneksi server: URL `http://localhost:3000`, API key
adalah `WAHA_API_KEY` dari `.env`. Jangan bagikan tampilan yang memperlihatkan kunci.

Buat sesi bernama **default**, mulai sesi, lalu pindai QR menggunakan akun nomor bot.
Jika sesi default sudah ada, gunakan yang sama. Setelah status **WORKING**, jalankan:

```bash
docker compose exec bot node check.mjs
```

Pemeriksaan membaca spreadsheet tanpa menulis data uji. Lalu kirim satu foto JPEG,
PNG, atau WebP (maksimal 8 MiB) dari nomor pribadi yang diizinkan ke nomor bot.
Pastikan satu kartu konfirmasi diterima dan satu transaksi muncul di website.
HEIC/PDF/audio belum didukung; kirim nota sebagai foto WhatsApp biasa.

## Operasi sehari-hari

- Docker Desktop, kedua container, internet dan MacBook harus tetap berjalan.
  Saat MacBook tidur/mati, bot tidak memproses pesan. Pesan yang akhirnya sampai
  setelah tersambung akan diproses, tetapi jangan menganggap semua pesan selama
  putus selalu dapat dipulihkan. Uji dengan memutus/menyambungkan pada akun Anda.
- Hanya nomor pengirim yang diizinkan, chat pribadi, dan sesi `default` yang diproses.
  Pesan sendiri, grup, status pesan dan callback lain diabaikan agar tidak berputar.
- Website otomatis membaca sumber data yang sama melalui sinkronisasi yang sudah ada.
- Koreksi/pembatalan dilakukan melalui website. Perintah saldo/laporan dan tombol
  koreksi Telegram belum dipindahkan ke WhatsApp pada versi ini.
- Untuk melihat status: `docker compose ps`; untuk log: `docker compose logs --tail=30 bot`.
  Log bot hanya mencetak ID pekerjaan pendek dan status, bukan token atau isi nota.
- Berhenti: `docker compose stop`. Mulai lagi: `docker compose up -d`.
  Jangan menjalankan `docker compose down -v`: opsi itu menghapus volume sesi/antrean.
- Jika mengedit `.env`, jalankan `docker compose up -d --force-recreate`.

Dashboard hanya dipublikasikan ke `127.0.0.1`, webhook ada di jaringan Docker.
Tidak perlu tunnel publik, domain baru, atau port forwarding router.

## Pesan berulang dan kegagalan

Antrean disimpan ke volume disk sebelum webhook diberi OK; ID pesan WA yang sama
diabaikan termasuk setelah restart. Satu worker memproses secara berurutan agar
penyimpanan tidak bertabrakan. Transaksi memakai ID `WA-...` yang stabil.

Hasil analisis disimpan sebelum mencoba menulis spreadsheet. Sebelum save/send,
intent dicatat di disk. Bila koneksi save putus, transaksi mungkin sudah masuk:
bot menyatakan hasil belum pasti dan tidak otomatis mengulang save. Periksa website
sebelum mengirim ulang foto sebagai pesan baru. Jika proses mati saat pengiriman
balasan, status menjadi `delivery_uncertain` setelah restart dan balasan tidak diulang.
Ini menjamin paling banyak satu **upaya** balasan per ID, bukan jaminan pasti terkirim.

File antrean memuat informasi keuangan dan disimpan lokal pada volume `state`.
Media dikelola WAHA pada volume `media`. Belum ada penghapusan otomatis; pantau ruang
Docker dan cadangkan volume sebelum membersihkan. Jangan hapus state jika masih
memerlukan pengaman terhadap replay pesan lama.

## Validasi pengembang

```bash
node --test whatsapp/tests/*.test.mjs
```

Uji otomatis memakai layanan palsu, tidak mengirim pesan atau menulis spreadsheet
nyata. Pemasangan Docker/QR/nota nyata di MacBook tetap diperlukan sebelum disebut aktif.

Referensi: [WAHA Events](https://waha.devlike.pro/docs/how-to/events/),
[Receive messages](https://waha.devlike.pro/docs/how-to/receive-messages/),
[Security](https://waha.devlike.pro/docs/how-to/security/),
[ARM quick start](https://waha.devlike.pro/docs/overview/quick-start/),
[Gemini image input](https://ai.google.dev/gemini-api/docs/image-understanding).
