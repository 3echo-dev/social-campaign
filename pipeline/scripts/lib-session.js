// Durable binding between a host chat session and one pipeline job.
//
// The binding is intentionally separate from job state. A session may switch jobs, while a
// state revision may advance many times without changing which job the session owns. A missing,
// deleted or finished binding is returned as no job by the resolver; it never falls through to a
// newer campaign.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('./lib-workspace.js');
const durable = require('./lib-durable.js');

function sessionId(argv = process.argv) {
  const i = argv.indexOf('--session');
  const fromArgs = i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
  const value = fromArgs || process.env.SOCIAL_PIPELINE_SESSION_ID || null;
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id && id.length <= 512 ? id : null;
}

function file(id, argv) {
  return path.join(ws.root(argv), '.social-pipeline', 'sessions',
    crypto.createHash('sha256').update(String(id)).digest('hex') + '.json');
}

function read(id, argv) {
  if (!id) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file(id, argv), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (value.version !== undefined && value.version !== 1) || typeof value.brand !== 'string' || typeof value.jobId !== 'string' ||
      !value.brand || !value.jobId) return { invalid: true };
    return { ...value, version: 1, revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0 };
  } catch (e) {
    return e.code === 'ENOENT' ? null : { invalid: true, error: e.message };
  }
}

function validName(value, label) {
  if (!value || typeof value !== 'string' || value.length > 240 || /[\\/]/.test(value) || value === '..' || value === '.') {
    throw new Error('Invalid ' + label + '.');
  }
  return value;
}

function bind(id, brand, jobId, argv) {
  if (!id) throw new Error('Supply --session or SOCIAL_PIPELINE_SESSION_ID to select a job for this chat.');
  const cleanBrand = validName(brand, 'brand');
  const cleanJob = validName(jobId, 'job');
  const dir = ws.jobDir(cleanBrand, cleanJob, argv);
  const statusPath = path.join(dir, 'status.md');
  if (!fs.existsSync(statusPath)) throw new Error('That job does not exist.');
  let boundStatusRevision = 0;
  try {
    const match = fs.readFileSync(statusPath, 'utf8').match(/\*\*Revision:\*\*\s*`?(\d+)`?/i);
    if (match) boundStatusRevision = Number(match[1]);
  } catch { /* the existence check above is authoritative for selecting a job */ }
  const destination = file(id, argv);
  let saved;
  durable.update(destination, current => {
    let previous = null;
    if (String(current || '').trim()) {
      try { previous = JSON.parse(current); } catch { throw new Error('The saved session binding is corrupt. Remove it and select the job again.'); }
      if (!previous || (previous.version !== undefined && previous.version !== 1)) throw new Error('The saved session binding is corrupt. Remove it and select the job again.');
    }
    saved = {
      version: 1,
      revision: (Number.isInteger(previous && previous.revision) && previous.revision >= 0 ? previous.revision : 0) + 1,
      brand: cleanBrand,
      jobId: cleanJob,
      boundStatusRevision,
      selectedAt: new Date().toISOString(),
    };
    return JSON.stringify(saved, null, 2) + '\n';
  });
  return saved;
}

function sessionFile(id, argv) {
  return id ? file(id, argv) : null;
}

module.exports = { sessionId, read, bind, file: sessionFile };
