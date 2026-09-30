import { decodeEntities } from '../social/backends/web.mjs';

const ICON_HINT = /(search|cart|bag|basket|menu|hamburger|burger|close|arrow|chevron|caret|user|account|login|profile|wishlist|heart|social|facebook|instagram|tiktok|twitter|youtube|pinterest|whatsapp|share|globe|language|locale|flag|phone|mail|email|envelope|location|store-locator|play|pause|plus|minus|star|check)/i;
const STOP_WORDS = new Set(['the', 'shop', 'official', 'home', 'welcome', 'store', 'online', 'www']);
const GENERIC_SEGMENTS = new Set(['home', 'homepage', 'welcome', 'official', 'officialsite', 'shop', 'store', 'online', 'onlinestore', 'onlineshop', 'index', 'main', 'menu']);
const HOME_PATH = /^\/(?:index\.(?:html?|php|aspx?))?$|^\/[a-z]{2}(?:[-_][a-z]{2})?(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/?$/i;
const REDIRECT_PATH = /^\/(?:go|out|r|l|link|goto|redirect|share|social)\//i;
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const MAX_SCOPE_BLOCKS = 3;
const MAX_SCOPE_MEDIA = 60;
const MAX_INLINE_SVG_CHARS = 400 * 1024;
const MAX_SYMBOL_LOOKUPS = 20;
const MAX_SYMBOL_CHARS = 100 * 1024;
const MAX_ANCESTOR_DEPTH = 512;
const MAX_NAME_CHARS = 4000;
const MAX_REGION_CACHE = 4000;
export const MAX_LOGO_CANDIDATES = 3;

export const THIRD_PARTY_BRANDS = [
  'gmail', 'google mail', 'googlemail', 'google', 'outlook', 'yahoo', 'hotmail', 'icloud', 'protonmail',
  'facebook', 'instagram', 'tiktok', 'linkedin', 'twitter', 'x-twitter', 'x-logo', 'youtube', 'whatsapp', 'telegram',
  'pinterest', 'snapchat', 'messenger', 'wechat', 'reddit', 'discord', 'tumblr', 'vimeo', 'spotify',
  'threads', 'line', 'kakao', 'weibo', 'xiaohongshu', 'behance', 'dribbble', 'github', 'tripadvisor',
  'apple', 'app store', 'google play', 'play store', 'huawei appgallery', 'ios', 'android', 'amazon', 'microsoft',
  'visa', 'mastercard', 'mc', 'paypal', 'maestro', 'amex', 'american express', 'jcb', 'unionpay', 'stripe', 'klarna',
  'apple pay', 'google pay', 'gpay', 'alipay', 'discover', 'diners', 'paynow', 'grabpay', 'atome', 'nets',
  'shopify pay', 'afterpay',
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compactKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const WHOLE_X = /(?<![a-z0-9])x(?![a-z0-9])/i;
const THIRD_PARTY_MATCHERS = THIRD_PARTY_BRANDS.map((name) => {
  const key = compactKey(name);
  if (key === 'xlogo') return { key, pattern: WHOLE_X };
  const glue = key.length < 5 ? '' : '[\\s_-]*';
  return { key, pattern: new RegExp(`(?<![a-z0-9])${[...name.replace(/[\s-]+/g, '')].map(escapeRegExp).join(glue)}(?![a-z])`, 'i') };
});
const SECTION_BLOCKED = /(?<![a-z0-9])(?:contact|social|follow|share|sharing|newsletter|subscribe|payments?|badges?|partners?|clients?|sponsors?|logos|carousel|slider|swiper|trusted|customers|press|featured|awards|as[\s_-]*seen)(?![a-z])/gi;
const SECTION_FOOTER = /(?<![a-z0-9])footer(?![a-z])/i;
const SHORT_SOCIAL = /(?<![a-z0-9])(?:fb|ig|tw|yt|li|wa)(?![a-z])/i;
const ICON_WORD = new RegExp(`(?<![a-z0-9])(?:${ICON_HINT.source.slice(1, -1).split('|').filter((word) => !THIRD_PARTY_MATCHERS.some(({ key }) => key === word)).join('|')})(?![a-z])`, 'i');
const PLATFORM_ICON_NAME = /apple[\s_-]*(?:touch[\s_-]*)?icon(?:[\s_-]*precomposed)?|android[\s_-]*chrome/gi;
const SITE_NAME_PREFIX = /^(?:welcome\s+to|welcome|home\s+of|the\s+official\s+site\s+of|official\s+site\s+of|official)\s+/i;

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const splitCamel = (value) => String(value).replace(/([a-z])([A-Z])/g, '$1 $2');
const titleSegments = (title) => decodeEntities(title).split(/\s[^\w\s]\s|\|/);

/**
 * @param {string} html
 * @param {Record<string, string>} meta
 * @param {string} finalUrl
 * @returns {string[]}
 */
function brandNames(html, meta, finalUrl) {
  const raw = [];
  if (meta['og:site_name']) raw.push(meta['og:site_name']);
  if (meta['application-name']) raw.push(meta['application-name']);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) raw.push(titleSegments(title)[0]);
  try {
    const host = new URL(finalUrl).hostname.replace(/^www\d?\./i, '').split('.')[0];
    if (host) raw.push(host);
  } catch {
    raw.push('');
  }
  return raw;
}

/**
 * @param {string} html
 * @param {Record<string, string>} meta
 * @param {string} finalUrl
 * @returns {string[]}
 */
export function brandTokens(html, meta, finalUrl) {
  const tokens = new Set();
  for (const value of brandNames(html, meta, finalUrl)) {
    const whole = normalize(value);
    if (whole.length >= 3) tokens.add(whole);
    const first = normalize(String(value).trim().split(/[\s\-_]+/)[0]);
    if (first.length >= 3 && !STOP_WORDS.has(first)) tokens.add(first);
  }
  return [...tokens];
}

/**
 * @param {string} html
 * @param {Record<string, string>} meta
 * @param {string} finalUrl
 * @returns {{tokens: string[], exemptTokens: string[], ownKeys: string[]}}
 */
function brandContext(html, meta, finalUrl) {
  const names = [];
  if (meta['og:site_name']) names.push(meta['og:site_name']);
  if (meta['application-name']) names.push(meta['application-name']);
  try {
    const host = new URL(finalUrl).hostname.replace(/^www\d?\./i, '').split('.')[0];
    if (host) names.push(host);
  } catch {
    names.push('');
  }
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) {
    for (const segment of titleSegments(title)) {
      const clean = segment.trim().replace(SITE_NAME_PREFIX, '');
      if (clean && !GENERIC_SEGMENTS.has(normalize(clean))) names.push(clean);
    }
  }
  const exempt = new Set();
  for (const name of names) {
    const words = String(name).trim().split(/[\s\-_]+/).filter(Boolean);
    for (let count = Math.min(words.length, 6); count >= (words.length > 1 ? 2 : 1); count -= 1) exempt.add(normalize(words.slice(0, count).join('')));
    exempt.add(normalize(name));
  }
  const exemptTokens = [...exempt].filter((token) => token.length >= 3);
  let ownKeys = [];
  if (names.some((name) => normalize(name) === 'x')) ownKeys = ['xlogo', 'xtwitter', 'twitter'];
  else if (names.some((name) => WHOLE_X.test(name) || /[a-z]X$/.test(name.trim()))) ownKeys = ['xlogo'];
  return { tokens: brandTokens(html, meta, finalUrl), exemptTokens, ownKeys };
}

