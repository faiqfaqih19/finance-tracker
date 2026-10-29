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

## Panduan antarmuka Emil Kowalski

Antarmuka menerapkan panduan [emil-design-eng](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md),
[mobile-native](https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md),
dan [animation-performance](https://github.com/emilkowalski/skills/blob/main/skills/animation-performance/SKILL.md).
Ini penerapan pada website, bukan pemasangan skill global atau penambahan framework.

- `interaction-polish.css`: feedback tekan 120ms, dialog 220ms, toast singkat,
  target sentuh minimal 44px, safe area, kontras tema gelap, serta input 16px.
- Hover dibatasi untuk mouse. Zoom browser tetap diizinkan. Keyboard dan preferensi
  reduced motion mendapat perpindahan instan. Navigasi dan grafik tidak diberi
  animasi dekoratif berulang.
- Formulir memakai label yang terhubung, judul dialog yang dapat dibaca screen reader,
  keyboard numerik untuk nominal, dan indikator simpan dengan pengaman ketukan ganda.
- Warna browser mengikuti tema aktif. Tombol tema tersedia pada header.
- Toast mempertahankan waktu bacanya saat tab tidak terlihat. Instance grafik lama
  dan inisialisasi tertunda dilepas saat halaman dirender ulang.

Jalankan `node --check app.js` dan `node --test tests/*.test.cjs` untuk pemeriksaan lokal.
Uji Safari iPhone asli tetap diperlukan untuk keyboard layar, focus zoom, notch,
home indicator, dan rasa sentuhan; pemeriksaan browser desktop tidak membuktikannya.
