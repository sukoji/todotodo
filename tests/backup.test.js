const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {backupStatus, saveAutoBackup} = require('../electron/backup');

test('automatic backup keeps the latest seven days and preserves an older copy when data is empty', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'todotodo-backup-test-'));
  try {
    const start = new Date();
    start.setDate(start.getDate() + 2);
    start.setHours(12, 0, 0, 0);
    const day = offset => new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, start.getHours(), start.getMinutes(), start.getSeconds());
    const dateKey = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    let calls = 0;
    const exportData = async () => ({format: 'todotodo-v2', items: [{title: `draft ${++calls}`}]});
    const first = await saveAutoBackup(folder, exportData, start);
    const file = path.join(folder, `todotodo-auto-${dateKey(start)}.json`);
    assert.equal(first.created, true);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).items[0].title, 'draft 1');
    await fs.utimes(file, start, start);
    await saveAutoBackup(folder, exportData, new Date(start.getTime() + 5 * 60000));
    assert.equal(calls, 1);
    await saveAutoBackup(folder, exportData, new Date(start.getTime() + 6 * 60000), true);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).items[0].title, 'draft 2');
    await fs.utimes(file, new Date(start.getTime() + 6 * 60000), new Date(start.getTime() + 6 * 60000));
    await saveAutoBackup(folder, exportData, new Date(start.getTime() + 60 * 60000));
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).items[0].title, 'draft 3');
    await fs.writeFile(path.join(folder, 'my-manual-backup.json'), 'keep');
    for (let offset = 1; offset <= 8; offset++) await saveAutoBackup(folder, exportData, day(offset));
    assert.equal((await backupStatus(folder)).count, 7);
    assert.equal(await fs.readFile(path.join(folder, 'my-manual-backup.json'), 'utf8'), 'keep');
    await assert.rejects(fs.access(file), {code: 'ENOENT'});
    const latest = path.join(folder, `todotodo-auto-${dateKey(day(8))}.json`);
    const original = await fs.readFile(latest, 'utf8');
    const empty = await saveAutoBackup(folder, async () => ({format: 'todotodo-v2', items: []}), new Date(day(8).getTime() + 60 * 60000));
    assert.equal(empty.empty, true);
    assert.equal(await fs.readFile(latest, 'utf8'), original);
    await assert.rejects(saveAutoBackup(folder, async () => {throw new Error('export failed');}, new Date(day(8).getTime() + 120 * 60000)));
    assert.equal(await fs.readFile(latest, 'utf8'), original);
  } finally {await fs.rm(folder, {recursive: true, force: true});}
});
