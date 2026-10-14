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
  // The board's asset-store upload path (kit.logo {action:'file'}) hands the
  // server a bigger, un-downscaled-for-chat file read straight off disk, rather
  // than the small inline base64 the board also downscales client-side for the
  // 'upload' action above.
  captureLogoBytes: 256 * 1024,
  logoFileThumbBytes: 64 * 1024,
  paletteMax: 8,
  proposedPaletteMax: 6,
  // Suggestions read from the brand's own places (profile pictures, website, videos): at most 3 logos, 5 colours and 2 typefaces.
  suggestedLogosMax: 3,
  suggestedPaletteMax: 5,
  suggestedFontsMax: 2,
  suggestedThumbBytes: 8 * 1024,
  fontsMax: 4,
  thumbProjectionBytes: 12 * 1024,
  svgThumbProjectionBytes: 24 * 1024,
  captureRunningMs: 10 * 60 * 1000,
  pendingWaitingMs: 10 * 60 * 1000,
  colorNameMax: 60,
});

const ROLES = Object.freeze(['primary', 'secondary', 'accent', 'background', 'text', 'other']);
const FONT_USES = Object.freeze(['headings', 'body', 'captions', 'other']);
const CAPTURE_ID = /^cap-\d{8}T\d{6}Z-[a-f0-9]{6}$/;
// Where a proposed palette came from: the website, a social profile picture (older records), the suggested logo, or frames of the brand's videos.
const PALETTE_SOURCES = Object.freeze(['website', 'instagram', 'tiktok', 'facebook', 'youtube', 'logo', 'videos']);
// Where proposed fonts came from: the website's CSS, or a model's "looks like" guess from on-screen text.
const FONT_SOURCES = Object.freeze(['website', 'looks_like']);
// Where a suggested logo came from: an account's profile picture, or the website's header, icon or sharing image.
const SUGGESTED_SOURCES = Object.freeze(['instagram', 'tiktok', 'facebook', 'youtube', 'website_header', 'website_icon', 'website_og']);
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

