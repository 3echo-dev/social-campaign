const fs = require('fs');
const path = require('path');
const durable = require('./lib-durable.js');

const CHANNELS = Object.freeze(['website', 'facebook', 'instagram', 'tiktok']);
const SOCIAL_CHANNELS = new Set(CHANNELS.slice(1));
const UNAVAILABLE = /^(?:n\/?a|not[ _-]?available|unavailable|none|not[ _-]?applicable)$/i;
const MAX_PROFILE_BYTES = 40000;
const MAX_COMPETITORS = 3;
const COMPETITOR_ITEM_MAX = 500;
// The declared-context fields a brand onboarding research pass is allowed to fill in when blank.
const CONTEXT_FIELDS = Object.freeze(['audience', 'market', 'voice', 'contentPillars', 'competitors']);
// Every profile save, typed or research, is held to these limits: a brand's audience or
// positioning is a short brief, not a research dossier. This is the one place they are
// enforced, so nothing downstream (a job's own audience field among them) can inherit a
// value too long for it to accept.
const CONTEXT_TEXT_LIMITS = Object.freeze({ audience: 400, market: 400, voice: 300 });
const CONTENT_PILLAR_MIN = 1;
const CONTENT_PILLAR_MAX = 8;
const CONTENT_PILLAR_ITEM_MAX = 60;
// The signals that a context field still carries research notes rather than brand-facing
// copy: a link, a bare domain, an ISO date, or the words a research pass uses to cite itself.
const SOURCE_NOTE_PATTERNS = Object.freeze([
  /https?:\/\//i,
  /\bwww\./i,
  /\b[a-z0-9-]+\.(?:com|net|org|co|sg|io)(?:\.[a-z]{2})?\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\bfetched\b/i,
  /\bverbatim\b/i,
]);

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function unavailable(value) {
  return typeof value === 'string' && UNAVAILABLE.test(value.trim());
}

function officialHost(host, channelName) {
  const lower = String(host || '').toLowerCase().replace(/^www\./, '');
  return lower === channelName + '.com' || lower.endsWith('.' + channelName + '.com');
}

function normalizeChannel(value, name) {
  if (typeof value === 'object' && value !== null) {
    if (value.status === 'unavailable') return { status: 'unavailable' };
    if (value.status === 'provided') value = value.url;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(name + ' is required. Enter its URL or Not available.');
  }
  const text = value.trim();
  if (unavailable(text)) return { status: 'unavailable' };

  let url;
  try { url = new URL(text); } catch {
    throw new Error(name + ' needs a full https:// URL or Not available.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid ' + name + ' URL.');
  }
  if (SOCIAL_CHANNELS.has(name) && !officialHost(url.hostname, name)) {
    throw new Error('Use the official ' + name + ' profile URL.');
  }
  return { status: 'provided', url: url.href };
}

// Content pillars get their own check, not the shared normalizeList: they need a minimum
// count and a short per-item cap, with plain messages naming each limit.
function normalizeContentPillars(value) {
  if (!Array.isArray(value) || value.length < CONTENT_PILLAR_MIN || value.length > CONTENT_PILLAR_MAX ||
    value.some(v => typeof v !== 'string' || !v.trim())) {
    throw new Error('List ' + CONTENT_PILLAR_MIN + ' to ' + CONTENT_PILLAR_MAX + ' content pillars.');
  }
  for (const v of value) {
    if (v.trim().length > CONTENT_PILLAR_ITEM_MAX) {
      throw new Error('Keep each content pillar under ' + CONTENT_PILLAR_ITEM_MAX + ' characters.');
    }
  }
  return [...new Set(value.map(v => v.trim()))];
}

function hasSourceNotes(text) {
  return typeof text === 'string' && text.trim() !== '' && SOURCE_NOTE_PATTERNS.some(re => re.test(text));
}

function normalizeList(value, max, label, length = 500) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some(v =>
    typeof v !== 'string' || !v.trim() || v.length > length)) {
    throw new Error(label + ' is missing entries or exceeds its limit.');
  }
  return [...new Set(value.map(v => v.trim()))];
}

