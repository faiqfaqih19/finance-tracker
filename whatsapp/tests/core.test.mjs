import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyWebhook,acceptEvent,mediaUrl,normalizeTransaction,Store,processJob} from '../core.mjs';
const config = {session:'default',phone:'6281234567890'};
const event = (extra = {}) => ({event:'message',session:'default',payload:{
  id:'message-1',from:'6281234567890@c.us',fromMe:false,body:'belanja 17000',hasMedia:false,...extra
}});
const fixture = {nominal:17000,jenis:'Pengeluaran',tanggal:'2026-11-05',merchant:'Toko',kategori:'Belanja',metode:'QRIS',catatan:'Nota'};
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(),'finance-wa-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  return new Store(dir);
}
test('WAHA documentation HMAC vector and modified body', () => {
  const raw = Buffer.from('{"event":"message","session":"default","engine":"WEBJS"}');
  const headers = {'x-webhook-hmac-algorithm':'sha512','x-webhook-hmac':'208f8a55dde9e05519e898b10b89bf0d0b3b0fdf11fdbf09b6b90476301b98d8097c462b2b17a6ce93b6b47a136cf2e78a33a63f6752c2c1631777076153fa89'};
  assert.ok(verifyWebhook(raw,headers,'my-secret-key'));
  assert.equal(verifyWebhook(Buffer.concat([raw,Buffer.from(' ')]),headers,'my-secret-key'),false);
  assert.equal(verifyWebhook(raw,{},'my-secret-key'),false);
});
test('ignore strangers, groups, self messages, session/status events', () => {
  assert.ok(acceptEvent(event(),config));
  for (const e of [event({from:'62999@c.us'}),event({from:'6281234567890@g.us'}),event({fromMe:true}),{...event(),session:'other'},{...event(),event:'message.any'},event({id:''})]) {
    assert.equal(acceptEvent(e,config),null);
  }
});
test('media origin, paths, credentials and redirects cannot leak API key', () => {
  assert.equal(mediaUrl('http://localhost:3000/api/files/photo.jpg','http://waha:3000'),'http://waha:3000/api/files/photo.jpg');
  for (const url of ['https://evil.example/api/files/a','http://waha:3000/api/sessions','http://user:pass@waha:3000/api/files/a','http://localhost:9999/api/files/a','file:///api/files/a']) {
    assert.throws(() => mediaUrl(url,'http://waha:3000'));
  }
});
test('validate amount, calendar date and formula injection before write', () => {
  const job = acceptEvent(event(),config);
  const tx = normalizeTransaction({...fixture,merchant:'=IMPORTXML(...)'},job);
  assert.ok(tx.merchant.startsWith("'="));
  assert.match(tx.id,/^WA-[a-f0-9]{32}$/);
  for (const data of [{...fixture,nominal:0},{...fixture,nominal:-1},{...fixture,nominal:'17000'},{...fixture,tanggal:'2026-02-30'},{...fixture,jenis:'Keluar'}]) {
    assert.throws(() => normalizeTransaction(data,job));
  }
});
test('duplicates during analysis and after restart: one analysis, save and reply', async t => {
  const store=temporary(t), job=acceptEvent(event(),config);
  assert.equal(store.enqueue(job),true);
  let analyzes=0,saves=0,replies=0;
  const services={analyze:async j => {
    analyzes++; assert.equal(store.enqueue(acceptEvent(event(),config)),false);
    return normalizeTransaction(fixture,j);
  },save:async () => {saves++;},reply:async () => {replies++;}};
  await processJob(job,store,services);
  const restarted=new Store(store.dir);
  assert.equal(restarted.enqueue(acceptEvent(event(),config)),false);
  await processJob(restarted.get(job.key),restarted,services);
  assert.deepEqual([analyzes,saves,replies],[1,1,1]);
  const another=acceptEvent(event({id:'message-2'}),config);
  assert.equal(restarted.enqueue(another),true);
});
test('image payload is preserved for analysis; saved state resumes without another save', async t => {
  const store=temporary(t),job=acceptEvent(event({hasMedia:true,media:{url:'http://waha:3000/api/files/a.jpg',mimetype:'image/jpeg'}}),config);
  assert.equal(job.media.mimetype,'image/jpeg');
  job.state='saved'; job.transaction=normalizeTransaction(fixture,job); job.reply='saved';store.put(job);
  let replies=0;
  await processJob(store.get(job.key),store,{analyze:()=>assert.fail(),save:()=>assert.fail(),reply:async()=>{replies++;}});
  assert.equal(replies,1);
});
test('ambiguous save is not retried or reported as success', async t => {
  const store=temporary(t),job=acceptEvent(event(),config);
  let saves=0;const replies=[];
  const services={analyze:async j=>normalizeTransaction(fixture,j),save:async()=>{saves++;throw Error('timeout');},reply:async j=>replies.push(j.reply)};
  await processJob(job,store,services);
  await processJob(store.get(job.key),store,services);
  assert.equal(saves,1);assert.equal(replies.length,1);assert.match(replies[0],/belum terkonfirmasi/);
});
test('crash in saving or sending: never repeat uncertain network action', async t => {
  const store=temporary(t); let sends=0;
  const services={analyze:()=>assert.fail(),save:()=>assert.fail(),reply:async()=>{sends++;}};
  const saving=acceptEvent(event(),config);saving.state='saving';store.put(saving);
  await processJob(store.get(saving.key),store,services);
  assert.equal(sends,1);assert.equal(store.get(saving.key).state,'done');
  const sending=acceptEvent(event({id:'message-2'}),config);sending.state='sending';store.put(sending);
  await processJob(store.get(sending.key),store,services);
  assert.equal(sends,1);assert.equal(store.get(sending.key).state,'delivery_uncertain');
});
test('reply timeout does not cause a second reply or another save', async t => {
  const store=temporary(t),job=acceptEvent(event(),config);let sends=0,saves=0;
  const services={analyze:async j=>normalizeTransaction(fixture,j),save:async()=>{saves++;},reply:async()=>{sends++;throw Error('timeout');}};
  await processJob(job,store,services);
  await processJob(store.get(job.key),store,services);
  assert.deepEqual([sends,saves],[1,1]);assert.equal(job.state,'delivery_uncertain');
});
test('AI failure never writes a transaction and returns one actionable message',async t=>{
  const store=temporary(t),job=acceptEvent(event(),config);let replies=0;
  await processJob(job,store,{analyze:async()=>{throw Error('429');},save:()=>assert.fail(),reply:async j=>{replies++;assert.match(j.reply,/Belum ada transaksi/);}});
  assert.equal(replies,1);
});