function recordCapture(brandDir, captureId, result, options = {}) {
  const nowIso = toIso(options.now);
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
      palette: Array.isArray(result && result.palette) ? result.palette.slice(0, LIMITS.proposedPaletteMax) : [],
      paletteSource: result && PALETTE_SOURCES.includes(result.paletteSource) ? result.paletteSource : null,
      fonts: Array.isArray(result && result.fonts) ? result.fonts.slice(0, LIMITS.fontsMax) : [],
      fontsSource: result && FONT_SOURCES.includes(result.fontsSource) ? result.fontsSource : null,
      signature: result && typeof result.signature === 'string' ? result.signature : null,
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

/** The name a suggested logo's source is saved under: "website" for any part of the website, else the account's platform. */
function suggestedSourceName(source) {
  return String(source || '').startsWith('website_') ? 'website' : String(source || 'upload');
}

/**
 * A logo the person chose from the suggestions ({action: 'suggested', id}): read from the file the capture saved on this computer,
 * and only when the model confirmed it shows the brand's mark. From here on it is an 'upload' like any other, so staging, commit and
 * projection are unchanged; its source and the address it came from are kept on the logo's record.
 */
function validateSuggestedLogo(logo, record, brandDir, errors) {
  const logos = record && record.suggested && Array.isArray(record.suggested.logos) ? record.suggested.logos : [];
  const found = logos.find((item) => item && item.id === logo.id);
  if (!found || found.checked !== true) {
    errors.push('That suggested logo is not available any more.');
    return undefined;
  }
  if (!brandDir) {
    errors.push('That suggested logo could not be read.');
    return undefined;
  }
  let buffer;
  try {
    buffer = fs.readFileSync(path.join(brandDir, 'brand', String(found.src)));
  } catch {
    errors.push('That suggested logo could not be read.');
    return undefined;
  }
  if (!buffer.length || buffer.length > LIMITS.captureLogoBytes) {
    errors.push('That suggested logo is not a usable file.');
    return undefined;
  }
  const info = inspectImage(buffer);
  if (!info) {
    errors.push('That suggested logo is not a PNG, WebP, JPEG or SVG picture.');
    return undefined;
  }
  let thumbBuffer = null;
  let thumbMimeType = null;
  if (found.thumb) {
    try {
      const thumb = inspectImage(fs.readFileSync(path.join(brandDir, 'brand', String(found.thumb))));
      if (thumb) { thumbBuffer = thumb.buffer; thumbMimeType = thumb.mimeType; }
    } catch { /* a thumbnail is optional */ }
  }
  return {
    action: 'upload', buffer: info.buffer, mimeType: info.mimeType, width: info.width, height: info.height, thumbBuffer, thumbMimeType,
    source: suggestedSourceName(found.source), sourceUrl: typeof found.url === 'string' ? found.url : null,
  };
}

function validateLogo(logo, record, errors, brandDir) {
  // No logo given (or null) means no change to the logo.
  if (logo === undefined || logo === null) return { action: 'keep' };
  if (!logo || typeof logo !== 'object' || Array.isArray(logo)) {
    errors.push('Logo needs an action.');
    return undefined;
  }
  const action = logo.action;
  if (action === 'keep') return { action: 'keep' };
  if (action === 'remove') return { action: 'remove' };
  if (action === 'select') return { action: 'keep' };
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
  if (action === 'suggested') return validateSuggestedLogo(logo, record, brandDir, errors);
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
  const logo = kit.logo !== undefined ? validateLogo(kit.logo, record, errors, options.brandDir || null) : undefined;
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
  if (logo.action === 'upload') {
    const ext = MIME_EXT[logo.mimeType] || 'png';
    return {
      asset: assetFromLogo({ file: `assets/logo.${ext}`, source: logo.source || 'upload' }),
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
        return { file: destRel, thumb: destThumbRel, mimeType: logo.mimeType, width: logo.width ?? null, height: logo.height ?? null, source: logo.source || 'upload', sourceUrl: logo.sourceUrl || null };
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

/** Writes an uploaded logo (a validated 'upload' logo) under assets/provided and returns its record, or null for anything else. */
function writeProvidedLogo(brandDir, logoInput, source) {
  if (!logoInput || logoInput.action !== 'upload') return null;
  const ext = MIME_EXT[logoInput.mimeType] || 'png';
  const destRel = `assets/provided/logo.${ext}`;
  writeFileSafe(path.join(brandDir, 'brand', destRel), logoInput.buffer);
  let destThumbRel = null;
  if (logoInput.thumbBuffer) {
    const thumbExt = MIME_EXT[logoInput.thumbMimeType] || ext;
    destThumbRel = `assets/provided/logo-thumb.${thumbExt}`;
    writeFileSafe(path.join(brandDir, 'brand', destThumbRel), logoInput.thumbBuffer);
  }
  return { file: destRel, thumb: destThumbRel, mimeType: logoInput.mimeType, width: logoInput.width ?? null, height: logoInput.height ?? null, source: source || logoInput.source || 'upload', sourceUrl: logoInput.sourceUrl || null };
}

/**
 * Kickoff-time storage of a kit offered before the brand is complete. Status stays pending. A save made on the brand's details page
 * (before research starts) can be repeated: `options.keepLogo` leaves a logo provided earlier in place when this save carries no new
 * logo file; a logo the person removed (`action: 'remove'`) is cleared either way.
 */
function recordProvided(brandDir, normalized, options = {}) {
  const nowIso = toIso(options.now);
  const requestId = options.requestId ? String(options.requestId) : null;
  ensurePending(brandDir, { now: options.now });
  const logoRecord = writeProvidedLogo(brandDir, normalized && normalized.logo);
  const palette = normalized && normalized.palette !== undefined ? normalized.palette : [];
  const fonts = normalized && normalized.fonts !== undefined ? normalized.fonts : [];
  const file = kitFile(brandDir);
  let record;
  durable.update(file, (raw) => {
    let existing;
    try { existing = JSON.parse(raw); } catch { existing = null; }
    if (!existing || existing.version !== 1) existing = defaultRecord(brandDir, nowIso);
    const removed = Boolean(normalized && normalized.logo && normalized.logo.action === 'remove');
    const priorLogo = options.keepLogo && !removed && existing.provided ? existing.provided.logo || null : null;
    existing.provided = { at: nowIso, requestId, logo: logoRecord || priorLogo, palette, fonts };
    record = existing;
    return JSON.stringify(existing, null, 2) + '\n';
  }, '');
  return record;
}

/**
 * Add a logo and/or fonts the person gave after the kickoff (found in their own folders) to `provided`, keeping what is already there:
 * `parts` is { logo?: a validated 'upload' logo, fonts?: [{family, use}], source?: string }. Fonts join the fonts already shown (the
 * provided ones, else the proposed ones), skip a family already there and stop at the limit. The kit's status does not change, so the
 * person still confirms it with Save and continue. Returns { record, fonts, added: [family], logo: boolean }.
 */
function addProvided(brandDir, parts = {}, options = {}) {
  const nowIso = toIso(options.now);
  const logoRecord = writeProvidedLogo(brandDir, parts.logo, parts.source);
  const wanted = Array.isArray(parts.fonts) ? parts.fonts : null;
  const added = [];
  let fonts = null;
  let record;
  durable.update(kitFile(brandDir), (raw) => {
    let existing;
    try { existing = JSON.parse(raw); } catch { existing = null; }
    if (!existing || existing.version !== 1) existing = defaultRecord(brandDir, nowIso);
    const provided = existing.provided || { at: nowIso, requestId: null, logo: null, palette: [], fonts: [] };
    const next = { ...provided, at: nowIso };
    if (logoRecord) next.logo = logoRecord;
    if (wanted) {
      // Fonts a model only guessed from on-screen text are not fonts the kit has, so the ones given here replace them.
      const guessed = Boolean(existing.proposed && existing.proposed.fontsSource === 'looks_like');
      const current = Array.isArray(provided.fonts) && provided.fonts.length ? provided.fonts : (guessed ? [] : ((existing.proposed && existing.proposed.fonts) || []));
      fonts = current.map((f) => ({ family: f.family, use: f.use }));
      added.length = 0;
      for (const font of wanted) {
        if (fonts.length >= LIMITS.fontsMax) break;
        if (fonts.some((f) => String(f.family).toLowerCase() === String(font.family).toLowerCase())) continue;
        fonts.push({ family: font.family, use: font.use });
        added.push(font.family);
      }
      next.fonts = fonts;
    }
    existing.provided = next;
    record = existing;
    return JSON.stringify(existing, null, 2) + '\n';
  }, '');
  return { record, fonts, added, logo: Boolean(logoRecord) };
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

// ---------------------------------------------------------------- suggestions from the brand's own places
// The capture finds up to three logo candidates (the website's header or icon, the brand's profile pictures), colours (from the website, the
// suggested logo or frames of the brand's videos) and a typeface the model thinks the videos use. They are only proposals: a logo is
// shown on the board once the model has looked at it and confirmed it shows the brand's mark, the person says Use this or Not this, and an
// upload always wins. Colours and fonts are proposed in `proposed`, editable like any other.

const HEX_HASH = /^[0-9a-f]{16}$/;

function popcount(value) {
  let bits = value;
  let count = 0;
  while (bits) { count += Number(bits & 1n); bits >>= 1n; }
  return count;
}

/** Whether two picture fingerprints are the same picture: equal, or two average hashes at most 6 bits apart. */
function sameFingerprint(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a === b) return true;
  if (!HEX_HASH.test(a) || !HEX_HASH.test(b)) return false;
  return popcount(BigInt(`0x${a}`) ^ BigInt(`0x${b}`)) <= 6;
}

function suggestedDir(brandDir) {
  return path.join(assetsDir(brandDir), 'suggested');
}

// Something was found after all (a confirmed logo, colours read from it, a typeface): a capture that ended with nothing is partial now,
// with no error to show.
function liftCapture(existing) {
  const capture = existing && existing.capture;
  if (capture && (capture.status === 'failed' || capture.status === 'unavailable')) existing.capture = { ...capture, status: 'partial', code: null, reason: null };
}

function removeSuggestedFiles(brandDir, logo) {
  for (const rel of [logo && logo.src, logo && logo.thumb]) {
    if (!rel || typeof rel !== 'string' || !rel.startsWith('assets/suggested/')) continue;
    try { fs.unlinkSync(path.join(brandDir, 'brand', rel)); } catch { /* already gone */ }
  }
}

/**
 * Keep the logo candidates a capture found: write each picture (and its small preview) under brand/assets/suggested/ and record
 * { id, src, thumb, source, sources, url, mimeType, width, height, hash, colours, checked } for it in `suggested.logos`. A candidate is
 * not shown on the board until reviewSuggestedLogos marks it checked. A picture the model already confirmed stays confirmed, and one it
 * rejected is not offered again. `candidates` is [{ source, sources, url, buffer, mimeType, width, height, thumbBuffer, thumbMimeType,
 * hash, colours }], best first. Returns the records kept.
 */
function saveSuggestedLogos(brandDir, candidates, options = {}) {
  const nowIso = toIso(options.now);
  const prior = read(brandDir);
  const before = prior && prior.suggested && typeof prior.suggested === 'object' ? prior.suggested : {};
  const priorLogos = Array.isArray(before.logos) ? before.logos : [];
  const rejected = Array.isArray(before.rejected) ? before.rejected.filter((item) => typeof item === 'string') : [];
  const root = suggestedDir(brandDir);
  try {
    for (const name of fs.readdirSync(root)) fs.unlinkSync(path.join(root, name));
  } catch { /* nothing saved yet */ }
  const logos = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (logos.length >= LIMITS.suggestedLogosMax) break;
    if (!candidate || !Buffer.isBuffer(candidate.buffer) || !MIME_EXT[candidate.mimeType] || candidate.buffer.length > LIMITS.captureLogoBytes) continue;
    if (!SUGGESTED_SOURCES.includes(candidate.source)) continue;
    if (rejected.some((hash) => sameFingerprint(hash, candidate.hash))) continue;
    const id = `sg${logos.length + 1}`;
    const src = `assets/suggested/${id}.${MIME_EXT[candidate.mimeType]}`;
    writeFileSafe(path.join(brandDir, 'brand', src), candidate.buffer);
    let thumb = null;
    const thumbLimit = candidate.thumbMimeType === 'image/svg+xml' ? LIMITS.svgThumbProjectionBytes : LIMITS.suggestedThumbBytes;
    if (Buffer.isBuffer(candidate.thumbBuffer) && MIME_EXT[candidate.thumbMimeType] && candidate.thumbBuffer.length <= thumbLimit) {
      thumb = `assets/suggested/${id}-thumb.${MIME_EXT[candidate.thumbMimeType]}`;
      writeFileSafe(path.join(brandDir, 'brand', thumb), candidate.thumbBuffer);
    }
    const confirmed = priorLogos.some((item) => item && item.checked === true && sameFingerprint(item.hash, candidate.hash));
    logos.push({
      id, src, thumb, source: candidate.source,
      sources: (Array.isArray(candidate.sources) ? candidate.sources : [candidate.source]).filter((item) => SUGGESTED_SOURCES.includes(item)),
      url: typeof candidate.url === 'string' ? candidate.url : null,
      mimeType: candidate.mimeType, width: candidate.width ?? null, height: candidate.height ?? null,
      hash: typeof candidate.hash === 'string' ? candidate.hash : null,
      colours: (Array.isArray(candidate.colours) ? candidate.colours : []).filter((hex) => HEX.test(hex)).slice(0, LIMITS.suggestedPaletteMax),
      checked: confirmed ? true : null,
    });
  }
  let record;
  durable.update(kitFile(brandDir), (raw) => {
    let existing = null;
    try { existing = JSON.parse(raw); } catch { /* not written yet */ }
    if (!existing || existing.version !== 1) existing = defaultRecord(brandDir, nowIso);
    existing.suggested = { ...(existing.suggested || {}), at: nowIso, logos, rejected: rejected.slice(-20) };
    record = existing;
    return JSON.stringify(existing, null, 2) + '\n';
  }, '');
  return { record, logos };
}

/**
 * Record what the model decided after looking at each logo candidate: [{ id, verdict: 'brand' | 'not_brand', note? }]. A picture that
 * shows the brand's mark or name is marked checked (and then shown on the board); one that does not is deleted and never offered again.
 * Returns { record, accepted: [id], dropped: [id], unknown: [id] }.
 */
function reviewSuggestedLogos(brandDir, verdicts, options = {}) {
  const nowIso = toIso(options.now);
  const wanted = (Array.isArray(verdicts) ? verdicts : []).filter((item) => item && typeof item.id === 'string' && (item.verdict === 'brand' || item.verdict === 'not_brand'));
  const accepted = [];
  const dropped = [];
  const unknown = [];
  let record = null;
  durable.update(kitFile(brandDir), (raw) => {
    let existing = null;
    try { existing = JSON.parse(raw); } catch { /* not written yet */ }
    if (!existing || existing.version !== 1) { wanted.forEach((item) => unknown.push(item.id)); return raw; }
    const suggested = existing.suggested && typeof existing.suggested === 'object' ? existing.suggested : { logos: [] };
    const logos = Array.isArray(suggested.logos) ? suggested.logos : [];
    const rejected = Array.isArray(suggested.rejected) ? suggested.rejected : [];
    for (const item of wanted) {
      const at = logos.findIndex((logo) => logo && logo.id === item.id);
      if (at < 0) { unknown.push(item.id); continue; }
      if (item.verdict === 'brand') {
        logos[at].checked = true;
        if (typeof item.note === 'string' && item.note.trim()) logos[at].note = item.note.trim().slice(0, 200);
        accepted.push(item.id);
      } else {
        removeSuggestedFiles(brandDir, logos[at]);
        if (logos[at].hash) rejected.push(logos[at].hash);
        logos.splice(at, 1);
        dropped.push(item.id);
      }
    }
    existing.suggested = { ...suggested, at: nowIso, logos, rejected: rejected.slice(-20) };
    if (accepted.length) liftCapture(existing);
    record = existing;
    return JSON.stringify(existing, null, 2) + '\n';
  }, '');
  return { record: record || read(brandDir), accepted, dropped, unknown };
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rgbOf = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

/**
 * Propose colours read from a picture of the brand: `{ from: 'logo' | 'videos', colours: ['#RRGGBB', ...] }` (an empty list takes this
 * source's colours away again). Colours already proposed from the other source stay, near copies are dropped, at most 5 in all, and
 * roles run primary, secondary, accent, other. Nothing changes when the person provided colours or the website gave a brand colour.
 * Returns { applied, reason?, palette, paletteSource }.
 */
function suggestPalette(brandDir, input, options = {}) {
  const nowIso = toIso(options.now);
  const from = input && (input.from === 'logo' || input.from === 'videos') ? input.from : null;
  if (!from) return { applied: false, reason: 'unknown_source', palette: [], paletteSource: null };
  const colours = (Array.isArray(input.colours) ? input.colours : []).filter((hex) => typeof hex === 'string' && HEX.test(hex)).map((hex) => hex.toUpperCase());
  let result = { applied: false, reason: 'no_record', palette: [], paletteSource: null };
  durable.update(kitFile(brandDir), (raw) => {
    let existing = null;
    try { existing = JSON.parse(raw); } catch { /* not written yet */ }
    if (!existing || existing.version !== 1) existing = defaultRecord(brandDir, nowIso);
    const provided = existing.provided;
    if (provided && Array.isArray(provided.palette) && provided.palette.length) {
      result = { applied: false, reason: 'provided', palette: provided.palette, paletteSource: null };
      return raw;
    }
    const proposed = existing.proposed && typeof existing.proposed === 'object' ? existing.proposed : {
      captureId: null, at: nowIso, method: 'static', finalUrl: null, palette: [], paletteSource: null, fonts: [], fontsSource: null, signature: null,
    };
    const current = Array.isArray(proposed.palette) ? proposed.palette : [];
    if (proposed.paletteSource === 'website' && current.some((entry) => entry && entry.role !== 'background')) {
      result = { applied: false, reason: 'website', palette: current, paletteSource: 'website' };
      return raw;
    }
    const kept = current.filter((entry) => entry && entry.from && entry.from !== from && HEX.test(entry.value));
    const additions = colours.map((value) => ({ value, from }));
    const ordered = [...(from === 'logo' ? additions : kept), ...(from === 'logo' ? kept : additions)];
    const roles = ['primary', 'secondary', 'accent'];
    const merged = [];
    for (const entry of ordered) {
      if (merged.length >= LIMITS.suggestedPaletteMax) break;
      if (merged.some((other) => distance(rgbOf(other.value), rgbOf(entry.value)) < 52)) continue;
      merged.push({ value: entry.value, role: roles.shift() || 'other', from: entry.from });
    }
    const source = merged.length === 0 ? null : merged.every((entry) => entry.from === 'videos') ? 'videos' : 'logo';
    existing.proposed = { ...proposed, palette: merged, paletteSource: source };
    if (merged.length) liftCapture(existing);
    result = { applied: true, palette: merged, paletteSource: source };
    return JSON.stringify(existing, null, 2) + '\n';
  }, '');
  return result;
}

/**
 * Propose the Google fonts that look closest to the on-screen text of the brand's videos: [{ family, use }], at most 2, shown with
 * "looks like" wording. Nothing changes when the person (or the folders) provided fonts or the website named some.
 * Returns { applied, reason?, fonts }.
 */
function suggestFonts(brandDir, fonts, options = {}) {
  const nowIso = toIso(options.now);
  const errors = [];
  const valid = validateFonts(Array.isArray(fonts) ? fonts.slice(0, LIMITS.suggestedFontsMax) : [], errors);
  if (errors.length || !valid.length) return { applied: false, reason: 'invalid', fonts: [] };
  let result = { applied: false, reason: 'no_record', fonts: [] };
  durable.update(kitFile(brandDir), (raw) => {
    let existing = null;
    try { existing = JSON.parse(raw); } catch { /* not written yet */ }
    if (!existing || existing.version !== 1) existing = defaultRecord(brandDir, nowIso);
    const provided = existing.provided;
    if (provided && Array.isArray(provided.fonts) && provided.fonts.length) {
      result = { applied: false, reason: 'provided', fonts: provided.fonts };
      return raw;
    }
    const proposed = existing.proposed && typeof existing.proposed === 'object' ? existing.proposed : {
      captureId: null, at: nowIso, method: 'static', finalUrl: null, palette: [], paletteSource: null, fonts: [], fontsSource: null, signature: null,
    };
    if (Array.isArray(proposed.fonts) && proposed.fonts.length && proposed.fontsSource !== 'looks_like') {
      result = { applied: false, reason: 'website', fonts: proposed.fonts };
      return raw;
    }
    existing.proposed = { ...proposed, fonts: valid, fontsSource: 'looks_like' };
    liftCapture(existing);
    result = { applied: true, fonts: valid };
    return JSON.stringify(existing, null, 2) + '\n';
  }, '');
  return result;
}

/** The logo candidates the model confirmed, best first, as { id, source, sources, url, src, thumb, mimeType, width, height, colours }. */
function checkedSuggestedLogos(brandDir) {
  const record = read(brandDir);
  const logos = record && record.suggested && Array.isArray(record.suggested.logos) ? record.suggested.logos : [];
  return logos.filter((logo) => logo && logo.checked === true);
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

function projectLogo(brandDir, confirmedLogo) {
  if (!confirmedLogo) return null;
  return {
    source: confirmedLogo.source || null,
    thumb: thumbDataUrl(brandDir, confirmedLogo.thumb || confirmedLogo.file, confirmedLogo.mimeType),
    width: confirmedLogo.width ?? null,
    height: confirmedLogo.height ?? null,
  };
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
  let paletteSource = null;
  let fonts = [];
  let basis = 'empty';

  if (st === 'confirmed' && confirmed) {
    logo = projectLogo(brandDir, confirmed.logo);
    palette = confirmed.palette || [];
    fonts = confirmed.fonts || [];
    basis = 'confirmed';
  } else {
    const providedLogo = provided && provided.logo;
    if (providedLogo) {
      logo = projectLogo(brandDir, providedLogo);
      basis = 'provided';
    }
    const providedPalette = provided && Array.isArray(provided.palette) && provided.palette.length ? provided.palette : null;
    const providedFonts = provided && Array.isArray(provided.fonts) && provided.fonts.length ? provided.fonts : null;
    palette = providedPalette || (proposed && proposed.palette) || [];
    fonts = providedFonts || (proposed && proposed.fonts) || [];
    if (!providedPalette && palette.length) {
      paletteSource = PALETTE_SOURCES.includes(proposed.paletteSource) ? proposed.paletteSource : 'website';
    }
    if (basis === 'empty' && (palette.length || fonts.length)) {
      basis = (providedPalette || providedFonts) ? 'provided' : 'proposed';
    }
  }

  // Where the proposed fonts came from, shown only for fonts the person did not give: "looks like" guesses read differently from the website's own.
  const fontsProvided = Boolean(provided && Array.isArray(provided.fonts) && provided.fonts.length);
  const fontsSource = st !== 'confirmed' && !fontsProvided && fonts.length ? (proposed && FONT_SOURCES.includes(proposed.fontsSource) ? proposed.fontsSource : 'website') : null;
  // The logo candidates the model confirmed (a logo the kit already has makes them unnecessary), with their previews inlined.
  const suggestedLogos = !logo && st !== 'confirmed'
    ? checkedSuggestedLogos(brandDir).map((item) => ({
      id: item.id,
      source: item.source,
      sources: Array.isArray(item.sources) && item.sources.length ? item.sources : [item.source],
      thumb: thumbDataUrl(brandDir, item.thumb || item.src, item.mimeType),
      width: item.width ?? null,
      height: item.height ?? null,
    }))
    : [];
  const providedLogoSource = provided && provided.logo && provided.logo.source && provided.logo.source !== 'upload' ? provided.logo.source : null;

  return {
    status: st,
    kitRevision: record.kitRevision || 0,
    basis,
    capture,
    logo,
    palette,
    paletteSource,
    fonts,
    ...(fontsSource ? { fontsSource } : {}),
    ...(suggestedLogos.length ? { suggested: { logos: suggestedLogos } } : {}),
    provided: {
      logo: Boolean(provided && provided.logo),
      palette: Boolean(provided && Array.isArray(provided.palette) && provided.palette.length),
      fonts: fontsProvided,
      ...(providedLogoSource ? { logoSource: providedLogoSource } : {}),
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
  addProvided,
  providedParts,
  saveSuggestedLogos,
  reviewSuggestedLogos,
  suggestPalette,
  suggestFonts,
  checkedSuggestedLogos,
  projection,
  writeBrandMarks,
  imageInfo,
  inspectImage,
};
