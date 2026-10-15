import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ENDED_MESSAGE, createLicence, shouldEnforce, verifyPass } from './licence.mjs';
import { StdioTransport } from '../mcp/transport.mjs';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');

function makePass(over = {}, signWith = privateKey) {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, workspaceId: 'w1', userId: 'u1', plugins: ['social-campaign'], iat: Date.now(), exp: Date.now() + 3600_000, ...over }),
  ).toString('base64url');
  return `${payload}.${crypto.sign(null, Buffer.from(payload), signWith).toString('base64url')}`;
}

function setup(fetchImpl) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'licence-'));
  fs.writeFileSync(path.join(home, 'plugin-key'), 'key-123\n');
  const licence = createLicence({ publicKey, home, url: 'https://example.test/lic', fetchImpl });
  return { home, licence };
}
const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('valid pass is accepted and cached', async () => {
  const pass = makePass();
  let seen;
  const { licence } = setup(async (url, init) => { seen = { url, init }; return reply(200, { pass })(); });
  assert.equal((await licence.refreshPass()).status, 'ok');
  assert.equal(seen.init.headers.authorization, 'Bearer key-123');
  assert.equal(licence.currentPass().workspaceId, 'w1');
  assert.equal(await licence.check(), null);
});

test('forged pass is rejected and not cached', async () => {
  const { licence } = setup(reply(200, { pass: makePass({}, other.privateKey) }));
  assert.equal((await licence.refreshPass()).status, 'bad-pass');
  assert.equal(licence.currentPass(), null);
  assert.equal(await licence.check(), ENDED_MESSAGE);
});

test('expired pass is rejected', () => {
  assert.equal(verifyPass(makePass({ exp: Date.now() - 1000 }), 'social-campaign', publicKey), null);
});

test('wrong plugin name is rejected', () => {
  assert.equal(verifyPass(makePass({ plugins: ['other-plugin'] }), 'social-campaign', publicKey), null);
  assert.ok(verifyPass(makePass(), 'social-campaign', publicKey));
});

test('403 (and 401) clears the cached pass', async () => {
  for (const status of [403, 401]) {
    const { licence } = setup(reply(status, {}));
    fs.writeFileSync(licence.cacheFile, makePass());
    assert.ok(licence.currentPass());
    assert.equal((await licence.refreshPass()).status, 'revoked');
    assert.equal(fs.existsSync(licence.cacheFile), false);
    assert.equal(await licence.check(), ENDED_MESSAGE);
  }
});

test('network failure and 5xx keep the cached pass until exp', async () => {
  for (const f of [async () => { throw new Error('ECONNREFUSED'); }, reply(503, {})]) {
    const { licence } = setup(f);
    fs.writeFileSync(licence.cacheFile, makePass());
    assert.equal((await licence.refreshPass()).status, 'offline');
    assert.ok(licence.currentPass());
  }
  const { licence } = setup(async () => { throw new Error('down'); });
  fs.writeFileSync(licence.cacheFile, makePass({ exp: Date.now() + 50 }));
  assert.ok(licence.currentPass());
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(licence.currentPass(), null);
});

test('a failed startup fetch is retried on the next tool call, at most every retryMs', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'licence-'));
  fs.writeFileSync(path.join(home, 'plugin-key'), 'key-123\n');
  let clock = 1_000_000;
  let calls = 0;
  let online = false;
  const fetchImpl = async () => {
    calls += 1;
    if (!online) throw new Error('timeout');
    return reply(200, { pass: makePass() })();
  };
  const licence = createLicence({ publicKey, home, url: 'https://example.test/lic', fetchImpl, now: () => clock, retryMs: 30_000 });
  assert.equal((await licence.refreshPass()).status, 'offline');
  online = true;
  clock += 10_000;
  assert.equal(await licence.check(), ENDED_MESSAGE, 'no retry inside retryMs');
  assert.equal(calls, 1);
  clock += 30_000;
  assert.equal(await licence.check(), null, 'retried and got a pass');
  assert.equal(calls, 2);
});

test('no key file: status no-key and ended message, no request made', async () => {
  let called = false;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'licence-'));
  const licence = createLicence({ publicKey, home, fetchImpl: async () => { called = true; } });
  assert.equal((await licence.refreshPass()).status, 'no-key');
  assert.equal(called, false);
  assert.equal(await licence.check(), ENDED_MESSAGE);
});

test('enforcement detection by path and env', () => {
  const cache = '/home/u/.claude/plugins/cache/agentc-3echo/social-campaign/0.17.47/server/licence/licence.mjs';
  assert.equal(shouldEnforce({ env: {}, serverPath: cache }), true);
  assert.equal(shouldEnforce({ env: { CLAUDE_PLUGIN_ROOT: 'C:\\Users\\u\\.claude\\plugins\\cache\\agentc-3echo\\social-campaign\\0.17.47' }, serverPath: '/x/y.mjs' }), true);
  assert.equal(shouldEnforce({ env: {}, serverPath: '/home/u/.claude/plugins/cache/marketplace-3echo-social-campaign/social-campaign/0.17.46/server/licence/licence.mjs' }), false);
  assert.equal(shouldEnforce({ env: {}, serverPath: '/home/u/dev/social-campaign/server/licence/licence.mjs' }), false);
  assert.equal(shouldEnforce({ env: {}, serverPath: '/home/u/my-agentc-3echo-notes/server/x.mjs' }), false);
  assert.equal(shouldEnforce({ env: { THREEECHO_LICENCE_ENFORCE: '1' }, serverPath: '/dev/x.mjs' }), true);
});

test('transport gate: tool calls refused with the message, tool listing untouched', async () => {
  const registry = { list: () => [{ name: 't' }], call: async () => ({ ok: true }) };
  const make = (gate) => new StdioTransport({ registry, context: {}, serverInfo: { name: 'x', version: '0' }, gate });
  const denied = await make({ check: async () => ENDED_MESSAGE }).callToolForTests({ name: 't' });
  assert.equal(denied.isError, true);
  assert.equal(denied.content[0].text, ENDED_MESSAGE);
  const allowed = await make({ check: async () => null }).callToolForTests({ name: 't' });
  assert.equal(allowed.isError, false);
  const ungated = await make(null).callToolForTests({ name: 't' });
  assert.equal(ungated.isError, false);
});
