import {createServices} from './services.mjs';
import {createServer} from 'node:http';
import {Store, acceptEvent, verifyWebhook, processJob} from './core.mjs';

function required(name) { const value = process.env[name]?.trim(); if (!value) throw Error('Konfigurasi belum lengkap: ' + name); return value; }
const config = {
  phone:required('WA_ALLOWED_PHONE'), session:process.env.WA_SESSION || 'default',
  secret:required('WEBHOOK_SECRET'), key:required('WAHA_API_KEY'),
  waha:process.env.WAHA_URL || 'http://waha:3000',
  apps:required('APPS_SCRIPT_URL'), token:required('FINANCE_SYNC_TOKEN'),
  gemini:required('GEMINI_API_KEY'), model:process.env.GEMINI_MODEL || 'gemini-3.8-flash'
};
if (!/^\d{8,16}$/.test(config.phone) || config.secret.length < 32) throw Error('Nomor/secret tidak valid');
const appsUrl = new URL(config.apps);
if (appsUrl.origin !== 'https://script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(appsUrl.pathname) || appsUrl.search || appsUrl.hash) throw Error('Gunakan URL deployment Apps Script /exec');
const store = new Store(process.env.STATE_DIR || './state');
const services = createServices(config);
let running = false;
async function drain() {
  if (running) return;
  running = true;
  try {
    for (const job of store.all().sort((a,b) => a.receivedAt-b.receivedAt)) {
      if (['done','delivery_uncertain'].includes(job.state)) continue;
      await processJob(job, store, services);
      console.log('Job', job.key.slice(0,12), job.state);
    }
  } catch { console.error('QUEUE_ERROR: antrean dipertahankan; periksa disk dan konfigurasi.'); }
  finally { running = false; }
}
createServer(async (req,res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200).end('OK'); return; }
  if (req.method !== 'POST' || req.url !== '/webhook') { res.writeHead(404).end(); return; }
  try {
    let length = 0; const chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 256 * 1024) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    if (!verifyWebhook(raw,req.headers,config.secret)) { res.writeHead(401).end(); return; }
    const event = JSON.parse(raw.toString('utf8'));
    const job = acceptEvent(event,config);
    if (job) store.enqueue(job); // synchronous durable enqueue before acknowledging
    res.writeHead(200).end('OK');
    setImmediate(drain);
  } catch { res.writeHead(503).end('RETRY'); }
}).listen(3001,'0.0.0.0', () => { console.log('Finance WAHA bridge ready'); drain(); });
setInterval(drain,5000).unref();
