import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const script=fileURLToPath(new URL('../setup.mjs',import.meta.url));
test('setup wizard hides credentials, writes 0600 config and refuses to overwrite',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wa-setup-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const child=spawn(process.execPath,[script],{cwd:dir,stdio:['pipe','pipe','pipe']});
 const answers=['6281234567890','https://script.google.com/macros/s/test/exec','test_sync_token_secret','test_gemini_key_secret',''];
 const prompts=['Nomor pengirim yang diizinkan','URL deployment Apps Script','FINANCE_SYNC_TOKEN dari','GEMINI_API_KEY yang','Model Gemini ('];
 let output='',step=0;
 child.stdout.on('data',chunk=>{
  output+=chunk;
  while(step<prompts.length&&output.includes(prompts[step])) {child.stdin.write(answers[step]+'\n');step++;}
 });
 child.stderr.on('data',c=>{output+=c;});
 const timer=setTimeout(()=>child.kill(),5000);
 const code=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);
 assert.equal(code,0,output);assert.equal(step,5);
 assert.ok(!output.includes('test_sync_token_secret')&&!output.includes('test_gemini_key_secret'));
 const env=readFileSync(join(dir,'.env'),'utf8');
 assert.ok(env.includes('FINANCE_SYNC_TOKEN=test_sync_token_secret'));
 assert.equal(statSync(join(dir,'.env')).mode&0o777,0o600);
 const again=spawn(process.execPath,[script],{cwd:dir,stdio:'ignore'});
 assert.equal(await new Promise(resolve=>again.on('exit',resolve)),1);
 assert.equal(readFileSync(join(dir,'.env'),'utf8'),env);
});
