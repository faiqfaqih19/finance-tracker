/**
 * Finance Tracker — catat uang, tenang hati
 * Standalone application bundle (no external ES module dependencies)
 */

// ==========================================
// 1. CORE UTILITIES & LOGIC (BUNDLED)
// ==========================================
const CATEGORIES = ['Makanan & Minuman','Belanja','Transportasi','Kebutuhan Pokok','Tagihan','Kesehatan','Pendidikan','Hiburan','Gaji','Usaha','Lain-lain'];
const money = n => 'Rp' + Number(n||0).toLocaleString('id-ID');
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const normalize = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function parseAmount(v){
  let s=String(v??'').trim().toLowerCase().replace(/^rp\s*/,'').replace(/\s/g,'');
  let mult=1;
  if(/(rb|ribu|k)$/.test(s)){mult=1000;s=s.replace(/(rb|ribu|k)$/,'');}
  else if(/(jt|juta)$/.test(s)){mult=1000000;s=s.replace(/(jt|juta)$/,'');}
  if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  else if(mult>1&&/^\d+[.,]\d+$/.test(s))s=s.replace(',','.');
  if(!/^\d+(\.\d+)?$/.test(s))throw Error('Nominal belum valid. Gunakan angka seperti 25000 atau 25.000.');
  const n=Number(s)*mult;
  if(!Number.isSafeInteger(n)||n<=0||n>1000000000000000)throw Error('Nominal harus angka Rupiah bulat positif.');
  return n;
}

function parseDate(v){
  let s=String(v||'').trim();
  let m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if(m)s=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)throw Error('Tanggal tidak valid.');
  return s;
}

function valid(t){
  parseDate(t.date);
  if(!['Pemasukan','Pengeluaran'].includes(t.type))throw Error('Pilih jenis transaksi.');
  if(!Number.isSafeInteger(t.amount)||t.amount<=0)throw Error('Nominal harus angka bulat positif.');
  if(!String(t.merchant||'').trim())throw Error('Isi nama merchant atau sumber dana.');
  if(!String(t.category||'').trim())throw Error('Pilih kategori transaksi.');
  for(const f of ['merchant','category','payment','note'])if(String(t[f]||'').length>500)throw Error('Teks terlalu panjang (maksimal 500 karakter).');
  return t;
}

function periodCode(code){
  const d=today();
  if(code==='today')return {start:d,end:d,label:'Hari ini'};
  if(code==='all')return {start:'0000-01-01',end:'9999-12-31',label:'Semua catatan'};
  let x=new Date(d+'T12:00:00Z');
  if(code==='previous'){x.setUTCDate(1);x.setUTCMonth(x.getUTCMonth()-1);}
  const y=x.getUTCFullYear(),m=x.getUTCMonth();
  return {start:`${y}-${String(m+1).padStart(2,'0')}-01`,end:new Date(Date.UTC(y,m+1,0,12)).toISOString().slice(0,10),label:new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric',timeZone:'Asia/Jakarta'}).format(x)};
}

function aggregate(rows,code='month',category=''){
  const p=periodCode(code);
  const list=rows.filter(t=> (t.status==='active' || !t.status) && t.date>=p.start && t.date<=p.end && (!category||t.category===category));
  let income=0,expense=0;
  const cats={};
  for(const t of list){
    if(t.type==='Pemasukan')income+=t.amount;
    else{expense+=t.amount;cats[t.category]=(cats[t.category]||0)+t.amount;}
  }
  return {income,expense,net:income-expense,count:list.length,list,categories:Object.entries(cats).sort((a,b)=>b[1]-a[1]),period:p};
}

function csvParse(text){
  text=text.replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/)[0];
  const sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
  const out=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(!field||quoted)quoted=!quoted;else field+=c;}
    else if(c===sep&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))out.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw Error('Format CSV belum lengkap: tanda kutip tidak ditutup.');
  row.push(field);if(row.some(v=>v.trim()))out.push(row);
  if(out[0])out[0][0]=out[0][0].replace(/^\uFEFF/,'');
  return out;
}

