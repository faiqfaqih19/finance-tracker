const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function makeBot(initialProps = {}) {
  const props = { SYNC_TOKEN: 'a'.repeat(64), SYNC_TOKEN_VERSION: '2', ...initialProps };
  const sent = [];
  const context = {
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
        setProperties: o => Object.assign(props, o),
        deleteProperty: k => { delete props[k]; }
      })
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        if (url.includes('/sendMessage')) sent.push(JSON.parse(options.payload));
        return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' };
      }
    },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10), getUuid: () => 'x-x' },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) }
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__t = { handleTelegramMessage, handleTelegramCallback };', context);
  return { bot: context.__t, props, sent };
}
const msg = (id, text, type = 'private') => ({ chat: { id, type }, text });

// 1. Pemilik sudah ada: orang asing tidak mendapat token dan tidak bisa /seturl
{
  const { bot, props, sent } = makeBot({ AUTHORIZED_CHAT_ID: '111', WEB_APP_URL: 'https://asli.example/' });
  bot.handleTelegramMessage(msg(999, '/hubungkan'));
  bot.handleTelegramMessage(msg(999, '/seturl https://jahat.example/'));
  assert.equal(props.AUTHORIZED_CHAT_ID, '111');
  assert.equal(props.WEB_APP_URL, 'https://asli.example/');
  assert.equal(sent.length, 2);
  assert.ok(sent.every(m => m.chat_id === 999 && !JSON.stringify(m).includes('a'.repeat(64))));
}

// 2. Pemilik tetap bisa /hubungkan dan /seturl (hanya https)
{
  const { bot, props, sent } = makeBot({ AUTHORIZED_CHAT_ID: '111' });
  bot.handleTelegramMessage(msg(111, '/hubungkan'));
  assert.ok(sent[0].text.includes('a'.repeat(64)));
  bot.handleTelegramMessage(msg(111, '/seturl http://tidak-aman.example/'));
  assert.equal(props.WEB_APP_URL, undefined);
  bot.handleTelegramMessage(msg(111, '/seturl https://baru.example/'));
  assert.equal(props.WEB_APP_URL, 'https://baru.example/');
}

// 3. Belum ada pemilik: tidak ada akun Telegram yang bisa mengambil kepemilikan.
{
  const { bot, props, sent } = makeBot();
  bot.handleTelegramMessage(msg(-5, '/hubungkan', 'group'));
  assert.equal(props.AUTHORIZED_CHAT_ID, undefined);
  bot.handleTelegramMessage(msg(222, 'beli kopi 20000'));
  assert.equal(props.AUTHORIZED_CHAT_ID, undefined);
  bot.handleTelegramMessage(msg(222, '/hubungkan'));
  assert.equal(props.AUTHORIZED_CHAT_ID, undefined);
  assert.ok(!sent.some(m => JSON.stringify(m).includes('a'.repeat(64))));
  bot.handleTelegramMessage(msg(333, '/hubungkan'));
  assert.equal(props.AUTHORIZED_CHAT_ID, undefined);
}

// 4. Callback dari chat asing diabaikan (tidak ada pesan, tidak ada sesi koreksi)
{
  const { bot, props, sent } = makeBot({ AUTHORIZED_CHAT_ID: '111' });
  bot.handleTelegramCallback({ id: 'q', data: 'editfield:TRX-1:amount', message: { chat: { id: 999 } } });
  assert.equal(sent.length, 0);
  assert.equal(props['EDIT_FLOW_999'], undefined);
}

console.log('Telegram authorization test passed.');
