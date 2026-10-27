const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'Code.gs'), 'utf8');

function makeBot(props = { AUTHORIZED_CHAT_ID: '111' }) {
  let locked = false;
  let failLock = false;
  let onAnalyze = () => {};
  let failSend = false;
  let legacyRow = -1;
  const counts = { ai: 0, saves: 0, sends: 0, callbacks: 0 };
  const messages = [];
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props[k] || null,
      getProperties: () => ({ ...props }),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    }) },
    LockService: { getScriptLock: () => ({
      waitLock: () => {
        if (failLock || locked) throw new Error('Lock unavailable');
        locked = true;
      },
      releaseLock: () => { locked = false; }
    }) },
    HtmlService: { createHtmlOutput: s => s },
    Logger: { log: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({}) }) },
    UrlFetchApp: { fetch: (url, options) => {
      assert.ok(!locked, 'no network operation while ledger lock is held');
      if (url.includes('/sendMessage')) {
        counts.sends++;
        messages.push(JSON.parse(options.payload));
        if (failSend) throw new Error('Ambiguous network timeout');
      }
      return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' };
    } },
    analyze: () => {
      assert.ok(!locked, 'AI must run after releasing lock');
      counts.ai++;
      onAnalyze();
      return { nominal: 17000, merchant: 'MIDI', jenis: 'Pengeluaran' };
    },
    save: result => {
      counts.saves++;
      return { id: result.id, amount: result.nominal, type: result.jenis };
    },
    legacy: () => legacyRow,
    callback: () => { counts.callbacks++; }
  };
  vm.createContext(context);
  vm.runInContext(source + `
    analyzeWithGeminiText = analyze;
    saveToSheet = save;
    findTransactionRow = legacy;
    handleTelegramCallback = callback;
    this.bot = { doPost, claimTelegramUpdate };
  `, context);
  return {
    ...context.bot, counts, props, messages,
    onAnalyze: fn => { onAnalyze = fn; },
    failSend: () => { failSend = true; },
    failLock: () => { failLock = true; },
    legacyRow: n => { legacyRow = n; }
  };
}
const event = (id, more = {}) => ({ postData: { contents: JSON.stringify({
  update_id: id, message: { chat: { id: 111, type: 'private' }, text: 'belanja 17000' }, ...more
}) } });

// Retry arrives DURING AI, then three more times after completion: one AI/save/card.
{
  const b = makeBot();
  b.onAnalyze(() => assert.equal(b.doPost(event(787257722)), 'OK'));
  b.doPost(event(787257722));
  for (let i = 0; i < 3; i++) b.doPost(event(787257722));
  assert.deepEqual(b.counts, { ai: 1, saves: 1, sends: 1, callbacks: 0 });
  assert.match(b.messages[0].text, /TRX-787257722/);
  // New runtime/cache eviction cannot lose the persistent duplicate guard.
  const restarted = makeBot(b.props);
  restarted.doPost(event(787257722));
  assert.equal(restarted.counts.ai, 0);
  assert.equal(restarted.counts.sends, 0);
  // Out-of-order and equal-value legitimate messages are still separate updates.
  restarted.doPost(event(787257721));
  restarted.doPost(event(787257723));
  assert.equal(restarted.counts.saves, 2);
}
// A timeout after sending must not produce a second 'reading failed' message.
{
  const b = makeBot();
  b.failSend();
  b.doPost(event(1));
  b.doPost(event(1));
  assert.equal(b.counts.sends, 1);
  assert.equal(b.counts.saves, 1);
}
// Existing (including cancelled) transactions from the old deployment are untouched.
{
  const b = makeBot();
  b.legacyRow(2);
  b.doPost(event(2));
  assert.equal(b.counts.ai, 0);
  assert.equal(b.counts.saves, 0);
  assert.equal(b.counts.sends, 0);
}
// Callback replay cannot advance corrections/cancellation twice.
{
  const b = makeBot();
  const e = event(3, { message: undefined, callback_query: {
    id: 'q', data: 'edit:TRX-2', message: { chat: { id: 111, type: 'private' } }
  } });
  b.doPost(e);
  b.doPost(e);
  assert.equal(b.counts.callbacks, 1);
}
// Prune only expired ledger entries and keep unrelated credentials/state.
{
  const b = makeBot({ AUTHORIZED_CHAT_ID: '111', TG_UPDATE_1: String(Date.now() - 3 * 86400000),
    TG_UPDATE_2: String(Date.now() - 1000), API_SECRET: 'keep' });
  assert.equal(b.claimTelegramUpdate(3), true);
  assert.equal(b.props.TG_UPDATE_1, undefined);
  assert.ok(b.props.TG_UPDATE_2);
  assert.equal(b.props.API_SECRET, 'keep');
}
// An unavailable lock must fail the webhook instead of acknowledging lost input.
{
  const b = makeBot();
  b.failLock();
  assert.throws(() => b.doPost(event(4)), /Lock unavailable/);
  assert.equal(b.props.TG_UPDATE_4, undefined);
  assert.equal(b.counts.ai, 0);
}
console.log('Telegram replay, overlapping delivery, restart, callback and timeout tests passed.');
