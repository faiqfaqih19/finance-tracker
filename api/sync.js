const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbwzt7lnCNjpkL8ureMnhv_6i5EFEvs-8SA4f9E1Wv76tcDRtGTOxfxROGsZUHzJAULyFw/exec';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Gunakan POST.' });
  }

  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) {
    return res.status(401).json({ ok: false, error: 'Perangkat belum terhubung ke bot.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const requestText = JSON.stringify({ ...body, token });
  if (requestText.length > 50000) {
    return res.status(413).json({ ok: false, error: 'Permintaan terlalu besar.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const upstream = await fetch(`${APPS_SCRIPT_URL}?api=sync`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: requestText,
      redirect: 'follow',
      signal: controller.signal
    });
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Respons sinkronisasi tidak valid.'); }
    return res.status(data.ok ? 200 : data.error === 'unauthorized' ? 401 : 400).json(data);
  } catch (error) {
    const message = error && error.name === 'AbortError'
      ? 'Sinkronisasi melewati batas waktu.'
      : 'Server sinkronisasi belum dapat dihubungi.';
    return res.status(502).json({ ok: false, error: message });
  } finally {
    clearTimeout(timeout);
  }
};
