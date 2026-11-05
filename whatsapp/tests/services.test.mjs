import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServices} from '../services.mjs';
const cfg={waha:'http://waha:3000',key:'waha-secret',gemini:'ai-secret',model:'test-flash',apps:'https://script.google.com/macros/s/test/exec',token:'sync-secret',session:'default'};
const job={key:'a'.repeat(64),hasMedia:true,media:{url:'http://localhost:3000/api/files/a.jpg',mimetype:'image/jpeg'},text:'nota',receivedAt:Date.now(),messageId:'msg1',chatId:'62812@c.us',reply:'saved'};
const result={nominal:17000,jenis:'Pengeluaran',merchant:'Toko',kategori:'Belanja',metode:'QRIS',tanggal:'2026-11-05',catatan:'nota'};
const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
test('receipt bytes sent to AI; schema saved through existing sync API; one WAHA reply',async()=>{
  const calls=[];
  const services=createServices(cfg,async(url,options)=>{
    calls.push({url,options});
    if(url==='http://waha:3000/api/files/a.jpg') {
      assert.equal(options.headers['X-Api-Key'],'waha-secret');assert.equal(options.redirect,'error');
      return new Response(Buffer.from([255,216,255]),{headers:{'Content-Type':'image/jpeg'}});
    }
    if(url.includes('generativelanguage')) {
      assert.equal(options.headers['x-goog-api-key'],'ai-secret');
      const payload=JSON.parse(options.body);
      assert.equal(payload.contents[0].parts[1].inlineData.data,'/9j/');
      assert.equal(payload.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
      assert.ok(!options.body.includes('sync-secret'));
      return json({candidates:[{content:{parts:[{text:JSON.stringify(result)}]}}]});
    }
    if(url.includes('script.google.com')) {
      const payload=JSON.parse(options.body);
      assert.equal(payload.action,'upsert');assert.equal(payload.token,'sync-secret');
      assert.equal(payload.transaction.amount,17000);assert.ok(!options.body.includes('waha-secret'));
      return json({ok:true,transaction:payload.transaction});
    }
    if(url.endsWith('/api/sendText')) {
      const p=JSON.parse(options.body);assert.equal(p.reply_to,'msg1');assert.equal(p.session,'default');assert.equal(p.chatId,job.chatId);
      return json({id:'outbound1'});
    }
    assert.fail(url);
  });
  const tx=await services.analyze(job);await services.save(tx);await services.reply(job);
  assert.equal(calls.length,4);
});
test('reject missing media, unsupported format and excessive file length before AI',async()=>{
  let calls=0;
  const services=createServices(cfg,async()=>{calls++;return new Response('large',{headers:{'Content-Length':String(9*1024*1024)}});});
  await assert.rejects(()=>services.analyze({...job,media:null}));
  await assert.rejects(()=>services.analyze({...job,media:{...job.media,mimetype:'application/pdf'}}));
  assert.equal(calls,0);
  await assert.rejects(()=>services.analyze(job));assert.equal(calls,1);
});
test('upstream AI, save and send errors do not trigger automatic network retries',async()=>{
  let calls=0;
  const services=createServices(cfg,async()=>{calls++;return new Response('Unavailable',{status:503});});
  await assert.rejects(()=>services.analyze({...job,hasMedia:false}));assert.equal(calls,1);
  await assert.rejects(()=>services.save({id:'WA-test'}));assert.equal(calls,2);
  await assert.rejects(()=>services.reply(job));assert.equal(calls,3);
});
test('success HTTP with rejected sync payload or missing reply ID is not confirmation',async()=>{
  const services=createServices(cfg,async()=>json({ok:false,error:'unauthorized'}));
  await assert.rejects(()=>services.save({id:'WA-test'}));
  await assert.rejects(()=>services.reply(job));
});
