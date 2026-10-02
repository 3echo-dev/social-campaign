import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * What the spend guard needs to know before it loads anything heavy: which tools it guards,
 * which of them honour `estimate_only`, the texts it says, and a cheap check for whether a
 * file path could be one of the job's record files. No imports beyond node:path and node:fs, so the
 * PreToolUse hook can still decide when `facts.mjs` fails to load. `facts.mjs` re-exports it all.
 */

export const THREE_ECHO_SPENDERS = Object.freeze(['create_image_job', 'create_video_job']);
export const VOICE_SPENDERS = Object.freeze(['creative_generate_speech', 'creative_transcribe_audio', 'creative_design_voice']);
/** The only guarded tools that take `estimate_only` and then spend nothing. */
export const VOICE_ESTIMABLE = Object.freeze(['creative_generate_speech', 'creative_transcribe_audio']);
export const ELEVEN_LABS_MEDIA = Object.freeze([
  'creative_generate_image', 'creative_generate_video', 'creative_edit_image', 'creative_generate_in_flow', 'creative_run_flow_nodes',
]);
export const GUARDED_TOOLS = Object.freeze(new Set([...THREE_ECHO_SPENDERS, ...VOICE_SPENDERS, ...ELEVEN_LABS_MEDIA]));
export const WRITE_TOOLS = Object.freeze(new Set(['Write', 'Edit', 'MultiEdit']));

export const NO_JOB_WARNING = "This paid call isn't linked to a Social Campaign job, so its cost isn't tracked.";
export const NO_JOB_DENY = 'Paid images, video and voice are made inside a job. Start or resume the job on the board first.';
export const FACT_FILE_DENY = 'These records are kept by Social Campaign itself and cannot be edited by hand.';
export const SPEND_DENY = Object.freeze({
  elevenLabsMedia: 'Images and videos for jobs are made with 3Echo Studio.',
  noApproval: "The price for this job hasn't been approved yet. Show the price and wait for approval before making anything.",
  noItem: "This call doesn't say which approved item it makes, so it can't be checked against the approved price.",
  notInQuote: "This item isn't in the approved price. Anything new or redone needs its own price approval first.",
  mismatch: "This call doesn't match the approved item it names.",
  sampleLock: 'Show the sample and wait for approval before making the rest.',
  videoTooEarly: 'Video waits until the storyboard is approved. Only reference pictures can be made until then.',
  voiceTooEarly: 'Voice waits until the storyboard is approved. Only reference pictures can be made until then.',
  jobFinished: 'This job is finished, so nothing more can be made for it.',
  videoNoEstimate: 'Get a price for this clip first.',
  voiceNoEstimate: 'Get a price for this voice line first.',
  oneAtATime: 'Make one version at a time unless more were approved.',
  itemOver: 'This costs more than the price approved for this item. Get the new price approved first.',
  overBudget: 'This would go over the approved price for this job. Show the new price and get it approved first.',
  alreadyMade: 'This item has already been made. To make it again, ask for a redo on the board.',
  stillMaking: "This item is still being made. Check on it with wait_for_job instead of making it again.",
  unchecked: "The price check couldn't finish, so nothing was made. Try again in a moment.",
});

export function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function toolBase(name) {
  const value = String(name || '');
  if (!value.startsWith('mcp__')) return value;
  const at = value.lastIndexOf('__');
  return at > 3 ? value.slice(at + 2) : value;
}

export const isGuardedTool = base => GUARDED_TOOLS.has(base);

/** True when the call is a plain estimate that the tool itself answers without spending. */
export const honoursEstimateOnly = (base, input) => asObject(input).estimate_only === true && VOICE_ESTIMABLE.includes(base);

// messages/ holds what the person wrote to each agent on the board and the Director's replies; the model never writes it by hand.
const FACT_DIRS = new Set(['generation', 'pricing', 'approvals', 'messages']);
// The record of which agents ran, written by the agent-run hook, at the job root.
const ROOT_FACT_FILES = new Set(['agents.jsonl']);
const RECIPE_FACT_FILES = new Set(['recipe.json', 'recipe-options.json', 'recipe-history.jsonl']);
// The approved posting plan, the record of uploads and the remembered file measurements and the log of sends, all in the job's publish/ folder: the model must not
// write any of them, since media upload and the send guard trust them. handoff/ stays the person's package.
const PUBLISH_FACT_FILES = new Set(['intent.json', 'hosted-media.json', 'media-facts.json', 'metricool.jsonl', 'asset-reads.jsonl', 'listings.jsonl', 'posted.json']);

// A name that can reach another file than the one it spells: a short 8.3 name (METRIC~1.JSO), an alternate data stream
// (metricool.jsonl::$DATA), or a trailing dot or space, which Windows drops. Inside a job folder none can be judged by its
// spelling, so none is let through.
const ALIASED_NAME = /(:|~\d|[. ]$)/;

/** The path with its deepest existing part resolved to its real, long-named form (links and 8.3 names expanded), and the rest as given. */
function canonicalPath(full) {
  const rest = [];
  let at = full;
  for (;;) {
    try {
      return join(realpathSync.native(at), ...rest);
    } catch {
      const up = dirname(at);
      if (up === at) return full;
      rest.unshift(basename(at));
      at = up;
    }
  }
}

function inJobRecords(path) {
  const parts = path.split(/[\\/]+/).map(part => part.toLowerCase());
  for (let i = 2; i < parts.length - 1; i++) {
    if (parts[i] !== 'jobs' || parts[i - 2] !== 'workspaces') continue;
    const inside = parts.slice(i + 2);
    if (!inside.length) continue;
    if (inside.some(part => ALIASED_NAME.test(part))) return true;
    if (FACT_DIRS.has(inside[0])) return true;
    if (inside.length === 1 && ROOT_FACT_FILES.has(inside[0])) return true;
    if (inside[0] === 'publish' && inside.length === 2 && PUBLISH_FACT_FILES.has(inside[1])) return true;
    if (inside[0] === 'validation' && inside.length === 2 && inside[1] === 'label-check.json') return true;
    if (inside[0] === 'validation' && inside.length >= 3 && inside[1] === 'qc-frames') return true;
    if (inside[0] === 'drafts' && inside.length === 3 && /^d\d+$/.test(inside[1]) && RECIPE_FACT_FILES.has(inside[2])) return true;
  }
  return false;
}

/**
 * True for a file a job keeps as its own record: price, generation, approvals, board messages, the agent run log, label and
 * frame checks, recipe files, the posting plan, the upload record and the send log. The path is judged as spelled and as it
 * really is (the deepest part that exists resolved to its long name, links followed), and a name inside a job folder that
 * could be an alias of another (8.3 short names, ::$DATA streams, a trailing dot or space) is refused outright. Case never
 * matters.
 */
export function isFactFile(filePath, cwd) {
  if (!filePath) return false;
  const full = resolve(cwd || process.cwd(), String(filePath));
  return inJobRecords(full) || inJobRecords(canonicalPath(full));
}
