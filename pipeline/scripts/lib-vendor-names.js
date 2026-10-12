// The vendor and model names that must never reach a client. The hand-off is what the client
// keeps, and it must not say which tool or model made the work. This is the only list; add a
// name here and the hand-off build refuses it everywhere.
//
//   findVendorName(text) -> the blocked name as written in the text, or null
//
// "Runway" alone is a fashion word, so only the product forms are listed.
const BLOCKED_NAMES = Object.freeze([
  'Seedance', 'Kling', 'Veo', 'Sora', 'Hailuo', 'Higgsfield', 'RunwayML', 'Runway ML', 'Runway Gen',
  'ElevenLabs', 'Eleven Labs', '3echo', '3 echo', 'GPT image', 'GPT-image', 'Nano Banana',
  'Midjourney', 'DALL-E', 'Stable Diffusion', 'Suno', 'ChatGPT', 'OpenAI', 'Anthropic',
]);

const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+');
const PATTERN = new RegExp('(?<![\\p{L}\\p{N}])(?:' + BLOCKED_NAMES.map(escape).join('|') + ')(?![\\p{L}\\p{N}])', 'iu');

function findVendorName(text) {
  const hit = PATTERN.exec(String(text == null ? '' : text));
  return hit ? hit[0] : null;
}

module.exports = { BLOCKED_NAMES, findVendorName };
