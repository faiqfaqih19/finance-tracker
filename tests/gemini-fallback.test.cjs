const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const cache = new Map();
const calls = [];
let sleeps = 0;

function response(code, body) {
  return {
    getResponseCode: () => code,
    getContentText: () => JSON.stringify(body)
  };
}

const context = {
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => ({
        TELEGRAM_BOT_TOKEN: 'test-token',
        GEMINI_API_KEY: 'test-key',
        GEMINI_MODEL: 'gemini-1.5-flash'
      }[key] || null)
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: (key) => cache.get(key) || null,
      put: (key, value) => cache.set(key, value)
    })
  },
  Utilities: { sleep: () => { sleeps += 1; } },
  UrlFetchApp: {
    fetch: (url) => {
      calls.push(url);
      if (url.includes('/models?pageSize=')) {
        return response(200, {
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] }
          ]
        });
      }
      if (url.includes('/gemini-3.8-flash:generateContent')) {
        return response(503, { error: { message: 'high demand' } });
      }
      if (url.includes('/gemini-3.7-flash:generateContent')) {
        return response(200, {
          candidates: [{ content: { parts: [{ text: '{"nominal":256020,"merchant":"Venam Sintesa"}' }] } }]
        });
      }
      throw new Error('Unexpected URL: ' + url);
    }
  }
};

vm.createContext(context);
vm.runInContext(source + '\nthis.__test = { generateGeminiJson, getGeminiModelCandidates };', context);

const candidates = Array.from(context.__test.getGeminiModelCandidates());
assert.deepEqual(candidates, ['gemini-3.8-flash', 'gemini-3.7-flash']);
assert.equal(candidates.includes('gemini-1.5-flash'), false);

const result = context.__test.generateGeminiJson({ contents: [] });
assert.equal(result.nominal, 256020);
assert.equal(result.merchant, 'Venam Sintesa');
assert.equal(sleeps, 1);
assert.equal(calls.filter((url) => url.includes('gemini-3.8-flash:generateContent')).length, 2);
assert.equal(calls.filter((url) => url.includes('gemini-3.7-flash:generateContent')).length, 1);
assert.equal(cache.get('GEMINI_WORKING_MODEL'), 'gemini-3.7-flash');

console.log('Gemini fallback test passed.');
