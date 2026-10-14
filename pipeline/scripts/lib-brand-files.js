// Brand files written from onboarding research: audience.md, positioning.md and platform-playbook.md.
//
// Onboarding used to copy the three templates and write only brand-voice.md (lib-brand-voice.js), so every job started by
// finding both tables empty and researched the same ground again. The researcher now hands in a `brandFiles` block in its
// draft, the server checks it against the run's saved captures (a customer phrase and a proof quote must be found in the page
// they cite), and `write` renders it into the files here.
//
//   - A file is filled only from what research sourced. A section with nothing sourced keeps the template's own text, and a
//     file with nothing at all keeps the whole template with one line at the top saying research found nothing for it.
//   - A file the person (or a job, promote-verbatim.js) has edited is never touched. A file this module wrote, or an
//     untouched template, is rewritten by the next run.
//   - route-job.js reads the same tables through `evidenceGate`: three sourced proof points and one customer phrase open the
//     lite-research gate.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const durable = require('./lib-durable.js');
const profiles = require('./lib-brand-profile.js');
const evidence = require('./lib-onboarding-evidence.js');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'brand');
const STEMS = Object.freeze(['audience', 'positioning', 'platform-playbook']);
const PLATFORMS = Object.freeze(['instagram', 'tiktok', 'facebook']);
const KEYS = Object.freeze({
  audience: ['segments', 'phrases', 'objections', 'notFor'],
  positioning: ['line', 'category', 'offer', 'offerSource', 'proof', 'competitors', 'switching', 'neverClaim'],
  platforms: ['pillars', 'cadence', 'notes'],
});
const LIMITS = Object.freeze({
  segments: 3, phrases: 8, objections: 5, notFor: 4, proof: 8, competitors: 3, neverClaim: 6, pillars: 8, cadence: 3, notes: 3,
});

// ---------------------------------------------------------------- the draft block
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function plain(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

class Check {
  constructor() { this.problems = []; }

  add(field, problem) { this.problems.push({ field, problem }); }

  keys(value, allowed, field) {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) this.add(`${field}.${key}`, `"${key}" is not a field here. Use ${allowed.join(', ')}.`);
    }
  }

  text(parent, key, max, field, required = false) {
    const raw = parent[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.add(`${field}.${key}`, `${key} is required.`);
      return '';
    }
    if (typeof raw !== 'string') {
      this.add(`${field}.${key}`, `${key} must be text.`);
      return '';
    }
    const text = plain(raw);
    if (text.length > max) this.add(`${field}.${key}`, `${key} must be at most ${max} characters (has ${text.length}).`);
    if (required && !text) this.add(`${field}.${key}`, `${key} is required.`);
    return text;
  }

  list(parent, key, field) {
    const raw = parent[key];
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      this.add(`${field}.${key}`, `${key} must be a list.`);
      return [];
    }
    if (raw.length > LIMITS[key]) this.add(`${field}.${key}`, `${key} holds at most ${LIMITS[key]} items (has ${raw.length}).`);
    return raw.slice(0, LIMITS[key]);
  }

  // A source is named by its address and must be one of the run's sources with a readable capture.
  source(parent, key, field, bySource, required = true) {
    const raw = parent[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.add(`${field}.${key}`, `${key} is required: the address of one of research.sources.`);
      return null;
    }
    const hit = typeof raw === 'string' ? bySource.get(evidence.normUrl(raw)) : null;
    if (!hit) {
      this.add(`${field}.${key}`, `${key} must be the address of one of research.sources, and that source needs a readable capture.`);
      return null;
    }
    return hit;
  }

  quote(parent, key, field, hit, max = 300) {
    const quote = this.text(parent, key, max, field, true);
    if (quote && hit && !evidence.quoteFound(hit.capture.squashed, quote)) {
      this.add(`${field}.${key}`, `${key} is not in the saved capture of its source. Copy it exactly as it appears in the capture (use ... to skip words).`);
    }
    return quote;
  }
}

const dayOf = observedAt => String(observedAt || '').slice(0, 10);
const cite = hit => (hit ? { url: hit.source.url, date: dayOf(hit.source.observedAt) } : null);

