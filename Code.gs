/**
 * =====================================================================
 * AI SMART FINANCE TRACKER (Telegram Bot + Gemini AI + Web App Sync)
 * =====================================================================
 * Otomatis mengekstrak foto struk belanja, QRIS, & screenshot transfer bank.
 * Mendukung sinkronisasi real-time dua arah dengan aplikasi web Finance Tracker.
 */

// KUNCI AKSES & KONFIGURASI
// Anda bisa menyimpannya di Script Properties (File -> Project Properties -> Script Properties)
// atau langsung dibaca dari konstanta di bawah:
const TELEGRAM_BOT_TOKEN = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || "YOUR_TELEGRAM_BOT_TOKEN";
const GEMINI_API_KEY     = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || "YOUR_GEMINI_API_KEY";

// GEMINI_MODEL tetap didukung sebagai pilihan utama. Jika model itu sudah pensiun
// atau sedang sibuk, aplikasi otomatis mencoba model Flash stabil lain yang
// tersedia untuk API key ini.
const GEMINI_MODEL       = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || "gemini-3.8-flash";
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest"
];

// Versi token dipakai untuk merotasi token lama yang pernah tertanam di source.
const SYNC_TOKEN_VERSION = "2";

// URL Web App Finance Tracker di Vercel
const DEFAULT_WEB_APP_URL = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || "https://finance-tracker-ruby-beta.vercel.app/";

/**
 * 1. JALANKAN INI PERTAMA KALI UNTUK MENYIAPKAN STRUKTUR SPREADSHEET
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Transaksi");
  if (!sheet) {
    sheet = ss.insertSheet("Transaksi");
    const defaultSheet = ss.getSheetByName("Sheet1") || ss.getSheetByName("Sheet 1");
    if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
  }

  const standardHeaders = [
    "ID", "Waktu Input", "Tanggal Transaksi", "Jenis", "Merchant / Toko", 
    "Kategori", "Nominal (Rp)", "Metode Pembayaran", "Catatan Detail", "Status"
  ];

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].filter(String);

  if (currentHeaders.length === 0) {
    sheet.getRange(1, 1, 1, standardHeaders.length).setValues([standardHeaders]);
  } else {
    // Tambahkan header baru jika belum ada tanpa merusak kolom yang sudah ada
    standardHeaders.forEach(sh => {
      const exists = currentHeaders.some(ch => String(ch).toLowerCase().trim() === sh.toLowerCase().trim());
      if (!exists) {
        const nextCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, nextCol).setValue(sh);
      }
    });
  }

  // Format header
  const totalCols = sheet.getLastColumn();
  sheet.getRange(1, 1, 1, totalCols)
    .setFontWeight("bold")
    .setBackground("#1e293b")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");

  // Format kolom Nominal menjadi Rupiah
  const colMap = getColumnMap(sheet);
  if (colMap['nominal']) {
    sheet.getRange(2, colMap['nominal'], Math.max(sheet.getLastRow(), 100), 1).setNumberFormat('"Rp"#,##0');
  }

  sheet.setFrozenRows(1);

  // Pastikan token sinkronisasi dibuat
  getOrCreateSyncToken();
  Logger.log("✅ Sheet 'Transaksi' berhasil disiapkan!");
}

/**
 * 2. JALANKAN INI SETELAH MEN-DEPLOY WEB APP UNTUK MENDAFTARKAN BOT TELEGRAM
 */