function normalizePalette(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error('Palette must contain at most 16 entries.');
  }
  return value.map(item => {
    if (typeof item === 'string') {
      const text = item.trim();
      if (!text || text.length > 120) throw new Error('Palette entries must be named or normalized colors.');
      if (/^(?:unknown|not[ _-]?known)$/i.test(text)) return 'unknown';
      if (/^#[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
      if (!/^[a-z][a-z0-9 ._/'-]{0,119}$/i.test(text)) {
        throw new Error('Use six-digit hex colors, a color name, or unknown.');
      }
      return text;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Palette entries must be named or normalized colors.');
    }
    const out = {};
    for (const key of ['role', 'name', 'value']) {
      if (item[key] !== undefined) {
        if (typeof item[key] !== 'string' || item[key].length > 120) throw new Error('Palette fields must be short text.');
        out[key] = item[key].trim();
      }
    }
    if (!out.value && !out.name && !out.role) throw new Error('Palette entries need a name, role, or value.');
    if (out.value && /^#[0-9a-f]{6}$/i.test(out.value)) out.value = out.value.toUpperCase();
    return out;
  });
}

function normalizeFonts(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error('Fonts must contain at most 8 entries.');
  return value.map(item => {
    if (typeof item === 'string') {
      if (!item.trim() || item.length > 120) throw new Error('Font entries must be short text.');
      return item.trim();
    }
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.family !== 'string' || !item.family.trim()) {
      throw new Error('Font entries need a family.');
    }
    const out = { family: item.family.trim() };
    if (item.weights !== undefined) {
      if (!Array.isArray(item.weights) || item.weights.length > 12 || item.weights.some(weight =>
        (typeof weight !== 'string' && typeof weight !== 'number') || String(weight).length > 20)) {
        throw new Error('Font weights must be a short list.');
      }
      out.weights = item.weights.map(weight => String(weight));
    }
    if (item.use !== undefined) out.use = normalizeText(item.use, 'Font use', 300);
    return out;
  });
}

function normalizeAssets(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('Brand assets must contain at most 100 references.');
  return value.map(asset => {
    if (typeof asset === 'string') {
      const uri = asset.trim();
      if (!uri || uri.length > 2000 || /(?:password|token|secret|api[_-]?key)=/i.test(uri)) {
        throw new Error('Brand assets need stable references without credentials.');
      }
      return uri;
    }
    if (!asset || typeof asset !== 'object' || Array.isArray(asset) || typeof asset.uri !== 'string' || !asset.uri.trim()) {
      throw new Error('Brand assets need stable references.');
    }
    const out = { uri: asset.uri.trim() };
    if (out.uri.length > 2000 || /(?:password|token|secret|api[_-]?key)=/i.test(out.uri)) {
      throw new Error('Brand assets need stable references without credentials.');
    }
    for (const key of ['kind', 'name', 'revision', 'source']) {
      if (asset[key] !== undefined) {
        if ((typeof asset[key] !== 'string' && typeof asset[key] !== 'number') || String(asset[key]).length > 300) {
          throw new Error('Brand asset metadata is too long.');
        }
        out[key] = asset[key];
      }
    }
    return out;
  });
}

function normalizeText(value, name, max = 6000) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw new Error('Keep ' + name + ' under ' + max + ' characters.');
  return value.trim();
}

function normalizeField(value, name) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (JSON.stringify(value).length > 6000) throw new Error('Keep ' + name + ' under 6000 characters.');
    return clone(value);
  }
  return normalizeText(value, name);
}

function inputValue(input, visual, key) {
  if (own(input, key)) return input[key];
  if (visual && own(visual, key)) return visual[key];
  return undefined;
}

function rawProfile(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'brand', 'profile.json'), 'utf8'));
  } catch { return null; }
}

function validRecord(record) {
  if (!record || (record.version !== 1 && record.version !== 2) || !record.completedAt || !record.channels) return false;
  try {
    for (const name of CHANNELS) {
      if (!record.channels[name]) return false;
      const value = record.channels[name];
      if (value.status === 'unavailable') continue;
      if (value.status !== 'provided' || normalizeChannel(value.url, name).status !== 'provided') return false;
    }
    if (record.competitors && !Array.isArray(record.competitors.items)) return false;
    return true;
  } catch { return false; }
}

