const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_DEPTH = 64;
const MAX_ELEMENTS = 20000;
const MAX_ATTRIBUTES = 100;
const MAX_USES = 50;
const MAX_USE_DEPTH = 3;

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'title', 'desc', 'style',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath', 'mask', 'marker',
  'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'fecomposite', 'feflood',
  'femerge', 'femergenode', 'fecomponenttransfer', 'fefunca', 'fefuncr', 'fefuncg', 'fefuncb',
  'femorphology', 'fedropshadow',
]);
const CANONICAL_NAMES = {
  lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath', textpath: 'textPath',
  fegaussianblur: 'feGaussianBlur', feoffset: 'feOffset', feblend: 'feBlend', fecolormatrix: 'feColorMatrix',
  fecomposite: 'feComposite', feflood: 'feFlood', femerge: 'feMerge', femergenode: 'feMergeNode',
  fecomponenttransfer: 'feComponentTransfer', fefunca: 'feFuncA', fefuncr: 'feFuncR', fefuncg: 'feFuncG',
  fefuncb: 'feFuncB', femorphology: 'feMorphology', fedropshadow: 'feDropShadow',
};
const UNWRAP_ELEMENTS = new Set(['a']);
const TEXT_ELEMENTS = new Set(['title', 'desc', 'text', 'tspan', 'textpath', 'style']);
const HREF_ATTRIBUTES = new Set(['href', 'xlink:href']);
const FRAGMENT_REFERENCE = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;
const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", tab: '\t', newline: '\n', colon: ':' };

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch { return ''; }
}

function validXmlCodePoint(code) {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

function decodeForCheck(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => (NAMED_ENTITIES[name.toLowerCase()] !== undefined ? NAMED_ENTITIES[name.toLowerCase()] : whole))
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/\\\r?\n/g, '')
    .replace(/\\([\s\S])/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .toLowerCase();
}

function decodeXmlText(value) {
  return String(value).replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g, (whole, name, dec, hex) => {
    if (name) return NAMED_ENTITIES[name];
    const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    return validXmlCodePoint(code) ? safeCodePoint(code) : whole;
  });
}

function escapeAmpersands(value) {
  return String(value).replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));|&/g, (whole, name, dec, hex) => {
    if (name) return whole;
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
      return validXmlCodePoint(code) ? whole : `&amp;${whole.slice(1)}`;
    }
    return '&amp;';
  });
}

