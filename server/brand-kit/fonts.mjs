import { decodeEntities } from '../social/backends/web.mjs';

export const FONT_LIMIT = 4;

const FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._'-]{0,79}$/;

const GENERIC_FONT_NAMES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'inherit', 'initial', 'unset', 'revert', 'math', 'emoji', 'fangsong',
]);
const SYSTEM_FONT_NAMES = new Set([
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial',
  'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'oxygen', 'ubuntu',
  'cantarell', 'fira sans', 'droid sans', 'sans serif', 'times new roman', 'times', 'georgia', 'verdana',
  'tahoma', 'trebuchet ms', 'courier new', 'courier', 'lucida grande', 'menlo', 'consolas', 'monaco',
]);
const ICON_FONT_NAMES = /(font ?awesome|fontawesome|material ?(?:icons?|symbols?)|glyphicons?|icomoon|ionicons|feather|bootstrap ?icons?|fontello|dashicons|themify|linearicons|elegant ?icons|simple-line-icons|remixicon|boxicons|line ?awesome|slick|swiper|\bicons?\b|\bglyphs?\b)/i;

const WEIGHT_WORDS = [
  'thin', 'hairline', 'extralight', 'ultralight', 'light', 'book', 'regular', 'roman', 'normal', 'medium',
  'semibold', 'demibold', 'bold', 'extrabold', 'ultrabold', 'heavy', 'black', 'italic', 'oblique', 'italics',
  'variable', 'webfont', 'wght',
];
const WEIGHT_TAIL = new RegExp(`[-_\\s]+(?:${WEIGHT_WORDS.join('|')}|[1-9]00)$`, 'i');
const FILE_NOISE_WORDS = new Set([
  'font', 'fonts', 'webfont', 'webfonts', 'web', 'subset', 'latin', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'static',
  'asset', 'assets', 'file', 'files', 'main', 'icons', 'icon', 'min', 'wght', 'ital', 'vf', 'var', 'variable',
]);
const GENERIC_NAME_WORDS = new Set(['font', 'my', 'local', 'custom', 'heading', 'body', 'text', 'sans', 'serif', 'mono', 'display', 'main', 'primary', 'secondary', 'brand']);
const STYLE_ONLY_WORDS =new Set(['thin', 'hairline', 'extralight', 'ultralight', 'light', 'book', 'regular', 'roman', 'normal', 'medium', 'semibold', 'demibold', 'bold', 'extrabold', 'ultrabold', 'heavy', 'black', 'italic', 'oblique']);

/** @param {string} raw */
function cleanName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/^['"]+|['"]+$/g, '').trim();
}

/** @param {string} name */
export function isJunkFamily(name) {
  const value = cleanName(name);
  if (!value) return true;
  if (/[(){}<>;\\]/.test(value)) return true;
  if (value.length > 80) return true;
  const spaced = /\s/.test(value);
  if (!spaced && /^(?:wf|font|fnt)[-_]/i.test(value)) return true;
  if (/^[0-9a-f]{6,}$/i.test(value)) return true;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) return true;
  if (!spaced) {
    if (value.length > 32) return true;
    const hexRun = value.match(/[0-9a-f]{8,}/i)?.[0];
    if (hexRun && /\d/.test(hexRun) && /[a-f]/i.test(hexRun)) return true;
    if (value.length >= 8) {
      const letters = (value.match(/[a-z]/gi) || []).length;
      const digits = (value.match(/\d/g) || []).length;
      const flips = (value.match(/(?:\d[a-z]|[a-z]\d)/gi) || []).length;
      if (digits >= 3 && letters >= 3 && flips >= 3 && digits / value.length >= 0.25) return true;
      const consonantRun = Math.max(0, ...(value.match(/[b-df-hj-np-tv-xz]+/gi) || []).map((run) => run.length));
      if (consonantRun >= 8) return true;
      const humps = (value.match(/[a-z][A-Z]/g) || []).length;
      if (humps >= 4 && humps / value.length >= 0.3) return true;
    }
  }
  return false;
}

/** @param {string} name */
export function displayFamily(name) {
  let value = cleanName(name);
  const wrapped = value.match(/^__(.+)_[0-9a-f]{6,8}$/i);
  if (wrapped) value = wrapped[1];
  if (/fallback$/i.test(value)) return null;
  const words = value
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => (/^[a-z]/.test(word) ? splitCamel(word).split(' ') : [word]))
    .map((word) => (word === word.toLowerCase() ? titleWord(word) : word));
  if (!words.length || words.every((word) => GENERIC_NAME_WORDS.has(word.toLowerCase()))) return null;
  return words.join(' ');
}

