import { join } from 'node:path';

import { readJsonFile, writeJsonFile } from '../lib/json.mjs';
import * as runtime from './runtime.mjs';

const FILE_NAME = 'studio-workspace.json';
const WORKSPACES_FILE_NAME = 'studio-workspaces.json';

function filePathFor(dir) {
  return join(dir, FILE_NAME);
}

function readChoice(dir) {
  if (typeof dir !== 'string' || dir.trim().length === 0) return null;
  const record = readJsonFile(filePathFor(dir), null);
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId.trim() : '';
  if (!workspaceId) return null;
  const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : null;
  return { workspaceId, name };
}

function writeChoice(dir, { workspaceId, name }) {
  if (typeof dir !== 'string' || dir.trim().length === 0) throw new Error('A folder is required to save the studio workspace choice.');
  const trimmedId = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (!trimmedId) throw new Error('workspaceId is required to save the studio workspace choice.');
  const record = {
    workspaceId: trimmedId,
    name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : null,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(filePathFor(dir), record);
  return { workspaceId: record.workspaceId, name: record.name };
}

export function readStudioWorkspaceChoice({ brandDir = null, jobDir = null } = {}) {
  const job = readChoice(jobDir);
  if (job) return { workspaceId: job.workspaceId, name: job.name, source: 'job' };
  const brand = readChoice(brandDir);
  if (brand) return { workspaceId: brand.workspaceId, name: brand.name, source: 'brand' };
  return { workspaceId: null, name: null, source: null };
}

export function saveBrandStudioWorkspace(brandDir, { workspaceId, name = null } = {}) {
  return writeChoice(brandDir, { workspaceId, name });
}

export function saveJobStudioWorkspace(jobDir, { workspaceId, name = null } = {}) {
  return writeChoice(jobDir, { workspaceId, name });
}

function workspaceListPath(root) {
  return join(root, '.social-pipeline', 'board', WORKSPACES_FILE_NAME);
}

function cleanWorkspaceEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id) return null;
  const name = typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : id;
  const creditAvailable = Number.isFinite(Number(entry.creditAvailable)) ? Number(entry.creditAvailable) : null;
  return { id, name, creditAvailable };
}

export function saveStudioWorkspaceList(root, workspaces) {
  if (typeof root !== 'string' || root.trim().length === 0) throw new Error('A workspace root is required to save the Studio workspace list.');
  const list = Array.isArray(workspaces) ? workspaces.map(cleanWorkspaceEntry).filter(Boolean) : [];
  if (!list.length) throw new Error('At least one Studio workspace is required.');
  const record = { workspaces: list, updatedAt: new Date().toISOString() };
  writeJsonFile(workspaceListPath(root), record);
  return record;
}

export function readStudioWorkspaceList(root) {
  if (typeof root !== 'string' || root.trim().length === 0) return [];
  const record = readJsonFile(workspaceListPath(root), null);
  if (!record || typeof record !== 'object' || !Array.isArray(record.workspaces)) return [];
  return record.workspaces.map(cleanWorkspaceEntry).filter(Boolean);
}

export function studioWorkspaceInfo({ root, brandDir = null, jobDir = null } = {}) {
  const choice = readStudioWorkspaceChoice({ brandDir, jobDir });
  const workspaces = readStudioWorkspaceList(root);
  const match = choice.workspaceId ? workspaces.find(item => item.id === choice.workspaceId) : null;
  return {
    workspaceId: choice.workspaceId,
    name: match ? match.name : choice.name,
    source: choice.source,
    creditAvailable: match ? match.creditAvailable : null,
    workspaces,
  };
}

function resolveBrandDir(root, brand) {
  const value = String(brand || '').trim();
  if (!value) throw new Error('Say which brand this is for.');
  const entry = runtime.listBrands({ root }).find(item => item.slug === value || item.id === value || item.brandId === value);
  if (!entry) throw new Error('This brand could not be found.');
  return entry.path;
}

function resolveJobDir(root, brand, jobId) {
  const id = String(jobId || '').trim();
  if (!id) return null;
  const job = runtime.listJobs({ root, brand }).find(item => item.jobId === id);
  if (!job) throw new Error('This job could not be found.');
  return job.path;
}

export function chooseStudioWorkspace({ root, brand, jobId = null, workspaceId }) {
  const brandDir = resolveBrandDir(root, brand);
  const list = readStudioWorkspaceList(root);
  const match = list.find(item => item.id === String(workspaceId || '').trim());
  if (!match) throw new Error('This is not one of the saved Studio workspaces.');
  const id = String(jobId || '').trim();
  if (id) {
    const jobDir = resolveJobDir(root, brand, id);
    return { scope: 'job', jobId: id, ...saveJobStudioWorkspace(jobDir, { workspaceId: match.id, name: match.name }) };
  }
  return { scope: 'brand', ...saveBrandStudioWorkspace(brandDir, { workspaceId: match.id, name: match.name }) };
}

export function getStudioWorkspace({ root, brand, jobId = null }) {
  const brandDir = resolveBrandDir(root, brand);
  const id = String(jobId || '').trim();
  const jobDir = id ? resolveJobDir(root, brand, id) : null;
  return studioWorkspaceInfo({ root, brandDir, jobDir });
}