function setTelegramWebhook(webAppUrl) {
  const url = webAppUrl || "https://script.google.com/macros/s/AKfycbwzt7lnCNjpkL8ureMnhv_6i5EFEvs-8SA4f9E1Wv76tcDRtGTOxfxROGsZUHzJAULyFw/exec";
  const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`;
  const response = UrlFetchApp.fetch(apiUrl);
  Logger.log("Webhook Response: " + response.getContentText());
}

/**
 * 3. HEALTH CHECK & SYNC VIA GET REQUEST
 */
function doGet(e) {
  // Dukungan langsung untuk action=list via GET agar bebas kendala CORS di browser
  const action = e && e.parameter && (e.parameter.action || (e.parameter.api === 'sync' && e.parameter.action));
  if (action === 'config_status') {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, ownerConfigured: Boolean(getAuthorizedChatId()) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'list') {
    return handleSyncApi({ action: 'list', token: e.parameter.token || '' }, e);
  }

  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    service: "Finance Tracker Telegram & Web Sync API",
    model: GEMINI_MODEL,
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 4. ROUTER UTAMA: MENERIMA REQUEST POST DARI TELEGRAM ATAU DARI WEB APP
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (err) {
        payload = {};
      }
    }

    // A. JIKA INI PERMINTAAN SINKRONISASI DARI WEB APP
    const isSyncApi = (e && e.parameter && e.parameter.api === 'sync') ||
                      Boolean(payload.action && (payload.token || (e && e.parameter && e.parameter.token)));

    if (isSyncApi) {
      return handleSyncApi(payload, e);
    }

    // B. JIKA INI TOMBOL INLINE DARI TELEGRAM
    if (payload.callback_query) {
      handleTelegramCallback(payload.callback_query);
      return HtmlService.createHtmlOutput("OK");
    }

    // C. JIKA INI PESAN DARI TELEGRAM WEBHOOK
    if (payload.message) {
      handleTelegramMessage(payload.message, payload.update_id);
      // Gunakan HtmlService agar Telegram menerima HTTP 200 tanpa redirect 302
      return HtmlService.createHtmlOutput("OK");
    }

    return jsonResponse({ ok: true, message: "No actionable payload" });
  } catch (error) {
    Logger.log("doPost Error: " + error.toString());
    // Jika dari Telegram, tetap kembalikan HTML agar webhook tidak stuck
    return HtmlService.createHtmlOutput("OK");
  }
}

/**
 * =====================================================================
 * BAGIAN A: HANDLER SINKRONISASI WEB APP (CRUD TRANSAKSI)
 * =====================================================================
 */
function handleSyncApi(payload, e) {
  const token = payload.token || (e && e.parameter && e.parameter.token) || '';
  if (!isValidToken(token)) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Transaksi");
  if (!sheet) {
    setup();
    sheet = ss.getSheetByName("Transaksi");
  }

  const action = payload.action;

  // 1. Mengambil semua transaksi aktif untuk ditampilkan di web app
  if (action === 'list') {
    const transactions = listTransactions(sheet);
    return jsonResponse({ ok: true, transactions: transactions });
  }

  // 2. Tambah atau update transaksi dari web app
  if (action === 'upsert') {
    const saved = upsertTransaction(sheet, payload.transaction);
    return jsonResponse({ ok: true, transaction: saved });
  }

  // 3. Batalkan transaksi dari web app
  if (action === 'cancel') {
    cancelTransaction(sheet, payload.id);
    return jsonResponse({ ok: true, id: payload.id });
  }

  return jsonResponse({ ok: false, error: 'Aksi tidak dikenal: ' + action });
}

function listTransactions(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const lastCol = sheet.getLastColumn();
  const colMap = getColumnMap(sheet);
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const list = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowIndex = i + 2;

    const idVal = colMap['id'] ? String(row[colMap['id'] - 1] || '') : '';
    const id = idVal || `sheet-row-${rowIndex}`;

    const statusVal = colMap['status'] ? String(row[colMap['status'] - 1] || '').trim().toLowerCase() : 'active';
    if (statusVal === 'cancelled' || statusVal === 'dibatalkan') continue;

    const waktuVal = colMap['waktu'] ? row[colMap['waktu'] - 1] : '';
    let createdAt = Date.now();
    if (waktuVal instanceof Date) {
      createdAt = waktuVal.getTime();
    } else if (waktuVal) {
      const parsed = Date.parse(waktuVal);
      if (!isNaN(parsed)) createdAt = parsed;
    }

    const tglVal = colMap['tanggal'] ? row[colMap['tanggal'] - 1] : '';
    let dateStr = '';
    if (tglVal instanceof Date) {
      dateStr = Utilities.formatDate(tglVal, "Asia/Jakarta", "yyyy-MM-dd");
    } else if (tglVal) {
      dateStr = String(tglVal).slice(0, 10);
    } else {
      dateStr = Utilities.formatDate(new Date(createdAt), "Asia/Jakarta", "yyyy-MM-dd");
    }

    const rawNominal = colMap['nominal'] ? row[colMap['nominal'] - 1] : 0;
    const amount = Number(String(rawNominal).replace(/[^0-9.-]+/g, '')) || 0;

    list.push({
      id: id,
      type: colMap['jenis'] ? String(row[colMap['jenis'] - 1] || 'Pengeluaran').trim() : 'Pengeluaran',
      merchant: colMap['merchant'] ? String(row[colMap['merchant'] - 1] || '').trim() : '',
      category: colMap['kategori'] ? String(row[colMap['kategori'] - 1] || 'Lain-lain').trim() : 'Lain-lain',
      amount: amount,
      date: dateStr,
      payment: colMap['metode'] ? String(row[colMap['metode'] - 1] || 'QRIS').trim() : 'QRIS',
      note: colMap['catatan'] ? String(row[colMap['catatan'] - 1] || '').trim() : '',
      status: 'active',
      source: 'telegram',
      createdAt: createdAt
    });
  }

  // Urutkan dari transaksi terbaru
  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  return list;
}

function upsertTransaction(sheet, tx) {
  if (!tx || !tx.id) throw new Error("Data transaksi tidak lengkap.");

  const colMap = getColumnMap(sheet);
  const lastRow = sheet.getLastRow();
  let foundRow = -1;

  if (lastRow >= 2 && colMap['id']) {
    const ids = sheet.getRange(2, colMap['id'], lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(tx.id).trim()) {
        foundRow = i + 2;
        break;
      }
    }
  }

  const nowStr = Utilities.formatDate(new Date(tx.createdAt || Date.now()), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss");
  const dateStr = tx.date || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
  const nominalNum = Number(tx.amount) || 0;
  const statusStr = tx.status || 'active';

  if (foundRow > 0) {
    if (colMap['tanggal']) sheet.getRange(foundRow, colMap['tanggal']).setValue(dateStr);
    if (colMap['jenis']) sheet.getRange(foundRow, colMap['jenis']).setValue(tx.type || 'Pengeluaran');
    if (colMap['merchant']) sheet.getRange(foundRow, colMap['merchant']).setValue(tx.merchant || '');
    if (colMap['kategori']) sheet.getRange(foundRow, colMap['kategori']).setValue(tx.category || 'Lain-lain');
    if (colMap['nominal']) sheet.getRange(foundRow, colMap['nominal']).setValue(nominalNum);
    if (colMap['metode']) sheet.getRange(foundRow, colMap['metode']).setValue(tx.payment || 'QRIS');
    if (colMap['catatan']) sheet.getRange(foundRow, colMap['catatan']).setValue(tx.note || '');
    if (colMap['status']) sheet.getRange(foundRow, colMap['status']).setValue(statusStr);
  } else {
    const maxCols = Math.max(sheet.getLastColumn(), 10);
    const newRow = new Array(maxCols).fill("");
    if (colMap['id']) newRow[colMap['id'] - 1] = tx.id;
    if (colMap['waktu']) newRow[colMap['waktu'] - 1] = nowStr;
    if (colMap['tanggal']) newRow[colMap['tanggal'] - 1] = dateStr;
    if (colMap['jenis']) newRow[colMap['jenis'] - 1] = tx.type || 'Pengeluaran';
    if (colMap['merchant']) newRow[colMap['merchant'] - 1] = tx.merchant || '';
    if (colMap['kategori']) newRow[colMap['kategori'] - 1] = tx.category || 'Lain-lain';
    if (colMap['nominal']) newRow[colMap['nominal'] - 1] = nominalNum;
    if (colMap['metode']) newRow[colMap['metode'] - 1] = tx.payment || 'QRIS';
    if (colMap['catatan']) newRow[colMap['catatan'] - 1] = tx.note || '';
    if (colMap['status']) newRow[colMap['status'] - 1] = statusStr;

    sheet.appendRow(newRow);
  }

  return {
    id: tx.id,
    type: tx.type || 'Pengeluaran',
    merchant: tx.merchant || '',
    category: tx.category || 'Lain-lain',
    amount: nominalNum,
    date: dateStr,
    payment: tx.payment || 'QRIS',
    note: tx.note || '',
    status: statusStr,
    createdAt: tx.createdAt || Date.now()
  };
}

function cancelTransaction(sheet, id) {
  if (!id) return;
  const colMap = getColumnMap(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !colMap['id']) return;

  const ids = sheet.getRange(2, colMap['id'], lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      const targetRow = i + 2;
      if (colMap['status']) {
        sheet.getRange(targetRow, colMap['status']).setValue('cancelled');
      } else {
        sheet.deleteRow(targetRow);
      }
      return;
    }
  }
}

/**
 * =====================================================================
 * BAGIAN B: HANDLER PESAN TELEGRAM & GEMINI AI
 * =====================================================================
 */
function handleTelegramMessage(message, updateId) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  // GERBANG OTORISASI: hanya pemilik bot yang boleh memakai bot ini.
  const ownerId = getAuthorizedChatId();
  if (!ownerId) {
    // Penetapan pemilik harus dilakukan dari Script Properties, bukan oleh pengirim Telegram pertama.
    Logger.log("Bot belum memiliki AUTHORIZED_CHAT_ID; pesan ditolak dari chat: " + chatId);
    sendTelegramMessage(chatId, "Bot belum diaktifkan. Tetapkan AUTHORIZED_CHAT_ID di Script Properties terlebih dahulu.");
    return;
  }
  if (message.chat.type !== 'private' || !isAuthorizedChat(chatId)) {
    Logger.log("Pesan ditolak dari chat tidak terotorisasi: " + chatId);
    sendTelegramMessage(chatId, "⛔ Bot ini bersifat pribadi dan hanya dapat dipakai oleh pemiliknya.");
    return;
  }

  if (text && handlePendingCorrection(chatId, text)) return;

  // 1. COMMAND: /start
  if (text === '/start') {
    const welcome = 
      `👋 *Halo! Selamat Datang di AI Finance Tracker.*\n\n` +
      `Saya asisten pintar keuangan Anda yang otomatis mencatat struk belanja, QRIS, & mutasi transfer ke Google Sheets dan Web App.\n\n` +
      `📌 *Cara Penggunaan:*\n` +
      `1️⃣ Kirim *foto struk belanja, nota, atau screenshot m-Banking/QRIS*.\n` +
      `2️⃣ Atau ketik langsung pengeluaran Anda, misal: \`Beli kopi 25000 pakai QRIS\`\n\n` +
      `🔗 *Koneksi ke Web App:*\n` +
      `Ketik /hubungkan untuk membuka aplikasi web Finance Tracker Anda di browser HP/Laptop.\n\n` +
      `📊 *Perintah Tersedia:*\n` +
      `• /saldo - Ringkasan pengeluaran & pemasukan bulan ini\n` +
      `• /hubungkan - Dapatkan tautan koneksi ke Web App\n` +
      `• /bantuan - Panduan lengkap`;
    sendTelegramMessage(chatId, welcome, true);
    return;
  }

  // 2. COMMAND: /hubungkan atau /connect
  if (text.startsWith('/hubungkan') || text.startsWith('/connect')) {
    const token = getOrCreateSyncToken();
    const props = PropertiesService.getScriptProperties();

    const webAppBase = props.getProperty('WEB_APP_URL') || DEFAULT_WEB_APP_URL;
    const connectUrl = webAppBase.replace(/\/$/, '') + '/#connect=' + encodeURIComponent(token);

    const reply = 
      `🔗 *Tautan Koneksi Web App Finance Tracker*\n\n` +
      `Klik tautan di bawah ini pada browser HP / Laptop Anda untuk langsung menyambungkan aplikasi:\n\n` +
      `👉 [Buka & Hubungkan Web App](${connectUrl})\n\n` +
      `Atau masukkan token koneksi ini secara manual di Web App:\n` +
      `\`${token}\`\n\n` +
      `_Penting: Tautan ini bersifat privat untuk akun keuangan Anda._`;

    sendTelegramMessage(chatId, reply, true);
    return;
  }

  // 3. COMMAND: /seturl <url>
  if (text.startsWith('/seturl')) {
    const parts = text.split(/\s+/);
    if (parts.length > 1 && /^https:\/\/[^\s]+$/i.test(parts[1])) {
      const newUrl = parts[1].trim();
      PropertiesService.getScriptProperties().setProperty('WEB_APP_URL', newUrl);
      sendTelegramMessage(chatId, `✅ URL Web App berhasil disetel ke:\n${newUrl}`);
    } else {
      sendTelegramMessage(chatId, `⚠️ Format salah (wajib https). Contoh penggunaan:\n\`/seturl https://faiqfaqih19.github.io/finance-tracker/\``, true);
    }
    return;
  }

  // 4. COMMAND: /saldo atau /rekap
  if (text === '/saldo' || text === '/rekap') {
    sendSummaryReport(chatId);
    return;
  }

  // 5. COMMAND: /bantuan atau /help
  if (text === '/bantuan' || text === '/help') {
    const help = 
      `💡 *Panduan Bot AI Finance Tracker:*\n\n` +
      `📸 *Kirim Foto Struk/Nota*: Cukup foto struk belanja, AI akan otomatis membaca nominal, toko, dan barang yang dibeli.\n` +
      `💬 *Ketik Teks*: Kirim pesan singkat seperti: \`Makan siang ayam geprek 22000 bayar QRIS\`\n` +
      `📊 */saldo*: Cek pengeluaran, pemasukan, dan saldo bulan ini.\n` +
      `🔗 */hubungkan*: Dapatkan link untuk sinkronisasi ke Web App.\n` +
      `🌐 */seturl [URL]*: Atur alamat hosting Web App Anda.`;
    sendTelegramMessage(chatId, help, true);
    return;
  }

  // 6. PROSES GAMBAR ATAU TEKS TRANSAKSI

  try {
    let result = null;

    // JIKA PENGGUNA MENGIRIM FOTO
    if (message.photo && message.photo.length > 0) {
      const highestResPhoto = message.photo[message.photo.length - 1];
      const imageBlob = downloadTelegramFile(highestResPhoto.file_id);
      result = analyzeWithGeminiVision(imageBlob, message.caption || "");
    }
    // JIKA PENGGUNA MENGIRIM GAMBAR SEBAGAI DOKUMEN
    else if (message.document && message.document.mime_type && message.document.mime_type.startsWith("image/")) {
      const imageBlob = downloadTelegramFile(message.document.file_id);
      result = analyzeWithGeminiVision(imageBlob, message.caption || "");
    }
    // JIKA PENGGUNA MENGETIK TEKS
    else if (text) {
      result = analyzeWithGeminiText(text);
    } else {
      sendTelegramMessage(chatId, "⚠️ Mohon kirimkan foto struk/nota, bukti transfer, atau ketik rincian belanja Anda.");
      return;
    }

    if (!result || !result.nominal) {
      sendTelegramMessage(chatId, "❌ Maaf, AI belum berhasil mendeteksi nominal transaksi dari bukti tersebut. Silakan kirim foto struk yang lebih terang dan tegak lurus.");
      return;
    }

    // Simpan transaksi
    result.id = updateId ? `TRX-${updateId}` : `TRX-${Date.now()}`;
    const saved = saveToSheet(result);
    sendTransactionCard(chatId, saved);
  } catch (err) {
    Logger.log("Error processing transaction: " + err.toString());
    sendTelegramMessage(chatId, "⚠️ Terjadi kendala saat membaca bukti: " + err.message);
  }
}

