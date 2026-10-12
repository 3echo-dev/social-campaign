'use strict';

const fs = require('fs');
const path = require('path');

const REGISTRY_FILE = path.join(__dirname, '..', 'registry', 'kinds.json');
const VIDEO_HOST = /youtu|tiktok|instagram|facebook|fb\.watch|vimeo/i;
const SOURCE_NEEDS = Object.freeze({
  link_or_file: 'sourceRefs (at least one link or file)',
  video: 'sourceRefs (one video)',
  // Said to the person as it stands, so it names no field: the board shows a need that carries a
  // field-shaped word as just that word.
  supplied_media: 'the picture or video to post (give Claude the files in chat)',
});

let loaded = null;

function registry() {
  if (!loaded) loaded = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  return loaded;
}

const NO_BRAND = registry().noBrand;

function normalizedKind(kind) {
  return String(kind || '').trim().toLowerCase().replace(/-/g, '_');
}

function kindOf(kind) {
  const id = normalizedKind(kind);
  const kinds = registry().kinds;
  return id && Object.prototype.hasOwnProperty.call(kinds, id) ? { kind: id, ...kinds[id] } : null;
}

function requirementsOf(kind) {
  return kindOf(kind) || { kind: null, status: null, workflowId: null, owner: null, ...registry().unknownKind };
}

function kindIds() {
  return Object.keys(registry().kinds);
}

function activeKindIds() {
  return kindIds().filter(id => registry().kinds[id].status === 'active');
}

const makesContent = kind => requirementsOf(kind).makesContent === true;
const brandRequired = kind => requirementsOf(kind).brandRequired !== false;
const needsProductPhoto = kind => requirementsOf(kind).productPhoto === 'when_media';
// A kind whose pictures or video the person already has: the plugin copies the files into the job
// (suppliedMedia) instead of making them, so the creative stages, research and the label check do not run.
const suppliesMedia = kind => requirementsOf(kind).suppliedMedia === true;

function sourceLink(ref) {
  if (!ref || typeof ref !== 'object') return '';
  return String(ref.uri || ref.url || '').trim();
}

function isVideoSource(ref) {
  if (!ref || typeof ref !== 'object') return false;
  if (ref.mediaType === 'video') return true;
  return (ref.mediaType === 'url' || !ref.mediaType) && VIDEO_HOST.test(sourceLink(ref));
}

// A video saved on the job as a reference (a link downloaded, a file uploaded on the board) lives in
// <job>/inputs/references/manifest.json, not in sourceRefs. It sets the format of the new content just
// as a pasted link does, so the router and the planner both count it.
function hasSavedReferenceVideo(jobDir) {
  if (!jobDir) return false;
  let entries = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(jobDir, 'inputs', 'references', 'manifest.json'), 'utf8'));
    if (parsed && Array.isArray(parsed.entries)) entries = parsed.entries;
  } catch { return false; }
  return entries.some(entry => entry && typeof entry === 'object' && !/\.json$/i.test(String(entry.path || ''))
    && (entry.type === 'video' || (entry.kind === 'video' && Boolean(entry.sourceUrl || entry.platform))));
}

// Facebook is the one platform that posts words alone, so a Facebook-only job with a caption needs no file.
function wordsOnlyPost(job) {
  const record = job && typeof job === 'object' ? job : {};
  const platforms = Array.isArray(record.platforms) && record.platforms.length
    ? record.platforms
    : (Array.isArray(record.deliverables) ? record.deliverables.map(d => d && d.platform) : []);
  return platforms.length > 0 && platforms.every(p => p === 'facebook')
    && typeof record.caption === 'string' && record.caption.trim().length > 0;
}

function missingSources(kind, refs, job) {
  const need = requirementsOf(kind).requiredSources;
  const list = Array.isArray(refs) ? refs : [];
  if (need === 'supplied_media') {
    const files = job && Array.isArray(job.suppliedMedia) ? job.suppliedMedia : [];
    return files.length || wordsOnlyPost(job) ? [] : [SOURCE_NEEDS.supplied_media];
  }
  if (need === 'link_or_file' && !list.some(ref => sourceLink(ref))) return [SOURCE_NEEDS.link_or_file];
  if (need === 'video' && !list.some(isVideoSource)) return [SOURCE_NEEDS.video];
  return [];
}

// What the content is about. A reference video or a brand profile only sets the format and the voice,
// so the person names the topic. A job from before this field kept its message in `offer`, which also counts.
const TOPIC_QUESTION = 'What should this post be about: a product, a service, an offer or a message?';
const hasText = value => typeof value === 'string' && value.trim().length > 0;

function missingFields(job) {
  const record = job && typeof job === 'object' ? job : {};
  const fields = requirementsOf(record.kind).requiredFields || [];
  const absent = fields
    .filter(field => field === 'topic'
      ? !hasText(record.topic) && !hasText(record.offer)
      : !(field in record) || record[field] === undefined)
    .map(field => (field === 'topic' ? TOPIC_QUESTION : field));
  return absent.concat(missingSources(record.kind, record.sourceRefs, record));
}

module.exports = {
  NO_BRAND,
  SOURCE_NEEDS,
  TOPIC_QUESTION,
  registry,
  normalizedKind,
  kindOf,
  requirementsOf,
  kindIds,
  activeKindIds,
  makesContent,
  brandRequired,
  needsProductPhoto,
  suppliesMedia,
  sourceLink,
  isVideoSource,
  hasSavedReferenceVideo,
  missingSources,
  missingFields,
};
