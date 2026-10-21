const assert = require('node:assert/strict');
const handler = require('../api/sync.js');

function response() {
  return {
    code: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

(async () => {
  let res = response();
  await handler({ method: 'POST', headers: {}, body: { action: 'list' } }, res);
  assert.equal(res.code, 401);

  const token = 'a'.repeat(43);
  let forwarded;
  global.fetch = async (url, options) => {
    forwarded = { url, options };
    return { text: async () => JSON.stringify({ ok: true, transactions: [] }) };
  };
  res = response();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { action: 'list' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.match(forwarded.url, /\?api=sync$/);
  assert.equal(JSON.parse(forwarded.options.body).token, token);
  assert.equal(forwarded.options.headers['content-type'], 'text/plain;charset=utf-8');

  global.fetch = async () => ({ text: async () => JSON.stringify({ ok: false, error: 'unauthorized' }) });
  res = response();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { action: 'list' } }, res);
  assert.equal(res.code, 401);

  console.log('PASS: auth, forwarding, dan pemetaan respons API sinkronisasi.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