/**
 * Menganalisis struk / gambar mutasi menggunakan Gemini Vision
 */
function analyzeWithGeminiVision(imageBlob, userCaption) {
  const base64Data = Utilities.base64Encode(imageBlob.getBytes());
  const detectedMimeType = String(imageBlob.getContentType() || "");
  const mimeType = detectedMimeType.indexOf("image/") === 0 ? detectedMimeType : "image/jpeg";
  const today = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");

  const prompt = `
  Anda adalah asisten keuangan pribadi profesional di Indonesia yang sangat teliti.
  Tugas Anda: mengekstrak informasi finansial dari gambar bukti transaksi (struk belanja fisik, invoice, struk EDC, QRIS, mutasi m-Banking BCA/Mandiri/BRI/BNI/BSI, GoPay, OVO, ShopeePay, dll).
  Nominal wajib diambil dari label Nominal Transaksi/Total/Jumlah Bayar. Contoh Rp 256.020 harus menjadi integer 256020. Abaikan saldo dan nomor referensi.

  Hari ini tanggal: ${today}.
  Keterangan tambahan pengguna: "${userCaption}".

  Ekstrak informasi ke format JSON murni:
  {
    "tanggal": "YYYY-MM-DD (ambil tanggal transaksi dari struk, jika tidak terbaca gunakan ${today})",
    "jenis": "Pengeluaran" atau "Pemasukan",
    "merchant": "Nama toko/merchant/pihak tujuan atau pengirim transfer",
    "kategori": "Pilih satu yang paling cocok dari daftar ini: Makanan & Minuman / Belanja / Transportasi / Kebutuhan Pokok / Tagihan / Kesehatan / Pendidikan / Hiburan / Donasi / Gaji / Usaha / Lain-lain",
    "nominal": 0 (angka bulat nominal total tanpa titik/koma/Rp),
    "metode": "Pilih satu: QRIS / BCA / Mandiri / BRI / BNI / BSI / GoPay / OVO / DANA / ShopeePay / Tunai / Lainnya",
    "catatan": "Rangkuman barang yang dibeli atau tujuan transfer (singkat)"
  }
  `;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mimeType, data: base64Data } }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: getTransactionResponseSchema(),
      temperature: 0.1
    }
  };

  const result = generateGeminiJson(requestBody);
  result.nominal = normalizeNominalValue(result.nominal);
  if (!result.nominal) {
    result.nominal = extractNominalFromImage(base64Data, mimeType);
  }
  return result;
}

