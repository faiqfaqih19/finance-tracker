# Finance Tracker Pribadi

Aplikasi web pelacak keuangan pribadi yang ringan, cepat, dan dapat disinkronkan dengan bot Telegram Finance Tracker.

## Fitur Utama
- **Satu sumber data**: Saat perangkat dihubungkan melalui bot, aplikasi membaca dan menulis tab `Transaksi` yang sama dengan bot Telegram.
- **Koneksi pribadi**: Token perangkat dibuat oleh bot lewat perintah `/hubungkan`, disimpan di browser, dan tidak ditanam di source GitHub.
- **Ringkasan & Analisis**: Menampilkan ringkasan pemasukan, pengeluaran, saldo bersih, dan pembagian kategori pengeluaran.
- **Kelola Transaksi & Draf**: Catat transaksi langsung, tandai draf, dan deteksi transaksi ganda.
- **Impor & Ekspor CSV**: Dukungan penuh ekspor laporan keuangan dan impor catatan transaksi lama.
- **PWA (Progressive Web App)**: Dapat dipasang langsung di Layar Utama iPhone/Android layaknya aplikasi native.

## Sinkronisasi Telegram

1. Kirim `/hubungkan` ke bot Telegram yang telah diizinkan.
2. Buka tautan pribadi dari bot pada perangkat yang akan disambungkan.
3. Aplikasi mengambil transaksi aktif dari spreadsheet. Tambah, ubah, dan pembatalan dari web ditulis kembali ke spreadsheet tersebut.

Endpoint `/api/sync` hanya meneruskan permintaan ke Apps Script. Token koneksi divalidasi oleh Apps Script dan tidak boleh dimasukkan ke repositori atau log.

## Menjalankan secara Lokal
Cukup buka file `index.html` menggunakan browser modern (Safari, Chrome, Firefox) atau jalankan web server lokal sederhana:
```bash
npx serve .
# atau
python3 -m http.server 8000
```

## Respons bot Telegram tanpa duplikasi

`Code.gs` menandai `update_id` secara atomik di Script Properties sebelum memulai
analisis, penulisan transaksi, atau callback. Retry yang tumpang tindih langsung
menerima `OK`. Lock dilepas sebelum AI/jaringan berjalan. Penanda disimpan minimal
48 jam dan dibersihkan harian; penghapusan cache tidak menghilangkan penanda.
Transaksi dengan ID yang sudah ada (termasuk yang dibatalkan) juga dilewati untuk
menangani retry dari deployment lama.

Model AI yang terakhir berhasil diprioritaskan tanpa discovery tambahan. Setiap
analisis dibatasi tiga panggilan model, tanpa sleep/retry model yang sama, dengan
batas lunak 25 detik sebelum memulai panggilan cadangan. Panggilan jaringan yang
sedang berjalan tetap mengikuti timeout Apps Script. Pembacaan nominal cadangan
pada gambar tetap tersedia bila hasil pertama tidak memiliki nominal.

Kebijakan pengiriman adalah **paling banyak satu upaya balasan untuk satu update**.
Jika eksekusi terhenti setelah klaim atau Telegram menerima pesan tetapi koneksi
balik timeout, sistem tidak mengirim ulang secara otomatis. Ini mencegah spam,
namun tidak menjamin satu balasan pasti terkirim saat jaringan/platform gagal.
Periksa transaksi di aplikasi sebelum mengirim bukti yang sama sebagai pesan baru;
pesan baru memiliki ID baru dan memang dianggap input baru. Kesalahan API Telegram
dicatat sebagai kegagalan; kegagalan pengiriman setelah penyimpanan tidak memicu
pesan kedua yang keliru menyatakan pembacaan transaksi gagal.

### Menerapkan perubahan ke bot aktif

Perubahan di GitHub tidak otomatis memperbarui deployment Apps Script.

1. Buka spreadsheet bot, lalu **Ekstensi → Apps Script**.
2. Salin isi `Code.gs` terbaru ke file kode bot yang sesuai, lalu simpan.
3. Pilih **Terapkan → Kelola deployment → Edit → Versi baru → Terapkan** pada
   deployment web app yang saat ini dipakai webhook. URL deployment tetap sama;
   tidak perlu menghapus webhook, menghapus antrean update, atau menjalankan `setup()`.
4. Kirim satu transaksi uji, pastikan hanya satu kartu konfirmasi dan satu baris
   transaksi. Periksa halaman **Eksekusi** untuk kegagalan layanan atau waktu proses.

Jangan mengubah Script Properties berisi token bot, API key, pemilik, atau token
sinkronisasi. Tidak ada kredensial yang perlu ditambahkan ke GitHub.

### Pengujian

```bash
node --test tests/*.test.cjs
```

Pengujian mensimulasikan retry saat AI masih berjalan, replay setelah proses
selesai dan restart, callback berulang, transaksi lama, timeout pengiriman, serta
batas panggilan dan waktu cadangan AI. Waktu respons produksi belum diukur oleh
pengujian lokal ini.
