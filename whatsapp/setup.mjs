import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {existsSync, writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

if (existsSync('.env')) {
  console.error('.env sudah ada. Konfigurasi lama tidak ditimpa; edit secara lokal jika perlu.');
  process.exit(1);
}
let muted = false;
const output = new Writable({write(chunk, encoding, callback) {
  if (!muted) process.stdout.write(chunk, encoding); callback();
}});
const rl = createInterface({input:process.stdin, output, terminal:Boolean(process.stdin.isTTY)});
async function ask(label, hidden = false) {
  process.stdout.write(label + ': ');
  muted = hidden;
  const answer = (await rl.question('')).trim();
  muted = false;
  if (hidden) process.stdout.write('\n');
  return answer;
}
try {
  console.log('Pengaturan Finance Tracker WhatsApp. Token/API key hanya disimpan lokal di .env.');
  console.log('Gunakan nomor bot terpisah. Nomor pengirim di bawah adalah WhatsApp pribadi Anda.');
  const phone = await ask('Nomor pengirim yang diizinkan (contoh 6281234567890)');
  const apps = await ask('URL deployment Apps Script Finance Tracker (akhiran /exec)');
  const token = await ask('FINANCE_SYNC_TOKEN dari Script Property SYNC_TOKEN', true);
  const gemini = await ask('GEMINI_API_KEY yang sudah Anda gunakan', true);
  const model = await ask('Model Gemini (Enter untuk gemini-3.8-flash)') || 'gemini-3.8-flash';
  const url = new URL(apps);
  if (!/^\d{8,16}$/.test(phone) || url.origin !== 'https://script.google.com' ||
      !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) || url.search || url.hash) throw Error('Nomor atau URL tidak valid.');
  if (![token,gemini,model].every(value => /^[A-Za-z0-9_.:/+=-]+$/.test(value))) throw Error('Token, key, atau model tidak valid.');
  const values = {
    WAHA_IMAGE:process.arch === 'arm64' ? 'devlikeapro/waha:arm' : 'devlikeapro/waha',
    WAHA_API_KEY:randomBytes(32).toString('hex'),
    WAHA_DASHBOARD_PASSWORD:randomBytes(24).toString('hex'),
    WEBHOOK_SECRET:randomBytes(32).toString('hex'),
    WA_ALLOWED_PHONE:phone, WA_SESSION:'default', APPS_SCRIPT_URL:apps,
    FINANCE_SYNC_TOKEN:token, GEMINI_API_KEY:gemini, GEMINI_MODEL:model
  };
  writeFileSync('.env',Object.entries(values).map(([key,value]) => `${key}=${value}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  console.log('Konfigurasi tersimpan. Lanjutkan: docker compose up -d');
  console.log('Dashboard: http://localhost:3000/dashboard — pengguna admin.');
  console.log('Password ada di WAHA_DASHBOARD_PASSWORD dalam .env. Jangan kirim file .env ke chat/GitHub.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rl.close(); }