/**
 * Menganalisis pesan teks transaksi pengguna
 */
function analyzeWithGeminiText(text) {
  const today = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
  const prompt = `
  Analisis teks pengeluaran/pemasukan berikut: "${text}".
  Hari ini adalah tanggal: ${today}.

  Ekstrak informasi ke format JSON murni:
  {
    "tanggal": "${today}",
    "jenis": "Pengeluaran" atau "Pemasukan",
    "merchant": "Nama tempat/toko atau pihak terkait",
    "kategori": "Pilih satu dari: Makanan & Minuman / Belanja / Transportasi / Kebutuhan Pokok / Tagihan / Kesehatan / Pendidikan / Hiburan / Donasi / Gaji / Usaha / Lain-lain",
    "nominal": 0 (angka nominal dalam integer rupiah),
    "metode": "Pilih satu: QRIS / BCA / Mandiri / BRI / BNI / BSI / GoPay / OVO / DANA / ShopeePay / Tunai / Lainnya",
    "catatan": "Rincian singkat transaksi"
  }
  `;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: getTransactionResponseSchema(),
      temperature: 0.1
    }
  };

  const result = generateGeminiJson(requestBody);
  result.nominal = normalizeNominalValue(result.nominal);
  return result;
}

function getTransactionResponseSchema() {
  return {
    type: "OBJECT",
    properties: {
      tanggal: { type: "STRING" },
      jenis: { type: "STRING", enum: ["Pengeluaran", "Pemasukan"] },
      merchant: { type: "STRING" },
      kategori: { type: "STRING" },
      nominal: { type: "INTEGER" },
      metode: { type: "STRING" },
      catatan: { type: "STRING" }
    },
    required: ["tanggal", "jenis", "merchant", "kategori", "nominal", "metode", "catatan"]
  };
}

