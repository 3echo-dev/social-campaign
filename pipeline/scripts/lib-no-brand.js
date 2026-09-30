'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NO_BRAND } = require('./lib-kinds.js');

const NAME = 'No brand';

function isGeneral(value) {
  if (typeof value === 'string') return value.trim().toLowerCase() === NO_BRAND;
  if (!value || typeof value !== 'object') return false;
  if (value.general === true || (value.config && value.config.general === true)) return true;
  return isGeneral(value.slug);
}

function workspaceRecord(now = new Date()) {
  return {
    schemaVersion: '1.0',
    brandId: crypto.randomUUID(),
    brand: NO_BRAND,
    name: NAME,
    general: true,
    status: 'active',
    onboarding: { status: 'not_needed' },
    created: now.toISOString().slice(0, 10),
  };
}

function ensure(brandsDir, now = new Date()) {
  const dir = path.join(brandsDir, NO_BRAND);
  const file = path.join(dir, 'workspace.json');
  fs.mkdirSync(path.join(dir, 'jobs'), { recursive: true });
  if (fs.existsSync(file)) return { dir, created: false };
  const temp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temp, `${JSON.stringify(workspaceRecord(now), null, 2)}\n`, 'utf8');
  try {
    fs.linkSync(temp, file);
    return { dir, created: true };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { dir, created: false };
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

module.exports = { NO_BRAND, NAME, isGeneral, workspaceRecord, ensure };
