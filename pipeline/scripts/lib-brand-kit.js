// Brand kit gate: logo, colour palette and fonts captured or provided during onboarding,
// reviewed on the board, then confirmed into brand/profile.json and brand/brand-voice.md.
// See docs/BRAND-KIT-SPEC.md sections 1-7.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const durable = require('./lib-durable.js');
const svgSanitize = require('./lib-svg-sanitize.js');

const LIMITS = Object.freeze({
  logoUploadBytes: 40 * 1024,
  logoThumbBytes: 6 * 1024,
  // Shared by website capture and the board's asset-store upload path (kit.logo
  // {action:'file'}): both hand the server a bigger, un-downscaled-for-chat file
  // read straight off disk, rather than the small inline base64 the board also
  // downscales client-side for the 'upload' action above.
  captureLogoBytes: 256 * 1024,
  logoFileThumbBytes: 64 * 1024,
  paletteMax: 8,
  proposedPaletteMax: 6,
  fontsMax: 4,
  logoCandidatesMax: 3,
  thumbProjectionBytes: 12 * 1024,
  svgThumbProjectionBytes: 24 * 1024,
  captureRetainCount: 3,
  captureRunningMs: 10 * 60 * 1000,
  pendingWaitingMs: 10 * 60 * 1000,
  colorNameMax: 60,
});

const ROLES = Object.freeze(['primary', 'secondary', 'accent', 'background', 'text', 'other']);
const FONT_USES = Object.freeze(['headings', 'body', 'captions', 'other']);
const CAPTURE_ID = /^cap-\d{8}T\d{6}Z-[a-f0-9]{6}$/;
const CANDIDATE_ID = /^c[1-3]$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ._'-]{0,79}$/;
const MIME_EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };
const MARK_ROWS = ['logo', 'primary', 'secondary', 'accent', 'subtitle_font'];

function kitFile(brandDir) {
  return path.join(brandDir, 'brand', 'brand-kit.json');
}

function assetsDir(brandDir) {
  return path.join(brandDir, 'brand', 'assets');
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  return new Date().toISOString();
}

function defaultRecord(brandDir, nowIso) {
  return {
    version: 1,
    brand: path.basename(brandDir),
    status: 'pending',
    pendingSince: nowIso,
    kitRevision: 0,
    provided: null,
    confirmed: null,
    proposed: null,
    capture: { status: 'not_started', captureId: null, url: null, startedAt: null, finishedAt: null, code: null, reason: null },
  };
}

function read(brandDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(kitFile(brandDir), 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.version === 1) return parsed;
    return null;
  } catch {
    return null;
  }
}

function status(brandDir) {
  const record = read(brandDir);
  if (!record) return 'legacy';
  return record.status === 'pending' || record.status === 'confirmed' || record.status === 'open' ? record.status : 'legacy';
}

function ensurePending(brandDir, options = {}) {
  const nowIso = toIso(options.now);
  const file = kitFile(brandDir);
  let record;
  durable.update(file, (raw) => {
    let existing = null;
    try { existing = JSON.parse(raw); } catch { /* not written yet */ }
    if (existing && existing.version === 1) {
      record = existing;
      return raw;
    }
    record = defaultRecord(brandDir, nowIso);
    return JSON.stringify(record, null, 2) + '\n';
  }, '');
  return record;
}

