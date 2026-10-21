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

async function saveTransaction(t) {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    store.put(t);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteTransaction(id) {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
        <small class="muted">Catat uang, tenang hati · Ruang pribadi offline</small>
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
  return `
    <div class="hd">
      <div>
        <h1>Kelola & Ekspor Data</h1>
        <small class="muted">Cadangkan atau pindahkan data transaksi Anda kapan saja</small>
      </div>
    </div>

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
      <p class="muted" style="margin-bottom: 14px;">Data tersimpan secara offline di browser Anda. Tindakan ini akan mengosongkan seluruh database transaksi.</p>
      <button class="btn danger" id="btnResetData">🗑️ Kosongkan Database</button>
    </div>
  `;
}

// -------------------------------------------------------------
// EVENT LISTENERS & MODALS
// -------------------------------------------------------------
function attachViewListeners() {
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

        for (const item of validItems) {
          await saveTransaction(item);
        }

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
        await deleteTransaction(editingTx.id);
        transactions = transactions.filter(t => t.id !== editingTx.id);
        dlg.close();
        render();
        showToast('Transaksi dihapus.');
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

      await saveTransaction(record);

      // Update state
      const idx = transactions.findIndex(t => t.id === record.id);
      if (idx >= 0) {
        transactions[idx] = record;
      } else {
        transactions.unshift(record);
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
// SEED DEFAULT TRANSACTIONS IF FRESH (Demo preview)
// -------------------------------------------------------------
async function seedDefaultDataIfEmpty() {
  if (transactions.length > 0) return;

  const t = today();
  const samples = [
    { id: uuid(), type: 'Pemasukan', amount: 8500000, merchant: 'Gaji Bulanan', category: 'Gaji', date: t, payment: 'BCA', note: 'Gaji pokok', status: 'active', createdAt: Date.now() - 3000 },
    { id: uuid(), type: 'Pengeluaran', amount: 550130, merchant: 'Shopee / BRIVA', category: 'Belanja', date: t, payment: 'BRI', note: 'Pembayaran tagihan Shopee', status: 'active', createdAt: Date.now() - 2000 },
    { id: uuid(), type: 'Pengeluaran', amount: 35000, merchant: 'Kopi Kenangan', category: 'Makanan & Minuman', date: t, payment: 'QRIS', note: 'Es kopi kenangan mantan', status: 'active', createdAt: Date.now() - 1000 }
  ];

  for (const s of samples) {
    await saveTransaction(s);
  }
  transactions = await loadTransactions();
}

// -------------------------------------------------------------
// BOOTSTRAP APP
// -------------------------------------------------------------
async function init() {
  try {
    db = await initDB();
    transactions = await loadTransactions();
    await seedDefaultDataIfEmpty();
  } catch (err) {
    console.error('Failed to init local database:', err);
  }
  render();
}

init();