function audienceBlock(input, check, ctx) {
  const field = 'brandFiles.audience';
  if (!isObject(input)) { check.add(field, 'audience must be an object.'); return null; }
  check.keys(input, KEYS.audience, field);
  const out = {};
  out.segments = check.list(input, 'segments', field).map((item, index) => {
    const at = `${field}.segments[${index}]`;
    if (!isObject(item)) { check.add(at, 'Each segment must be an object.'); return null; }
    check.keys(item, ['name', 'who', 'goal', 'beliefs', 'objections', 'platforms', 'trigger'], at);
    return {
      name: check.text(item, 'name', 80, at, true), who: check.text(item, 'who', 300, at, true), goal: check.text(item, 'goal', 300, at),
      beliefs: check.text(item, 'beliefs', 300, at), objections: check.text(item, 'objections', 300, at),
      platforms: check.text(item, 'platforms', 300, at), trigger: check.text(item, 'trigger', 300, at),
    };
  }).filter(Boolean);
  out.phrases = check.list(input, 'phrases', field).map((item, index) => {
    const at = `${field}.phrases[${index}]`;
    if (!isObject(item)) { check.add(at, 'Each phrase must be an object.'); return null; }
    check.keys(item, ['phrase', 'source', 'segment'], at);
    const hit = check.source(item, 'source', at, ctx.bySource);
    return { phrase: check.quote(item, 'phrase', at, hit), source: cite(hit), segment: check.text(item, 'segment', 80, at) };
  }).filter(Boolean);
  out.objections = check.list(input, 'objections', field).map((item, index) => {
    const at = `${field}.objections[${index}]`;
    if (!isObject(item)) { check.add(at, 'Each objection must be an object.'); return null; }
    check.keys(item, ['objection', 'answer', 'source'], at);
    const hit = check.source(item, 'source', at, ctx.bySource, false);
    return { objection: check.text(item, 'objection', 200, at, true), answer: check.text(item, 'answer', 300, at, true), source: cite(hit) };
  }).filter(Boolean);
  out.notFor = check.list(input, 'notFor', field).map((item, index) => {
    if (typeof item !== 'string' || !plain(item)) { check.add(`${field}.notFor[${index}]`, 'Each notFor line must be text.'); return null; }
    if (plain(item).length > 200) check.add(`${field}.notFor[${index}]`, 'Each notFor line must be at most 200 characters.');
    return plain(item);
  }).filter(Boolean);
  return out;
}

function positioningBlock(input, check, ctx) {
  const field = 'brandFiles.positioning';
  if (!isObject(input)) { check.add(field, 'positioning must be an object.'); return null; }
  check.keys(input, KEYS.positioning, field);
  const out = {
    line: check.text(input, 'line', 300, field), category: check.text(input, 'category', 300, field), offer: check.text(input, 'offer', 400, field),
  };
  out.offerSource = cite(check.source(input, 'offerSource', field, ctx.bySource, false));
  out.proof = check.list(input, 'proof', field).map((item, index) => {
    const at = `${field}.proof[${index}]`;
    if (!isObject(item)) { check.add(at, 'Each proof point must be an object.'); return null; }
    check.keys(item, ['claim', 'source', 'quote'], at);
    const hit = check.source(item, 'source', at, ctx.bySource);
    return { claim: check.text(item, 'claim', 300, at, true), source: cite(hit), quote: check.quote(item, 'quote', at, hit) };
  }).filter(Boolean);
  const known = new Set((ctx.competitors || []).map(name => String(name).toLowerCase()));
  out.competitors = check.list(input, 'competitors', field).map((item, index) => {
    const at = `${field}.competitors[${index}]`;
    if (!isObject(item)) { check.add(at, 'Each competitor must be an object.'); return null; }
    check.keys(item, ['name', 'says', 'differs', 'source'], at);
    const name = check.text(item, 'name', 120, at, true);
    if (name && known.size && !known.has(name.toLowerCase())) check.add(`${at}.name`, `${name} is not one of this brand's competitors.`);
    return { name, says: check.text(item, 'says', 300, at), differs: check.text(item, 'differs', 300, at), source: cite(check.source(item, 'source', at, ctx.bySource, false)) };
  }).filter(Boolean);
  const switching = input.switching;
  out.switching = { push: '', pull: '', habit: '', anxiety: '' };
  if (switching !== undefined && switching !== null) {
    if (!isObject(switching)) check.add(`${field}.switching`, 'switching must be an object with push, pull, habit and anxiety.');
    else {
      check.keys(switching, ['push', 'pull', 'habit', 'anxiety'], `${field}.switching`);
      for (const key of Object.keys(out.switching)) out.switching[key] = check.text(switching, key, 300, `${field}.switching`);
    }
  }
  out.neverClaim = check.list(input, 'neverClaim', field).map((item, index) => {
    if (typeof item !== 'string' || !plain(item)) { check.add(`${field}.neverClaim[${index}]`, 'Each line must be text.'); return null; }
    if (plain(item).length > 200) check.add(`${field}.neverClaim[${index}]`, 'Each line must be at most 200 characters.');
    return plain(item);
  }).filter(Boolean);
  return out;
}

