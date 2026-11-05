import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync} from 'node:fs';
import {join} from 'node:path';

export function verifyWebhook(raw, headers, secret) {
  const signature = headers['x-webhook-hmac'];
  if (headers['x-webhook-hmac-algorithm'] !== 'sha512' || !/^[a-f0-9]{128}$/i.test(signature || '')) return false;
  const expected = createHmac('sha512', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export function acceptEvent(event, config) {
  const p = event?.payload;
  if (event?.event !== 'message' || event.session !== config.session || !p || p.fromMe !== false) return null;
  const match = /^(\d+)@(c\.us|s\.whatsapp\.net)$/.exec(p.from || '');
  if (!match || match[1] !== config.phone || typeof p.id !== 'string' || !p.id || p.id.length > 1000) return null;
  if (!p.hasMedia && !(typeof p.body === 'string' && p.body.trim())) return null;
  return {
    key: createHash('sha256').update(event.session + ':' + p.id).digest('hex'),
    messageId: p.id, chatId: p.from, text: String(p.body || '').slice(0, 6000),
    hasMedia: Boolean(p.hasMedia), media: p.media ? {url:p.media.url, mimetype:p.media.mimetype} : null,
    receivedAt: Date.now(), state: 'queued'
  };
}

// Never download arbitrary webhook URLs with the WAHA API key. Only the local
// WAHA /api/files path is allowed; localhost is rewritten to its Docker hostname.
export function mediaUrl(rawUrl, baseUrl) {
  const base = new URL(baseUrl);
  const url = new URL(rawUrl);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw Error('MEDIA_URL');
  const localAlias = ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === base.port;
  if (url.origin !== base.origin && !localAlias) throw Error('MEDIA_ORIGIN');
  if (!url.pathname.startsWith('/api/files/')) throw Error('MEDIA_PATH');
  return new URL(url.pathname, base).href;
}

export function normalizeTransaction(data, job) {
  if (!data || !Number.isSafeInteger(data.nominal) || data.nominal <= 0) throw Error('AMOUNT_UNCLEAR');
  if (!['Pemasukan', 'Pengeluaran'].includes(data.jenis)) throw Error('TYPE_UNCLEAR');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.tanggal || '') ||
      Number.isNaN(Date.parse(data.tanggal)) || new Date(data.tanggal).toISOString().slice(0,10) !== data.tanggal) throw Error('DATE_UNCLEAR');
  // User/OCR content cannot become spreadsheet formulas.
  const clean = (value, limit) => {
    const s = String(value || '').trim().slice(0, limit);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  };
  const merchant = clean(data.merchant, 120);
  if (!merchant) throw Error('MERCHANT_UNCLEAR');
  return {id:'WA-' + job.key.slice(0, 32), type:data.jenis, amount:data.nominal,
    merchant, category:clean(data.kategori || 'Lain-lain',80), date:data.tanggal,
    payment:clean(data.metode || 'Lainnya',40), note:clean(data.catatan,300),
    status:'active', createdAt:job.receivedAt};
}

export function card(tx) {
  return `✅ Transaksi tersimpan\nRp${tx.amount.toLocaleString('id-ID')} · ${tx.type}\n` +
    `${tx.merchant} · ${tx.category}\n${tx.date} · ${tx.payment}\n${tx.note || '-'}\n\n${tx.id}`;
}

export class Store {
  constructor(dir) { this.dir = dir; mkdirSync(dir, {recursive:true, mode:0o700}); }
  path(key) { if (!/^[a-f0-9]{64}$/.test(key)) throw Error('JOB_ID'); return join(this.dir, key + '.json'); }
  get(key) {
    try { return JSON.parse(readFileSync(this.path(key), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  put(job) {
    const target = this.path(job.key), temp = target + '.tmp';
    writeFileSync(temp, JSON.stringify(job), {mode:0o600});
    const fd = openSync(temp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, target);
    const dir = openSync(this.dir, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  all() { return readdirSync(this.dir).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).map(f => this.get(f.slice(0,-5))); }
  enqueue(job) { if (this.get(job.key)) return false; this.put(job); return true; }
}

export async function processJob(job, store, services) {
  // Write the intent before any irreversible network operation. If a process
  // dies mid-send or mid-save, do not blindly retry the ambiguous operation.
  if (job.state === 'sending') {
    job.state = 'delivery_uncertain'; store.put(job); return;
  }
  if (job.state === 'saving') {
    job.state = 'save_uncertain';
    job.reply = '⚠️ Hasil penyimpanan belum dapat dipastikan. Periksa website sebelum mengirim ulang nota ini.';
    store.put(job);
  }
  if (job.state === 'queued') {
    try {
      job.transaction = await services.analyze(job);
      job.state = 'analyzed'; store.put(job);
    } catch {
      job.state = 'failed';
      job.reply = '⚠️ Nota belum berhasil dibaca. Belum ada transaksi yang disimpan. Coba foto JPEG/PNG/WebP yang jelas atau ketik rincian transaksi.';
      store.put(job);
    }
  }
  if (job.state === 'analyzed') {
    job.state = 'saving'; store.put(job);
    try {
      await services.save(job.transaction);
      job.state = 'saved'; job.reply = card(job.transaction); store.put(job);
    } catch {
      job.state = 'save_uncertain';
      job.reply = '⚠️ Penyimpanan belum terkonfirmasi. Periksa website sebelum mengirim ulang nota ini.';
      store.put(job);
    }
  }
  if (['saved', 'failed', 'save_uncertain'].includes(job.state)) {
    job.state = 'sending'; store.put(job);
    try { await services.reply(job); job.state = 'done'; }
    catch { job.state = 'delivery_uncertain'; }
    // Keep transaction/error state and duplicate receipt IDs across restarts.
    job.text = ''; job.media = null;
    store.put(job);
  }
}
