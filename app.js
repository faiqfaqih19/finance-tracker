import {
  CATEGORIES,
  money,
  today,
  escape as esc,
  amount as parseAmount,
  date as parseDate,
  valid,
  aggregate,
  csvExport,
  importRows,
  chatDraft,
  parseText
} from './core.mjs';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// Kategori icon mapping
const CAT_ICONS = {
  'Makanan & Minuman': '🍔',
  'Belanja': '🛍️',
  'Transportasi': '🚗',
  'Kebutuhan Pokok': '🛒',
  'Tagihan': '⚡',
  'Kesehatan': '💊',
  'Pendidikan': '📚',
  'Hiburan': '🎬',
  'Gaji': '💰',
  'Usaha': '💼',
  'Transfer': '🔄',
  'Lain-lain': '🏷️'
};

const PAY_METHODS = ['QRIS', 'BCA', 'BRI', 'Mandiri', 'BNI', 'BSI', 'GoPay', 'OVO', 'DANA', 'ShopeePay', 'Tunai', 'Lainnya'];

// State
let db = null;
let transactions = [];
let currentTab = 'ringkasan';
let currentPeriod = 'month';
let selectedCategory = '';
let searchQuery = '';
let editingTx = null;
let syncToken = localStorage.getItem('finance-sync-token') || '';
let syncState = syncToken ? 'connecting' : 'offline';
let lastSyncAt = 0;
let syncTimer = null;

// Helper ID & Toast
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2, 9);

function showToast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('on'), 3500);
}

