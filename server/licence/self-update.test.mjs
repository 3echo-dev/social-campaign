import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { createSelfUpdate, marketplaceUrlFor } from './self-update.mjs';

const catalog = version => async () => ({ ok: true, status: 200, json: async () => ({ plugins: [{ name: 'social-campaign', version }] }) });

function fakeSpawn(codes = []) {
  const calls = [];
  const impl = (cmd, args) => {
    calls.push([cmd, ...args]);
    const child = new EventEmitter();
    setImmediate(() => child.emit('exit', codes.shift() ?? 0));
    return child;
  };
  return { impl, calls };
}

const base = { licenceUrl: 'https://agentc.example/api/plugins/licence', readKey: () => 'key-1', env: {} };

test('catalog URL sits next to the licence route', () => {
  assert.equal(marketplaceUrlFor(base.licenceUrl), 'https://agentc.example/api/plugins/marketplace.json');
});

test('newer version: runs marketplace update then plugin update, once per version', async () => {
  const spawn = fakeSpawn();
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return catalog('0.17.56')(); };
  const updater = createSelfUpdate({ ...base, currentVersion: '0.17.55', fetchImpl, spawnImpl: spawn.impl });
  assert.equal(await updater.check(), 'updated');
  assert.equal(seen.init.headers.authorization, 'Bearer key-1');
  assert.deepEqual(spawn.calls, [
    ['claude', 'plugin', 'marketplace', 'update', 'agentc-3echo'],
    ['claude', 'plugin', 'update', 'social-campaign@agentc-3echo', '--scope', 'user'],
  ]);
  assert.equal(await updater.check(), 'already-tried');
  assert.equal(spawn.calls.length, 2);
});

test('same or older version: nothing runs', async () => {
  for (const version of ['0.17.55', '0.17.40']) {
    const spawn = fakeSpawn();
    const updater = createSelfUpdate({ ...base, currentVersion: '0.17.55', fetchImpl: catalog(version), spawnImpl: spawn.impl });
    assert.equal(await updater.check(), 'current');
    assert.equal(spawn.calls.length, 0);
  }
});

test('failed marketplace update stops before plugin update', async () => {
  const spawn = fakeSpawn([1]);
  const updater = createSelfUpdate({ ...base, currentVersion: '0.17.55', fetchImpl: catalog('0.17.56'), spawnImpl: spawn.impl });
  assert.equal(await updater.check(), 'failed');
  assert.equal(spawn.calls.length, 1);
});

test('off switch, no key and network errors never throw or spawn', async () => {
  const spawn = fakeSpawn();
  const off = createSelfUpdate({ ...base, env: { THREEECHO_SELF_UPDATE: '0' }, currentVersion: '0.17.55', fetchImpl: catalog('9.9.9'), spawnImpl: spawn.impl });
  assert.equal(await off.check(), 'off');
  const noKey = createSelfUpdate({ ...base, readKey: () => null, currentVersion: '0.17.55', fetchImpl: catalog('9.9.9'), spawnImpl: spawn.impl });
  assert.equal(await noKey.check(), 'off');
  const down = createSelfUpdate({ ...base, currentVersion: '0.17.55', fetchImpl: async () => { throw new Error('down'); }, spawnImpl: spawn.impl });
  assert.equal(await down.check(), 'failed');
  assert.equal(spawn.calls.length, 0);
});
