const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'Code.gs'), 'utf8');

function makeAI(statuses, slow = false) {
  let now = 0;
  const calls = [];
  const cache = new Map([['GEMINI_WORKING_MODEL', 'working-flash']]);
  const context = {
    Date: { now: () => now },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'GEMINI_API_KEY' ? 'test-key' : null }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) },
    Utilities: { sleep: () => assert.fail('interactive AI must not sleep') },
    UrlFetchApp: { fetch: url => {
      assert.ok(!url.includes('pageSize'), 'cached working model skips discovery');
      calls.push(url);
      if (slow) now += 26000;
      const status = statuses.shift() || 503;
      return { getResponseCode: () => status, getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"nominal":17000}' }] } }]
      }) };
    } }
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.ai = { generateGeminiJson, getGeminiModelCandidates };', context);
  return { ai: context.ai, calls };
}
{
  const { ai, calls } = makeAI([200]);
  assert.equal(ai.generateGeminiJson({ contents: [] }).nominal, 17000);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /working-flash:generateContent/);
}
{
  const { ai, calls } = makeAI([404, 503, 200]);
  assert.equal(ai.generateGeminiJson({ contents: [] }).nominal, 17000);
  assert.equal(calls.length, 3);
}
{
  const { ai, calls } = makeAI([429, 429, 429, 200]);
  assert.throws(() => ai.generateGeminiJson({ contents: [] }), /Kuota/);
  assert.equal(calls.length, 3);
}
{
  const { ai, calls } = makeAI([503, 200], true);
  assert.throws(() => ai.generateGeminiJson({ contents: [] }), /sedang sibuk/);
  assert.equal(calls.length, 1, 'do not start another fetch after the soft time budget');
}
console.log('Gemini cached model, fallback cap and latency budget tests passed.');
