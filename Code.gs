/**
 * AI SMART FINANCE TRACKER (Telegram + Gemini AI + Google Sheets)
 * Otomatis mengekstrak foto struk belanja, QRIS, & transfer bank.
 */

// GANTI DENGAN KUNCI ANDA (disimpan di Script Properties, bukan di kode):
// PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN')
// PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')
const TELEGRAM_BOT_TOKEN = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || 'YOUR_TELEGRAM_BOT_TOKEN';
const GEMINI_API_KEY     = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || 'YOUR_GEMINI_API_KEY';

// Gunakan model Gemini terbaru yang aktif di akun Anda: gemini-3.8-flash
const GEMINI_MODEL = "gemini-3.8-flash";

/**
 * 1. JALANKAN FUNGSI INI PERTAMA KALI UNTUK MENYIAPKAN SHEET & WEBHOOK
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Transaksi");
  if (!sheet) {
    sheet = ss.insertSheet("Transaksi");
    const defaultSheet = ss.getSheetByName("Sheet1") || ss.getSheetByName("Sheet 1");
    if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
  }

  // Buat Header Tabel yang rapi
  const headers = [
    ["Waktu Input", "Tanggal Transaksi", "Jenis", "Merchant / Toko", "Kategori", "Nominal (Rp)", "Catatan Detail"]
  ];
  sheet.getRange(1, 1, 1, 7).setValues(headers);
  sheet.getRange(1, 1, 1, 7)
    .setFontWeight("bold")
    .setBackground("#1e293b")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");

  // Format kolom Nominal menjadi Rupiah
  sheet.getRange("F2:F").setNumberFormat('"Rp"#,##0');
  sheet.setFrozenRows(1);

  // Auto-set lebar kolom
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 180);
  sheet.setColumnWidth(5, 160);
  sheet.setColumnWidth(6, 140);
  sheet.setColumnWidth(7, 250);

  Logger.log("✅ Sheet 'Transaksi' berhasil disiapkan!");
}

/**
 * 2. JALANKAN INI SETELAH MEN-DEPLOY WEB APP UNTUK MENDAFTARKAN BOT TELEGRAM
 */
