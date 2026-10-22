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

// Model Gemini (gemini-1.5-flash cepat, akurat, dan memiliki kuota gratis yang luas)
const GEMINI_MODEL       = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || "gemini-1.5-flash";

// URL Web App Finance Tracker (Ganti dengan URL hosting web Anda, misal Vercel / GitHub Pages)
const DEFAULT_WEB_APP_URL = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || "https://faiqfaqih19.github.io/finance-tracker/";

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
  const token = getOrCreateSyncToken();
  Logger.log("✅ Sheet 'Transaksi' berhasil disiapkan!");
  Logger.log("🔑 Sync Token Anda: " + token);
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
 * 3. HEALTH CHECK VIA GET REQUEST
 */
function doGet(e) {
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

    // B. JIKA INI PESAN DARI TELEGRAM WEBHOOK
    if (payload.message) {
      handleTelegramMessage(payload.message);
      return ContentService.createTextOutput("OK");
    }

    return jsonResponse({ ok: true, message: "No actionable payload" });
  } catch (error) {
    Logger.log("doPost Error: " + error.toString());
    return jsonResponse({ ok: false, error: error.toString() });
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
function handleTelegramMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

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
    props.setProperty('AUTHORIZED_CHAT_ID', String(chatId));

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
    if (parts.length > 1 && parts[1].startsWith('http')) {
      const newUrl = parts[1].trim();
      PropertiesService.getScriptProperties().setProperty('WEB_APP_URL', newUrl);
      sendTelegramMessage(chatId, `✅ URL Web App berhasil disetel ke:\n${newUrl}`);
    } else {
      sendTelegramMessage(chatId, `⚠️ Format salah. Contoh penggunaan:\n\`/seturl https://faiqfaqih19.github.io/finance-tracker/\``, true);
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
  sendTelegramMessage(chatId, "⏳ Sedang membaca & menganalisis bukti transaksi...");

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
  const saved = saveToSheet(result);
  const formattedNominal = "Rp " + Number(saved.amount).toLocaleString("id-ID");

  const replyText = 
    `✅ *Transaksi Berhasil Dicatat!*\n\n` +
    `📅 *Tanggal:* ${saved.date}\n` +
    `🏷 *Jenis:* ${saved.type}\n` +
    `🏪 *Merchant/Pihak:* ${saved.merchant || "-"}\n` +
    `📂 *Kategori:* ${saved.category || "-"}\n` +
    `💳 *Metode:* ${saved.payment || "-"}\n` +
    `💰 *Nominal:* *${formattedNominal}*\n` +
    `📝 *Catatan:* ${saved.note || "-"}\n\n` +
    `_Data telah otomatis tersinkron dengan Web App & Google Sheets._`;

  sendTelegramMessage(chatId, replyText, true);
}

/**
 * Menganalisis struk / gambar mutasi menggunakan Gemini Vision
 */
function analyzeWithGeminiVision(imageBlob, userCaption) {
  const base64Data = Utilities.base64Encode(imageBlob.getBytes());
  const mimeType = imageBlob.getContentType();
  const today = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");

  const prompt = `
  Anda adalah asisten keuangan pribadi profesional di Indonesia yang sangat teliti.
  Tugas Anda: mengekstrak informasi finansial dari gambar bukti transaksi (struk belanja fisik, invoice, struk EDC, QRIS, mutasi m-Banking BCA/Mandiri/BRI/BNI/BSI, GoPay, OVO, ShopeePay, dll).

  Hari ini tanggal: ${today}.
  Keterangan tambahan pengguna: "${userCaption}".

  Ekstrak informasi ke format JSON murni:
  {
    "tanggal": "YYYY-MM-DD (ambil tanggal transaksi dari struk, jika tidak terbaca gunakan ${today})",
    "jenis": "Pengeluaran" atau "Pemasukan",
    "merchant": "Nama toko/merchant/pihak tujuan atau pengirim transfer",
    "kategori": "Pilih satu yang paling cocok dari daftar ini: Makanan & Minuman / Belanja / Transportasi / Kebutuhan Pokok / Tagihan / Kesehatan / Pendidikan / Hiburan / Gaji / Usaha / Lain-lain",
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
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: "application/json"
    }
  };

  const response = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    }
  );

  const responseText = response.getContentText();
  const jsonResponse = JSON.parse(responseText);

  if (jsonResponse.error) {
    throw new Error(jsonResponse.error.message || "Gemini API Error");
  }

  if (!jsonResponse.candidates || !jsonResponse.candidates[0] || !jsonResponse.candidates[0].content) {
    throw new Error("Respon tidak valid dari Gemini.");
  }

  let textOutput = jsonResponse.candidates[0].content.parts[0].text;
  textOutput = textOutput.replace(/```json/gi, '').replace(/```/gi, '').trim();
  return JSON.parse(textOutput);
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
    "kategori": "Pilih satu dari: Makanan & Minuman / Belanja / Transportasi / Kebutuhan Pokok / Tagihan / Kesehatan / Pendidikan / Hiburan / Gaji / Usaha / Lain-lain",
    "nominal": 0 (angka nominal dalam integer rupiah),
    "metode": "Pilih satu: QRIS / BCA / Mandiri / BRI / BNI / BSI / GoPay / OVO / DANA / ShopeePay / Tunai / Lainnya",
    "catatan": "Rincian singkat transaksi"
  }
  `;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { response_mime_type: "application/json" }
  };

  const response = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    }
  );

  const jsonResponse = JSON.parse(response.getContentText());
  if (jsonResponse.error) {
    throw new Error(jsonResponse.error.message || "Gemini API Error");
  }

  let textOutput = jsonResponse.candidates[0].content.parts[0].text;
  textOutput = textOutput.replace(/```json/gi, '').replace(/```/gi, '').trim();
  return JSON.parse(textOutput);
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
  if (!token || token.length < 32) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SYNC_TOKEN', token);
  }
  return token;
}

function isValidToken(clientToken) {
  if (!clientToken || typeof clientToken !== 'string') return false;
  const serverToken = getOrCreateSyncToken();
  return clientToken.trim() === serverToken.trim();
}

function downloadTelegramFile(fileId) {
  const getFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  const response = UrlFetchApp.fetch(getFileUrl);
  const filePath = JSON.parse(response.getContentText()).result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  return UrlFetchApp.fetch(downloadUrl).getBlob();
}

function sendTelegramMessage(chatId, text, isMarkdown = false) {
  const payload = {
    chat_id: chatId,
    text: text
  };
  if (isMarkdown) payload.parse_mode = "Markdown";

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
