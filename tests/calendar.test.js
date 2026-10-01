const {test} = require('node:test');
const assert = require('node:assert/strict');
const {timeOverlaps, timeConflictPairs} = require('../static/schedule-conflicts');

const event = (id, time, end_time, extra = {}) => ({id, date:'2026-10-01', kind:'event', status:'todo', time, end_time, ...extra});

test('overlap uses half-open time ranges on the same day', () => {
  assert.equal(timeOverlaps(event('a','10:00','11:00'), event('b','10:30','11:30')), true);
  assert.equal(timeOverlaps(event('a','10:00','11:00'), event('b','11:00','12:00')), false);
  assert.equal(timeOverlaps(event('a','10:00','11:00'), event('b','10:30','11:30',{date:'2026-10-02'})), false);
});

test('only active time blocks participate and an edited item never conflicts with itself', () => {
  const a = event('a','10:00','11:00');
  for (const other of [
    event('a','10:15','10:45'),
    event('b','10:15','10:45',{status:'done'}),
    event('b','10:15','10:45',{kind:'idea'}),
    event('b','10:15',''),
    event('b','11:00','10:00'),
  ]) assert.equal(timeOverlaps(a, other), false);
  assert.equal(timeOverlaps(a, event('b','10:15','10:45',{kind:'task'})), true);
});

test('calendar identifies each conflicting pair without grouping separate overlaps', () => {
  const items = [event('a','10:00','11:00'), event('b','10:30','11:30'), event('c','11:00','12:00'), event('d','10:15','10:45',{status:'done'})];
  assert.deepEqual(timeConflictPairs(items).map(([a,b]) => [a.id,b.id]), [['a','b'],['b','c']]);
});
