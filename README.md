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
