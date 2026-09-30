const states = require('./lib-states.js');

function parseTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = String(value || '').trim();
  if (!text) return NaN;
  if (/^\d{4}-\d\d-\d\dT/.test(text) && /(?:[+-]\d\d:\d\d|Z)$/.test(text)) return Date.parse(text);
  // Legacy rows without an offset cannot be assigned a timezone honestly.
  if (/(?:[+-]\d\d:\d\d|Z)$/.test(text)) return Date.parse(text.replace(' ', 'T').replace(/ ([+-])/, '$1'));
  return NaN;
}

function intervalUnion(intervals) {
  const ordered = (intervals || []).filter(pair => Array.isArray(pair) && Number.isFinite(pair[0])
    && Number.isFinite(pair[1]) && pair[1] >= pair[0]).sort((a, b) => a[0] - b[0]);
  let total = 0, start = null, end = null;
  for (const pair of ordered) {
    if (start === null) { start = pair[0]; end = pair[1]; continue; }
    if (pair[0] <= end) end = Math.max(end, pair[1]);
    else { total += end - start; start = pair[0]; end = pair[1]; }
  }
  return start === null ? 0 : total + end - start;
}

function timing(status, now = Date.now()) {
  const parsedRows = [];
  let unknownTimestamps = 0;
  for (const line of String(status || '').split(/\r?\n/)) {
    const cells = line.split('|').slice(1, -1).map(value => value.trim().replace(/`/g, ''));
    if (cells.length !== 5 || !states.exists(cells[2])) continue;
    const at = parseTime(cells[0]);
    if (!Number.isFinite(at)) unknownTimestamps++;
    parsedRows.push({ at, state: cells[2] });
  }
  // A production receipt ends at the first handoff boundary. Historical publication and
  // performance-review rows may remain in status.md, but they are outside the production
  // timing window and must not make an old job look like it is still running.
  const boundaryIndex = parsedRows.findIndex(row => states.isDeliveryBoundary(row.state));
  const rows = boundaryIndex >= 0 ? parsedRows.slice(0, boundaryIndex + 1) : parsedRows;
  const boundaryAt = boundaryIndex >= 0 ? rows[rows.length - 1].at : NaN;
  const nowAt = Number.isFinite(boundaryAt) ? boundaryAt : parseTime(now);
  const totals = { processingWindowMs: 0, approvalWaitMs: 0, blockedMs: 0 };
  const byState = new Map();
  let orderBroken = false;
  for (let i = 1; i < rows.length; i++) {
    if (Number.isFinite(rows[i - 1].at) && Number.isFinite(rows[i].at) && rows[i].at < rows[i - 1].at) orderBroken = true;
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], definition = states.get(row.state);
    if (!definition.next.length || orderBroken) continue;
    const end = i + 1 < rows.length ? rows[i + 1].at : nowAt;
    if (!Number.isFinite(row.at) || !Number.isFinite(end) || end < row.at) { unknownTimestamps++; continue; }
    const ms = end - row.at;
    const kind = ['BLOCKED', 'ESCALATED'].includes(row.state) ? 'blockedMs'
      : states.isGate(row.state) || row.state === 'NEEDS_CLARIFICATION' ? 'approvalWaitMs' : 'processingWindowMs';
    totals[kind] += ms;
    byState.set(row.state, (byState.get(row.state) || 0) + ms);
  }
  const quality = !rows.length ? 'unavailable' : (unknownTimestamps || orderBroken ? 'partial' : 'measured');
  return {
    ...totals, unknownTimestamps, recorded: rows.length > 0, quality,
    firstAt: rows.find(row => Number.isFinite(row.at))?.at ?? null,
    lastAt: [...rows].reverse().find(row => Number.isFinite(row.at))?.at ?? null,
    states: [...byState].map(([state, elapsedMs]) => ({ state, elapsedMs })),
    note: 'Processing windows include provider time and idle time. They are not measured active model time. Legacy timestamps may be rounded to minutes.',
  };
}

module.exports = { timing, parseTime, intervalUnion };