function validate(input, existing) {
  const errors = [];
  const states = {};
  const source = input && input.channels && typeof input.channels === 'object' ? input.channels : input || {};
  for (const name of CHANNELS) {
    const value = own(source, name) ? source[name] : existing && existing.channels && existing.channels[name];
    if (value === undefined) {
      states[name] = 'unanswered';
      errors.push(name + ' is required. Enter its URL or Not available.');
      continue;
    }
    try {
      states[name] = normalizeChannel(value, name).status;
    } catch (error) {
      states[name] = 'unanswered';
      errors.push(error.message);
    }
  }
  return { valid: errors.length === 0, states, errors };
}

function prepareProfile(input, existing, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected brand profile fields.');
  if (input.channels !== undefined && (!input.channels || typeof input.channels !== 'object' || Array.isArray(input.channels))) {
    throw new Error('Brand channels must be an object.');
  }
  if (input.visualIdentity !== undefined && (!input.visualIdentity || typeof input.visualIdentity !== 'object' || Array.isArray(input.visualIdentity))) {
    throw new Error('Brand visual identity must be an object.');
  }
  const channelsInput = input.channels && typeof input.channels === 'object' ? input.channels : input;
  const visualInput = input.visualIdentity && typeof input.visualIdentity === 'object' ? input.visualIdentity : {};
  const channels = {};
  for (const name of CHANNELS) {
    if (options.requireChannels && !own(channelsInput, name)) {
      throw new Error(name + ' is required. Enter its URL or Not available.');
    }
    let value;
    if (own(channelsInput, name)) value = channelsInput[name];
    else if (existing && existing.channels && existing.channels[name]) value = existing.channels[name];
    else value = undefined;
    channels[name] = normalizeChannel(value, name);
  }

  let competitorsValue = inputValue(input, null, 'competitors');
  if (competitorsValue === undefined && existing) competitorsValue = existing.competitors.items;
  if (competitorsValue && typeof competitorsValue === 'object' && !Array.isArray(competitorsValue)) {
    if (!Array.isArray(competitorsValue.items)) throw new Error('Competitors must be a list.');
    competitorsValue = competitorsValue.items;
  }
  if (Array.isArray(competitorsValue) && competitorsValue.length > MAX_COMPETITORS) {
    throw new Error('List at most 3 competitors.');
  }
  const competitors = normalizeList(competitorsValue, MAX_COMPETITORS, 'Competitors', COMPETITOR_ITEM_MAX);
  const paletteInput = inputValue(input, visualInput, 'palette');
  const palette = paletteInput === undefined ? previousValue(existing && existing.visualIdentity, 'palette', []) : normalizePalette(paletteInput);
  const fontsInput = inputValue(input, visualInput, 'fonts');
  const fonts = fontsInput === undefined ? previousValue(existing && existing.visualIdentity, 'fonts', []) : normalizeFonts(fontsInput);
  const assetsInput = own(input, 'assets') ? input.assets : own(input, 'brandAssets') ? input.brandAssets : undefined;
  const assets = assetsInput === undefined ? previousValue(existing, 'assets', []) : normalizeAssets(assetsInput);
  const fields = {};
  for (const key of ['voice', 'strategy', 'market', 'audience', 'geography', 'language', 'customerSegment', 'voiceGuidance', 'terminology', 'examples', 'forbiddenClaims']) {
    const value = inputValue(input, null, key);
    if (value === undefined) { fields[key] = previousValue(existing, key, ''); continue; }
    // An existing over-limit value keeps loading untouched (see the `undefined` branch
    // above); only a save that actually sets this field is held to the limit.
    const limit = CONTEXT_TEXT_LIMITS[key];
    fields[key] = limit ? normalizeText(value, 'the ' + key, limit) : normalizeField(value, key);
  }
  const pillarsInput = inputValue(input, null, 'contentPillars');
  const contentPillars = pillarsInput === undefined
    ? previousValue(existing, 'contentPillars', [])
    : normalizeContentPillars(pillarsInput);
  const sourceRefs = own(input, 'sourceRefs')
    ? normalizeList(input.sourceRefs, 100, 'Source references', 2000)
    : previousValue(existing && existing.provenance, 'sourceRefs', []);
  const provenanceInput = input.provenance && typeof input.provenance === 'object' && !Array.isArray(input.provenance)
    ? clone(input.provenance)
    : {};
  return { channels, competitors, palette, fonts, assets, fields, contentPillars, sourceRefs, provenanceInput };
}

