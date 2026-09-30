const fs = require('fs');
const path = require('path');
const durable = require('./lib-durable.js');
const frontmatter = require('./lib-frontmatter.js');
const profiles = require('./lib-brand-profile.js');
const kits = require('./lib-brand-kit.js');
const research = require('./lib-brand-research.js');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'brand', 'brand-voice.md');
const BLANK = /^(?:unknown|n\/?a|none|tbd|tba|-+|not[ _-]?(?:known|set|available))$/i;
const NOTE_KEYS = Object.freeze(['summary', 'voice', 'contentPillars', 'strategy', 'postAudit', 'competitorRationale']);
const NOTE_TITLES = Object.freeze({
  summary: 'Summary',
  voice: 'How the brand sounds today',
  contentPillars: 'Topics the brand posts about',
  strategy: 'Strategy',
  postAudit: 'What recent posts show',
  competitorRationale: 'Why these competitors',
});
const NOTE_MAX = 1500;
const NOT_SET = 'Not set yet.';
const REQUIREMENTS = Object.freeze([
  { field: 'voice', reason: 'Add the brand voice: how the brand should sound.' },
  { field: 'audience', reason: 'Add the audience: who the brand is speaking to.' },
  { field: 'market', reason: 'Add the positioning: what the brand offers and what makes it different.' },
  { field: 'contentPillars', reason: 'Add at least one content pillar: a topic the brand posts about.' },
]);

function clean(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && !BLANK.test(text) ? text : '';
}

function pillarsOf(profile) {
  const list = profile && Array.isArray(profile.contentPillars) ? profile.contentPillars : [];
  return [...new Set(list.map(clean).filter(Boolean))];
}

function voiceComplete(profile) {
  if (!profile || typeof profile !== 'object') {
    return { complete: false, missing: ['profile'], reasons: ['Save the brand profile first.'] };
  }
  const present = {
    voice: Boolean(clean(profile.voice) || clean(profile.voiceGuidance)),
    audience: Boolean(clean(profile.audience)),
    market: Boolean(clean(profile.market)),
    contentPillars: pillarsOf(profile).length > 0,
  };
  const gaps = REQUIREMENTS.filter(item => !present[item.field]);
  return { complete: gaps.length === 0, missing: gaps.map(item => item.field), reasons: gaps.map(item => item.reason) };
}

function truncate(text, max) {
  const value = String(text);
  return value.length > max ? value.slice(0, max - 3).trimEnd() + '...' : value;
}

function oneLine(value) {
  if (value == null) return '';
  if (typeof value === 'string') return clean(value).replace(/\s*\n\s*/g, ' ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return truncate(JSON.stringify(value), 300);
}

function block(value) {
  if (value == null) return '';
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) {
    return value.map(oneLine).filter(Boolean).map(item => '- ' + item).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => [key, oneLine(item)])
      .filter(([, item]) => item)
      .map(([key, item]) => '- ' + key + ': ' + item)
      .join('\n');
  }
  return oneLine(value);
}

function section(lines, title, parts) {
  const text = parts.map(part => String(part || '').trim()).filter(Boolean).join('\n\n');
  lines.push('## ' + title, '', text || NOT_SET, '');
}

function colourLine(entry) {
  if (typeof entry === 'string') return clean(entry);
  if (!entry || typeof entry !== 'object') return '';
  const value = clean(entry.value);
  const label = clean(entry.role) || clean(entry.name);
  if (value && label) return label + ': ' + value;
  return value || label;
}

function fontLine(entry) {
  if (typeof entry === 'string') return clean(entry);
  if (!entry || typeof entry !== 'object') return '';
  const family = clean(entry.family);
  if (!family) return '';
  const use = clean(entry.use);
  return use ? family + ' (' + use + ')' : family;
}

function listOf(entries, format) {
  return (Array.isArray(entries) ? entries : []).map(format).filter(Boolean).map(item => '- ' + item).join('\n');
}

function visualIdentity(profile, kit) {
  const parts = [];
  const confirmed = kit && kit.status === 'confirmed' && kit.confirmed ? kit.confirmed : null;
  const visual = (profile && profile.visualIdentity) || {};
  const palette = confirmed ? confirmed.palette : visual.palette;
  const fonts = confirmed ? confirmed.fonts : visual.fonts;
  if (confirmed) parts.push('The brand kit is confirmed.');
  else if (kit && (kit.status === 'pending' || kit.status === 'open')) parts.push('The brand kit is waiting to be confirmed.');
  const colours = listOf(palette, colourLine);
  const type = listOf(fonts, fontLine);
  if (colours) parts.push('Colours:\n' + colours);
  if (type) parts.push('Fonts:\n' + type);
  if (confirmed && confirmed.logo && confirmed.logo.file) parts.push('Logo: ' + confirmed.logo.file);
  return parts;
}

function researchNotes(record) {
  const findings = record && record.findings && typeof record.findings === 'object' ? record.findings : {};
  const parts = [];
  for (const key of NOTE_KEYS) {
    const text = block(findings[key]);
    if (text) parts.push('**' + NOTE_TITLES[key] + '**\n\n' + truncate(text, NOTE_MAX));
  }
  return parts;
}

