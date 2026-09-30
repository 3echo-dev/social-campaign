#!/usr/bin/env node
// Prove a generated asset can reach the workspace, before spending credits on any.
//
//   node preflight-media.js <media-url> [outdir] [--timeout <ms>]
//
// Pass a media URL from get_asset on any existing asset. Generates nothing.
// Exits 0 only when a real image or video lands on disk: a run that cannot do this
// would spend a credit per panel or clip on files that stay remote.
//
// Exit 0 ok · 1 something came back and it is not media · 2 usage · 3 the host is not reachable.
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.argv[2];
if (!url) {
  console.error('usage: preflight-media.js <media-url-from-get_asset> [outdir]');
  process.exit(2);
}
const flags = process.argv.slice(3);
const outdir = flags.find(a => !a.startsWith('--') && flags[flags.indexOf(a) - 1] !== '--timeout') || os.tmpdir();
const ti = flags.indexOf('--timeout');
const timeoutMs = ti >= 0 && Number(flags[ti + 1]) > 0 ? Number(flags[ti + 1]) : 45000;
const out = path.join(outdir, 'preflight-' + Date.now() + '.bin');

function blockedHost(why) {
  console.error('HTTP BLOCKED: the asset host is not reachable from this session.');
  console.error('  ' + why);
  console.error('  Do not generate. Frames could be fetched as 480px thumbnails through MCP for review,');
  console.error('  but a thumbnail is never a hand-off deliverable. Two options: allowlist the host');
  console.error('  (Organization settings > Capabilities) and start a new session, or resume this job');
  console.error('  in Claude Code where egress is not proxied.');
  process.exit(3);
}

const clean = () => { try { fs.unlinkSync(out); } catch { /* nothing was written */ } };

(async () => {
  // This used to shell out to curl. When curl was missing, the failure was reported as an
  // unreachable host and the fix suggested was to allowlist one, which is a wrong diagnosis
  // of a local problem. Node fetches this itself, so the only thing that can fail is the
  // network, and the message can say which part of it did.
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const why = e.name === 'TimeoutError'
      ? 'No answer within ' + Math.round(timeoutMs / 1000) + ' seconds.'
      : 'The connection failed: ' + (e.cause && e.cause.code ? e.cause.code : e.message) + '.';
    blockedHost(why);
  }

  if (res.status === 401 || res.status === 403) {
    console.error('BLOCKED: the host answered ' + res.status + ', so the URL is reachable but not authorised.');
    console.error('  A signed media URL expires. Call get_asset again for a fresh one before generating.');
    process.exit(1);
  }
  if (!res.ok) blockedHost('The host answered ' + res.status + ' ' + res.statusText + '.');

  let size = 0;
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const body = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(out, body);
    size = body.length;
  } catch (e) {
    clean();
    console.error('BLOCKED: the bytes arrived but could not be written to disk: ' + e.message);
    console.error('  Nothing generated here would be able to land either. Fix the folder first.');
    process.exit(1);
  }

  const head = size ? fs.readFileSync(out).subarray(0, 12) : Buffer.alloc(0);
  const isPNG  = head.length > 3 && head[0] === 0x89 && head[1] === 0x50;
  const isJPEG = head.length > 2 && head[0] === 0xFF && head[1] === 0xD8;
  const isWEBP = head.length > 11 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
  const isMP4  = head.length > 11 && head.toString('ascii', 4, 8) === 'ftyp';

  clean();

  if (!size) { console.error('BLOCKED: the request returned nothing.'); process.exit(1); }
  if (!isPNG && !isJPEG && !isWEBP && !isMP4) {
    console.error(`BLOCKED: ${size} bytes came back but they are not an image or video.`);
    console.error('  Usually an error page or a login redirect, which saves as a valid file and');
    console.error('  reaches a hand-off package without complaint. Do not spend credits.');
    process.exit(1);
  }
  const kind = isPNG ? 'PNG' : isJPEG ? 'JPEG' : isWEBP ? 'WebP' : 'MP4';
  console.log(`ok: round trip works. ${size} bytes, ${kind}. Safe to generate.`);
})();