function sameCompetitorItems(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
}

// A save that leaves competitors untouched (or resubmits the same list) must not relabel a
// research-filled shortlist as declared; only an actual change in the items re-derives the source.
function competitorsSource(prepared, existing) {
  const previous = existing && existing.competitors;
  if (previous && previous.source && sameCompetitorItems(previous.items, prepared.competitors)) return previous.source;
  return prepared.competitors.length ? 'declared' : 'research';
}

function withoutStaleSuggestions(provenance, existing, fields) {
  const filled = provenance.researchFilled;
  if (!filled || typeof filled !== 'object' || !existing) return provenance;
  const next = { ...filled };
  for (const name of ['audience', 'market', 'voice']) {
    if (!next[name] || !next[name].suggested || existing[name] === fields[name]) continue;
    const { suggested, ...kept } = next[name];
    next[name] = kept;
  }
  return { ...provenance, researchFilled: next };
}

function withoutSuggestions(provenance) {
  const filled = provenance.researchFilled;
  if (!filled || typeof filled !== 'object') return provenance;
  const next = {};
  for (const [name, entry] of Object.entries(filled)) {
    const { suggested, ...kept } = entry || {};
    next[name] = kept;
  }
  return { ...provenance, researchFilled: next };
}

function buildProfileRecord(prepared, existing, revision, completedAt, options = {}) {
  const built = withoutStaleSuggestions({
    ...previousValue(existing, 'provenance', {}),
    ...clone(prepared.provenanceInput),
    sourceRefs: prepared.sourceRefs,
    revision,
    updatedAt: completedAt,
  }, existing, prepared.fields);
  const provenance = options.acknowledgeSuggestions ? withoutSuggestions(built) : built;
  return {
    version: 1,
    kind: 'declared_profile',
    revision,
    completedAt,
    channels: prepared.channels,
    competitors: { source: competitorsSource(prepared, existing), items: prepared.competitors },
    visualIdentity: { palette: prepared.palette, fonts: prepared.fonts },
    assets: prepared.assets,
    brandAssets: prepared.assets,
    voice: prepared.fields.voice,
    voiceGuidance: prepared.fields.voiceGuidance || prepared.fields.voice,
    terminology: prepared.fields.terminology,
    examples: prepared.fields.examples,
    forbiddenClaims: prepared.fields.forbiddenClaims,
    strategy: prepared.fields.strategy,
    market: prepared.fields.market,
    audience: prepared.fields.audience,
    geography: prepared.fields.geography,
    language: prepared.fields.language,
    customerSegment: prepared.fields.customerSegment,
    contentPillars: prepared.contentPillars,
    provenance,
    researchPolicy: {
      skipAccountDiscovery: CHANNELS.filter(name => prepared.channels[name].status === 'unavailable'),
      discoverCompetitors: !prepared.competitors.length,
    },
  };
}

/**
 * Validate every field that save() normalizes without touching the filesystem.
 * This is used by request handlers that must reject a bad submission before
 * creating a brand directory.
 */