function importRows(text){
  const rows=csvParse(text);
  if(!rows.length)throw Error('File CSV kosong.');
  const h=rows.shift().map(x=>x.trim().toLowerCase()),find=(names)=>h.findIndex(v=>names.includes(v));
  const cols={date:find(['tanggal transaksi','tanggal','date']),type:find(['jenis','type']),merchant:find(['merchant / toko','merchant','toko']),category:find(['kategori','category']),amount:find(['nominal (rp)','nominal','amount']),payment:find(['metode pembayaran','pembayaran','payment']),note:find(['catatan detail','keterangan','note']),id:find(['id transaksi','id']),status:find(['status'])};
  if(['date','type','merchant','amount'].some(k=>cols[k]<0))throw Error('CSV harus memiliki kolom tanggal, jenis, merchant, dan nominal.');
  if(rows.length>5000)throw Error('Impor maksimal 5.000 transaksi per file.');
  return rows.map((r,i)=>{
    const get=k=>cols[k]<0?'':(r[cols[k]]||'').trim();
    try{
      const rawStatus=get('status').toLowerCase(),rawType=get('type').toLowerCase();
      const t={date:parseDate(get('date')),type:rawType==='pemasukan'?'Pemasukan':rawType==='pengeluaran'?'Pengeluaran':'',merchant:get('merchant'),category:get('category')||'Lain-lain',amount:parseAmount(get('amount')),payment:get('payment')||'Tidak diketahui',note:get('note'),originalId:get('id'),status:['dibatalkan','cancelled'].includes(rawStatus)?'cancelled':['draf','draft','menunggu'].includes(rawStatus)?'draft':'active',source:'import'};
      valid(t);
      return {transaction:t,line:i+2};
    }catch(e){return {error:e.message,line:i+2};}
  });
}

function csvExport(rows){
  const h=['Tanggal Transaksi','Jenis','Merchant / Toko','Kategori','Nominal (Rp)','Metode Pembayaran','Catatan Detail','ID Transaksi','Status'];
  const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'"+'$&').replace(/"/g,'""')+'"';
  const data=rows.map(t=>[t.date,t.type,t.merchant,t.category,t.amount,t.payment,t.note,t.refId||t.originalId||t.id,t.status==='active'?'Aktif':t.status==='draft'?'Draf':'Dibatalkan']);
  return '\uFEFF'+[h,...data].map(r=>r.map(cell).join(',')).join('\r\n');
}