// IndexedDB Initialization
async function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('finance-tracker-v2', 1);
    req.onupgradeneeded = ev => {
      const d = ev.target.result;
      if (!d.objectStoreNames.contains('transactions')) {
        const store = d.createObjectStore('transactions', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadTransactions() {
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readonly');
    const store = tx.objectStore('transactions');
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result || []).map(t => ({
        status: 'active',
        ...t
      }));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveLocalTransaction(t) {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    store.put(t);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteLocalTransaction(id) {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function replaceLocalTransactions(items) {
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    store.clear();
    items.forEach(item => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function syncConnected() {
  return Boolean(syncToken);
}

async function syncRequest(action, payload = {}) {
  if (!syncToken) throw new Error('Aplikasi belum dihubungkan ke bot Telegram.');
  const response = await fetch('/api/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${syncToken}`
    },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'Sinkronisasi belum berhasil.');
  return data;
}

async function refreshFromBot({ silent = false } = {}) {
  if (!syncConnected()) return false;
  syncState = 'connecting';
  if (!silent) render();
  try {
    const data = await syncRequest('list');
    transactions = (data.transactions || []).map(t => ({ status: 'active', source: 'telegram', ...t }));
    await replaceLocalTransactions(transactions);
    syncState = 'online';
    lastSyncAt = Date.now();
    render();
    if (!silent) {
      showToast('✅ Data terbaru dari bot sudah dimuat.');
    }
    return true;
  } catch (error) {
    syncState = 'error';
    render();
    if (!silent) {
      showToast('⚠️ ' + error.message);
    }
    return false;
  }
}

async function saveTransaction(t) {
  if (!syncConnected()) {
    await saveLocalTransaction(t);
    return t;
  }
  const data = await syncRequest('upsert', { transaction: t });
  await saveLocalTransaction(data.transaction);
  syncState = 'online';
  lastSyncAt = Date.now();
  return data.transaction;
}

async function deleteTransaction(id) {
  if (syncConnected()) {
    await syncRequest('cancel', { id });
    syncState = 'online';
    lastSyncAt = Date.now();
  }
  await deleteLocalTransaction(id);
}

function acceptConnectionFromUrl() {
  const hash = location.hash || '';
  const match = hash.match(/^#connect=([^&]+)/);
  if (!match) return false;
  const token = decodeURIComponent(match[1] || '').trim();
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) return false;
  syncToken = token;
  localStorage.setItem('finance-sync-token', token);
  history.replaceState(null, '', location.pathname + location.search);
  syncState = 'connecting';
  return true;
}

function formatDateIndo(dStr) {
  try {
    const d = new Date(dStr + 'T12:00:00Z');
    return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  } catch {
    return dStr;
  }
}

// -------------------------------------------------------------
// RENDER NAVIGATION
// -------------------------------------------------------------
function renderNav() {
  const nav = $('#nav');
  if (!nav) return;

  nav.innerHTML = `
    <span class="brand">finance<span style="color:var(--g)">tracker.</span></span>
    
    <button class="t ${currentTab === 'ringkasan' ? 'on' : ''}" data-tab="ringkasan">
      <span>📊</span>
      Ringkasan
    </button>
    
    <button class="t ${currentTab === 'transaksi' ? 'on' : ''}" data-tab="transaksi">
      <span>💳</span>
      Transaksi
    </button>
    
    <button class="fab" id="fabAdd" aria-label="Tambah Transaksi">
      <i>+</i>
      <b>+ Catat</b>
    </button>
    
    <button class="t ${currentTab === 'nota' ? 'on' : ''}" data-tab="nota">
      <span>🧾</span>
      Pindai Nota
    </button>
    
    <button class="t ${currentTab === 'data' ? 'on' : ''}" data-tab="data">
      <span>⚙️</span>
      Kelola Data
    </button>
  `;

  nav.querySelectorAll('.t').forEach(b => {
    b.onclick = () => {
      currentTab = b.dataset.tab;
      render();
    };
  });

  const fab = $('#fabAdd');
  if (fab) fab.onclick = () => openTxModal();
}

// -------------------------------------------------------------
// MAIN VIEWS
// -------------------------------------------------------------
function render() {
  renderNav();
  const view = $('#view');
  if (!view) return;

  switch (currentTab) {
    case 'ringkasan':
      view.innerHTML = renderDashboard();
      break;
    case 'transaksi':
      view.innerHTML = renderTransactions();
      break;
    case 'nota':
      view.innerHTML = renderReceiptScanner();
      break;
    case 'data':
      view.innerHTML = renderDataTools();
      break;
    default:
      view.innerHTML = renderDashboard();
  }

  attachViewListeners();
}

// 1. Dashboard View
function renderDashboard() {
  const agg = aggregate(transactions, currentPeriod);
  const recent = [...transactions].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  let categoryBars = '';
  if (agg.categories.length) {
    const totalExp = agg.expense || 1;
    categoryBars = agg.categories.slice(0, 4).map(([cat, amt]) => {
      const pct = Math.min(100, Math.round((amt / totalExp) * 100));
      return `
        <div class="bar">
          <div><span>${esc(cat)}</span><b>${money(amt)} (${pct}%)</b></div>
          <i><b style="width: ${pct}%"></b></i>
        </div>
      `;
    }).join('');
  } else {
    categoryBars = `<p class="muted" style="margin: 8px 0;">Belum ada pengeluaran pada periode ini.</p>`;
  }

  let txList = '';
  if (recent.length) {
    txList = recent.map(t => renderTxItem(t)).join('');
  } else {
    txList = `
      <div class="empty">
        <div style="font-size: 32px;">🌱</div>
        <b>Mulai catat transaksi pertama Anda</b>
        <small>Klik tombol <strong>+ Catat</strong> di bawah atau pindai nota.</small>
      </div>
    `;
  }

  return `
    <div class="hd">
      <div>
        <h1>Ringkasan Keuangan</h1>
        <small class="muted">${syncConnected() ? (syncState === 'online' ? 'Tersinkron dengan bot Telegram' : syncState === 'error' ? 'Koneksi bot perlu diperiksa' : 'Mengambil data dari bot…') : 'Catat uang, tenang hati · Ruang pribadi offline'}</small>
      </div>
      <div>
        <select id="periodFilter" style="width: auto; padding: 6px 12px; margin: 0; font-size: 13px; font-weight: 600;">
          <option value="month" ${currentPeriod === 'month' ? 'selected' : ''}>Bulan ini</option>
          <option value="today" ${currentPeriod === 'today' ? 'selected' : ''}>Hari ini</option>
          <option value="previous" ${currentPeriod === 'previous' ? 'selected' : ''}>Bulan lalu</option>
          <option value="all" ${currentPeriod === 'all' ? 'selected' : ''}>Semua waktu</option>
        </select>
      </div>
    </div>

    <!-- Hero Card -->
    <div class="hero">
      <span>Selisih Tercatat (${agg.period.label})</span>
      <strong>${agg.net < 0 ? '−' : ''}${money(Math.abs(agg.net))}</strong>
      <div class="duo">
        <div>
          <small>Total Pemasukan</small>
          <b>${money(agg.income)}</b>
          <i>↗</i>
        </div>
        <div>
          <small>Total Pengeluaran</small>
          <b>${money(agg.expense)}</b>
          <i>↘</i>
        </div>
      </div>
    </div>

    <!-- Category Breakdown Card -->
    <div class="card">
      <div class="row-h">
        <h2>Kategori Terbesar</h2>
        <a class="lnk" href="#transaksi" id="btnSeeAllCat">Lihat Semua ↗</a>
      </div>
      ${categoryBars}
    </div>

    <!-- Recent Transactions -->
    <div class="card">
      <div class="row-h">
        <h2>Transaksi Terbaru</h2>
        <a class="lnk" href="#transaksi" id="btnSeeAllTx">Buka Catatan ↗</a>
      </div>
      <div>
        ${txList}
      </div>
    </div>
  `;
}

// 2. Transactions List View
function renderTransactions() {
  let list = [...transactions];

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(t => 
      (t.merchant || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q) ||
      (t.note || '').toLowerCase().includes(q) ||
      (t.payment || '').toLowerCase().includes(q)
    );
  }

  if (selectedCategory) {
    list = list.filter(t => t.category === selectedCategory);
  }

  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));

  // Category chips
  const chipsHtml = `
    <div class="chips" style="overflow-x: auto; padding-bottom: 8px; margin-bottom: 12px;">
      <button class="chip ${!selectedCategory ? 'on' : ''}" data-cat="">Semua</button>
      ${CATEGORIES.map(c => `
        <button class="chip ${selectedCategory === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>
      `).join('')}
    </div>
  `;

  let content = '';
  if (!list.length) {
    content = `
      <div class="card">
        <div class="empty">
          <div style="font-size: 32px;">🔍</div>
          <b>Tidak ada transaksi ditemukan</b>
          <small>Coba ganti kata kunci pencarian atau kategori filter.</small>
        </div>
      </div>
    `;
  } else {
    // Group by date
    let lastDate = '';
    let items = '';
    list.forEach(t => {
      if (t.date !== lastDate) {
        lastDate = t.date;
        items += `<div class="day">${formatDateIndo(t.date)}</div>`;
      }
      items += renderTxItem(t);
    });

    content = `
      <div class="card" style="padding-top: 8px;">
        ${items}
      </div>
    `;
  }

  return `
    <div class="hd">
      <div>
        <h1>Daftar Transaksi</h1>
        <small class="muted">${list.length} catatan transaksi tersimpan</small>
      </div>
      <div>
        <button class="btn pri" id="btnNewTx">+ Catat Baru</button>
      </div>
    </div>

    <div style="margin-bottom: 12px;">
      <input type="search" id="txSearch" placeholder="Cari toko, merchant, atau catatan..." value="${esc(searchQuery)}">
    </div>

    ${chipsHtml}
    ${content}
  `;
}

function renderTxItem(t) {
  const isIncome = t.type === 'Pemasukan';
  const icon = CAT_ICONS[t.category] || '🏷️';
  return `
    <button class="tx" data-txid="${esc(t.id)}">
      <span class="ico">${icon}</span>
      <span class="tm">
        <b>${esc(t.merchant || 'Tanpa Nama')}</b>
        <small>${esc(t.category)} · ${esc(t.payment || 'Tunai')}${t.note ? ' · ' + esc(t.note) : ''}</small>
      </span>
      <span class="amt ${isIncome ? 'in' : ''}">${isIncome ? '+' : '−'}${money(t.amount)}</span>
    </button>
  `;
}

// 3. Receipt Scanner & AI Parser View
function renderReceiptScanner() {
  return `
    <div class="hd">
      <div>
        <h1>Pindai & Ekstrak Nota</h1>
        <small class="muted">Salin teks bukti transfer atau upload nota belanja Anda</small>
      </div>
    </div>

    <div class="card">
      <h2>Ekstraksi Cepat dari Teks</h2>
      <p class="muted" style="margin-bottom: 12px;">Ketik pengeluaran santai, format struk m-Banking, atau QRIS:</p>
      <textarea id="quickTextInput" rows="4" placeholder="Contoh teks:&#10;Beli bensin 35000 di pertamina, QRIS&#10;atau paste teks bukti transfer BRI / BCA / Mandiri..."></textarea>
      <button class="btn pri wide" id="btnParseText">⚡ Ekstrak Menjadi Transaksi</button>
    </div>

    <div class="card">
      <h2>Upload Foto Bukti Transaksi</h2>
      <label class="drop" for="receiptFile">
        <span class="big">📸</span>
        <b>Pilih Foto Struk / Screenshot Bukti Transfer</b>
        <small>Pilih gambar nota dari galeri HP atau kamera MacBook Anda.</small>
      </label>
      <input type="file" id="receiptFile" accept="image/*" style="display:none">
    </div>

    <div class="note">
      💡 <b>Tips Integrasi Otomatis:</b> Jika Anda ingin foto nota langsung dibaca otomatis lewat kecerdasan buatan Gemini AI dari iPhone tanpa membuka web, gunakan <b>Bot Telegram Pribadi</b> yang telah disiapkan!
    </div>
  `;
}

// 4. Data Tools (Import/Export/Reset)
function renderDataTools() {
  const syncCard = syncConnected() ? `
    <div class="card" style="border: 1px solid var(--g);">
      <h2>✅ Terhubung dengan Bot Telegram</h2>
      <p class="muted" style="margin-bottom: 14px;">Transaksi dari bot dan aplikasi memakai spreadsheet yang sama.${lastSyncAt ? ' Terakhir diperbarui ' + new Date(lastSyncAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + '.' : ''}</p>
      <button class="btn pri" id="btnSyncNow">🔄 Sinkronkan Sekarang</button>
      <button class="btn ghost" id="btnDisconnectSync">Putuskan perangkat ini</button>
    </div>` : `
    <div class="card" style="border: 1px solid var(--g);">
      <h2>Hubungkan dengan Bot Telegram</h2>
      <p class="muted" style="margin-bottom: 14px;">Kirim <b>/hubungkan</b> ke bot Telegram, lalu buka tautan pribadi yang dikirim bot. Transaksi akan diambil dari spreadsheet yang sama.</p>
      <a class="btn pri" href="https://t.me/fafa_money_bot" target="_blank" rel="noreferrer">Buka Bot Telegram ↗</a>
    </div>`;
  return `
    <div class="hd">
      <div>
        <h1>Kelola & Ekspor Data</h1>
        <small class="muted">Cadangkan atau pindahkan data transaksi Anda kapan saja</small>
      </div>
    </div>

    ${syncCard}

    <div class="card">
      <h2>Cadangkan Data (CSV)</h2>
      <p class="muted" style="margin-bottom: 14px;">Ekspor seluruh transaksi ke file spreadsheet CSV untuk dibuka di Google Sheets atau Microsoft Excel.</p>
      <button class="btn pri" id="btnExportCsv">📥 Unduh File CSV</button>
    </div>

    <div class="card">
      <h2>Impor Data Spreadsheet</h2>
      <p class="muted" style="margin-bottom: 14px;">Masukkan catatan dari file CSV yang sudah ada ke aplikasi ini.</p>
      <input type="file" id="importCsvInput" accept=".csv,text/csv" style="display:none">
      <button class="btn ghost" id="btnTriggerImport">📤 Pilih File CSV untuk Diimpor</button>
    </div>

    <div class="card" style="border: 1px solid var(--red);">
      <h2 style="color: var(--red);">Hapus Semua Data</h2>
      <p class="muted" style="margin-bottom: 14px;">${syncConnected() ? 'Fitur ini dinonaktifkan saat tersambung agar catatan bot tidak terhapus tanpa sengaja.' : 'Data tersimpan secara offline di browser Anda. Tindakan ini akan mengosongkan seluruh database transaksi.'}</p>
      <button class="btn danger" id="btnResetData" ${syncConnected() ? 'disabled' : ''}>🗑️ Kosongkan Database</button>
    </div>
  `;
}

// -------------------------------------------------------------
// EVENT LISTENERS & MODALS
// -------------------------------------------------------------
function attachViewListeners() {
  const btnSyncNow = $('#btnSyncNow');
  if (btnSyncNow) btnSyncNow.onclick = () => refreshFromBot();
  const btnDisconnect = $('#btnDisconnectSync');
  if (btnDisconnect) {
    btnDisconnect.onclick = () => {
      localStorage.removeItem('finance-sync-token');
      syncToken = '';
      syncState = 'offline';
      render();
      showToast('Perangkat ini tidak lagi tersambung. Data cache tetap tersimpan.');
    };
  }
  // Period filter
  const pFilter = $('#periodFilter');
  if (pFilter) {
    pFilter.onchange = ev => {
      currentPeriod = ev.target.value;
      render();
    };
  }

  // Links on dashboard
  const btnAllTx = $('#btnSeeAllTx');
  if (btnAllTx) btnAllTx.onclick = () => { currentTab = 'transaksi'; render(); };
  const btnAllCat = $('#btnSeeAllCat');
  if (btnAllCat) btnAllCat.onclick = () => { currentTab = 'transaksi'; render(); };

  // New Tx buttons
  const btnNew = $('#btnNewTx');
  if (btnNew) btnNew.onclick = () => openTxModal();

  // Search & chips
  const sInput = $('#txSearch');
  if (sInput) {
    sInput.oninput = ev => {
      searchQuery = ev.target.value;
      render();
      const el = $('#txSearch');
      if (el) el.focus();
    };
  }

  $$('.chip').forEach(c => {
    c.onclick = () => {
      selectedCategory = c.dataset.cat || '';
      render();
    };
  });

  // Transaction item click (Edit)
  $$('.tx').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.txid;
      const t = transactions.find(x => x.id === id);
      if (t) openTxModal(t);
    };
  });

  // Receipt Scanner View Listeners
  const btnParse = $('#btnParseText');
  if (btnParse) {
    btnParse.onclick = () => {
      const raw = $('#quickTextInput')?.value || '';
      if (!raw.trim()) {
        showToast('Ketik atau paste teks transaksi terlebih dahulu.');
        return;
      }
      
      // Try chat draft or parseText
      let draft = chatDraft(raw);
      if (!draft || !draft.amount) {
        draft = parseText(raw);
      }

      if (draft && draft.amount) {
        openTxModal({
          id: uuid(),
          type: draft.type || 'Pengeluaran',
          amount: draft.amount,
          merchant: draft.merchant || 'Hasil Ekstraksi',
          category: draft.category || 'Lain-lain',
          date: draft.date || today(),
          payment: draft.payment || 'QRIS',
          note: draft.note || raw.slice(0, 80)
        });
        showToast('✅ Berhasil diekstrak! Silakan periksa detailnya.');
      } else {
        showToast('⚠️ Nominal tidak terdeteksi. Silakan isi form manual.');
        openTxModal({
          id: uuid(),
          type: 'Pengeluaran',
          amount: 0,
          merchant: '',
          category: 'Makanan & Minuman',
          date: today(),
          payment: 'QRIS',
          note: raw.slice(0, 100)
        });
      }
    };
  }

  const receiptFileInput = $('#receiptFile');
  if (receiptFileInput) {
    receiptFileInput.onchange = ev => {
      const file = ev.target.files[0];
      if (!file) return;
      openTxModal({
        id: uuid(),
        type: 'Pengeluaran',
        amount: 0,
        merchant: file.name.replace(/\.[^/.]+$/, ""),
        category: 'Belanja',
        date: today(),
        payment: 'QRIS',
        note: 'Nota: ' + file.name
      });
      showToast('📸 Foto diterima! Masukkan nominal transaksi.');
    };
  }

  // Data Tools Listeners
  const btnExport = $('#btnExportCsv');
  if (btnExport) {
    btnExport.onclick = () => {
      if (!transactions.length) {
        showToast('Belum ada transaksi untuk diekspor.');
        return;
      }
      const csv = csvExport(transactions);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finance-tracker-${today()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('📥 Berhasil mengunduh catatan CSV!');
    };
  }

  const btnTrigImp = $('#btnTriggerImport');
  const impCsvInput = $('#importCsvInput');
  if (btnTrigImp && impCsvInput) {
    btnTrigImp.onclick = () => impCsvInput.click();
    impCsvInput.onchange = async ev => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = importRows(text);
        const validItems = parsed.filter(p => p.transaction).map(p => ({
          ...p.transaction,
          id: uuid(),
          createdAt: Date.now()
        }));

        if (!validItems.length) {
          showToast('Tidak ada transaksi valid dalam file CSV.');
          return;
        }

        if (syncConnected() && validItems.length > 100) throw new Error('Saat tersinkron, impor dibatasi 100 transaksi per file.');
        for (const item of validItems) await saveTransaction(item);

        transactions = await loadTransactions();
        render();
        showToast(`✅ Berhasil mengimpor ${validItems.length} transaksi!`);
      } catch (err) {
        showToast('Gagal membaca CSV: ' + err.message);
      }
      ev.target.value = '';
    };
  }

  const btnReset = $('#btnResetData');
  if (btnReset) {
    btnReset.onclick = async () => {
      if (confirm('Yakin ingin menghapus seluruh data transaksi dari perangkat ini?')) {
        for (const t of transactions) {
          await deleteTransaction(t.id);
        }
        transactions = [];
        render();
        showToast('Database berhasil dikosongkan.');
      }
    };
  }
}

