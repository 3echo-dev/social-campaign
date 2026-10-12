// The vendor and model names that must never reach a client. The hand-off is what the client
// keeps, and it must not say which tool or model made the work. This is the only list; add a
// name here and the hand-off build refuses it everywhere.
//
//   findVendorName(text, allow) -> the blocked name as written in the text, or null
//
// allow is a list of names the brand itself owns (its own name, its slug, its accepted words).
// A brand called "3echo" can say its own name; a match equal to an allowed name is skipped.
//
// "Runway" alone is a fashion word, so only the product forms are listed.
const BLOCKED_NAMES = Object.freeze([
  'Seedance', 'Kling', 'Veo', 'Sora', 'Hailuo', 'Higgsfield', 'RunwayML', 'Runway ML', 'Runway Gen',
  'ElevenLabs', 'Eleven Labs', '3echo', '3 echo', 'GPT image', 'GPT-image', 'Nano Banana',
  'Midjourney', 'DALL-E', 'Stable Diffusion', 'Suno', 'ChatGPT', 'OpenAI', 'Anthropic',
]);

const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+');
const SOURCE = '(?<![\\p{L}\\p{N}])(?:' + BLOCKED_NAMES.map(escape).join('|') + ')(?![\\p{L}\\p{N}])';
const squash = s => String(s).toLowerCase().replace(/[\s-]+/g, '');

function findVendorName(text, allow) {
  const allowed = new Set((Array.isArray(allow) ? allow : []).filter(a => typeof a === 'string' && a.trim()).map(squash));
  const pattern = new RegExp(SOURCE, 'giu');
  for (const hit of String(text == null ? '' : text).matchAll(pattern)) {
    if (!allowed.has(squash(hit[0]))) return hit[0];
  }
  return null;
}

module.exports = { BLOCKED_NAMES, findVendorName };