/** @param {string} name */
function readableDeclared(name) {
  const cleaned = cleanName(name);
  if (/^__.+_[0-9a-f]{6,8}$/i.test(cleaned)) return displayFamily(cleaned);
  return isJunkFamily(cleaned) ? null : displayFamily(baseFamily(cleaned));
}

/** @param {string} name */
function isNonBrandFont(name) {
  const lower = cleanName(name).toLowerCase();
  return GENERIC_FONT_NAMES.has(lower) || SYSTEM_FONT_NAMES.has(lower) || ICON_FONT_NAMES.test(name);
}

/** @param {string} value */
function isHashToken(value) {
  return /^[0-9a-f]{6,}$/i.test(value) && /\d/.test(value);
}

function titleWord(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function splitCamel(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/** @param {string} name */
export function baseFamily(name) {
  let value = cleanName(name);
  for (let guard = 0; guard < 4; guard += 1) {
    const next = value.replace(WEIGHT_TAIL, '');
    if (!next || next === value) break;
    value = next;
  }
  return value;
}

function familyKey(name) {
  return baseFamily(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** @param {string} srcValue */
export function familyFromSrc(srcValue) {
  const urls = [...String(srcValue ?? '').matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/gi)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((url) => url && !/^data:/i.test(url));
  const preferred = urls.find((url) => /\.woff2?(?:[?#]|$)/i.test(url)) ?? urls.find((url) => /\.(?:ttf|otf)(?:[?#]|$)/i.test(url)) ?? urls[0];
  if (!preferred) return null;
  let file = preferred.split('#')[0].split('?')[0].split('/').pop() ?? '';
  try {
    file = decodeURIComponent(file);
  } catch {
    file = String(file);
  }
  const parts = file.replace(/\.(?:woff2?|ttf|otf|eot|svg)$/i, '').split('.').filter((part) => !isHashToken(part));
  const stem = parts.join(' ');
  if (!stem) return null;
  const tokens = splitCamel(stem).split(/[-_+\s]+/).filter(Boolean).filter((token) => !isHashToken(token) && !/^v\d{1,3}$/i.test(token));
  while (tokens.length > 1 && (STYLE_ONLY_WORDS.has(tokens[tokens.length - 1].toLowerCase()) || FILE_NOISE_WORDS.has(tokens[tokens.length - 1].toLowerCase()) || /^[1-9]00$/.test(tokens[tokens.length - 1]))) {
    tokens.pop();
  }
  const words = tokens.filter((token) => !FILE_NOISE_WORDS.has(token.toLowerCase()));
  if (!words.length) return null;
  const readable = words.map(titleWord).join(' ');
  if (!/^[A-Za-z][A-Za-z0-9 ]*$/.test(readable)) return null;
  const letters = (readable.match(/[a-z]/gi) || []).length;
  if (letters < 4) return null;
  const vowels = (readable.match(/[aeiouy]/gi) || []).length;
  if (vowels / letters < 0.2) return null;
  if (words.length === 1 && isJunkFamily(words[0])) return null;
  if (words.every((word) => STYLE_ONLY_WORDS.has(word.toLowerCase()) || FILE_NOISE_WORDS.has(word.toLowerCase()))) return null;
  return readable;
}

/** @param {string} value */
function splitStack(value) {
  const names = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (const ch of String(value)) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '(') {
      depth += 1;
      current += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === ',' && depth === 0) {
      names.push(current);
      current = '';
    } else current += ch;
  }
  names.push(current);
  return names.map((name) => name.trim()).filter(Boolean);
}

function stripComments(css) {
  return String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function collectVariables(css) {
  /** @type {Map<string, string>} */
  const vars = new Map();
  for (const match of css.matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;}]+)/gi)) {
    if (!vars.has(match[1])) vars.set(match[1], match[2].trim());
  }
  return vars;
}

function resolveVars(value, vars, depth = 0) {
  if (depth > 3 || !/var\(/i.test(value)) return value;
  const next = value.replace(/var\(\s*(--[a-z0-9_-]+)\s*(?:,\s*([^)]*))?\)/gi, (whole, name, fallback) => vars.get(name) ?? fallback ?? '');
  return resolveVars(next, vars, depth + 1);
}

function stackFromDeclarations(body) {
  const family = body.match(/(?:^|[;\s])font-family\s*:\s*([^;]+)/i)?.[1];
  if (family) return family;
  const shorthand = body.match(/(?:^|[;\s])font\s*:\s*[^;]*?\d(?:px|rem|em|pt|%)(?:\s*\/\s*[^\s,;]+)?\s+([^;]+)/i)?.[1];
  return shorthand ?? null;
}

const USE_RANK = { headings: 0, body: 1, other: 2 };

/** @param {string} selector */
function usageOf(selector) {
  const last = selector.trim().toLowerCase().split(/[\s>+~]+/).filter(Boolean).pop() ?? '';
  const compound = last.replace(/::?[a-z-]+(?:\([^)]*\))?/g, '').replace(/\[[^\]]*\]/g, '');
  if (!compound) return null;
  if (/^(?:html|body|p|:root|\*)$/.test(compound)) return 'body';
  if (/^(?:h[1-6]|\.h[1-6]|\.(?:heading|headline|title|display)[a-z0-9_-]*)$/.test(compound)) return 'headings';
  if (/^(?:button|input|select|textarea|a?\.(?:btn|button|cta)[a-z0-9_-]*)$/.test(compound)) return 'other';
  return null;
}