// -------------------------------------------------------------
// TRANSACTION FORM DIALOG (#dlg)
// -------------------------------------------------------------
function openTxModal(tx = null) {
  const dlg = $('#dlg');
  if (!dlg) return;

  editingTx = tx ? { status: 'active', ...tx } : {
    id: uuid(),
    type: 'Pengeluaran',
    amount: 0,
    merchant: '',
    category: 'Makanan & Minuman',
    date: today(),
    payment: 'QRIS',
    note: '',
    status: 'active',
    createdAt: Date.now()
  };

  const isEdit = !!tx;

  dlg.innerHTML = `
    <div class="mh">
      <h2>${isEdit ? 'Ubah Catatan' : 'Catat Transaksi'}</h2>
      <button class="x" id="closeDlg" aria-label="Tutup">✕</button>
    </div>

    <!-- Segmented Type -->
    <div class="seg" style="margin-bottom: 14px;">
      <label>
        <input type="radio" name="modalType" value="Pengeluaran" ${editingTx.type === 'Pengeluaran' ? 'checked' : ''}>
        <span>Pengeluaran</span>
      </label>
      <label>
        <input type="radio" name="modalType" value="Pemasukan" ${editingTx.type === 'Pemasukan' ? 'checked' : ''}>
        <span>Pemasukan</span>
      </label>
    </div>

    <!-- Big Amount Input -->
    <div>
      <label>Nominal (Rp)</label>
      <input type="text" id="dlgAmount" class="big-in" placeholder="0" value="${editingTx.amount ? editingTx.amount.toLocaleString('id-ID') : ''}">
    </div>

    <!-- Merchant / Source -->
    <div>
      <label>Nama Toko / Sumber / Pihak</label>
      <input type="text" id="dlgMerchant" placeholder="Misal: Indomaret, Kopi Kenangan, Transfer Gaji" value="${esc(editingTx.merchant)}">
    </div>

    <!-- Category & Date -->
    <div class="two">
      <div>
        <label>Kategori</label>
        <select id="dlgCategory">
          ${CATEGORIES.map(c => `
            <option value="${esc(c)}" ${editingTx.category === c ? 'selected' : ''}>${esc(c)}</option>
          `).join('')}
        </select>
      </div>
      <div>
        <label>Tanggal</label>
        <input type="date" id="dlgDate" value="${esc(editingTx.date || today())}">
      </div>
    </div>

    <!-- Payment & Note -->
    <div class="two">
      <div>
        <label>Metode Pembayaran</label>
        <select id="dlgPayment">
          ${PAY_METHODS.map(p => `
            <option value="${esc(p)}" ${editingTx.payment === p ? 'selected' : ''}>${esc(p)}</option>
          `).join('')}
        </select>
      </div>
      <div>
        <label>Catatan Tambahan</label>
        <input type="text" id="dlgNote" placeholder="Rincian singkat barang" value="${esc(editingTx.note || '')}">
      </div>
    </div>

    <div id="dlgErr" class="err" style="display: none;"></div>

    <div class="mf">
      ${isEdit ? `<button class="btn danger" id="dlgDelete" style="margin-right: auto;">Hapus</button>` : ''}
      <button class="btn ghost" id="dlgCancel">Batal</button>
      <button class="btn pri" id="dlgSave">Simpan</button>
    </div>
  `;

  // Attach dialog listeners
  $('#closeDlg').onclick = () => dlg.close();
  $('#dlgCancel').onclick = () => dlg.close();

  if ($('#dlgDelete')) {
    $('#dlgDelete').onclick = async () => {
      if (confirm('Hapus transaksi ini?')) {
        try {
          await deleteTransaction(editingTx.id);
          transactions = transactions.filter(t => t.id !== editingTx.id);
          dlg.close();
          render();
          showToast(syncConnected() ? 'Transaksi dibatalkan dan tersinkron.' : 'Transaksi dihapus.');
        } catch (error) {
          showToast('⚠️ ' + error.message);
        }
      }
    };
  }

  // Format amount input as user types
  const amtInput = $('#dlgAmount');
  amtInput.oninput = () => {
    let raw = amtInput.value.replace(/[^0-9]/g, '');
    if (raw) {
      amtInput.value = Number(raw).toLocaleString('id-ID');
    }
  };

  $('#dlgSave').onclick = async () => {
    const errBox = $('#dlgErr');
    errBox.style.display = 'none';

    try {
      const type = dlg.querySelector('input[name="modalType"]:checked')?.value || 'Pengeluaran';
      const rawAmt = amtInput.value.trim();
      const numAmt = parseAmount(rawAmt || '0');
      const merchant = $('#dlgMerchant').value.trim();
      const category = $('#dlgCategory').value;
      const dateVal = parseDate($('#dlgDate').value || today());
      const payment = $('#dlgPayment').value;
      const note = $('#dlgNote').value.trim();

      const record = {
        ...editingTx,
        status: editingTx.status || 'active',
        type,
        amount: numAmt,
        merchant,
        category,
        date: dateVal,
        payment,
        note,
        updatedAt: Date.now()
      };

      valid(record);

      const savedRecord = await saveTransaction(record);

      // Update state
      const idx = transactions.findIndex(t => t.id === record.id);
      if (idx >= 0) {
        transactions[idx] = savedRecord;
      } else {
        transactions.unshift(savedRecord);
      }

      dlg.close();
      render();
      showToast('✅ Catatan transaksi berhasil disimpan!');
    } catch (e) {
      errBox.textContent = e.message;
      errBox.style.display = 'block';
    }
  };

  dlg.showModal();
}

// -------------------------------------------------------------
// BOOTSTRAP APP
// -------------------------------------------------------------
async function init() {
  acceptConnectionFromUrl();
  try {
    db = await initDB();
    transactions = await loadTransactions();
    if (syncConnected()) await refreshFromBot({ silent: true });
  } catch (err) {
    console.error('Failed to init local database:', err);
  }
  render();
  if (syncConnected()) {
    syncTimer = setInterval(() => refreshFromBot({ silent: true }), 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSyncAt > 30000) {
        refreshFromBot({ silent: true });
      }
    });
  }
}

init();