function platformsBlock(input, check, ctx) {
  const field = 'brandFiles.platforms';
  if (!isObject(input)) { check.add(field, 'platforms must be an object.'); return null; }
  check.keys(input, KEYS.platforms, field);
  const platform = (item, at) => {
    const name = check.text(item, 'platform', 20, at, true).toLowerCase();
    if (name && !PLATFORMS.includes(name)) check.add(`${at}.platform`, `platform must be one of ${PLATFORMS.join(', ')}.`);
    return name;
  };
  const out = {};
  out.pillars = check.list(input, 'pillars', field).map((item, index) => {
    const at = `${field}.pillars[${index}]`;
    if (!isObject(item)) { check.add(at, 'Each pillar must be an object.'); return null; }
    check.keys(item, ['name', 'purpose'], at);
    return { name: check.text(item, 'name', 60, at, true), purpose: check.text(item, 'purpose', 200, at, true) };
  }).filter(Boolean);
  out.cadence = check.list(input, 'cadence', field).map((item, index) => {
    const at = `${field}.cadence[${index}]`;
    if (!isObject(item)) { check.add(at, 'Each cadence row must be an object.'); return null; }
    check.keys(item, ['platform', 'postsPerWeek', 'source'], at);
    return { platform: platform(item, at), postsPerWeek: check.text(item, 'postsPerWeek', 120, at, true), source: cite(check.source(item, 'source', at, ctx.bySource)) };
  }).filter(Boolean);
  out.notes = check.list(input, 'notes', field).map((item, index) => {
    const at = `${field}.notes[${index}]`;
    if (!isObject(item)) { check.add(at, 'Each note must be an object.'); return null; }
    check.keys(item, ['platform', 'suits', 'doesNot', 'notes'], at);
    return { platform: platform(item, at), suits: check.text(item, 'suits', 300, at), doesNot: check.text(item, 'doesNot', 300, at), notes: check.text(item, 'notes', 300, at) };
  }).filter(Boolean);
  return out;
}

/**
 * Check a draft's `brandFiles` block. ctx: { bySource, competitors }, where bySource is the map from
 * lib-onboarding-evidence.sourceProblems (address -> { source, capture }). Returns { value, problems }; `value` is the
 * cleaned block (sources replaced by { url, date }), or null when the draft had none.
 */
function validate(input, ctx = {}) {
  const check = new Check();
  if (input === undefined || input === null) return { value: null, problems: [] };
  if (!isObject(input)) {
    check.add('brandFiles', 'brandFiles must be an object with audience, positioning and platforms.');
    return { value: null, problems: check.problems };
  }
  const context = { bySource: ctx.bySource instanceof Map ? ctx.bySource : new Map(), competitors: ctx.competitors || [] };
  check.keys(input, Object.keys(KEYS), 'brandFiles');
  const value = {};
  if (input.audience !== undefined) value.audience = audienceBlock(input.audience, check, context);
  if (input.positioning !== undefined) value.positioning = positioningBlock(input.positioning, check, context);
  if (input.platforms !== undefined) value.platforms = platformsBlock(input.platforms, check, context);
  return { value, problems: check.problems };
}

