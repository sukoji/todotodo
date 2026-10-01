const test = require('node:test');
const assert = require('node:assert/strict');
const {connectCodex} = require('../electron/codex');

const target = 'C:\\Program Files\\TodoTodo\\mcp.exe';
const database = 'C:\\Users\\A B\\TodoTodo.db';
const configured = {name: 'todotodo', enabled: true, transport: {type: 'stdio', command: target, args: [], env: {TODOTODO_DB: database}}};

test('Codex connection leaves a matching registration untouched', async () => {
  const calls = [];
  const result = await connectCodex(target, database, () => {throw new Error('unexpected confirmation');},
    async (_command, args) => {calls.push(args); return JSON.stringify([configured]);}, () => 'codex.exe');
  assert.equal(result, 'already');
  assert.deepEqual(calls, [['mcp', 'list', '--json']]);
});

test('Codex connection preserves a different registration when replacement is declined', async () => {
  const calls = [];
  const result = await connectCodex(target, database, () => false,
    async (_command, args) => {calls.push(args); return JSON.stringify([{...configured, transport: {...configured.transport, command: 'other.exe'}}]);}, () => 'codex.exe');
  assert.equal(result, 'cancelled');
  assert.deepEqual(calls, [['mcp', 'list', '--json']]);
});

test('Codex connection registers and verifies the exact data path', async () => {
  const calls = [];
  const result = await connectCodex(target, database, () => true,
    async (_command, args) => {
      calls.push(args);
      return args[1] === 'list' ? '[]' : args[1] === 'get' ? JSON.stringify(configured) : '';
    }, () => 'codex.exe');
  assert.equal(result, 'connected');
  assert.deepEqual(calls, [
    ['mcp', 'list', '--json'],
    ['mcp', 'add', 'todotodo', '--env', `TODOTODO_DB=${database}`, '--', target],
    ['mcp', 'get', 'todotodo', '--json']
  ]);
});
