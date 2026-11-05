// Run inside the bot container; no credentials or financial data are printed.
const required = name => { const value = process.env[name]; if (!value) throw Error('Konfigurasi belum diisi: ' + name); return value; };
try {
  const r = await fetch((process.env.WAHA_URL || 'http://waha:3000') + '/api/sessions', {
    headers:{'X-Api-Key':required('WAHA_API_KEY')},signal:AbortSignal.timeout(10000)
  });
  if (!r.ok) throw Error('WAHA belum siap atau API key tidak cocok.');
  const sessions = await r.json();
  const session = sessions.find(s => s.name === (process.env.WA_SESSION || 'default'));
  console.log('WAHA:', session?.status || 'Buat sesi default, lalu pindai QR.');
  const sync = await fetch(required('APPS_SCRIPT_URL') + '?api=sync', {
    method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({action:'list',token:required('FINANCE_SYNC_TOKEN')}),signal:AbortSignal.timeout(45000)
  });
  const data = await sync.json();
  if (!sync.ok || !data.ok || !Array.isArray(data.transactions)) throw Error('Koneksi spreadsheet gagal: periksa URL /exec dan SYNC_TOKEN.');
  console.log('Finance Tracker: koneksi baca spreadsheet berhasil. Tidak ada transaksi uji yang ditulis.');
  console.log('AI: key/model terisi; pembacaan foto perlu diuji dengan satu nota nyata.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