function validateComplete(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['Expected brand profile fields.'] };
  }
  const errors = validate(input).errors;
  if (input.provenance !== undefined && (!input.provenance || typeof input.provenance !== 'object' || Array.isArray(input.provenance))) {
    errors.push('Brand provenance must be an object.');
  }
  let prepared = null;
  try {
    prepared = prepareProfile(input, existing, { requireChannels: true });
  } catch (error) {
    errors.push(error.message);
  }
  if (prepared) {
    const candidate = buildProfileRecord(
      prepared,
      existing,
      (Number(existing && existing.revision) || 0) + 1,
      new Date().toISOString(),
    );
    if (Buffer.byteLength(JSON.stringify(candidate) + '\n', 'utf8') > MAX_PROFILE_BYTES) {
      errors.push('Keep the brand profile under 40 KB.');
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function read(dir) {
  const record = rawProfile(dir);
  return validRecord(record) ? record : null;
}

function previousValue(previous, key, fallback) {
  return previous && previous[key] !== undefined ? clone(previous[key]) : fallback;
}

function save(dir, input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected brand profile fields.');
  const existing = read(dir);
  const prepared = prepareProfile(input, existing, { requireChannels: options.requireChannels });

  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();
  let record;
  const file = path.join(dir, 'brand', 'profile.json');
  durable.update(file, raw => {
    let diskPrevious;
    try { diskPrevious = JSON.parse(raw); } catch { diskPrevious = existing; }
    const previous = validRecord(diskPrevious) ? diskPrevious : existing;
    const revision = (Number(previous && previous.revision) || 0) + 1;
    record = buildProfileRecord(prepared, previous, revision, nowIso, { acknowledgeSuggestions: options.acknowledgeSuggestions });
    const text = JSON.stringify(record, null, 2) + '\n';
    if (Buffer.byteLength(text, 'utf8') > MAX_PROFILE_BYTES) throw new Error('Keep the brand profile under 40 KB.');
    return text;
  });
  return record;
}

function channelState(record) {
  const profile = record || {};
  return Object.fromEntries(CHANNELS.map(name => [name, profile.channels && profile.channels[name]
    ? profile.channels[name].status : 'unanswered']));
}

function context(dirOrProfile, options = {}) {
  const profile = typeof dirOrProfile === 'string' ? read(dirOrProfile) : dirOrProfile;
  if (!profile) return null;
  const out = {
    revision: profile.revision,
    channels: clone(profile.channels),
    channelState: channelState(profile),
    competitors: clone(profile.competitors),
    market: profile.market || '',
    audience: profile.audience || profile.market || '',
    geography: profile.geography || '',
    language: profile.language || '',
    customerSegment: profile.customerSegment || '',
    visualIdentity: clone(profile.visualIdentity || {}),
    voice: profile.voice || '',
    voiceGuidance: profile.voiceGuidance || profile.voice || '',
    terminology: profile.terminology || '',
    examples: profile.examples || '',
    forbiddenClaims: profile.forbiddenClaims || '',
    strategy: profile.strategy || '',
    contentPillars: clone(profile.contentPillars || []),
    assets: clone(profile.assets || profile.brandAssets || []),
    researchPolicy: clone(profile.researchPolicy || {}),
  };
  if (options.includeProvenance) out.provenance = clone(profile.provenance || {});
  return out;
}

// Strings are blank once trimmed empty; contentPillars and competitors are blank once empty.
function blankContextFields(profile) {
  const fields = [];
  for (const name of CONTEXT_FIELDS) {
    if (name === 'competitors') {
      const items = profile && profile.competitors && Array.isArray(profile.competitors.items) ? profile.competitors.items : [];
      if (!items.length) fields.push(name);
      continue;
    }
    if (name === 'contentPillars') {
      const items = profile && Array.isArray(profile.contentPillars) ? profile.contentPillars : [];
      if (!items.length) fields.push(name);
      continue;
    }
    const value = profile && profile[name];
    if (typeof value !== 'string' || !value.trim()) fields.push(name);
  }
  return fields;
}

// A field's text, for the checks below: a context field's string value, or its list items
// joined so a source-note pattern can be found in any one of them.
function tidyFieldText(profile, name) {
  if (name === 'competitors') {
    const items = profile && profile.competitors && Array.isArray(profile.competitors.items) ? profile.competitors.items : [];
    return items.join(' ');
  }
  if (name === 'contentPillars') {
    const items = profile && Array.isArray(profile.contentPillars) ? profile.contentPillars : [];
    return items.join(' ');
  }
  const value = profile && profile[name];
  return typeof value === 'string' ? value : '';
}

function tidyFieldTooLong(profile, name) {
  const limit = CONTEXT_TEXT_LIMITS[name];
  if (limit) {
    const value = profile && profile[name];
    return typeof value === 'string' && value.length > limit;
  }
  if (name === 'contentPillars') {
    const items = profile && Array.isArray(profile.contentPillars) ? profile.contentPillars : [];
    return items.length > 0 && (items.length > CONTENT_PILLAR_MAX ||
      items.some(item => typeof item === 'string' && item.length > CONTENT_PILLAR_ITEM_MAX));
  }
  if (name === 'competitors') {
    const items = profile && profile.competitors && Array.isArray(profile.competitors.items) ? profile.competitors.items : [];
    return items.length > MAX_COMPETITORS;
  }
  return false;
}

/**
 * One entry per context field that a person should look at before it causes a save to be
 * refused elsewhere: a field over its own limit, or one that still reads like a research
 * note (a link, a bare domain, an ISO date, "fetched" or "verbatim") rather than brand copy.
 * A field that is blank or already within its limits is left out. Read-only: never writes.
 */
function profileTidyReport(profile) {
  if (!profile || typeof profile !== 'object') return [];
  const researchFilled = (profile.provenance && profile.provenance.researchFilled) || {};
  const out = [];
  for (const name of CONTEXT_FIELDS) {
    const text = tidyFieldText(profile, name);
    if (!text.trim()) continue;
    const tooLong = tidyFieldTooLong(profile, name);
    const sourceNotes = hasSourceNotes(text);
    if (!tooLong && !sourceNotes) continue;
    out.push({
      field: name,
      reason: tooLong ? 'too_long' : 'has_source_notes',
      researchFilled: Boolean(researchFilled[name]),
    });
  }
  return out;
}

function fillIsEmpty(name, value) {
  if (value === undefined || value === null) return true;
  if (name === 'contentPillars' || name === 'competitors') return !Array.isArray(value) || value.length === 0;
  return typeof value !== 'string' || !value.trim();
}

/**
 * Fill only the declared-context fields still blank on disk, with values a research pass
 * proposes. Runs inside one durable.update on profile.json: blanks are recomputed from the file
 * under the lock, never from a caller's stale copy, so a concurrent declared save cannot race it.
 * A field the brand already typed is left untouched and reported in `kept`, never overwritten.
 * Nothing to fill returns the unchanged profile with no revision bump.
 */
function fillBlankContext(dir, fills, options = {}) {
  const file = path.join(dir, 'brand', 'profile.json');
  const now = options.now instanceof Date ? options.now : options.now ? new Date(options.now) : new Date();
  const nowIso = now.toISOString();
  const runId = options.runId;
  const suggested = new Set(Array.isArray(options.suggested) ? options.suggested : []);
  const source = fills && typeof fills === 'object' ? fills : {};
  let result;
  durable.update(file, raw => {
    let diskRecord;
    try { diskRecord = JSON.parse(raw); } catch { diskRecord = null; }
    const existing = validRecord(diskRecord) ? diskRecord : null;
    if (!existing) throw new Error('Complete the required brand profile before research.');
    const blanks = new Set(blankContextFields(existing));
    const filled = [];
    const kept = [];
    const input = {};
    for (const name of CONTEXT_FIELDS) {
      if (!own(source, name)) continue;
      if (!blanks.has(name)) { kept.push(name); continue; }
      if (fillIsEmpty(name, source[name])) continue;
      input[name] = source[name];
      filled.push(name);
    }
    if (!filled.length) {
      result = { profile: existing, filled: [], kept };
      return raw;
    }
    const prepared = prepareProfile(input, existing, {});
    const revision = (Number(existing.revision) || 0) + 1;
    const record = buildProfileRecord(prepared, existing, revision, nowIso);
    if (filled.includes('competitors')) {
      record.competitors = { ...record.competitors, source: 'research' };
    }
    const researchFilled = { ...(record.provenance.researchFilled || {}) };
    for (const name of filled) researchFilled[name] = { runId, at: nowIso, ...(suggested.has(name) ? { suggested: true } : {}) };
    record.provenance = { ...record.provenance, researchFilled };
    const text = JSON.stringify(record, null, 2) + '\n';
    if (Buffer.byteLength(text, 'utf8') > MAX_PROFILE_BYTES) throw new Error('Keep the brand profile under 40 KB.');
    result = { profile: record, filled, kept };
    return text;
  });
  return result;
}

module.exports = {
  CHANNELS,
  MAX_PROFILE_BYTES,
  MAX_COMPETITORS,
  COMPETITOR_ITEM_MAX,
  CONTEXT_FIELDS,
  CONTEXT_TEXT_LIMITS,
  CONTENT_PILLAR_MIN,
  CONTENT_PILLAR_MAX,
  CONTENT_PILLAR_ITEM_MAX,
  channel: normalizeChannel,
  normalizeChannel,
  normalizePalette,
  normalizeFonts,
  read,
  save,
  validRecord,
  validate,
  validateComplete,
  channelState,
  context,
  buildProfileContext: context,
  taskContext: context,
  blankContextFields,
  fillBlankContext,
  profileTidyReport,
};
