// Local files remain authoritative. Replace snapshots atomically and serialize their writers.
//
// A lock is a coordination aid, not state. A process can be killed after creating the lock and
// before it has finished writing its owner record, so recovery must distinguish an active owner
// from an abandoned or incomplete lock. The recovery guard has the same rule as the data lock.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STALE_MS = 10000;
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Node replaces the destination as part of rename on the supported local filesystems.
    // There is deliberately no delete-then-rename fallback: that would make a crash expose a
    // missing state file instead of the previous complete snapshot.
    fs.renameSync(temp, file);
    // Directory fsync is supported on Unix; Windows still gets the atomic file replacement.
    try {
      const d = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
    } catch { /* directory handles are not fsync-able on every Windows filesystem */ }
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(temp); } catch {}
  }
}

function optionsFor(value) {
  if (value && typeof value === 'object') {
    return {
      timeoutMs: Number.isFinite(Number(value.timeoutMs)) ? Math.max(0, Number(value.timeoutMs)) : DEFAULT_TIMEOUT_MS,
      staleMs: Number.isFinite(Number(value.staleMs)) ? Math.max(100, Number(value.staleMs)) : DEFAULT_STALE_MS,
    };
  }
  return {
    timeoutMs: Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : DEFAULT_TIMEOUT_MS,
    staleMs: DEFAULT_STALE_MS,
  };
}

function owner() {
  return {
    version: 1,
    pid: process.pid,
    host: os.hostname(),
    nonce: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

function ownerText(value) {
  return JSON.stringify(value);
}

// `process.kill(pid, 0)` is an existence probe on Node. EPERM means the process exists but is
// not inspectable, which is still an active owner for recovery purposes.
function alive(record) {
  if (!record || record.host !== os.hostname() || !Number.isInteger(Number(record.pid)) || Number(record.pid) <= 0) return null;
  try {
    process.kill(Number(record.pid), 0);
    return true;
  } catch (e) {
    if (e && e.code === 'ESRCH') return false;
    if (e && e.code === 'EPERM') return true;
    return null;
  }
}

function descriptor(file) {
  let raw;
  let stat;
  try {
    raw = fs.readFileSync(file, 'utf8');
    stat = fs.statSync(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return { raw: null, record: null, mtimeMs: 0, unreadable: true };
  }
  let record = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed;
  } catch { /* an incomplete owner write is handled by the age policy below */ }
  return { raw, record, mtimeMs: Number(stat.mtimeMs) || 0, unreadable: false };
}

/**
 * Whether a lock can be recovered. `false` is also the safe answer for another host whose
 * process cannot be probed locally. Unknown local metadata is recoverable only after the stale
 * threshold, which covers a process killed before it finished the owner write.
 */
function recoverable(file, staleMs, now = Date.now()) {
  const item = descriptor(file);
  if (!item) return { stale: false, missing: true, raw: null };
  if (item.unreadable) return { stale: false, unreadable: true, raw: item.raw };
  const state = alive(item.record);
  if (state === true) return { stale: false, active: true, raw: item.raw };
  if (state === false) return { stale: true, active: false, raw: item.raw };
  if (item.record && item.record.host && item.record.host !== os.hostname()) {
    return { stale: false, active: true, remote: true, raw: item.raw };
  }
  // Owner metadata is normally written immediately after creation. A blank or partial record is
  // therefore treated as an incomplete creation with a short bound, while an unrecognised but
  // complete-looking record keeps the normal stale threshold.
  const incomplete = item.record === null && (!item.raw || !/^\s*\{[\s\S]*\}\s*$/.test(item.raw));
  const threshold = incomplete ? Math.min(staleMs, 1000) : staleMs;
  return { stale: now - item.mtimeMs >= threshold, active: false, unknown: true, raw: item.raw };
}

function releaseIfOwner(file, text) {
  try {
    if (fs.readFileSync(file, 'utf8') === text) fs.unlinkSync(file);
  } catch { /* another recovery owner may have already handled it */ }
}

function recover(lock, opts) {
  const guard = lock + '.reap';
  const reapOwner = owner();
  const reapText = ownerText(reapOwner);
  let fd;
  try {
    fd = fs.openSync(guard, 'wx', 0o600);
    fs.writeFileSync(fd, reapText, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
  } catch (e) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    if (e && e.code === 'EEXIST') {
      // A killed reaper must not permanently disable recovery. An active or remote reaper is
      // left alone; an unknown local one gets the same bounded stale policy as a data lock.
      const stale = recoverable(guard, opts.staleMs);
      if (stale && stale.stale) releaseIfOwner(guard, stale.raw);
    }
    return false;
  }

  try {
    const before = descriptor(lock);
    const status = recoverable(lock, opts.staleMs);
    if (status.stale && before && status.raw === before.raw) releaseIfOwner(lock, before.raw);
  } finally {
    releaseIfOwner(guard, reapText);
  }
  return true;
}

function acquire(file, timeoutOrOptions = DEFAULT_TIMEOUT_MS) {
  const opts = optionsFor(timeoutOrOptions);
  const lock = file + '.lock';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const me = owner();
  const text = ownerText(me);
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    let fd;
    try {
      fd = fs.openSync(lock, 'wx', 0o600);
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
    if (fd !== undefined) {
      try {
        fs.writeFileSync(fd, text, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releaseIfOwner(lock, text);
        process.removeListener('exit', release);
      };
      process.once('exit', release);
      return release;
    }

    // Serialize stale-owner recovery so one reaper cannot remove a new writer's lock. A writer
    // never waits on `.reap`, so the guard only coordinates reapers and is itself recoverable.
    recover(lock, opts);
    if (Date.now() >= deadline) throw new Error('Another process is updating this job. Retry after it finishes.');
    pause(20);
  }
}

function update(file, change, initial = '') {
  const release = acquire(file);
  try {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      text = initial;
    }
    const next = change(text);
    if (next !== undefined && next !== text) atomicWrite(file, next);
    return next;
  } finally {
    release();
  }
}

module.exports = {
  atomicWrite,
  acquire,
  update,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_STALE_MS,
  _alive: alive,
  _recoverable: recoverable,
};