function setTelegramWebhook(webAppUrl) {
  const url = webAppUrl || "https://script.google.com/macros/s/AKfycbwzt7lnCNjpkL8ureMnhv_6i5EFEvs-8SA4f9E1Wv76tcDRtGTOxfxROGsZUHzJAULyFw/exec";
  const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${url}`;
  const response = UrlFetchApp.fetch(apiUrl);
  Logger.log(response.getContentText());
}

/**
 * 3. MENERIMA PESAN DARI TELEGRAM (FOTO / TEKS)
 */
function doPost(e) {
  let chatId = null;
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.message) return HtmlService.createHtmlOutput("OK");

    chatId = data.message.chat.id;
    const message = data.message;

    // Beri respon loading awal agar pengguna tahu sistem sedang memproses
    sendTelegramMessage(chatId, "⏳ Sedang membaca & menganalisis bukti transaksi...");

    let result = null;

    // JIKA PENGGUNA MENGIRIMKAN FOTO NOTA / STRUK
    if (message.photo && message.photo.length > 0) {
      const highestResPhoto = message.photo[message.photo.length - 1];
      const imageBlob = downloadTelegramFile(highestResPhoto.file_id);
      result = analyzeWithGeminiVision(imageBlob, message.caption || "");
    } 
    // JIKA PENGGUNA MENGIRIMKAN DOKUMEN GAMBAR
    else if (message.document && message.document.mime_type && message.document.mime_type.startsWith("image/")) {
      const imageBlob = downloadTelegramFile(message.document.file_id);
      result = analyzeWithGeminiVision(imageBlob, message.caption || "");
    } 
    // JIKA PENGGUNA HANYA MENGETIK TEKS (Contoh: "Beli bensin 30000")
    else if (message.text) {
      result = analyzeWithGeminiText(message.text);
    } else {
      sendTelegramMessage(chatId, "⚠️ Mohon kirimkan foto struk/nota, bukti transfer, atau ketik rincian belanja Anda.");
      return HtmlService.createHtmlOutput("OK");
    }

    if (!result || !result.nominal) {
      sendTelegramMessage(chatId, "❌ Maaf, AI tidak dapat mendeteksi nominal transaksi dari foto/teks tersebut. Coba kirim foto yang lebih jelas.");
      return HtmlService.createHtmlOutput("OK");
    }

    // Catat ke Google Sheet
    saveToSheet(result);

    // Format mata uang Rupiah
    const formattedNominal = "Rp " + Number(result.nominal).toLocaleString("id-ID");

    // Kirim konfirmasi berhasil ke Telegram
    const replyText = 
      `✅ *Transaksi Berhasil Dicatat!*\n\n` +
      `📅 *Tanggal:* ${result.tanggal}\n` +
      `🏷 *Jenis:* ${result.jenis}\n` +
      `🏪 *Merchant/Pihak:* ${result.merchant}\n` +
      `📂 *Kategori:* ${result.kategori}\n` +
      `💰 *Nominal:* *${formattedNominal}*\n` +
      `📝 *Catatan:* ${result.catatan || "-"}`;

    sendTelegramMessage(chatId, replyText, true);

  } catch (error) {
    Logger.log("Error: " + error.toString());
    if (chatId) {
      sendTelegramMessage(chatId, "⚠️ Terjadi kendala: " + error.message);
    }
  }

  return HtmlService.createHtmlOutput("OK");
}

/**
 * Mengirim gambar ke Gemini Vision AI untuk diekstrak jadi JSON
 */
function analyzeWithGeminiVision(imageBlob, userCaption) {
  const base64Data = Utilities.base64Encode(imageBlob.getBytes());
  const mimeType = imageBlob.getContentType();
  const today = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");

  const prompt = `
  Anda adalah asisten keuangan pribadi Indonesia yang sangat teliti.
  Tugas Anda adalah membaca gambar bukti transaksi ini (bisa berupa struk belanja, invoice, nota fisik, struk QRIS, screenshot m-Banking BCA/Mandiri/BRI/BNI/BSI, GoPay, OVO, ShopeePay, dll).

  Hari ini adalah tanggal: ${today}.
  Keterangan tambahan dari pengguna: "${userCaption}".

  Ekstrak informasi ke dalam format JSON murni:
  {
    "tanggal": "YYYY-MM-DD",
    "jenis": "Pengeluaran" atau "Pemasukan",
    "merchant": "Nama toko, minimarket, merchant, atau nama penerima/pengirim transfer",
    "kategori": "Makanan & Minuman / Kebutuhan Pokok / Transportasi / Belanja Harian / Tagihan & Utilitas / Kesehatan / Hiburan / Pendidikan / Amal/Sedekah / Lain-lain",
    "nominal": 0,
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
    throw new Error("Respon AI tidak valid dari Gemini.");
  }

  let textOutput = jsonResponse.candidates[0].content.parts[0].text;
  textOutput = textOutput.replace(/```json/gi, '').replace(/```/gi, '').trim();
  return JSON.parse(textOutput);
}

/**
 * Menganalisis pesan teks pengguna (jika tidak mengirim foto)
 */
function analyzeWithGeminiText(text) {
  const today = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
  const prompt = `
  Analisis teks pengeluaran/pemasukan berikut: "${text}".
  Hari ini adalah tanggal: ${today}.

  Ekstrak ke format JSON murni:
  {
    "tanggal": "${today}",
    "jenis": "Pengeluaran" atau "Pemasukan",
    "merchant": "Nama tempat/toko atau keterangan",
    "kategori": "Makanan & Minuman / Transportasi / Kebutuhan Pokok / dll",
    "nominal": 0,
    "catatan": "Rincian singkat"
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
 * Simpan data hasil analisis ke baris baru Google Sheets
 */
function saveToSheet(item) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Transaksi");
  if (!sheet) {
    setup();
    sheet = ss.getSheetByName("Transaksi");
  }

  const now = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([
    now,
    item.tanggal,
    item.jenis,
    item.merchant,
    item.kategori,
    Number(item.nominal),
    item.catatan || ""
  ]);
}

/**
 * Download file gambar langsung dari server Telegram
 */
function downloadTelegramFile(fileId) {
  const getFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  const response = UrlFetchApp.fetch(getFileUrl);
  const filePath = JSON.parse(response.getContentText()).result.file_path;
  
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  return UrlFetchApp.fetch(downloadUrl).getBlob();
}

/**
 * Kirim pesan balasan ke chat Telegram
 */
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