function extractNominalFromImage(base64Data, mimeType) {
  const focusedRequest = {
    contents: [{
      parts: [
        {
          text: "Baca hanya nominal transaksi yang benar-benar dibayar/diterima pada bukti ini. " +
            "Prioritaskan label Nominal Transaksi, Total, Jumlah Bayar, atau Amount. " +
            "Abaikan saldo rekening, nomor referensi, nomor transaksi, RRN, dan biaya admin. " +
            "Kembalikan nominal sebagai bilangan bulat Rupiah tanpa titik, koma, atau simbol."
        },
        { inlineData: { mimeType: mimeType, data: base64Data } }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { nominal: { type: "INTEGER" } },
        required: ["nominal"]
      },
      temperature: 0
    }
  };
  const result = generateGeminiJson(focusedRequest);
  return normalizeNominalValue(result.nominal);
}

function normalizeNominalValue(value) {
  if (typeof value === "number") return value > 0 ? Math.round(value) : 0;
  const digits = String(value || "").replace(/[^0-9]/g, "");
  const amount = Number(digits);
  return isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

/**
 * Memanggil Gemini dengan fallback model dan retry terbatas.
 * - 404: model sudah tidak tersedia, langsung coba model berikutnya.
 * - 429/5xx: tunggu singkat lalu coba sekali lagi, kemudian pindah model.
 * API key dikirim lewat header supaya tidak ikut tertulis di URL/log.
 */
function generateGeminiJson(requestBody) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY") {
    throw new Error("Kunci Gemini belum dikonfigurasi di Script Properties.");
  }

  const models = getGeminiModelCandidates();
  let lastStatus = 0;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = UrlFetchApp.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "post",
          contentType: "application/json",
          headers: { "x-goog-api-key": GEMINI_API_KEY },
          payload: JSON.stringify(requestBody),
          muteHttpExceptions: true
        }
      );

      const status = response.getResponseCode();
      lastStatus = status;

      if (status >= 200 && status < 300) {
        const parsed = parseGeminiJsonResponse(response.getContentText());
        CacheService.getScriptCache().put("GEMINI_WORKING_MODEL", model, 21600);
        return parsed;
      }

      // Model tidak ada/tidak mendukung generateContent: jangan menunggu.
      if (status === 404 || status === 400) break;

      const temporary = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (temporary && attempt === 0) {
        Utilities.sleep(700 + (modelIndex * 150));
        continue;
      }

      if (temporary) break;
      throw new Error("Gemini menolak permintaan (HTTP " + status + "). Periksa konfigurasi API di Script Properties.");
    }
  }

  if (lastStatus === 429) {
    throw new Error("Kuota AI sedang dibatasi. Coba kirim lagi beberapa saat lagi.");
  }
  if (lastStatus >= 500) {
    throw new Error("Layanan AI sedang sibuk. Semua model cadangan sudah dicoba; silakan kirim lagi sebentar lagi.");
  }
  throw new Error("Tidak ada model Gemini yang tersedia untuk membaca transaksi ini.");
}

function parseGeminiJsonResponse(responseText) {
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (err) {
    throw new Error("Gemini mengirim respons yang tidak dapat dibaca.");
  }

  const parts = payload && payload.candidates && payload.candidates[0] &&
    payload.candidates[0].content && payload.candidates[0].content.parts;
  const textParts = (parts || []).filter(function(part) {
    return part && typeof part.text === "string";
  }).map(function(part) { return part.text; });
  if (!textParts.length) {
    throw new Error("Gemini tidak mengembalikan data transaksi.");
  }

  const cleanText = textParts.join("").replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleanText);
  } catch (err) {
    throw new Error("Format hasil Gemini tidak valid. Silakan kirim ulang bukti transaksi.");
  }
}