// ---------------------------------------------------------------- the files
const normalized = raw => String(raw || '').replace(/\r\n/g, '\n');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const FRONT = /^---\n[\s\S]*?\n---\n?/;

function bodyOf(raw) {
  return normalized(raw).replace(FRONT, '').trim();
}

const hashOf = body => sha(body.trim() + '\n');

function templateText(stem) {
  return normalized(fs.readFileSync(path.join(TEMPLATE_DIR, stem + '.md'), 'utf8'));
}

// { title, intro, sections: [{ heading, body }] } of a template body.
function parts(body) {
  const lines = body.split('\n');
  const sections = [];
  let title = '';
  let intro = [];
  let current = null;
  for (const line of lines) {
    if (!title && /^# /.test(line)) { title = line.replace(/^# /, '').trim(); continue; }
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) { current = { heading: heading[1], lines: [] }; sections.push(current); continue; }
    if (current) current.lines.push(line);
    else intro.push(line);
  }
  return {
    title,
    intro: intro.join('\n').trim(),
    sections: sections.map(item => ({ heading: item.heading, body: item.lines.join('\n').trim() })),
  };
}

// What makes two texts "the same template": no front matter, no title, no dates, no spacing.
function canonical(raw) {
  return bodyOf(raw).replace(/^# .*$/m, '').replace(/\d{4}-\d{2}-\d{2}|YYYY-MM-DD/g, 'DATE').replace(/\s+/g, ' ').trim();
}

function ownedHash(raw) {
  const text = normalized(raw);
  const front = FRONT.exec(text);
  if (!front) return null;
  const source = /^source:\s*(onboarding_research|profile|template)\s*$/m.exec(front[0]);
  const hash = /^body_hash:\s*([0-9a-f]{64})\s*$/m.exec(front[0]);
  return source && hash ? hash[1] : null;
}

/** Whether this module may replace the file: it is missing, an untouched template, or exactly as this module last wrote it. */
function replaceable(raw, stem) {
  if (!normalized(raw).trim()) return true;
  const hash = ownedHash(raw);
  if (hash) return hash === hashOf(bodyOf(raw));
  return canonical(raw) === canonical(templateText(stem));
}

function versionOf(raw) {
  const match = /^version:\s*(\d+)\s*$/m.exec((FRONT.exec(normalized(raw)) || [''])[0]);
  return match ? Number(match[1]) : 0;
}

function changelogOf(raw) {
  const section = parts(bodyOf(raw)).sections.find(item => item.heading === 'Changelog');
  return section ? section.body.split('\n').filter(line => /^- /.test(line)) : [];
}

// A table cell: one line, no pipe, no empty.
function cell(value, fallback = '') {
  const text = plain(value === undefined || value === null ? '' : value).replace(/\|/g, '/');
  return text || fallback;
}

const sourceCell = source => (source ? `${source.url} (read ${source.date})` : '');

function table(header, rows) {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
}

// The part of a template section before its first table row, so the section keeps the template's own guidance.
function lead(section) {
  if (!section) return '';
  const out = [];
  for (const line of section.body.split('\n')) {
    const text = line.trim();
    if (text.startsWith('|') || text.startsWith('- ') || /^unknown$/i.test(text)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

const bullets = lines => lines.map(line => `- ${line}`).join('\n');

function audienceSections(data, template) {
  const generated = {};
  let any = false;
  const segments = data && data.segments || [];
  if (segments.length) {
    any = true;
    generated.segments = segments.map((seg, index) => ({
      heading: `Segment ${index + 1}: ${seg.name}`,
      body: bullets([
        `Who they are: ${seg.who}`,
        `What they are trying to do (job to be done): ${seg.goal || 'unknown'}`,
        `What they already believe: ${seg.beliefs || 'unknown'}`,
        `What they object to: ${seg.objections || 'unknown'}`,
        `Where they spend time (platforms, groups, creators): ${seg.platforms || 'unknown'}`,
        `Buying trigger (push away from the old, pull toward the new, habit that keeps them, anxiety about switching): ${seg.trigger || 'unknown'}`,
      ]),
    }));
  }
  const phrases = data && data.phrases || [];
  if (phrases.length) {
    any = true;
    generated['Verbatim customer language'] = [lead(template.get('Verbatim customer language')), table(['Phrase', 'Source', 'Segment'], phrases.map(item => [`"${cell(item.phrase)}"`, cell(sourceCell(item.source)), cell(item.segment, 'unknown')]))].filter(Boolean).join('\n\n');
  }
  const objections = data && data.objections || [];
  if (objections.length) {
    any = true;
    generated['Objections and answers'] = [lead(template.get('Objections and answers')), table(['Objection', 'Answer we can support', 'Proof'], objections.map(item => [cell(item.objection), cell(item.answer), cell(sourceCell(item.source), 'unknown')]))].filter(Boolean).join('\n\n');
  }
  const notFor = data && data.notFor || [];
  if (notFor.length) {
    any = true;
    generated['Not for'] = [lead(template.get('Not for')), bullets(notFor)].filter(Boolean).join('\n\n');
  }
  return { generated, research: any, profile: false };
}

function positioningSections(data, template, profile) {
  const generated = {};
  let any = false;
  if (data && data.line) { any = true; generated['One line'] = data.line; }
  if (data && data.category) { any = true; generated.Category = [lead(template.get('Category')), data.category].filter(Boolean).join('\n\n'); }
  if (data && data.offer) {
    any = true;
    generated['Offer and price'] = [lead(template.get('Offer and price')), data.offer + (data.offerSource ? ` Source: ${sourceCell(data.offerSource)}.` : '')].filter(Boolean).join('\n\n');
  }
  const proof = data && data.proof || [];
  if (proof.length) {
    any = true;
    generated['Proof points'] = [lead(template.get('Proof points')), table(['Proof', 'Source', 'Checked'], proof.map(item => [cell(item.claim), cell(item.source && item.source.url), cell(item.source && item.source.date)]))].filter(Boolean).join('\n\n');
  }
  const competitors = data && data.competitors || [];
  if (competitors.length) {
    any = true;
    generated['Competitors and the honest difference'] = table(['Competitor', 'What they say', 'Where we differ', 'Source'], competitors.map(item => [cell(item.name), cell(item.says, 'unknown'), cell(item.differs, 'unknown'), cell(sourceCell(item.source), 'unknown')]));
  }
  const switching = data && data.switching || {};
  if (['push', 'pull', 'habit', 'anxiety'].some(key => switching[key])) {
    any = true;
    generated['Switching forces'] = bullets([
      `Push (frustrations with the current way): ${switching.push || 'unknown'}`,
      `Pull (what attracts them to us): ${switching.pull || 'unknown'}`,
      `Habit (what keeps them where they are): ${switching.habit || 'unknown'}`,
      `Anxiety (what worries them about switching): ${switching.anxiety || 'unknown'}`,
    ]);
  }
  // What the person wrote, or research suggested from the brand's own pages, joins what this run found.
  const declared = typeof profile.forbiddenClaims === 'string' ? profile.forbiddenClaims.split(/\r?\n/).map(plain).filter(Boolean) : [];
  const found = (data && data.neverClaim) || [];
  const never = [...new Set([...declared, ...found])];
  let fromProfile = false;
  if (never.length) {
    if (found.length) any = true;
    else fromProfile = true;
    const suggested = profile.provenance && profile.provenance.researchFilled && profile.provenance.researchFilled.forbiddenClaims && profile.provenance.researchFilled.forbiddenClaims.suggested;
    generated['Claims we may never make'] = [lead(template.get('Claims we may never make')), bullets(never), suggested ? 'Lines taken from the brand\'s own pages by research have not been checked by the owner yet.' : ''].filter(Boolean).join('\n\n');
  }
  return { generated, research: any, profile: fromProfile };
}

// The section a run adds to the platform playbook for the videos it took apart. It is not in the template, so it is placed before the changelog.
const VIDEOS_HEADING = 'What the best videos do';

function videoRows(videos) {
  return videos.map(item => {
    const breakdown = item.breakdown || {};
    return [
      item.source === 'competitor' ? cell(item.competitor, 'competitor') : item.source === 'viral' ? 'viral in the niche' : 'the brand',
      cell(item.platform),
      cell(breakdown.format, 'unknown'),
      cell(breakdown.spokenHook, ''),
      cell(breakdown.onScreenHook, ''),
      Number.isFinite(breakdown.cutsPer10s) ? String(breakdown.cutsPer10s) : 'unknown',
      breakdown.presenter === true ? 'yes' : breakdown.presenter === false ? 'no' : 'unknown',
      cell(breakdown.sound, 'unknown'),
      cell(breakdown.cta, ''),
      cell(item.date ? `${item.url} (posted ${item.date})` : item.url),
    ];
  });
}

function videosSection(videos) {
  const lead = 'Seen in the videos themselves (their frames, cuts and sound), not guessed from the captions. Reference only: learn the pattern, never copy a video.';
  return {
    heading: VIDEOS_HEADING,
    body: [lead, table(['Whose', 'Platform', 'Format', 'Said', 'On screen', 'Cuts per 10 s', 'Presenter', 'Sound', 'Call to action', 'Source'], videoRows(videos))].join('\n\n'),
  };
}

function playbookSections(data, template, profile) {
  const generated = {};
  const extra = [];
  let any = false;
  let fromProfile = false;
  const videos = ((data && data.videos) || []).filter(item => item && item.breakdown);
  if (videos.length) {
    any = true;
    extra.push(videosSection(videos));
  }
  const pillars = Array.isArray(profile.contentPillars) ? profile.contentPillars.filter(item => typeof item === 'string' && item.trim()) : [];
  const purposes = new Map(((data && data.pillars) || []).map(item => [item.name.toLowerCase(), item.purpose]));
  if (pillars.length) {
    fromProfile = true;
    if (purposes.size) any = true;
    generated['Content pillars'] = [lead(template.get('Content pillars')), table(['Pillar', 'Purpose', 'Share'], pillars.map(name => [cell(name), cell(purposes.get(name.trim().toLowerCase()), 'unknown'), 'unknown']))].filter(Boolean).join('\n\n');
  }
  const cadence = (data && data.cadence) || [];
  if (cadence.length) {
    any = true;
    const byPlatform = new Map(cadence.map(item => [item.platform, item]));
    generated.Cadence = table(['Platform', 'Posts per week', 'Best days and times (zone)', 'Source'], ['facebook', 'instagram', 'tiktok'].map(name => {
      const item = byPlatform.get(name);
      return item ? [name, cell(item.postsPerWeek), '', cell(sourceCell(item.source))] : [name, 'unknown', '', ''];
    }));
  }
  const notes = (data && data.notes) || [];
  if (notes.length) {
    any = true;
    const byPlatform = new Map(notes.map(item => [item.platform, item]));
    generated['Per-platform notes'] = table(['Platform', 'Formats that suit this brand', 'Formats that do not', 'Notes'], ['facebook', 'instagram', 'tiktok'].map(name => {
      const item = byPlatform.get(name);
      return item ? [name, cell(item.suits), cell(item.doesNot), cell(item.notes)] : [name, '', '', ''];
    }));
  }
  // The pillars alone come from the profile; the file counts as filled from research only when research added to them.
  return { generated, research: any, profile: fromProfile, extra };
}

function sectionsFor(stem, data, template, profile) {
  if (stem === 'audience') return audienceSections(data, template);
  if (stem === 'positioning') return positioningSections(data, template, profile);
  return playbookSections(data, template, profile);
}

function frontText(fields) {
  return ['---', ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`), '---', ''].join('\n');
}

// The line at the top of a generated file: what it was filled from, or that research found nothing for it.
function noticeFor(stem, state, context) {
  const when = `${context.date} (run ${context.runId})`;
  if (state === 'research') {
    if (stem === 'platform-playbook') return `> Filled from the brand profile and brand onboarding research on ${when}. Anything that still says unknown was not found.`;
    return `> Filled from brand onboarding research on ${when}. Anything that still says unknown was not found. ${stem === 'audience' ? 'Customer phrases were' : 'Proof points were'} quoted from pages saved with the run.`;
  }
  if (state === 'profile') {
    return `> Not filled from research. Onboarding research on ${when} found nothing it could source for this file. The sections below come from the brand profile; the rest is the empty template.`;
  }
  return `> Not filled from research. Onboarding research on ${when} found nothing it could source for this file, so what follows is the empty template. Jobs treat this brand as having no sourced entries here yet.`;
}

/**
 * The text of one file. `data` is that file's part of the validated block (or null). Returns { text, body, filled, version }.
 * Exposed for tests; `write` is the caller everything else uses.
 */
function render(stem, data, context) {
  const template = templateText(stem)
    .replaceAll('{brand}', context.slug)
    .replaceAll('{Brand Name}', context.name)
    .replaceAll('YYYY-MM-DD', context.date);
  const split = parts(bodyOf(template));
  const byHeading = new Map(split.sections.map(item => [item.heading, item]));
  const built = sectionsFor(stem, data, byHeading, context.profile);
  const state = built.research ? 'research' : built.profile ? 'profile' : 'empty';
  const out = [];
  let placedSegments = false;
  for (const section of split.sections) {
    if (stem === 'audience' && /^Segment \d+:/.test(section.heading)) {
      if (built.generated.segments && !placedSegments) {
        for (const item of built.generated.segments) out.push(item);
        placedSegments = true;
      } else if (!built.generated.segments) out.push(section);
      continue;
    }
    if (section.heading === 'Changelog') continue;
    out.push(built.generated[section.heading] ? { heading: section.heading, body: built.generated[section.heading] } : section);
  }
  for (const section of built.extra || []) out.push(section);
  const version = (context.priorVersion || 0) + 1;
  const action = state === 'research'
    ? `${context.refresh ? 'refreshed' : 'created'} from onboarding research (run ${context.runId})`
    : `onboarding research found nothing to fill, ${state === 'profile' ? 'profile lines used' : 'template kept'} (run ${context.runId})`;
  const changelog = [...context.changelog, `- v${version} ${context.date} ${action}`];
  const body = [
    `# ${split.title}`,
    '',
    noticeFor(stem, state, context),
    '',
    split.intro,
    '',
    ...out.map(item => `## ${item.heading}\n\n${item.body}\n`),
    `## Changelog\n\n${changelog.join('\n')}\n`,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return { body, state, version };
}

function brandName(brandDir) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(brandDir, 'workspace.json'), 'utf8'));
    return plain(config.displayName || config.name || '') || path.basename(brandDir);
  } catch {
    return path.basename(brandDir);
  }
}

function writeOne(brandDir, stem, data, context) {
  const file = path.join(brandDir, 'brand', stem + '.md');
  let outcome = { status: 'unchanged', file };
  durable.update(file, raw => {
    const existing = normalized(raw);
    if (existing.trim() && !replaceable(existing, stem)) {
      outcome = { status: 'kept', file, reason: 'The file has been edited, so research left it as it is.' };
      return raw;
    }
    const built = render(stem, data, {
      ...context,
      priorVersion: existing.trim() ? versionOf(existing) : 0,
      refresh: Boolean(existing.trim()) && ownedHash(existing) !== null,
      changelog: existing.trim() ? changelogOf(existing) : [],
    });
    const fields = {
      brand: context.slug, file: stem, version: built.version,
      source: built.state === 'research' ? 'onboarding_research' : built.state === 'profile' ? 'profile' : 'template',
      research_run: context.runId, body_hash: hashOf(built.body), updated: context.date,
    };
    outcome = { status: built.state === 'research' ? 'written' : 'fallback', state: built.state, file, version: built.version };
    return frontText(fields) + '\n' + built.body;
  }, '');
  return outcome;
}

// ---------------------------------------------------------------- the lite-research gate
// A row counts when it carries a value and a source and neither is the placeholder. This is the one reading of the two
// tables; route-job.js uses it, so what is written here is exactly what the gate counts.
function countRows(file, headerMatch) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let inTable = false;
    let n = 0;
    for (const line of lines) {
      if (!inTable) { if (headerMatch.test(line)) inTable = true; continue; }
      // The first line that is not a table row ends the table. Reading on would count the
      // next table's header as a proof point on a brand whose own table is still empty.
      if (!line.trim().startsWith('|')) break;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!cells.length || cells.every(c => /^:?-+:?$/.test(c))) continue;
      const have = cells.filter(c => c && !/^unknown$/i.test(c));
      if (have.length >= 2) n++;
    }
    return n;
  } catch { return 0; }
}