function escapeAttribute(value) {
  return escapeAmpersands(value).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeText(value) {
  return escapeAmpersands(value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function urlsAreFragmentsOnly(decoded) {
  let index = decoded.indexOf('url(');
  while (index !== -1) {
    const rest = decoded.slice(index + 4).replace(/^['"]/, '');
    if (!rest.startsWith('#')) return false;
    index = decoded.indexOf('url(', index + 4);
  }
  return true;
}

function cssIsSafe(text) {
  const decoded = decodeForCheck(text);
  if (/@import|expression\(|behavior:|-moz-binding|javascript:|vbscript:|data:|<\/?script|image-set\(|image\(|src\(/.test(decoded)) return false;
  if (/@[a-z-]+[^;{}]*["']/.test(decoded)) return false;
  return urlsAreFragmentsOnly(decoded);
}

function plainCssIsSafe(text) {
  if (/[\\&]|\/\*/.test(text)) return false;
  return cssIsSafe(text);
}

function attributeIsSafe(name, value) {
  if (HREF_ATTRIBUTES.has(name)) return FRAGMENT_REFERENCE.test(String(value).trim());
  return plainCssIsSafe(decodeXmlText(value));
}

function parseAttributes(source) {
  const attributes = [];
  const pattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : '';
    attributes.push({ name: match[1], value });
    if (attributes.length > MAX_ATTRIBUTES) return null;
  }
  return attributes;
}

function nearestElement(stack) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (!stack[i].unwrap) return stack[i];
  }
  return null;
}

function scanTag(text, start) {
  let index = start + 1;
  let quote = null;
  while (index < text.length) {
    const ch = text[index];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return index;
    } else if (ch === '<') {
      return -1;
    }
    index += 1;
  }
  return -1;
}

function scanDoctype(text, start) {
  let index = start + 2;
  let quote = null;
  while (index < text.length) {
    const ch = text[index];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[') {
      return -1;
    } else if (ch === '>') {
      return index;
    }
    index += 1;
  }
  return -1;
}

const EXTERNAL_DOCTYPE = /^<!DOCTYPE\s+svg(?:\s+(?:PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')|SYSTEM\s+(?:"[^"]*"|'[^']*')))?\s*>$/i;

function localName(qualified) {
  const colon = qualified.indexOf(':');
  return colon === -1 ? { prefix: '', local: qualified } : { prefix: qualified.slice(0, colon), local: qualified.slice(colon + 1) };
}

function cleanAttributes(attributes) {
  const out = [];
  const seen = new Set();
  for (const { name, value } of attributes) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) return null;
    seen.add(lower);
    if (lower === 'xmlns') {
      if (value.trim() !== SVG_NS) return null;
      continue;
    }
    if (lower.startsWith('xmlns:')) continue;
    if (!ATTRIBUTE_NAME.test(name)) continue;
    if (lower.startsWith('on')) continue;
    const { prefix } = localName(lower);
    if (prefix && prefix !== 'xlink' && prefix !== 'xml') continue;
    if (lower === 'xml:base' || lower === 'xlink:actuate' || lower === 'xlink:show' || lower === 'xlink:type') continue;
    if (lower === 'requiredextensions' || lower === 'externalresourcesrequired' || lower === 'src') continue;
    if (!attributeIsSafe(lower, value)) continue;
    out.push({ name: prefix === 'xlink' || prefix === 'xml' ? lower : name, value: HREF_ATTRIBUTES.has(lower) ? String(value).trim() : value });
  }
  return out;
}

function numberFromLength(value) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(String(value || ''));
  if (!match) return null;
  const number = Math.round(Number(match[1]));
  return number > 0 && number <= 100000 ? number : null;
}

function dimensionsOf(rootAttributes) {
  const find = name => (rootAttributes.find(attribute => attribute.name.toLowerCase() === name) || {}).value;
  let width = numberFromLength(find('width'));
  let height = numberFromLength(find('height'));
  if (!width || !height) {
    const box = String(find('viewbox') || '').trim().split(/[\s,]+/).map(Number);
    if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
      width = width || Math.round(box[2]);
      height = height || Math.round(box[3]);
    }
  }
  return { width: width || null, height: height || null };
}

function toText(input) {
  if (typeof input === 'string') return input;
  if (!Buffer.isBuffer(input)) return null;
  if (input.length >= 2 && ((input[0] === 0xff && input[1] === 0xfe) || (input[0] === 0xfe && input[1] === 0xff))) return null;
  return input.toString('utf8');
}

function useChainProblem(edges, targets) {
  const depths = new Map();
  const visiting = new Set();
  let cyclic = false;
  const depthOf = (id) => {
    if (depths.has(id)) return depths.get(id);
    if (visiting.has(id)) { cyclic = true; return 0; }
    visiting.add(id);
    let best = 0;
    for (const next of edges.get(id) || []) best = Math.max(best, 1 + depthOf(next));
    visiting.delete(id);
    depths.set(id, best);
    return best;
  };
  for (const target of targets) {
    if (1 + depthOf(target) > MAX_USE_DEPTH) return 'use_chain';
    if (cyclic) return 'use_loop';
  }
  for (const id of edges.keys()) {
    depthOf(id);
    if (cyclic) return 'use_loop';
  }
  return null;
}

/**
 * @param {Buffer|string} input
 * @param {{maxInputBytes?: number, maxOutputBytes?: number}} [options]
 */
function sanitizeSvg(input, options = {}) {
  const maxInput = options.maxInputBytes || MAX_INPUT_BYTES;
  const maxOutput = options.maxOutputBytes || MAX_OUTPUT_BYTES;
  const text = toText(input);
  if (text === null) return { ok: false, reason: 'not_text' };
  if (Buffer.byteLength(text, 'utf8') > maxInput) return { ok: false, reason: 'too_large' };
  if (CONTROL_CHARACTERS.test(text)) return { ok: false, reason: 'not_text' };

  const out = [];
  const stack = [];
  const ids = new Set();
  const edges = new Map();
  const useTargets = [];
  let skipDepth = 0;
  let rootSeen = false;
  let rootClosed = false;
  let rootAttributes = [];
  let elements = 0;
  let uses = 0;
  let index = 0;

  while (index < text.length) {
    const lt = text.indexOf('<', index);
    const chunk = lt === -1 ? text.slice(index) : text.slice(index, lt);
    if (chunk) {
      if (!rootSeen || rootClosed) {
        if (chunk.trim()) return { ok: false, reason: 'stray_text' };
      } else if (!skipDepth) {
        const top = nearestElement(stack);
        if (top && top.keepText) {
          if (top.name === 'style') top.styleParts.push(decodeXmlText(chunk));
          else out.push(escapeText(chunk));
        }
      }
    }
    if (lt === -1) break;
    index = lt;

    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end === -1) return { ok: false, reason: 'malformed' };
      index = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index + 9);
      if (end === -1) return { ok: false, reason: 'malformed' };
      const data = text.slice(index + 9, end);
      index = end + 3;
      if (!rootSeen || rootClosed || skipDepth) continue;
      const top = nearestElement(stack);
      if (top && top.keepText) {
        if (top.name === 'style') top.styleParts.push(data);
        else out.push(escapeText(data));
      }
      continue;
    }
    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index + 2);
      if (end === -1) return { ok: false, reason: 'malformed' };
      index = end + 2;
      continue;
    }
    if (text.startsWith('<!', index)) {
      if (rootSeen || !/^<!DOCTYPE/i.test(text.slice(index, index + 9))) return { ok: false, reason: 'doctype' };
      const end = scanDoctype(text, index);
      if (end === -1 || !EXTERNAL_DOCTYPE.test(text.slice(index, end + 1))) return { ok: false, reason: 'doctype' };
      index = end + 1;
      continue;
    }

    const end = scanTag(text, index);
    if (end === -1) return { ok: false, reason: 'malformed' };
    const inner = text.slice(index + 1, end);
    index = end + 1;

    if (inner.startsWith('/')) {
      const closeName = inner.slice(1).trim();
      const open = stack.pop();
      if (!open || open.raw !== closeName) return { ok: false, reason: 'mismatched' };
      if (open.skip) { skipDepth -= 1; continue; }
      if (open.unwrap) continue;
      if (open.name === 'style') {
        const css = open.styleParts.join('');
        if (css.trim() && plainCssIsSafe(css) && !css.includes(']]>')) {
          out.push(`<![CDATA[${css}]]>`);
          out.push(`</${open.outName}>`);
        } else out.length = open.styleOpenIndex;
      } else out.push(`</${open.outName}>`);
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    const selfClosing = /\/\s*$/.test(inner);
    const body = selfClosing ? inner.replace(/\/\s*$/, '') : inner;
    const nameMatch = /^([^\s\/>]+)([\s\S]*)$/.exec(body);
    if (!nameMatch) return { ok: false, reason: 'malformed' };
    const raw = nameMatch[1];
    const { prefix, local } = localName(raw);
    const lowerLocal = local.toLowerCase();

    if (rootClosed) return { ok: false, reason: 'second_root' };
    if (!rootSeen) {
      if (prefix || local !== 'svg') return { ok: false, reason: 'not_svg' };
      rootSeen = true;
    }
    const isRoot = stack.length === 0;
    if (stack.length >= MAX_DEPTH) return { ok: false, reason: 'too_deep' };
    elements += 1;
    if (elements > MAX_ELEMENTS) return { ok: false, reason: 'too_many_elements' };

    const supported = !prefix && ALLOWED_ELEMENTS.has(lowerLocal) && (local === lowerLocal || CANONICAL_NAMES[lowerLocal] === local);
    const unwrap = !prefix && UNWRAP_ELEMENTS.has(lowerLocal);
    if (skipDepth > 0 || (!supported && !unwrap)) {
      if (isRoot) return { ok: false, reason: 'not_svg' };
      if (!selfClosing) {
        stack.push({ raw, skip: true });
        skipDepth += 1;
      }
      continue;
    }
    if (unwrap) {
      if (!selfClosing) stack.push({ raw, unwrap: true });
      continue;
    }

    const attributes = parseAttributes(nameMatch[2]);
    if (!attributes) return { ok: false, reason: 'too_many_attributes' };
    const cleaned = cleanAttributes(attributes);
    if (!cleaned) return { ok: false, reason: 'namespace' };
    const styleType = lowerLocal === 'style' ? (cleaned.find(({ name }) => name === 'type') || {}).value : undefined;
    if (styleType !== undefined && styleType.trim().toLowerCase() !== 'text/css') {
      if (!selfClosing) {
        stack.push({ raw, skip: true });
        skipDepth += 1;
      }
      continue;
    }
    if (isRoot) rootAttributes = cleaned;
    const outName = CANONICAL_NAMES[lowerLocal] || lowerLocal;
    const idValue = (cleaned.find(({ name }) => name === 'id') || {}).value;
    const id = idValue !== undefined && FRAGMENT_REFERENCE.test(`#${idValue}`) ? idValue : null;
    if (id) ids.add(id);

    if (lowerLocal === 'use') {
      uses += 1;
      if (uses > MAX_USES) return { ok: false, reason: 'too_many_uses' };
      const href = cleaned.find(({ name }) => HREF_ATTRIBUTES.has(name));
      if (href) {
        const target = href.value.slice(1);
        useTargets.push(target);
        const owners = stack.filter((entry) => entry.id).map((entry) => entry.id);
        if (id) owners.push(id);
        for (const owner of owners) {
          if (!edges.has(owner)) edges.set(owner, new Set());
          edges.get(owner).add(target);
        }
      }
    }

    let attributeText = cleaned.map(({ name, value }) => ` ${name}="${escapeAttribute(value)}"`).join('');
    if (isRoot) attributeText = ` xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"${attributeText}`;

    if (lowerLocal === 'style') {
      if (selfClosing) continue;
      stack.push({ raw, name: 'style', outName, keepText: true, styleParts: [], styleOpenIndex: out.length, id });
      out.push(`<${outName}${attributeText}>`);
      continue;
    }
    if (selfClosing) {
      out.push(`<${outName}${attributeText}/>`);
      if (isRoot) rootClosed = true;
    } else {
      stack.push({ raw, name: lowerLocal, outName, keepText: TEXT_ELEMENTS.has(lowerLocal), id });
      out.push(`<${outName}${attributeText}>`);
    }
  }

  if (!rootSeen) return { ok: false, reason: 'not_svg' };
  if (stack.length) return { ok: false, reason: 'malformed' };
  const chainProblem = useChainProblem(edges, useTargets);
  if (chainProblem) return { ok: false, reason: chainProblem };
  const svg = out.join('');
  const buffer = Buffer.from(svg, 'utf8');
  if (buffer.length > maxOutput) return { ok: false, reason: 'too_large' };
  const { width, height } = dimensionsOf(rootAttributes);
  const danglingUse = useTargets.some((target) => !ids.has(target));
  return { ok: true, svg, buffer, width, height, danglingUse };
}

/** @param {Buffer} buffer */
function looksLikeSvg(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;
  const head = buffer.slice(0, 4096).toString('utf8').replace(/^\ufeff/, '');
  const stripped = head.replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^\[>]*(?:\[[\s\S]*?\]\s*)?>\s*)*/i, '');
  return /^<svg[\s>]/i.test(stripped);
}

module.exports = { sanitizeSvg, looksLikeSvg, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, SVG_NS };