function getGeminiModelCandidates() {
  const preferred = [];
  const cached = CacheService.getScriptCache().get("GEMINI_WORKING_MODEL");
  if (cached) preferred.push(cached);
  if (GEMINI_MODEL) preferred.push(GEMINI_MODEL);

  const configuredFallbacks = PropertiesService.getScriptProperties().getProperty("GEMINI_FALLBACK_MODELS");
  if (configuredFallbacks) {
    configuredFallbacks.split(",").forEach(function(model) {
      if (model.trim()) preferred.push(model.trim());
    });
  }
  GEMINI_FALLBACK_MODELS.forEach(function(model) { preferred.push(model); });

  const available = listAvailableGeminiModels();
  const unique = preferred.filter(function(model, index, array) {
    return model && array.indexOf(model) === index;
  });

  if (!available.length) return unique.slice(0, 6);
  const supported = unique.filter(function(model) { return available.indexOf(model) !== -1; });
  return (supported.length ? supported : unique).slice(0, 6);
}

function listAvailableGeminiModels() {
  const cache = CacheService.getScriptCache();
  const cacheKey = "GEMINI_GENERATE_CONTENT_MODELS";
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (err) {}
  }

  try {
    const response = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      method: "get",
      headers: { "x-goog-api-key": GEMINI_API_KEY },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) return [];

    const payload = JSON.parse(response.getContentText());
    const models = (payload.models || []).filter(function(model) {
      return (model.supportedGenerationMethods || []).indexOf("generateContent") !== -1;
    }).map(function(model) {
      return String(model.name || "").replace(/^models\//, "");
    }).filter(Boolean);

    cache.put(cacheKey, JSON.stringify(models), 21600);
    return models;
  } catch (err) {
    return [];
  }
}

/**
 * Menyimpan data hasil analisis ke spreadsheet
 */