function audienceIsSuggested(profile) {
  const filled = profile && profile.provenance && profile.provenance.researchFilled;
  return Boolean(clean(profile && profile.audience) && filled && filled.audience && filled.audience.suggested);
}

function voiceSource(profile) {
  const filled = profile && profile.provenance && profile.provenance.researchFilled;
  return filled && filled.voice ? 'captured' : 'decided';
}

function normalized(raw) {
  return String(raw || '').replace(/\r\n/g, '\n');
}

function marksSection(raw) {
  const text = normalized(raw);
  const match = /^## Brand marks[ \t]*$/m.exec(text);
  if (!match) return null;
  const rest = text.slice(match.index);
  const next = rest.slice(match[0].length).search(/^## /m);
  return (next >= 0 ? rest.slice(0, match[0].length + next) : rest).trimEnd();
}

function defaultMarks() {
  try { return marksSection(fs.readFileSync(TEMPLATE, 'utf8')); } catch { return null; }
}

function renderBody(options) {
  const { name, profile, kit, record, status, marks } = options;
  const p = profile || {};
  const lines = ['# Brand voice: ' + name, ''];
  lines.push('Voice is who the brand is and never changes. Tone is how it speaks in a given moment and flexes by context.', '');
  if (!status.complete) {
    lines.push('## Still to fill in', '', status.reasons.map(reason => '- ' + reason).join('\n'), '');
  }
  const voice = clean(p.voice);
  const guidance = block(p.voiceGuidance);
  section(lines, 'How the brand sounds', [voice, guidance && guidance !== voice ? guidance : '']);
  section(lines, 'Who it speaks to', [clean(p.audience), audienceIsSuggested(p) ? 'This audience is a suggestion from competitor research and has not been checked yet.' : '', clean(p.customerSegment) ? 'Customer segment: ' + clean(p.customerSegment) : '']);
  section(lines, 'Positioning', [
    clean(p.market),
    ['Target market: ' + profiles.targetMarketOf(p), clean(p.geography) ? 'Where: ' + clean(p.geography) : '', clean(p.language) ? 'Language: ' + clean(p.language) : ''].filter(Boolean).join('\n'),
  ]);
  section(lines, 'Content pillars', [pillarsOf(p).map(item => '- ' + item).join('\n')]);
  section(lines, 'Vocabulary', [block(p.terminology)]);
  section(lines, 'Words and claims we never use', [block(p.forbiddenClaims)]);
  section(lines, 'Example posts that sound right', [block(p.examples)]);
  section(lines, 'Visual identity', visualIdentity(p, kit));
  section(lines, 'Research notes', researchNotes(record));
  if (marks) lines.push(marks, '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function frontText(fields) {
  return ['---', ...Object.entries(fields).map(([key, value]) => key + ': ' + value), '---', ''].join('\n');
}

function brandName(brandDir) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(brandDir, 'workspace.json'), 'utf8'));
    return clean(config.displayName) || clean(config.name) || path.basename(brandDir);
  } catch {
    return path.basename(brandDir);
  }
}

function readResearch(brandDir) {
  try { return research.read(brandDir); } catch { return null; }
}

function write(brandDir, options = {}) {
  const file = path.join(brandDir, 'brand', 'brand-voice.md');
  const profile = profiles.read(brandDir);
  const kit = kits.read(brandDir);
  const record = readResearch(brandDir);
  const status = voiceComplete(profile);
  const name = clean(options.name) || brandName(brandDir);
  const today = (options.now instanceof Date ? options.now : new Date()).toISOString().slice(0, 10);
  let outcome = null;
  durable.update(file, raw => {
    const previous = normalized(raw);
    const parsed = previous ? frontmatter.parse(previous) : { data: {}, body: '' };
    const marks = marksSection(previous) || defaultMarks();
    const body = renderBody({ name, profile, kit, record, status, marks });
    const fields = {
      brand: path.basename(brandDir),
      file: 'brand-voice',
      version: 0,
      voice_source: voiceSource(profile),
      profile_revision: Number(profile && profile.revision) || 0,
      complete: status.complete,
      updated: today,
    };
    const priorVersion = Number(parsed.data && parsed.data.version) || 0;
    const same = previous
      && String(parsed.body || '').trim() === body.trim()
      && String(parsed.data.voice_source) === fields.voice_source
      && Number(parsed.data.profile_revision) === fields.profile_revision
      && parsed.data.complete === fields.complete;
    if (same) {
      outcome = { version: priorVersion, changed: false };
      return raw;
    }
    fields.version = priorVersion + 1;
    outcome = { version: fields.version, changed: true };
    return frontText(fields) + '\n' + body;
  }, '');
  if (kit && kit.status === 'confirmed' && kit.confirmed) kits.writeBrandMarks(brandDir, kit.confirmed);
  return { file, complete: status.complete, missing: status.missing, reasons: status.reasons, ...outcome };
}

function readStatus(brandDir) {
  return voiceComplete(profiles.read(brandDir));
}

module.exports = {
  REQUIREMENTS,
  voiceComplete,
  readStatus,
  write,
  marksSection,
  renderBody,
};
