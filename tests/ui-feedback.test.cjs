const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const events = new Map();
const classes = new Set();
let now = 100;
let nextTimer = 0;
const timers = new Map();
const toast = { textContent: '', classList: {
  add: s => classes.add(s), remove: s => classes.delete(s), contains: s => classes.has(s)
} };
const document = { hidden: false, documentElement: { dataset: {} },
  addEventListener: (name, fn) => events.set(name, fn) };
const context = { document, window: {}, Date: { now: () => now },
  $: () => toast,
  setTimeout: (fn, duration) => { timers.set(++nextTimer, {fn, at:now+duration}); return nextTimer; },
  clearTimeout: id => timers.delete(id) };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('// Keep keyboard interactions'), source.indexOf('// Database Operations')), context);
function advance(ms) {
  now += ms;
  for (const [id, t] of timers) if (t.at <= now) { timers.delete(id); t.fn(); }
}
context.showToast('first');
advance(1000);
context.showToast('replacement');
advance(2600);
assert.equal(toast.textContent, 'replacement');
assert.ok(classes.has('on'), 'old timer cannot dismiss the newer notification');
document.hidden = true;
events.get('visibilitychange')();
advance(60000);
assert.ok(classes.has('on'), 'hidden tab cannot consume time needed to read feedback');
document.hidden = false;
events.get('visibilitychange')();
advance(899);
assert.ok(classes.has('on'));
advance(1);
assert.ok(!classes.has('on'));
document.hidden = true;
events.get('visibilitychange')();
context.showToast('arrived while hidden');
advance(60000);
document.hidden = false;
events.get('visibilitychange')();
advance(3499);
assert.ok(classes.has('on'));
advance(1);
assert.ok(!classes.has('on'));
events.get('keydown')();
assert.equal(document.documentElement.dataset.input, 'keyboard');
events.get('pointerdown')();
assert.equal(document.documentElement.dataset.input, 'pointer');
console.log('Toast replacement, visibility timing and keyboard/pointer feedback tests passed.');