function saveToSheet(item) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Transaksi");
  if (!sheet) {
    setup();
    sheet = ss.getSheetByName("Transaksi");
  }

  const txId = item.id || `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    id: txId,
    type: item.jenis || 'Pengeluaran',
    merchant: item.merchant || '',
    category: item.kategori || 'Lain-lain',
    amount: Number(item.nominal) || 0,
    date: item.tanggal || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd"),
    payment: item.metode || 'QRIS',
    note: item.catatan || '',
    status: 'active',
    createdAt: Date.now()
  };

  upsertTransaction(sheet, record);
  return record;
}

function sendTransactionCard(chatId, transaction, title) {
  const merchant = String(transaction.merchant || "-").toUpperCase();
  const category = transaction.category || "Lain-lain";
  const note = transaction.note || "-";
  const message =
    (title || "✅ Transaksi tersimpan") + "\n" +
    formatRupiah(transaction.amount) + " · " + transaction.type + "\n" +
    merchant + " · " + category + "\n" +
    formatTelegramDate(transaction.date) + " · " + (transaction.payment || "-") + "\n" +
    note + "\n\n" +
    transaction.id;

  sendTelegramMessage(chatId, message, false, {
    inline_keyboard: [[
      { text: "✏️ Koreksi", callback_data: "edit:" + transaction.id },
      { text: "Batalkan transaksi", callback_data: "cancel:" + transaction.id }
    ]]
  });
}

function handleTelegramCallback(query) {
  const chatId = query && query.message && query.message.chat && query.message.chat.id;
  const data = String((query && query.data) || "");
  if (!chatId || !data) return;

  answerTelegramCallback(query.id);
  if (!isAuthorizedChat(chatId)) {
    Logger.log("Callback ditolak dari chat tidak terotorisasi: " + chatId);
    return;
  }

  if (data.indexOf("edit:") === 0) {
    const transactionId = data.slice(5);
    if (!getTransactionById(transactionId)) {
      sendTelegramMessage(chatId, "Transaksi tidak ditemukan atau sudah dibatalkan.");
      return;
    }
    sendTelegramMessage(chatId, "Bagian mana yang ingin dikoreksi?", false, {
      inline_keyboard: [
        [
          { text: "Nominal", callback_data: "editfield:" + transactionId + ":amount" },
          { text: "Tanggal", callback_data: "editfield:" + transactionId + ":date" }
        ],
        [
          { text: "Merchant", callback_data: "editfield:" + transactionId + ":merchant" },
          { text: "Kategori", callback_data: "editfield:" + transactionId + ":category" }
        ],
        [
          { text: "Pembayaran", callback_data: "editfield:" + transactionId + ":payment" },
          { text: "Catatan", callback_data: "editfield:" + transactionId + ":note" }
        ]
      ]
    });
    return;
  }

  if (data.indexOf("editfield:") === 0) {
    const parts = data.split(":");
    const transactionId = parts[1];
    const field = parts[2];
    const labels = {
      amount: "nominal baru, misalnya 50000",
      date: "tanggal baru, misalnya 22/10/2026",
      merchant: "nama merchant yang benar",
      category: "kategori yang benar",
      payment: "metode pembayaran yang benar",
      note: "catatan yang benar"
    };
    if (!labels[field] || !getTransactionById(transactionId)) {
      sendTelegramMessage(chatId, "Transaksi tidak ditemukan atau pilihan koreksi tidak valid.");
      return;
    }
    PropertiesService.getScriptProperties().setProperty("EDIT_FLOW_" + chatId, JSON.stringify({
      transactionId: transactionId,
      field: field,
      expiresAt: Date.now() + (15 * 60 * 1000)
    }));
    sendTelegramMessage(chatId, "Kirim " + labels[field] + ".\nKetik /batal untuk membatalkan koreksi.");
    return;
  }

  if (data.indexOf("cancel:") === 0) {
    const transactionId = data.slice(7);
    if (!getTransactionById(transactionId)) {
      sendTelegramMessage(chatId, "Transaksi tidak ditemukan atau sudah dibatalkan.");
      return;
    }
    sendTelegramMessage(chatId, "Batalkan transaksi " + transactionId + "?", false, {
      inline_keyboard: [[
        { text: "Ya, batalkan", callback_data: "cancelconfirm:" + transactionId },
        { text: "Kembali", callback_data: "cancelno:" + transactionId }
      ]]
    });
    return;
  }

  if (data.indexOf("cancelconfirm:") === 0) {
    const transactionId = data.slice(14);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transaksi");
    if (sheet) cancelTransaction(sheet, transactionId);
    sendTelegramMessage(chatId, "🗑️ Transaksi " + transactionId + " telah dibatalkan.");
    return;
  }

  if (data.indexOf("cancelno:") === 0) {
    sendTelegramMessage(chatId, "Transaksi tetap disimpan.");
  }
}

function handlePendingCorrection(chatId, text) {
  const props = PropertiesService.getScriptProperties();
  const key = "EDIT_FLOW_" + chatId;
  const raw = props.getProperty(key);
  if (!raw) return false;

  if (text === "/batal") {
    props.deleteProperty(key);
    sendTelegramMessage(chatId, "Koreksi dibatalkan. Transaksi tidak diubah.");
    return true;
  }
  if (text.charAt(0) === "/") return false;

  let flow;
  try { flow = JSON.parse(raw); } catch (err) { flow = null; }
  if (!flow || Number(flow.expiresAt) < Date.now()) {
    props.deleteProperty(key);
    sendTelegramMessage(chatId, "Sesi koreksi sudah berakhir. Tekan Koreksi pada transaksi lagi.");
    return true;
  }

  try {
    const updated = updateTransactionField(flow.transactionId, flow.field, text);
    props.deleteProperty(key);
    sendTransactionCard(chatId, updated, "✅ Transaksi diperbarui");
  } catch (err) {
    sendTelegramMessage(chatId, "Nilai belum dapat disimpan: " + err.message + "\nSilakan kirim lagi atau ketik /batal.");
  }
  return true;
}

function updateTransactionField(transactionId, field, rawValue) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transaksi");
  if (!sheet) throw new Error("sheet Transaksi tidak ditemukan.");
  const row = findTransactionRow(sheet, transactionId);
  if (row < 2) throw new Error("transaksi tidak ditemukan.");

  const columnMap = getColumnMap(sheet);
  const fieldMap = {
    amount: "nominal",
    date: "tanggal",
    merchant: "merchant",
    category: "kategori",
    payment: "metode",
    note: "catatan"
  };
  const column = columnMap[fieldMap[field]];
  if (!column) throw new Error("kolom transaksi tidak tersedia.");

  let value = String(rawValue || "").trim();
  if (!value) throw new Error("nilai tidak boleh kosong.");
  if (field === "amount") {
    value = Number(value.replace(/[^0-9]/g, ""));
    if (!value || value < 1) throw new Error("nominal harus berupa angka lebih dari nol.");
  } else if (field === "date") {
    value = normalizeTransactionDate(value);
  } else {
    value = neutralizeSheetText(value).slice(0, field === "note" ? 160 : 80);
  }

  sheet.getRange(row, column).setValue(value);
  return getTransactionById(transactionId);
}

function getTransactionById(transactionId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Transaksi");
  if (!sheet) return null;
  const items = listTransactions(sheet);
  for (let i = 0; i < items.length; i++) {
    if (String(items[i].id) === String(transactionId)) return items[i];
  }
  return null;
}

function findTransactionRow(sheet, transactionId) {
  const columnMap = getColumnMap(sheet);
  if (!columnMap.id || sheet.getLastRow() < 2) return -1;
  const ids = sheet.getRange(2, columnMap.id, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(transactionId).trim()) return i + 2;
  }
  return -1;
}

function normalizeTransactionDate(value) {
  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const local = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (local) match = [local[0], local[3], local[2].padStart(2, "0"), local[1].padStart(2, "0")];
  }
  if (!match) throw new Error("gunakan format DD/MM/YYYY atau YYYY-MM-DD.");
  const normalized = match[1] + "-" + match[2] + "-" + match[3];
  const date = new Date(normalized + "T12:00:00+07:00");
  if (isNaN(date.getTime()) || Utilities.formatDate(date, "Asia/Jakarta", "yyyy-MM-dd") !== normalized) {
    throw new Error("tanggal tidak valid.");
  }
  return normalized;
}

function neutralizeSheetText(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function formatRupiah(amount) {
  return "Rp" + Math.round(Number(amount) || 0).toLocaleString("id-ID");
}

function formatTelegramDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[3] + "/" + match[2] + "/" + match[1] : String(value || "-");
}

function answerTelegramCallback(callbackQueryId) {
  if (!callbackQueryId) return;
  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ callback_query_id: callbackQueryId }),
    muteHttpExceptions: true
  });
}

/**
 * Menghitung dan mengirim laporan ringkasan bulanan di Telegram
 */
function sendSummaryReport(chatId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Transaksi");
  if (!sheet) {
    sendTelegramMessage(chatId, "⚠️ Belum ada transaksi yang tercatat.");
    return;
  }

  const items = listTransactions(sheet);
  const now = new Date();
  const currentMonthStr = Utilities.formatDate(now, "Asia/Jakarta", "yyyy-MM");

  let totalIncome = 0;
  let totalExpense = 0;
  let count = 0;

  for (const t of items) {
    if (t.date && t.date.startsWith(currentMonthStr)) {
      count++;
      if (t.type === 'Pemasukan') totalIncome += t.amount;
      else totalExpense += t.amount;
    }
  }

  const net = totalIncome - totalExpense;
  const monthName = Utilities.formatDate(now, "Asia/Jakarta", "MMMM yyyy");

  const report = 
    `📊 *Laporan Keuangan (${monthName})*\n\n` +
    `🟢 *Total Pemasukan:* Rp ${totalIncome.toLocaleString('id-ID')}\n` +
    `🔴 *Total Pengeluaran:* Rp ${totalExpense.toLocaleString('id-ID')}\n` +
    `⚖️ *Saldo Bersih:* Rp ${net.toLocaleString('id-ID')}\n\n` +
    `📋 *Jumlah Transaksi:* ${count} transaksi tercatat bulan ini.\n\n` +
    `_Buka Web App untuk analisis kategori & grafik visual lengkap._`;

  sendTelegramMessage(chatId, report, true);
}

/**
 * =====================================================================
 * BAGIAN C: HELPER & UTILITY FUNCTIONS
 * =====================================================================
 */
function getColumnMap(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach((h, idx) => {
    const key = String(h).toLowerCase().trim();
    if (key === 'id' || key.includes('id transaksi')) map['id'] = idx + 1;
    else if (key.includes('waktu')) map['waktu'] = idx + 1;
    else if (key.includes('tanggal')) map['tanggal'] = idx + 1;
    else if (key.includes('jenis')) map['jenis'] = idx + 1;
    else if (key.includes('merchant') || key.includes('toko')) map['merchant'] = idx + 1;
    else if (key.includes('kategori')) map['kategori'] = idx + 1;
    else if (key.includes('nominal')) map['nominal'] = idx + 1;
    else if (key.includes('metode') || key.includes('pembayaran')) map['metode'] = idx + 1;
    else if (key.includes('catatan')) map['catatan'] = idx + 1;
    else if (key.includes('status')) map['status'] = idx + 1;
  });
  return map;
}

function getOrCreateSyncToken() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('SYNC_TOKEN');
  const tokenVersion = props.getProperty('SYNC_TOKEN_VERSION');
  if (!token || token.length < 32 || tokenVersion !== SYNC_TOKEN_VERSION) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperties({
      SYNC_TOKEN: token,
      SYNC_TOKEN_VERSION: SYNC_TOKEN_VERSION
    });
  }
  return token;
}

/**
 * Chat ID pemilik bot (disimpan di Script Properties, 'AUTHORIZED_CHAT_ID').
 * Terisi otomatis oleh /hubungkan pertama di chat pribadi, atau manual lewat
 * setAuthorizedChatId().
 */
function getAuthorizedChatId() {
  const v = PropertiesService.getScriptProperties().getProperty('AUTHORIZED_CHAT_ID');
  return v ? String(v).trim() : '';
}

function isAuthorizedChat(chatId) {
  const owner = getAuthorizedChatId();
  return Boolean(owner) && String(chatId) === owner;
}

/** Jalankan manual dari editor Apps Script untuk menetapkan pemilik bot. */
function setAuthorizedChatId(chatId) {
  if (!chatId) throw new Error('Isi chatId, misalnya setAuthorizedChatId(123456789).');
  PropertiesService.getScriptProperties().setProperty('AUTHORIZED_CHAT_ID', String(chatId));
  Logger.log('AUTHORIZED_CHAT_ID disetel.');
}

/**
 * Jalankan manual jika perlu memindahkan bot ke akun Telegram lain. Sekaligus
 * merotasi token sinkronisasi agar token lama tidak berlaku.
 */
function resetAuthorizedChat() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('AUTHORIZED_CHAT_ID');
  props.deleteProperty('SYNC_TOKEN');
  Logger.log('Pemilik dihapus & token dirotasi. Kirim /hubungkan dari akun yang benar.');
}

function isValidToken(clientToken) {
  if (!clientToken || typeof clientToken !== 'string') return false;
  const trimmed = clientToken.trim();
  const serverToken = getOrCreateSyncToken();
  return trimmed === serverToken.trim();
}

function downloadTelegramFile(fileId) {
  const getFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  const response = UrlFetchApp.fetch(getFileUrl, { muteHttpExceptions: true });
  const json = JSON.parse(response.getContentText());
  if (!json.ok || !json.result || !json.result.file_path) {
    throw new Error("Gagal mengunduh file dari Telegram: " + (json.description || "file tidak ditemukan"));
  }
  const filePath = json.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  return UrlFetchApp.fetch(downloadUrl, { muteHttpExceptions: true }).getBlob();
}

function sendTelegramMessage(chatId, text, isMarkdown = false, replyMarkup) {
  const payload = {
    chat_id: chatId,
    text: text
  };
  if (isMarkdown) payload.parse_mode = "Markdown";
  if (replyMarkup) payload.reply_markup = replyMarkup;

  UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