function newCaptureId(now) {
  const d = now instanceof Date ? now : new Date();
  const stamp = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `cap-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function beginCapture(brandDir, options = {}) {
  const nowIso = toIso(options.now);
  const nowMs = new Date(nowIso).getTime();
  const file = kitFile(brandDir);
  let started = false;
  let record;
  durable.update(file, (raw) => {
    let existing = null;
    try { existing = JSON.parse(raw); } catch { /* not written yet */ }
    if (!existing || existing.version !== 1) existing = defaultRecord(brandDir, nowIso);
    const capture = existing.capture || {};
    if (capture.status === 'running' && capture.startedAt) {
      const age = nowMs - new Date(capture.startedAt).getTime();
      if (Number.isFinite(age) && age < LIMITS.captureRunningMs) {
        record = existing;
        started = false;
        return raw;
      }
    }
    existing.capture = {
      status: 'running', captureId: options.captureId || null, url: options.url || null,
      startedAt: nowIso, finishedAt: null, code: null, reason: null,
    };
    record = existing;
    started = true;
    return JSON.stringify(existing, null, 2) + '\n';
  }, '');
  return { started, record };
}

function pruneCaptures(capturesRoot, keepLatestId) {
  let entries;
  try { entries = fs.readdirSync(capturesRoot, { withFileTypes: true }); } catch { return; }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const keep = new Set(dirs.slice(-LIMITS.captureRetainCount));
  keep.add(keepLatestId);
  for (const name of dirs) {
    if (!keep.has(name)) {
      try { fs.rmSync(path.join(capturesRoot, name), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

function recordCapture(brandDir, captureId, result, options = {}) {
  const nowIso = toIso(options.now);
  const capturesRoot = path.join(brandDir, 'brand', 'kit-captures');
  const dir = path.join(capturesRoot, captureId);
  const logoCandidates = [];
  const candidates = Array.isArray(result && result.candidates) ? result.candidates.slice(0, LIMITS.logoCandidatesMax) : [];
  if (candidates.length) {
    fs.mkdirSync(dir, { recursive: true });
    for (const c of candidates) {
      let buffer = c.buffer;
      let width = c.width ?? null;
      let height = c.height ?? null;
      if (c.mimeType === 'image/svg+xml') {
        const clean = inspectImage(buffer);
        if (!clean || clean.mimeType !== 'image/svg+xml') continue;
        buffer = clean.buffer;
        width = clean.width;
        height = clean.height;
      }
      const ext = MIME_EXT[c.mimeType] || 'bin';
      const file = path.join(dir, `${c.id}.${ext}`);
      fs.writeFileSync(file, buffer);
      logoCandidates.push({
        id: c.id,
        kind: c.kind,
        file: `kit-captures/${captureId}/${c.id}.${ext}`,
        mimeType: c.mimeType,
        width,
        height,
        sourceUrl: c.sourceUrl || null,
      });
    }
  }
  pruneCaptures(capturesRoot, captureId);
  const file = kitFile(brandDir);
  let record;
  durable.update(file, (raw) => {
    let existing = null;
    try { existing = JSON.parse(raw); } catch { /* not written yet */ }
    if (!existing || existing.version !== 1) existing = defaultRecord(brandDir, nowIso);
    existing.proposed = {
      captureId,
      at: nowIso,
      method: (result && result.method) || 'static',
      finalUrl: (result && result.finalUrl) || null,
      logoCandidates,
      palette: Array.isArray(result && result.palette) ? result.palette.slice(0, LIMITS.proposedPaletteMax) : [],
      fonts: Array.isArray(result && result.fonts) ? result.fonts.slice(0, LIMITS.fontsMax) : [],
    };
    existing.capture = {
      status: (result && result.status) || 'failed',
      captureId,
      url: (existing.capture && existing.capture.url) || null,
      startedAt: (existing.capture && existing.capture.startedAt) || null,
      finishedAt: nowIso,
      code: (result && result.code) ?? null,
      reason: (result && result.reason) ?? null,
    };
    record = existing;
    return JSON.stringify(existing, null, 2) + '\n';
  }, '');
  return record;
}

function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (svgSanitize.looksLikeSvg(buffer)) {
    const clean = svgSanitize.sanitizeSvg(buffer, { maxInputBytes: LIMITS.captureLogoBytes });
    if (!clean.ok) return null;
    return { mimeType: 'image/svg+xml', width: clean.width, height: clean.height, buffer: clean.buffer };
  }
  const info = rasterInfo(buffer);
  return info ? { ...info, buffer } : null;
}

function imageInfo(buffer) {
  const info = inspectImage(buffer);
  return info ? { mimeType: info.mimeType, width: info.width, height: info.height } : null;
}

function rasterInfo(buffer) {
  if (buffer.length >= 24 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (offset + 4 > buffer.length) return null;
      const len = buffer.readUInt16BE(offset + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (offset + 9 > buffer.length) return null;
        return { mimeType: 'image/jpeg', width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + len;
    }
    return null;
  }
  if (buffer.length >= 30 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    const fourcc = buffer.slice(12, 16).toString('ascii');
    if (fourcc === 'VP8X') {
      const w = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const h = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return { mimeType: 'image/webp', width: w, height: h };
    }
    if (fourcc === 'VP8 ') {
      return { mimeType: 'image/webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L' && buffer.length >= 25) {
      const b = buffer.readUInt32LE(21);
      return { mimeType: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function validateLogo(logo, record, errors) {
  if (!logo || typeof logo !== 'object' || Array.isArray(logo)) {
    errors.push('Logo needs an action.');
    return undefined;
  }
  const action = logo.action;
  if (action === 'keep') return { action: 'keep' };
  if (action === 'remove') return { action: 'remove' };
  if (action === 'select') {
    if (!CAPTURE_ID.test(String(logo.captureId || '')) || !CANDIDATE_ID.test(String(logo.candidateId || ''))) {
      errors.push('Select a valid captured logo.');
      return undefined;
    }
    const proposed = record && record.proposed;
    const candidate = proposed && proposed.captureId === logo.captureId
      ? (proposed.logoCandidates || []).find((c) => c.id === logo.candidateId)
      : null;
    if (!candidate) {
      errors.push('That logo candidate is no longer available.');
      return undefined;
    }
    return { action: 'select', captureId: logo.captureId, candidateId: logo.candidateId, candidate };
  }
  if (action === 'upload') {
    const mimeType = logo.mimeType;
    if (!MIME_EXT[mimeType]) {
      errors.push('Logo uploads must be PNG, WebP, JPEG or SVG.');
      return undefined;
    }
    let buffer;
    try { buffer = Buffer.from(String(logo.dataBase64 || ''), 'base64'); } catch { buffer = Buffer.alloc(0); }
    if (!buffer.length || buffer.length > LIMITS.logoUploadBytes) {
      errors.push('Logo image must be a non-empty file of at most 40 KiB.');
      return undefined;
    }
    const info = inspectImage(buffer);
    if (!info || info.mimeType !== mimeType) {
      errors.push('Logo image does not match its declared type.');
      return undefined;
    }
    buffer = info.buffer;
    let thumbBuffer = null;
    let thumbMimeType = null;
    if (logo.thumbBase64 !== undefined) {
      thumbMimeType = logo.thumbMimeType;
      if (!MIME_EXT[thumbMimeType]) {
        errors.push('Logo thumbnail must be PNG, WebP, JPEG or SVG.');
        return undefined;
      }
      try { thumbBuffer = Buffer.from(String(logo.thumbBase64 || ''), 'base64'); } catch { thumbBuffer = Buffer.alloc(0); }
      if (!thumbBuffer.length || thumbBuffer.length > LIMITS.logoThumbBytes) {
        errors.push('Logo thumbnail must be a non-empty file of at most 6 KiB.');
        return undefined;
      }
      const thumbInfo = inspectImage(thumbBuffer);
      if (!thumbInfo || thumbInfo.mimeType !== thumbMimeType) {
        errors.push('Logo thumbnail does not match its declared type.');
        return undefined;
      }
      thumbBuffer = thumbInfo.buffer;
    }
    return { action: 'upload', buffer, mimeType, width: info.width, height: info.height, thumbBuffer, thumbMimeType };
  }
  if (action === 'file') {
    // The board uploaded the downscaled logo to the artifact's asset store and
    // board-sync downloaded it back to a local file, so the bytes never passed
    // through chat; this reads the file itself and trusts nothing about its
    // declared type, deciding PNG/JPEG/WebP/SVG from magic bytes exactly like the
    // 'upload' action above. Kickoff `provided` and Save-and-continue both reach
    // this the same way, and from here on it IS an 'upload': same staging,
    // commit and projection.
    const filePath = typeof logo.path === 'string' ? logo.path : '';
    if (!filePath || !path.isAbsolute(filePath)) {
      errors.push('Logo file path must be an absolute path.');
      return undefined;
    }
    let buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch {
      errors.push('Logo file could not be read.');
      return undefined;
    }
    if (!buffer.length || buffer.length > LIMITS.captureLogoBytes) {
      errors.push('Logo image must be a non-empty file of at most 256 KiB.');
      return undefined;
    }
    const info = inspectImage(buffer);
    if (!info) {
      errors.push('Logo image must be PNG, WebP, JPEG or SVG.');
      return undefined;
    }
    buffer = info.buffer;
    let thumbBuffer = null;
    let thumbMimeType = null;
    if (logo.thumbPath !== undefined) {
      const thumbPath = typeof logo.thumbPath === 'string' ? logo.thumbPath : '';
      if (!thumbPath || !path.isAbsolute(thumbPath)) {
        errors.push('Logo thumbnail path must be an absolute path.');
        return undefined;
      }
      try {
        thumbBuffer = fs.readFileSync(thumbPath);
      } catch {
        errors.push('Logo thumbnail could not be read.');
        return undefined;
      }
      if (!thumbBuffer.length || thumbBuffer.length > LIMITS.logoFileThumbBytes) {
        errors.push('Logo thumbnail must be a non-empty file of at most 64 KiB.');
        return undefined;
      }
      const thumbInfo = inspectImage(thumbBuffer);
      if (!thumbInfo) {
        errors.push('Logo thumbnail must be PNG, WebP, JPEG or SVG.');
        return undefined;
      }
      thumbBuffer = thumbInfo.buffer;
      thumbMimeType = thumbInfo.mimeType;
    }
    return { action: 'upload', buffer, mimeType: info.mimeType, width: info.width, height: info.height, thumbBuffer, thumbMimeType };
  }
  if (action === 'asset') {
    errors.push('Download the logo asset first and pass it as a file.');
    return undefined;
  }
  errors.push('Unknown logo action.');
  return undefined;
}

function validatePalette(palette, errors) {
  if (!Array.isArray(palette) || palette.length > LIMITS.paletteMax) {
    errors.push('Palette must have at most 8 colours.');
    return [];
  }
  const out = [];
  for (const item of palette) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('Each colour needs a value and role.'); continue; }
    if (typeof item.value !== 'string' || !HEX.test(item.value)) { errors.push(`Colour "${item.value}" must be a six-digit hex value.`); continue; }
    if (!ROLES.includes(item.role)) { errors.push(`Colour role must be one of ${ROLES.join(', ')}.`); continue; }
    const entry = { value: item.value.toUpperCase(), role: item.role };
    if (item.name !== undefined) {
      if (typeof item.name !== 'string' || item.name.length > LIMITS.colorNameMax) { errors.push('Colour name is too long.'); continue; }
      if (item.name.trim()) entry.name = item.name.trim();
    }
    out.push(entry);
  }
  return out;
}

function validateFonts(fonts, errors) {
  if (!Array.isArray(fonts) || fonts.length > LIMITS.fontsMax) {
    errors.push('Fonts must have at most 4 entries.');
    return [];
  }
  const out = [];
  for (const item of fonts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('Each font needs a family and use.'); continue; }
    if (typeof item.family !== 'string' || !FONT_FAMILY.test(item.family)) { errors.push(`Font family "${item.family}" is invalid.`); continue; }
    if (!FONT_USES.includes(item.use)) { errors.push(`Font use must be one of ${FONT_USES.join(', ')}.`); continue; }
    out.push({ family: item.family.trim(), use: item.use });
  }
  return out;
}

/** Pure. Decodes uploads and checks magic bytes and sizes. Nothing is written. */
function validateKitInput(kit, options = {}) {
  if (kit === undefined || kit === null) {
    return { ok: true, errors: [], normalized: { logo: undefined, palette: undefined, fonts: undefined } };
  }
  if (typeof kit !== 'object' || Array.isArray(kit)) {
    return { ok: false, errors: ['Kit must be an object.'], normalized: null };
  }
  const record = options.record || null;
  const errors = [];
  const logo = kit.logo !== undefined ? validateLogo(kit.logo, record, errors) : undefined;
  const palette = kit.palette !== undefined ? validatePalette(kit.palette, errors) : undefined;
  const fonts = kit.fonts !== undefined ? validateFonts(kit.fonts, errors) : undefined;
  const ok = errors.length === 0;
  return { ok, errors, normalized: ok ? { logo, palette, fonts } : null };
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyFileSafe(srcAbs, destAbs) {
  ensureDir(destAbs);
  fs.copyFileSync(srcAbs, destAbs);
}

function writeFileSafe(destAbs, buffer) {
  ensureDir(destAbs);
  fs.writeFileSync(destAbs, buffer);
}

function assetFromLogo(logo) {
  if (!logo) return null;
  return { uri: `assets/logo${path.extname(logo.file)}`, kind: 'logo', name: 'Primary logo', source: logo.source || 'upload' };
}

function clearLogoFiles(assetsRoot) {
  let names = [];
  try { names = fs.readdirSync(assetsRoot); } catch { return; }
  for (const name of names) {
    if (/^logo(-thumb)?\.(png|webp|jpg|svg)$/.test(name)) {
      try { fs.unlinkSync(path.join(assetsRoot, name)); } catch { /* best effort */ }
    }
  }
}

function resolveLogo(brandDir, logo, record) {
  const assetsRoot = assetsDir(brandDir);
  if (!logo || logo.action === undefined) {
    const existing = record.confirmed && record.confirmed.logo;
    return { asset: existing ? assetFromLogo(existing) : null, confirmedLogo: existing || null, write: null };
  }
  if (logo.action === 'remove') {
    return { asset: null, confirmedLogo: null, write: () => { clearLogoFiles(assetsRoot); return null; } };
  }
  if (logo.action === 'keep') {
    if (record.confirmed && record.confirmed.logo) {
      const existing = record.confirmed.logo;
      return { asset: assetFromLogo(existing), confirmedLogo: existing, write: null };
    }
    const provided = record.provided && record.provided.logo;
    if (provided) {
      return {
        asset: assetFromLogo(provided),
        confirmedLogo: null,
        write: () => {
          const ext = path.extname(provided.file);
          const destRel = `assets/logo${ext}`;
          clearLogoFiles(assetsRoot);
          copyFileSafe(path.join(brandDir, 'brand', provided.file), path.join(brandDir, 'brand', destRel));
          let destThumbRel = null;
          if (provided.thumb) {
            destThumbRel = `assets/logo-thumb${path.extname(provided.thumb)}`;
            copyFileSafe(path.join(brandDir, 'brand', provided.thumb), path.join(brandDir, 'brand', destThumbRel));
          }
          return { file: destRel, thumb: destThumbRel, mimeType: provided.mimeType, width: provided.width ?? null, height: provided.height ?? null, source: provided.source || 'upload', sourceUrl: provided.sourceUrl || null };
        },
      };
    }
    return { asset: null, confirmedLogo: null, write: null };
  }
  if (logo.action === 'select') {
    const c = logo.candidate;
    const ext = MIME_EXT[c.mimeType] || 'png';
    return {
      asset: assetFromLogo({ file: `assets/logo.${ext}`, source: 'website' }),
      confirmedLogo: null,
      write: () => {
        const destRel = `assets/logo.${ext}`;
        clearLogoFiles(assetsRoot);
        copyFileSafe(path.join(brandDir, 'brand', c.file), path.join(brandDir, 'brand', destRel));
        return { file: destRel, thumb: null, mimeType: c.mimeType, width: c.width ?? null, height: c.height ?? null, source: 'website', sourceUrl: c.sourceUrl || null };
      },
    };
  }
  if (logo.action === 'upload') {
    const ext = MIME_EXT[logo.mimeType] || 'png';
    return {
      asset: assetFromLogo({ file: `assets/logo.${ext}`, source: 'upload' }),
      confirmedLogo: null,
      write: () => {
        const destRel = `assets/logo.${ext}`;
        clearLogoFiles(assetsRoot);
        writeFileSafe(path.join(brandDir, 'brand', destRel), logo.buffer);
        let destThumbRel = null;
        if (logo.thumbBuffer) {
          const thumbExt = MIME_EXT[logo.thumbMimeType] || ext;
          destThumbRel = `assets/logo-thumb.${thumbExt}`;
          writeFileSafe(path.join(brandDir, 'brand', destThumbRel), logo.thumbBuffer);
        }
        return { file: destRel, thumb: destThumbRel, mimeType: logo.mimeType, width: logo.width ?? null, height: logo.height ?? null, source: 'upload', sourceUrl: null };
      },
    };
  }
  return { asset: null, confirmedLogo: null, write: null };
}

/**
 * Compute the profile patch and a commit() closure. Nothing is written until commit() runs,
 * so a caller can save the profile revision first and only then move kit files into place.
 * Idempotent by requestId: a retry against an already-confirmed requestId returns
 * {alreadyApplied:true} instead of re-committing.
 */
function applyKit(brandDir, normalized, options = {}) {
  const nowIso = toIso(options.now);
  const requestId = options.requestId ? String(options.requestId) : null;
  const record = read(brandDir) || defaultRecord(brandDir, nowIso);
  if (requestId && record.confirmed && record.confirmed.requestId === requestId) {
    return { alreadyApplied: true, record };
  }
  const logoResolution = resolveLogo(brandDir, normalized && normalized.logo, record);
  const palette = normalized && normalized.palette !== undefined ? normalized.palette : ((record.confirmed && record.confirmed.palette) || []);
  const fonts = normalized && normalized.fonts !== undefined ? normalized.fonts : ((record.confirmed && record.confirmed.fonts) || []);

  const profilePatch = {
    palette: palette.map((p) => ({ value: p.value, role: p.role, ...(p.name ? { name: p.name } : {}) })),
    fonts: fonts.map((f) => ({ family: f.family, use: f.use })),
    logoAsset: logoResolution.asset,
  };

  function commit() {
    const finalLogo = logoResolution.write ? logoResolution.write() : logoResolution.confirmedLogo;
    const nextRevision = (Number(record.kitRevision) || 0) + 1;
    const confirmed = { at: nowIso, requestId, by: options.by || 'board', logo: finalLogo, palette, fonts };
    const file = kitFile(brandDir);
    let out;
    durable.update(file, (raw) => {
      let existing;
      try { existing = JSON.parse(raw); } catch { existing = null; }
      if (!existing || existing.version !== 1) existing = defaultRecord(brandDir, nowIso);
      existing.status = 'confirmed';
      existing.pendingSince = null;
      existing.kitRevision = nextRevision;
      existing.confirmed = confirmed;
      out = existing;
      return JSON.stringify(existing, null, 2) + '\n';
    }, '');
    writeBrandMarks(brandDir, confirmed);
    return out;
  }

  return { profilePatch, commit };
}

/** Kickoff-time storage of a kit offered before the brand is complete. Status stays pending. */
function recordProvided(brandDir, normalized, options = {}) {
  const nowIso = toIso(options.now);
  const requestId = options.requestId ? String(options.requestId) : null;
  ensurePending(brandDir, { now: options.now });
  const logoInput = normalized && normalized.logo;
  let logoRecord = null;
  if (logoInput && logoInput.action === 'upload') {
    const ext = MIME_EXT[logoInput.mimeType] || 'png';
    const destRel = `assets/provided/logo.${ext}`;
    writeFileSafe(path.join(brandDir, 'brand', destRel), logoInput.buffer);
    let destThumbRel = null;
    if (logoInput.thumbBuffer) {
      const thumbExt = MIME_EXT[logoInput.thumbMimeType] || ext;
      destThumbRel = `assets/provided/logo-thumb.${thumbExt}`;
      writeFileSafe(path.join(brandDir, 'brand', destThumbRel), logoInput.thumbBuffer);
    }
    logoRecord = { file: destRel, thumb: destThumbRel, mimeType: logoInput.mimeType, width: logoInput.width ?? null, height: logoInput.height ?? null, source: 'upload' };
  }
  const palette = normalized && normalized.palette !== undefined ? normalized.palette : [];
  const fonts = normalized && normalized.fonts !== undefined ? normalized.fonts : [];
  const file = kitFile(brandDir);
  let record;
  durable.update(file, (raw) => {
    let existing;
    try { existing = JSON.parse(raw); } catch { existing = null; }
    if (!existing || existing.version !== 1) existing = defaultRecord(brandDir, nowIso);
    existing.provided = { at: nowIso, requestId, logo: logoRecord, palette, fonts };
    record = existing;
    return JSON.stringify(existing, null, 2) + '\n';
  }, '');
  return record;
}

function providedParts(brandDir) {
  const record = read(brandDir);
  const provided = record && record.provided;
  return {
    logo: Boolean(provided && provided.logo),
    palette: Boolean(provided && Array.isArray(provided.palette) && provided.palette.length),
    fonts: Boolean(provided && Array.isArray(provided.fonts) && provided.fonts.length),
  };
}

// The declared mimeType belongs to the confirmed logo record, which is the main image's
// type and is not always the thumbnail's own type (a re-encoded thumbnail can land in a
// different format than the source it was cut from). The label shown on the board must
// match the bytes actually being served, so this reads the thumbnail file and decides its
// type from its own magic bytes; the declared mimeType is only a fallback if that fails.
function thumbDataUrl(brandDir, relFile, mimeType) {
  if (!relFile) return null;
  const full = path.join(brandDir, 'brand', relFile);
  try {
    const stat = fs.statSync(full);
    if (stat.size > LIMITS.svgThumbProjectionBytes) return null;
    const raw = fs.readFileSync(full);
    const info = inspectImage(raw);
    if (info && info.mimeType === 'image/svg+xml') {
      if (info.buffer.length > LIMITS.svgThumbProjectionBytes) return null;
      return `data:image/svg+xml;base64,${info.buffer.toString('base64')}`;
    }
    if (stat.size > LIMITS.thumbProjectionBytes) return null;
    const actualType = (info || {}).mimeType || mimeType;
    return `data:${actualType};base64,${raw.toString('base64')}`;
  } catch {
    return null;
  }
}

function projectLogo(brandDir, confirmedLogo, candidate, captureId) {
  if (confirmedLogo) {
    return {
      source: confirmedLogo.source || null,
      thumb: thumbDataUrl(brandDir, confirmedLogo.thumb || confirmedLogo.file, confirmedLogo.mimeType),
      width: confirmedLogo.width ?? null,
      height: confirmedLogo.height ?? null,
      captureId: null,
      candidateId: null,
    };
  }
  if (candidate) {
    return {
      source: 'website',
      thumb: thumbDataUrl(brandDir, candidate.file, candidate.mimeType),
      width: candidate.width ?? null,
      height: candidate.height ?? null,
      captureId,
      candidateId: candidate.id,
    };
  }
  return null;
}

function projectCapture(record, st, nowIso) {
  const capture = record.capture || { status: 'not_started' };
  if (capture.status === 'running' && capture.startedAt) {
    const age = new Date(nowIso).getTime() - new Date(capture.startedAt).getTime();
    if (age >= LIMITS.captureRunningMs) return { status: 'failed', message: capture.reason || 'The capture took too long.' };
    return { status: 'running', message: null };
  }
  if (st === 'pending' && (!capture.status || capture.status === 'not_started')) {
    const pendingSince = record.pendingSince ? new Date(record.pendingSince).getTime() : null;
    const age = pendingSince ? new Date(nowIso).getTime() - pendingSince : 0;
    if (age < LIMITS.pendingWaitingMs) return { status: 'waiting', message: 'Reading your logo, colours and fonts...' };
    return { status: 'failed', message: 'The capture took too long.' };
  }
  return { status: capture.status || 'not_started', message: capture.reason || null };
}

/** Section 7 kit projection. Thumbnails are inlined as data URLs, never bare file paths. */
function projection(brandDir, options = {}) {
  const nowIso = toIso(options.now);
  const record = read(brandDir);
  if (!record) return null;
  const st = status(brandDir);
  const capture = projectCapture(record, st, nowIso);
  const provided = record.provided || null;
  const proposed = record.proposed || null;
  const confirmed = record.confirmed || null;

  let logo = null;
  let palette = [];
  let fonts = [];
  let basis = 'empty';

  if (st === 'confirmed' && confirmed) {
    logo = projectLogo(brandDir, confirmed.logo, null, null);
    palette = confirmed.palette || [];
    fonts = confirmed.fonts || [];
    basis = 'confirmed';
  } else {
    const providedLogo = provided && provided.logo;
    const proposedCandidate = proposed && Array.isArray(proposed.logoCandidates) ? proposed.logoCandidates[0] : null;
    if (providedLogo) {
      logo = projectLogo(brandDir, providedLogo, null, null);
      basis = 'provided';
    } else if (proposedCandidate) {
      logo = projectLogo(brandDir, null, proposedCandidate, proposed.captureId);
      basis = 'proposed';
    }
    const providedPalette = provided && Array.isArray(provided.palette) && provided.palette.length ? provided.palette : null;
    const providedFonts = provided && Array.isArray(provided.fonts) && provided.fonts.length ? provided.fonts : null;
    palette = providedPalette || (proposed && proposed.palette) || [];
    fonts = providedFonts || (proposed && proposed.fonts) || [];
    if (basis === 'empty' && (palette.length || fonts.length)) {
      basis = (providedPalette || providedFonts) ? 'provided' : 'proposed';
    }
  }

  const logoCandidates = st !== 'confirmed' && proposed && Array.isArray(proposed.logoCandidates)
    ? proposed.logoCandidates.map((c) => ({ captureId: proposed.captureId, candidateId: c.id, kind: c.kind, thumb: thumbDataUrl(brandDir, c.file, c.mimeType) }))
    : [];

  return {
    status: st,
    kitRevision: record.kitRevision || 0,
    basis,
    capture,
    logo,
    logoCandidates,
    palette,
    fonts,
    provided: {
      logo: Boolean(provided && provided.logo),
      palette: Boolean(provided && Array.isArray(provided.palette) && provided.palette.length),
      fonts: Boolean(provided && Array.isArray(provided.fonts) && provided.fonts.length),
    },
  };
}

function marksValues(confirmed) {
  const palette = (confirmed && confirmed.palette) || [];
  const byRole = (role) => { const p = palette.find((x) => x.role === role); return p ? p.value : null; };
  const fontsList = (confirmed && confirmed.fonts) || [];
  const font = fontsList.find((f) => f.use === 'body') || fontsList[0];
  return {
    logo: (confirmed && confirmed.logo && confirmed.logo.file) || 'unknown',
    primary: byRole('primary') || 'unknown',
    secondary: byRole('secondary') || 'unknown',
    accent: byRole('accent') || 'unknown',
    subtitle_font: (font && font.family) || 'unknown',
  };
}

/** Updates the logo/primary/secondary/accent/subtitle_font rows in `## Brand marks`. */
function writeBrandMarks(brandDir, confirmed) {
  const file = path.join(brandDir, 'brand', 'brand-voice.md');
  if (!fs.existsSync(file)) return;
  const values = marksValues(confirmed);
  durable.update(file, (raw) => {
    const lines = raw.split('\n');
    let inside = false;
    let sawTable = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.startsWith('## ')) {
        if (inside) break;
        inside = line.trim().toLowerCase() === '## brand marks';
        continue;
      }
      if (!inside || !line.trim().startsWith('|')) continue;
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (cells.length < 2 || /^:?-+:?$/.test(cells[0])) continue;
      const key = cells[0].toLowerCase();
      if (!MARK_ROWS.includes(key)) continue;
      const parts = line.split('|');
      if (parts.length >= 3) {
        parts[2] = ` ${values[key]} `;
        lines[i] = parts.join('|');
        sawTable = true;
      }
    }
    if (!sawTable) return raw;
    return lines.join('\n');
  }, '');
}

module.exports = {
  LIMITS,
  ROLES,
  FONT_USES,
  CAPTURE_ID,
  read,
  status,
  ensurePending,
  newCaptureId,
  beginCapture,
  recordCapture,
  validateKitInput,
  applyKit,
  recordProvided,
  providedParts,
  projection,
  writeBrandMarks,
  imageInfo,
  inspectImage,
};
