const assert = require('node:assert/strict');
const test = require('node:test');
const {dueReminder, pruneReminderHistory} = require('../electron/reminders');

const item = {id:'abc', kind:'event', scope:'work', status:'todo', date:'2026-09-30', time:'10:00'};
const start = new Date('2026-09-30T10:00:00').getTime();

test('reminder catches up after wake and reports the actual time left', () => {
  assert.equal(dueReminder(item, start - 31 * 60000, 30), null);
  assert.deepEqual(dueReminder(item, start - 30 * 60000, 30), {
    key:'abc:2026-09-30:10:00:30', body:'30분 후 예정 · 업무'
  });
  assert.equal(dueReminder(item, start - 5 * 60000, 30).body, '5분 후 예정 · 업무');
  assert.equal(dueReminder(item, start + 3 * 60000, 30).body, '3분 전 시작 · 업무');
  assert.equal(dueReminder(item, start + 5 * 60000 + 1, 30), null);
});

test('completed and untimed records do not trigger reminders', () => {
  assert.equal(dueReminder({...item, status:'done'}, start, 30), null);
  assert.equal(dueReminder({...item, kind:'idea'}, start, 30), null);
  assert.equal(dueReminder({...item, time:''}, start, 30), null);
});

test('sent reminder history survives within two days and drops old entries', () => {
  const now = Date.now();
  assert.deepEqual(pruneReminderHistory({recent:now - 1000, old:now - 3 * 86400000, invalid:'bad'}, now), {recent:now - 1000});
  assert.deepEqual(pruneReminderHistory(null, now), {});
});