/** { proofPoints, phrases, evidenceBearing } from brand/positioning.md and brand/audience.md. Three sourced proof points and one phrase open the lite gate. */
function evidenceGate(brandDir) {
  const proofPoints = countRows(path.join(brandDir, 'brand', 'positioning.md'), /^\s*\|\s*Proof\s*\|/i);
  const phrases = countRows(path.join(brandDir, 'brand', 'audience.md'), /^\s*\|\s*Phrase\s*\|/i);
  return { proofPoints, phrases, evidenceBearing: proofPoints >= 3 && phrases >= 1 };
}

// ---------------------------------------------------------------- brands onboarded before this existed
const FILES_REASON = 'Your brand files were never filled from research; refreshing them now';
const RESEARCH_REASON = 'Your saved research was made before the pages it read were kept with it; refreshing it now';

/** The files still exactly as the template was copied at brand creation, or missing: nothing has ever been written to them. */
function untouchedTemplates(brandDir) {
  return STEMS.filter(stem => {
    let raw = '';
    try { raw = fs.readFileSync(path.join(brandDir, 'brand', stem + '.md'), 'utf8'); } catch { return true; }
    if (!normalized(raw).trim()) return true;
    return ownedHash(raw) === null && canonical(raw) === canonical(templateText(stem));
  });
}