function chatDraft(text){
  if(/[?]|\b(jika|kalau|contoh|misalnya|rencana|ingin|mau|akan|jangan|berapa)\b/i.test(text)||!/\b(beli|bayar|terima|catat|gaji|pengeluaran|pemasukan)\b/i.test(text))return null;
  const m=text.match(/(?:Rp\s*)?(\d+(?:[.,]\d+)*\s*(?:rb|ribu|jt|juta|k)?)(?=\s|$|[,!.])/i);
  if(!m)return null;
  let n;try{n=parseAmount(m[0]);}catch{return null;}
  const incoming=/terima|gaji|pemasukan/i.test(text),place=(text.match(/\bdi\s+(.+?)(?=\s*(?:,|\bbayar\b|\btunai\b|\bqris\b|\bhari ini\b|\bkemarin\b|\btanggal\b)|$)/i)||[])[1];
  let d=today();
  if(/kemarin/i.test(text))d=new Date(new Date(d+'T12:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  const explicit=text.match(/\d{4}-\d{2}-\d{2}/);
  if(explicit){try{d=parseDate(explicit[0]);}catch{return null;}}
  return {date:d,type:incoming?'Pemasukan':'Pengeluaran',amount:n,merchant:place?.trim()||'',category:incoming?'Gaji':/makan|minum|kopi|warteg/i.test(text)?'Makanan & Minuman':/bensin|ojek|grab|gojek/i.test(text)?'Transportasi':'Lain-lain',payment:/qris/i.test(text)?'QRIS':/tunai/i.test(text)?'Tunai':'Tidak diketahui',note:text.slice(0,500),status:'active',source:'chat'};
}

const MON={jan:1,feb:2,mar:3,apr:4,mei:5,may:5,jun:6,jul:7,agu:8,agt:8,ags:8,aug:8,sep:9,okt:10,oct:10,nov:11,nop:11,des:12,dec:12};
const p2=n=>String(n).padStart(2,'0');
function num(s){s=s.replace(/\s/g,'');const d=s.match(/[.,]/g)||[];if(!d.length)return Number(s);const last=Math.max(s.lastIndexOf('.'),s.lastIndexOf(',')),tail=s.slice(last+1),mixed=s.includes('.')&&s.includes(',');return Number((tail.length<=2&&(mixed||d.length===1)?s.slice(0,last):s).replace(/[.,]/g,''));}
function findDate(text,now){const y0=Number(now.slice(0,4)),found=[],P=[[/\b(\d{1,2})[\s\-\/.]*([a-z]{3,9})\.?[\s\-\/,.]*(\d{4}|\d{2})\b/gi,m=>[m[3],MON[m[2].slice(0,3).toLowerCase()],m[1]]],[/\b(\d{4})-(\d{2})-(\d{2})\b/g,m=>[m[1],m[2],m[3]]],[/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/g,m=>[m[3],m[2],m[1]]],[/\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi,m=>[m[3],MON[m[1].slice(0,3).toLowerCase()],m[2]]]];for(const[re,f]of P)for(const m of text.matchAll(re)){let[y,mo,d]=f(m);if(!mo)continue;y=String(y).length===2?2000+Number(y):Number(y);if(y<2015||y>y0+1)continue;try{const iso=parseDate(`${y}-${p2(mo)}-${p2(d)}`),t=text.slice(m.index+m[0].length,m.index+m[0].length+25).match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?!\d)/);found.push({i:m.index,date:iso,time:t?p2(t[1])+':'+t[2]:''})}catch{}}return found.sort((a,b)=>a.i-b.i)[0]||null;}
const STRONG=/total\s*(bayar|pembayaran|tagihan|transaksi|belanja)|grand\s*total|jumlah\s*(transfer|bayar|pembayaran)|total\s*amount/i,WEAK=/total|jumlah|nominal|amount|tagihan|harga|bayar|paid/i,NEG=/kembali|change|tunai|cash|diskon|disc|hemat|ppn|pajak|tax|saldo|balance|poin|point|admin|fee|biaya|subtotal|sub total|dpp|qty/i;
function findAmount(lines){const c=[];lines.forEach((ln,i)=>{const prev=i&&!/\d{3}/.test(lines[i-1])?lines[i-1]:'',ctx=ln+' '+prev;for(const m of ln.matchAll(/(rp\.?|idr)?\s*(\d[\d.,]*\d|\d)/gi)){const raw=m[2],sep=/[.,]/.test(raw);if(sep&&!/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(raw))continue;const n=num(raw);if(!(n>=500&&n<=5e10))continue;if(!m[1]&&!sep&&!(WEAK.test(ctx)&&raw.length<=10))continue;let s=m[1]?1:0;if(STRONG.test(ctx))s+=6;else if(WEAK.test(ctx))s+=3;if(NEG.test(ctx)&&!STRONG.test(ctx))s-=6;c.push({n,s,i});}});c.sort((a,b)=>b.s-a.s||b.n-a.n||a.i-b.i);return c[0]?.n||0;}
const BRANDS=[['Indomaret',/indomaret/],['Alfamart',/alfamart|alfamidi/],['Superindo',/super\s?indo/],['Hypermart',/hypermart/],['GoFood',/gofood/],['GrabFood',/grabfood/],['ShopeeFood',/shopeefood/],['Grab',/\bgrab\b/],['Gojek',/gojek|goride|gocar/],['Tokopedia',/tokopedia/],['Shopee',/shopee/],['PLN',/\bpln\b/],['Telkomsel',/telkomsel/],['Indihome',/indihome/],['Kopi Kenangan',/kopi kenangan/],['Janji Jiwa',/janji jiwa/],['Starbucks',/starbucks/],['KFC',/\bkfc\b/],['McDonald\'s',/mcdonald/],['Pertamina',/pertamina/],['Kimia Farma',/kimia farma/]];
const CAT=[['Gaji',/\bgaji\b|salary/],['Tagihan',/\bpln\b|listrik|token|pdam|indihome|wifi|pulsa|paket data|telkomsel|bpjs|tagihan|cicilan|kontrakan/],['Belanja',/indomaret|alfamart|alfamidi|tokopedia|shopee(?!food)|lazada|tiktok|blibli|hypermart|uniqlo/],['Transportasi',/grab(?!food)|gojek|gocar|goride|ojek|bensin|pertamina|pertalite|\btol\b|parkir|krl|\bmrt\b|\blrt\b|transjakarta|kereta|bluebird/],['Transfer',/penerima|transfer (berhasil|ke)/],['Makanan & Minuman',/gofood|grabfood|shopeefood|warung|warteg|resto|cafe|kafe|kopi|coffee|bakso|mie\b|nasi|ayam|sate|makan|minum|bubur|martabak|starbucks|mcdonald|\bkfc\b|burger|pizza|boba|geprek/],['Kesehatan',/apotek|farma|\bk24\b|klinik|dokter|rumah sakit|\brs\b|obat/],['Pendidikan',/\bukt\b|kuliah|kursus|sekolah|gramedia|udemy/],['Hiburan',/netflix|spotify|youtube|bioskop|\bcgv\b|\bxxi\b|steam|vidio|disney/],['Kebutuhan Pokok',/sembako|beras|pasar|sayur|superindo|galon|elpiji/],['Transfer',/transfer|penerima|kirim uang/]];
const PAY=[['QRIS',/qris/],['GoPay',/gopay/],['OVO',/\bovo\b/],['DANA',/\bdana\b/],['ShopeePay',/shopeepay/],['LinkAja',/linkaja/],['BCA',/\bbca\b|m-?bca/],['BRI',/\bbri\b|brimo/],['Mandiri',/mandiri|livin/],['BNI',/\bbni\b/],['BSI',/\bbsi\b/],['Jago',/jago/],['SeaBank',/seabank/],['Tunai',/\btunai\b|\bcash\b/]];
const title=s=>/[a-z]/.test(s)?s:s.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
function parseText(raw,now=today()){const lines=String(raw||'').split(/\r?\n/).map(s=>s.replace(/[|_~]+/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean),low=lines.join('\n').toLowerCase();const val=re=>{for(let i=0;i<lines.length;i++){const m=lines[i].match(re);if(m){let v=(m[1]||'').replace(/^[:\-\s]+/,'').trim();if(!v&&lines[i+1])v=lines[i+1];if(v)return v;}}return'';};const d=findDate(lines.join('\n'),now),amountN=findAmount(lines);let merchant=val(/(?:^|\s)(?:nama\s+)?(?:merchant|toko|penerima|dibayarkan\s+ke|dibayar\s+ke|pembayaran\s+ke|transfer\s+ke|bayar\s+ke|paid\s+to|store|outlet)\b(.*)$/i).replace(/\b\d{6,}\b/g,'').replace(/[()]/g,' ').replace(/\s+/g,' ').trim().slice(0,60);if(!merchant){const b=BRANDS.find(([,re])=>re.test(low));if(b)merchant=b[0];}if(!merchant)merchant=lines.slice(0,5).find(l=>/[a-z]{3}/i.test(l)&&(l.match(/[a-z]/gi)||[]).length/l.length>.6&&!/struk|receipt|bukti|berhasil|pembayaran|invoice|\bjl\b|telp|npwp|www|tanggal|transaksi/i.test(l))||'';merchant=title(merchant);let refId=val(/(?:^|\s)(?:no\.?\s*(?:ref\w*|transaksi|trx|pesanan|struk|invoice|faktur|resi|kuitansi|bukti)|nomor\s*(?:ref\w*|transaksi|pesanan|struk)|ref(?:erence)?\.?\s*(?:no|number|id)?|(?:id|kode)\s*(?:transaksi|trx|pembayaran|pesanan|referensi)|trans(?:action)?\s*id|trx\s*id|order\s*(?:id|no)|invoice|receipt\s*(?:no|id)|bill\s*no|rrn)\b[\s:.#\-]*(.*)$/i).replace(/(?<=\d) (?=\d)/g,'');const rm=refId.match(/[A-Za-z0-9][A-Za-z0-9\-_\/.]{5,}/);refId=rm&&/\d/.test(rm[0])&&!/^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/.test(rm[0])?rm[0].replace(/[.\-_\/]+$/,'').toUpperCase():'';const type=/dana masuk|uang masuk|transfer masuk|menerima|diterima|salary|\bgaji\b|refund|cashback/.test(low)?'Pemasukan':'Pengeluaran';const category=type==='Pemasukan'&&/gaji|salary/.test(low)?'Gaji':(CAT.find(([,re])=>re.test(low))||['Lain-lain'])[0];let note=val(/(?:^|\s)(?:catatan|keterangan|berita|pesan|remarks?|deskripsi|description|tujuan\s*transaksi|notes?)\b(.*)$/i).slice(0,120);if(!note)note=({'Makanan & Minuman':'Makan & minum',Belanja:'Belanja',Transportasi:'Transportasi',Tagihan:'Bayar tagihan',Transfer:'Transfer',Kesehatan:'Kesehatan',Hiburan:'Hiburan',Gaji:'Gaji masuk','Kebutuhan Pokok':'Kebutuhan pokok',Pendidikan:'Pendidikan'}[category]||'')+(merchant&&category!=='Gaji'?(category==='Transfer'?' ke ':' di ')+merchant:'');return{type,amount:amountN,date:d?.date||now,time:d?.time||'',dateFound:!!d,merchant,category,payment:(PAY.find(([,re])=>re.test(low))||[''])[0],note:note.trim(),refId,status:'active'};}

// ==========================================
// 2. DOM & UI IMPLEMENTATION
// ==========================================
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

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

const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2, 9);

function showToast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('on'), 3500);
}

// Database Operations
async function initDB() {
  return new Promise((resolve, reject) => {
    try {
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
      req.onblocked = () => resolve(null);
    } catch (e) {
      reject(e);
    }
  });
}

async function loadTransactions() {
  if (!db) {
    try {
      const stored = localStorage.getItem('ft_transactions');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('transactions', 'readonly');
      const store = tx.objectStore('transactions');
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result || []).map(t => ({ status: 'active', ...t }));
        resolve(items);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function saveTransaction(t) {
  t.status = t.status || 'active';
  if (!db) {
    const idx = transactions.findIndex(x => x.id === t.id);
    if (idx >= 0) transactions[idx] = t; else transactions.unshift(t);
    try { localStorage.setItem('ft_transactions', JSON.stringify(transactions)); } catch {}
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('transactions', 'readwrite');
      const store = tx.objectStore('transactions');
      store.put(t);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function deleteTransaction(id) {
  if (!db) {
    transactions = transactions.filter(x => x.id !== id);
    try { localStorage.setItem('ft_transactions', JSON.stringify(transactions)); } catch {}
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('transactions', 'readwrite');
      const store = tx.objectStore('transactions');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
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

// 3. Receipt Scanner View
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

// 4. Data Tools
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
  const pFilter = $('#periodFilter');
  if (pFilter) {
    pFilter.onchange = ev => {
      currentPeriod = ev.target.value;
      render();
    };
  }

  const btnAllTx = $('#btnSeeAllTx');
  if (btnAllTx) btnAllTx.onclick = () => { currentTab = 'transaksi'; render(); };
  const btnAllCat = $('#btnSeeAllCat');
  if (btnAllCat) btnAllCat.onclick = () => { currentTab = 'transaksi'; render(); };

  const btnNew = $('#btnNewTx');
  if (btnNew) btnNew.onclick = () => openTxModal();

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

  $$('.tx').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.txid;
      const t = transactions.find(x => x.id === id);
      if (t) openTxModal(t);
    };
  });

  const btnParse = $('#btnParseText');
  if (btnParse) {
    btnParse.onclick = () => {
      const raw = $('#quickTextInput')?.value || '';
      if (!raw.trim()) {
        showToast('Ketik atau paste teks transaksi terlebih dahulu.');
        return;
      }
      
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
          note: draft.note || raw.slice(0, 80),
          status: 'active'
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
          note: raw.slice(0, 100),
          status: 'active'
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
        note: 'Nota: ' + file.name,
        status: 'active'
      });
      showToast('📸 Foto diterima! Masukkan nominal transaksi.');
    };
  }

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
          status: 'active',
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
// SEED DEFAULT TRANSACTIONS
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
// 1. Render immediately so the user never sees a blank screen!
render();

// 2. Asynchronously load database & re-render
initDB().then(async d => {
  db = d;
  transactions = await loadTransactions();
  await seedDefaultDataIfEmpty();
  render();
}).catch(async err => {
  console.warn('DB fallback to memory:', err);
  transactions = await loadTransactions();
  await seedDefaultDataIfEmpty();
  render();
});
