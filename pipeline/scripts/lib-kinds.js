'use strict';

const fs = require('fs');
const path = require('path');

const REGISTRY_FILE = path.join(__dirname, '..', 'registry', 'kinds.json');
const VIDEO_HOST = /youtu|tiktok|instagram|facebook|fb\.watch|vimeo/i;
const SOURCE_NEEDS = Object.freeze({
  link_or_file: 'sourceRefs (at least one link or file)',
  video: 'sourceRefs (one video)',
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

function sourceLink(ref) {
  if (!ref || typeof ref !== 'object') return '';
  return String(ref.uri || ref.url || '').trim();
}

function isVideoSource(ref) {
  if (!ref || typeof ref !== 'object') return false;
  if (ref.mediaType === 'video') return true;
  return (ref.mediaType === 'url' || !ref.mediaType) && VIDEO_HOST.test(sourceLink(ref));
}

function missingSources(kind, refs) {
  const need = requirementsOf(kind).requiredSources;
  const list = Array.isArray(refs) ? refs : [];
  if (need === 'link_or_file' && !list.some(ref => sourceLink(ref))) return [SOURCE_NEEDS.link_or_file];
  if (need === 'video' && !list.some(isVideoSource)) return [SOURCE_NEEDS.video];
  return [];
}

function missingFields(job) {
  const record = job && typeof job === 'object' ? job : {};
  const fields = requirementsOf(record.kind).requiredFields || [];
  const absent = fields.filter(field => !(field in record) || record[field] === undefined);
  return absent.concat(missingSources(record.kind, record.sourceRefs));
}

module.exports = {
  NO_BRAND,
  SOURCE_NEEDS,
  registry,
  normalizedKind,
  kindOf,
  requirementsOf,
  kindIds,
  activeKindIds,
  makesContent,
  brandRequired,
  needsProductPhoto,
  sourceLink,
  isVideoSource,
  missingSources,
  missingFields,
};