/** @param {string} text @param {string[]} tokens */
function mentionsBrand(text, tokens) {
  const flat = normalize(text);
  return tokens.some((token) => flat.includes(token));
}

/** @param {string} text @param {string[]} tokens */
function mentionsLogoOrBrand(text, tokens) {
  return /logo/i.test(text) || mentionsBrand(text, tokens);
}

const attributePatterns = new Map();

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  let pattern = attributePatterns.get(name);
  if (!pattern) {
    pattern = new RegExp(`(?:^|[\\s"'/])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    attributePatterns.set(name, pattern);
  }
  const match = tag.match(pattern);
  const value = match ? (match[1] ?? match[2] ?? match[3]) : null;
  return value === null ? null : decodeEntities(value);
}

/** @param {string} value */
function isSvgUrl(value) {
  try {
    return /\.svg$/i.test(new URL(value, 'https://placeholder.invalid').pathname);
  } catch {
    return /\.svg(?:[?#]|$)/i.test(value);
  }
}

const stripWww = (host) => host.toLowerCase().replace(/^www\d?\./, '');
const hostLabel = (host) => stripWww(host).split('.')[0];

/** @param {string} a @param {string} b */
function sameSite(a, b) {
  const x = stripWww(a);
  const y = stripWww(b);
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/** @param {URL} url */
const isHomePath = (url) => url.pathname === '/' || (HOME_PATH.test(url.pathname) && !REDIRECT_PATH.test(url.pathname));

/** @param {string} href @param {string} finalUrl */
function isHomeHref(href, finalUrl) {
  if (!href || /^(?:javascript|mailto|tel):/i.test(href.trim())) return false;
  try {
    const base = new URL(finalUrl);
    const url = new URL(decodeEntities(href), base);
    if (!/^https?:$/.test(url.protocol) || stripWww(url.hostname) !== stripWww(base.hostname)) return false;
    return isHomePath(url);
  } catch {
    return false;
  }
}

/**
 * @param {string} open
 * @param {string} finalUrl
 * @param {boolean} namesBrand
 * @returns {'none'|'internal'|'home'|'reject'}
 */
function linkVerdict(open, finalUrl, namesBrand) {
  if (!open) return 'none';
  const href = (attribute(open, 'href') ?? '').trim();
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return 'internal';
  try {
    const url = new URL(decodeEntities(href), finalUrl);
    if (!/^https?:$/.test(url.protocol)) return 'reject';
    const baseHost = new URL(finalUrl).hostname;
    if (!sameSite(url.hostname, baseHost)) {
      if (namesBrand && hostLabel(url.hostname) === hostLabel(baseHost) && isHomePath(url)) return 'home';
      return 'reject';
    }
  } catch {
    return 'internal';
  }
  return isHomeHref(href, finalUrl) ? 'home' : 'internal';
}

/** @param {string} open */
function linkPath(open) {
  const href = (attribute(open, 'href') ?? '').trim();
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return '';
  try {
    return decodeURIComponent(new URL(href, 'https://placeholder.invalid').pathname);
  } catch {
    return href;
  }
}

/** @param {string} value */
export function fileName(value) {
  const last = value.split(/[?#]/)[0].split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** @param {string} tag */
function tagNames(tag) {
  const parts = ['alt', 'title', 'class', 'id', 'aria-label'].map((name) => attribute(tag, name) ?? '');
  for (const name of ['src', 'data-src']) {
    const value = attribute(tag, name);
    if (value) parts.push(fileName(value));
  }
  return parts.join(' ');
}

/** @param {string} tag */
function sourceOf(tag) {
  return `${attribute(tag, 'src') ?? ''} ${attribute(tag, 'data-src') ?? ''}`;
}

/** @param {string} open */
function linkNames(open) {
  return ['title', 'class', 'id', 'aria-label'].map((name) => attribute(open, name) ?? '').join(' ');
}

/** @param {string} open @param {string} inner */
function svgNames(open, inner) {
  const head = inner.slice(0, MAX_NAME_CHARS * 5);
  const parts = [tagNames(open), head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''];
  for (const match of head.matchAll(/<use\b[^>]*?href\s*=\s*["']#([^"']*)["']/gi)) parts.push(match[1]);
  return parts.join(' ');
}

/**
 * @param {string} text
 * @param {string[]} tokens
 * @param {string[]} [ownKeys]
 */
export function namesThirdParty(text, tokens, ownKeys = []) {
  const clipped = String(text).slice(0, MAX_NAME_CHARS);
  const spaced = splitCamel(clipped);
  const flat = normalize(clipped);
  return THIRD_PARTY_MATCHERS.some(({ key, pattern }) => pattern.test(spaced) && !ownKeys.includes(key) && !tokens.some((token) => token.includes(key) && flat.includes(token)));
}

/**
 * @param {{exemptTokens: string[], ownKeys: string[]}} context
 * @returns {(text: string) => boolean}
 */
function thirdPartyChecker(context) {
  return (text) => namesThirdParty(String(text).slice(0, MAX_NAME_CHARS).replace(PLATFORM_ICON_NAME, ''), context.exemptTokens, context.ownKeys);
}

/**
 * @param {string} html
 * @param {Record<string, string>} meta
 * @param {string} finalUrl
 * @returns {(text: string) => boolean}
 */
export function thirdPartyCheck(html, meta, finalUrl) {
  return thirdPartyChecker(brandContext(html, meta, finalUrl));
}

/**
 * @param {string} tag
 * @param {string[]} exemptTokens
 * @returns {{footerTag: boolean, footerClass: boolean, blocked: boolean, button: boolean}}
 */
function tagRegion(tag, exemptTokens) {
  const name = tag.match(/^<([a-z][a-z0-9-]*)/i)?.[1].toLowerCase();
  if (name === 'html' || name === 'body') return { footerTag: false, footerClass: false, blocked: false, button: false };
  const role = attribute(tag, 'role') ?? '';
  const marks = splitCamel(['class', 'id', 'aria-label'].map((attr) => attribute(tag, attr) ?? '').join(' ')).slice(0, MAX_NAME_CHARS);
  const flat = normalize(marks);
  let blocked = false;
  for (const match of marks.matchAll(SECTION_BLOCKED)) {
    const word = normalize(match[0]);
    if (!exemptTokens.some((token) => token.includes(word) && flat.includes(token))) {
      blocked = true;
      break;
    }
  }
  return { footerTag: name === 'footer' || /contentinfo/i.test(role), footerClass: SECTION_FOOTER.test(marks), blocked, button: name === 'button' || /^button$/i.test(role) };
}

/** @param {string} html @param {string} tag */
function blocks(html, tag) {
  const out = [];
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'))) {
    out.push({ markup: match[0], index: match.index });
    if (out.length >= MAX_SCOPE_BLOCKS) break;
  }
  return out;
}

/**
 * @param {string} html
 * @returns {Array<{index: number, markup: string, open: string}>}
 */
export function inlineSvgs(html) {
  const found = [];
  const tags = /<(\/?)svg\b[^>]*>/gi;
  let depth = 0;
  let start = -1;
  let open = '';
  let match;
  while ((match = tags.exec(html)) !== null) {
    if (match[1]) {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const markup = html.slice(start, match.index + match[0].length);
        if (markup.length <= MAX_INLINE_SVG_CHARS) found.push({ index: start, markup, open });
        start = -1;
      }
    } else {
      if (/\/\s*>$/.test(match[0]) && depth === 0) continue;
      if (depth === 0) {
        start = match.index;
        open = match[0];
      }
      depth += 1;
    }
  }
  return found;
}

/**
 * @param {string} html
 * @param {Set<string>} wanted
 * @returns {string[]}
 */
function findSymbols(html, wanted) {
  const found = new Map();
  let position = 0;
  let chars = 0;
  while (found.size < wanted.size) {
    const start = html.indexOf('<symbol', position);
    if (start === -1) break;
    const openEnd = html.indexOf('>', start);
    if (openEnd === -1) break;
    const close = html.indexOf('</symbol>', openEnd);
    if (close === -1) break;
    const markup = html.slice(start, close + '</symbol>'.length);
    position = close + '</symbol>'.length;
    const id = attribute(html.slice(start, openEnd + 1), 'id');
    if (id && wanted.has(id) && !found.has(id) && chars + markup.length <= MAX_SYMBOL_CHARS) {
      found.set(id, markup);
      chars += markup.length;
    }
  }
  return [...found.values()];
}

/**
 * @param {string} markup
 * @param {string} html
 */
export function withReferencedSymbols(markup, html) {
  const ids = new Set();
  for (const match of markup.matchAll(/<use\b[^>]*?(?:xlink:)?href\s*=\s*["']#([^"']+)["']/gi)) {
    ids.add(match[1]);
    if (ids.size >= MAX_SYMBOL_LOOKUPS) break;
  }
  if (!ids.size) return markup;
  const defined = new Set([...markup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]));
  const wanted = new Set([...ids].filter((id) => !defined.has(id)));
  if (!wanted.size) return markup;
  const symbols = findSymbols(html, wanted);
  if (!symbols.length) return markup;
  return markup.replace(/(<svg\b[^>]*>)/i, `$1<defs>${symbols.join('')}</defs>`);
}

const P_CLOSERS = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search',
  'section', 'summary', 'table', 'ul',
]);
const P_SCOPE_STOPS = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template', 'button']);
const IMPLIED_END = {
  li: { targets: new Set(['li']), stops: new Set(['ul', 'ol', 'menu']) },
  dt: { targets: new Set(['dt', 'dd']), stops: new Set(['dl']) },
  dd: { targets: new Set(['dt', 'dd']), stops: new Set(['dl']) },
  option: { targets: new Set(['option']), stops: new Set(['select', 'datalist', 'optgroup']) },
  optgroup: { targets: new Set(['option', 'optgroup']), stops: new Set(['select']) },
  tr: { targets: new Set(['tr']), stops: new Set(['table', 'tbody', 'thead', 'tfoot']) },
  td: { targets: new Set(['td', 'th']), stops: new Set(['tr', 'table']) },
  th: { targets: new Set(['td', 'th']), stops: new Set(['tr', 'table']) },
  thead: { targets: new Set(['tbody', 'thead', 'tfoot']), stops: new Set(['table']) },
  tbody: { targets: new Set(['tbody', 'thead', 'tfoot']), stops: new Set(['table']) },
  tfoot: { targets: new Set(['tbody', 'thead', 'tfoot']), stops: new Set(['table']) },
};
const RAW_TEXT_OPEN = /<!--|<!\[CDATA\[|<(script|noscript|template)\b[^>]*>/gi;

/**
 * @param {string} html
 * @returns {string}
 */
function maskInert(html) {
  if (!/<!--|<!\[CDATA\[|<(?:script|noscript|template)\b/i.test(html)) return html;
  const parts = [];
  let copied = 0;
  const blank = (from, to) => {
    parts.push(html.slice(copied, from), ' '.repeat(to - from));
    copied = to;
  };
  RAW_TEXT_OPEN.lastIndex = 0;
  let match;
  while ((match = RAW_TEXT_OPEN.exec(html)) !== null) {
    const opener = match[0];
    let from = match.index;
    let to;
    let resume;
    if (opener === '<!--') {
      const close = html.indexOf('-->', from + 4);
      to = close === -1 ? html.length : close + 3;
      resume = to;
    } else if (opener === '<![CDATA[') {
      const close = html.indexOf(']]>', from + 9);
      to = close === -1 ? html.length : close + 3;
      resume = to;
    } else {
      from = match.index + opener.length;
      const closer = new RegExp(`<\\/${match[1]}\\b`, 'gi');
      closer.lastIndex = from;
      const found = closer.exec(html);
      to = found ? found.index : html.length;
      resume = to;
    }
    if (to > from) blank(from, to);
    RAW_TEXT_OPEN.lastIndex = Math.max(resume, match.index + 1);
  }
  parts.push(html.slice(copied));
  return parts.join('');
}

/**
 * @param {string} scope
 * @param {number[]} indices
 * @param {(tag: string) => any} regionOf
 * @returns {Map<number, {tags: string[], regions: any[], parent: number}>}
 */
function ancestorTags(scope, indices, regionOf) {
  const result = new Map();
  const stack = [];
  const open = Object.create(null);
  let next = 0;
  let version = 0;
  let cached = null;
  const snapshot = () => {
    if (!cached || cached.version !== version) {
      cached = { version, value: { tags: stack.map((entry) => entry.tag), regions: stack.map((entry) => entry.region), parent: stack.length ? stack[stack.length - 1].start : -1 } };
    }
    return cached.value;
  };
  const popTo = (at) => {
    version += 1;
    while (stack.length > at) open[stack.pop().name] -= 1;
  };
  const closeImplied = (name) => {
    const rule = IMPLIED_END[name];
    const targets = rule ? rule.targets : P_CLOSERS.has(name) && open.p > 0 ? new Set(['p']) : null;
    if (!targets) return;
    const stops = rule ? rule.stops : P_SCOPE_STOPS;
    for (let at = stack.length - 1; at >= 0; at -= 1) {
      const candidate = stack[at].name;
      if (targets.has(candidate)) {
        popTo(at);
        return;
      }
      if (stops.has(candidate)) return;
    }
  };
  for (const match of scope.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    while (next < indices.length && indices[next] <= match.index) {
      result.set(indices[next], snapshot());
      next += 1;
    }
    if (next >= indices.length || stack.length > MAX_ANCESTOR_DEPTH) break;
    const name = match[2].toLowerCase();
    if (match[1]) {
      if (!open[name]) continue;
      let at = stack.length - 1;
      while (at >= 0 && stack[at].name !== name) at -= 1;
      if (at !== -1) popTo(at);
    } else if (!VOID_ELEMENTS.has(name) && !/\/\s*>$/.test(match[0])) {
      closeImplied(name);
      version += 1;
      stack.push({ name, tag: match[0], start: match.index, region: regionOf(match[0]) });
      open[name] = (open[name] ?? 0) + 1;
    }
  }
  while (next < indices.length) {
    result.set(indices[next], snapshot());
    next += 1;
  }
  return result;
}

/**
 * @param {string} html
 * @param {Record<string, string>} meta
 * @param {string} finalUrl
 * @returns {Array<{kind: 'header_img', url: string} | {kind: 'header_img', inline: string, url: string}>}
 */
export function findHeaderLogos(html, meta, finalUrl) {
  const context = brandContext(html, meta, finalUrl);
  const { tokens } = context;
  const namesThirdPartyBrand = thirdPartyChecker(context);
  const masked = maskInert(html);
  /** @type {Array<{score: number, order: number, pick: any}>} */
  const headerFound = [];
  /** @type {Array<{score: number, order: number, pick: any}>} */
  const pageFound = [];
  /** @type {Array<{score: number, order: number, pick: any}>} */
  const footerFound = [];
  let order = 0;
  const resolve = (src) => {
    try {
      return new URL(decodeEntities(src), finalUrl).href;
    } catch {
      return null;
    }
  };
  const lastLink = (chain) => {
    for (let at = chain.length - 1; at >= 0; at -= 1) if (/^<a\b/i.test(chain[at])) return chain[at];
    return '';
  };
  const regionCache = new Map();
  const regionOfTag = (tag) => {
    let region = regionCache.get(tag);
    if (!region) {
      if (regionCache.size >= MAX_REGION_CACHE) regionCache.clear();
      region = tagRegion(tag, context.exemptTokens);
      regionCache.set(tag, region);
    }
    return region;
  };
  const regionOfChain = (regions, localFrom, blockFrom) => {
    let footer = false;
    let blocked = false;
    for (let at = 0; at < regions.length; at += 1) {
      const region = regions[at];
      if (region.footerTag || (at >= localFrom && region.footerClass)) footer = true;
      if (at >= blockFrom && region.blocked) blocked = true;
    }
    return { footer, blocked };
  };
  const indirectSocial = (tag, open, verdict, brandNamed) => {
    if (verdict !== 'internal' || !open) return false;
    if (SHORT_SOCIAL.test(fileName(attribute(tag, 'src') ?? attribute(tag, 'data-src') ?? '').replace(/\.[a-z0-9]+$/i, ''))) return true;
    const path = linkPath(open);
    return Boolean(path) && !brandNamed && (namesThirdPartyBrand(path) || SHORT_SOCIAL.test(path));
  };

  const scopes = [...blocks(masked, 'header'), ...blocks(masked, 'nav')];
  const outer = ancestorTags(masked, scopes.map((scope) => scope.index).sort((a, b) => a - b), regionOfTag);
  for (const { markup: scope, index: scopeIndex } of scopes) {
    const original = html.slice(scopeIndex, scopeIndex + scope.length);
    const links = [...scope.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map((match) => {
      const open = match[0].match(/^<a\b[^>]*>/i)?.[0] ?? '';
      return { start: match.index, end: match.index + match[0].length, open, home: isHomeHref(attribute(open, 'href') ?? '', finalUrl), seen: 0 };
    });
    const linkAt = (index) => links.find((link) => index >= link.start && index < link.end) ?? null;

    /** @type {Array<{index: number, kind: 'img'|'svg', tag: string, markup?: string}>} */
    const media = [];
    for (const match of scope.matchAll(/<img\b[^>]*>/gi)) media.push({ index: match.index, kind: 'img', tag: match[0] });
    for (const svg of inlineSvgs(scope)) media.push({ index: svg.index, kind: 'svg', tag: svg.open, markup: original.slice(svg.index, svg.index + svg.markup.length) });
    media.sort((a, b) => a.index - b.index);
    media.length = Math.min(media.length, MAX_SCOPE_MEDIA);
    const ancestors = ancestorTags(scope, media.map((item) => item.index), regionOfTag);
    const outerRegions = outer.get(scopeIndex)?.regions ?? [];

    for (const item of media) {
      const link = linkAt(item.index);
      const first = link ? link.seen === 0 : false;
      if (link) link.seen += 1;
      const linkText = link ? link.open : '';
      const found = ancestors.get(item.index);
      const local = found?.tags ?? [];
      const localRegions = found?.regions ?? [];
      const inner = item.markup ?? '';
      const names = item.kind === 'img' ? tagNames(item.tag) : svgNames(item.tag, inner);
      const linked = link ? linkNames(linkText) : '';
      const brandNamed = mentionsBrand(`${names} ${sourceOf(item.tag)} ${linked}`, tokens);
      const verdict = linkVerdict(linkText, finalUrl, brandNamed);
      if (verdict === 'reject') continue;
      const region = regionOfChain(outerRegions.concat(localRegions, [regionOfTag(item.tag)]), outerRegions.length, outerRegions.length + 1);
      if (region.blocked && !(verdict === 'home' && brandNamed)) continue;
      if (localRegions.some((entry) => entry.button)) continue;
      if (namesThirdPartyBrand(`${names} ${linked}`)) continue;
      if (indirectSocial(item.tag, linkText, verdict, brandNamed)) continue;
      const homeFirst = Boolean(link && first && (link.home || verdict === 'home'));
      const target = region.footer ? footerFound : headerFound;
      if (item.kind === 'img') {
        const src = attribute(item.tag, 'src') ?? attribute(item.tag, 'data-src');
        if (!src || /^data:/i.test(src)) continue;
        const mentionText = `${item.tag} ${linkText}`;
        const mention = mentionsLogoOrBrand(mentionText, tokens);
        const svgFile = isSvgUrl(src);
        const accepted = svgFile ? mention || homeFirst : /logo/i.test(mentionText);
        if (!accepted) continue;
        if (ICON_WORD.test(names) && !mentionsBrand(mentionText, tokens)) continue;
        const url = resolve(src);
        if (url) target.push({ score: (mention ? 3 : 2) + (mention && homeFirst ? 2 : 0), order: order++, pick: { kind: 'header_img', url } });
      } else {
        const parents = local.filter((tag) => !/^<(?:header|nav|html|body)\b/i.test(tag));
        const label = `${item.tag} ${inner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''} ${linkText}`;
        const mention = mentionsLogoOrBrand(label, tokens) || parents.some((tag) => /logo|brand/i.test(tag));
        if (!mention && !homeFirst) continue;
        if (ICON_HINT.test(`${item.tag} ${linkText}`) && !mention) continue;
        target.push({ score: (mention ? 3 : 2) + (mention && homeFirst ? 2 : 0), order: order++, pick: { kind: 'header_img', inline: inner, url: finalUrl } });
      }
    }
  }

  if (!headerFound.length) {
    const images = [];
    for (const match of masked.matchAll(/<img\b[^>]*>/gi)) {
      if (!/logo/i.test(match[0])) continue;
      images.push({ index: match.index, tag: match[0] });
      if (images.length >= MAX_SCOPE_MEDIA) break;
    }
    const ancestors = ancestorTags(masked, images.map((image) => image.index), regionOfTag);
    const siblings = new Map();
    for (const { index } of images) {
      const parent = ancestors.get(index)?.parent ?? -1;
      siblings.set(parent, (siblings.get(parent) ?? 0) + 1);
    }
    for (const { index, tag } of images) {
      const src = attribute(tag, 'src') ?? attribute(tag, 'data-src');
      if (!src || /^data:/i.test(src)) continue;
      const found = ancestors.get(index);
      const chain = found?.tags ?? [];
      if (found && found.parent !== -1 && siblings.get(found.parent) > 1) continue;
      const open = lastLink(chain);
      const names = tagNames(tag);
      const linked = open ? linkNames(open) : '';
      const brandNamed = mentionsBrand(`${names} ${sourceOf(tag)} ${linked}`, tokens);
      const verdict = linkVerdict(open, finalUrl, brandNamed);
      if (verdict === 'reject') continue;
      const region = regionOfChain((found?.regions ?? []).concat([regionOfTag(tag)]), 0, 0);
      if (region.blocked && !(verdict === 'home' && brandNamed)) continue;
      if ((found?.regions ?? []).some((entry) => entry.button)) continue;
      if (!region.footer && verdict !== 'home' && !brandNamed) continue;
      if (namesThirdPartyBrand(`${names} ${linked}`)) continue;
      if (indirectSocial(tag, open, verdict, brandNamed)) continue;
      if (ICON_WORD.test(names) && !brandNamed) continue;
      const url = resolve(src);
      if (url) (region.footer ? footerFound : pageFound).push({ score: 3 + (verdict === 'home' ? 2 : 0), order: order++, pick: { kind: 'header_img', url } });
    }
  }

  const found = headerFound.length ? headerFound : pageFound.length ? pageFound : footerFound;
  const seen = new Set();
  return found
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.pick)
    .filter((pick) => {
      const key = pick.inline ?? pick.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_LOGO_CANDIDATES);
}

/**
 * @param {string} html
 * @param {string} finalUrl
 */
export function findIconLinks(html, finalUrl) {
  const svgIcons = [];
  let manifest = null;
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (attribute(tag, 'rel') ?? '').toLowerCase();
    const href = attribute(tag, 'href');
    if (!href) continue;
    let url;
    try {
      url = new URL(href, finalUrl).href;
    } catch {
      continue;
    }
    if (/\bmanifest\b/.test(rel) && !manifest) manifest = url;
    else if (/\bicon\b/.test(rel) && !/apple-touch-icon|mask-icon/.test(rel)) {
      const type = (attribute(tag, 'type') ?? '').toLowerCase();
      if (type === 'image/svg+xml' || (!type && isSvgUrl(href))) svgIcons.push(url);
    }
  }
  return { svgIcons, manifest };
}

/**
 * @param {string} text
 * @param {string} manifestUrl
 * @returns {string[]}
 */
export function manifestIconUrls(text, manifestUrl) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const icons = Array.isArray(parsed && parsed.icons) ? parsed.icons : [];
  const entries = [];
  for (const icon of icons) {
    if (!icon || typeof icon.src !== 'string') continue;
    let url;
    try {
      url = new URL(icon.src, manifestUrl).href;
    } catch {
      continue;
    }
    const type = String(icon.type ?? '').toLowerCase();
    const size = Math.max(0, ...String(icon.sizes ?? '').split(/\s+/).map((part) => Number(part.split(/x/i)[0]) || 0));
    const svg = type === 'image/svg+xml' || isSvgUrl(icon.src);
    entries.push({ url, svg, size });
  }
  const svgs = entries.filter((entry) => entry.svg);
  if (svgs.length) return [svgs[0].url];
  const raster = entries.filter((entry) => entry.size >= 192).sort((a, b) => b.size - a.size);
  return raster.length ? [raster[0].url] : [];
}
