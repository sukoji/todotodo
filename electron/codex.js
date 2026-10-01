const {execFile} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function codexCommand() {
  for (const folder of (process.env.Path || process.env.PATH || '').split(path.delimiter)) {
    const directory = folder.replace(/^"|"$/g, '');
    if (!directory) continue;
    for (const name of ['codex.exe', 'codex.ps1']) {
      const file = path.join(directory, name);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

async function runCodex(command, args) {
  const powershell = command.toLowerCase().endsWith('.ps1');
  const executable = powershell ? 'powershell.exe' : command;
  const invocation = powershell ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', command, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = execFile(executable, invocation, {windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024},
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.end();
  });
}

function matchesTodoTodo(server, executable, database) {
  const transport = server?.transport;
  return server.enabled && transport?.type === 'stdio' && transport.command === executable &&
    Array.isArray(transport.args) && transport.args.length === 0 && transport.env?.TODOTODO_DB === database;
}

async function connectCodex(executable, database, confirmReplace, run = runCodex, find = codexCommand) {
  const command = find();
  if (!command) throw new Error('Codex CLI를 찾을 수 없습니다. Codex를 설치하거나 아래 설정을 직접 등록하세요.');
  let servers;
  try {servers = JSON.parse(await run(command, ['mcp', 'list', '--json']));}
  catch {throw new Error('Codex 설정을 읽지 못했습니다. 아래 설정을 직접 등록하세요.');}
  if (!Array.isArray(servers)) throw new Error('Codex 설정 형식을 확인할 수 없습니다. 아래 설정을 직접 등록하세요.');
  const existing = servers.find(server => server.name === 'todotodo');
  if (existing && matchesTodoTodo(existing, executable, database)) return 'already';
  if (existing && !await confirmReplace()) return 'cancelled';
  try {await run(command, ['mcp', 'add', 'todotodo', '--env', `TODOTODO_DB=${database}`, '--', executable]);}
  catch {throw new Error('Codex 연결을 저장하지 못했습니다. 아래 설정을 직접 등록하세요.');}
  try {
    const updated = JSON.parse(await run(command, ['mcp', 'get', 'todotodo', '--json']));
    if (!matchesTodoTodo(updated, executable, database)) throw new Error('verification failed');
  } catch {throw new Error('Codex 설정을 저장했지만 연결을 확인하지 못했습니다. Codex 설정을 확인하세요.');}
  return 'connected';
}

module.exports = {connectCodex};