/**
 * Why a brand whose research looks current still needs one more onboarding run, in plain words, or null.
 * An untouched template file means research never filled it; a saved source with no capture means the research was
 * saved before pages were kept. A file research wrote (even one it found nothing for, which says so at its top) or one a person
 * edited does not count, so after one good run this answers null and the brand is skipped again.
 */
function upgradeReason(brandDir, record) {
  if (untouchedTemplates(brandDir).length) return FILES_REASON;
  const sources = record && Array.isArray(record.sources) ? record.sources : [];
  if (sources.some(source => !source || !source.captureRef)) return RESEARCH_REASON;
  return null;
}

/**
 * Write the three files from a validated `brandFiles` block (or none). `options`: { data, runId, now, videos }. `videos` are the checked
 * top posts that carry a `breakdown`; they add the "What the best videos do" section to the platform playbook.
 * Returns { files: { audience: { status }, ... }, proofPoints, phrases, evidenceBearing }.
 * status is written (filled from research), fallback (nothing sourced, template kept with a line saying so), kept (the file was
 * edited and is left alone) or unchanged.
 */
function write(brandDir, options = {}) {
  const profile = profiles.read(brandDir) || {};
  const now = options.now instanceof Date ? options.now : new Date();
  const context = {
    slug: path.basename(brandDir), name: brandName(brandDir), date: now.toISOString().slice(0, 10),
    runId: String(options.runId || 'unknown'), profile,
  };
  const data = options.data && typeof options.data === 'object' ? options.data : {};
  const videos = Array.isArray(options.videos) ? options.videos.filter(item => item && item.breakdown) : [];
  fs.mkdirSync(path.join(brandDir, 'brand'), { recursive: true });
  const files = {
    audience: writeOne(brandDir, 'audience', data.audience || null, context),
    positioning: writeOne(brandDir, 'positioning', data.positioning || null, context),
    'platform-playbook': writeOne(brandDir, 'platform-playbook', videos.length ? { ...(data.platforms || {}), videos } : data.platforms || null, context),
  };
  return { files, ...evidenceGate(brandDir) };
}

module.exports = {
  STEMS,
  PLATFORMS,
  validate,
  render,
  write,
  countRows,
  evidenceGate,
  untouchedTemplates,
  upgradeReason,
  FILES_REASON,
  RESEARCH_REASON,
};
