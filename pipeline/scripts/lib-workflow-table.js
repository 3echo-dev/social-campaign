'use strict';
// The stage table of a workflow file, as rows.
//
// `pipeline/workflows/<id>.md` holds one markdown table with a Condition column; that table is
// the executable truth for a plan. The planner keeps the rows whose condition holds, and the
// catalogue lists every row with its condition in words, so both read the table through this
// one parser.
//
// Returns { header, rows }: the header cells of the first table that has a Condition column,
// and one object per body row keyed by header cell. `header` is null when there is no such
// table, and `rows` is then empty.
function parseStageTable(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  let header = null;
  const rows = [];
  for (const line of lines) {
    if (!line.trim().startsWith('|')) { if (header && rows.length) break; continue; }
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (!header) { if (cells.includes('Condition')) header = cells; continue; }
    if (cells.every(c => /^:?-+:?$/.test(c))) continue;
    const row = {}; header.forEach((h, i) => row[h] = cells[i] || '');
    rows.push(row);
  }
  return { header, rows };
}

module.exports = { parseStageTable };
