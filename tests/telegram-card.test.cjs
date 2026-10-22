const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
let sentPayload = null;

const context = {
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null })
  },
  UrlFetchApp: {
    fetch: (url, options) => {
      if (url.includes('/sendMessage')) sentPayload = JSON.parse(options.payload);
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    }
  },
  Utilities: {
    formatDate: (date) => date.toISOString().slice(0, 10),
    getUuid: () => '00000000-0000-0000-0000-000000000000'
  },
  CacheService: {
    getScriptCache: () => ({ get: () => null, put: () => {} })
  }
};

vm.createContext(context);
vm.runInContext(source + '\nthis.__test = { sendTransactionCard, normalizeTransactionDate, normalizeNominalValue, getTransactionResponseSchema };', context);

context.__test.sendTransactionCard(123, {
  id: 'TRX-787257688',
  amount: 50000,
  type: 'Pengeluaran',
  merchant: 'Masjid Gedhe Kauman',
  category: 'Donasi',
  date: '2026-10-02',
  payment: 'QRIS',
  note: 'Pembayaran QRIS ke Masjid Gedhe Kauman'
});

assert.equal(sentPayload.chat_id, 123);
assert.equal(sentPayload.text,
  '✅ Transaksi tersimpan\n' +
  'Rp50.000 · Pengeluaran\n' +
  'MASJID GEDHE KAUMAN · Donasi\n' +
  '02/10/2026 · QRIS\n' +
  'Pembayaran QRIS ke Masjid Gedhe Kauman\n\n' +
  'TRX-787257688');
assert.deepEqual(JSON.parse(JSON.stringify(sentPayload.reply_markup.inline_keyboard[0])), [
  { text: '✏️ Koreksi', callback_data: 'edit:TRX-787257688' },
  { text: 'Batalkan transaksi', callback_data: 'cancel:TRX-787257688' }
]);
assert.equal(context.__test.normalizeTransactionDate('2/10/2026'), '2026-10-02');
assert.equal(context.__test.normalizeNominalValue('Rp 256.020'), 256020);
assert.equal(context.__test.normalizeNominalValue('50,000'), 50000);
assert.equal(context.__test.getTransactionResponseSchema().properties.nominal.type, 'INTEGER');

console.log('Telegram transaction card test passed.');