/**
 * @param {string} css
 * @param {string} html
 * @returns {Array<{family: string, use: 'headings'|'body'|'captions'|'other'}>}
 */
export function extractFonts(css, html) {
  const source = stripComments(css);
  const vars = collectVariables(source);

  /** @type {Map<string, string|null>} declared face name (lower case) to its readable family, or null when unusable */
  const faces = new Map();
  for (const block of source.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const body = block[1];
    const declared = cleanName(body.match(/font-family\s*:\s*([^;]+)/i)?.[1] ?? '');
    if (!declared || isNonBrandFont(declared)) continue;
    const key = declared.toLowerCase();
    let readable = readableDeclared(declared);
    if (!readable && isJunkFamily(declared) && !/^__.*fallback_/i.test(declared)) {
      const derived = familyFromSrc(body.match(/src\s*:\s*([^;]+)/i)?.[1] ?? '');
      if (derived) readable = baseFamily(derived);
    }
    if (readable && (!FAMILY_PATTERN.test(readable) || isNonBrandFont(readable))) readable = null;
    if (!faces.has(key) || (faces.get(key) === null && readable)) faces.set(key, readable);
  }

  /** @param {string} name */
  const readableFor = (name) => {
    const cleaned = cleanName(name);
    if (!cleaned || isNonBrandFont(cleaned)) return null;
    const key = cleaned.toLowerCase();
    if (faces.has(key)) return faces.get(key);
    const base = readableDeclared(cleaned);
    return base && FAMILY_PATTERN.test(base) && !isNonBrandFont(base) ? base : null;
  };

  /** @type {Map<string, {family: string, use: 'headings'|'body'|'other', order: number}>} */
  const found = new Map();
  let order = 0;
  const remember = (name, use) => {
    const family = readableFor(name);
    if (!family) return false;
    const key = familyKey(family);
    if (!key) return false;
    const existing = found.get(key);
    if (!existing) found.set(key, { family, use, order: order++ });
    else if (USE_RANK[use] < USE_RANK[existing.use]) existing.use = use;
    return true;
  };

  for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorText = rule[1].trim();
    if (!selectorText || selectorText.startsWith('@')) continue;
    const stack = stackFromDeclarations(rule[2]);
    if (!stack) continue;
    const resolved = resolveVars(stack, vars);
    const uses = new Set(selectorText.split(',').map(usageOf).filter(Boolean));
    if (!uses.size) continue;
    const names = splitStack(resolved);
    for (const use of uses) {
      for (const name of names) {
        if (remember(name, use)) break;
      }
    }
  }

  const listed = [...found.values()].sort((a, b) => USE_RANK[a.use] - USE_RANK[b.use] || a.order - b.order);
  /** @type {Array<{family: string, use: 'headings'|'body'|'captions'|'other'}>} */
  const result = [];
  const seen = new Set();
  const push = (family, use) => {
    const key = familyKey(family);
    if (!key || seen.has(key) || result.length >= FONT_LIMIT) return;
    seen.add(key);
    result.push({ family, use });
  };
  for (const entry of listed) push(entry.family, entry.use);

  for (const match of String(html ?? '').matchAll(/<link\b[^>]*href\s*=\s*["']([^"']*fonts\.googleapis\.com[^"']*)["'][^>]*>/gi)) {
    let urlObj;
    try {
      urlObj = new URL(decodeEntities(match[1]), 'https://fonts.googleapis.com');
    } catch {
      continue;
    }
    for (const param of urlObj.searchParams.getAll('family')) {
      for (const part of param.split('|')) {
        const family = readableFor(part.split(':')[0].replace(/\+/g, ' '));
        if (family) push(family, 'body');
      }
    }
  }

  for (const family of faces.values()) {
    if (family) push(family, 'other');
  }
  return result;
}
