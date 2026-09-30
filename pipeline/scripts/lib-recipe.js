const fs = require('fs');
const path = require('path');

const FIELDS = Object.freeze(['pillar', 'angle', 'hookFamily', 'cta', 'hashtags']);
const FIELD_WORDS = Object.freeze({
  pillar: 'content pillar',
  angle: 'angle',
  hookFamily: 'hook family',
  cta: 'call to action',
  hashtags: 'hashtag set',
});
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 3;
const MAX_HASHTAGS = 30;
const OPTIONS_FILE = 'recipe-options.json';
const RECIPE_FILE = 'recipe.json';
const CTA_STYLES = Object.freeze(['link_caption', 'link_bio', 'story_sticker', 'comment_keyword', 'dm', 'save', 'share_send', 'question', 'follow', 'none']);
const CTA_NOT_ON = Object.freeze({
  facebook: Object.freeze(['link_bio', 'story_sticker']),
  instagram: Object.freeze(['link_caption']),
  tiktok: Object.freeze(['link_caption', 'story_sticker']),
});
const CTA_WORDS = Object.freeze({
  link_caption: 'a link in the caption',
  link_bio: 'a link in the bio',
  story_sticker: 'a story link sticker',
});
const HOOKS_FILE = path.join(__dirname, '..', 'playbooks', 'hooks.md');
const TAG = /^#[\p{L}\p{N}_]+$/u;
const TAGS_IN_TEXT = /#[\p{L}\p{N}_]+/gu;
const NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|million|half|double|twice|triple)\b/i;
const VIEWER = /\b(you|your|you're|youre|yours|yourself)\b/i;
const FIRST_PERSON = /\b(i|i'm|im|i've|ive|i'd|me|my|mine|we|we're|we've|our|ours|us)\b/i;

const MECHANISM_TESTS = Object.freeze({
  question: { test: text => text.includes('?'), need: 'a question hook has to ask a question, with a question mark' },
  identity_callout: {
    test: text => VIEWER.test(text) || /\b(if you|for (anyone|everyone|every|people|those))\b/i.test(text),
    need: 'an identity call-out speaks to the viewer, for example "If you\'re a..." or "For anyone who..."',
  },
  relatable_callout: {
    test: text => VIEWER.test(text) || /\b(we all|pov|anyone else|everyone|nobody|when you)\b/i.test(text),
    need: 'a relatable call-out names a moment the viewer knows, for example "When you..." or "POV:"',
  },
  specificity: { test: text => NUMBER.test(text), need: 'a specific hook carries a real number' },
  listicle_promise: { test: text => NUMBER.test(text), need: 'a list promise says how many' },
  cold_open_result: { test: text => NUMBER.test(text), need: 'a cold-open result leads with the number' },
  tutorial_cold_start: {
    test: text => /\b(how|steps?|way to|guide|tutorial|here'?s)\b/i.test(text),
    need: 'a tutorial opening says how, for example "How I..." or "The way to..."',
  },
  confession: { test: text => FIRST_PERSON.test(text), need: 'a confession is told in the first person' },
  transformation: {
    test: text => /\bfrom\b[\s\S]*\bto\b|\b(before|after|used to|now|turned|became|went)\b/i.test(text),
    need: 'a transformation shows two states, for example "from... to..." or "before... now..."',
  },
  contrarian: {
    test: text => /\b(wrong|stop|don'?t|never|not|isn'?t|aren'?t|overrated|unpopular|actually|instead|but|myth)\b/i.test(text),
    need: 'a contrarian hook pushes against common advice, for example "Stop..." or "...is wrong"',
  },
  myth_bust: {
    test: text => /\b(myth|wrong|not true|actually|lie|lies|stop|don'?t|never|isn'?t|aren'?t|fake)\b/i.test(text),
    need: 'a myth bust names the myth it breaks',
  },
  framework: {
    test: text => /\b(framework|method|rule|rules|system|formula|steps?|playbook)\b|\d/i.test(text),
    need: 'a framework hook names the method or its steps',
  },
  checklist: {
    test: text => /\b(checklist|list|steps?|save this|every|things)\b|\d/i.test(text),
    need: 'a checklist hook promises the list',
  },
  copyable_artifact: {
    test: text => /\b(template|script|prompt|copy|steal|save this|swipe|download)\b/i.test(text),
    need: 'a copyable hook names what the viewer can copy',
  },
  timeliness: {
    test: text => /\b(today|tonight|this (week|month|year|season|weekend)|now|new|just|soon|launch\w*|season|20\d\d)\b/i.test(text),
    need: 'a timely hook says why now',
  },
  stakes_cost: {
    test: text => /\b(cost|costs|price|paid|pay|spent|spend|lost|lose|waste\w*)\b|\$|\d/i.test(text),
    need: 'a stakes hook names the cost',
  },
  authority_proof: {
    test: text => /\d|\b(expert\w*|dermatologist\w*|doctor\w*|scientist\w*|stud(y|ies)|tested|clinical\w*|award\w*|certified|years)\b/i.test(text),
    need: 'an authority hook shows who or what backs it',
  },
});

let familyCache = null;

function hookFamilies(file = HOOKS_FILE) {
  if (file === HOOKS_FILE && familyCache) return familyCache;
  const families = new Map();
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').map(cell => cell.trim());
    if (cells.length < 4 || !/^H-[A-Z]+$/.test(cells[1])) continue;
    const mechanisms = cells[2].split(',').map(item => item.trim()).filter(item => /^[a-z_]+$/.test(item));
    if (mechanisms.length) families.set(cells[1], mechanisms);
  }
  if (file === HOOKS_FILE) familyCache = families;
  return families;
}

function mechanismMatches(mechanism, text) {
  const rule = MECHANISM_TESTS[mechanism];
  const hook = String(text || '').trim();
  if (!rule || !hook) return { ok: true, need: null };
  return rule.test(hook) ? { ok: true, need: null } : { ok: false, need: rule.need };
}

function checkHook({ family, mechanism, text }, families = hookFamilies()) {
  const problems = [];
  const name = String(family || '').trim();
  const kind = String(mechanism || '').trim();
  if (!families.has(name)) {
    problems.push('"' + (name || 'none') + '" is not a hook family in the hook playbook; use one of ' + [...families.keys()].join(', ') + '.');
    return problems;
  }
  const allowed = families.get(name);
  if (!allowed.includes(kind)) {
    problems.push('"' + (kind || 'none') + '" is not a ' + name + ' mechanism; use one of ' + allowed.join(', ') + '.');
    return problems;
  }
  const hook = String(text || '').trim();
  if (hook) {
    const match = mechanismMatches(kind, hook);
    if (!match.ok) problems.push('The hook "' + hook + '" does not read as ' + kind.replace(/_/g, ' ') + ': ' + match.need + '.');
  }
  return problems;
}

function tagKey(tag) {
  return String(tag).toLowerCase();
}

function checkTags(list) {
  const problems = [];
  if (!Array.isArray(list)) return { tags: [], problems: ['A hashtag set is a list of hashtags; an empty list means no hashtags.'] };
  const tags = [];
  const seen = new Set();
  const repeated = new Set();
  for (const raw of list) {
    const text = String(raw == null ? '' : raw).trim();
    const tag = text && !text.startsWith('#') ? '#' + text : text;
    if (!TAG.test(tag)) {
      problems.push('"' + text + '" is not a hashtag: use # then letters, numbers or underscores, with no spaces.');
      continue;
    }
    const key = tagKey(tag);
    if (seen.has(key)) { repeated.add(tag); continue; }
    seen.add(key);
    tags.push(tag);
  }
  if (repeated.size) problems.push('The hashtag set repeats ' + [...repeated].join(', ') + '.');
  if (list.length > MAX_HASHTAGS) problems.push('A hashtag set can have at most ' + MAX_HASHTAGS + ' hashtags; this one has ' + list.length + '.');
  return { tags, problems };
}

function tagsIn(text) {
  const value = String(text || '').trim();
  if (value.toLowerCase() === 'none') return [];
  return value.match(TAGS_IN_TEXT) || [];
}

function ctaProblems(style, platform) {
  const problems = [];
  if (!CTA_STYLES.includes(style)) {
    problems.push('"' + (style || 'none given') + '" is not a call-to-action style; use one of ' + CTA_STYLES.join(', ') + '.');
    return problems;
  }
  const blocked = CTA_NOT_ON[platform] || [];
  if (blocked.includes(style)) problems.push((CTA_WORDS[style] || style) + ' does not work on ' + platform[0].toUpperCase() + platform.slice(1) + '.');
  return problems;
}

function same(a, b) {
  const norm = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readOptions(draftDir) {
  return readJson(path.join(draftDir, OPTIONS_FILE));
}

function readRecipe(draftDir) {
  return readJson(path.join(draftDir, RECIPE_FILE));
}

function comparePost(post, recipe) {
  const findings = [];
  const want = recipe && recipe.post;
  if (!want) {
    findings.push({ code: 'R-ANGLE', msg: 'No recipe was chosen for this post: the content pillar, angle, hook family, call to action and hashtags are picked before the copy is written.' });
    return findings;
  }
  const data = (post && post.data) || {};
  const block = data.recipe && typeof data.recipe === 'object' ? data.recipe : {};
  const differs = (code, what, got, expected) => {
    if (!same(got, expected)) findings.push({ code, msg: 'The post uses "' + (got == null || got === '' ? 'nothing' : got) + '" as its ' + what + '; the chosen recipe says "' + expected + '".' });
  };
  differs('R-ANGLE', 'content pillar', block.pillar, want.pillar);
  differs('R-ANGLE', 'angle', block.angle, want.angle);
  differs('R-HOOK', 'hook family', data.hook_family, want.hook_family);
  differs('R-HOOK', 'hook mechanism', data.hook_mechanism, want.hook_mechanism);
  differs('R-ANGLE', 'call-to-action style', block.cta_style, want.cta_style);
  const expected = new Map((want.hashtags || []).map(tag => [tagKey(tag), tag]));
  const sections = (post && post.sections) || {};
  const written = tagsIn(sections['Hashtags']);
  const got = new Map(written.map(tag => [tagKey(tag), tag]));
  const missing = [...expected.keys()].filter(key => !got.has(key)).map(key => expected.get(key));
  const extra = [...got.keys()].filter(key => !expected.has(key)).map(key => got.get(key));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push('missing ' + missing.join(' '));
    if (extra.length) parts.push('not in the recipe ' + extra.join(' '));
    findings.push({ code: 'R-ANGLE', msg: 'The hashtags differ from the chosen hashtag set: ' + parts.join('; ') + '.' });
  }
  if (Array.isArray(data.hashtags) && data.hashtags.length) {
    const listed = new Set(data.hashtags.map(tag => tagKey(String(tag).startsWith('#') ? tag : '#' + tag)));
    if (listed.size !== got.size || [...listed].some(key => !got.has(key))) {
      findings.push({ code: 'R-ANGLE', msg: 'The hashtags listed in the front matter differ from the Hashtags section.' });
    }
  }
  return findings;
}

module.exports = {
  FIELDS,
  FIELD_WORDS,
  MIN_OPTIONS,
  MAX_OPTIONS,
  MAX_HASHTAGS,
  OPTIONS_FILE,
  RECIPE_FILE,
  CTA_STYLES,
  CTA_NOT_ON,
  MECHANISM_TESTS,
  hookFamilies,
  mechanismMatches,
  checkHook,
  checkTags,
  tagsIn,
  ctaProblems,
  readOptions,
  readRecipe,
  comparePost,
};
