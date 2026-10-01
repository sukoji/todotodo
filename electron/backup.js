const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_BACKUP_BYTES = 100_000_000;
const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const BACKUP_NAME = /^todotodo-auto-\d{4}-\d{2}-\d{2}\.json$/;

function localDay(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

async function backupStatus(folder) {
  let names;
  try {names = (await fs.readdir(folder)).filter(name => BACKUP_NAME.test(name));}
  catch (error) {if (error.code === 'ENOENT') return {lastAt: null, count: 0}; throw error;}
  const files = await Promise.all(names.map(async name => ({name, stat: await fs.stat(path.join(folder, name))})));
  files.sort((a,b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return {lastAt: files[0]?.stat.mtimeMs || null, count: files.length};
}

async function saveAutoBackup(folder, exportData, now = new Date(), force = false) {
  await fs.mkdir(folder, {recursive: true});
  const target = path.join(folder, `todotodo-auto-${localDay(now)}.json`);
  let existing;
  try {existing = await fs.stat(target);} catch (error) {if (error.code !== 'ENOENT') throw error;}
  if (!force && existing && now.getTime() - existing.mtimeMs < BACKUP_INTERVAL_MS) return {...await backupStatus(folder), created: false};
  const data = await exportData();
  if (data?.format !== 'todotodo-v2' || !Array.isArray(data.items)) throw new Error('자동 백업 데이터를 확인할 수 없습니다.');
  if (!data.items.length) return {...await backupStatus(folder), created: false, empty: true};
  const content = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(content, 'utf8') > MAX_BACKUP_BYTES) throw new Error('자동 백업이 100MB를 넘었습니다. 데이터를 나눠 백업해 주세요.');
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, content, {flag: 'wx'});
    await fs.rename(temporary, target);
  } finally {await fs.unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});}
  const names = (await fs.readdir(folder)).filter(name => BACKUP_NAME.test(name)).sort().reverse();
  for (const name of names.slice(7)) await fs.unlink(path.join(folder, name));
  return {...await backupStatus(folder), created: true};
}

module.exports = {MAX_BACKUP_BYTES, BACKUP_INTERVAL_MS, backupStatus, saveAutoBackup};
