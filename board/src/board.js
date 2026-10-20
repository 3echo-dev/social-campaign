// @module core
// Social Campaign board. Transport returns persisted data; missing measurements stay missing.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc = escapeHtml;
// Sentence case, never uppercase: lowercase the whole label first (a raw state or stage id
// such as AWAITING_CONCEPT_APPROVAL is already all caps, so capitalizing only the first
// letter of each word without lowercasing the rest would leave it shouting), then capitalize
// just the first character.
export function humanize(value) {
  const text = String(value || 'Pending').replace(/[_-]/g, ' ').trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
export const NO_BRAND = 'no-brand';
// A routine status line is one short line: past `max` words it shows the start, and the rest sits behind "View details".
export function shortLine(text, max = 20) {
  const full = String(text ?? '').trim().replace(/\s+/g, ' ');
  const words = full.split(' ');
  if (!full || words.length <= max) return esc(full);
  const cut = words.slice(0, max).join(' ').replace(/[\s,;:.–—-]+$/, '') + '…';
  return `${esc(cut)}<details class="cs-more line-more"><summary>View details</summary><span class="line-more-full">${esc(full)}</span></details>`;
}
// The same cut with no disclosure, for a line that sits inside a summary.
export function capWords(text, max = 20) {
  const full = String(text ?? '').trim().replace(/\s+/g, ' ');
  const words = full.split(' ');
  return !full || words.length <= max ? full : words.slice(0, max).join(' ').replace(/[\s,;:.–—-]+$/, '') + '…';
}
// Messages the board repeats, said once.
export const NOTE_TOO_LARGE = 'Too large to show. Open it on your computer.';
export const NOTE_SHORTENED = 'Shortened. The full file is on your computer.';
const TXT_SAVED_CLAUDE_WILL_UPDATE = 'Saved. Claude will update the board.';
const TXT_TYPE_TEXT_OR_CHOOSE = 'Type text or choose a file.';
const TXT_CHOOSE_AN_OWNER_FIRST = 'Choose an owner first.';
const TXT_USE_A_FULL_HTTPS = 'Use a full https:// link.';
const TXT_FORMATS_AND_QUANTITIES = 'Formats and quantities';
const TXT_CLIENT_WORK_ASK_FIRST = 'Client work, ask first';
const TXT_READING_THE_FILES = 'Reading the files';
const TXT_FOLDER_NOT_FOUND = 'Folder not found';
const TXT_CHOOSE_WHAT_THIS_IS = 'Choose what this is first.';
const TXT_NO_PREVIEW_YET = 'No preview yet.';
const TXT_WAITING_FOR_CLAUDE = 'Waiting for Claude';
const TXT_NEEDS_CLAUDE_ATTENTION = 'Needs Claude attention';
const TXT_SAVE_AND_CONTINUE = 'Save and continue';
const TXT_CALL_TO_ACTION = 'Call to action';
const TXT_WAITING_FOR_CLAUDE_2 = 'Waiting for Claude.';
const TXT_NOTHING_TO_SAVE = 'Nothing to save.';
const TXT_THE_PLAN_IS_BEING = 'The plan is being rebuilt.';
const TXT_PICK_A_CONCEPT_FIRST = 'Pick a concept first.';
const TXT_SEND_THE_REQUESTED_CHANGES = 'Send the requested changes instead.';
const TXT_CHOOSE_ONE_OF_THE = 'Choose one of the answers.';
const TXT_ANSWER_THIS_FIRST = 'Answer this first.';
const TXT_NOT_STARTED_YET = 'Not started yet';
const TXT_WAITING_ON_YOU = 'Waiting on you';
const TXT_COULD_NOT_FINISH = 'Could not finish';
const TXT_WORKING_ON_IT = 'Working on it';
const TXT_WHAT_IT_MADE = 'What it made';
const TXT_OPEN_THIS_BOARD_INSIDE = 'Open this board inside Claude.';
const TXT_REQUEST_ID_WAS_REUSED = 'Request ID reused with different data.';
const TXT_NO_JOBS_YET_DESCRIBE = 'No jobs yet. Describe one above.';
const TXT_NO_JOBS_YET_FINISH = 'No jobs yet. Finish brand onboarding first.';
export const NOTE_WAITING_SAVE = 'Waiting for Claude to save this.';
export const NOTE_SAVED_SOON = 'Saved. The board will update shortly.';
export const NOTE_SAVED = TXT_SAVED_CLAUDE_WILL_UPDATE;
export const NOTE_DECLINED = 'Declined in chat. Nothing changed.';
export const NOTE_NEEDS_PRICE = 'Every item needs a price first.';
export const NOTE_NOT_CONNECTED = 'Not connected yet. Try again shortly.';
export const NOTE_SEND_FAILED = 'Could not send that.';
export const NOTE_NEEDS_CHECK = 'Claude must check this first.';
export const NOTE_PHOTO_TYPE = 'Use a PNG, JPG or WebP.';
export const NOTE_LOGO_TYPE = 'Use a PNG, JPG, WebP or SVG.';
export const NOTE_NOTHING_CHANGED = 'Change at least one item first.';
export const NOTE_CHOOSE_COPY = 'Choose copy for every post first.';
export const NOTE_TEXT_MISSING = TXT_TYPE_TEXT_OR_CHOOSE;
export const NOTE_NEEDS_HELP = 'Claude needs your help to carry on';
export const NOTE_WENT_WRONG = 'Something went wrong';
export const NOTE_FIX_FIELDS = 'Fix the highlighted fields first.';
export const NOTE_FIX_ANSWERS = 'Fix the highlighted answers first.';
export const NOTE_DECISION_WAITING = 'A decision is waiting for you.';
export const NOTE_NAME_LONG = 'Keep the name under 120 characters.';
export const NOTE_OWNER_FIRST = TXT_CHOOSE_AN_OWNER_FIRST;
export const NOTE_FORMAT_UNSAVABLE = 'This format can\'t be saved here.';
export const NOTE_NOTIFY_FAILED = 'Claude could not be notified.';
export const NOTE_SAVING = 'Saving. Claude will confirm.';
export const NOTE_HAS_ANSWER = 'Claude has your answer.';
export const NOTE_BRAND_NAME = 'Enter a brand name.';
export const NOTE_SAY_CHANGE = 'Say what should change.';
export const NOTE_NO_RENAME = 'Claude did not rename the brand.';
// The job-type words the board shows (a kind's pipeline name, its short label, whether it is a report, the word in a
// "new job" line) come from the pipeline catalogue this page was built with (scripts/build-board.mjs puts it in the page
// config), so a new kind needs no constant here. Until configurePipelines runs, a lookup finds nothing and the label
// the projection already carries stands.
let PIPELINE_KINDS = Object.freeze({});
export function configurePipelines(config) {
  const kinds = config && typeof config === 'object' && config.kinds && typeof config.kinds === 'object' ? config.kinds : {};
  PIPELINE_KINDS = Object.freeze(Object.fromEntries(Object.entries(kinds).map(([kind, words]) => [kind, Object.freeze({ ...words })])));
  return PIPELINE_KINDS;
}
export const kindNameOf = kind => PIPELINE_KINDS[kind]?.name || '';
// Where the address bar points: one job, one pipeline group's page, or home.
export function routeOf(hash) {
  const text = String(hash || '');
  const read = value => { try { return decodeURIComponent(value); } catch { return value; } };
  const job = /^#\/project\/(.+)$/.exec(text);
  if (job) return { page: 'job', id: read(job[1]) };
  const group = /^#\/pipeline\/([^/?#]+)\/?$/.exec(text);
  if (group) return { page: 'pipeline', group: read(group[1]) };
  return { page: 'home' };
}
// A hue (0 to 359) taken from a job's id, so a job keeps one colour on its card and on its page.
export function hueOf(value) {
  let hue = 7;
  for (const ch of String(value || '')) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return hue;
}
// The title of each pipeline group's own page, the one a job's back link goes to. The groups themselves (and which job kind is
// in which) come from the catalogue; a group this table does not know is titled from its id.
const GROUP_TITLES = Object.freeze({ post: 'Posts and campaigns', publish_post: 'Post from your files', research: 'Research', creative_analysis: 'Analysis', video_breakdown: 'Video breakdown' });
export function pipelineGroups() {
  const groups = [];
  for (const words of Object.values(PIPELINE_KINDS)) if (words.group && !groups.includes(words.group)) groups.push(words.group);
  return groups;
}
export const groupOfKind = kind => PIPELINE_KINDS[kind]?.group || 'post';
// Waiting on the person: a decision is open, or the job has something in the Inbox (a question, a brief, a stuck note).
const jobWaiting = (project, inboxJobs) => Boolean(project?.waitingOn) || inboxJobs.has(project?.jobId);
// One entry per pipeline group: its title and the jobs in it.
export function pipelineGroupPages(projects = []) {
  const list = Array.isArray(projects) ? projects : [];
  return pipelineGroups().map(group => ({ group, title: GROUP_TITLES[group] || humanize(group), jobs: list.filter(project => groupOfKind(project?.kind) === group) }));
}
// The job page's progress bar: one segment per step, coloured by the step's own status, and "x of y steps done".
export function jobProgress(project) {
  const { done, total } = stageProgress(project);
  if (!total) return '';
  const stages = (Array.isArray(project?.stages) ? project.stages : []).filter(stage => stage && typeof stage === 'object');
  const status = index => (stages.length === total ? String(stages[index].status || 'pending') : index < done ? 'complete' : 'pending').toLowerCase().replace(/[^a-z]/g, '');
  const text = `${done} of ${total} ${total === 1 ? 'step' : 'steps'} done`;
  return `<div class="job-progress"><span class="minimap" role="img" aria-label="${esc(text)}">${Array.from({ length: total }, (_, index) => `<i class="s-${status(index)}"></i>`).join('')}</span><span class="job-progress-text">${esc(text)}</span></div>`;
}
const compactCount = value => (value >= 1e6 ? `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value));
const openedWord = value => { const at = value ? new Date(value) : null; return at && !Number.isNaN(at.getTime()) ? at.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''; };
export const kindLabelOf = project => project?.kindLabel || PIPELINE_KINDS[project?.kind]?.label || 'Post or campaign';
export const newJobWord = kind => PIPELINE_KINDS[kind]?.jobWord || 'job';
export const isReportJob = project => PIPELINE_KINDS[project?.kind]?.report === true || (project?.pendingReviews || []).some(review => (review?.gate || review?.reviewId) === 'findings');
export const LINK_LIMIT = 20;
export const LINK_MAX_LENGTH = 2000;
const VIDEO_FILE_HINT = 'Give video files to Claude in chat.';
export function parseLinks(text) {
  const links = [];
  let error = null;
  for (const raw of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const value = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    if (value.length > LINK_MAX_LENGTH) { error = `Each link must be ${LINK_MAX_LENGTH} characters or fewer.`; continue; }
    let valid = false;
    try { const url = new URL(value); valid = url.protocol === 'https:' && Boolean(url.hostname) && url.hostname.includes('.') && !url.username && !url.password; } catch { valid = false; }
    if (!valid) { error = TXT_USE_A_FULL_HTTPS; continue; }
    if (!links.includes(value)) links.push(value);
  }
  if (!error && links.length > LINK_LIMIT) error = `Add up to ${LINK_LIMIT} links.`;
  return { links, error };
}
const intakeLabel = value => ({kind:'Type of content',objective:'Campaign goal',distribution:'Organic or paid distribution',platforms:'Social platforms',deliverables:TXT_FORMATS_AND_QUANTITIES,'deliverables (at least one)':TXT_FORMATS_AND_QUANTITIES,audience:'Target audience',evidence:'Available references and supporting material'})[value] || value;
const time = value => value ? new Date(value).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' }) : 'Not synced yet';
// Wall-clock hh:mm:ss, zero-padded. Anything that is not a finite number of
// zero or more milliseconds is unmeasured, never shown as 00:00:00.
export function clock(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'Not reported';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
const duration = clock;
// The projection reports only closed time in elapsedMs; a currently open
// row (the job itself, an open stage, a running brand research run) also
// carries openSince, and the time since then is added live at render time.
// No openSince (it doesn't parse) leaves elapsedMs exactly as given,
// including null. now is a parameter, not read from the clock in here, so
// callers can render deterministically in a test.
export function liveMs(elapsedMs, openSince, now = Date.now()) {
  const openAt = Date.parse(openSince);
  if (!Number.isFinite(openAt)) return elapsedMs;
  return (elapsedMs ?? 0) + Math.max(0, now - openAt);
}
// A short, rounded relative-time phrase for a past ISO timestamp: "just now"
// under 45 seconds, then whole minutes, hours, or days. Anything that does
// not parse to a real time (missing, malformed) returns null so a caller can
// fall back to its own message instead of showing a bogus duration.
export function relativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const diffMs = Math.max(0, now - then);
  if (diffMs < 45_000) return 'just now';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
// The header's second status line in artifact mode. data.connection.status is
// the parked Studio sync status (see server/pipeline/board.mjs), never
// "ready" for the artifact relay, so it cannot report freshness there; the
// projection's own updatedAt, set every time the workspace document is
// written, is the actual freshness signal for this board.
export function boardSyncDetail(updatedAt, now = Date.now()) {
  const relative = relativeTime(updatedAt, now);
  return relative ? `Updated ${relative}` : 'Waiting for your studio';
}
// The board's cost figure is media generation spend, never a Claude token
// cost estimate. "Not reported" when nothing was recorded; the approved
// ceiling is shown only when it is itself a known number.
const creditNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const creditFigure = value => Number(Number(value).toFixed(6)).toLocaleString(undefined, { maximumFractionDigits: 2 });
function creditFraction(credits) {
  const spent = creditNumber(credits?.spent);
  const approved = creditNumber(credits?.approved);
  if (spent === null && approved === null) return null;
  return approved === null ? creditFigure(spent ?? 0) : `${creditFigure(spent ?? 0)} of ${creditFigure(approved)}`;
}
const creditsInUse = credits => (creditNumber(credits?.spent) || 0) > 0 || creditNumber(credits?.approved) !== null;
export function mediaGenerationText(generation) {
  const studio = creditFraction(generation?.threeEchoCredits);
  const voice = creditsInUse(generation?.elevenLabsCredits) ? creditFraction(generation.elevenLabsCredits) : null;
  if (!studio && !voice) return 'Not reported';
  return [studio ? `${studio} Studio credits` : '', voice ? `${voice} voice credits` : ''].filter(Boolean).join(' and ');
}
export function safePreviewUrl(value) {
  if (typeof value !== 'string') return null;
  if (/^\/_blob\/[A-Za-z0-9_-]{8,128}$/.test(value)) return value;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function kitImageSrc(value) {
  if (typeof value !== 'string') return null;
  if (/^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  return safePreviewUrl(value);
}
// The picture on a post card of the Brand library and the Brand intelligence panel: one helper for both. This page may only load pictures that travel
// inside it (data: and blob: addresses and its own files), so the https address a platform gave for a post's picture never draws here. The plugin keeps
// a small WebP of each post on this computer and carries it in the board as a data URI in the brand's `thumbs`, under the key the card names in `thumb`;
// a card with no picture keeps its platform tile. A record that still holds a safe `thumbnail` of its own is drawn from that.
export function postThumbSrc(post, thumbs) {
  const key = typeof post?.thumb === 'string' ? post.thumb : '';
  const held = key && thumbs && typeof thumbs === 'object' && !Array.isArray(thumbs) && Object.hasOwn(thumbs, key) ? thumbs[key] : null;
  const own = typeof held === 'string' && /^data:image\/(webp|jpeg);base64,/i.test(held) ? safePreviewUrl(held) : null;
  return own || safePreviewUrl(post?.thumbnail);
}

const ARTIFACT_WORKSPACE_DOC = 'socialCampaign/workspace';
const JOB_DOCUMENT_COLLECTION = 'jobDocs';
const JOB_DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const NO_SESSION_MESSAGE = 'Saved. Claude sees it when your chat opens.';
const NOT_NOTIFIED_MESSAGE = 'Not notified. Ask Claude in chat to sync.';
const SIGNAL_OUTCOMES = Object.freeze({
  sent: 'Claude has been notified.',
  no_session: NO_SESSION_MESSAGE,
  writers_only: 'Read-only. Claude was not notified.',
  claude_unavailable: NO_SESSION_MESSAGE,
  forbidden: NOT_NOTIFIED_MESSAGE,
  consent_required: NOT_NOTIFIED_MESSAGE,
  rate_limited: 'Too many tries. Wait a moment.',
  unavailable: NOT_NOTIFIED_MESSAGE,
});
const SIGNAL_ERROR_OUTCOMES = Object.freeze({
  claude_unavailable: 'claude_unavailable',
  no_session: 'no_session',
  forbidden: 'forbidden',
  consent_required: 'consent_required',
  rate_limited: 'rate_limited',
});
const NO_SESSION_SIGNAL_OUTCOMES = new Set(['no_session', 'claude_unavailable']);
const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
const REMIND_DELAY_MS = 120_000;

export const CHANNEL_NAMES = ['website', 'facebook', 'instagram', 'tiktok'];
export const CHANNEL_LABELS = Object.freeze({ website: 'Website', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' });
export const CHANNEL_PLACEHOLDERS = Object.freeze({ website: 'acmegoods.com', facebook: 'facebook.com/acmegoods', instagram: '@acmegoods', tiktok: '@acmegoods' });
const CHANNEL_ARTICLES = Object.freeze({ website: 'a', facebook: 'a', instagram: 'an', tiktok: 'a' });
// The tickbox that says a channel does not exist: "No TikTok", "No website".
export const CHANNEL_NONE_LABELS = Object.freeze({ website: 'No website', facebook: 'No Facebook', instagram: 'No Instagram', tiktok: 'No TikTok' });

// The brand's declared context: shown as normal fields on the onboarding
// card, always visible, directly below the four channels. Each one is
// prefilled from the saved profile when there is one; whatever research
// left blank stays blank here until the person fills it in.
export const CONTEXT_LIMITS = Object.freeze({
  text: Object.freeze({ audience: 400, market: 400, voice: 300 }),
  pillarsMax: 8,
  pillarItemMax: 60,
  competitorsMax: 3,
  competitorItemMax: 500,
});

export const CONTEXT_FIELDS = Object.freeze([
  { name: 'audience', label: 'Audience', short: 'audience', placeholder: 'Who are you speaking to?', maxlength: CONTEXT_LIMITS.text.audience },
  { name: 'market', label: 'Positioning', short: 'positioning', placeholder: 'What you offer', maxlength: CONTEXT_LIMITS.text.market },
  { name: 'voice', label: 'Brand voice', short: 'brand voice', placeholder: 'How should your brand sound?', maxlength: CONTEXT_LIMITS.text.voice },
  { name: 'contentPillars', label: 'Content topics (one per line)', short: 'content topics', placeholder: 'One topic per line' },
  { name: 'competitors', label: 'Top 3 competitors (one per line)', short: 'top 3 competitors', placeholder: 'Names or URLs' },
]);
export const CONTEXT_FIELD_NAMES = CONTEXT_FIELDS.map(field => field.name);
export const TARGET_MARKET_FIELD = Object.freeze({ name: 'targetMarket', label: 'Target market', short: 'target market', placeholder: 'A country, or Global', maxlength: 60 });
const TARGET_MARKET_TOO_LONG = 'Keep it under 60 characters.';
const normalizeTargetMarket = value => String(value ?? '').replace(/\s+/g, ' ').trim();

// The currency a brand's target market spends in, for the budget box: one currency when the market names a country (or the euro area), nothing when
// it is blank, "Global" or several countries that spend in different currencies. A blank market stays unknown; the box asks for a code instead.
const MARKET_CURRENCIES = Object.freeze([
  ['SGD', ['singapore']], ['MYR', ['malaysia']], ['IDR', ['indonesia']], ['PHP', ['philippines']], ['THB', ['thailand']], ['VND', ['vietnam']],
  ['USD', ['united states', 'usa', 'u.s.', 'us']], ['GBP', ['united kingdom', 'uk', 'britain', 'england', 'scotland', 'wales']], ['AUD', ['australia']],
  ['NZD', ['new zealand']], ['CAD', ['canada']], ['JPY', ['japan']], ['KRW', ['south korea', 'korea']], ['CNY', ['china', 'mainland china']],
  ['HKD', ['hong kong']], ['TWD', ['taiwan']], ['INR', ['india']], ['AED', ['united arab emirates', 'uae', 'dubai']], ['SAR', ['saudi arabia']],
  ['EUR', ['germany', 'france', 'italy', 'spain', 'netherlands', 'ireland', 'portugal', 'belgium', 'austria', 'finland', 'greece', 'eurozone', 'europe']],
  ['CHF', ['switzerland']], ['BRL', ['brazil']], ['MXN', ['mexico']], ['ZAR', ['south africa']], ['TRY', ['turkey']],
]);
export function marketCurrency(market) {
  const text = ` ${normalizeTargetMarket(market).toLowerCase()} `;
  if (!text.trim()) return '';
  const found = new Set();
  for (const [code, names] of MARKET_CURRENCIES) if (names.some(name => new RegExp(`[^a-z]${name.replace(/\./g, '\\.')}[^a-z]`).test(text))) found.add(code);
  return found.size === 1 ? [...found][0] : '';
}
// Each brand's target market, remembered at every draw so the job's budget box can follow it without the form knowing about brands.
const brandMarkets = new Map();
export function rememberBrandMarkets(brands = []) {
  brandMarkets.clear();
  for (const brand of Array.isArray(brands) ? brands : []) {
    const market = brand?.profile?.targetMarket ?? brand?.details?.targetMarket;
    if (brand?.slug && typeof market === 'string') brandMarkets.set(brand.slug, market);
  }
}
const projectCurrency = project => marketCurrency(brandMarkets.get(project?.brand));

// Normalize what a person actually types: a bare domain becomes an https URL,
// and a bare @handle becomes the channel's official profile URL. A full URL
// (any protocol) is left unchanged. Anything else is returned as-is so
// validateProfile can flag it inline.
export function normalizeChannelInput(name, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.match(/^@([A-Za-z0-9._]+)$/);
  if (handle) {
    if (name === 'instagram') return `https://www.instagram.com/${handle[1]}`;
    if (name === 'tiktok') return `https://www.tiktok.com/@${handle[1]}`;
  }
  if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/\S*)?$/i.test(value)) {
    return `https://${value}`;
  }
  return value;
}

// The brand's audience, market, voice, content pillars and competitors are
// declared context fields, prefilled from the saved profile and shown on
// the onboarding card. buildProfile includes one of those five keys only
// when its submitted value differs from the value it was prefilled with
// (including an unlocked field the person deliberately cleared); an unchanged field,
// including one left blank because it was already blank, is omitted so the
// server's prepareProfile keeps whatever research already filled in, and
// research still fills anything left blank. See
// pipeline/scripts/lib-brand-profile.js.
export function contextTextLength(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().length;
}

export function buildProfile(values = {}, prefilled = {}, unlocked = {}) {
  const channels = {};
  for (const name of CHANNEL_NAMES) {
    const normalized = normalizeChannelInput(name, values[name]);
    channels[name] = values[name + '_unavailable'] || !normalized ? 'Not available' : normalized;
  }
  const profile = { channels };
  for (const field of CONTEXT_FIELDS) {
    const name = field.name;
    const current = String(values[name] ?? '').replace(/\r\n/g, '\n').trim();
    const prior = String(prefilled[name] ?? '').replace(/\r\n/g, '\n').trim();
    if (current === prior) continue;
    if (!current && prior && !unlocked[name]) continue;
    if (name === 'contentPillars' || name === 'competitors') {
      profile[name] = current ? current.split(/\r?\n/).map(item => item.trim()).filter(Boolean) : [];
    } else {
      profile[name] = current;
    }
  }
  const market = normalizeTargetMarket(values.targetMarket);
  if (market !== normalizeTargetMarket(prefilled.targetMarket)) profile.targetMarket = market;
  return profile;
}

// The starting values a context field is compared against: the joined-line
// text profileFormValues read from the saved profile when the draft for
// this brand (or a brand-new draft) was first created. Recorded once, on
// the draft object, and kept unchanged through re-renders so a later edit
// (or a deliberate clear) can be told apart from an untouched field.
export function contextPrefill(values = {}) {
  return Object.fromEntries([...CONTEXT_FIELD_NAMES, TARGET_MARKET_FIELD.name].map(name => [name, values[name] || '']));
}

// The brand name, four channels, and five declared context fields, read
// from a brand's saved profile for prefilling the onboarding form. A null
// brand (a brand-new draft) yields the same empty shape onboardDraft and
// inlineOnboardingForm already expect.
export function profileFormValues(brand) {
  // Before research starts there is no profile yet: the details the person saved on the brand's page stand in for it.
  const profile = brand?.profile || brand?.details || {};
  const channels = profile.channels || {};
  const values = { name: brand?.name || '' };
  for (const name of CHANNEL_NAMES) {
    const channel = channels[name];
    const value = typeof channel === 'string' ? channel : channel?.url || channel?.value || '';
    values[name] = value || '';
    values[name + '_unavailable'] = /^not available$/i.test(value) || channel?.status === 'unavailable';
  }
  values.targetMarket = typeof profile.targetMarket === 'string' ? normalizeTargetMarket(profile.targetMarket) : '';
  values.audience = typeof profile.audience === 'string' ? profile.audience : '';
  values.market = typeof profile.market === 'string' ? profile.market : '';
  values.voice = typeof profile.voice === 'string' ? profile.voice : '';
  values.contentPillars = Array.isArray(profile.contentPillars) ? profile.contentPillars.join('\n') : '';
  values.competitors = Array.isArray(profile.competitors)
    ? profile.competitors.join('\n')
    : Array.isArray(profile.competitors?.items) ? profile.competitors.items.join('\n') : '';
  return values;
}

// The inline onboarding draft for a brand (or a brand-new draft when brand
// is null/undefined): its starting form values, the context-field snapshot
// buildProfile diffs against, and which context fields have been unlocked
// for editing. Used both to open a fresh draft and to reopen one already in
// inlineDrafts, so the same shape is reused every time a draft is created.
export function onboardDraft(brand) {
  const values = brand ? profileFormValues(brand) : {};
  return { kind: 'onboard', brand: brand?.slug || null, values, prefilled: contextPrefill(values), unlocked: {} };
}

export function markContextEdited(draft, name) {
  if (!draft || !name || String(name).startsWith('kit_')) return draft;
  draft.edited = { ...(draft.edited || {}), [name]: true };
  return draft;
}

const DRAFT_TEXT_FIELDS = Object.freeze(['name', TARGET_MARKET_FIELD.name]);

export function reconcileOnboardDraft(draft, brand) {
  if (!draft || !brand) return draft;
  const saved = profileFormValues(brand);
  const values = { ...(draft.values || {}) };
  const edited = draft.edited || {};
  const unlocked = {};
  // A field the person edited is theirs; one they emptied that had a saved value stays emptied (a deliberate clear), not refilled from research.
  const ownedContext = name => Boolean(edited[name]) && (Boolean(String(values[name] ?? '').trim()) || Boolean(draft.unlocked?.[name]) || Boolean(String(draft.prefilled?.[name] ?? '').trim()));
  for (const name of CONTEXT_FIELD_NAMES) {
    if (ownedContext(name) || draft.unlocked?.[name]) unlocked[name] = true;
    if (!ownedContext(name)) values[name] = saved[name];
  }
  for (const name of DRAFT_TEXT_FIELDS) {
    if (!edited[name]) values[name] = saved[name];
  }
  // The name box keeps what the person typed, but a box still holding the name it was seeded from follows the brand when it is renamed
  // elsewhere (in chat): otherwise the next Save would send the old name back. `seededName` is the saved name the box last matched.
  if (edited.name && values.name === draft.seededName) values.name = saved.name;
  if (values.name === saved.name) draft.seededName = saved.name;
  for (const name of CHANNEL_NAMES) {
    if (edited[name] || edited[name + '_unavailable']) continue;
    values[name] = saved[name];
    values[name + '_unavailable'] = saved[name + '_unavailable'];
  }
  draft.values = values;
  draft.prefilled = contextPrefill(saved);
  draft.unlocked = unlocked;
  return draft;
}

export function adoptBrand(draft, brands = []) {
  if (!draft || draft.kind !== 'onboard' || draft.brand) return draft;
  const open = (Array.isArray(brands) ? brands : []).filter(brand => brand && !brandReady(brand));
  const wanted = [draft.values?.name, draft.args?.name].map(name => String(name ?? '').trim().toLowerCase()).filter(Boolean);
  const untouched = !wanted.length && !Object.keys(draft.edited || {}).length && !draft.researchRequested;
  const match = wanted.length
    ? open.find(brand => wanted.includes(String(brand.name || '').trim().toLowerCase()))
    : untouched ? open[0] : null;
  if (match) draft.brand = match.slug;
  return draft;
}

// The single-field check behind validateProfile, also used to clear or
// refresh one field's inline error live (on blur, or when its "We don't have
// one" checkbox is toggled) without waiting for the next submit.
export function channelFieldError(name, rawValue, unavailable) {
  if (unavailable) return null;
  const normalized = normalizeChannelInput(name, rawValue);
  if (!normalized) return `Add ${CHANNEL_ARTICLES[name]} ${CHANNEL_LABELS[name]} URL, or check "${CHANNEL_NONE_LABELS[name]}".`;
  if (!/^https?:\/\//i.test(normalized)) return `Enter a full ${CHANNEL_LABELS[name]} URL, or check "${CHANNEL_NONE_LABELS[name]}".`;
  return null;
}

// Amendment 5: competitors are capped at 3 everywhere. This only catches too
// many; fewer than 3 (or none) is valid and left for research to fill.
function competitorLines(raw) {
  return String(raw ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

export function validateProfile(values = {}, prefilled = {}, unlocked = {}, { partial = false } = {}) {
  const errors = {};
  if (!String(values.name || '').trim()) errors.name = NOTE_BRAND_NAME;
  for (const name of CHANNEL_NAMES) {
    // On the brand's details page an empty channel is fine (it is "not answered yet"); a channel that is filled in must still be a real link.
    if (partial && !normalizeChannelInput(name, values[name])) continue;
    const error = channelFieldError(name, values[name], Boolean(values[name + '_unavailable']));
    if (error) errors[name] = error;
  }
  if (normalizeTargetMarket(values.targetMarket).length > TARGET_MARKET_FIELD.maxlength) errors.targetMarket = TARGET_MARKET_TOO_LONG;
  for (const field of CONTEXT_FIELDS) {
    const limit = CONTEXT_LIMITS.text[field.name];
    const length = contextTextLength(values[field.name]);
    if (limit && length > limit) errors[field.name] = `Shorten the ${field.short} to ${limit} characters or fewer (now ${length}).`;
  }
  const pillars = competitorLines(values.contentPillars);
  if (pillars.length > CONTEXT_LIMITS.pillarsMax) errors.contentPillars = `List up to ${CONTEXT_LIMITS.pillarsMax} topics, one per line.`;
  else if (pillars.some(item => item.length > CONTEXT_LIMITS.pillarItemMax)) errors.contentPillars = `Keep each topic to ${CONTEXT_LIMITS.pillarItemMax} characters or fewer.`;
  if (!pillars.length && unlocked.contentPillars && String(prefilled.contentPillars ?? '').trim()) errors.contentPillars = 'Add at least one topic.';
  const competitors = competitorLines(values.competitors);
  if (competitors.length > CONTEXT_LIMITS.competitorsMax) errors.competitors = 'List up to 3 competitors.';
  else if (competitors.some(item => item.length > CONTEXT_LIMITS.competitorItemMax)) errors.competitors = `Keep each competitor to ${CONTEXT_LIMITS.competitorItemMax} characters or fewer.`;
  return errors;
}

// Brand onboarding in three steps. The new-brand form asks only for the name and sends `create_brand` { requestId, name }. The brand's own page
// then holds the details and sends `save_brand_details` { requestId, brand, profile, kit? } as often as the person saves (no research), and
// `start_research` { requestId, brand, profile, kit?, metricoolBlogId? } when they press Start research. `brand_rename` { requestId, brand, name }
// changes the display name. The old single `onboard_brand` request still works and is what a brand that already did research uses to Save and continue.
export const BRAND_NAME_LIMIT = 160;
export const RESEARCH_MINIMUM_NOTE = 'Add a website or social account.';
export const RESEARCH_READY_HINT = '';

// Every field on the details page, so a save always matches what is shown: a channel left empty is '' (not answered yet), "We don't have one" is
// 'Not available', and an empty context field clears whatever was saved for it.
export function detailsProfile(values = {}) {
  const channels = {};
  for (const name of CHANNEL_NAMES) channels[name] = values[name + '_unavailable'] ? 'Not available' : normalizeChannelInput(name, values[name]);
  const profile = { channels, targetMarket: normalizeTargetMarket(values.targetMarket) };
  for (const field of CONTEXT_FIELDS) {
    const text = String(values[field.name] ?? '').replace(/\r\n/g, '\n').trim();
    profile[field.name] = field.name === 'contentPillars' || field.name === 'competitors' ? text.split(/\r?\n/).map(item => item.trim()).filter(Boolean) : text;
  }
  return profile;
}

// Whether Start research can be pressed: the name, and a website or at least one social account (a channel marked "We don't have one" does not count).
export function researchMinimum(values = {}) {
  if (!String(values.name ?? '').trim()) return { ok: false, message: 'Give the brand a name.' };
  const given = CHANNEL_NAMES.some(name => !values[name + '_unavailable'] && normalizeChannelInput(name, values[name]));
  return given ? { ok: true, message: '' } : { ok: false, message: RESEARCH_MINIMUM_NOTE };
}

// The name for a new brand or a rename, or { error }: not empty, not over the limit.
export function brandNameArgs(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { error: NOTE_BRAND_NAME };
  if (name.length > BRAND_NAME_LIMIT) return { error: `Keep the brand name under ${BRAND_NAME_LIMIT} characters.` };
  return { name };
}

function channelField(name, values = {}, fieldErrors = null) {
  const value = values[name] || '';
  const unavailable = values[name + '_unavailable'] || /^not available$/i.test(value);
  const fieldError = unavailable ? null : fieldErrors?.[name];
  const errorId = `channel-${name}-error`;
  return `<div class="channel-field"><label for="channel-${name}">${esc(CHANNEL_LABELS[name])}</label><input id="channel-${name}" name="${name}" type="text" maxlength="2000" inputmode="url" placeholder="${esc(CHANNEL_PLACEHOLDERS[name])}" value="${esc(unavailable ? '' : value)}" ${unavailable ? 'disabled' : ''} aria-invalid="${fieldError ? 'true' : 'false'}" ${fieldError ? `aria-describedby="${errorId}"` : ''}>${fieldError ? `<p class="field-error" id="${errorId}" role="alert">${esc(fieldError)}</p>` : ''}<label class="toggle"><input type="checkbox" name="${name}_unavailable" ${unavailable ? 'checked' : ''}> <span>${esc(CHANNEL_NONE_LABELS[name])}</span></label></div>`;
}

export function researchSuggested(brand, name, values = {}, prefilled = {}) {
  const fields = brand?.profile?.researchSuggested;
  if (!Array.isArray(fields) || !fields.includes(name)) return false;
  const saved = String(prefilled[name] ?? '').trim();
  return Boolean(saved) && String(values[name] ?? '').trim() === saved;
}

export function targetMarketField(values = {}, fieldErrors = null) {
  const field = TARGET_MARKET_FIELD;
  const fieldError = fieldErrors?.[field.name];
  const errorId = `context-${field.name}-error`;
  return `<div class="context-field context-field-wide"><div class="context-field-head"><label for="context-${field.name}">${esc(field.label)}</label></div><input id="context-${field.name}" name="${field.name}" type="text" maxlength="${field.maxlength}" placeholder="${esc(field.placeholder)}" value="${esc(values[field.name] ?? '')}" autocomplete="off" aria-invalid="${fieldError ? 'true' : 'false'}" ${fieldError ? `aria-describedby="${errorId}"` : ''}>${fieldError ? `<p class="field-error" id="${errorId}" role="alert">${esc(fieldError)}</p>` : ''}</div>`;
}

// One declared context field: a textarea about four lines tall that grows with what is typed, always editable (no pencil, nothing locked).
// A value that research filled in keeps the "Suggested, please check" pill until the person changes it. The counter is in the page but
// hidden until the text is within 20 percent of the limit; typing shows and hides it (see the input handler). `prefilled` and `unlocked`
// stay in the signature for old callers and no longer change what is drawn.
export const contextCountShown = (length, limit) => Boolean(limit) && length >= limit * 0.8;
export function contextField(field, values = {}, prefilled = {}, unlocked = {}, fieldErrors = null, suggested = false) {
  const value = values[field.name] ?? '';
  const fieldError = fieldErrors?.[field.name];
  const errorId = `context-${field.name}-error`;
  const limit = CONTEXT_LIMITS.text[field.name];
  const length = contextTextLength(value);
  const count = limit ? `<p class="field-count${length > limit ? ' over' : ''}" id="context-${field.name}-count"${contextCountShown(length, limit) ? '' : ' hidden'}>${length} / ${limit}</p>` : '';
  return `<div class="context-field"><div class="context-field-head"><label for="context-${field.name}">${esc(field.label)}</label>${suggested ? '<span class="pill">Suggested, please check</span>' : ''}</div><textarea id="context-${field.name}" name="${field.name}" class="context-textarea" rows="4" ${field.maxlength ? `maxlength="${field.maxlength}"` : ''} placeholder="${esc(field.placeholder)}" aria-invalid="${fieldError ? 'true' : 'false'}" ${fieldError ? `aria-describedby="${errorId}"` : ''}>${esc(value)}</textarea>${count}${fieldError ? `<p class="field-error" id="${errorId}" role="alert">${esc(fieldError)}</p>` : ''}</div>`;
}

// @module kit
// Section 8: the "Logo, colours and fonts" fieldset inside the onboarding
// card. `kit` here is the small in-progress edit state kept on the inline
// draft (state.kit): only what the person has touched, defaulting to the
// projection's brand.kit (section 7) for anything left alone. Rendering is
// defensive: a missing/absent brand.kit is treated as empty, never thrown.
export const KIT_COLOR_ROLES = Object.freeze(['primary', 'secondary', 'accent', 'background', 'text', 'other']);
export const KIT_FONT_USES = Object.freeze(['headings', 'body', 'captions', 'other']);
export const KIT_LIMITS = Object.freeze({ maxColors: 8, maxFonts: 4 });
// Optional real photos of the brand's world (the place, the people, the product in use), added at setup.
export const KIT_PHOTOS_MAX = 5;
export const KIT_PHOTOS_NOTE = 'Real photos of your place or product. Optional.';
export const KIT_PHOTOS_LATER = 'Saved when you press Start research.';
const KIT_SOCIAL_PLATFORMS =Object.freeze({ instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' });

// What the kit suggests from the brand's own places: a logo from its website or its profile pictures, colours from that logo or from frames of its
// videos, and a typeface that looks like the text in them. Only suggestions: the person says Use this or Not this, edits the rest, and an upload always wins.
const KIT_SUGGEST_ACCOUNTS = Object.freeze({ tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' });
const KIT_SUGGEST_SITE = Object.freeze({ website: 'website logo', website_header: 'website logo', website_icon: 'website icon', website_og: 'website sharing image' });
const KIT_COLOUR_ORIGINS = Object.freeze({ logo: 'your logo', videos: 'your videos' });
const wordsAnd = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// Where a suggested logo was found, in the person's words: "TikTok profile picture", "website logo and Instagram profile picture".
export function suggestedLogoPlaces(sources = []) {
  const list = Array.isArray(sources) ? sources : [];
  const site = [...new Set(list.map(source => KIT_SUGGEST_SITE[source]).filter(Boolean))];
  const accounts = [...new Set(list.map(source => KIT_SUGGEST_ACCOUNTS[source]).filter(Boolean))];
  return wordsAnd([...site, ...(accounts.length ? [`${wordsAnd(accounts)} profile picture${accounts.length > 1 ? 's' : ''}`] : [])]);
}

// "From your logo", "From your videos" or "From your logo and your videos" for colours the kit suggested; empty for any other palette.
export function suggestedColoursNote(palette = []) {
  const origins = [...new Set((Array.isArray(palette) ? palette : []).map(color => KIT_COLOUR_ORIGINS[color?.from]).filter(Boolean))];
  return origins.length ? `From ${wordsAnd(origins)}.` : '';
}

// Folders of the brand's own videos, photos and fonts, added on the onboarding page. The board runs in a browser and cannot read a folder on this
// computer, so the person presses "Choose a folder..." (the board request `brand_folder_pick`): Claude opens the operating system's own folder
// dialog on their computer and imports the folder they choose. Pasting a full path (the request `brand_folder_add`) stays as a small fallback. Either
// way the person says who owns the files, Claude reads them where they are (nothing is copied or uploaded), learns from the videos and photos, and
// offers the fonts to the kit.
export const KIT_FOLDER_NOTE = 'Read in place. Nothing is copied or uploaded.';
export const KIT_FOLDER_RIGHTS = Object.freeze([
  { value: 'ours', label: 'Ours', hint: 'Can be used in posts.' },
  { value: 'client_ask', label: "Client work, ask first", hint: 'Asks before use in a post.' },
  { value: 'never', label: 'Reference only', hint: 'Listed only. Never studied or posted.' },
]);
export const KIT_FOLDER_OWNER_QUESTION = 'Who owns these files?';
export const KIT_FOLDER_PICK_HINT = '';
export const KIT_FOLDER_PICK_WAIT = "Choose an owner first.";
export const KIT_FOLDER_PICK_OPENED = 'Folder picker opened';
const KIT_FOLDER_KINDS = Object.freeze([['video', 'video', 'videos'], ['image', 'photo', 'photos'], ['audio', 'audio file', 'audio files'], ['font', 'font', 'fonts']]);
const KIT_FOLDER_STATES = Object.freeze({ indexing: "Reading the files", stopped: 'Stopped part-way', moved: "Folder not found" });
const KIT_FOLDER_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const KIT_FOLDER_SHOWN_MS = 120000;
const folderNumber = value => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

// "12 videos, 40 photos, 2 fonts" from a folder's counts by kind ({video, image, audio, font}); empty when it holds none of them.
export function folderCountsLine(kinds) {
  const counts = kinds && typeof kinds === 'object' ? kinds : {};
  return KIT_FOLDER_KINDS.map(([key, one, many]) => [folderNumber(counts[key]), one, many]).filter(([count]) => count).map(([count, one, many]) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`).join(', ');
}

// What the paste-a-path fallback sends: { args: { folder, rights, label? }, name } or { error }. The rights answer is the person's own and is
// never defaulted. The name is what the row shows (the label, else the folder's last part); the full path appears nowhere on the page.
export function folderRequestArgs({ path, label, rights } = {}) {
  const folder = String(path ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!folder) return { error: 'Paste the full folder path.' };
  if (!KIT_FOLDER_PATH.test(folder)) return { error: 'Use the full folder path.' };
  if (folder.length > 1000) return { error: 'That path is too long.' };
  if (!KIT_FOLDER_RIGHTS.some(option => option.value === rights)) return { error: NOTE_OWNER_FIRST };
  const words = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (words.length > 120) return { error: NOTE_NAME_LONG };
  const last = folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folder;
  return { args: { folder, rights, ...(words ? { label: words } : {}) }, name: words || last };
}

// What "Choose a folder..." sends (the request `brand_folder_pick`): { args: { rights, label? }, name } or { error }. No path: the folder is
// chosen in the operating system's dialog on the person's computer. The rights answer is the person's own and is never defaulted.
export function folderPickArgs({ label, rights } = {}) {
  if (!KIT_FOLDER_RIGHTS.some(option => option.value === rights)) return { error: NOTE_OWNER_FIRST };
  const words = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (words.length > 120) return { error: NOTE_NAME_LONG };
  return { args: { rights, ...(words ? { label: words } : {}) }, name: words || 'Your folder' };
}

// Fonts the person uploads on the onboarding page. The kit keeps a font by its family name (the folder digest reads the name from a font file
// the same way), so the file itself is only read here: its name goes into the kit's fonts and its bytes preview the specimen in the page.
export const KIT_FONT_EXTENSIONS = Object.freeze(['ttf', 'otf', 'woff', 'woff2']);
export const KIT_FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';
export const KIT_FONT_FILE_MAX = 20 * 1024 * 1024;
export const KIT_FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ._'-]{0,79}$/;
const FONT_WEIGHT_TAIL = /[-_\s]+(?:thin|hairline|extralight|ultralight|light|book|regular|roman|normal|medium|semibold|demibold|bold|extrabold|ultrabold|heavy|black|italic|oblique|italics|variable|[1-9]00)$/i;

// The family as a lookup key: one spelling for "Playfair  Display" and "playfair display".
export const fontKey = family => String(family ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// A plain-words problem with a picked font file, or '' when it can be read.
export function fontFileProblem(file) {
  const extension = String(file?.name ?? '').toLowerCase().split('.').pop();
  if (!file || !KIT_FONT_EXTENSIONS.includes(extension)) return 'Use a .ttf, .otf or .woff file.';
  if (!(file.size > 0)) return 'That font file is empty.';
  if (file.size > KIT_FONT_FILE_MAX) return 'That font is over 20 MB.';
  return '';
}

// The first use a new font takes: headings, then body, then captions, then other (the kit holds at most 4 fonts).
export function nextFontUse(fonts) {
  const taken = new Set((Array.isArray(fonts) ? fonts : []).map(font => font?.use));
  return KIT_FONT_USES.find(use => use !== 'other' && !taken.has(use)) || 'other';
}

// "BrandSans-Bold.woff2" is the family "BrandSans": the file name with its extension and weight word taken off. null when nothing usable is left.
export function fontFamilyFromFileName(name) {
  let base = String(name ?? '').split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_]+/g, ' ');
  for (let guard = 0; guard < 4; guard += 1) {
    const next = base.replace(FONT_WEIGHT_TAIL, '');
    if (!next || next === base) break;
    base = next;
  }
  const family = base.replace(/\s+/g, ' ').trim();
  return KIT_FONT_FAMILY.test(family) ? family : null;
}

// The Google Fonts stylesheet address for a family name, or null when the name could not be one (only letters, digits and spaces are asked for).
export function googleFontHref(family) {
  const name = String(family ?? '').trim().replace(/\s+/g, ' ');
  return /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/.test(name) ? `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}&display=swap` : null;
}

function nameTableFamily(table) {
  if (!table || table.byteLength < 6) return null;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2);
  const base = view.getUint16(4);
  const best = new Map();
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 12;
    if (at + 12 > table.byteLength) break;
    const platform = view.getUint16(at);
    const language = view.getUint16(at + 4);
    const id = view.getUint16(at + 6);
    const length = view.getUint16(at + 8);
    const offset = base + view.getUint16(at + 10);
    if ((id !== 1 && id !== 16) || offset + length > table.byteLength) continue;
    const rank = platform === 3 && language === 0x0409 ? 4 : platform === 3 ? 3 : platform === 0 ? 2 : platform === 1 && language === 0 ? 1 : 0;
    if (!rank || (best.get(id)?.rank ?? 0) >= rank) continue;
    const raw = table.subarray(offset, offset + length);
    let text = '';
    if (platform === 1) for (const byte of raw) text += String.fromCharCode(byte);
    else for (let j = 0; j + 1 < raw.length; j += 2) text += String.fromCharCode((raw[j] << 8) | raw[j + 1]);
    text = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) best.set(id, { rank, text });
  }
  // The typographic family is the whole family ("Montserrat"); the plain family may carry a weight ("Montserrat SemiBold").
  let family = best.get(16)?.text || '';
  if (!family && best.get(1)?.text) {
    family = best.get(1).text;
    for (let guard = 0; guard < 4; guard += 1) {
      const next = family.replace(FONT_WEIGHT_TAIL, '');
      if (!next || next === family) break;
      family = next;
    }
  }
  return KIT_FONT_FAMILY.test(family) ? family : null;
}

function sfntTable(bytes, base, tag) {
  if (base + 12 > bytes.byteLength) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(base + 4);
  if (!count || count > 512) return null;
  for (let i = 0; i < count; i += 1) {
    const at = base + 12 + i * 16;
    if (at + 16 > bytes.byteLength) return null;
    if (String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]) !== tag) continue;
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (!length || length > 2 * 1024 * 1024 || offset + length > bytes.byteLength) return null;
    return bytes.subarray(offset, offset + length);
  }
  return null;
}

async function woffTable(bytes, tag) {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(12);
  if (!count || count > 512) return null;
  for (let i = 0; i < count; i += 1) {
    const at = 44 + i * 20;
    if (at + 20 > bytes.byteLength) return null;
    if (String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]) !== tag) continue;
    const offset = view.getUint32(at + 4);
    const packed = view.getUint32(at + 8);
    const original = view.getUint32(at + 12);
    if (!original || original > 2 * 1024 * 1024 || offset + packed > bytes.byteLength) return null;
    const data = bytes.subarray(offset, offset + packed);
    if (packed >= original) return data;
    if (typeof DecompressionStream !== 'function') return null;
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return null;
}

// The family name inside a font file's own `name` table (.ttf, .otf, the first font of a .ttc, and .woff), the way the folder digest reads it on
// the computer: the typographic family when the font has one, else the family with a trailing weight word taken off. A .woff2 file is Brotli packed
// and the browser cannot unpack it, so it returns null (the caller falls back to the file name). Never throws.
export async function fontFamilyFromBytes(input) {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < 12) return null;
    const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (signature === 'wOF2') return null;
    if (signature === 'wOFF') return nameTableFamily(await woffTable(bytes, 'name'));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const base = signature === 'ttcf' ? view.getUint32(12) : 0;
    return nameTableFamily(sfntTable(bytes, base, 'name'));
  } catch { return null; }
}

// A hex colour, with or without '#', 3 or 6 digits, normalized to
// '#RRGGBB' uppercase. Anything else (empty, malformed) returns null so a
// caller can tell "not a colour" apart from a real value.
export function normalizeHex(value) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return `#${hex.toUpperCase()}`;
}

// The kit's research/capture phase. 'loading' whenever a capture or
// research pass is actively running (the fieldset is disabled while
// Claude is reading the site); 'new' before onboarding has started at all
// (the fieldset is still enabled, so the person can add a logo, colours or
// fonts up front and skip the research for those parts); else 'ready' to
// show and edit whatever was found, confirmed, or left empty.
const CAPTURE_SETTLED = new Set(['complete', 'partial', 'failed', 'unavailable']);

function kitPhase(brand, held = false) {
  if (held) return 'loading';
  if (!brand) return 'new';
  const researchPhase = brandResearchPhase(brand);
  // Before research starts the card stays open even while the brand's website and accounts are being read: what that finds arrives as
  // suggestions the person can take or leave, so there is nothing to lock.
  if (researchPhase === 'new') return 'new';
  const captureStatus = brand.kit?.capture?.status;
  if (captureStatus === 'waiting' || captureStatus === 'running') return 'loading';
  if (researchPhase === 'running' && !CAPTURE_SETTLED.has(captureStatus)) return 'loading';
  return 'ready';
}

// Inline validation for the kit editor: every colour must be a valid hex
// value, at least one colour (when there are any) must be marked primary,
// every font needs a family name, and a rejected logo file carries its own
// message. Keyed the same way kitSection reads fieldErrors back, so a
// caller can pass this straight through.
export function validateKit(kit = {}) {
  const errors = {};
  const palette = Array.isArray(kit.palette) ? kit.palette : [];
  const fonts = Array.isArray(kit.fonts) ? kit.fonts : [];
  palette.forEach((color, index) => {
    if (!normalizeHex(color?.value)) errors[`color_${index}`] = 'Use a colour like #1A2B3C.';
  });
  if (palette.length && !palette.some(color => color?.role === 'primary')) {
    errors.palette = 'Choose one primary colour.';
  }
  fonts.forEach((font, index) => {
    if (!String(font?.family ?? '').trim()) errors[`font_${index}`] = 'Enter a font name, like Inter.';
  });
  if (kit.logo?.error) errors.logo = kit.logo.error;
  return errors;
}

export function kitPayload(brand, kit = {}) {
  const projected = brand?.kit || {};
  const logoState = kit.logo || {};
  let logo;
  if (logoState.action === 'upload' && logoState.dataBase64) {
    logo = { action: 'upload', mimeType: logoState.mimeType, dataBase64: logoState.dataBase64 };
    if (logoState.thumbBase64) { logo.thumbBase64 = logoState.thumbBase64; logo.thumbMimeType = logoState.thumbMimeType || logoState.mimeType; }
  } else if (logoState.action === 'asset' && logoState.assetId) {
    logo = { action: 'asset', assetId: logoState.assetId, mimeType: logoState.mimeType, width: logoState.width ?? null, height: logoState.height ?? null };
    if (logoState.thumbAssetId) { logo.thumbAssetId = logoState.thumbAssetId; logo.thumbMimeType = logoState.thumbMimeType || logoState.mimeType; }
  } else if (logoState.action === 'suggested' && logoState.id) {
    // A logo the person took from the suggestions: only its id travels, the picture is already on this computer.
    logo = { action: 'suggested', id: logoState.id };
  } else if (logoState.action === 'remove') {
    logo = { action: 'remove' };
  } else {
    logo = { action: 'keep' };
  }
  const palette = (Array.isArray(kit.palette) ? kit.palette : projected.palette || []).map(color => ({
    value: normalizeHex(color?.value) || color?.value || '',
    role: color?.role || 'other',
    ...(color?.name ? { name: color.name } : {}),
  }));
  const fonts = (Array.isArray(kit.fonts) ? kit.fonts : projected.fonts || []).map(font => ({
    family: font?.family || '',
    use: font?.use || 'other',
  }));
  const references = (Array.isArray(kit.references) ? kit.references : []).map(photoPayload).filter(Boolean);
  return { logo, palette, fonts, ...(references.length ? { references } : {}) };
}

// The kickoff ("Start onboarding") onboard_brand call happens before any
// research has run, so there is nothing yet to compare a draft against:
// `kit` is included only when the person actually added something (an
// uploaded logo, or at least one colour or font), and omitted entirely
// otherwise, so an untouched kickoff never opens a kit review with nothing
// in it.
export function kitKickoffArgs(kit = {}) {
  const hasLogo = (kit.logo?.action === 'upload' && Boolean(kit.logo?.dataBase64))
    || (kit.logo?.action === 'asset' && Boolean(kit.logo?.assetId))
    || (kit.logo?.action === 'suggested' && Boolean(kit.logo?.id));
  const hasPalette = Array.isArray(kit.palette) && kit.palette.length > 0;
  const hasFonts = Array.isArray(kit.fonts) && kit.fonts.length > 0;
  const hasPhotos = Array.isArray(kit.references) && kit.references.some(photo => photoPayload(photo));
  if (!hasLogo && !hasPalette && !hasFonts && !hasPhotos) return {};
  return { kit: kitPayload(null, kit) };
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Turns the already-downscaled main and thumb logo blobs (from exportUnderLimit,
// each {mimeType, blob, width, height}) into the `kit.logo` shape the request will
// carry. When `assets` (the artifact's `claude.use('assets')` namespace) is
// available, both blobs are uploaded to the artifact's asset store and the result
// carries only their ids, so the bytes never pass through chat; board-sync then
// downloads them to a local file and deletes the transit copies once the request
// is applied. `assets` is writer-only and per-view (null on a read-only view, or
// on a runtime that predates it), and an upload can reject (quota, rate limit,
// transient store trouble); either way this falls back to the pre-assets
// inline-base64 path, so the person can always add a logo. Never throws.
export async function encodeLogoUpload(assets, main, thumb) {
  if (assets) {
    try {
      const mainAsset = await assets.upload(main.blob, { type: main.mimeType });
      const thumbAsset = await assets.upload(thumb.blob, { type: thumb.mimeType });
      return {
        action: 'asset',
        assetId: mainAsset.id,
        mimeType: main.mimeType,
        width: main.width ?? null,
        height: main.height ?? null,
        thumbAssetId: thumbAsset.id,
        thumbMimeType: thumb.mimeType,
      };
    } catch {
      // Fall through to the inline base64 path below.
    }
  }
  const dataBase64 = await blobToBase64(main.blob);
  const thumbBase64 = await blobToBase64(thumb.blob);
  return { action: 'upload', mimeType: main.mimeType, dataBase64, thumbBase64, thumbMimeType: thumb.mimeType };
}

// The accepted product photo types, shared by the New job field and Finish
// the brief's own photo field: no SVG, since a product shot is a photograph.
export const PHOTO_ACCEPT = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

// Same shape as encodeLogoUpload, for one already-downscaled product photo
// (from exportPhoto/exportPhotoUnderLimit, {mimeType, blob, width, height}):
// uploaded to the artifact's asset store when available, so the bytes never
// pass through chat, else inlined as base64. Never throws.
export async function encodePhotoUpload(assets, photo, fileName) {
  if (assets) {
    try {
      const asset = await assets.upload(photo.blob, { type: photo.mimeType });
      return { action: 'asset', assetId: asset.id, mimeType: photo.mimeType, width: photo.width ?? null, height: photo.height ?? null, fileName: fileName || null };
    } catch {
      // Fall through to the inline base64 path below.
    }
  }
  const dataBase64 = await blobToBase64(photo.blob);
  return { action: 'upload', mimeType: photo.mimeType, dataBase64, width: photo.width ?? null, height: photo.height ?? null, fileName: fileName || null };
}

// The fields a photo request actually needs, dropping local-only UI state
// (previewDataUrl, busy, error, requestId...) before it goes on the wire.
export function photoPayload(photo) {
  if (!photo || photo.error || photo.busy) return null;
  if (photo.action === 'asset') return { action: 'asset', assetId: photo.assetId, mimeType: photo.mimeType, width: photo.width ?? null, height: photo.height ?? null, fileName: photo.fileName || null };
  if (photo.action === 'upload') return { action: 'upload', mimeType: photo.mimeType, dataBase64: photo.dataBase64, width: photo.width ?? null, height: photo.height ?? null, fileName: photo.fileName || null };
  return null;
}

// "Add a reference": a picture, video, audio file, caption text or add-on the person puts on a job from the
// board itself, so they never have to type a file path in chat. Files go to the artifact's asset store (the
// same transit the logo and product photo use); the server saves them in the job's own folder.
export const REFERENCE_TYPES = Object.freeze([
  { id: 'picture', label: 'Reference picture', hint: 'PNG, JPG or WebP', kinds: ['image'] },
  { id: 'video', label: 'Reference video', hint: 'MP4, MOV or WebM', kinds: ['video'] },
  { id: 'audio', label: 'Audio (music or voice)', hint: 'MP3, WAV, M4A or OGG', kinds: ['audio'] },
  { id: 'caption', label: 'Post text', hint: 'Type or choose a file', kinds: ['text'] },
  { id: 'addon', label: 'Add-on', hint: 'Any file', kinds: ['image', 'video', 'audio', 'document', 'text'] },
]);
const REFERENCE_EXT = Object.freeze({
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', aac: 'audio', pdf: 'document', txt: 'text', md: 'text', srt: 'text', vtt: 'text',
});
// One optional tap saying what a reference is for. Only the roles that fit the chosen type are offered (none for typed text).
export const REFERENCE_ROLES = Object.freeze([
  { id: 'logo', label: 'Logo', types: ['picture', 'addon'] },
  { id: 'product', label: 'Product', types: ['picture', 'addon'] },
  { id: 'person', label: 'Person or character', types: ['picture', 'addon'] },
  { id: 'style', label: 'Style or look', types: ['picture', 'video', 'addon'] },
  { id: 'motion', label: 'Motion', types: ['video', 'addon'] },
  { id: 'sound', label: 'Music or voice', types: ['audio', 'addon'] },
]);
export const referenceRolesFor = typeId => REFERENCE_ROLES.filter(role => role.types.includes(typeId));
// The role to send: the picked one only while it still fits the chosen type, else none.
export const referenceRoleOf = (typeId, role) => (referenceRolesFor(typeId).some(item => item.id === role) ? role : '');
export const referenceRoleLabel = role => REFERENCE_ROLES.find(item => item.id === role)?.label || '';
export const REFERENCE_LIMIT_MB = Object.freeze({ image: 20, video: 100, audio: 50, document: 20 });
export const REFERENCE_TEXT_MAX = 20000;
export const REFERENCE_NOTE_MAX = 500;
export const REFERENCE_INLINE_MAX = 180 * 1024;
export function referenceKindOf(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  return REFERENCE_EXT[ext] || null;
}
// A plain-words problem with a picked file for the chosen type, or '' when it can go ahead.
export function referenceProblem(typeId, file) {
  const type = REFERENCE_TYPES.find(item => item.id === typeId);
  if (!type) return TXT_CHOOSE_WHAT_THIS_IS;
  if (!file) return '';
  const kind = referenceKindOf(file.name);
  if (!kind || !type.kinds.includes(kind)) return `${type.label} takes ${type.hint}. Pick a different file, or change what it is.`;
  if (kind === 'text') return file.size > REFERENCE_TEXT_MAX * 4 ? 'That text file is too long.' : '';
  const limit = REFERENCE_LIMIT_MB[kind];
  if (file.size > limit * 1024 * 1024) return `That file is over ${limit} MB. Try a smaller copy.`;
  return '';
}
// The wire shape of one reference. A file goes to the asset store when `assets` is there, else inline when small;
// text always goes inline. Throws a plain-worded Error. Never reads the file into chat.
export async function encodeReferenceUpload(assets, { type, file, text, note, role }) {
  const cleanNote = String(note || '').replace(/\s+/g, ' ').trim();
  if (cleanNote.length > REFERENCE_NOTE_MAX) throw new Error(`Keep the note under ${REFERENCE_NOTE_MAX} characters.`);
  const base = { type, ...(cleanNote ? { note: cleanNote } : {}), ...(referenceRoleOf(type, role) ? { role: referenceRoleOf(type, role) } : {}) };
  const kind = file ? referenceKindOf(file.name) : 'text';
  if (kind === 'text') {
    const body = file ? await file.text() : String(text || '');
    if (!body.trim()) throw new Error(TXT_TYPE_TEXT_OR_CHOOSE);
    if (body.length > REFERENCE_TEXT_MAX) throw new Error(`That text is over ${REFERENCE_TEXT_MAX.toLocaleString('en-US')} characters. Shorten it.`);
    return { ...base, action: 'text', text: body, fileName: file ? file.name : 'caption.txt' };
  }
  const common = { ...base, fileName: file.name, mimeType: file.type || '', size: file.size };
  if (assets) {
    try {
      const asset = await assets.upload(file, { type: file.type || 'application/octet-stream' });
      return { ...common, action: 'asset', assetId: asset.id };
    } catch {
      if (file.size > REFERENCE_INLINE_MAX) throw new Error('Upload failed. Try again or use a smaller copy.');
    }
  } else if (file.size > REFERENCE_INLINE_MAX) {
    throw new Error('Open the board inside Claude to upload.');
  }
  return { ...common, action: 'upload', dataBase64: await blobToBase64(file) };
}
// What a reference looks like at a glance: its picture when there is one (a video gets a play mark on it), else an icon for
// its type, so the person can see it is the right file. Used for saved references, files waiting in a list and a picked file.
const REF_ICON_PATHS = Object.freeze({
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  audio: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  text: '<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>',
  page: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
});
const refIcon = kind => `<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${REF_ICON_PATHS[kind] || REF_ICON_PATHS.document}</svg>`;
export function referenceThumb({ kind = '', thumb = '' } = {}) {
  const picture = typeof thumb === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(thumb) ? thumb : '';
  const play = kind === 'video' && picture ? '<span class="ref-thumb-play" aria-hidden="true"></span>' : '';
  return `<span class="ref-thumb ref-thumb-${esc(REF_ICON_PATHS[kind] ? kind : 'document')}${picture ? ' has-picture' : ''}" aria-hidden="true">${picture ? `<img src="${esc(picture)}" alt="" loading="lazy" decoding="async">` : refIcon(kind)}${play}</span>`;
}
// One reference as a small card: the picture or icon, the name, and what it is (with the site for a link).
export function referenceCard({ kind, thumb, name, label, note, site, role } = {}) {
  const small = [label, referenceRoleLabel(role), site, note ? truncateText(note, 60) : ''].filter(Boolean).map(esc).join(' · ');
  return `<span class="ref-card" title="${esc(name || '')}">${referenceThumb({ kind, thumb })}<span class="ref-card-text"><span class="ref-card-name">${esc(truncateText(name || 'Reference', 48))}</span>${small ? `<small>${small}</small>` : ''}</span></span>`;
}
// A saved reference on the job page: the card opens a larger view, and a small X takes it off the job after a question in the card.
export function savedReferenceItem(ref = {}, { confirming = false, removing = false } = {}) {
  const name = String(ref.name || 'Reference');
  const id = esc(ref.id || '');
  if (removing) return `<span class="ref-card ref-removing" role="status"><span class="ref-card-text"><span class="ref-card-name">${esc(truncateText(name, 48))}</span><small>Removing...</small></span></span>`;
  if (confirming) return `<span class="ref-card ref-confirm" role="group" aria-label="${esc(`Remove ${name}?`)}"><span class="ref-card-text"><span class="ref-card-name">Remove this reference?</span><small>${esc(truncateText(name, 48))}</small><span class="ref-confirm-actions"><button type="button" class="primary" data-ref-confirm="${id}">Remove</button><button type="button" class="quiet" data-ref-keep="${id}">Keep</button></span></span></span>`;
  return `<button type="button" class="ref-open" data-ref-open="${id}" aria-haspopup="dialog" aria-label="${esc(`See ${name} larger`)}">${referenceCard(ref)}</button><button type="button" class="ref-x" data-ref-remove="${id}" aria-label="${esc(`Remove ${name}`)}" title="Remove"><svg aria-hidden="true" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
}
// The larger view of one saved reference (inside the board's full-size viewer). The board cannot read local files, so it shows what
// the snapshot carries: a bigger picture (or the small one), the full copy when one was uploaded to the board, and the start of a text.
export function referenceViewer(ref = {}) {
  const name = String(ref.name || 'Reference');
  const kind = ref.kind || 'document';
  const url = safePreviewUrl(ref.url);
  const picture = safePreviewUrl(ref.large) || safePreviewUrl(ref.thumb);
  const image = alt => (picture ? `<img class="ref-viewer-img" src="${esc(picture)}" alt="${esc(alt)}">` : '');
  const icon = `<span class="ref-viewer-icon">${refIcon(kind)}</span>`;
  let media = '';
  let hint = '';
  if (kind === 'image') {
    const full = url && !/\.(mp4|mov|webm|m4v|mp3|wav|m4a|ogg|aac|pdf)(\?|$)/i.test(url) ? url : picture;
    media = full ? `<img class="ref-viewer-img" src="${esc(full)}" alt="${esc(name)}">` : icon;
  } else if (kind === 'video') {
    media = url ? `<video class="ref-viewer-media" controls playsinline preload="metadata" src="${esc(url)}"${picture ? ` poster="${esc(picture)}"` : ''} aria-label="${esc(name)}"></video>` : (image(`First picture of ${name}`) || icon);
    if (!url) hint = TXT_NO_PREVIEW_YET;
  } else if (kind === 'audio') {
    media = url ? `${icon}<audio class="ref-viewer-audio" controls preload="metadata" src="${esc(url)}" aria-label="${esc(name)}"></audio>` : icon;
    if (!url) hint = TXT_NO_PREVIEW_YET;
  } else if (kind === 'text') {
    const text = String(ref.excerpt || '');
    media = text ? `<pre class="ref-viewer-text">${esc(text)}${text.length >= 400 ? '…' : ''}</pre>` : icon;
  } else if (kind === 'page') {
    media = image(`Main picture of ${name}`) || icon;
  } else {
    media = icon;
  }
  const link = kind === 'page' ? safeHttpsLink(ref.link) : null;
  const facts = [ref.label, referenceRoleLabel(ref.role), ref.site].filter(Boolean).map(esc).join(' · ');
  return `<div class="ref-viewer-media-box">${media}</div><div class="ref-viewer-info"><h2 id="ref-viewer-title" class="ref-viewer-title">${esc(name)}</h2>${facts ? `<p class="ref-viewer-facts">${facts}</p>` : ''}${ref.note ? `<p class="ref-viewer-note">${esc(ref.note)}</p>` : ''}${hint ? `<p class="muted">${esc(hint)}</p>` : ''}${link ? `<p>${externalLink(link, 'Open the page')}</p>` : ''}</div>`;
}
// Forget "Removing..." for references the snapshot no longer lists, and give up on one that never went through (Claude was asked
// a couple of minutes ago and it is still there), so the X comes back with a plain line.
export function pruneRemoving(state = {}, refs = [], now = Date.now()) {
  if (state.confirm && !refs.some(ref => ref.id === state.confirm)) state.confirm = null;
  for (const [id, at] of Object.entries(state.removing || {})) {
    if (!refs.some(ref => ref.id === id)) delete state.removing[id];
    else if (now - at > 120000) { delete state.removing[id]; state.removeError = 'Could not remove it. Try again.'; }
  }
}
// A small picture of a file the person has just picked, made in the browser before anything is sent. Pictures are scaled on a
// canvas and videos give a frame; anything else, or a browser that cannot, shows the type icon. Each file is done once.
const PICK_PREVIEW_EDGE = 160;
const pickPreviews = new WeakMap();
let onPickPreviewReady = () => {};
// The page sets this once, from its own module: an imported name cannot be assigned there.
export function setPickPreviewReady(callback) { onPickPreviewReady = callback; }
export function pickedPreview(file) {
  if (!file || typeof file !== 'object') return '';
  if (pickPreviews.has(file)) return pickPreviews.get(file) || '';
  pickPreviews.set(file, '');
  const kind = referenceKindOf(file.name);
  if ((kind === 'image' || kind === 'video') && typeof document !== 'undefined') {
    (kind === 'image' ? imagePreview(file) : videoPreview(file)).then(uri => {
      if (!uri) return;
      pickPreviews.set(file, uri);
      onPickPreviewReady();
    }, () => {});
  }
  return '';
}
function drawPreview(source, width, height) {
  if (!width || !height) return '';
  const scale = Math.min(1, PICK_PREVIEW_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
async function imagePreview(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      try { return drawPreview(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close?.(); }
    } catch { /* fall through to reading it as a data URL */ }
  }
  if (file.size > 2 * 1024 * 1024) return '';
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => { try { resolve(drawPreview(img, img.naturalWidth, img.naturalHeight)); } catch { resolve(''); } };
      img.onerror = () => resolve('');
      img.src = String(reader.result || '');
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}
function videoPreview(file) {
  if (typeof URL?.createObjectURL !== 'function') return Promise.resolve('');
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const done = uri => { if (settled) return; settled = true; clearTimeout(timer); URL.revokeObjectURL(url); video.removeAttribute('src'); resolve(uri); };
    const timer = setTimeout(() => done(''), 8000);
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.onloadeddata = () => { try { video.currentTime = Math.min(0.5, (video.duration || 1) / 2); } catch { done(''); } };
    video.onseeked = () => { try { done(drawPreview(video, video.videoWidth, video.videoHeight)); } catch { done(''); } };
    video.onerror = () => done('');
    video.src = url;
  });
}

// The control that adds one reference: what it is, the file or the typed text, and a note. The job page's panel and the
// new-job form both use it; `prefix` only keeps their field names and ids apart ('ref' on the job page, 'nref' in the form).
function referenceControl(state = {}, { prefix = 'ref', busy = false, idKey = '' } = {}) {
  const type = REFERENCE_TYPES.find(item => item.id === (state.type || 'picture')) || REFERENCE_TYPES[0];
  const isText = type.id === 'caption';
  const fileId = `${prefix}-file${idKey ? `-${idKey}` : ''}`;
  const several = prefix === 'ref' || prefix === 'nref';
  const fileInput = `<input type="file" id="${fileId}" class="kit-file visually-hidden" name="${prefix}_file" accept="${type.kinds.includes('text') && type.kinds.length === 1 ? '.txt,.md,.srt,.vtt' : ''}"${several ? ' multiple' : ''} aria-label="Choose a file to add" ${busy ? 'disabled' : ''}>`;
  const pickedKind = state.fileName ? referenceKindOf(state.fileName) : '';
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const picked = state.fileName
    ? `<span class="ref-picked">${referenceThumb({ kind: pickedKind, thumb: pickedPreview(state.file) })}<span class="ref-card-text"><span class="ref-card-name">${esc(truncateText(state.fileName, 48))}</span><small>${pickedKind === 'image' ? 'Check the picture' : pickedKind === 'video' ? 'Check the clip' : 'Ready to add'}</small></span></span>`
    : queue.length ? '' : `<span class="muted">${esc(type.hint)}</span>`;
  const waiting = queue.length
    ? `<ul class="ref-queue" aria-label="Files waiting to be added">${queue.map((item, index) => `<li>${referenceCard({ kind: referenceKindOf(item.file?.name), thumb: pickedPreview(item.file), name: item.file?.name, label: REFERENCE_TYPES.find(entry => entry.id === item.type)?.label })}<button type="button" class="sb-ask" data-ref-unqueue="${index}" aria-label="${esc(`Remove ${item.file?.name || 'file'}`)}" ${busy ? 'disabled' : ''}>Remove</button></li>`).join('')}</ul>`
    : '';
  const textArea = isText ? `<label class="field-wide">Post text or notes<textarea name="${prefix}_text" rows="4" maxlength="${REFERENCE_TEXT_MAX}" ${busy ? 'disabled' : ''}>${esc(state.text || '')}</textarea></label>` : '';
  const roles = referenceRolesFor(type.id);
  const picked_role = referenceRoleOf(type.id, state.role);
  const roleRow = roles.length ? `<div class="ref-roles" role="group" aria-label="Use it for (optional)"><span class="ref-roles-label">Use it for (optional)</span><span class="ref-role-chips">${roles.map(role => `<button type="button" class="ref-role${role.id === picked_role ? ' on' : ''}" data-ref-role="${role.id}" data-ref-prefix="${prefix}" aria-pressed="${role.id === picked_role ? 'true' : 'false'}" ${busy ? 'disabled' : ''}>${esc(role.label)}</button>`).join('')}</span></div>` : '';
  const link = prefix === 'ref' ? `<label class="field-wide">Or paste a link<input name="ref_link" inputmode="url" autocomplete="off" value="${esc(state.link || '')}" placeholder="TikTok, YouTube, Instagram, any web page, or a picture or video link" ${busy ? 'disabled' : ''}></label>` : '';
  return `<label>What is it<select name="${prefix}_type" ${busy ? 'disabled' : ''}>${REFERENCE_TYPES.map(item => `<option value="${item.id}"${item.id === type.id ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>${roleRow}${textArea}<div class="ref-drop" data-ref-drop="${prefix}"><div class="ref-file">${fileInput}<label class="kit-file-button" for="${fileId}">${KIT_ICONS.upload}<span>${isText ? 'Or choose a text file' : several ? 'Choose files' : 'Choose a file'}</span></label>${picked}</div>${waiting}<small class="ref-drop-hint">or drop a file or screenshot</small></div>${link}<label>Note (optional)<input name="${prefix}_note" maxlength="${REFERENCE_NOTE_MAX}" value="${esc(state.note || '')}" placeholder="e.g. match this colour and pace" ${busy ? 'disabled' : ''}></label>`;
}
// A pasted or typed link as a full https address, or a plain-words problem.
export function referenceLinkOf(text) {
  const raw = String(text || '').trim();
  if (!raw) return { url: '' };
  if (/\s/.test(raw)) return { error: 'One link at a time.' };
  const full = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(full); } catch { return { error: 'Paste the whole link.' }; }
  if (url.protocol !== 'https:' || !url.hostname.includes('.')) return { error: TXT_USE_A_FULL_HTTPS };
  return { url: full };
}
export const REFERENCE_QUEUE_MAX = 10;
// How many references the panel's button will send: the queued files, plus the link, or the typed text when nothing is queued.
export function referencePanelCount(state = {}) {
  const queued = Array.isArray(state.queue) ? state.queue.length : 0;
  const link = String(state.link || '').trim() ? 1 : 0;
  const text = !queued && state.type === 'caption' && String(state.text || '').trim() ? 1 : 0;
  return queued + link + text;
}
// The References panel on a job page: what is saved, and the control that adds more.
// When Claude asked for a file (a question with wantsUpload), the panel opens on that question: its text and its own upload,
// which answers it, come first, so the open panel never shows only a general form that does not say what is wanted.
// "From this brand": the brand's saved logo and photos as small pictures to tap, then "Add to this job" copies the chosen one
// into the job's references without uploading it again. Shown only when the brand has saved files.
export function brandFilesPicker(files = [], state = {}) {
  const list = (Array.isArray(files) ? files : []).filter(file => file && typeof file.id === 'string');
  if (!list.length) return '';
  const busy = Boolean(state.busy);
  const chosen = list.some(file => file.id === state.brandPick) ? state.brandPick : '';
  const items = list.map(file => `<li><button type="button" class="ref-brand-file${file.id === chosen ? ' on' : ''}" data-ref-brand="${esc(file.id)}" aria-pressed="${file.id === chosen ? 'true' : 'false'}" title="${esc(file.name || '')}" ${busy ? 'disabled' : ''}>${referenceThumb({ kind: 'image', thumb: file.thumb })}<span class="ref-card-text"><span class="ref-card-name">${esc(truncateText(file.name || (file.kind === 'logo' ? 'Logo' : 'Photo'), 30))}</span><small>${file.kind === 'logo' ? 'Brand logo' : 'Brand photo'}</small></span></button></li>`).join('');
  return `<div class="ref-brand"><p class="field-hint">From this brand</p><ul class="ref-brand-list" aria-label="Files saved on this brand">${items}</ul><div class="ref-actions"><button type="button" class="sb-ask" data-ref-action="brand" ${busy || !chosen ? 'disabled' : ''}>Add to this job</button></div></div>`;
}
export function referencesPanel(project, state = {}, { openKeys = new Set(), open: forceOpen = false, asking = [], uploadState = () => ({}), brandFiles = [] } = {}) {
  const refs = Array.isArray(project?.references) ? project.references : [];
  const busy = Boolean(state.busy);
  const asked = (Array.isArray(asking) ? asking : []).filter(item => item?.questionId && item.wantsUpload);
  const chips = refs.map(ref => `<li class="ref-item" aria-label="${esc(`${ref.label}: ${ref.name}`)}">${savedReferenceItem(ref, { confirming: state.confirm === ref.id, removing: Boolean(state.removing?.[ref.id]) })}</li>`).join('');
  const list = refs.length ? `<ul class="ref-cards" aria-label="References on this job">${chips}</ul>${state.removeError ? `<p class="field-error" role="alert">${esc(state.removeError)}</p>` : ''}` : asked.length ? '' : '<p class="muted">Nothing added yet.</p>';
  const questions = asked.map(item => `<div class="ref-asked"><p class="inbox-text">${esc(inboxItemText(item))}</p>${questionUpload(item, uploadState(item) || {}, { place: 'refs' })}</div>`).join('');
  const other = asked.length ? '<p class="field-hint">Anything else for this job:</p>' : '';
  const form = `${brandFilesPicker(brandFiles, state)}<div class="ref-form">${other}${referenceControl(state, { prefix: 'ref', busy })}<div class="ref-actions"><button type="button" class="${asked.length ? 'quiet' : 'primary'}" data-ref-action="send" ${busy ? 'disabled' : ''}>${busy ? 'Saving...' : referencePanelCount(state) > 1 ? `Add ${referencePanelCount(state)} references` : 'Add reference'}</button></div>${state.error ? `<p class="field-error" role="alert">${esc(state.error)}</p>` : ''}${!state.error && state.message ? `<p class="muted" role="status">${esc(state.message)}</p>` : ''}</div>`;
  const open = forceOpen || asked.length > 0 || openKeys.has('more:refs') || busy || Boolean(state.error) || (Array.isArray(state.queue) && state.queue.length > 0);
  const title = asked.length ? (asked.length === 1 ? 'Claude asks for a file' : `Claude asks for ${asked.length} files`) : 'Add a reference';
  return `<details class="panel doc-panel" data-open-key="more:refs"${open ? ' open' : ''}><summary><span class="doc-summary-title">${title}</span>${refs.length ? ` <span class="count">${refs.length}</span>` : ''}</summary><div class="doc-body">${questions}${list}${form}</div></details>`;
}

// The file kind a picked file is, as the reference type that fits it best.
const REFERENCE_TYPE_OF_KIND = Object.freeze({ image: 'picture', video: 'video', audio: 'audio', text: 'caption', document: 'addon' });
// Keep the chosen type when it accepts the file; else the type that fits the file (a picture by default, a video for a clip).
export function referenceTypeFor(typeId, file) {
  const type = REFERENCE_TYPES.find(item => item.id === typeId);
  const kind = file ? referenceKindOf(file.name) : null;
  if (!kind || (type && type.kinds.includes(kind))) return type ? type.id : 'picture';
  return REFERENCE_TYPE_OF_KIND[kind] || 'addon';
}

// The type a picked file is, by itself: what the dropdown shows until the person changes it.
export function detectedReferenceType(file) { return referenceTypeFor('', file); }

// The paperclip in the agent chat composer, and the same control below it: pick a file, check its type, add a note, send.
const PAPERCLIP = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 11-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>';
export function chatAttachment(state = {}, agentName = 'Director') {
  const busy = Boolean(state.busy);
  const open = Boolean(state.open || state.error || busy);
  const button = `<button type="button" class="attach icon" data-aref-action="toggle" aria-label="Attach a file" aria-expanded="${open ? 'true' : 'false'}" title="Attach a file" ${busy ? 'disabled' : ''}>${PAPERCLIP}</button>`;
  const panel = open
    ? `<div class="ab-attach ref-form" data-aref><p class="field-hint">Send ${esc(agentName)} a file or text.</p>${referenceControl(state, { prefix: 'aref', busy })}<div class="ref-actions"><button type="button" class="primary" data-aref-action="send" ${busy ? 'disabled' : ''}>${busy ? 'Sending...' : 'Send file'}</button></div>${state.error ? `<p class="field-error" role="alert">${esc(state.error)}</p>` : ''}${!state.error && state.message ? `<p class="muted" role="status">${esc(state.message)}</p>` : ''}</div>`
    : '';
  return { button, panel };
}

// The upload control inside a question card, when the Director asked for a file.
// place keeps element ids unique when the same question's upload is also shown in the References panel.
export function questionUpload(item, state = {}, { place = '' } = {}) {
  const busy = Boolean(state.busy);
  const shown = { ...state, type: state.type || item?.wantsUpload?.type || 'picture' };
  const key = String(item?.questionId || '');
  return `<div class="inbox-upload ref-form" data-qref="${esc(key)}">${referenceControl(shown, { prefix: 'qref', busy, idKey: place ? `${key}-${place}` : key })}<div class="ref-actions"><button type="button" class="primary" data-qref-send="${esc(key)}" ${busy ? 'disabled' : ''}>${busy ? 'Sending...' : 'Send file'}</button></div>${state.error ? `<p class="field-error" role="alert">${esc(state.error)}</p>` : ''}${!state.error && state.message ? `<p class="muted" role="status">${esc(state.message)}</p>` : ''}</div>`;
}

// The same control inside the new-job form, before the job exists: each one the person adds waits in a short list and is
// sent with the job, so Claude's first read of the brief already has it. Several are allowed.
export const NEW_JOB_REFERENCES_MAX = 8;
export function freshNewJobRefs() { return { type: 'picture', file: null, fileName: '', text: '', note: '', error: '', open: false, items: [] }; }
// Check what is in the control and, when it is a reference, return it as a list item; else { error }.
export function newJobReferenceItem(state) {
  const type = REFERENCE_TYPES.find(item => item.id === state.type);
  if (!type) return { error: TXT_CHOOSE_WHAT_THIS_IS };
  const text = String(state.text || '');
  if (state.file) {
    const problem = referenceProblem(state.type, state.file);
    if (problem) return { error: problem };
  } else if (!(type.id === 'caption' && text.trim())) {
    return { error: type.id === 'caption' ? NOTE_TEXT_MISSING : 'Choose a file first.' };
  }
  const note = String(state.note || '').replace(/\s+/g, ' ').trim();
  if (note.length > REFERENCE_NOTE_MAX) return { error: `Keep the note under ${REFERENCE_NOTE_MAX} characters.` };
  return { item: { type: state.type, role: referenceRoleOf(state.type, state.role), file: state.file || null, text: state.file ? '' : text, note, name: state.file ? state.file.name : 'Typed text', label: type.label } };
}
export function newJobReferences(refs = freshNewJobRefs(), { busy = false } = {}) {
  const items = Array.isArray(refs.items) ? refs.items : [];
  const list = items.length
    ? `<ul class="ab-chips" aria-label="References for this job">${items.map((item, index) => `<li>${referenceCard({ kind: item.file ? referenceKindOf(item.file.name) : 'text', thumb: item.file ? pickedPreview(item.file) : '', name: item.name, label: item.label, note: item.note, role: item.role })} <button type="button" class="sb-ask" data-nref-remove="${index}" aria-label="${esc(`Remove ${item.name}`)}" ${busy ? 'disabled' : ''}>Remove</button></li>`).join('')}</ul>`
    : '';
  const full = items.length >= NEW_JOB_REFERENCES_MAX;
  const control = full
    ? `<p class="muted">That is ${NEW_JOB_REFERENCES_MAX} references. Add more on the job page.</p>`
    : `<div class="ref-form">${referenceControl(refs, { prefix: 'nref', busy })}<div class="ref-actions"><button type="button" class="sb-ask" data-nref-action="add" ${busy ? 'disabled' : ''}>Add to this job</button></div></div>`;
  const open = refs.open || items.length > 0 || Boolean(refs.error);
  return `<details class="new-refs field-wide" data-open-key="new:refs"${open ? ' open' : ''}><summary>References (optional)${items.length ? ` <span class="count">${items.length}</span>` : ''}</summary><div class="new-refs-body">${list}${control}${refs.error ? `<p class="field-error" role="alert">${esc(refs.error)}</p>` : ''}</div></details>`;
}

// @module forms
// After a kit action (add or remove a colour or font row, remove or replace
// the logo) mutates the draft and calls render(), the section re-renders
// fresh: the "+ Add colour"/"+ Add font" buttons carry no form `name` (so
// the generic focusName restore in render() cannot see them), and removing
// a row shifts every later row down by one index. This computes the
// selector for whichever control should take focus once the new markup is
// in, so the caller can stash it (inline.kitFocus) before mutating state.
// - add-color/add-font: the newly appended row's hex/family input.
// - remove-color/remove-font: the row now sitting at the removed index (the
//   one that "took its place"), the previous row if the removed one was
//   last, or the list's own "+ Add" button once the list is empty.
// - remove-logo/replace-logo: the (hidden) file input behind both the
//   upload tile and the Replace label, the one control they share.
// - pick-folder/rights-folder/upload-font: the Choose a folder button, the
//   first owner card (the button is off until one is picked), the font file input.
export function kitFocusSelector(action, index, count) {
  if (action === 'add-color') return `[name="kit_color_hex_${count - 1}"]`;
  if (action === 'add-font') return `[name="kit_font_family_${count - 1}"]`;
  if (action === 'remove-color') return count > 0 ? `[name="kit_color_hex_${Math.min(index, count - 1)}"]` : '[data-kit-action="add-color"]';
  if (action === 'remove-font') return count > 0 ? `[name="kit_font_family_${Math.min(index, count - 1)}"]` : '[data-kit-action="add-font"]';
  if (action === 'remove-logo' || action === 'replace-logo') return '#kit-logo-file';
  // Taking a suggested logo leaves the logo's own controls; turning one down moves to the next suggestion's button, else the upload.
  if (action === 'use-logo') return '#kit-logo-file';
  if (action === 'pass-logo') return '[data-kit-action="use-logo"], #kit-logo-file';
  if (action === 'remove-ref' || action === 'add-ref') return '#kit-ref-file';
  if (action === 'add-folder') return '#kit-folder-path';
  if (action === 'pick-folder') return '[data-kit-action="pick-folder"]';
  if (action === 'rights-folder') return '[name="kit_folder_rights"]';
  if (action === 'upload-font') return '#kit-font-file';
  return null;
}

// The "Logo, colours and fonts" fieldset: section 8, plus the owner's
// addition letting the person add a logo, colours or fonts before research
// even starts (phase 'new' renders the same enabled controls, just with a
// different intro line). `kit` is the draft's in-progress edits
// (state.kit); `fieldErrors` is validateKit's output, or null before the
// first submit attempt. `brand.kit.provided` (section 7 addition) marks
// which parts came from the person rather than research, shown as a small
// "Added by you" tag once research has run.
const KIT_ICONS = Object.freeze({
  upload: '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  plus: '<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  remove: '<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
 removeSmall: '<svg aria-hidden="true" viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
  check: '<svg aria-hidden="true" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  image: '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/></svg>',
  folder: '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  pencil: '<svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 2.5 3 3L5 14H2v-3z"/></svg>',
});

// Fonts the page could not show: a family that is neither a Google font nor installed on this computer. The page marks it after it has asked
// (see the app's loadKitFonts), and the font rows then say so instead of showing the fallback letters as if they were the font.
// `uploadedFonts` maps a family (fontKey) to the CSS name of the font file the person uploaded in this page, so its specimen shows the real letters.
export const uploadedFonts = new Map();
export const fontPreview = { missing: new Set() };

// One labelled block of the kit grid (Logo, Colours or Fonts). It reuses the
// context fields' own .context-field/.context-field-head markup, so its label
// row, label style and label-to-control spacing are exactly those of
// "Audience" above it, with the "Added by you" pill where their Edit button sits.
function kitBlock(key, label, body, tag = '', extraClass = '') {
  return `<div class="context-field kit-block${extraClass ? ` ${extraClass}` : ''}" role="group" aria-labelledby="kit-${key}-label"><div class="context-field-head"><span class="kit-label" id="kit-${key}-label">${esc(label)}</span>${tag}</div><div class="kit-stack">${body}</div></div>`;
}

// One folder the brand's footage holds, as `brand.library.footage.list` gives it: its name, whose footage it is, what it holds by kind
// and how far Claude got (reading the files, then looking at the videos and photos). No path is shown.
function kitFolderRow(folder) {
  const rights = KIT_FOLDER_RIGHTS.find(option => option.value === folder.rights)?.label || '';
  const lookable = folderNumber(folder.kinds?.video) + folderNumber(folder.kinds?.image) + folderNumber(folder.kinds?.audio);
  const described = Math.min(folderNumber(folder.described), lookable);
  const reading = folder.state === 'indexing' && folderNumber(folder.total) > 0 ? `${KIT_FOLDER_STATES.indexing} ${folderNumber(folder.processed)} of ${folderNumber(folder.total)}` : KIT_FOLDER_STATES[folder.state] || '';
  const looked = folder.state === 'ready' || !folder.state ? (lookable ? (described ? `Looked at ${described} of ${lookable}` : 'Not looked at yet') : '') : '';
  const held = folderCountsLine(folder.kinds) || (folderNumber(folder.files) ? `${folderNumber(folder.files)} ${folderNumber(folder.files) === 1 ? 'file' : 'files'}` : '');
  const meta = [rights, held, folderNumber(folder.missing) ? `${folderNumber(folder.missing)} missing` : '', reading, looked].filter(Boolean).map(esc).join(' &middot; ');
  return `<li class="library-item kit-folder"><span class="kit-folder-icon" aria-hidden="true">${KIT_ICONS.folder}</span><div class="library-main"><span class="library-text">${esc(trimmed(folder.name) || 'Folder')}</span><span class="library-meta">${meta}</span></div></li>`;
}

// A folder just added on this page, before the brand's footage lists it: waiting for Claude, read, or turned down with the reason. A folder
// picked in the dialog (kind 'pick') says the picker is open on the person's computer until the folder is chosen.
function kitFolderPending(entry, index) {
  const rights = KIT_FOLDER_RIGHTS.find(option => option.value === entry.rights)?.label || '';
  const failed = entry.status === 'declined' || entry.status === 'error';
  const picking = entry.kind === 'pick';
  const status = entry.status === 'sent' ? 'Sending...' : entry.status === 'waiting' ? (picking ? KIT_FOLDER_PICK_OPENED : TXT_WAITING_FOR_CLAUDE) : entry.status === 'applied' ? 'Added. Reading the files' : '';
  const meta = [rights, status].filter(Boolean).map(esc).join(' &middot; ');
  const dismiss = failed ? `<button type="button" class="quiet" data-kit-action="dismiss-folder" data-index="${index}" aria-label="${esc(`Dismiss: ${entry.name}`)}">Dismiss</button>` : '';
  const live = !failed && entry.status === 'waiting' && picking ? ' role="status"' : '';
  return `<li class="library-item kit-folder${failed ? ' is-failed' : ' is-pending'}"><span class="kit-folder-icon" aria-hidden="true">${KIT_ICONS.folder}</span><div class="library-main"><span class="library-text">${esc(entry.name)}</span>${meta ? `<span class="library-meta"${live}>${meta}</span>` : ''}${failed ? `<span class="field-error" role="alert">${esc(entry.message || 'Could not add this folder.')}</span>` : ''}</div>${dismiss}</li>`;
}

// The "Your videos, photos and fonts" block of the kit: the question of who owns the files (three cards, none picked until the person picks one),
// then a "Choose a folder..." button that opens the folder dialog on the person's computer (on as soon as an owner card is picked), a small "or
// paste a path" fallback, then the folders added so far with their status and counts (the brand's footage list, plus requests still waiting for
// Claude). `folders` is the draft's own state: { path, label, rights, error, busy, pasteOpen, pending: [{ requestId, kind?, name, rights, status,
// message, folderId, appliedAt }] }. The block lives on the brand's own page, so the brand exists and the controls work at once. Without a brand
// (the form never draws it then) there is nowhere to keep a folder yet, so the controls wait.
export function kitFolders(brand, folders = {}, disabled = false, now = Date.now()) {
  const state = folders && typeof folders === 'object' ? folders : {};
  const footage = brand?.library?.footage && typeof brand.library.footage === 'object' ? brand.library.footage : null;
  const listed = Array.isArray(footage?.list) ? footage.list.filter(item => item && typeof item === 'object') : [];
  const ids = new Set(listed.map(item => item.id));
  // Each request keeps its place in the draft's list (the Dismiss button names it), whichever of them are drawn.
  const pending = (Array.isArray(state.pending) ? state.pending : []).map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry && !(entry.status === 'applied' && (ids.has(entry.folderId) || now - (entry.appliedAt || now) > KIT_FOLDER_SHOWN_MS)));
  const rows = pending.map(({ entry, index }) => kitFolderPending(entry, index)).join('') + listed.map(kitFolderRow).join('');
  const fonts = Array.isArray(footage?.fonts) ? footage.fonts.map(name => trimmed(name)).filter(Boolean) : [];
  const waiting = !brand;
  const off = disabled || waiting || state.busy ? 'disabled' : '';
  const chosen = KIT_FOLDER_RIGHTS.some(option => option.value === state.rights);
  const errorId = 'kit-folder-error';
  const cards = KIT_FOLDER_RIGHTS.map(option => `<label class="kit-owner-card"><input type="radio" name="kit_folder_rights" value="${option.value}" data-kit-folder="rights" ${state.rights === option.value ? 'checked' : ''} ${disabled || waiting ? 'disabled' : ''}><span class="kit-owner-body"><span class="kit-owner-title">${esc(option.label)}</span><span class="kit-owner-hint">${esc(option.hint)}</span></span></label>`).join('');
  const pickHint = waiting || disabled ? '' : chosen ? KIT_FOLDER_PICK_HINT : KIT_FOLDER_PICK_WAIT;
  const pick = `<div class="kit-folder-pick"><button type="button" class="kit-choose" data-kit-action="pick-folder" aria-describedby="kit-folder-pick-hint" ${off || !chosen ? 'disabled' : ''}>${KIT_ICONS.folder}<span>${state.busy ? 'Opening...' : 'Choose a folder&hellip;'}</span></button><span class="muted kit-folder-pick-hint" id="kit-folder-pick-hint" data-pick-hint>${esc(pickHint)}</span></div>`;
  const owner = `<fieldset class="kit-owner" ${disabled || waiting ? 'disabled' : ''}><legend class="kit-sublabel" id="kit-folder-owner-label">${esc(KIT_FOLDER_OWNER_QUESTION)}</legend><div class="kit-owner-cards">${cards}</div></fieldset>`;
  const paste = `<details class="kit-paste" data-kit-paste ${state.pasteOpen || state.error ? 'open' : ''}><summary>Or paste a path</summary><div class="kit-folder-add"><div class="kit-folder-fields"><label class="kit-folder-field" for="kit-folder-path"><span>Folder on this computer</span><input type="text" id="kit-folder-path" name="kit_folder_path" data-kit-folder="path" value="${esc(state.path || '')}" placeholder="C:\\Users\\you\\Brand videos" autocomplete="off" spellcheck="false" aria-invalid="${state.error ? 'true' : 'false'}" ${state.error ? `aria-describedby="${errorId}"` : ''} ${off}></label><label class="kit-folder-field" for="kit-folder-label"><span>Name (optional)</span><input type="text" id="kit-folder-label" name="kit_folder_label" data-kit-folder="label" maxlength="120" value="${esc(state.label || '')}" placeholder="Summer shoot 2024" autocomplete="off" ${off}></label></div><button type="button" class="kit-add" data-kit-action="add-folder" ${off}>${KIT_ICONS.plus}<span>${state.busy ? 'Adding...' : 'Add folder'}</span></button></div></details>`;
  const problem = state.error ? `<p class="field-error" id="${errorId}" role="alert">${esc(state.error)}</p>` : '';
  const intro = `<p class="muted">${esc(waiting ? 'Folders open once onboarding starts.' : KIT_FOLDER_NOTE)}</p>`;
  const found = fonts.length ? `<p class="muted kit-folder-fonts">Fonts found: ${fonts.map(esc).join(', ')}</p>` : '';
  const list = rows ? `<ul class="library-list kit-folder-list">${rows}</ul>` : '';
  return kitBlock('folders', 'Your videos, photos and fonts (optional)', `${intro}${owner}${pick}${problem}${paste}${list}${found}`, '', 'kit-card kit-folders-block');
}

export function kitSection(brand, kit = {}, fieldErrors = null, held = false) {
  const phase = kitPhase(brand, held);
  const loading = phase === 'loading';
  const dis = loading ? 'disabled' : '';
  const projected = brand?.kit || {};
  const provided = projected.provided || {};
  const showTags = phase === 'ready';
  const tag = '<span class="pill">Added by you</span>';
  const readTag = '<span class="pill">Read from your website</span>';
  const logoState = kit.logo || {};
  const palette = Array.isArray(kit.palette) ? kit.palette : (projected.palette || []);
  const fonts = Array.isArray(kit.fonts) ? kit.fonts : (projected.fonts || []);
  const removed = logoState.action === 'remove';
  // A suggested logo the person took (Use this) is shown like an upload they made: from its preview, until it is saved.
  const chosen = logoState.action === 'suggested';
  const ownUpload = logoState.action === 'upload' || logoState.action === 'asset' || chosen;
  const preview = kitImageSrc(removed ? null : ownUpload ? (logoState.previewDataUrl || null) : projected.logo?.thumb || null);
  const hasLogo = !removed && Boolean(preview || ownUpload || projected.logo);
  const savedLogo = !logoState.action && Boolean(projected.logo);
  const logoAlt = brand?.name ? `${brand.name} logo` : 'Logo';
  const logoError = fieldErrors?.logo || null;
  const fileInput = label => `<input type="file" id="kit-logo-file" class="kit-file visually-hidden" name="kit_logo_file" accept="image/png,image/jpeg,image/webp,image/svg+xml"${label ? ` aria-label="${label}"` : ''} aria-invalid="${logoError ? 'true' : 'false'}" ${logoError ? 'aria-describedby="kit-logo-error"' : ''} ${dis}>`;
  // The same logo on a light and on a dark tile, so the person can check both. The second image is a decoration (the first carries the alt text).
  const tiles = src => `<div class="kit-logo-tiles"><figure class="kit-logo-tile is-light"><img src="${esc(src)}" alt="${esc(logoAlt)}"><figcaption>On light</figcaption></figure><figure class="kit-logo-tile is-dark"><img src="${esc(src)}" alt=""><figcaption>On dark</figcaption></figure></div>`;
  const ghostTiles = `<span class="kit-logo-ghosts" aria-hidden="true"><span class="kit-logo-ghost is-light">${KIT_ICONS.image}</span><span class="kit-logo-ghost is-dark">${KIT_ICONS.image}</span></span>`;
  // Logos the kit suggests from the brand's own places (its website, its profile pictures), each one looked at by Claude first. The best is offered
  // with Use this / Not this and the others as small pictures; the upload below them is always there, and the person's own file always wins.
  const passedLogos = new Set(Array.isArray(kit.logoPassed) ? kit.logoPassed : []);
  const offers = !hasLogo && !removed ? (Array.isArray(projected.suggested?.logos) ? projected.suggested.logos : []).filter(item => item?.id && !passedLogos.has(item.id) && kitImageSrc(item.thumb)) : [];
  const placesOf = item => suggestedLogoPlaces(Array.isArray(item.sources) && item.sources.length ? item.sources : [item.source]);
  const logoPlaces = chosen ? trimmed(logoState.places) : provided.logoSource ? suggestedLogoPlaces([provided.logoSource]) : '';
  const offerBody = () => {
    const [first, ...others] = offers;
    const thumbs = others.map(item => `<button type="button" class="kit-suggest-thumb" data-kit-action="use-logo" data-id="${esc(item.id)}" aria-label="${esc(`Use the logo suggested from your ${placesOf(item)}`)}" title="${esc(`From your ${placesOf(item)}`)}" ${dis}><img src="${esc(kitImageSrc(item.thumb))}" alt=""></button>`).join('');
    return `<div class="kit-drop kit-drop-filled">${tiles(kitImageSrc(first.thumb))}</div><p class="kit-suggest-note" role="status">Suggested from your ${esc(placesOf(first))}. Is this your logo?</p><div class="kit-logo-actions"><button type="button" class="kit-choose" data-kit-action="use-logo" data-id="${esc(first.id)}" ${dis}>Use this</button><button type="button" class="quiet" data-kit-action="pass-logo" data-id="${esc(first.id)}" ${dis}>Not this</button></div>${thumbs ? `<div class="kit-suggest-others" role="group" aria-label="Other logo suggestions"><span class="muted kit-card-note">Other suggestions</span>${thumbs}</div>` : ''}`;
  };
  const logoBody = hasLogo
    ? `<div class="kit-drop kit-drop-filled" data-kit-drop="logo">${preview ? tiles(preview) : `<div class="kit-logo-preview kit-logo-preview-none"><span>${savedLogo ? 'Logo saved (no preview)' : 'No preview'}</span></div>`}</div><div class="kit-logo-actions">${fileInput('Replace logo')}<label class="kit-file-button" for="kit-logo-file">Replace</label><button type="button" class="quiet" data-kit-action="remove-logo" ${dis}>Remove logo</button></div>`
    : offers.length
      ? `${offerBody()}<div class="kit-drop" data-kit-drop="logo">${fileInput('')}<label class="kit-upload is-compact" for="kit-logo-file"><span class="kit-upload-title">Or drop your own logo here</span><span class="kit-upload-hint">or <u>browse</u> &middot; PNG, JPG, WebP or SVG</span></label></div>`
      : `<div class="kit-drop" data-kit-drop="logo">${fileInput('')}<label class="kit-upload" for="kit-logo-file">${ghostTiles}<span class="kit-upload-title">Drop your logo here</span><span class="kit-upload-hint">or <u>browse</u> &middot; PNG, JPG, WebP or SVG</span></label></div>`;
  const logoTag = logoPlaces && (chosen || (showTags && provided.logo)) ? `<span class="pill">From your ${esc(logoPlaces)}</span>` : showTags && provided.logo ? tag : '';
  const logoBlock = kitBlock('logo', 'Logo', `${logoBody}${logoError ? `<p class="field-error" id="kit-logo-error" role="alert">${esc(logoError)}</p>` : ''}`, logoTag, 'kit-card kit-logo-block');

  const removeButton = (action, index, label) => `<button type="button" class="quiet kit-icon-button" data-kit-action="${action}" data-index="${index}" aria-label="${label}" ${dis}>${KIT_ICONS.remove}</button>`;
  // Each colour is a tile: the swatch itself (a colour input the whole block opens), its hex code and its role.
  const colorRows = palette.map((color, index) => {
    const n = index + 1;
    const error = fieldErrors?.[`color_${index}`];
    const errorId = `kit-color-${index}-error`;
    const hex = normalizeHex(color?.value);
    return `<div class="kit-row kit-color-row"><label class="kit-swatch-block${hex ? '' : ' is-invalid'}" style="--swatch:${esc(hex || '#000000')}"><input type="color" class="kit-swatch" name="kit_color_swatch_${index}" value="${esc(hex || '#000000')}" aria-label="Pick colour ${n}" ${dis}><span class="kit-swatch-edit" aria-hidden="true">${KIT_ICONS.pencil}</span></label><input type="text" class="kit-hex" name="kit_color_hex_${index}" maxlength="7" placeholder="#1A2B3C" value="${esc(color?.value || '')}" aria-label="Colour ${n} hex code" spellcheck="false" autocomplete="off" aria-invalid="${error ? 'true' : 'false'}" ${error ? `aria-describedby="${errorId}"` : ''} ${dis}><select name="kit_color_role_${index}" aria-label="Colour ${n} role" ${fieldErrors?.palette ? 'aria-describedby="kit-palette-error"' : ''} ${dis}>${KIT_COLOR_ROLES.map(role => `<option value="${role}" ${color?.role === role ? 'selected' : ''}>${humanize(role)}</option>`).join('')}</select>${removeButton('remove-color', index, `Remove colour ${n}`)}${error ? `<p class="field-error" id="${errorId}" role="alert">${esc(error)}</p>` : ''}</div>`;
  }).join('');
  const settled = phase === 'ready' && CAPTURE_SETTLED.has(projected.capture?.status) && !(projected.palette || []).length;
  const socialPlatform = KIT_SOCIAL_PLATFORMS[projected.paletteSource];
  // Colours read from the brand's logo or from frames of its videos say so ("From your logo"); they are suggestions the person edits like any other.
  const suggestedColours = !provided.palette ? suggestedColoursNote(projected.palette) : '';
  const paletteNote = socialPlatform && !provided.palette && palette.length ? `<p class="muted">From your ${socialPlatform} profile picture.</p>` : suggestedColours && palette.length ? `<p class="muted">${esc(suggestedColours)}</p>` : '';
  const emptyColours = settled ? 'No colours read. Add them here.' : 'No colours yet';
  const paletteFull = loading || palette.length >= KIT_LIMITS.maxColors;
  const addColor = `<button type="button" class="kit-add kit-add-swatch" data-kit-action="add-color" ${paletteFull ? 'disabled' : ''}>${KIT_ICONS.plus}<span>Add colour</span></button>`;
  const colorsBody = `${paletteNote}${colorRows ? '' : `<p class="muted">${emptyColours}</p>`}<div class="kit-swatches">${colorRows}${addColor}</div>${colorRows ? '' : ''}${fieldErrors?.palette ? `<p class="field-error" id="kit-palette-error" role="alert">${esc(fieldErrors.palette)}</p>` : ''}`;
  const readColours = showTags && !provided.palette && !socialPlatform && !Array.isArray(kit.palette) && palette.length && projected.paletteSource === 'website';
  const colorsBlock = kitBlock('colors', 'Colours', colorsBody, showTags && provided.palette ? tag : readColours ? readTag : '', 'kit-card kit-colors-block');

  const fontOptions = (projected.fonts || []).map(font => `<option value="${esc(font.family)}">`).join('');
  // Each font is a specimen: "Aa" and the name in the real font (a Google font, a font installed here, or the file the person uploaded).
  const fontRows = fonts.map((font, index) => {
    const n = index + 1;
    const error = fieldErrors?.[`font_${index}`];
    const errorId = `kit-font-${index}-error`;
    // Quotes, semicolons and braces are dropped so a typed name can only
    // ever be a font family inside the inline style, never more CSS.
    const family = String(font?.family || '').trim().replace(/['"\\;{}<>]/g, '');
    const key = fontKey(family);
    const uploaded = uploadedFonts.get(key) || null;
    const stack = `${uploaded ? `'${uploaded}', ` : ''}${family ? `'${family}', ` : ''}var(--sans)`;
    const missing = Boolean(family) && !uploaded && fontPreview.missing.has(key);
    const note = uploaded ? 'Uploaded font file' : missing ? 'Preview unavailable' : '';
    return `<div class="kit-row kit-font-row${missing ? ' is-fallback' : ''}" data-font-key="${esc(key)}"><span class="kit-font-sample" aria-hidden="true" style="font-family:${esc(stack)}">Aa</span><input type="text" class="kit-font-name" name="kit_font_family_${index}" maxlength="80" placeholder="Inter" list="kit-font-options" value="${esc(font?.family || '')}" aria-label="Font ${n} name" autocomplete="off" aria-invalid="${error ? 'true' : 'false'}" ${error ? `aria-describedby="${errorId}"` : ''} style="font-family:${esc(stack)}" ${dis}><select name="kit_font_use_${index}" aria-label="Font ${n} use" ${dis}>${KIT_FONT_USES.map(use => `<option value="${use}" ${font?.use === use ? 'selected' : ''}>${use === 'captions' ? 'Post text' : humanize(use)}</option>`).join('')}</select>${removeButton('remove-font', index, `Remove font ${n}`)}<span class="kit-font-note muted" data-font-note>${note}</span>${error ? `<p class="field-error" id="${errorId}" role="alert">${esc(error)}</p>` : ''}</div>`;
  }).join('');
  const fontsFull = loading || fonts.length >= KIT_LIMITS.maxFonts;
  const fontActions = `<div class="kit-actions"><button type="button" class="kit-add" data-kit-action="add-font" ${fontsFull ? 'disabled' : ''}>${KIT_ICONS.plus}<span>Add font</span></button><input type="file" id="kit-font-file" class="kit-file visually-hidden" name="kit_font_file" accept="${KIT_FONT_ACCEPT}" aria-label="Upload a font file" ${fontsFull ? 'disabled' : ''}><label class="kit-file-button kit-upload-font" for="kit-font-file">${KIT_ICONS.upload}<span>Upload a font file</span></label></div>`;
  const fontFeedback = `${kit.fontError ? `<p class="field-error" role="alert">${esc(kit.fontError)}</p>` : ''}${kit.fontStatus ? `<p class="muted kit-card-note" role="status">${esc(kit.fontStatus)}</p>` : ''}`;
  // Fonts guessed from the on-screen text of the brand's videos say "looks like": a close Google font, never a sure match.
  const looksLike = projected.fontsSource === 'looks_like' && !provided.fonts && fonts.length > 0;
  const looksLikeNote = looksLike ? '<p class="muted kit-card-note">Closest match. Please check.</p>' : '';
  const fontsBody = `<datalist id="kit-font-options">${fontOptions}</datalist>${looksLikeNote}${fontRows ? `<div class="kit-specimens">${fontRows}</div>` : '<p class="muted">No fonts yet</p>'}${fontFeedback}${fontActions}`;
  const readFonts = showTags && !provided.fonts && !Array.isArray(kit.fonts) && fonts.length && !looksLike;
  const fontsBlock = kitBlock('fonts', 'Fonts', fontsBody, showTags && provided.fonts ? tag : looksLike ? '<span class="pill">Suggested, please check</span>' : readFonts ? readTag : '', 'kit-card kit-fonts-block');

  const photos = Array.isArray(kit.references) ? kit.references : [];
  const savedPhotos = Number(brand?.referencePhotos) || 0;
  const photoThumbs = photos.map((photo, index) => {
    const src = kitImageSrc(photo?.previewDataUrl || null);
    return `<div class="kit-photo">${src ? `<img src="${esc(src)}" alt="Photo ${index + 1}">` : '<span class="muted">No preview</span>'}<button type="button" class="quiet kit-icon-button" data-kit-action="remove-ref" data-index="${index}" aria-label="Remove photo ${index + 1}" ${dis}>${KIT_ICONS.remove}</button></div>`;
  }).join('');
  const photoLeft = KIT_PHOTOS_MAX - savedPhotos - photos.length;
  const photoState = savedPhotos ? `<p class="muted">${savedPhotos} saved ${savedPhotos === 1 ? 'photo' : 'photos'}.</p>` : '';
  const photoAdd = photoLeft > 0
    ? `<input type="file" id="kit-ref-file" class="kit-file visually-hidden" name="kit_ref_file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Add photos" ${dis}><label class="kit-file-button" for="kit-ref-file">${KIT_ICONS.upload}<span>Add photos</span></label>`
    : '';
  const photosLater = brand && phase === 'new' && photos.length ? `<p class="muted kit-card-note">${esc(KIT_PHOTOS_LATER)}</p>` : '';
  const photosBody = `<p class="muted">${esc(KIT_PHOTOS_NOTE)}</p>${photosLater}${photoState}${photoThumbs ? `<div class="kit-photos">${photoThumbs}</div>` : ''}${kit.referencesError ? `<p class="field-error" role="alert">${esc(kit.referencesError)}</p>` : ''}${photoAdd}`;
  const photosBlock = kitBlock('photos', 'Photos of your world', photosBody, '', 'kit-card kit-photos-block');
  const foldersBlock = kitFolders(brand, kit.folders, loading);

  const note = loading
    ? 'Reading your brand kit...'
    : phase === 'new'
      ? 'Have a logo, colours or fonts? Add them here.'
      : 'Check these and fix anything wrong.';
  return `<fieldset class="kit-fieldset" ${dis} aria-labelledby="kit-heading"${loading ? ' aria-busy="true"' : ''}><div class="kit-head"><h3 id="kit-heading">Logo, colours and fonts</h3><p class="muted">${note}</p></div><div class="kit-grid">${logoBlock}${colorsBlock}${fontsBlock}${photosBlock}${foldersBlock}</div></fieldset>`;
}

// brandReady (section 3/8): readyForJobs when the projection reports it,
// else onboardingStatus === 'complete' for a legacy brand with no kit gate.
export function brandReady(brand) {
  if (typeof brand?.readyForJobs === 'boolean') return brand.readyForJobs;
  return brand?.onboardingStatus === 'complete';
}

// The brand's name is the first field on its page and an input like every other: no label with a Rename button. For a brand that exists, a
// changed name is sent with the next Save (it changes the display name only; the brand's folder keeps its original name). `state.rename` is
// { busy, error } for that request and `state.renamedNote` the line shown once it was applied.
export function brandNameBlock(brand, state = {}, { value = '', readOnly = false } = {}) {
  const rename = state.rename && typeof state.rename === 'object' ? state.rename : {};
  const error = state.fieldErrors?.name || rename.error || '';
  const note = !error && (rename.busy || state.renamedNote) ? `<p class="muted brand-name-note" role="status">${esc(rename.busy ? 'Saving the new name...' : state.renamedNote)}</p>` : '';
  return `<label class="field-wide brand-name">Brand name<input name="name"${brand ? ' data-brand-name' : ''} value="${esc(value)}" maxlength="${BRAND_NAME_LIMIT}" placeholder="e.g. Acme Goods" autocomplete="organization" required ${readOnly ? 'readonly' : ''} aria-invalid="${error ? 'true' : 'false'}" ${error ? 'aria-describedby="field-name-error"' : ''}>${error ? `<p class="field-error" id="field-name-error" role="alert">${esc(error)}</p>` : ''}${note}</label>`;
}

// The thin segmented bar at the top of the brand page: the current step is named above it ("Details", "2 of 3"), a finished step is green, the
// step waiting on the person gold, the one running blue and one that stopped red. Three steps: the name, the details, the research.
export const ONBOARD_STEPS = Object.freeze(['Name', 'Details', 'Research']);
export function onboardProgress(step, phase) {
  const at = step === 'create' ? 1 : step === 'details' ? 2 : 3;
  const running = step === 'profile' && phase === 'running';
  const failed = step === 'profile' && phase === 'failed';
  const done = step === 'profile' && !running && !failed;
  const label = running ? 'Researching' : failed ? 'Research stopped' : done ? 'Research done' : ONBOARD_STEPS[at - 1];
  const kind = index => (done || index < at - 1 ? 'd' : index !== at - 1 ? '' : running ? 'r' : failed ? 'f' : 'w');
  return `<div class="prog" role="group" aria-label="Setup progress"><div class="prog-top"><b>${esc(label)}</b><span>${at} of ${ONBOARD_STEPS.length}</span></div><div class="prog-bar" aria-hidden="true">${ONBOARD_STEPS.map((name, index) => `<i${kind(index) ? ` class="${kind(index)}"` : ''} title="${esc(name)}"></i>`).join('')}</div></div>`;
}

// The brand page, in three steps. Before the brand exists the card asks only for its name ("Create brand"). Once it exists the same card is
// the brand's own page: the name (an input, first), the links, the details, the logo, colours and fonts, the folders and the photos, with
// "Save details" (any number of times, nothing starts) and "Start research" (on once there is a website or one social account). A brand
// that already did research has one finish action, "Save and continue". `state` is the inline draft this form renders for; passing it explicitly,
// instead of reading a module-level variable, keeps this function usable from outside the browser runtime closure. `state.action` says which
// button the request in flight came from: 'create', 'details', 'start' or 'finish'.
export function inlineOnboardingForm(brand, state = {}, signal = {}, metricool = {}) {
  const existing = Boolean(brand);
  const prefilled = state.prefilled || contextPrefill(existing ? profileFormValues(brand) : {});
  const values = { ...(existing ? profileFormValues(brand) : {}), ...(state.values || {}) };
  if (existing && !values.name) values.name = brand.name;
  const fieldErrors = state.fieldErrors || null;
  const phase = brandResearchPhase(brand, state);
  const pending = state.submitted || state.needsReconciliation;
  const step = !existing ? 'create' : phase === 'new' ? 'details' : 'profile';
  const minimum = researchMinimum({ ...values, name: values.name || brand?.name });
  const note = state.declined
    ? `<div class="notice" role="status"><span>${esc(state.message || NOTE_DECLINED)}</span></div>`
    : pending
      ? notifyClaudeNotice(state, signal)
      : phase === 'running'
        ? '<div class="notice" role="status"><span>The Director is researching this brand.</span></div>'
        : phase === 'failed'
          ? '<div class="notice" role="status"><span>Research did not finish. Fill in what you know and save.</span></div>'
          : step === 'create'
            ? '<p class="muted">Start with the name. Details come next.</p>'
            : step === 'details'
              ? '<p class="muted">Add what you know, then save or start research.</p>'
              : '';
  const heading = existing ? `Set up ${esc(brand.name)}` : 'Set up a new brand';
  // The brand was just created and the board has not read it back yet: the form waits instead of offering to create it again.
  const reading = !existing && Boolean(state.brand);
  const inFlight = Boolean(state.busy || pending || reading);
  const nameBlock = brandNameBlock(existing ? brand : null, state, { value: values.name || '', readOnly: inFlight || (existing && phase === 'running') });
  const head = `<div class="start-head"><h2>${heading}</h2>${onboardProgress(step, phase)}</div>`;
  const problem = state.error ? `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>` : '';
  const hidden = `<input type="hidden" name="brand" value="${esc(brand?.slug || '')}">`;
  const open = `<section class="start-card onboarding${step === 'create' ? ' is-create' : ''}">${head}${note}<form id="inline-form" class="start-form" data-onboard-step="${step}" novalidate>${hidden}<div class="form-grid">${nameBlock}</div>`;
  if (step === 'create') {
    const label = state.busy || reading ? 'Creating...' : state.submitted ? TXT_WAITING_FOR_CLAUDE : state.needsReconciliation ? TXT_NEEDS_CLAUDE_ATTENTION : 'Create brand';
    return `${open}${problem}<div class="start-foot"><button class="primary" type="submit" ${inFlight ? 'disabled' : ''}>${label}</button></div></form></section>`;
  }
  const details = step === 'details';
  const kit = kitSection(brand, state.kit || {}, state.kitErrors || null, false);
  // Every field is editable; a value research filled in carries the "Suggested, please check" pill until it is changed.
  // The details in the mockup's order, each part under a thin line: the links and the market, the brand identity, the look (the kit: logo,
  // colours, fonts, photos, folders) and where posts go out. Nothing here is a new field; only the grouping is new.
  const links = `<div class="ob-sec ob-links"><div class="channel-grid">${CHANNEL_NAMES.map(name => channelField(name, values, fieldErrors)).join('')}</div><div class="channel-grid context-grid">${targetMarketField(values, fieldErrors)}</div></div>`;
  const identity = `<div class="ob-sec ob-identity"><h3>Brand identity</h3><div class="channel-grid context-grid">${CONTEXT_FIELDS.map(field => contextField(field, values, prefilled, {}, fieldErrors, researchSuggested(brand, field.name, values, prefilled))).join('')}</div></div>`;
  const fields = `${links}${identity}${kit}${metricoolOnboardField(brand, values, metricool)}${problem}`;
  if (details) {
    const doing = state.action;
    const saveLabel = state.busy && doing === 'details' ? 'Saving...' : state.submitted && doing === 'details' ? TXT_WAITING_FOR_CLAUDE : state.needsReconciliation && doing === 'details' ? TXT_NEEDS_CLAUDE_ATTENTION : 'Save details';
    const startLabel = state.busy && doing === 'start' ? 'Starting...' : state.submitted && doing === 'start' ? TXT_WAITING_FOR_CLAUDE : state.needsReconciliation && doing === 'start' ? TXT_NEEDS_CLAUDE_ATTENTION : 'Start research';
    const hint = minimum.ok ? RESEARCH_READY_HINT : minimum.message;
    return `${open}${fields}<div class="start-foot"><p class="muted start-foot-hint" id="start-research-hint" data-start-hint>${esc(hint)}</p><span class="start-foot-actions"><button type="submit" ${inFlight ? 'disabled' : ''}>${saveLabel}</button><button class="primary" type="button" data-action="start-research" aria-describedby="start-research-hint" ${inFlight || !minimum.ok ? 'disabled' : ''}>${startLabel}</button></span></div></form></section>`;
  }
  const buttonLabel = state.busy ? 'Saving...'
    : state.submitted ? TXT_WAITING_FOR_CLAUDE
    : state.needsReconciliation ? TXT_NEEDS_CLAUDE_ATTENTION
    : phase === 'running' ? 'Researching...'
    : TXT_SAVE_AND_CONTINUE;
  return `${open}${fields}<div class="start-foot"><button class="primary" type="submit" ${inFlight || phase === 'running' ? 'disabled' : ''}>${buttonLabel}</button></div></form></section>`;
}

// Which Metricool brand posts as this brand, asked once on the onboarding form when Metricool is connected and its brands are
// saved. Leaving it on "Choose later" blocks nothing: the Inbox asks when the brand is ready. The same select changes it later,
// when the brand is updated. `metricool` is { connected, brands } as the board projection carries them.
export function metricoolOnboardField(brand, values = {}, metricool = {}) {
  const brands = Array.isArray(metricool.brands) ? metricool.brands : [];
  if (!metricool.connected || !brands.length) return '';
  const saved = brand?.publishing?.optedOut ? NO_METRICOOL : brand?.publishing && brand.publishing.found !== false && typeof brand.publishing.blogId === 'string' ? brand.publishing.blogId : '';
  const chosen = typeof values.metricoolBlogId === 'string' ? values.metricoolBlogId : saved;
  const options = [`<option value="" ${chosen ? '' : 'selected'}>Choose later</option>`, ...brands.map(item => `<option value="${esc(item.id)}" ${item.id === chosen ? 'selected' : ''}>${esc(item.option || item.label)}</option>`), `<option value="${NO_METRICOOL}" ${chosen === NO_METRICOOL ? 'selected' : ''}>Not through Metricool</option>`].join('');
  return `<div class="ob-sec ob-posting"><h3>Posting</h3><div class="channel-grid context-grid metricool-onboard"><label class="field-wide">Metricool brand for this brand's posts<select name="metricoolBlogId" data-saved="${esc(saved)}">${options}</select></label></div></div>`;
}

const COMPOSER_TITLE_LIMIT = 80;
const COMPOSER_TEXT_LIMIT = 6000;
const COMPOSER_QUESTION = 'What do you want to get done?';
const COMPOSER_PLACEHOLDER = 'For example: an Instagram Reel for our new serum';
const COMPOSER_HINT = 'You can ask for posts, research, an analysis or a video breakdown.';
const COMPOSER_BRAND_HINT = 'Posts need one.';
const COMPOSER_FILES_LINE = 'Add files under References.';

// A job's title is the first line of what the person wrote, cut at a word when it is long.
export function composerTitle(text) {
  const line = (String(text ?? '').split(/\r?\n/).map(part => part.replace(/\s+/g, ' ').trim()).find(Boolean) || '').replace(/[\s.,;:-]+$/, '');
  if (line.length <= COMPOSER_TITLE_LIMIT) return line;
  const cut = line.slice(0, COMPOSER_TITLE_LIMIT - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space >= COMPOSER_TITLE_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

// What the composer sends: the person's own words, the brand when one was chosen and the links. Never a kind:
// Claude reads the words against the pipeline catalogue and picks the pipeline. A brand is never required here,
// because only Claude can tell whether the words are about making or posting content; it asks when it needs one.
export function newJobArgs(values = {}, { brands = [], requestId } = {}) {
  const errors = {};
  const text = String(values.text ?? '').trim();
  if (!text) errors.text = 'Say what you want done.';
  const slug = String(values.brand ?? '').trim();
  const brand = slug && slug !== NO_BRAND ? brands.filter(brandReady).find(item => item.slug === slug) || null : null;
  if (slug && slug !== NO_BRAND && !brand) errors.brand = 'Choose one of your brands.';
  const parsed = parseLinks(values.links);
  if (parsed.error) errors.links = parsed.error;
  if (Object.keys(errors).length) return { errors };
  const args = { requestId, ...(brand ? { brand: brand.slug, brandName: brand.name } : {}), title: composerTitle(text) || text.slice(0, COMPOSER_TITLE_LIMIT), brief: text };
  if (parsed.links.length) args.sourceRefs = parsed.links;
  return { args };
}

function newJobField(id, label, control, { error = '', hint = '', wide = false, hidden = false } = {}) {
  return `<div class="new-field${wide ? ' field-wide' : ''}"><label for="${id}"${hidden ? ' class="visually-hidden"' : ''}>${esc(label)}</label>${control}${hint ? `<p class="field-hint" id="${id}-hint">${esc(hint)}</p>` : ''}${error ? `<p class="field-error" id="${id}-error" role="alert">${esc(error)}</p>` : ''}</div>`;
}

function newJobAria(id, { error = '', hint = '' } = {}) {
  const described = [error ? `${id}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ');
  return `aria-invalid="${error ? 'true' : 'false'}"${described ? ` aria-describedby="${described}"` : ''}`;
}

// The one place a job starts: one box for what the person wants, an optional brand and links, and Send. The same
// form is the card on the home page (variant card) and the starter in the Inbox (variant inbox); only one of them is on
// the page at a time, so each keeps its own ids.
export function composerForm(state = {}, { brands = [], variant = 'card' } = {}) {
  const values = state.values || {};
  const errors = state.fieldErrors || {};
  const inbox = variant === 'inbox';
  const id = inbox ? 'starter' : 'new';
  const ready = brands.filter(brandReady);
  // With exactly one ready brand it is chosen for the person, until they say otherwise (an empty choice is theirs).
  const brandValue = ready.some(brand => brand.slug === values.brand) ? values.brand : values.brand === undefined && ready.length === 1 ? ready[0].slug : '';
  const text = newJobField(`${id}-text`, COMPOSER_QUESTION, `<textarea id="${id}-text" name="text" rows="${inbox ? 4 : 5}" maxlength="${COMPOSER_TEXT_LIMIT}" placeholder="${esc(COMPOSER_PLACEHOLDER)}" ${newJobAria(`${id}-text`, { error: errors.text, hint: COMPOSER_HINT })}>${esc(values.text || '')}</textarea>`, { error: errors.text, hint: COMPOSER_HINT, wide: true, hidden: true });
  const brand = ready.length
    ? newJobField(`${id}-brand`, 'Brand', `<select id="${id}-brand" name="brand" ${newJobAria(`${id}-brand`, { error: errors.brand, hint: COMPOSER_BRAND_HINT })}><option value="" ${brandValue ? '' : 'selected'}>No brand chosen</option>${ready.map(item => `<option value="${esc(item.slug)}" ${brandValue === item.slug ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`, { error: errors.brand, hint: COMPOSER_BRAND_HINT })
    : '<div class="new-field"><span class="new-field-label">Brand</span><p class="field-note">Needs a brand. <button type="button" class="sb-ask" data-action="brand">Onboard a brand</button></p></div>';
  const links = newJobField(`${id}-links`, 'Links (optional)', `<textarea id="${id}-links" class="links-input" name="links" rows="2" maxlength="${LINK_LIMIT * 2100}" placeholder="One link per line" spellcheck="false" ${newJobAria(`${id}-links`, { error: errors.links })}>${esc(values.links || '')}</textarea>`, { error: errors.links });
  const blocked = state.busy || state.submitted || state.needsReconciliation;
  const label = state.busy ? 'Sending...' : state.submitted ? TXT_WAITING_FOR_CLAUDE : state.needsReconciliation ? TXT_NEEDS_CLAUDE_ATTENTION : 'Send';
  const problem = state.error ? `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>` : '';
  const foot = `<div class="start-foot"><small class="composer-files">${esc(COMPOSER_FILES_LINE)}</small><button class="primary" type="submit" ${blocked ? 'disabled' : ''}>${label}</button></div>`;
  const form = `<form id="${inbox ? 'starter-form' : 'inline-form'}" class="start-form composer-form" novalidate>${text}<div class="composer-grid">${brand}${links}</div>${newJobReferences(state.refs, { busy: state.busy || state.submitted })}${problem}${foot}</form>`;
  if (inbox) return `<section class="composer composer-inbox" aria-labelledby="starter-title"><h3 class="composer-title" id="starter-title">${COMPOSER_QUESTION}</h3>${form}</section>`;
  const notice = state.declined ? `<div class="notice" role="status"><span>${esc(state.message || NOTE_DECLINED)}</span></div>` : '';
  return `<section class="start-card new-job composer"><div class="start-head"><h2 id="composer-title">${COMPOSER_QUESTION}</h2></div>${notice}${form}</section>`;
}

// @module brands
// The one line under a job's title that says which pipeline Claude chose and why, with a quiet way to say it is wrong.
// It shows only for a job Claude planned from the person's words: the pipeline's name comes from the catalogue and the
// reason is the line Claude saved with it. Once the person has said it is wrong, the button is replaced by a plain note.
export const FINAL_JOB_STATES = Object.freeze(['COMPLETE', 'CANCELLED']);
export function plannedAsLine(project, { sent = false } = {}) {
  const name = kindNameOf(project?.kind);
  const reason = trimmed(project?.kindReason);
  if (!name || !reason) return '';
  const action = FINAL_JOB_STATES.includes(project?.state) ? ''
    : sent
      ? '<span class="planned-sent" role="status">Claude has been told.</span>'
      : '<button type="button" class="quiet planned-tell" data-action="not-right">Not right? Tell Claude</button>';
  return `<div class="planned-as"><span class="planned-text">Claude planned this as <strong>${esc(name)}</strong><details class="cs-more line-more"><summary>View details</summary><span class="line-more-full">${esc(reason)}</span></details></span>${action}</div>`;
}

// The plain sentence the button sends to Claude. It names the job and asks Claude to ask the person what they meant.
export function notRightMessage(project) {
  const title = String(project?.title || '').trim().slice(0, 100);
  const id = String(project?.jobId || '').trim();
  const which = [title ? `for "${title}"` : '', id ? `(${id})` : ''].filter(Boolean).join(' ');
  return `This is not the kind of job I meant${which ? ` ${which}` : ''}. Please ask me what I want.`;
}

// A brand's onboarding research phase, from its research usage.status
// ('running'|'complete'|'failed'|'abandoned'|null, one row summed across every
// onboarding run) plus onboardingStatus: 'new' for a brand-new draft or an
// existing brand with no research run yet, 'running' while a pass is in
// flight, 'complete' once a run finished, and 'failed' for a run that ended
// without finishing (failed or went stale/abandoned). A brand already
// onboardingStatus complete with no research usage at all has nothing left
// to research (every field was filled in by hand, so the one research pass
// is skipped and no run ever exists) and is treated as 'complete' too, since
// asking to "Start onboarding" again would be wrong.
export function pendingLapsed(usage, now = Date.now()) {
  const until = Date.parse(usage?.pendingUntil || '');
  return usage?.pending === 'expired' || (usage?.pending === 'waiting' && Number.isFinite(until) && now >= until);
}

export function nextPendingExpiry(brands = [], now = Date.now()) {
  const times = (Array.isArray(brands) ? brands : [])
    .filter(brand => brand?.usage?.pending === 'waiting' && brand.usage.status !== 'running')
    .map(brand => Date.parse(brand.usage.pendingUntil || ''))
    .filter(until => Number.isFinite(until) && until > now);
  return times.length ? Math.min(...times) : null;
}

export function brandResearchPhase(brand, draft = null, now = Date.now()) {
  const requested = Boolean(draft?.researchRequested);
  if (!brand) return requested ? 'running' : 'new';
  const status = brand.usage?.status ?? null;
  const pending = brand.usage?.pending ?? null;
  if (status === 'running') return 'running';
  if (pending && pendingLapsed(brand.usage, now)) return 'failed';
  if (pending === 'waiting') return 'running';
  if (status === 'complete') return 'complete';
  if (status === 'failed' || status === 'abandoned') return 'failed';
  if (brand.onboardingStatus === 'complete') return 'complete';
  return requested ? 'running' : 'new';
}

// The brand profile can drift after a job's plan was built from it. A notice
// naming both revisions when that happened; silent (and rendered as nothing)
// otherwise, including when project.brandProfile itself is missing.
export function brandDriftNotice(project) {
  const brandProfile = project?.brandProfile;
  if (!brandProfile?.changedSincePlanning) return '';
  return `<div class="notice" role="status"><span>The brand profile changed. Ask Claude to check the plan.</span></div>`;
}

export function brandPillarsPill(brand) {
  const count = Array.isArray(brand?.profile?.contentPillars) ? brand.profile.contentPillars.filter(item => String(item || '').trim()).length : 0;
  if (!count) return '';
  return brand.pillarsConfirmed ? '<span class="pill ready">Topics confirmed</span>' : '<span class="pill needed">Topics not confirmed</span>';
}

export function brandVoiceLine(brand) {
  const voice = brand?.voice;
  if (!voice || voice.complete) return '';
  const reasons = Array.isArray(voice.reasons) ? voice.reasons.filter(item => typeof item === 'string' && item.trim()) : [];
  return reasons.length ? `<p class="muted brand-chip-voice">${esc(reasons.join(' '))}</p>` : '';
}

// Which ad account each connected ad platform reads for this brand. A small line, shown only once an account is saved.
export function brandAdAccountsLine(brand) {
  const saved = brand?.adAccounts;
  if (!saved || typeof saved !== 'object') return '';
  const parts = [];
  for (const [provider, label] of [['meta_ads', 'Meta ad account'], ['tiktok_ads', 'TikTok ad account']]) {
    const item = saved[provider];
    if (!item) continue;
    if (item.unreadable) { parts.push(`${label} could not be read`); continue; }
    if (item.none) { parts.push(`No ${label} yet`); continue; }
    if (item.later) { parts.push(`${label} to be decided`); continue; }
    parts.push(`${label} <strong>${esc(item.name)}</strong>${item.found === false ? ' (no longer listed)' : ''}`);
  }
  return parts.length ? `<div class="brand-chip-publish"><p class="muted">Ad results: ${parts.join(' &middot; ')}</p></div>` : '';
}

export function brandChip(brand, metricool = {}) {
  const ready = brandReady(brand);
  const researching = brandResearchPhase(brand) === 'running';
  const state = ready ? 'ready' : 'onboarding';
  const note = researching ? '<p class="muted brand-chip-voice">The Director is researching this brand.</p>' : brandVoiceLine(brand);
  const action = researching
    ? '<button class="quiet" type="button" disabled>Researching...</button>'
    : `<button class="quiet" data-onboard="${esc(brand.slug)}">${ready ? 'Update' : 'Continue'}</button>`;
  const pillars = researching ? '' : brandPillarsPill(brand);
  return `<div class="brand-chip"><span class="avatar">${esc((brand.name || 'BR').slice(0,2).toUpperCase())}</span><span class="brand-chip-body"><span class="brand-chip-name"><strong>${esc(brand.name)}</strong><small>${esc(ready ? 'Ready for jobs' : 'Onboarding in progress')}</small>${note}${brandStudioWorkspaceLine(brand)}${brandMetricoolLine(brand, metricool)}${brandAdAccountsLine(brand)}</span><span class="brand-chip-state"><span class="pill ${state}">${esc(humanize(state))}</span>${pillars}</span>${action}</span></div>`;
}

// The Brand library: what this brand keeps for every next job, from `brand.library` ({counts, yours, proven, banks, recentJobs}, which the
// server adds when the brand has a library): the banks, one folded group per kind (pain points, desires, objections, angles, opening lines,
// captions, calls to action, formats, ad styles) with its count and its top items, the person's own items among them each with a Remove that
// asks Claude to take it out; a library without `banks` (an older server) draws the person's items and the proven items as two lists. The
// jobs filed most recently follow. Nothing is drawn for a brand with no library.
const LIBRARY_KIND_WORDS = Object.freeze({ hook: 'Opening line', angle: 'Angle', style: 'Ad style', cta: "Call to action", caption: 'Post text', format: 'Format', industry: 'Industry', funnel: 'Funnel stage', pain: 'Pain point', desire: 'Desire', objection: 'Objection' });
const LIBRARY_BANK_TITLES = Object.freeze({ pain: 'Pain points', desire: 'Desires', objection: 'Objections', angle: 'Angles', hook: 'Opening lines', caption: 'Post texts', cta: 'Calls to action', format: 'Formats', style: 'Ad styles', funnel: 'Funnel stages', industry: 'Industry' });
// Where a banked item came from, in the words of the person: what the audience said, a competitor's, an ad, or the plugin's own starter line.
const LIBRARY_SOURCE_WORDS = Object.freeze({ competitor: 'From a competitor', community: 'From forums and comments', review: 'From reviews', ad: 'From an ad', starter: 'Starter line' });
const LIBRARY_STAGE_WORDS = Object.freeze({ unaware: 'Unaware', problem_aware: 'Problem aware', solution_aware: 'Solution aware', product_aware: 'Product aware', most_aware: 'Most aware' });
const LIBRARY_GROUP_LIMIT = 50;
export const libraryKey = (slug, id) => `${slug}:${id}`;
const libraryDay = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '');
const libraryItems = list => (Array.isArray(list) ? list : []).filter(item => item && typeof item === 'object' && !item.removed && trimmed(item.text));
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
function libraryCounts(library) {
  const given = library.counts && typeof library.counts === 'object' ? library.counts : {};
  const count = (key, fallback) => (Number.isFinite(given[key]) && given[key] >= 0 ? Math.floor(given[key]) : fallback);
  return { yours: count('yours', libraryItems(library.yours).length), proven: count('proven', libraryItems(library.proven).length), jobs: count('jobs', Array.isArray(library.recentJobs) ? library.recentJobs.length : 0), research: count('research', null), trends: count('trends', libraryItems(library.trends).length) };
}
export function libraryCountsLine(library) {
  const counts = libraryCounts(library || {});
  const footage = libraryFootage(library || {});
  return [`${counts.yours} yours`, `${counts.proven} proven`, plural(counts.jobs, 'job') + ' filed', counts.research === null ? '' : plural(counts.research, 'research file'), counts.trends ? plural(counts.trends, 'fresh trend') : '', footage ? plural(footage.files, 'footage file') : ''].filter(Boolean).join(' · ');
}
// The Footage line of the Brand library: the brand's archive of past videos, pictures and audio, from `library.footage` ({folders, files,
// analysedQuick, analysedFull, missing, list: [{id, name, rights, files, missing, state, processed?, total?}]}, which the server adds when
// the brand has imported footage). The counts, then each folder with whose footage it is. Nothing is drawn for a brand with none.
const FOOTAGE_RIGHTS_WORDS = Object.freeze({ ours: 'Ours', client_ask: "Client work, ask first", never: 'Reference only' });
const FOOTAGE_STATE_WORDS = Object.freeze({ indexing: "Reading the files", stopped: 'Stopped part-way', moved: "Folder not found" });
const footageCount = value => (Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
function libraryFootage(library) {
  const footage = library && typeof library === 'object' ? library.footage : null;
  if (!footage || typeof footage !== 'object' || Array.isArray(footage)) return null;
  const files = footageCount(footage.files);
  const folders = footageCount(footage.folders);
  if (!files && !folders) return null;
  return {
    folders, files, described: footageCount(footage.analysedQuick) + footageCount(footage.analysedFull), full: footageCount(footage.analysedFull), missing: footageCount(footage.missing),
    list: (Array.isArray(footage.list) ? footage.list : []).filter(item => item && typeof item === 'object'),
  };
}
export function footageCountsLine(footage) {
  const info = footage && footage.described !== undefined ? footage : libraryFootage({ footage });
  if (!info) return '';
  return [plural(info.files, 'file'), `${info.described} described`, info.full ? `${info.full} in full` : '', info.missing ? `${info.missing} missing` : ''].filter(Boolean).join(' · ');
}
function libraryFootageGroup(brand, footage) {
  const rows = footage.list.slice(0, LIBRARY_GROUP_LIMIT).map(folder => {
    const progress = folder.state === 'indexing' && footageCount(folder.total) > 0 ? `${footageCount(folder.processed)} of ${footageCount(folder.total)}` : '';
    const meta = [FOOTAGE_RIGHTS_WORDS[folder.rights] || '', plural(footageCount(folder.files), 'file'), footageCount(folder.missing) ? `${footageCount(folder.missing)} missing` : '', FOOTAGE_STATE_WORDS[folder.state] || '', progress].filter(Boolean).map(esc).join(' &middot; ');
    return `<li class="library-item"><div class="library-main"><span class="library-text">${esc(trimmed(folder.name) || 'Folder')}</span><span class="library-meta">${meta}</span></div></li>`;
  }).join('');
  const lost = footage.missing > 0 || footage.list.some(folder => folder.state === 'moved');
  const note = lost ? '<p class="muted library-more">Footage moved. Tell Claude the new folder.</p>' : '';
  return `<section class="library-group" aria-labelledby="library-${esc(brand.slug)}-footage"><h3 id="library-${esc(brand.slug)}-footage">Footage <span class="count">${footage.files}</span></h3><p class="muted library-intro library-footage-counts">${esc(footageCountsLine(footage))}</p><ul class="library-list">${rows}</ul>${note}</section>`;
}
// Posted results on a bank item (`score`, `uses`, `label`, `views` from the server's ranking) and on a filed job (`results`): a pill that
// says winner, weak or early, and the number it rests on. An average item shows the number without a pill. The score is "x your usual":
// 1.0x is how this brand's posts usually do on that platform. An item with no results shows nothing.
const RESULT_PILLS = Object.freeze({
  winner: { word: 'Winner', hint: 'Among your best posts' },
  weak: { word: 'Weak', hint: 'Among your weakest posts' },
  early: { word: 'Early', hint: 'Too early to call' },
});
const resultNumber = value => (Number.isFinite(value) ? `${value.toFixed(1)}x` : '');
const resultViews = value => (Number.isFinite(value) && value >= 0 ? `${Math.round(value).toLocaleString('en-US')} views` : '');
const resultPill = label => (Object.prototype.hasOwnProperty.call(RESULT_PILLS, label) ? `<span class="pill library-pill result-${label}" title="${esc(RESULT_PILLS[label].hint)}">${RESULT_PILLS[label].word}</span>` : '');
function libraryResult(item) {
  const uses = Number.isFinite(item.uses) && item.uses > 0 ? Math.floor(item.uses) : 0;
  if (!uses) return '';
  const early = item.label === 'early' || !Number.isFinite(item.score);
  const score = Number.isFinite(item.score) ? `${resultNumber(item.score)} your usual${early ? ' so far' : ''}` : '';
  const numbers = [score, plural(uses, 'post'), resultViews(item.views)].filter(Boolean).map(esc).join(' &middot; ');
  return `<span class="library-result">${resultPill(item.label)}<span class="library-result-numbers">${numbers}</span></span>`;
}
function libraryJobResults(results) {
  if (!results || typeof results !== 'object' || Array.isArray(results)) return '';
  const early = results.label === 'early' || results.early === true || !Number.isFinite(results.score);
  const views = resultViews(results.views);
  const score = Number.isFinite(results.score) ? `${resultNumber(results.score)} your usual${early ? ' so far' : ''}` : '';
  const numbers = [views, score, Number.isFinite(results.posts) ? plural(Math.floor(results.posts), 'post') : ''].filter(Boolean);
  if (!numbers.length) return '';
  return `<span class="library-hook library-job-results">Results: ${numbers.map(esc).join(' &middot; ')}${resultPill(results.label) ? ` ${resultPill(results.label)}` : ''}</span>`;
}
// A social post behind a Brand library line (a proven top post of the brand or of a competitor, a fresh trend, a bank item that came from a post):
// a thumbnail when the record has a safe picture (else a neutral tile with the platform name and a play mark), Open post (a real https link in a new
// tab) and Copy link. `copy` is the page's { copied, fallback, hint }: the key whose button says Copied, and the key whose link is shown in a box to
// copy by hand because the clipboard was refused.
const POST_PLATFORMS = Object.freeze([[/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)(facebook\.com|fb\.watch)$/, 'Facebook'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)(x\.com|twitter\.com)$/, 'X'], [/(^|\.)threads\.net$/, 'Threads'], [/(^|\.)linkedin\.com$/, 'LinkedIn']]);
export function postPlatformOf(href) {
  try {
    const host = new URL(href).hostname.toLowerCase();
    return POST_PLATFORMS.find(([pattern]) => pattern.test(host))?.[1] || '';
  } catch { return ''; }
}
// Pictures that would not load (a scraped address that expired or refuses other sites): drawn as the neutral tile from then on.
export const failedPostThumbs = new Set();
// `post` is the record the picture belongs to (a bank item's or a trend's evidence: its `thumb` key or its own safe `thumbnail`), `thumbs` the brand's pictures (postThumbSrc).
function libraryPost({ href, post, thumbs, platform, key, title, ad = false, copy = {} }) {
  const src = postThumbSrc(post, thumbs);
  const picture = src && !failedPostThumbs.has(src) ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-post-thumb>` : '';
  const word = ad ? 'ad' : 'post';
  const shown = copy.copied === key;
  const id = String(key).replace(/[^A-Za-z0-9_-]/g, '-');
  const thumb = `<span class="post-thumb">${picture}<span class="post-thumb-play" aria-hidden="true"></span>${platform ? `<span class="post-thumb-plat">${esc(platform)}</span>` : ''}</span>`;
  const open = `<a class="library-open" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`Open ${word} in a new tab: ${title}`)}">Open ${word} \u2197</a>`;
  const button = `<button type="button" class="quiet library-copy${shown ? ' is-copied' : ''}" data-post-copy="${esc(key)}" data-post-url="${esc(href)}" aria-label="${esc(`${shown ? 'Link copied' : 'Copy link'}: ${title}`)}">${shown ? 'Copied' : 'Copy link'}</button>`;
  const links = `<span class="library-actions">${open}${button}</span>${shown ? '<span class="visually-hidden" role="status">Link copied</span>' : ''}`;
  const box = copy.fallback === key
    ? `<div class="kit-fallback library-fallback"><p class="kit-fallback-status" role="status">${esc(KIT_COPY_REFUSED.replace('the text', 'the link'))}</p><label class="visually-hidden" for="post-copy-${esc(id)}">Link to this ${word}</label><input id="post-copy-${esc(id)}" type="text" readonly value="${esc(href)}" data-post-fallback="${esc(key)}" aria-describedby="post-copy-hint-${esc(id)}"><div class="kit-fallback-foot"><span class="muted" id="post-copy-hint-${esc(id)}">${esc(copy.hint || 'Press Ctrl+C to copy')}</span><button type="button" class="quiet" data-post-copy-done="${esc(key)}">Done</button></div></div>`
    : '';
  return { thumb, links, box };
}
function libraryItem(item, brand, { removing, errors, copy = {} }) {
  const key = libraryKey(brand.slug, item.id);
  const kind = LIBRARY_KIND_WORDS[item.kind] || humanize(item.kind || 'item');
  const evidence = item.evidence && typeof item.evidence === 'object' ? item.evidence : null;
  const link = evidence ? safeHttpsLink(evidence.url) : null;
  const views = Number.isFinite(evidence?.views) ? `${Math.round(evidence.views).toLocaleString('en-US')} views` : Number.isFinite(evidence?.likes) ? `${Math.round(evidence.likes).toLocaleString('en-US')} likes` : '';
  const named = (item.source === 'review' || item.source === 'ad') && trimmed(item.competitor) ? ` of ${trimmed(item.competitor)}` : '';
  const where = LIBRARY_SOURCE_WORDS[item.source] ? `${LIBRARY_SOURCE_WORDS[item.source]}${named}` : '';
  const mentions = Number.isFinite(item.count) && item.count > 0 ? plural(Math.floor(item.count), 'mention') : '';
  const meta = [item.concept ? `Concept ${item.concept}` : '', item.edited ? 'edited' : '', where, mentions, trimmed(item.who), LIBRARY_STAGE_WORDS[item.awarenessStage] || '', trimmed(item.ctaType), views, libraryDay(evidence?.date) || libraryDay(item.at)].filter(Boolean).map(esc).join(' &middot; ');
  // The words of a customer behind a pain, desire or objection (the first quote, with the page it came from), and what an angle rests on.
  const quote = Array.isArray(item.quotes) ? item.quotes.find(entry => entry && typeof entry === 'object' && trimmed(entry.text)) : null;
  const quoteLink = quote ? safeHttpsLink(quote.url) : null;
  const moreQuotes = Number.isFinite(item.quoteCount) && item.quoteCount > 1 ? ` (+${item.quoteCount - 1} more)` : '';
  const said = quote ? `<span class="library-hook library-quote">&ldquo;${esc(quote.text)}&rdquo;${quoteLink ? ` <a class="post-link library-proof" href="${esc(quoteLink)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`See where this was said: ${quote.text}`)}">See where</a>` : ''}${esc(moreQuotes)}</span>` : '';
  const matched = item.kind === 'angle' && (trimmed(item.pain) || trimmed(item.proof)) ? `<span class="library-hook">${[trimmed(item.pain) ? `Answers: ${esc(item.pain)}` : '', trimmed(item.proof) ? `Proof: ${esc(item.proof)}` : ''].filter(Boolean).join(' &middot; ')}</span>` : '';
  const platform = link ? postPlatformOf(link) : '';
  const postBits = link && !evidence?.file && (platform || postThumbSrc(evidence, brand.thumbs)) ? libraryPost({ href: link, post: evidence, thumbs: brand.thumbs, platform, key: `post:${key}`, title: item.text, ad: item.source === 'ad', copy }) : null;
  const proof = link && !postBits ? `<a class="post-link library-proof" href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`See the post behind: ${item.text}`)}">See the post</a>` : '';
  const pending = removing.has(key);
  const problem = errors.get(key);
  const action = !item.id ? '' : pending
    ? '<span class="library-pending" role="status">Removal sent to Claude</span>'
    : item.proven ? '' : `<button type="button" class="quiet library-remove" data-bank-remove="${esc(item.id)}" data-bank-brand="${esc(brand.slug)}" aria-label="${esc(`Remove from your library: ${item.text}`)}">Remove</button>`;
  return `<li class="library-item${pending ? ' is-removing' : ''}${postBits ? ' library-post' : ''}">${postBits ? postBits.thumb : ''}<div class="library-main"><span class="library-kind">${esc(kind)}</span><span class="library-text">${esc(item.text)}</span>${libraryResult(item)}${meta || proof ? `<span class="library-meta">${meta}${meta && proof ? ' &middot; ' : ''}${proof}</span>` : ''}${item.edited && trimmed(item.was) ? `<span class="library-meta">Was: ${esc(item.was)}</span>` : ''}${said}${matched}${problem ? `<span class="field-error" role="alert">${esc(problem)}</span>` : ''}${postBits ? postBits.links + postBits.box : ''}</div>${action}</li>`;
}
// One bank of the library, folded: its name, how many items it holds (and how many are the person's own), the top item as a preview, and
// when opened the top items, the person's own with their Remove. The rest stay on the computer for Claude to read with the bank's kind.
function libraryBankGroup(bank, brand, { removing, errors, openKeys, copy }) {
  const items = (Array.isArray(bank?.items) ? bank.items : []).filter(item => item && typeof item === 'object' && !item.removed && trimmed(item.text));
  if (!items.length) return '';
  const total = Number.isFinite(bank.total) && bank.total >= items.length ? Math.floor(bank.total) : items.length;
  const yours = Number.isFinite(bank.yours) && bank.yours > 0 ? Math.floor(bank.yours) : 0;
  const title = LIBRARY_BANK_TITLES[bank.kind] || humanize(bank.kind || 'items');
  const key = `brand-library:${brand.slug}:${bank.kind}`;
  const rows = items.map(item => libraryItem({ ...item, proven: item.bank !== 'yours' }, brand, { removing, errors, copy })).join('');
  const more = total > items.length ? `<p class="muted library-more">${plural(total - items.length, 'more item')} on this computer.</p>` : '';
  return `<details class="library-bank" data-open-key="${esc(key)}"${openKeys.has(key) ? ' open' : ''}><summary><span class="library-bank-title">${esc(title)}</span><span class="count">${total}</span>${yours ? `<span class="library-bank-yours">${esc(`${yours} yours`)}</span>` : ''}<span class="library-bank-top">${esc(items[0].text)}</span></summary><ul class="library-list">${rows}</ul>${more}</details>`;
}
// Fresh trends (`library.trends`, which the server adds when the Trend Scout saw something under 7 days ago): what is rising now in the brand's
// industry, each with the platform, when it was seen and the post that shows it. They are not the person's own items, so there is no Remove.
// A hook or caption comes from an ad that keeps running: the ad libraries show no views or spend, so the row says how many days it has run.
const TREND_KIND_WORDS = Object.freeze({ topic: 'Topic', format: 'Format', sound: 'Sound', hashtag: 'Hashtag', hook: 'Hook', caption: 'Post text' });
const TREND_SOURCE_WORDS = Object.freeze({ meta_ad_library: 'Meta Ad Library', tiktok_top_ads: 'TikTok Top Ads' });
const TREND_AD_NOTE = 'Days running stands in for views. 30+ likely won.';
const TREND_PLATFORM_WORDS = Object.freeze({ tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X' });
function libraryTrend(trend, brand, copy = {}) {
  const evidence = (Array.isArray(trend.evidence) ? trend.evidence : []).find(item => item && typeof item === 'object' && safeHttpsLink(item.url)) || null;
  const link = evidence ? safeHttpsLink(evidence.url) : null;
  const platform = TREND_PLATFORM_WORDS[trend.platform] || (trimmed(trend.platform) ? humanize(trend.platform) : '');
  const seen = libraryDay(trend.seenAt);
  const views = Number.isFinite(evidence?.views) ? `${Math.round(evidence.views).toLocaleString('en-US')} views` : '';
  const running = Number.isFinite(evidence?.runningDays) && evidence.runningDays >= 0 ? plural(Math.floor(evidence.runningDays), 'day') : '';
  const variants = Number.isFinite(evidence?.variants) && evidence.variants >= 1 ? plural(Math.floor(evidence.variants), 'variant') : '';
  const ad = Boolean(TREND_SOURCE_WORDS[evidence?.source]);
  const meta = [platform, trimmed(trend.industry), TREND_SOURCE_WORDS[evidence?.source] || '', trimmed(evidence?.advertiser), running ? `running ${running}` : '', variants, seen ? `seen ${seen}` : '', views].filter(Boolean).map(esc).join(' &middot; ');
  const postBits = link ? libraryPost({ href: link, post: evidence, thumbs: brand?.thumbs, platform: platform || postPlatformOf(link), key: `trend:${brand?.slug || ''}:${trend.id || trend.text}`, title: trend.text, ad, copy }) : null;
  const proof = '';
  return `<li class="library-item${postBits ? ' library-post' : ''}">${postBits ? postBits.thumb : ''}<div class="library-main"><span class="library-kind">${esc(TREND_KIND_WORDS[trend.kind] || humanize(trend.kind || 'trend'))}</span><span class="library-text">${esc(trend.text)}</span>${meta || proof ? `<span class="library-meta">${meta}${meta && proof ? ' &middot; ' : ''}${proof}</span>` : ''}${trimmed(trend.why) ? `<span class="library-hook">Why it fits: ${esc(trend.why)}</span>` : ''}${postBits ? postBits.links + postBits.box : ''}</div></li>`;
}
function libraryJob(job) {
  const concept = job.concept && typeof job.concept === 'object' ? job.concept : {};
  const source = trimmed(concept.source) ? conceptSourceOf({ fields: [{ label: 'Source', value: concept.source }] }) : null;
  const meta = [concept.id ? `Concept ${concept.id}${trimmed(concept.title) ? `: ${concept.title}` : ''}` : '', source?.label || '', libraryDay(job.filedAt) ? `filed ${libraryDay(job.filedAt)}` : ''].filter(Boolean).map(esc).join(' &middot; ');
  return `<li class="library-item"><div class="library-main"><span class="library-text">${esc(trimmed(job.title) || 'Finished job')}</span>${meta ? `<span class="library-meta">${meta}</span>` : ''}${trimmed(concept.hook) ? `<span class="library-hook">Opening line: ${esc(concept.hook)}</span>` : ''}${libraryJobResults(job.results)}</div></li>`;
}
export function brandLibrarySection(brand, { open = false, removing = new Set(), errors = new Map(), openKeys = new Set(), copy = {} } = {}) {
  const library = brand?.library;
  if (!library || typeof library !== 'object' || Array.isArray(library) || !brand.slug) return '';
  const group = (title, id, list, row, note = '') => {
    if (!list.length) return '';
    const more = list.length > LIBRARY_GROUP_LIMIT ? `<p class="muted library-more">${plural(list.length - LIBRARY_GROUP_LIMIT, 'more item')} on this computer.</p>` : '';
    return `<section class="library-group" aria-labelledby="library-${esc(brand.slug)}-${id}"><h3 id="library-${esc(brand.slug)}-${id}">${esc(title)} <span class="count">${list.length}</span></h3><ul class="library-list">${list.slice(0, LIBRARY_GROUP_LIMIT).map(row).join('')}</ul>${more}${note}</section>`;
  };
  const trends = libraryItems(library.trends);
  const trendNote = trends.some(trend => trend.kind === 'hook' || trend.kind === 'caption') ? `<p class="muted library-more">${esc(TREND_AD_NOTE)}</p>` : '';
  const state = { removing, errors, copy };
  const yours = libraryItems(library.yours);
  const proven = libraryItems(library.proven).map(item => ({ ...item, proven: true }));
  const jobs = (Array.isArray(library.recentJobs) ? library.recentJobs : []).filter(job => job && typeof job === 'object');
  const footage = libraryFootage(library);
  const banks = (Array.isArray(library.banks) ? library.banks : []).map(bank => libraryBankGroup(bank, brand, { ...state, openKeys })).filter(Boolean);
  const bankSection = banks.length ? `<section class="library-group library-banks" aria-labelledby="library-${esc(brand.slug)}-banks"><h3 id="library-${esc(brand.slug)}-banks">Banks <span class="count">${banks.length}</span></h3>${banks.join('')}</section>` : '';
  const lists = banks.length ? bankSection : group('Yours', 'yours', yours, item => libraryItem(item, brand, state)) + group('Proven', 'proven', proven, item => libraryItem(item, brand, state));
  const body = lists + group('Fresh trends', 'trends', trends, trend => libraryTrend(trend, brand, copy), trendNote) + group('Recent jobs filed', 'jobs', jobs, libraryJob) + (footage ? libraryFootageGroup(brand, footage) : '');
  const key = `brand-library:${brand.slug}`;
  const empty = body ? '' : '<p class="muted">Nothing filed yet.</p>';
  return `<details class="panel doc-panel brand-library" data-open-key="${esc(key)}"${open ? ' open' : ''}><summary><span class="library-head"><span class="doc-summary-title">Brand library</span><span class="library-counts">${esc(`${brand.name || brand.slug} · ${libraryCountsLine(library)}`)}</span></span></summary><div class="doc-body">${body}${empty}</div></details>`;
}

// The Metricool brand picker, the same form on the brand card and on the posting plan card: a select that lists every saved
// Metricool brand as "Name (Instagram @handle)", and a button that sends choose_metricool_brand for that plugin brand.
// The pick that says this brand's posts are not sent through Metricool (the server's own word for it).
const NO_METRICOOL = 'none';
function metricoolPickerForm({ slug, brands = [], current = '', selected = '', busy = false, error = '', askHere = false, cancel = true } = {}) {
  const id = esc(slug);
  const chosen = selected || current;
  const options = [`<option value="" ${chosen ? '' : 'selected'} disabled>Choose a Metricool brand</option>`, ...brands.map(item => `<option value="${esc(item.id)}" ${item.id === chosen ? 'selected' : ''}>${esc(item.option || item.label)}</option>`), `<option value="${NO_METRICOOL}" ${chosen === NO_METRICOOL ? 'selected' : ''}>Not through Metricool</option>`].join('');
  const cancelButton = cancel ? `<button type="button" class="quiet" data-metricool-cancel="${id}" ${busy ? 'disabled' : ''}>Cancel</button>` : '';
  const label = askHere ? 'Metricool brand to post through' : 'Post through this Metricool brand';
  return `<div class="brand-chip-publish brand-chip-publish-edit"><label class="muted" for="metricool-select-${id}">${esc(label)}</label><span class="metricool-pick"><select id="metricool-select-${id}" name="metricool_brand_select" data-metricool-brand="${id}" ${busy ? 'disabled' : ''}>${options}</select><button type="button" class="primary" data-metricool-save="${id}" ${busy || !chosen || chosen === current ? 'disabled' : ''}>${busy ? 'Saving...' : 'Use this brand'}</button>${cancelButton}</span>${error ? `<p class="muted metricool-error" role="alert">${esc(error)}</p>` : ''}</div>`;
}

// Where this brand's posts go, as one line: "Posts through <Metricool brand> in Metricool", with a Change control at its end
// (or at the end of the warning when the saved brand is gone) when there is another Metricool brand to move to, or when
// the saved one is gone. A brand with no choice shows nothing (the Inbox asks for up to six brands) unless Metricool has
// more than six: then a picker shows here, since an Inbox question only holds six buttons. Only a ready brand gets a picker.
// `metricool` carries the saved list and the picker's own state, nothing else.
export function brandMetricoolLine(brand, { brands = [], open = false, busy = false, selected = '', error = '' } = {}) {
  const publishing = brand?.publishing;
  const slug = esc(brand?.slug || '');
  const ready = brandReady(brand);
  if (publishing?.unreadable) return '<div class="brand-chip-publish"><p class="muted metricool-warning">Could not read the Metricool details</p></div>';
  const optedOut = Boolean(publishing?.optedOut);
  const gone = Boolean(publishing) && publishing.found === false && !optedOut;
  const askHere = !publishing && brands.length > 5 && ready;
  if (!publishing && !askHere) return '';
  if (publishing && publishing.connected === false) return '<div class="brand-chip-publish"><p class="muted">Metricool is not connected</p></div>';
  if ((open || askHere) && ready) {
    const current = optedOut ? NO_METRICOOL : publishing && !gone ? publishing.blogId : '';
    return metricoolPickerForm({ slug: brand?.slug || '', brands, current, selected, busy, error, askHere, cancel: Boolean(publishing) });
  }
  // Change sits at the end of the one line, or at the end of the warning when the saved brand is gone.
  const canChange = ready && (brands.length > 1 || ((gone || optedOut) && brands.length > 0) || (brands.length === 1 && !optedOut));
  const change = canChange ? `<button type="button" class="quiet" data-metricool-change="${slug}">Change</button>` : '';
  if (optedOut) return `<div class="brand-chip-publish"><p class="muted">Not posting through Metricool${change ? ` ${change}` : ''}</p></div>`;
  if (gone) {
    return `<div class="brand-chip-publish"><p class="muted metricool-warning">Metricool no longer lists <strong>${esc(publishing.label)}</strong>. Posts have nowhere to go.${change ? ` ${change}` : ''}</p></div>`;
  }
  return `<div class="brand-chip-publish"><p class="muted">Posts through <strong>${esc(publishing.label)}</strong> in Metricool${change ? `<span class="metricool-sep" aria-hidden="true">·</span>${change}` : ''}</p></div>`;
}

export function brandStudioWorkspaceLine(brand) {
  const name = brand?.studioWorkspace?.name;
  return name ? `<p class="muted brand-chip-workspace">Paid from ${esc(name)}</p>` : '';
}

// One connector on the Connectors setup step, also reused when the header's
// "Connectors" link reopens the same step later: a small provider mark with
// its initials (the same two-letter convention as the brand avatar), name
// and description on the left, and either its Connect action or a
// state pill on the right. `busy` disables the actions while a request for
// this connector is in flight.
const CONNECTOR_GUIDANCE = Object.freeze({
  threeecho_studio: 'Add 3Echo Studio in claude.ai Connectors, then say done.',
  metricool: 'Add Metricool in claude.ai Connectors, then say done.',
  meta_ads: 'Add Meta ads in claude.ai as a custom connector at https://mcp.facebook.com/ads.',
  tiktok_ads: 'Add TikTok for Business in claude.ai Connectors, then say done.',
});

// Marks for connectors whose first two letters would match another's (Metricool and Meta ads are both ME).
const CONNECTOR_MARKS = Object.freeze({ metricool: 'MC', meta_ads: 'MA' });

export function connectorCard(connector, { busy = false, waiting = false } = {}) {
  const state = connector.state;
  const mark = esc(CONNECTOR_MARKS[connector.key] || String(connector.name || '').slice(0, 2).toUpperCase());
  const key = esc(connector.key);
  // Metricool is added in claude.ai and then looked for. Once connected, the same connect request reads its brands
  // again, so the button says what it does: Refresh brands, for after a brand or social account is added in Metricool.
  const refreshable = connector.key === 'metricool';
  // After a click the request waits for Claude, so the button stays disabled and says so until the connector's state changes.
  const connect = (extra = '', label = 'Connect') => `<button${extra} data-connect="${key}" ${busy || waiting ? 'disabled aria-busy="true"' : ''}>${waiting ? (label === 'Refresh brands' ? 'Refreshing…' : 'Connecting…') : label}</button>`;
  const actions = state === 'connected'
    ? `${refreshable ? connect(' title="Read the brand list again after you add a brand or a social account in Metricool"', 'Refresh brands') : ''}<span class="pill connected">Connected</span>`
    : state === 'skipped'
      ? `<span class="pill skipped">Skipped</span>${connect()}`
      : connect(' class="primary"');
  const guidance = state !== 'connected' ? CONNECTOR_GUIDANCE[connector.key] : null;
  const optional = connector.optional ? '<span class="pill connector-optional">Optional</span>' : '';
  const count = state === 'connected' && Number.isInteger(connector.brandCount)
    ? `<p class="muted">${connector.brandCount === 1 ? '1 brand' : `${connector.brandCount} brands`} in Metricool</p>` : '';
  return `<div class="connector-card"><div class="connector-card-main"><span class="avatar" aria-hidden="true">${mark}</span><div class="connector-card-copy"><h3>${esc(connector.name)}${optional}</h3><p class="muted">${esc(connector.description)}</p>${count}${guidance ? `<p class="muted connector-guidance">${esc(guidance)}</p>` : ''}</div></div><div class="connector-card-actions">${actions}</div></div>`;
}

// The pending-request notice: shown once a board request (for example a
// brand profile) has been saved and is waiting for Claude. Saving the
// request already signals Claude once on its own (see createTransport's
// call()), so "Notify Claude" here is only a manual fallback, gated the same
// way as any other Claude notification: hidden outside artifact mode or once
// a prior click came back forbidden for this visit, disabled while unproven
// or mid-click, and explained in place of the default line when the render-
// time availability check itself already knows why it would not reach
// Claude (read-only account, no watching session).
export function notifyClaudeNotice(state = {}, signal = {}, now = Date.now()) {
  const { artifact = false, availability = null, busy = false } = signal;
  const helper = availability === 'writers_only' || availability === 'no_session' ? SIGNAL_OUTCOMES[availability] : '';
  // Once the request carries the received status, Claude has it: say so and drop the nudge buttons.
  const received = Boolean(state.requestId) && state.receivedFor === state.requestId;
  const text = esc(received ? 'Claude has it.' : helper || state.message || 'Saved. If nothing happens, notify Claude.');
  const delivered = state.signal === 'sent';
  const showButton = artifact && availability !== 'off' && !delivered && !received;
  const canNotify = availability === 'available';
  const button = showButton ? `<button type="button" data-action="signal" ${busy || !canNotify ? 'disabled' : ''}>${busy ? 'Notifying...' : 'Notify Claude'}</button>` : '';
  const waitSince = state.lastReminderAt || state.submittedAt;
  const dueForReminder = Number.isFinite(waitSince) && now - waitSince >= REMIND_DELAY_MS;
  const showReminder = artifact && Boolean(state.requestId) && !received && (dueForReminder || state.reminding);
  const remindButton = showReminder ? `<button type="button" class="quiet" data-action="remind" data-request-id="${esc(state.requestId)}" ${state.reminding ? 'disabled' : ''}>${state.reminding ? 'Reminding...' : 'Remind Claude'}</button>` : '';
  const actions = button || remindButton ? `<span class="notice-actions">${button}${remindButton}</span>` : '';
  return `<div class="notice pending" role="status"><span>${text}</span>${actions}</div>`;
}

// What a job has used of the studio's credits, as rows for About this job. Tokens and hours are not shown to the person. A report
// job makes no media, so it has none; the voice row shows only when voice credits were set or spent.
export function jobCreditRows(project) {
  if (isReportJob(project)) return [];
  const generation = project?.usage?.generation || {};
  const voice = creditsInUse(generation.elevenLabsCredits) ? creditFraction(generation.elevenLabsCredits) : null;
  return [['Studio credits used', creditFraction(generation.threeEchoCredits)], ['Voice credits used', voice]].filter(([, value]) => value);
}

// @module report
// A small, safe markdown renderer for job documents: everything is escaped
// first, then headings, lists, tables, quotes, code, bold, italic and https
// links are rebuilt. Headings start at h3 so a file sits inside a panel.
function inlineMarkdown(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
const MD_LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const MD_TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const mdCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim());
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let index = 0;
  const starts = line => /^(#{1,6})\s/.test(line) || MD_LIST.test(line) || /^\s*```/.test(line) || /^\s*>/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (/^\s*```/.test(line)) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      index += 1;
      out.push(`<pre>${esc(code.join('\n'))}</pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length + 2);
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); index += 1; continue; }
    if (line.trim().startsWith('|') && index + 1 < lines.length && MD_TABLE_SEPARATOR.test(lines[index + 1])) {
      const head = mdCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) rows.push(mdCells(lines[index++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }
    const list = MD_LIST.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items = [];
      while (index < lines.length) {
        const item = MD_LIST.exec(lines[index]);
        if (item && /\d/.test(item[1]) === ordered) { items.push(item[2]); index += 1; continue; }
        if (items.length && lines[index].trim() && /^\s{2,}/.test(lines[index]) && !item) { items[items.length - 1] += ` ${lines[index].trim()}`; index += 1; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !starts(lines[index]) && !lines[index].trim().startsWith('|')) paragraph.push(lines[index++].trim());
    out.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`);
  }
  return out.join('');
}

// The first "# Title" line of a file, dropped when the panel already shows it.
function withoutTitle(text, title) {
  const match = /^\s*#\s+(.+)\n?/.exec(String(text || ''));
  return match && match[1].replace(/[`*]/g, '').trim() === String(title || '').trim() ? text.slice(match[0].length) : text;
}

export function stillSecondsOf(path) {
  const name = String(path || '').split(/[\\/]/).pop() || '';
  const minutes = /(\d+)m(\d{1,2}(?:\.\d+)?)s\.[a-z0-9]+$/i.exec(name);
  if (minutes) return Math.round((Number(minutes[1]) * 60 + Number(minutes[2])) * 100) / 100;
  const seconds = /(\d+(?:\.\d+)?)s\.[a-z0-9]+$/i.exec(name);
  return seconds ? Math.round(Number(seconds[1]) * 100) / 100 : null;
}

export function stillTime(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return '';
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '';
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

const stillAt = still => (still?.at === null || still?.at === undefined || !Number.isFinite(Number(still.at)) ? stillSecondsOf(still?.path) : Number(still.at));
const stillLabel = still => { const at = stillTime(stillAt(still)); return at ? `Still at ${at}` : 'Still'; };
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MD_FILE_LINK = /(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const STILL_NAME = /(?<![\w/.:@-])`?((?:\.\/)?(?:[\w-]+\/)*[\w.-]+\.(?:png|jpe?g|webp|gif))`?(?![\w/])/gi;

function stillFinder(stills) {
  const byPath = new Map();
  const byName = new Map();
  stills.forEach((still, index) => {
    const path = String(still?.path || '').toLowerCase();
    const entry = { still, index };
    byPath.set(path, entry);
    byPath.set(path.replace(/^report\//, ''), entry);
    const name = path.split('/').pop();
    if (name && !byName.has(name)) byName.set(name, entry);
  });
  return ref => {
    const clean = String(ref || '').replace(/^\.?\//, '').toLowerCase();
    return byPath.get(clean) || byPath.get(clean.replace(/^report\//, '')) || byName.get(clean.split('/').pop()) || { still: { path: String(ref || ''), at: null }, index: -1 };
  };
}

function standsAlone(source, start, end) {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = source.indexOf('\n', end);
  const before = source.slice(lineStart, start).split('|').pop();
  const after = source.slice(end, lineEnd < 0 ? source.length : lineEnd).split('|')[0];
  return /^\s*(?:(?:[-*+]|\d+[.)])\s+)?$/.test(before) && !after.trim();
}

function rewriteStillRefs(text, onStill, onImageLink = whole => whole) {
  return String(text ?? '')
    .replace(MD_FILE_LINK, (whole, bang, alt, ref, offset, source) => {
      if (IMAGE_FILE.test(ref) && !HAS_SCHEME.test(ref)) return onStill(ref, standsAlone(source, offset, offset + whole.length));
      return bang ? onImageLink(whole, alt, ref) : whole;
    })
    .replace(STILL_NAME, (whole, ref, offset, source) => onStill(ref, standsAlone(source, offset, offset + whole.length)));
}

function stillTile(still, index, { file = false, size = '' } = {}) {
  const label = stillLabel(still);
  const caption = stillTime(stillAt(still)) || `Still ${index + 1}`;
  const full = file ? null : safePreviewUrl(still?.reviewUrl);
  const thumb = /^data:image\//.test(String(still?.thumb || '')) ? safePreviewUrl(still.thumb) : null;
  const src = file ? thumb : full || thumb;
  if (!src) return null;
  const image = `<img src="${esc(src)}" alt="${esc(label)}" loading="lazy">`;
  const frame = full ? `<button type="button" class="media-open" data-view-media="${esc(full)}" data-view-alt="${esc(label)}" aria-label="${esc(`Open ${label[0].toLowerCase()}${label.slice(1)} full size`)}">${image}</button>` : image;
  return `<figure class="still${size ? ` ${size}` : ''}"><span class="still-frame">${frame}</span><figcaption>${esc(caption)}</figcaption></figure>`;
}

function reportContent(report, { file = false } = {}) {
  const stills = Array.isArray(report?.stills) ? report.stills : [];
  const title = trimmed(report?.title) || 'Report';
  const find = stillFinder(stills);
  const refs = [];
  const text = rewriteStillRefs(report?.text, ref => { refs.push(find(ref)); return `${refs.length - 1}`; }, (whole, alt, ref) => (HAS_SCHEME.test(ref) ? `[${alt.trim() || 'Picture'}](${ref})` : alt));
  const pictured = new Set();
  let body = renderMarkdown(withoutTitle(text, title)).replace(/<(p|li|td)>(\d+)<\/\1>/g, (whole, tag, n) => {
    const entry = refs[Number(n)];
    const tile = entry && entry.index >= 0 ? stillTile(entry.still, entry.index, { file, size: tag === 'p' ? 'still-block' : 'still-inline' }) : null;
    if (!tile) return whole;
    pictured.add(entry.index);
    return tag === 'p' ? tile : `<${tag}>${tile}</${tag}>`;
  });
  body = body.replace(/(\d+)/g, (whole, n) => `<span class="pill still-ref">${esc(stillLabel(refs[Number(n)]?.still))}</span>`);
  const tiles = stills.map((still, index) => (pictured.has(index) ? null : stillTile(still, index, { file }))).filter(Boolean);
  const unseen = stills.length - pictured.size - tiles.length + (Number(report?.stillsOmitted) || 0);
  return { title, body, tiles, unseen, shown: pictured.size + tiles.length };
}

export function reportDownloads(downloads) {
  if (!downloads) return '';
  const busy = downloads.busy ? 'disabled' : '';
  const buttons = downloads.available === false ? '' : `<button type="button" data-report-download="md" ${busy}>Download as Markdown</button><button type="button" data-report-download="html" ${busy}>Download as web page</button>`;
  const note = downloads.note ? `<p class="report-save-note" role="status">${esc(downloads.note)}</p>` : '';
  return buttons || note ? `<div class="report-downloads">${buttons}${note}</div>` : '';
}

export function reportArticle(report, { jobTitle = '' } = {}) {
  if (!report) return '';
  const { title, body, tiles, unseen, shown } = reportContent(report);
  const missing = unseen > 0 ? `<p class="muted">${shown ? `${unseen} more ${unseen === 1 ? 'still is' : 'stills are'} on your computer.` : `The ${unseen === 1 ? 'still is' : 'stills are'} on your computer.`}</p>` : '';
  const stills = tiles.length || missing ? `<h4>Stills</h4>${tiles.length ? `<ul class="still-grid">${tiles.map(tile => `<li>${tile}</li>`).join('')}</ul>` : ''}${missing}` : '';
  const shortened = report.truncated ? `<p class="muted">${NOTE_SHORTENED}</p>` : '';
  const heading = title.toLowerCase() === String(jobTitle || '').trim().toLowerCase() ? '' : `<h3>${esc(title)}</h3>`;
  return `<article class="doc-file report-doc">${heading}<div class="md">${body}${stills}</div>${shortened}</article>`;
}

export function reportPanel(doc, { downloads = null, jobTitle = '' } = {}) {
  if (!doc?.report) return '';
  return `<section class="panel report-panel" aria-labelledby="report-title"><div class="section-head report-section-head"><h2 id="report-title">Report</h2>${reportDownloads(downloads)}</div>${reportArticle(doc.report, { jobTitle })}</section>`;
}

export function reportFileName(title, extension) {
  const base = String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  return `${base || 'report'}.${extension}`;
}

const SHORTENED_COPY = "Shortened. The full file is on your computer.";

export function reportMarkdownFile(report, title) {
  const stills = Array.isArray(report?.stills) ? report.stills : [];
  const find = stillFinder(stills);
  let text = rewriteStillRefs(report?.text, (ref, alone) => { const label = stillLabel(find(ref).still); return alone ? label : `the ${label[0].toLowerCase()}${label.slice(1)}`; }).trim();
  if (!/^#\s/.test(text)) text = `# ${trimmed(report?.title) || trimmed(title) || 'Report'}\n\n${text}`;
  if (report?.truncated) text += `\n\n_${SHORTENED_COPY}_`;
  return { filename: reportFileName(title || report?.title, 'md'), data: `${text}\n` };
}

const REPORT_FILE_CSS = [
  ':root{color-scheme:light dark;--page:#fff;--ink:#172033;--dim:#4b5568;--line:#dfe3ea;--soft:#f3f5f9;--link:#2446c7;--frame:#0A0B0D}',
  '@media (prefers-color-scheme:dark){:root{--page:#0A0B0D;--ink:#F4F5F7;--dim:#B4B9C2;--line:#23262C;--soft:#181A1E;--link:#8FB2FF;--frame:#050608}}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--page);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}',
  'main{max-width:780px;margin:0 auto;padding:48px 20px 72px}',
  'h1,h3,h4,h5,h6,p,ul,ol,blockquote,pre,figure{margin:0}',
  'h1,h3,h4,h5,h6{line-height:1.25}',
  'h1{font-size:30px;letter-spacing:-.01em}',
  'h3{font-size:24px}',
  'h4{font-size:20px}',
  'h5,h6{font-size:17px}',
  'main>*+*{margin-top:16px}',
  'main>*+:is(h3,h4,h5,h6){margin-top:32px}',
  'main>h1+*{margin-top:28px}',
  'main>:is(h3,h4,h5,h6)+*{margin-top:8px}',
  'ul,ol{padding-left:24px}',
  'li+li{margin-top:4px}',
  'a{color:var(--link)}',
  'strong{font-weight:700}',
  'code{padding:1px 5px;background:var(--soft);border-radius:4px;font-size:14px}',
  'pre{padding:12px 14px;background:var(--soft);border-radius:8px;white-space:pre-wrap;font-size:14px}',
  'blockquote{padding-left:16px;border-left:3px solid var(--line);color:var(--dim)}',
  'hr{border:0;border-top:1px solid var(--line)}',
  '.md-table{overflow-x:auto}',
  'table{width:100%;border-collapse:collapse;font-size:14px}',
  'th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}',
  'th{color:var(--dim);font-size:13px}',
  'th:first-child,td:first-child{padding-left:0}',
  'th:last-child,td:last-child{padding-right:0}',
  '.still{display:inline-flex;flex-direction:column;gap:6px;margin:0}',
  '.still-frame{display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:1/1;overflow:hidden;background:var(--frame);border-radius:8px}',
  '.still-frame img{display:block;width:100%;height:100%;object-fit:contain}',
  '.still figcaption{color:var(--dim);font-size:13px;font-variant-numeric:tabular-nums}',
  '.still-inline{width:96px}',
  '.still-block{width:min(260px,100%)}',
  '.still-grid{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:16px}',
  '.still-grid li+li{margin-top:0}',
  '.still-grid .still{width:100%}',
  '.still-ref{display:inline-block;padding:1px 8px;border:1px solid var(--line);border-radius:999px;font-size:13px;white-space:nowrap}',
  '.note{color:var(--dim);font-size:14px}',
].join('');

export function reportHtmlFile(report, title) {
  const { title: heading, body, tiles } = reportContent(report, { file: true });
  const stills = tiles.length ? `<h4>Stills</h4><ul class="still-grid">${tiles.map(tile => `<li>${tile}</li>`).join('')}</ul>` : '';
  const note = report?.truncated ? `<p class="note">${esc(SHORTENED_COPY)}</p>` : '';
  const data = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${esc(heading)}</title>\n<style>${REPORT_FILE_CSS}</style>\n</head>\n<body>\n<main>\n<h1>${esc(heading)}</h1>\n${body}${stills}${note}\n</main>\n</body>\n</html>\n`;
  return { filename: reportFileName(title || heading, 'html'), data };
}

const DOWNLOAD_NOTES = Object.freeze({
  rate_limited: 'Try again shortly.',
  extension_not_enabled: "This format can't be saved here.",
  rejected_extension: "This format can't be saved here.",
  too_large: 'This file is too big.',
});
const DOWNLOAD_FAILED = new Set(['bad_request', 'transform_error', 'request_unknown']);

export function downloadOutcome(code) {
  if (code === 'declined') return { note: '' };
  if (DOWNLOAD_NOTES[code]) return { note: DOWNLOAD_NOTES[code] };
  if (DOWNLOAD_FAILED.has(code)) return { note: 'The file could not be saved.' };
  return { note: 'Files can\'t be saved here.', unavailable: true };
}

// ---- Intake form ----------------------------------------------------------

// @module intake
// The form's starting values: what the projection says Claude already filled
// in, overlaid with whatever the person has typed since (the draft).
export function intakeValues(intake, draft = {}) {
  const values = {};
  for (const field of intake?.fields || []) {
    const value = field.value;
    if (field.input === 'select' || field.input === 'url') values[field.key] = typeof value === 'string' ? value : '';
    else if (field.input === 'checkboxes') values[field.key] = Array.isArray(value) ? [...value] : [];
    else if (field.input === 'links') values[field.key] = Array.isArray(value) ? value.filter(item => typeof item === 'string').join('\n') : typeof value === 'string' ? value : '';
    else if (field.input === 'textarea') values[field.key] = typeof value === 'string' ? value : typeof value?.description === 'string' ? value.description : '';
    else if (field.input === 'budget') {
      values.budget_currency = typeof value?.currency === 'string' ? value.currency : '';
      values.budget_amount = value?.maxTotalAmount == null ? '' : String(value.maxTotalAmount);
    } else if (field.input === 'deliverables') {
      const seen = {};
      for (const item of Array.isArray(value) ? value : []) {
        const index = seen[item.platform] = (seen[item.platform] ?? -1) + 1;
        values[`deliv_${item.platform}_${index}_format`] = item.format || '';
        values[`deliv_${item.platform}_${index}_placement`] = item.placement || '';
        values[`deliv_${item.platform}_${index}_count`] = String(item.count ?? 1);
      }
    }
  }
  return { ...values, ...(draft || {}) };
}

// The platforms the deliverable rows are for: the ones ticked on the form when
// the form asks for platforms, else the ones the job already has.
function intakePlatforms(intake, values) {
  const asks = (intake?.fields || []).some(field => field.key === 'platforms');
  return asks ? (Array.isArray(values.platforms) ? values.platforms : []) : (intake?.platforms || []);
}

// One row per format: the job's existing deliverables for each chosen platform,
// or one empty row for a platform that has none yet.
export function deliverableRows(field, platforms = [], values = {}) {
  const items = Array.isArray(field?.value) ? field.value : [];
  const labels = new Map((field?.platforms || []).map(platform => [platform.value, platform.label]));
  const order = (field?.platforms || []).map(platform => platform.value).filter(platform => platforms.includes(platform));
  const rows = [];
  for (const platform of order) {
    const existing = items.filter(item => item.platform === platform);
    (existing.length ? existing : [null]).forEach((item, index) => {
      const key = `deliv_${platform}_${index}`;
      const placements = field?.placements?.[platform] || [];
      rows.push({ key, platform, label: labels.get(platform) || platform, item, format: String(values[`${key}_format`] ?? item?.format ?? ''), placements, placement: String(values[`${key}_placement`] ?? item?.placement ?? ''), count: String(values[`${key}_count`] ?? item?.count ?? 1) });
    });
  }
  return rows;
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// What the chosen post type cannot be made from. These are the router's rules in
// pipeline/scripts/lib-deliverable.js (placementProblems), one for one, so the form refuses what the
// router would send back, and says it before the person saves. A post type that fills a phone screen
// is 9:16, so choosing one sets that ratio below rather than failing on a leftover one.
const VIDEO_FORMATS = ['ugc', 'brand_video', 'motion_graphic'];
const STORY_FORMATS = ['static_image', 'ugc', 'brand_video', 'motion_graphic'];
const PHOTO_FORMATS = ['static_image', 'carousel'];
const VERTICAL_TYPES = ['reel', 'story', 'video'];
export const isVerticalPostType = (platform, placement) => VERTICAL_TYPES.includes(placement) && (placement !== 'video' || platform === 'tiktok');
export function placementIssue(platform, placement, format, ratios = []) {
  if (!placement) return '';
  const name = { reel: 'A Reel', story: 'A Story', video: 'A TikTok video' }[placement] || 'This post type';
  if (format) {
    if ((placement === 'reel' || (platform === 'tiktok' && placement === 'video')) && !VIDEO_FORMATS.includes(format)) return `${name} needs a video format.`;
    if (placement === 'story' && !STORY_FORMATS.includes(format)) return 'A Story needs an image or video.';
    if (platform === 'tiktok' && placement === 'photo' && !PHOTO_FORMATS.includes(format)) return 'TikTok photos need Image or Carousel.';
    if (platform === 'instagram' && placement === 'post' && format === 'text_only') return 'Instagram needs an image or video.';
    if (placement === 'carousel' && format !== 'carousel') return 'Use the Carousel format.';
  }
  if (VERTICAL_TYPES.includes(placement) && (placement !== 'video' || platform === 'tiktok') && (ratios || []).some(ratio => ratio !== '9:16')) return `${name} is 9:16.`;
  return '';
}
// The board's own copy of the intake text limit (also enforced server-side by
// validateIntakePatch/intakeText), used both to cap the textarea's maxlength
// and to explain a prefilled value that already exceeds it.
const INTAKE_TEXT_LIMIT = 6000;

/** Whether an intake field currently carries no value at all, per its input
 * type. Used to decide the "Needed" tag (empty and still required) versus an
 * inline reason (a value is present but would not pass, for example a
 * research-filled field the route still calls missing but that already has
 * an answer). */
function intakeFieldEmpty(field, values) {
  switch (field.input) {
    case 'textarea':
    case 'select':
    case 'links':
    case 'url': return !String(values[field.key] || '').trim();
    case 'checkboxes': return !(values[field.key] || []).length;
    case 'budget': return !String(values.budget_currency || '').trim() && !String(values.budget_amount ?? '').trim();
    case 'deliverables': return !(Array.isArray(field.value) && field.value.length) || field.value.some(item => field.placements?.[item.platform] && !item.placement);
    case 'photo': return true;
    default: return false;
  }
}

/**
 * Turn the intake form's values into the update_intake patch, or say what is
 * wrong. A field the route marks missing is always sent; a field Claude already
 * filled in is sent only when the person changed it.
 */
export function intakePatch(intake, draft = {}) {
  const values = intakeValues(intake, draft);
  const prefill = intakeValues(intake, {});
  const patch = {};
  const errors = {};
  const fields = intake?.fields || [];
  for (const field of fields) {
    const key = field.key;
    const changed = names => names.some(name => !sameValue(values[name], prefill[name]));
    if (field.input === 'select') {
      const value = String(values[key] || '');
      if (!(field.options || []).some(option => option.value === value)) { if (field.missing || value) errors[key] = 'Choose one.'; }
      else if (field.missing || changed([key])) patch[key] = value;
    } else if (field.input === 'checkboxes') {
      const picked = (field.options || []).map(option => option.value).filter(value => (values[key] || []).includes(value));
      if (!picked.length) errors[key] = 'Choose at least one platform.';
      else if (field.missing || changed([key])) patch[key] = picked;
    } else if (field.input === 'links') {
      const { links, error } = parseLinks(values[key]);
      if (error) errors[key] = error;
      else if (!links.length) { if (field.missing) errors[key] = field.need === 'video' ? 'Add a video link, or give the file to Claude.' : field.need === 'link_or_file' ? 'Add a link, or give the files to Claude.' : 'Add at least one link.'; }
      else if (field.missing || changed([key])) patch[key] = links;
    } else if (field.input === 'textarea') {
      const text = String(values[key] || '').trim();
      if (!text) { if (field.missing) errors[key] = key === 'audience' ? 'Describe who this is for.' : 'Describe what Claude should make.'; }
      else if (text.length > INTAKE_TEXT_LIMIT) errors[key] = `Keep this under ${INTAKE_TEXT_LIMIT} characters.`;
      else if (field.missing || changed([key])) patch[key] = key === 'audience' ? { ...(field.value?.extra || {}), description: text } : text;
    } else if (field.input === 'budget') {
      const currency = String(values.budget_currency || '').trim().toUpperCase();
      const amountText = String(values.budget_amount ?? '').trim();
      const amount = Number(amountText);
      if (!/^[A-Z]{3}$/.test(currency)) errors.budget_currency = 'Use a currency code like SGD.';
      if (!amountText || !Number.isFinite(amount) || amount < 0) errors.budget_amount = 'Enter your maximum spend.';
      if (!errors.budget_currency && !errors.budget_amount && (field.missing || changed(['budget_currency', 'budget_amount']))) patch.budget = { ...(field.value?.extra || {}), currency, maxTotalAmount: amount };
    } else if (field.input === 'url') {
      const text = normalizeChannelInput('website', values[key]);
      let valid = false;
      try { valid = /^https?:$/.test(new URL(text).protocol); } catch { valid = false; }
      if (!valid) { if (field.missing || text) errors[key] = 'Enter a full URL.'; }
      else if (field.missing || changed([key])) patch[key] = text;
    } else if (field.input === 'deliverables') {
      const rows = deliverableRows(field, intakePlatforms(intake, values), values);
      if (!rows.length) { errors[key] = 'Choose a platform first.'; continue; }
      const items = Array.isArray(field.value) ? field.value : [];
      let next = Math.max(0, ...items.map(item => Number(/^D(\d+)$/.exec(item.id || '')?.[1] || 0))) + 1;
      const formats = (field.options || []).map(option => option.value);
      const out = [];
      let rowErrors = false;
      for (const row of rows) {
        const count = Number(row.count);
        if (!formats.includes(row.format)) { errors[`${row.key}_format`] = 'Choose a format.'; rowErrors = true; }
        if (!Number.isInteger(count) || count < 1 || count > 100) { errors[`${row.key}_count`] = 'Enter a number from 1 to 100.'; rowErrors = true; }
        const extra = { ...(row.item?.extra || {}) };
        if (row.placements.length && isVerticalPostType(row.platform, row.placement)) extra.aspectRatios = ['9:16'];
        if (row.placements.length) {
          if (!row.placements.some(option => option.value === row.placement)) { errors[`${row.key}_placement`] = 'Choose a post type.'; rowErrors = true; }
          else if (placementIssue(row.platform, row.placement, row.format, extra.aspectRatios)) { errors[`${row.key}_placement`] = placementIssue(row.platform, row.placement, row.format, extra.aspectRatios); rowErrors = true; }
        }
        out.push({ ...extra, id: row.item?.id || `D${next++}`, platform: row.platform, count, creativeDiscipline: row.format, ...(row.placements.length ? { placement: row.placement } : {}), ...(row.format === 'ugc' ? { ugcSource: 'ai' } : {}) });
      }
      const rowNames = rows.flatMap(row => [`${row.key}_format`, `${row.key}_count`, `${row.key}_placement`]);
      if (!rowErrors && (field.missing || changed(rowNames) || rows.length !== items.length)) patch.deliverables = out;
    }
  }
  return { patch, errors };
}

/** The update_intake request arguments, or the form errors to show instead. */
export function intakeArgs(project, draft, requestId) {
  const { patch, errors } = intakePatch(project?.intake, draft);
  if (Object.keys(errors).length) return { errors };
  if (!Object.keys(patch).length) return { errors: { form: NOTE_NOTHING_CHANGED } };
  return { args: { requestId, brand: project.brand, jobId: project.jobId, expectedRevision: project.revision, patch, ...(project.title ? { title: project.title } : {}) } };
}

const fieldError = (errors, name, prefix = 'intake') => errors?.[name] ? `<p class="field-error" id="${prefix}-${esc(name)}-error" role="alert">${esc(errors[name])}</p>` : '';
const invalid = (errors, name, prefix = 'intake') => errors?.[name] ? `aria-invalid="true" aria-describedby="${prefix}-${esc(name)}-error"` : 'aria-invalid="false"';
// A bare "Needed" tag only ever means empty-and-still-required. A field the
// route calls missing but that already carries a value (a research-filled
// audience, say) shows its actual problem inline instead, from
// prefillIntakeIssues below, and never both at once.
const neededTag = (field, values) => field.missing && intakeFieldEmpty(field, values) ? '<span class="pill needed">Needed</span>' : '';

/**
 * The invalid-value reasons a prefilled intake field would fail on if saved
 * as-is, checked the same way a submitted patch is (intakePatch), but only
 * for fields that already carry a value: an empty field stays a plain
 * "Needed" tag instead of an error message. Returns null when nothing
 * qualifies, so it never masks a real post-submit error state.
 */
function prefillIntakeIssues(fields, values) {
  const { errors } = intakePatch({ fields }, values);
  const issues = {};
  for (const field of fields) {
    if (intakeFieldEmpty(field, values)) continue;
    if (field.input === 'budget') {
      if (errors.budget_currency) issues.budget_currency = errors.budget_currency;
      if (errors.budget_amount) issues.budget_amount = errors.budget_amount;
    } else if (errors[field.key]) {
      issues[field.key] = errors[field.key];
    }
  }
  return Object.keys(issues).length ? issues : null;
}

// The product photo widget: a fixed 160x160 dashed-upload tile, or once
// picked a checkerboard preview with Replace (and, where allowed, Remove).
// Never a file name anywhere, only this neutral label and those two actions.
function photoTile(id, photo, { removeAction = null, character = false, saved = false } = {}) {
  const preview = !photo?.error && photo?.previewDataUrl ? photo.previewDataUrl : null;
  const busy = Boolean(photo?.busy);
  const noun = character ? 'character picture' : 'product photo';
  const fileInput = label => `<input type="file" id="${id}" class="photo-file visually-hidden" name="${id}" accept="${PHOTO_ACCEPT.join(',')}"${label ? ` aria-label="${esc(label)}"` : ''} ${busy ? 'disabled' : ''}>`;
  const replace = `${fileInput(`Replace ${noun}`)}<label class="kit-file-button" for="${id}">${busy ? 'Saving...' : 'Replace'}</label>`;
  const body = preview
    ? `<div class="photo-preview"><img src="${esc(preview)}" alt="${character ? 'Character picture' : 'Product photo'}"></div><div class="photo-actions">${replace}${removeAction ? `<button type="button" class="quiet" data-photo-action="${esc(removeAction)}" ${busy ? 'disabled' : ''}>Remove</button>` : ''}</div>`
    : saved && !photo
      ? `<p class="muted">A ${noun} is saved.</p><div class="photo-actions">${replace}</div>`
      : `${fileInput(character ? 'Add a character picture' : 'Add a product photo')}<label class="photo-tile" for="${id}">${KIT_ICONS.upload}<span class="kit-upload-title">${busy ? 'Saving...' : `Add ${noun}`}</span><span class="kit-upload-hint">PNG, JPG or WebP</span></label>`;
  return `<div class="photo-field">${body}${photo?.error ? `<p class="field-error" role="alert">${esc(photo.error)}</p>` : ''}${!photo?.error && photo?.message ? `<p class="muted">${esc(photo.message)}</p>` : ''}</div>`;
}

// One cell of a deliverable row: the control and a compact label, which only a narrow screen shows
// (the column heads cover the wide one).
const delivCell = (label, control, extra = '') => `<label class="deliv-cell${extra}"><span class="deliv-cell-label">${label}</span>${control}</label>`;

// The post type of one deliverable, as the cell between its platform and its format: Instagram Reel,
// TikTok video. Fixed from the start of the job, so it is chosen here and never again at publish time.
// Only the post types this format can be made into are offered ("post or Story" for an image), judged
// the way the router judges them. With no format chosen yet, or none that fits, every one is offered
// and saving explains what to change.
export function placementOptionList(options, platform, format, ratios = []) {
  const fits = format ? options.filter(option => !placementIssue(platform, option.value, format, isVerticalPostType(platform, option.value) ? ['9:16'] : ratios)) : [];
  return fits.length ? fits : options;
}
export function placementOptionsHtml(list, selected = '') {
  return `<option value="">Choose a post type</option>${list.map(option => `<option value="${esc(option.value)}" ${selected === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}`;
}
// The question under each deliverable row, worked out again from what the rows say now, in the router's
// words and from the same valid set as the choices: "Which post type is the Instagram image: post or
// Story?". A row whose chosen post type already fits has none (null); one that can only be one thing says
// so; one that nothing fits says what to change (a rule to fix, so it is a conflict, not a hint).
const POST_NOUNS = { reel: 'Reel', story: 'Story', post: 'post', carousel: 'carousel', video: 'video', photo: 'photo post' };
const FORMAT_MEDIA = { static_image: 'image', carousel: 'carousel', brand_video: 'video', ugc: 'video', motion_graphic: 'video', text_only: 'text post' };
const PLATFORM_NEEDS = { instagram: 'a picture or a video', tiktok: 'a video or pictures', facebook: 'a picture, a video or words' };
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const choicesOf = nouns => nouns.join(', ').replace(/, ([^,]*)$/, ' or $1');
export function placementAsks(rows) {
  const fits = row => (row.format ? row.options.filter(option => !placementIssue(row.platform, option.value, row.format, isVerticalPostType(row.platform, option.value) ? ['9:16'] : row.ratios || [])) : row.options);
  const names = rows.map(row => {
    const chosen = row.placement && row.options.some(option => option.value === row.placement) && !placementIssue(row.platform, row.placement, row.format, isVerticalPostType(row.platform, row.placement) ? ['9:16'] : row.ratios || []);
    return `${POST_ASK_PLATFORMS[row.platform] || row.platform} ${chosen ? POST_NOUNS[row.placement] : FORMAT_MEDIA[row.format] || 'post'}`;
  });
  return rows.map((row, index) => {
    if (row.placement && row.options.some(option => option.value === row.placement) && !placementIssue(row.platform, row.placement, row.format, isVerticalPostType(row.platform, row.placement) ? ['9:16'] : row.ratios || [])) return null;
    const same = names.map((name, at) => (name === names[index] ? at : -1)).filter(at => at >= 0);
    const who = `the ${same.length > 1 ? `${ORDINALS[same.indexOf(index)] || 'next'} ` : ''}${names[index]}`;
    const valid = fits(row);
    const sentence = text => text[0].toUpperCase() + text.slice(1);
    if (!valid.length) return { kind: 'conflict', text: sentence(`${who} needs ${PLATFORM_NEEDS[row.platform] || 'a different format'}; change the format.`) };
    if (valid.length === 1) return { kind: 'ask', text: sentence(`${who} can only be ${/^[aeiou]/i.test(POST_NOUNS[valid[0].value]) ? 'an' : 'a'} ${POST_NOUNS[valid[0].value]}.`) };
    return { kind: 'ask', text: sentence(`which post type is ${who}: ${choicesOf(valid.map(option => POST_NOUNS[option.value]))}?`) };
  });
}
const POST_ASK_PLATFORMS = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
function placementCellHtml(row, errors, prefix) {
  const name = `${row.key}_placement`;
  if (!row.placements.length) return '<span></span>';
  const ratios = row.item?.extra?.aspectRatios || [];
  const list = placementOptionList(row.placements, row.platform, row.format, ratios);
  // The data attributes let a format change redraw just these options, in place, without redrawing the form.
  const data = `data-platform="${esc(row.platform)}" data-options="${esc(JSON.stringify(row.placements))}" data-ratios="${esc(JSON.stringify(ratios))}"`;
  return delivCell('Post type', `<select name="${name}" aria-label="${esc(row.label)} post type" ${data} ${invalid(errors, name, prefix)}>${placementOptionsHtml(list, row.placement)}</select>`, ' deliv-type');
}

// One deliverable: platform, post type, format and quantity in a row, then what the router said about
// its post type, if anything, under it.
function delivRowHtml(field, row, errors, prefix) {
  const formats = (field.options || []).map(option => `<option value="${esc(option.value)}" ${row.format === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('');
  const format = delivCell('Format', `<select name="${row.key}_format" aria-label="${esc(row.label)} format" ${invalid(errors, `${row.key}_format`, prefix)}><option value="">Choose a format</option>${formats}</select>`);
  const count = delivCell('Quantity', `<input type="number" name="${row.key}_count" min="1" max="100" step="1" inputmode="numeric" aria-label="${esc(row.label)} quantity" value="${esc(row.count)}" ${invalid(errors, `${row.key}_count`, prefix)}>`, ' deliv-count');
  // A question about a missing post type is a quiet hint; red is for a rule the choice breaks.
  const said = field.notes?.[row.item?.ref];
  const note = said ? `<p class="${said.kind === 'conflict' ? 'field-error' : 'field-hint'} deliv-note"${said.kind === 'ask' ? ' data-ask' : ''}>${esc(said.text)}</p>` : '';
  return `<div class="deliv-row" data-deliv-row><span class="deliv-platform">${esc(row.label)}</span>${placementCellHtml(row, errors, prefix)}${format}${count}${fieldError(errors, `${row.key}_placement`, prefix)}${fieldError(errors, `${row.key}_format`, prefix)}${fieldError(errors, `${row.key}_count`, prefix)}${note}</div>`;
}

function intakeFieldHtml(field, values, errors, platforms, photo, { prefix = 'intake', needed = true, labelled = true, currency = '' } = {}) {
  const id = `${prefix}-${field.key}`;
  const head = (tag, forId = id) => `<div class="intake-label${labelled ? '' : ' visually-hidden'}">${tag === 'legend' ? `<span class="intake-label-text" id="${id}-label">${esc(field.label)}</span>` : `<label for="${forId}">${esc(field.label)}</label>`}${needed ? neededTag(field, values) : ''}</div>`;
  if (field.input === 'select') {
    return `<div class="intake-field">${head()}<select id="${id}" name="${esc(field.key)}" ${invalid(errors, field.key, prefix)}><option value="">Choose one</option>${(field.options || []).map(option => `<option value="${esc(option.value)}" ${values[field.key] === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>${fieldError(errors, field.key, prefix)}</div>`;
  }
  if (field.input === 'checkboxes') {
    return `<div class="intake-field" role="group" aria-labelledby="${id}-label">${head('legend')}<div class="intake-checks">${(field.options || []).map(option => `<label class="intake-check"><input type="checkbox" name="${esc(field.key)}" value="${esc(option.value)}" ${(values[field.key] || []).includes(option.value) ? 'checked' : ''}><span>${esc(option.label)}</span></label>`).join('')}</div>${fieldError(errors, field.key, prefix)}</div>`;
  }
  if (field.input === 'deliverables') {
    const rows = deliverableRows(field, platforms, values);
    const body = rows.length
      ? `<div class="deliv-head" aria-hidden="true"><span>Platform</span><span>${rows.some(row => row.placements.length) ? 'Post type' : ''}</span><span>Format</span><span>Quantity</span></div>${rows.map(row => delivRowHtml(field, row, errors, prefix)).join('')}`
      : '<p class="muted">Choose a platform first.</p>';
    return `<div class="intake-field intake-wide" role="group" aria-labelledby="${id}-label">${head('legend')}<div class="deliv-list">${body}</div>${fieldError(errors, field.key, prefix)}</div>`;
  }
  if (field.input === 'textarea') {
    return `<div class="intake-field intake-wide">${head()}<textarea id="${id}" name="${esc(field.key)}" maxlength="${INTAKE_TEXT_LIMIT}" placeholder="${esc(field.placeholder || '')}" ${invalid(errors, field.key, prefix)}>${esc(values[field.key] || '')}</textarea>${fieldError(errors, field.key, prefix)}</div>`;
  }
  if (field.input === 'photo') {
    const character = field.key === 'subjectPhoto';
    return `<div class="intake-field intake-wide">${head()}${photoTile('intake-photo-file', photo, { character, saved: character && field.value?.saved === true })}</div>`;
  }
  if (field.input === 'links') {
    const hint = field.need === 'video' ? `<p class="field-hint" id="${id}-hint">${esc(VIDEO_FILE_HINT)}</p>` : '';
    const described = [errors?.[field.key] ? `${prefix}-${esc(field.key)}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ');
    return `<div class="intake-field intake-wide">${head()}<textarea id="${id}" class="links-input" name="${esc(field.key)}" maxlength="${INTAKE_TEXT_LIMIT}" placeholder="One link per line" spellcheck="false" aria-invalid="${errors?.[field.key] ? 'true' : 'false'}"${described ? ` aria-describedby="${described}"` : ''}>${esc(values[field.key] || '')}</textarea>${hint}${fieldError(errors, field.key, prefix)}</div>`;
  }
  if (field.input === 'budget') {
    return `<div class="intake-field" role="group" aria-labelledby="${id}-label">${head('legend')}<div class="budget-row"><input name="budget_currency" maxlength="3" placeholder="${esc(currency || 'Currency')}" autocomplete="off" aria-label="Currency" value="${esc(values.budget_currency || '')}" ${invalid(errors, 'budget_currency', prefix)}><input type="number" name="budget_amount" min="0" step="any" placeholder="Most you will spend" aria-label="Maximum total amount" value="${esc(values.budget_amount ?? '')}" ${invalid(errors, 'budget_amount', prefix)}></div>${fieldError(errors, 'budget_currency', prefix)}${fieldError(errors, 'budget_amount', prefix)}</div>`;
  }
  if (field.input === 'url') {
    return `<div class="intake-field">${head()}<input id="${id}" type="url" name="${esc(field.key)}" maxlength="2000" inputmode="url" placeholder="${esc(field.placeholder || 'https://')}" value="${esc(values[field.key] || '')}" ${invalid(errors, field.key, prefix)}>${fieldError(errors, field.key, prefix)}</div>`;
  }
  return '';
}

/**
 * "Finish the brief": the brief's answers with what Claude already filled in,
 * the missing ones marked Needed, and one Save and continue. Items the board
 * cannot take (a product photo, say) are listed for chat, where the person can
 * also answer anything by just typing. Nothing at all when the projection has
 * no intake.
 */
export function intakeForm(project, state = {}, signal = {}) {
  const intake = project?.intake;
  if (!intake || (!intake.fields?.length && !intake.other?.length)) return '';
  const fields = intake.fields || [];
  const values = intakeValues(intake, state.values);
  const errors = state.errors || prefillIntakeIssues(fields, values);
  const other = [...new Set((intake.other || []).map(intakeLabel))];
  const pending = state.submitted || state.needsReconciliation;
  const notice = state.declined
    ? `<div class="notice" role="status"><span>${esc(state.message || NOTE_DECLINED)}</span></div>`
    : pending ? notifyClaudeNotice(state, signal) : '';
  const otherList = other.length ? `<div class="intake-other"><span class="intake-label-text">${fields.length ? 'Also needed, in chat' : 'Still needed'}</span><ul>${other.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : '';
  if (!fields.length) {
    return `<section class="panel intake" aria-labelledby="intake-title"><div class="section-head"><h2 id="intake-title">Finish the brief</h2></div>${notice}${otherList}</section>`;
  }
  const buttonLabel = state.busy ? 'Saving...' : state.submitted ? TXT_WAITING_FOR_CLAUDE : state.needsReconciliation ? TXT_NEEDS_CLAUDE_ATTENTION : TXT_SAVE_AND_CONTINUE;
  const error = state.error || errors?.form ? `<p class="notice error inline-error" role="alert">${esc(errors?.form || state.error)}</p>` : '';
  const platforms = intakePlatforms(intake, values);
  const brief = intake.brief && !fields.some(field => field.key === 'request') ? `<div class="intake-brief"><span class="intake-label-text">Your brief</span><p>${esc(intake.brief)}</p></div>` : '';
  return `<section class="panel intake" aria-labelledby="intake-title"><div class="section-head"><h2 id="intake-title">Finish the brief</h2></div>${notice}<form id="intake-form" class="intake-form" novalidate>${brief}<div class="intake-grid">${fields.map(field => intakeFieldHtml(field, values, errors, platforms, state.photo, { currency: projectCurrency(project) })).join('')}</div>${otherList}${error}<div class="intake-foot"><button class="primary" type="submit" ${state.busy || pending ? 'disabled' : ''}>${buttonLabel}</button></div></form></section>`;
}

// ---- Reviews --------------------------------------------------------------

// @module job
const DRAWER_TAB_LABELS = Object.freeze({ output: 'Output', prompt: 'Prompt', trace: 'How it was made', about: 'About' });

export function drawerTabs(file) {
  return file?.made ? ['output', 'prompt', 'trace', 'about'] : ['output', 'about'];
}

export function drawerPrompt(file) {
  const prompt = typeof file?.prompt === 'string' ? file.prompt.trim() : '';
  return prompt ? `<pre class="drawer-prompt">${esc(prompt)}</pre>` : '<p class="muted">No prompt recorded.</p>';
}

const fact = (label, value) => (value ? `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>` : '');

export function drawerMade(file) {
  const made = file?.made;
  if (!made) return '<p class="muted">Nothing recorded.</p>';
  const what = [made.what, made.item, Number(made.version) > 0 ? `Version ${Number(made.version)}` : ''].filter(Boolean).join(' · ');
  const credits = creditNumber(made.credits);
  return `<dl class="drawer-facts">${[
    fact('Made with', esc(made.maker || '')),
    fact('What', esc(what)),
    fact('Settings', esc((made.settings || []).join(' · '))),
    fact('Made from', esc((made.from || []).join(', '))),
    fact('Started', made.startedAt ? esc(time(made.startedAt)) : ''),
    fact('Saved', made.savedAt ? esc(time(made.savedAt)) : ''),
    fact('Credits', credits === null ? '' : esc(creditFigure(credits))),
  ].join('')}</dl>`;
}

export function drawerAbout(item, file) {
  const made = file?.made || null;
  const kind = made?.what || (item?.kind ? artifactKindLabel(item.kind) : item?.mimeType ? humanize(String(item.mimeType).split('/')[0]) : 'Document');
  const version = Number(made?.version) > 0 ? Number(made.version) : item?.version || null;
  const versions = Array.isArray(file?.versions) && file.versions.length > 1
    ? `<ol class="drawer-versions">${file.versions.map(entry => `<li><span>Version ${esc(entry.version)}</span>${entry.savedAt ? `<small>${esc(time(entry.savedAt))}</small>` : ''}</li>`).join('')}</ol>`
    : '';
  return `<dl class="drawer-facts">${fact('Kind', esc(kind))}${fact('Version', version ? esc(version) : '')}${fact('Versions', versions)}</dl>`;
}
const GATE_TITLES = Object.freeze({
  concept: 'Pick a concept',
  storyboard: 'Approve the storyboard',
  price: 'Approve the price',
  sample: 'Approve the sample',
  pictures: 'Approve the pictures',
  clips: 'Approve the video clips',
  cut: 'Approve the rough cut',
  finish: 'Approve the finished video',
  content: 'Approve the final post',
  publish: 'Approve the posting plan',
  campaign_proposal: 'Approve the campaign plan',
  campaign_activation: 'Approve going live',
  findings: 'Approve the report',
});
// What a decision card is about and its version, in the card's header: "Storyboard, version 3". A tap on an older version is refused.
const CARD_NAMES = Object.freeze({ concept: 'Concepts', storyboard: 'Storyboard', price: 'Price', sample: 'Sample', pictures: 'Pictures', clips: 'Video clips', cut: 'Rough cut', finish: 'Finished video', content: 'Final post', publish: 'Posting plan', campaign_proposal: 'Campaign plan', campaign_activation: 'Going live', findings: 'Report' });
export function cardAbout(gate, version, { clip = false } = {}) {
  const name = gate === 'sample' && clip ? 'Test clip' : CARD_NAMES[gate] || humanize(gate);
  const number = Number(version);
  return Number.isInteger(number) && number > 0 ? `${name}, version ${number}` : name;
}
/** What the server says when a tap was on a card that is no longer the latest. */
export const CHANGED_LINE = 'This changed, here is the latest';
/** Whether a refusal says the card changed (the plain line, with or without the older "Declined in chat" lead). */
export const changedRefusal = message => String(message || '').includes(CHANGED_LINE);
const REVIEW_WAITING = Object.freeze({
  preparing: 'The Director is preparing the files.',
  loading: 'Loading this review...',
  syncing: "Waiting for Claude.",
  changed: 'Changed since you saw it. Ask Claude to show it again.',
});
const PLATFORM_NAMES = Object.freeze({ facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X', threads: 'Threads', youtube: 'YouTube' });
const platformName = value => PLATFORM_NAMES[String(value || '').toLowerCase()] || humanize(value);

export function jobView(project, doc) {
  if (!project?.stageSummary || Array.isArray(project.stages)) return project;
  const details = doc && doc.jobId === project.jobId ? doc.details : null;
  if (!details) return { ...project, stages: [], pendingReviews: [], artifacts: [], detailsLoaded: false };
  return {
    ...project,
    intake: details.intake ?? null,
    pendingReviews: details.pendingReviews || [],
    stages: details.stages || [],
    artifacts: details.artifacts || [],
    artifactsOmitted: details.artifactsOmitted || 0,
    metrics: details.metrics || {},
    brandProfile: details.brandProfile || null,
    usage: { ...(project.usage || {}), stages: details.usageStages || [] },
    detailsLoaded: true,
  };
}

export function stageProgress(project) {
  // The list the page draws is the one it counts, so the head and the steps never count two different lists; a card whose list is not loaded yet uses its summary.
  const stages = Array.isArray(project?.stages) ? project.stages : [];
  if (!stages.length && project?.stageSummary) return { done: project.stageSummary.done || 0, total: project.stageSummary.total || 0 };
  return { done: stages.filter(stage => typeof stage !== 'string' && stage.status === 'complete').length, total: stages.length };
}

export function jobLoadingLine(state = 'loading') {
  return `<p class="muted job-loading" role="status">${esc(state === 'loading' ? 'Loading this job...' : TXT_WAITING_FOR_CLAUDE_2)}</p>`;
}

/** The review the job waits on, from the projection. */
export function pendingReview(project) {
  return (project?.pendingReviews || [])[0] || null;
}

/**
 * Whether the job document can drive the review: 'ready', or why not
 * ('preparing' before files are registered, 'loading' while the document is
 * being read, 'syncing' when it is missing or older than the projection,
 * 'changed' when a file changed after it was presented).
 */
export function reviewStatus(project, doc, docState = 'loaded') {
  const review = pendingReview(project);
  if (!review?.artifacts?.length) return 'preparing';
  if (!doc) return docState === 'loading' ? 'loading' : 'syncing';
  const shown = doc.review;
  if (doc.revision !== project.revision || !shown || shown.gate !== review.gate || !shown.current) return 'syncing';
  const want = review.artifacts.map(item => item.path).sort().join('\n');
  const have = [...(shown.paths || [])].sort().join('\n');
  if (want !== have || (shown.gate === 'findings' && !doc.report)) return 'syncing';
  const registered = new Map(review.artifacts.map(item => [item.path, item.sha256]));
  const parsed = [shown.concepts, ...(shown.storyboards || []), ...(shown.posts || []), shown.quote, shown.sample, shown.gate === 'findings' ? doc.report : null].filter(Boolean);
  if (parsed.some(item => item.changed || (item.sha256 && registered.get(item.path) !== item.sha256))) return 'changed';
  if ((doc.files || []).some(file => registered.has(file.path) && (file.changed || (file.sha256 && file.sha256 !== registered.get(file.path))))) return 'changed';
  return 'ready';
}

/** The credits a concept approval allows: its own quote, else the file's quote, else 0. */
export function conceptCredits(concepts, concept) {
  if (Number.isInteger(concept?.credits)) return concept.credits;
  if (Number.isInteger(concepts?.creditsQuoted)) return concepts.creditsQuoted;
  return 0;
}

const PRICE_PROVIDERS = Object.freeze(['threeEcho', 'elevenLabs']);
const PRICE_TOTAL_LABELS = Object.freeze({ threeEcho: 'Studio credits', elevenLabs: 'Voice credits' });
const PRICE_WORDS = Object.freeze({ threeEcho: ['Studio credit', 'Studio credits'], elevenLabs: ['voice credit', 'voice credits'] });
const PRICE_PROVIDER_NAMES = Object.freeze({ threeEcho: 'Studio', elevenLabs: 'Voice' });
const QUOTE_KIND_LABELS = Object.freeze({ image: 'Image', video: 'Video clip', voice: 'Voice-over', music: 'Music' });

export function priceWords(totals) {
  return PRICE_PROVIDERS.map(provider => {
    const value = creditNumber(totals?.[provider]) || 0;
    return value > 0 ? `${creditFigure(value)} ${PRICE_WORDS[provider][value === 1 ? 0 : 1]}` : '';
  }).filter(Boolean).join(' and ');
}

export function priceTotals(quote) {
  if (!quote?.items?.length || quote.items.some(item => creditNumber(item?.credits) === null)) return null;
  return Object.fromEntries(PRICE_PROVIDERS.map(provider => [provider, creditNumber(quote.totals?.[provider]) || 0]));
}

// A concept's "Insight it rests on" field names the research file and heading it
// came from, e.g. `research/audience.md#what-we-found`: useful provenance, but a
// raw path in code style means nothing to someone picking a concept. Turn it into
// a readable label instead: the file's own name and folder, humanised, then the
// heading it points at. Returns null when the value is not a file reference.
function humanizeSourceRef(value) {
  const match = /`?\s*([\w./-]+)\.(?:md|json|jsonl)(?:#([\w-]+))?\s*`?/i.exec(String(value || ''));
  if (!match) return null;
  const segments = match[1].split('/').filter(Boolean);
  const file = segments.pop();
  const folder = segments.pop();
  if (!file) return null;
  const label = folder ? `${humanize(file)} ${folder.toLowerCase()}` : humanize(file);
  const anchor = match[2] ? humanize(match[2]) : '';
  return anchor ? `${label} · ${anchor}` : label;
}

const FILE_STEM_LABELS = Object.freeze({
  manifest: 'Media plan',
  'generation-manifest': 'Media plan',
  'generation_manifest': 'Media plan',
  quote: 'Price list',
  estimate: 'Price list',
  estimates: 'Price list',
  research: 'Research notes',
  'label-check': 'Label check',
});
function fileStemLabel(base) {
  return FILE_STEM_LABELS[base.toLowerCase()] || humanize(base);
}
function humanizeFileLabel(path) {
  const segments = String(path || '').split(/[\\/]/).filter(Boolean);
  const file = segments.pop() || '';
  const folder = segments.pop() || '';
  const base = file.replace(/\.[a-z0-9]{1,5}$/i, '');
  if (!base) return '';
  if (!folder) return fileStemLabel(base);
  const folderLabel = /^[A-Za-z]\d{1,3}$/.test(folder) ? folder.toUpperCase() : folder.toLowerCase();
  return `${fileStemLabel(base)} ${folderLabel}`;
}
const FILE_EXTENSION = /\.[a-z0-9]{1,5}$/i;
function displayTitle(item, fallback = 'Project output') {
  const given = String(item?.title || item?.name || '').trim();
  if (given && !FILE_EXTENSION.test(given)) return given;
  return humanizeFileLabel(item?.path || given) || fallback;
}
const ARTIFACT_KIND_LABELS = Object.freeze({
  approval: 'Approval', media: 'Media', draft: 'Draft', research: 'Research',
  validation: 'Check', delivery: 'Delivery', update: 'Update', revision: 'Update', campaign: 'Campaign', file: 'Document', artifact: 'Document',
});
function artifactKindLabel(kind) {
  if (!kind) return 'Project output';
  return ARTIFACT_KIND_LABELS[kind] || humanize(kind);
}

// A concept's "Hook options" field, "1) line 2) line 3) line" or one per line, as a list of lines.
export function hookOptionsOf(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const numbered = text.split(/(?:^|\s|\n)\d[).]\s+/).map(part => part.trim().replace(/^["\u201c]|["\u201d]$/g, '').trim()).filter(Boolean);
  const lines = numbered.length > 1 ? numbered : text.split(/\n+/).map(part => part.replace(/^[-*\d).\s]+/, '').trim()).filter(Boolean);
  return lines.slice(0, 6);
}

// Where a concept's idea comes from: its "Source:" field, said as "from the brand", "from top competitors" or "from what's
// trending", plus whatever evidence follows it. null when the concept has no source (an older concepts.md).
const CONCEPT_SOURCE_WORDS = Object.freeze({ brand: 'From the brand', competitors: 'From top competitors', trending: "From what's trending" });
function conceptSourceKind(text) {
  if (/competitor/i.test(text)) return 'competitors';
  if (/trend|rising|viral/i.test(text)) return 'trending';
  if (/\b(brand|own|bank|proven|yours?)\b/i.test(text)) return 'brand';
  return null;
}
export function conceptSourceOf(concept) {
  const field = (concept?.fields || []).find(item => /^sources?$/i.test(String(item?.label || '').trim()));
  const text = String(field?.value || '').trim();
  if (!text) return null;
  const cut = /\s*(?:[,;:\n]|\s[-\u2013\u2014]\s|\s\(|\swith\b)/.exec(text);
  const head = (cut ? text.slice(0, cut.index) : text).trim();
  let detail = text.slice(head.length).replace(/^[\s,;:\u2013\u2014-]+/, '').replace(/^with\s+/i, '').trim();
  if (detail.startsWith('(') && detail.endsWith(')') && !detail.slice(1, -1).includes('(')) detail = detail.slice(1, -1).trim();
  const kind = conceptSourceKind(head) || (head.length > 40 ? conceptSourceKind(text) : null);
  if (kind) return { kind, label: CONCEPT_SOURCE_WORDS[kind], detail };
  // A source this board has no word for is shown as written, when it is short enough to be a label.
  return head && head.length <= 32 ? { kind: 'other', label: head[0].toUpperCase() + head.slice(1), detail } : null;
}
// conceptProofOf(text): turn free-text research evidence into up to 6 "proof tile" items.
// Approach: every URL anchors an item. Text between two URLs is cut at the first ")" or ";"
// (else after the last ", "), so a URL owns the data that trails it and the remainder is the
// next URL's lead-in (after its last ")"). Closed "(...)" groups left over that still carry a
// count / lift / days become URL-less items. Fields are read by regex from the item's own zone
// only (quotes, URLs and bank ids removed first), so nothing is invented.
const URL_RE = /https?:\/\/[^\s)\]>"'<“”]+/g;
const MD_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const ID_RE = /\b(?:ip|p|t)-[0-9a-f]{6,}\b/gi;
const QUOTE_RE = /["“]([^"”]+)["”]/;
const COUNT_RE = /(\d[\d,]*(?:\.\d+)?)\s*([kmb])?\s*(views?|plays?|likes?)\b/i;
const LIFT_RE = /(?<![\w.])(\d+(?:\.\d+)?)\s*[x×](?![A-Za-z0-9])/i;
const DAYS_RE = /running\s+(?:for\s+)?(\d+)\s*days?|(\d+)\s*days?\s+(?:running|live)/i;
const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const NAMES = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook', 'meta-ad': 'Meta ad', web: 'Web' };
const MULT = { k: 1e3, m: 1e6, b: 1e9 };

function platformOf(u) {
  if (/facebook\.com\/ads\/library/i.test(u)) return 'meta-ad';
  if (/tiktok\.com/i.test(u)) return 'tiktok';
  if (/instagram\.com|instagr\.am/i.test(u)) return 'instagram';
  if (/youtube\.com|youtu\.be/i.test(u)) return 'youtube';
  if (/facebook\.com|fb\.watch|fb\.com/i.test(u)) return 'facebook';
  return 'web';
}

function platformFromWords(t) {
  const hits = [['tiktok', /tiktok/i], ['instagram', /instagram|\breels?\b/i], ['youtube', /youtube|\bshorts\b/i],
    ['meta-ad', /meta ads?\b/i], ['facebook', /facebook/i]]
    .map(([p, re]) => [p, t.search(re)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]);
  return hits.length ? hits[0][0] : 'web';
}

function cutPoint(s, from, to, last) {
  const gap = s.slice(from, to);
  const m = gap.search(/[;)\n]/);
  if (m >= 0) return from + m + (gap[m] === ")" ? 1 : 0);
  if (last) return to;
  const commas = [...gap.matchAll(/,\s+/g)];
  const c = commas[commas.length - 1];
  return c ? from + c.index + c[0].length : from;
}

function pickDate(z) {
  const since = z.match(/since\s+(\d{4}-\d{2}-\d{2})/i);
  const ok = (y, mo, d) => +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31;
  if (since && ok(...since[1].split('-'))) return since[1];
  for (const m of z.matchAll(DATE_RE)) {
    if (/(seen|as of|checked|captured)\s*(on\s*)?$/i.test(z.slice(Math.max(0, m.index - 14), m.index))) continue;
    if (ok(m[1], m[2], m[3])) return m[0];
  }
  return null;
}

function labelOf(body, head, platform) {
  const q = body.match(QUOTE_RE);
  let t = q ? q[1] : head.split(/[;:]/).pop().split(/,\s+/).pop();
  t = t.replace(ID_RE, '').replace(/\s+/g, ' ').trim();
  if (!q) t = t.replace(/^[\s\-*•–—.,]+/, '').replace(/^(?:and|or|plus)\s+/i, '').replace(/[\s,;:.\-–—]+$/, '');
  if (!/[A-Za-z]{3}/.test(t)) t = NAMES[platform];
  return t.length > 70 ? t.slice(0, 69).trimEnd() + '…' : t;
}

function makeItem(head, body, url) {
  const z = body.replace(new RegExp(QUOTE_RE.source, 'g'), ' ').replace(URL_RE, ' ').replace(ID_RE, ' ');
  const c = z.match(COUNT_RE), l = z.match(LIFT_RE), d = z.match(DAYS_RE);
  if (!url && !c && !l && !d) return null;
  const platform = url ? platformOf(url) : platformFromWords(body);
  let liftLabel = null;
  if (l) {
    const after = z.slice(l.index + l[0].length, l.index + l[0].length + 40).split(/[;,()]/)[0];
    const who = after.trim().split(/\s+/)[0].toLowerCase();
    if (/\bmedian\b/i.test(after)) liftLabel = 'median';
    else if (/\busual\b/i.test(after)) liftLabel = ['his', 'her', 'their'].includes(who) ? `${who} usual` : 'usual';
  }
  return {
    platform, url: url || null,
    count: c ? Math.round(parseFloat(c[1].replace(/,/g, '')) * (MULT[(c[2] || '').toLowerCase()] || 1)) : null,
    unit: c ? { v: 'views', p: 'plays', l: 'likes' }[c[3][0].toLowerCase()] : null,
    lift: l ? parseFloat(l[1]) : null, liftLabel: l ? liftLabel : null,
    date: pickDate(z), daysRunning: d ? +(d[1] || d[2]) : null,
    label: labelOf(body, head, platform),
  };
}

export function conceptProofOf(text) {
  try {
    if (typeof text !== 'string' || !text.trim()) return [];
    const s = text.replace(MD_LINK, '$1 $2 ');
    const urls = [...s.matchAll(URL_RE)].map((m) => ({ url: m[0].replace(/[.,;:!?]+$/, ''), start: m.index, end: m.index + m[0].length }));
    const out = [];
    const leftovers = (chunk, offset) => {
      let p = offset;
      for (const piece of chunk.match(/[^)]*\)|[^)]+$/g) || []) {
        const item = makeItem(piece.split('(')[0], piece, null);
        if (item) out.push({ pos: p, item });
        p += piece.length;
      }
    };
    let from = 0;
    urls.forEach((u, i) => {
      const before = s.slice(from, u.start);
      const lp = before.lastIndexOf(')') + 1; // closed groups before this URL are URL-less candidates
      leftovers(before.slice(0, lp), from);
      const preStart = from + lp;
      const last = i === urls.length - 1;
      const cut = cutPoint(s, u.end, last ? s.length : urls[i + 1].start, last);
      const lead = s.slice(preStart, u.start);
      const head = lead.includes('(') ? lead.slice(0, lead.lastIndexOf('(')) : lead;
      out.push({ pos: u.start, item: makeItem(head, s.slice(preStart, cut), u.url) });
      from = cut;
    });
    leftovers(s.slice(from), from);
    return out.sort((a, b) => a.pos - b.pos).slice(0, 6).map((o) => o.item);
  } catch {
    return [];
  }
}

// The strategy summary at the top of concepts.md, above the first concept: one `Label: value` line each (industry, viewer
// problem, ad style...). A parsed document that already carries it (`concepts.summary`) is used as it is; for one that does not,
// the lines are read from the concepts file's own text, so an older document still shows it. [] when there are none.
const SUMMARY_LIMIT = 14;
export function strategySummaryOf(text) {
  const out = [];
  // Everything above the first "## Concept A" heading is the strategy, whatever its sections are called, except the ask.
  let inSummary = true;
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n')) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const title = heading[1].trim();
      if (/^Concept\s+[A-Za-z0-9]{1,8}\b/i.test(title)) break;
      inSummary = !/^what\s+you(?:'|\u2019)?re\s+deciding\b/i.test(title);
      continue;
    }
    if (!inSummary || !line || /^[-*_]{3,}$/.test(line)) continue;
    const bullet = line.replace(/^[-*+]\s+/, '');
    const match = /^\*\*(.{1,60}?)\*\*\s*:\s*(.+)$/.exec(bullet) || /^\*\*(.{1,60}?):\*\*\s*(.+)$/.exec(bullet) || /^([A-Za-z][^:*`|]{0,58}?):\s+(.+)$/.exec(bullet);
    const label = match ? match[1].replace(/[*`]/g, '').trim() : '';
    if (match && label && label.split(/\s+/).length <= 6) {
      if (out.length < SUMMARY_LIMIT) out.push({ label, value: match[2].trim().slice(0, 400) });
    } else if (/^\s+\S/.test(raw) && out.length) {
      // A wrapped or nested line belongs to the line above it.
      const last = out[out.length - 1];
      last.value = `${last.value}${/^\s*[-*+]\s/.test(raw) ? '\n' : ' '}${bullet}`.slice(0, 400);
    }
  }
  return out;
}
export function conceptSummaryOf(concepts, doc = null) {
  const given = concepts?.summary;
  const entries = Array.isArray(given) ? given : typeof given === 'string' ? given.split('\n') : null;
  if (entries) {
    const rows = entries.map(item => {
      if (typeof item === 'string') return strategySummaryOf(`# Strategy\n${item}`)[0] || null;
      const label = trimmed(item?.label);
      const value = trimmed(item?.value ?? item?.text);
      return label && value ? { label, value } : null;
    }).filter(Boolean);
    if (rows.length) return rows.slice(0, SUMMARY_LIMIT);
  }
  const file = (doc?.files || []).find(item => item?.path && item.path === concepts?.path);
  return typeof file?.text === 'string' ? strategySummaryOf(file.text) : [];
}
// The strategy the three concepts share, said at a glance: the topic as a headline with the message under it, three tiles (who
// it is for, their problem, the call to action), short tags for the rest, and every line in full behind "View full strategy".
// `extra` (the Industry row, when the document offers one) sits under it, or stands alone when there is no summary. The row says
// the industry as it stands, so the summary's own Industry line gives way to it.
const STRATEGY_ROLE = Object.freeze([
  ['topic', /^(?:topic|subject)\b/i],
  ['message', /^(?:message|core message|key message)\b/i],
  ['ownWords', /^(?:viewer\s+)?problem.*own words|own words/i],
  ['problem', /^(?:viewer\s+problem|problem|pain)\b/i],
  ['audience', /^(?:audience|who it'?s for|viewer|target)\b/i],
  ['cta', /^(?:cta|call to action)\b/i],
  ['stage', /^(?:awareness|viewer)\s*stage\b/i],
  ['funnel', /^funnel/i],
  ['voice', /^(?:voice|tone)\b/i],
  ['reference', /^reference\b/i],
]);
const STRATEGY_TAG_WORDS = Object.freeze({ stage: 'Viewer stage', funnel: 'Funnel', voice: 'Voice', reference: 'Reference' });
const STRATEGY_ICON = Object.freeze({
  audience: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>',
  problem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
  cta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
});
const STRATEGY_TILE_WORDS = Object.freeze({ audience: "Who it's for", problem: 'Their problem', cta: "Call to action" });
/** The first clause of a strategy line, plain and capitalised, cut to `limit` characters on a word. */
export function strategyShort(value, limit = 70, { clause = true } = {}) {
  let text = String(value ?? '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  const cut = text.search(/\s\(|;|\s[-–—]\s|:\s|,\s(?:with|because|then|said|and then)\b/);
  if (clause && cut > 3) text = text.slice(0, cut);
  text = text.replace(/[.,;:\s]+$/, '').replace(/^["“](.*)["”]$/, '$1');
  if (text.length > limit) text = `${text.slice(0, limit).replace(/\s+\S*$/, '')}…`;
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}
export function conceptStrategy(summary, extra = '', { openKeys = new Set() } = {}) {
  const rows = (Array.isArray(summary) ? summary : []).filter(item => item?.label && item?.value && !(extra && /^industry$/i.test(String(item.label).trim())));
  if (!rows.length) return extra ? `<section class="concept-strategy is-picks-only" aria-label="Industry">${extra}</section>` : '';
  const role = new Map();
  for (const row of rows) {
    const found = STRATEGY_ROLE.find(([, test]) => test.test(String(row.label).trim()));
    if (found && !role.has(found[0])) role.set(found[0], row);
  }
  // The problem in the audience's own words belongs under the problem, never as a second problem.
  if (!role.has('problem') && role.has('ownWords')) role.set('problem', role.get('ownWords'));
  const used = new Set(role.values());
  const topic = role.get('topic');
  const message = role.get('message');
  const head = topic || message
    ? `<div class="cs-top"><h3 class="cs-eyebrow" id="concept-strategy-title">The plan all three concepts share</h3>${topic ? `<p class="cs-topic">${esc(strategyShort(topic.value, 110, { clause: false }))}</p>` : ''}${message ? `<q class="cs-message">${esc(strategyShort(message.value, 200, { clause: false }).replace(/^["“]|["”]$/g, ''))}</q>` : ''}</div>`
    : '<div class="cs-top"><h3 class="cs-eyebrow" id="concept-strategy-title">The plan all three concepts share</h3></div>';
  let tiles = ['audience', 'problem', 'cta'].filter(key => role.has(key)).map(key => ({ key, row: role.get(key) }));
  // A summary that names none of those still shows its first lines as tiles, so the glance view is never empty.
  if (tiles.length < 2) tiles = tiles.concat(rows.filter(row => !used.has(row) && !tiles.some(tile => tile.row === row)).slice(0, 3 - tiles.length).map(row => ({ key: 'other', row })));
  const tileHtml = tiles.map(({ key, row }) => `<div class="cs-tile"><span class="cs-tile-icon" aria-hidden="true">${STRATEGY_ICON[key] || STRATEGY_ICON.other}</span><span class="cs-tile-text"><span class="cs-tile-k">${esc(STRATEGY_TILE_WORDS[key] || row.label)}</span><b>${esc(strategyShort(row.value))}</b></span></div>`).join('');
  const tags = Object.keys(STRATEGY_TAG_WORDS).filter(key => role.has(key)).map(key => `<span class="cs-tag"><span>${esc(STRATEGY_TAG_WORDS[key])}</span>${esc(/^no\b/i.test(String(role.get(key).value).trim()) ? 'None' : strategyShort(role.get(key).value, 34))}</span>`).join('');
  const ownWords = role.get('ownWords');
  const full = rows.filter(row => row !== ownWords || role.get('problem') === ownWords).map(row => {
    const under = row === role.get('problem') && ownWords && ownWords !== row ? `<small>In their own words: ${inlineMarkdown(ownWords.value)}</small>` : '';
    return `<div class="strategy-fact"><dt>${esc(row.label)}</dt><dd${/\n/.test(row.value) ? ' class="lines"' : ''}>${inlineMarkdown(row.value)}${under}</dd></div>`;
  }).join('');
  const key = 'concept-strategy:full';
  return `<section class="concept-strategy" aria-labelledby="concept-strategy-title">${head}${tileHtml ? `<div class="cs-tiles">${tileHtml}</div>` : ''}${tags ? `<div class="cs-tags">${tags}</div>` : ''}<details class="cs-more" data-open-key="${key}"${openKeys.has(key) ? ' open' : ''}><summary>View full strategy</summary><dl class="strategy-facts">${full}</dl></details>${extra}</section>`;
}

// @module picks
// Opening lines. A concept offers the lines its "Hook options" field lists; the person may also edit any of them or add their own.
// Those stay in the review's UI state (`own`: the added lines per concept, `edited`: the new text per concept and listed line) and
// are not saved by the board: the approval carries them in its note (see decisionArgs) and Claude files them.
export const HOOK_LINE_LIMIT = 120;
export const HOOK_OWN_LIMIT = 5;
const PENCIL = '<svg class="i" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
/** A line as it is kept: one physical line, no control characters, no doubled spaces. */
export const cleanHookLine = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
// Inside the note the line sits between straight quotes, so a straight quote in the line itself is written as a closing curly one.
const noteLine = value => cleanHookLine(value).replace(/"/g, '\u201d');

/** A concept's opening lines in the order shown: the listed ones (with the person's edits in place), then the lines they added. */
export function hookLinesOf(concept, { own = {}, edited = {} } = {}) {
  const field = (concept?.fields || []).find(item => /^hook options/i.test(item?.label || ''));
  const base = hookOptionsOf(field?.value);
  const edits = edited?.[concept?.id] && typeof edited[concept.id] === 'object' ? edited[concept.id] : {};
  const mine = Array.isArray(own?.[concept?.id]) ? own[concept.id] : [];
  const lines = base.map((text, at) => {
    const now = typeof edits[at] === 'string' ? cleanHookLine(edits[at]) : '';
    return now && now !== text ? { text: now, was: text, edited: true, base: at } : { text, base: at };
  });
  mine.forEach((text, at) => lines.push({ text: cleanHookLine(text), own: true, mine: at }));
  return { field, lines };
}

/**
 * Save what was typed in the opening-line box (state.hookEdit: { id, at, text }, where `at` is 'new' or the index of the line
 * edited) into the review state: an added line goes to ownLines, a changed listed line to editedLines (typing the listed text back
 * undoes the edit), and the line becomes the pick for its concept, which becomes the choice. A line the card already offers is
 * picked, not kept twice. Returns { pick } or { error } (the state is then left as it was).
 */
export function applyHookEdit(state, concept) {
  const edit = state?.hookEdit;
  if (!edit || !concept || concept.id !== edit.id) return { error: TXT_NOTHING_TO_SAVE };
  const text = cleanHookLine(edit.text);
  if (!text) return { error: 'Type your opening line first.' };
  if (text.length > HOOK_LINE_LIMIT) return { error: `Keep it to ${HOOK_LINE_LIMIT} characters or fewer.` };
  const { lines } = hookLinesOf(concept, { own: state.ownLines, edited: state.editedLines });
  if (edit.at === 'new' && (state.ownLines?.[edit.id] || []).length >= HOOK_OWN_LIMIT) return { error: `Limit reached (${HOOK_OWN_LIMIT}).` };
  if (edit.at !== 'new' && !lines[edit.at]) return { error: 'That line is no longer here.' };
  const same = lines.findIndex((line, at) => at !== edit.at && line.text.toLowerCase() === text.toLowerCase());
  let pick = same;
  if (same < 0 && edit.at === 'new') {
    state.ownLines = { ...(state.ownLines || {}), [edit.id]: [...(state.ownLines?.[edit.id] || []), text] };
    pick = lines.length;
  } else if (same < 0) {
    const line = lines[edit.at];
    if (line.own) {
      state.ownLines = { ...(state.ownLines || {}), [edit.id]: state.ownLines[edit.id].map((item, at) => (at === line.mine ? text : item)) };
    } else {
      const original = line.edited ? line.was : line.text;
      const edits = { ...(state.editedLines?.[edit.id] || {}) };
      if (text === original) delete edits[line.base]; else edits[line.base] = text;
      state.editedLines = { ...(state.editedLines || {}), [edit.id]: edits };
    }
    pick = edit.at;
  }
  state.hooks = { ...(state.hooks || {}), [edit.id]: pick };
  state.choice = edit.id;
  state.error = '';
  state.hookEdit = null;
  return { pick };
}

/** Take the line being edited back: an added line is removed, an edited listed line goes back to the one the card listed. */
export function dropHookEdit(state, concept) {
  const edit = state?.hookEdit;
  if (!edit || !concept || concept.id !== edit.id || edit.at === 'new') return false;
  const line = hookLinesOf(concept, { own: state.ownLines, edited: state.editedLines }).lines[edit.at];
  if (line?.own) {
    state.ownLines = { ...state.ownLines, [edit.id]: state.ownLines[edit.id].filter((_, at) => at !== line.mine) };
    const picked = state.hooks?.[edit.id];
    if (Number.isInteger(picked) && picked >= edit.at) state.hooks = { ...state.hooks, [edit.id]: picked === edit.at ? 0 : picked - 1 };
  } else if (line?.edited) {
    state.editedLines = { ...state.editedLines, [edit.id]: Object.fromEntries(Object.entries(state.editedLines?.[edit.id] || {}).filter(([at]) => Number(at) !== line.base)) };
  }
  state.hookEdit = null;
  return true;
}

function hookEditForm(id, at, edit, label, drop = '') {
  const key = `${id}:${at}`;
  const errorId = `hook-error-${id}`;
  const problem = edit.error ? `<span class="field-error" id="${errorId}" role="alert">${esc(edit.error)}</span>` : '';
  return `<span class="hook-form"><input type="text" class="hook-input" name="hook_edit_${esc(id)}" data-hook-input="${esc(key)}" value="${esc(edit.text || '')}" maxlength="${HOOK_LINE_LIMIT}" autocomplete="off" enterkeyhint="done" aria-label="${esc(label)}"${edit.error ? ` aria-invalid="true" aria-describedby="${errorId}"` : ''}><span class="hook-form-actions"><button type="button" class="hook-save" data-hook-save="${esc(key)}">Save</button><button type="button" class="quiet" data-hook-cancel="${esc(key)}">Cancel</button>${drop ? `<button type="button" class="quiet hook-drop" data-hook-drop="${esc(key)}">${esc(drop)}</button>` : ''}</span>${problem}</span>`;
}

function hookPicks(concept, field, { hooks, own, edited, edit, disabled }) {
  const { lines } = hookLinesOf(concept, { own, edited });
  const id = concept.id;
  const picked = Number.isInteger(hooks?.[id]) && lines[hooks[id]] ? hooks[id] : 0;
  const editing = edit && edit.id === id ? edit : null;
  const rows = lines.map((line, at) => {
    if (editing && editing.at === at) return hookEditForm(id, at, editing, `Edit opening line ${at + 1} for concept ${id}`, line.own ? 'Remove this line' : line.edited ? 'Use the original' : '');
    const tag = line.own ? '<span class="hook-tag">yours</span>' : line.edited ? '<span class="hook-tag" title="You edited this line">yours<span class="visually-hidden"> (edited)</span></span>' : '';
    const radio = `<label class="hook-pick"><input type="radio" name="hook_choice_${esc(id)}" value="${at}" ${picked === at ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="hook-text">${esc(line.text)}</span>${tag}</label>`;
    return `<span class="hook-line">${radio}<button type="button" class="hook-edit" data-hook-edit="${esc(`${id}:${at}`)}" aria-label="${esc(`Edit this opening line: ${line.text}`)}" title="Edit this line" ${disabled ? 'disabled' : ''}>${PENCIL}</button></span>`;
  }).join('');
  const room = (Array.isArray(own?.[id]) ? own[id].length : 0) < HOOK_OWN_LIMIT;
  const adder = editing && editing.at === 'new'
    ? hookEditForm(id, 'new', editing, `Your own opening line for concept ${id}`)
    : room ? `<button type="button" class="hook-add" data-hook-add="${esc(id)}" aria-label="${esc(`Add your own opening line for concept ${id}`)}" ${disabled ? 'disabled' : ''}>+ Add your own opening line</button>` : '';
  return `<div><dt>${esc(field?.label || 'Opening lines')}</dt><dd><span class="hook-picks" role="group" aria-label="${esc(`Opening lines for concept ${id}`)}">${rows}</span>${adder}</dd></div>`;
}

// Strategy picks. A concepts review may carry `strategyOptions` (the lists of playbook options and the brand's own, with the marks
// the ranking gave them): each concept then shows rows for its Funnel stage, Ad style, Format and Call to action, and the job shows
// an Industry row. A row is a radio group of chips with the concept's own value (`concept.picks`, `strategyOptions.industryPick`)
// chosen to begin with; the person may pick another chip or add their own. What they pick and add stays in the review state
// (strategyPicks: the option picked per row, strategyOwn: the texts added per row, strategyEdit: the box being typed in; a row is
// "industry" or "<concept id>:<field>") and is not saved by the board: the approval carries it in its note (see decisionArgs) and
// Claude files it.
export const PICK_TEXT_LIMIT = 60;
export const PICK_OWN_LIMIT = 5;
// Problem and Angle are the bank's pains and angles (the brand's banks), whole sentences, so the person may type as much as the note carries.
const PICK_ROWS = Object.freeze([
  { field: 'industry', title: 'Industry', noun: 'industry', picked: 'Industry', own: 'industry' },
  { field: 'funnel', title: 'Funnel stage', noun: 'funnel stage', picked: 'Funnel stage', own: 'funnel stage' },
  { field: 'style', title: 'Ad style', noun: 'ad style', picked: 'Ad style', own: 'ad style' },
  { field: 'format', title: 'Format', noun: 'format', picked: 'Format', own: 'format' },
  { field: 'cta', title: "Call to action", noun: 'call to action', picked: 'CTA', own: 'CTA' },
  { field: 'pain', title: 'Problem', noun: 'problem', picked: 'Problem', own: 'problem', limit: HOOK_LINE_LIMIT },
  { field: 'angle', title: 'Angle', noun: 'angle', picked: 'Angle', own: 'angle', limit: HOOK_LINE_LIMIT },
  { field: 'subtopic', title: 'Subtopic', noun: 'subtopic', picked: 'Subtopic', own: 'subtopic' },
  { field: 'editing', title: 'Editing style', noun: 'editing style', picked: 'Editing', own: 'editing' },
  { field: 'visualHook', title: 'Visual hook', noun: 'visual hook', picked: 'Visual hook', own: 'visual hook' },
].map(row => Object.freeze(row)));
const PICK_ROW_OF = Object.freeze(Object.fromEntries(PICK_ROWS.map(row => [row.field, row])));
const CONCEPT_PICK_FIELDS = Object.freeze(['funnel', 'style', 'format', 'cta', 'pain', 'angle', 'subtopic', 'editing', 'visualHook']);
const pickLimit = field => PICK_ROW_OF[field]?.limit ?? PICK_TEXT_LIMIT;
// How a concept's own fields name the rows (as the concepts template writes them, and as the server matches them to a default).
const PICK_FIELD_LABELS = Object.freeze({
  funnel: /^(?:awareness|funnel)[\s_-]*stage\b/i,
  style: /^ad[\s_-]*style\b/i,
  format: /^(?:visual[\s_-]*)?format\b/i,
  cta: /^(?:cta\b|call[\s_-]*to[\s_-]*action\b)/i,
  pain: /^(?:anchor|viewer[\s_-]*problem)\b/i,
  angle: /^angle\b/i,
  subtopic: /^sub[\s_-]*topic\b/i,
  editing: /^editing(?:[\s_-]*style)?\b/i,
  visualHook: /^visual[\s_-]*hook\b/i,
});
export const pickRowKey =(conceptId, field) => (field === 'industry' ? 'industry' : `${conceptId}:${field}`);
/** The concept and field a row key names (the industry row belongs to the job, so its id is null), or null for anything else. */
export function pickRowParts(rowKey) {
  const key = String(rowKey ?? '');
  if (key === 'industry') return { id: null, field: 'industry' };
  const cut = key.lastIndexOf(':');
  const field = key.slice(cut + 1);
  return cut > 0 && CONCEPT_PICK_FIELDS.includes(field) ? { id: key.slice(0, cut), field } : null;
}
const ownPickId = text => `own:${cleanHookLine(text).toLowerCase()}`;
// A playbook option's text is "<id> <Name>" ("AS-PROBLEM-SOLUTION Problem solution"): the chip shows the name, the full text stays in its
// tooltip and in the note, so the agents get the exact playbook row. Text that does not start with the option's own id is shown as it is.
const pickShown = option => (option.text.length > option.id.length + 1 && option.text.startsWith(`${option.id} `) ? option.text.slice(option.id.length + 1).trim() : option.text);
const pickFallback =(options, field, concept) => (field === 'industry' ? options?.industryPick : concept?.picks?.[field]);

/** The lists of options a concepts review offers, or null when the document has none (an older job): the card then has no rows. */
export function strategyOptionsOf(doc) {
  const given = doc?.strategyOptions ?? doc?.review?.strategyOptions ?? doc?.review?.concepts?.strategyOptions;
  return given && typeof given === 'object' && !Array.isArray(given) ? given : null;
}

/** One list as drawn: an id and a short text per option, with the "yours" and winner, weak or early marks it came with. */
function pickOptionsList(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const list = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const id = trimmed(item.id);
    const text = cleanHookLine(item.text);
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    list.push({ id, text, ...(item.yours === true ? { yours: true } : {}), ...(Object.prototype.hasOwnProperty.call(RESULT_PILLS, item.label) ? { label: item.label } : {}), ...(Number.isFinite(item.count) && item.count > 1 ? { count: Math.floor(item.count) } : {}), ...(trimmed(item.hint) ? { hint: trimmed(item.hint) } : {}) });
  }
  return list;
}

/**
 * A row as it stands: the listed options followed by the ones the person added, the option picked (theirs when it is still there,
 * else the default the document gave, else none) and the texts they added. Null when the document has no list for this field.
 */
function pickRowOf(options, field, rowKey, fallbackId, { chosen, added } = {}) {
  const listed = pickOptionsList(options?.[field]);
  if (!listed) return null;
  const mine = (Array.isArray(added?.[rowKey]) ? added[rowKey] : []).map(cleanHookLine).filter(Boolean);
  const all = [...listed];
  for (const text of mine) {
    const id = ownPickId(text);
    if (!all.some(item => item.id === id)) all.push({ id, text, yours: true, added: true });
  }
  const has = id => typeof id === 'string' && all.some(item => item.id === id);
  const fallback = has(fallbackId) ? fallbackId : null;
  const made = chosen && Object.prototype.hasOwnProperty.call(chosen, rowKey) ? chosen[rowKey] : undefined;
  return { field, rowKey, options: all, picked: has(made) ? made : fallback, fallback, mine, room: mine.length < PICK_OWN_LIMIT };
}

/**
 * Save what was typed in the box of a row (state.strategyEdit: { row, text }) into the review state: a new text goes to strategyOwn,
 * and the option becomes the pick of its row (and, on a concept's row, that concept becomes the choice). An option the row already
 * has is picked, not kept twice. Returns { pick } or { error } (the state is then left as it was).
 */
export function applyPickEdit(state, options, concept = null) {
  const edit = state?.strategyEdit;
  const parts = edit ? pickRowParts(edit.row) : null;
  if (!parts || (parts.id !== null && concept?.id !== parts.id)) return { error: TXT_NOTHING_TO_SAVE };
  const noun = PICK_ROW_OF[parts.field].noun;
  const text = cleanHookLine(edit.text);
  if (!text) return { error: `Type your own ${noun} first.` };
  if (text.length > pickLimit(parts.field)) return { error: `Keep it to ${pickLimit(parts.field)} characters or fewer.` };
  const row = pickRowOf(options, parts.field, edit.row, pickFallback(options, parts.field, concept), { chosen: state.strategyPicks, added: state.strategyOwn });
  if (!row) return { error: 'That row is no longer here.' };
  const same = row.options.find(item => item.text.toLowerCase() === text.toLowerCase() || pickShown(item).toLowerCase() === text.toLowerCase());
  if (!same && !row.room) return { error: `Limit reached (${PICK_OWN_LIMIT}).` };
  if (!same) state.strategyOwn = { ...(state.strategyOwn || {}), [edit.row]: [...row.mine, text] };
  const pick = same ? same.id : ownPickId(text);
  state.strategyPicks = { ...(state.strategyPicks || {}), [edit.row]: pick };
  if (parts.id !== null) state.choice = parts.id;
  state.error = '';
  state.strategyEdit = null;
  return { pick };
}

/**
 * Take back an option the person added to a row in this review (`id` is its option id, "own:<text>"): it leaves strategyOwn, so it is
 * no longer drawn nor sent, and when it was the pick the row goes back to the default. An option the document lists, the brand's saved
 * ones included, is not the board's to remove. Returns whether anything was removed.
 */
export function dropPickOption(state, rowKey, id) {
  const mine = Array.isArray(state?.strategyOwn?.[rowKey]) ? state.strategyOwn[rowKey] : [];
  const kept = mine.filter(text => ownPickId(text) !== id);
  if (kept.length === mine.length) return false;
  const without = (map, key) => Object.fromEntries(Object.entries(map).filter(([name]) => name !== key));
  state.strategyOwn = kept.length ? { ...state.strategyOwn, [rowKey]: kept } : without(state.strategyOwn, rowKey);
  if (state.strategyPicks?.[rowKey] === id) state.strategyPicks = without(state.strategyPicks, rowKey);
  state.error = '';
  return true;
}

/**
 * What a concept's own field row (Awareness stage, Ad style, Visual format, CTA) says once the person has picked something other than
 * the default for it: the pick, so the card never shows two values for one thing. Null while the pick is the default, or for any other field.
 */
function pickFieldNow(concept, field, strategy) {
  const options = strategy?.options;
  const label = String(field?.label || '').trim();
  const key = options ? CONCEPT_PICK_FIELDS.find(name => PICK_FIELD_LABELS[name].test(label)) : null;
  const row = key ? pickRowOf(options, key, pickRowKey(concept.id, key), pickFallback(options, key, concept), strategy) : null;
  const option = row && row.picked !== row.fallback ? row.options.find(item => item.id === row.picked) : null;
  return option ? pickShown(option) : null;
}

/**
 * The lines the approval adds to its note for the concept approved: none when no pick differs from the default and nothing was
 * added; otherwise "Strategy picks: ..." with the five current values (an empty one left out), then one "Your own ..." line per text
 * added on the concept's rows or the industry row. A text sits between straight quotes, as an opening line does.
 */
export function strategyNoteLines(options, concept, { chosen = {}, added = {} } = {}) {
  if (!options || !concept) return [];
  const rows = PICK_ROWS.map(spec => ({ spec, row: pickRowOf(options, spec.field, pickRowKey(concept.id, spec.field), pickFallback(options, spec.field, concept), { chosen, added }) })).filter(item => item.row);
  if (!rows.some(({ row }) => row.picked !== row.fallback || row.mine.length)) return [];
  const say = text => noteLine(text).slice(0, HOOK_LINE_LIMIT);
  const now = rows.map(({ spec, row }) => {
    const option = row.options.find(item => item.id === row.picked);
    return option ? `${spec.picked}: "${say(option.text)}"` : '';
  }).filter(Boolean);
  const lines = now.length ? [`Strategy picks: ${now.join(' · ')}`] : [];
  for (const { spec, row } of rows) for (const text of row.mine) lines.push(`Your own ${spec.own}: "${say(text)}"`);
  return lines;
}

function pickEditForm(rowKey, edit, label, limit = PICK_TEXT_LIMIT) {
  const errorId = `pick-error-${rowKey}`.replace(/\s+/g, '-');
  const problem = edit.error ? `<span class="field-error" id="${esc(errorId)}" role="alert">${esc(edit.error)}</span>` : '';
  return `<span class="hook-form pick-form"><input type="text" class="hook-input" name="pick_edit_${esc(rowKey)}" data-pick-input="${esc(rowKey)}" value="${esc(edit.text || '')}" maxlength="${limit}" autocomplete="off" enterkeyhint="done" aria-label="${esc(label)}"${edit.error ? ` aria-invalid="true" aria-describedby="${esc(errorId)}"` : ''}><span class="hook-form-actions"><button type="button" class="hook-save" data-pick-save="${esc(rowKey)}">Save</button><button type="button" class="quiet" data-pick-cancel="${esc(rowKey)}">Cancel</button></span>${problem}</span>`;
}

function pickChip(option, rowKey, picked, disabled, noun = '') {
  const result = option.label ? RESULT_PILLS[option.label] : null;
  const tags = `${option.yours ? '<span class="pick-tag">yours</span>' : ''}${result ? `<span class="pick-tag is-${option.label}" title="${esc(result.hint)}">${result.word.toLowerCase()}</span>` : ''}${option.count ? `<span class="pick-tag is-count" title="How many times this came up in the research">${esc(plural(option.count, 'mention'))}</span>` : ''}`;
  const shown = pickShown(option);
  const tip = [shown === option.text ? '' : option.text, trimmed(option.hint)].filter(Boolean).join(' - ');
  const chip = `<label class="pick-chip"${tip ? ` title="${esc(tip)}"` : ''}><input type="radio" class="visually-hidden" name="pick_${esc(rowKey)}" value="${esc(option.id)}" ${picked === option.id ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="pick-chip-body"><span class="pick-chip-text">${esc(shown)}</span>${tags}</span></label>`;
  // An option added in this review can be taken back with a small x; one the document lists (the brand's saved ones too) cannot.
  return option.added
    ? `<span class="pick-own">${chip}<button type="button" class="pick-drop" data-pick-drop="${esc(rowKey)}" data-pick-id="${esc(option.id)}" aria-label="${esc(`Remove your own ${noun}: ${option.text}`)}" title="Remove" ${disabled ? 'disabled' : ''}><span aria-hidden="true">×</span></button></span>`
    : chip;
}

function pickRowHtml(row, { concept = null, edit = null, disabled = false } = {}) {
  const spec = PICK_ROW_OF[row.field];
  const forConcept = concept ? ` for concept ${concept.id}` : '';
  const labelId = `pick-label-${row.rowKey}`.replace(/\s+/g, '-');
  const chips = row.options.length ? `<div class="pick-chips" role="radiogroup" aria-labelledby="${esc(labelId)}">${row.options.map(option => pickChip(option, row.rowKey, row.picked, disabled, `${spec.noun}${forConcept}`)).join('')}</div>` : '';
  const editing = edit && edit.row === row.rowKey ? edit : null;
  const adder = editing
    ? pickEditForm(row.rowKey, editing, `Your own ${spec.noun}${forConcept}`, spec.limit ?? PICK_TEXT_LIMIT)
    : row.room ? `<button type="button" class="pick-add" data-pick-add="${esc(row.rowKey)}" aria-label="${esc(`Add your own ${spec.noun}${forConcept}`)}" ${disabled ? 'disabled' : ''}>+ Add your own</button>` : '';
  return `<div class="pick-row"><span class="pick-label" id="${esc(labelId)}">${esc(spec.title)}${concept ? `<span class="visually-hidden"> for concept ${esc(concept.id)}</span>` : ''}</span><div class="pick-line">${chips}${adder}</div></div>`;
}

/** The Industry row, which sits under the strategy summary: '' when the document offers no industries to choose from. */
// Only the current pick shows, as a chip with a Change link; the whole list opens after Change (strategy.industryOpen), and stays
// open while the person is picking or typing in its box.
export function industryRow(strategy, { disabled = false } = {}) {
  const options = strategy?.options;
  const row = options ? pickRowOf(options, 'industry', 'industry', pickFallback(options, 'industry'), strategy) : null;
  if (!row?.options.length) return '';
  const now = row.options.find(item => item.id === row.picked);
  const open = Boolean(strategy.industryOpen) || strategy.edit?.row === 'industry';
  const chip = now
    ? `<span class="cc-ind-now">${esc(pickShown(now))}${now.yours ? '<span class="pick-tag">yours</span>' : ''}</span>`
    : '<span class="cc-ind-now is-none">Not chosen yet</span>';
  const list = open ? `<div class="cc-ind-list" id="cc-industry-list">${pickRowHtml(row, { edit: strategy.edit, disabled })}</div>` : '';
  return `<div class="pick-industry cc-industry"><div class="cc-ind-head"><span class="cc-label">Industry</span>${chip}<button type="button" class="cc-link" data-industry-toggle aria-expanded="${open}" aria-controls="cc-industry-list">${open ? 'Done' : 'Change'}</button></div>${list}</div>`;
}

/** The rows of a concept's strategy picks (funnel stage, ad style, format, call to action...), or '' when the document offers none. */
function conceptPickRows(concept, strategy, disabled) {
  const options = strategy?.options;
  if (!options || !concept) return null;
  const rows = CONCEPT_PICK_FIELDS.map(field => pickRowOf(options, field, pickRowKey(concept.id, field), pickFallback(options, field, concept), strategy)).filter(Boolean);
  return rows.length ? rows : null;
}

/** A concept's folded "Strategy picks" block: the picks as they stand in its summary, the four rows inside. */
function conceptPickBlock(concept, strategy, disabled) {
  const rows = conceptPickRows(concept, strategy, disabled);
  if (!rows) return '';
  const now = rows.map(row => { const option = row.options.find(item => item.id === row.picked); return option ? pickShown(option) : ''; }).filter(Boolean);
  const key = `strategy-picks:${concept.id}`;
  const open = Boolean(strategy.openKeys?.has(key)) || rows.some(row => strategy.edit?.row === row.rowKey);
  return `<details class="strategy-picks" data-open-key="${esc(key)}"${open ? ' open' : ''}><summary><span class="strategy-picks-title">Strategy picks</span><span class="strategy-picks-now">${now.length ? esc(now.join(' · ')) : 'None chosen yet'}</span></summary><div class="strategy-picks-body">${rows.map(row => pickRowHtml(row, { concept, edit: strategy.edit, disabled })).join('')}</div></details>`;
}

// ---- The "Pick a concept" cards ----
// One concept per row: the idea on the left (title, source, one sentence, the opening line, four facts), the proof on the right (a
// sentence, up to three tiles, the strength). "View details" opens a side panel with everything else (state.conceptPanel names the
// concept it shows); nothing a concept says is left out of it.
const CC_ICON = Object.freeze({
  brand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
  competitors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.6"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M15.5 14.2c2.6-.3 4.8 1.2 5.5 4.3"/></svg>',
  trending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.8 2.4 4.5 5 4.7"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>',
  meta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 15c0-4 2-8 4.5-8C11 7 13 17 16.5 17 19 17 21 14.5 21 12c0-3-1.6-5-3.8-5C14 7 10 17 6.5 17 4.5 17 3 16.3 3 15z"/></svg>',
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/></svg>',
});
const CC_PLATFORMS = Object.freeze({
  tiktok: { name: 'TikTok', icon: 'tiktok' }, instagram: { name: 'Instagram', icon: 'instagram' }, youtube: { name: 'YouTube', icon: 'youtube' },
  facebook: { name: 'Facebook', icon: 'meta' }, 'meta-ad': { name: 'Meta ad', icon: 'meta' }, web: { name: 'Web', icon: 'web' },
});
const CC_WHY = Object.freeze({
  brand: 'Built on what works for this brand.',
  competitors: "Borrows a competitor winner's shape.",
  trending: 'Rides a topic your niche watches.',
});
const CC_FIELD = Object.freeze({
  source: /^sources?$/i, insight: /^insight\b/i, anchor: /^anchor\b/i, stage: /^awareness[\s_-]*stage\b/i, angle: /^angle\b/i,
  subtopic: /^sub[\s_-]*topic\b/i, format: /^format\b/i, cta: /^(?:cta\b|call[\s_-]*to[\s_-]*action\b)/i, length: /^(?:target[\s_-]*)?(?:duration|length)\b/i,
  oneliner: /^in[\s_-]*one[\s_-]*line\b/i, wins: /^why[\s_-]*this[\s_-]*wins\b/i, rubric: /^rubric\b/i, ranking: /^ranking\b/i,
  hooks: /^hook[\s_-]*options\b/i, beats: /^beats\b/i,
});
// The rows of "How the video plays", in this order; any other field the concept has follows them under its own label.
const CC_PLAY_ROWS = Object.freeze([
  ['Problem line', /^problem[\s_-]*line\b/i], ['Proof moment', /^proof[\s_-]*moment\b/i], ['Product moment', /^product[\s_-]*moment\b/i],
  ['Honest trade-off', /^honest[\s_-]*trade/i], ['Camera and sound', /^camera\b/i], ['Target duration', CC_FIELD.length], ['Loop', /^loop\b/i],
  ['Narrative pattern', /^narrative[\s_-]*pattern\b/i], ['Proof pattern', /^proof[\s_-]*pattern\b/i],
]);
const CC_MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
const ccLabel = field => String(field?.label || '').trim().replace(/:$/, '');
/** Text as plain words: links, bare addresses and markdown marks taken out. */
const ccPlain = value => String(value ?? '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[`*_]{1,3}/g, '').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
const ccCut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[\s,;:.–—-]+$/, '')}…`);
/** A field value as a short fact: its first line, without a library id in front or a file reference behind. */
function ccShort(value, max = 44) {
  let text = ccPlain(String(value ?? '').split('\n')[0]);
  text = text.replace(/\s*\([^)]*\.(?:md|json)[^)]*\)\s*$/i, '').replace(/^[A-Z]{1,5}(?:-[A-Za-z0-9]+)+\s*(?:[-–—:]\s+)?/, '').trim();
  return ccCut(text, max);
}
function ccCount(n) {
  if (n >= 1e4) {
    const tidy = value => value.toFixed(1).replace(/\.0$/, '');
    const k = n / 1e3;
    return k >= 999.95 ? `${tidy(n / 1e6)}M` : `${tidy(k)}K`;
  }
  return Math.round(n).toLocaleString('en-US');
}
function ccDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? `${Number(match[3])} ${CC_MONTHS[Number(match[2]) - 1]} ${match[1]}` : '';
}
/** One piece of proof as a tile: the platform, the big number (with how far above usual), a line of label and date, a link. */
function ccTile(tile, full = false) {
  const platform = CC_PLATFORMS[tile?.platform] || CC_PLATFORMS.web;
  const days = Number.isFinite(tile?.daysRunning) ? tile.daysRunning : null;
  const count = Number.isFinite(tile?.count) ? tile.count : null;
  let main = '';
  if (tile?.platform === 'meta-ad' && days !== null) main = plural(days, 'day', 'days') + ' running';
  else if (count !== null) main = `${ccCount(count)} ${tile.unit || 'views'}`;
  else if (days !== null) main = plural(days, 'day', 'days') + ' running';
  const lift = Number.isFinite(tile?.lift) && tile.lift >= 1 ? `<em>${esc(`${tile.lift.toFixed(1)}× ${tile.liftLabel || 'usual'}`)}</em>` : '';
  const label = String(tile?.label || '').trim();
  const sub = [main ? label : '', ccDate(tile?.date)].filter(Boolean).join(' · ') || (main ? '' : label);
  const link = /^https?:\/\//i.test(tile?.url || '') ? `<a href="${esc(tile.url)}" target="_blank" rel="noopener" aria-label="${esc(`Open this ${platform.name} post`)}">Open ↗</a>` : '<span></span>';
  return `<div class="cc-tile${full ? ' is-full' : ''}"><span class="cc-plat" title="${esc(platform.name)}">${CC_ICON[platform.icon]}<span class="visually-hidden">${esc(platform.name)}</span></span><span class="cc-tile-main"><span class="cc-tile-num">${esc(main || platform.name)}${lift}</span>${sub ? `<span class="cc-tile-sub" title="${esc(sub)}">${esc(sub)}</span>` : ''}</span>${link}</div>`;
}
/** "hook 8/10, problem 7/10 ..." as [{label, value}]; [] when the text is not written that way. */
function ccScoresOf(value) {
  const out = [];
  const pattern = /([A-Za-z][A-Za-z' &/-]{0,28}?)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*\/\s*10\b/g;
  let match;
  while ((match = pattern.exec(String(value || '')))) {
    const label = match[1].trim().replace(/^(?:and|&)\s+/i, '');
    const score = Number(match[2]);
    if (label && score >= 0 && score <= 10) out.push({ label: label[0].toUpperCase() + label.slice(1), value: score });
  }
  return out;
}
/** "1) beat - takeaway 2) ..." as [{beat, takeaway}]; null when the text is not a numbered list. */
function ccBeatsOf(value) {
  const text = String(value || '').trim();
  if (!/^1[).]\s/.test(text)) return null;
  const parts = text.split(/(?:^|\s|\n)\d{1,2}[).]\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map(part => {
    const cut = /\s[-–—]\s/.exec(part);
    return cut ? { beat: part.slice(0, cut.index).trim(), takeaway: part.slice(cut.index + cut[0].length).trim() } : { beat: part, takeaway: '' };
  });
}
const ccMeter = (score, extra = '') => `<span class="cc-meter${extra}" role="img" aria-label="${esc(`${score} out of 10`)}"><i style="width:${Math.max(0, Math.min(100, score * 10))}%"></i></span>`;
const ccSourcePill = source => (source ? `<span class="cc-src cc-src-${esc(source.kind)}">${CC_ICON[source.kind] || ''}<span class="visually-hidden">Source: </span>${esc(source.label)}</span>` : '');

export function conceptCards(concepts, choice = null, { disabled = false, hooks = {}, own = {}, edited = {}, edit = null, strategy = null, panel = null } = {}) {
  const list = concepts?.concepts || [];
  if (!list.length) return '<p class="muted">No concepts found.</p>';
  const lock = disabled || Boolean(strategy?.disabled);
  const model = concept => {
    const fields = (concept.fields || []).filter(field => field && String(field.value ?? '').trim());
    const find = pattern => fields.find(field => pattern.test(ccLabel(field))) || null;
    const source = conceptSourceOf(concept);
    const sourceField = find(CC_FIELD.source);
    const hookField = find(CC_FIELD.hooks);
    const { lines } = hookLinesOf(concept, { own, edited });
    const picked = Number.isInteger(hooks?.[concept.id]) && lines[hooks[concept.id]] ? hooks[concept.id] : 0;
    const scores = ccScoresOf(find(CC_FIELD.rubric)?.value);
    const strength = scores.length ? Math.round((scores.reduce((sum, item) => sum + item.value, 0) / scores.length) * 10) / 10 : null;
    const winsText = ccPlain(find(CC_FIELD.wins)?.value);
    const oneline = ccPlain(find(CC_FIELD.oneliner)?.value) || (winsText ? ccCut(/^.+?[.!?](?=\s|$)/.exec(winsText)?.[0] || winsText, 220) : '');
    const proof = (() => { try { const tiles = conceptProofOf(source?.detail || ''); return Array.isArray(tiles) ? tiles.filter(tile => tile && typeof tile === 'object') : []; } catch { return []; } })();
    return { concept, fields, find, source, sourceField, hookField, lines, picked, scores, strength, oneline, proof };
  };
  const models = list.map(model);
  const factOf = (item, pattern) => {
    const field = item.find(pattern);
    if (!field) return '';
    const now = pickFieldNow(item.concept, field, strategy);
    return ccShort(now !== null ? now : field.value);
  };
  const card = item => {
    const { concept, source, lines, picked, proof } = item;
    const id = esc(concept.id);
    const facts = [['Format', factOf(item, CC_FIELD.format) || factOf(item, /^visual[\s_-]*format\b/i)], ['Subtopic', factOf(item, CC_FIELD.subtopic)], ['Length', factOf(item, CC_FIELD.length)], [TXT_CALL_TO_ACTION, factOf(item, CC_FIELD.cta)]]
      .filter(([, value]) => value).map(([label, value]) => `<span class="cc-fact"><span>${esc(label)}</span><b title="${esc(value)}">${esc(value)}</b></span>`).join('');
    const opens = lines.length
      ? `<span class="cc-opens"><span class="cc-label">Opens with</span><q>${esc(lines[picked].text)}</q><span class="cc-opens-foot">Line ${picked + 1} of ${lines.length}</span></span>`
      : `<span class="cc-opens is-empty"><span class="cc-label">Opens with</span><span class="cc-opens-none">None yet.</span></span>`;
    const why = source && CC_WHY[source.kind] ? `<p class="cc-why">${esc(CC_WHY[source.kind])}</p>` : '';
    let evidence = '';
    if (proof.length) evidence = `<span class="cc-tiles">${proof.slice(0, 3).map(tile => ccTile(tile)).join('')}</span>`;
    else if (source?.detail) evidence = `<p class="cc-evidence">${esc(ccCut(ccPlain(source.detail), 160))}</p>`;
    else if (!source) evidence = '<p class="cc-evidence">No research attached.</p>';
    const strength = item.strength === null ? '' : `<span class="cc-strength"><span class="cc-strength-row">Strength score<b>${item.strength.toFixed(1)} / 10</b></span>${ccMeter(item.strength)}</span>`;
    const credits = Number.isInteger(concept.credits) ? `<span class="cc-credits">${esc(`${concept.credits.toLocaleString()} credits for media`)}</span>` : '';
    return `<label class="cc-card"><input type="radio" class="visually-hidden" name="concept_choice" value="${id}" ${choice === concept.id ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="cc-face">`
      + `<span class="cc-idea"><span class="cc-head"><span class="cc-letter" aria-hidden="true">${id}</span><span class="cc-title-block"><strong class="cc-title">${esc(concept.title)}</strong><span class="cc-badges">${ccSourcePill(source)}${concept.recommended ? '<span class="pill ready">Recommended</span>' : ''}</span></span><span class="cc-radio" aria-hidden="true"></span></span>`
      + `${item.oneline ? `<p class="cc-oneliner">${esc(item.oneline)}</p>` : ''}${opens}${facts ? `<span class="cc-facts">${facts}</span>` : ''}`
      + `<span class="cc-actions"><button type="button" data-concept-open="${id}" aria-haspopup="dialog">View details</button><span class="cc-chosen">✓ Your pick</span>${credits}</span></span>`
      + `<span class="cc-proof"><span class="cc-label">Why we think it works</span>${why}${evidence}${strength}</span></span></label>`;
  };
  return `<div class="cc-stack" role="radiogroup" aria-label="Concepts">${models.map(card).join('')}</div>${conceptPanelHtml(models.find(item => item.concept.id === panel), { choice, disabled, hooks, own, edited, edit, strategy, lock })}`;
}

/** The side panel of one concept: everything the card leaves out. '' when no concept is open. */
function conceptPanelHtml(item, { choice, disabled, hooks, own, edited, edit, strategy, lock }) {
  if (!item) return '';
  const { concept, fields, find, source, sourceField, hookField, proof, scores } = item;
  const id = esc(concept.id);
  const used = new Set([sourceField, hookField].filter(Boolean));
  const take = pattern => { const field = fields.find(entry => !used.has(entry) && pattern.test(ccLabel(entry))); if (field) used.add(field); return field || null; };
  const textOf = field => {
    const now = pickFieldNow(concept, field, strategy);
    return now !== null ? esc(now) : inlineMarkdown(field.value);
  };
  const row = (label, html, field) => `<div class="cc-kv-row"><dt>${esc(label)}</dt><dd${field && /\n/.test(field.value) ? ' class="lines"' : ''}>${html}</dd></div>`;
  const fieldRow = (label, field) => (field ? row(label, textOf(field), field) : '');
  // Opening line
  const hooksSection = `<section class="cc-sec" data-cc-sec="hooks"><h3>Opening line</h3><dl class="cc-hook-dl" id="cc-hooks-${id}">${hookPicks(concept, hookField, { hooks, own, edited, edit, disabled })}</dl></section>`;
  // Why it works
  const insight = take(CC_FIELD.insight);
  const anchor = take(CC_FIELD.anchor);
  const stage = take(CC_FIELD.stage);
  const angle = take(CC_FIELD.angle);
  const wins = take(CC_FIELD.wins);
  const oneline = take(CC_FIELD.oneliner);
  const humanized = insight ? humanizeSourceRef(insight.value) : null;
  const stageNow = stage ? pickFieldNow(concept, stage, strategy) : null;
  const stageHtml = stage ? (stageNow !== null ? esc(stageNow) : /^[a-z]+(?:_[a-z]+)*$/.test(String(stage.value).trim()) ? esc(humanize(String(stage.value).trim())) : inlineMarkdown(stage.value)) : '';
  const whyRows = [
    anchor ? row('The audience says', textOf(anchor), anchor) : '', insight ? row('Insight it rests on', humanized ? esc(humanized) : inlineMarkdown(insight.value), insight) : '',
    stage ? row('Where viewers are', stageHtml, stage) : '', fieldRow('Angle', angle), fieldRow('In one line', oneline), fieldRow('Why this wins', wins),
  ].join('');
  const tiles = proof.length ? `<span class="cc-tiles">${proof.map(tile => ccTile(tile, true)).join('')}</span>` : '';
  const whySection = (whyRows || tiles) ? `<section class="cc-sec" data-cc-sec="why"><h3>Why it works</h3>${whyRows ? `<dl class="cc-kv">${whyRows}</dl>` : ''}${tiles}</section>` : '';
  // How the video plays
  const beatsField = take(CC_FIELD.beats);
  const beats = beatsField ? ccBeatsOf(beatsField.value) : null;
  const beatsHtml = beatsField ? (beats ? `<ol class="cc-beats">${beats.map(item => `<li><span>${inlineMarkdown(item.beat)}${item.takeaway ? `<small>${inlineMarkdown(item.takeaway)}</small>` : ''}</span></li>`).join('')}</ol>` : `<p class="cc-text${/\n/.test(beatsField.value) ? ' lines' : ''}">${inlineMarkdown(beatsField.value)}</p>`) : '';
  const rubricField = take(CC_FIELD.rubric);
  const rankingField = take(CC_FIELD.ranking);
  const playRows = CC_PLAY_ROWS.map(([label, pattern]) => fieldRow(label, take(pattern))).join('');
  const rest = fields.filter(field => !used.has(field));
  rest.forEach(field => used.add(field));
  const restRows = rest.map(field => fieldRow(ccLabel(field) || 'Note', field)).join('');
  const playSection = (beatsHtml || playRows || restRows) ? `<section class="cc-sec" data-cc-sec="plays"><h3>How the video plays</h3>${beatsHtml}${playRows || restRows ? `<dl class="cc-kv">${playRows}${restRows}</dl>` : ''}</section>` : '';
  // Strategy picks
  const pickRows = conceptPickRows(concept, strategy, lock);
  const picksSection = pickRows ? `<section class="cc-sec" data-cc-sec="picks"><h3>Strategy picks</h3><div class="cc-picks">${pickRows.map(entry => pickRowHtml(entry, { concept, edit: strategy.edit, disabled: lock })).join('')}</div></section>` : '';
  // Scores
  const average = item.strength === null ? '' : `<p class="cc-score-total"><span>Strength score</span><b>${item.strength.toFixed(1)} / 10</b></p>`;
  const bars = scores.length ? `<div class="cc-scores">${scores.map(score => `<div class="cc-score"><span class="cc-strength-row">${esc(score.label)}<b>${score.value}/10</b></span>${ccMeter(score.value)}</div>`).join('')}</div>` : (rubricField ? `<p class="cc-text${/\n/.test(rubricField.value) ? ' lines' : ''}">${inlineMarkdown(rubricField.value)}</p>` : '');
  const scoresSection = (average || bars || rankingField) ? `<section class="cc-sec" data-cc-sec="scores"><h3>Scores</h3>${average}${bars}${rankingField ? `<dl class="cc-kv">${fieldRow('Ranking', rankingField)}</dl>` : ''}</section>` : '';
  // Research notes, as written
  const rawKey = `concept-raw:${concept.id}`;
  const raw = sourceField ? `<section class="cc-sec" data-cc-sec="raw"><details class="cc-raw" data-open-key="${esc(rawKey)}"${strategy?.openKeys?.has(rawKey) ? ' open' : ''}><summary>Research notes (as written)</summary><p class="cc-raw-text lines">${inlineMarkdown(sourceField.value)}</p></details></section>` : '';
  const credits = Number.isInteger(concept.credits) ? `<p class="cc-credits-line">${esc(`${concept.credits.toLocaleString()} credits for media`)}</p>` : '';
  return `<button type="button" class="cc-scrim" data-concept-close tabindex="-1" aria-label="Close details"></button>`
    + `<aside class="cc-panel" role="dialog" aria-modal="true" aria-labelledby="cc-title-${id}" data-concept-panel="${id}">`
    + `<div class="cc-panel-head"><span class="cc-letter" aria-hidden="true">${id}</span><div class="cc-title-block"><h2 id="cc-title-${id}" class="cc-title">${esc(concept.title)}</h2><span class="cc-badges">${ccSourcePill(source)}${concept.recommended ? '<span class="pill ready">Recommended</span>' : ''}</span></div><button type="button" class="quiet cc-x" data-concept-close aria-label="Close details">✕</button></div>`
    + `<div class="cc-panel-body">${hooksSection}${whySection}${playSection}${picksSection}${scoresSection}${raw}${credits}</div>`
    + `<div class="cc-panel-foot"><button type="button" data-concept-close>Close</button><button type="button" class="primary" data-concept-choose="${id}" ${disabled ? 'disabled' : ''}>Choose this concept</button></div></aside>`;
}

const RECIPE_FIELDS = Object.freeze(['pillar', 'angle', 'hookFamily', 'cta', 'hashtags']);
const RECIPE_OWN_VALUE = '__own__';
const RECIPE_NAME = /^recipe_(D\d+)_(pillar|angle|hookFamily|cta|hashtags)(_own)?(?:_(family|mechanism|example|style|line))?$/;
const RECIPE_OWN_KEY = Object.freeze({ pillar: 'pillar', angle: 'angle', hashtags: 'tags' });

function recipeFieldFromName(name) {
  const match = RECIPE_NAME.exec(name || '');
  if (!match) return null;
  return { deliverableId: match[1], field: match[2], own: Boolean(match[3]), subkey: match[4] || RECIPE_OWN_KEY[match[2]] || null };
}

function unchosenRecipes(doc) {
  return Object.entries(doc?.recipes || {}).filter(([, entry]) => entry && !entry.chosen);
}

function recipeFieldState(recipeState, deliverableId, field) {
  recipeState[deliverableId] ||= {};
  return (recipeState[deliverableId][field] ||= { pick: null, own: {} });
}

function defaultRecipeOwn(field, catalog) {
  if (field === 'hookFamily') {
    const family = catalog?.hookFamilies?.[0];
    return family ? { family: family.code, mechanism: family.mechanisms?.[0]?.code || '' } : {};
  }
  if (field === 'cta') {
    const style = catalog?.ctaStyles?.[0];
    return style ? { style: style.code } : {};
  }
  return {};
}

function recipeOwnPayload(field, own = {}) {
  if (field === 'pillar') { const value = String(own.pillar || '').trim(); return value ? { pillar: value } : null; }
  if (field === 'angle') { const value = String(own.angle || '').trim(); return value ? { angle: value } : null; }
  if (field === 'hookFamily') {
    const family = String(own.family || '').trim();
    const mechanism = String(own.mechanism || '').trim();
    if (!family || !mechanism) return null;
    const example = String(own.example || '').trim();
    return { family, mechanism, ...(example ? { example } : {}) };
  }
  if (field === 'cta') {
    const style = String(own.style || '').trim();
    if (!style) return null;
    const line = String(own.line || '').trim();
    return { style, ...(style === 'none' ? {} : { line }) };
  }
  const tags = String(own.tags || '').split(/[\s,]+/).map(tag => tag.trim()).filter(Boolean);
  return { tags };
}

function recipeFieldPick(fieldState) {
  const pick = fieldState?.pick;
  if (!pick) return undefined;
  if (pick !== RECIPE_OWN_VALUE) return { option: pick };
  const written = recipeOwnPayload(fieldState.field, fieldState.own);
  return written ? { written } : undefined;
}

function recipePicks(recipeState, deliverableId) {
  const fields = recipeState?.[deliverableId] || {};
  const picks = {};
  for (const field of RECIPE_FIELDS) {
    const pick = recipeFieldPick({ ...fields[field], field });
    if (pick !== undefined) picks[field] = pick;
  }
  return picks;
}

function recipeReady(recipeState, deliverableId) {
  const picks = recipePicks(recipeState, deliverableId);
  return RECIPE_FIELDS.every(field => picks[field] !== undefined);
}

function recipeOptionCards(deliverableId, field, fieldDoc, picked, disabled) {
  const name = `recipe_${deliverableId}_${field}`;
  const cards = (fieldDoc.options || []).map(option => {
    const evidence = (option.evidence || []).filter(Boolean);
    return `<label class="recipe-card"><input type="radio" class="visually-hidden" name="${esc(name)}" value="${esc(option.id)}" ${picked === option.id ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="recipe-card-body"><span class="recipe-card-radio" aria-hidden="true"></span><span class="recipe-card-text"><strong>${esc(option.label)}</strong>${option.reason ? `<span class="recipe-reason">${esc(option.reason)}</span>` : ''}${evidence.length ? `<span class="recipe-evidence">${esc(evidence.join(' · '))}</span>` : ''}</span></span></label>`;
  }).join('');
  const own = `<label class="recipe-card recipe-card-own"><input type="radio" class="visually-hidden" name="${esc(name)}" value="${RECIPE_OWN_VALUE}" ${picked === RECIPE_OWN_VALUE ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="recipe-card-body"><span class="recipe-card-radio" aria-hidden="true"></span><span class="recipe-card-text"><strong>Write my own</strong></span></span></label>`;
  return `<div class="recipe-grid" role="radiogroup" aria-label="${esc(fieldDoc.label)}">${cards}${own}</div>`;
}

const CTA_STYLE_FALLBACK = Object.freeze([['link_caption', 'Link in the post text'], ['link_bio', 'Link in the bio'], ['story_sticker', 'Story link sticker'], ['comment_keyword', 'Comment a keyword'], ['dm', 'Send a DM'], ['save', 'Ask people to save'], ['share_send', 'Ask people to share'], ['question', 'Ask a question'], ['follow', 'Ask people to follow'], ['none', 'No call to action']].map(([code, label]) => ({ code, label })));

function recipeOwnForm(deliverableId, field, own, catalog, disabled) {
  const prefix = `recipe_${deliverableId}_${field}_own`;
  const dis = disabled ? 'disabled' : '';
  if (field === 'pillar') return `<div class="recipe-own"><label for="${prefix}">Your own topic</label><input id="${prefix}" name="${prefix}" type="text" maxlength="60" value="${esc(own.pillar || '')}" ${dis}></div>`;
  if (field === 'angle') return `<div class="recipe-own"><label for="${prefix}">Your angle</label><input id="${prefix}" name="${prefix}" type="text" maxlength="200" value="${esc(own.angle || '')}" ${dis}></div>`;
  if (field === 'hookFamily') {
    const families = catalog?.hookFamilies?.length ? catalog.hookFamilies : [];
    const family = families.find(item => item.code === own.family) || families[0] || null;
    const mechanisms = family?.mechanisms || [];
    return `<div class="recipe-own recipe-own-grid"><div><label for="${prefix}_family">Hook style</label><select id="${prefix}_family" name="${prefix}_family" ${dis}>${families.map(item => `<option value="${esc(item.code)}" ${(own.family || family?.code) === item.code ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></div><div><label for="${prefix}_mechanism">How it opens</label><select id="${prefix}_mechanism" name="${prefix}_mechanism" ${dis}>${mechanisms.map(item => `<option value="${esc(item.code)}" ${own.mechanism === item.code ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></div><div class="recipe-own-wide"><label for="${prefix}_example">Your hook line</label><input id="${prefix}_example" name="${prefix}_example" type="text" maxlength="200" value="${esc(own.example || '')}" ${dis}></div></div>`;
  }
  if (field === 'cta') {
    const styles = catalog?.ctaStyles?.length ? catalog.ctaStyles : CTA_STYLE_FALLBACK;
    const style = own.style || 'none';
    return `<div class="recipe-own recipe-own-grid"><div><label for="${prefix}_style">Call to action</label><select id="${prefix}_style" name="${prefix}_style" ${dis}>${styles.map(item => `<option value="${esc(item.code)}" ${style === item.code ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></div>${style !== 'none' ? `<div class="recipe-own-wide"><label for="${prefix}_line">In your words</label><input id="${prefix}_line" name="${prefix}_line" type="text" maxlength="200" value="${esc(own.line || '')}" ${dis}></div>` : ''}</div>`;
  }
  return `<div class="recipe-own"><label for="${prefix}">Your hashtags</label><input id="${prefix}" name="${prefix}" type="text" placeholder="#one #two" value="${esc(own.tags || '')}" ${dis}></div>`;
}

function recipeFieldBlock(deliverableId, field, fieldDoc, fieldState, catalog, disabled) {
  const cards = recipeOptionCards(deliverableId, field, fieldDoc, fieldState.pick, disabled);
  const own = fieldState.pick === RECIPE_OWN_VALUE ? recipeOwnForm(deliverableId, field, fieldState.own || {}, catalog, disabled) : '';
  return `<div class="recipe-field"><h4>${esc(fieldDoc.label)}</h4>${cards}${own}</div>`;
}

function recipeDeliverableBlock(deliverableId, entry, recipeState, catalog, { disabled = false, foot = '' } = {}) {
  const fields = RECIPE_FIELDS.map(field => recipeFieldBlock(deliverableId, field, entry.fields[field], recipeFieldState(recipeState, deliverableId, field), catalog, disabled)).join('');
  return `<div class="recipe-deliverable"><div class="recipe-deliverable-head"><span class="pill sb-tag">${esc(deliverableId)}</span></div>${fields}${foot}</div>`;
}

export function recipeReviewSection(doc, recipeState, { disabled }) {
  const pending = unchosenRecipes(doc);
  if (!pending.length) return '';
  const catalog = doc.recipeCatalog;
  const blocks = pending.map(([id, entry]) => recipeDeliverableBlock(id, entry, recipeState, catalog, { disabled })).join('');
  return `<section class="recipe-section"><h3>Copy choices</h3>${blocks}</section>`;
}

export function recipePanel(doc, recipeState, recipeStatus, { disabled = false } = {}) {
  const pending = unchosenRecipes(doc);
  if (!pending.length) return '';
  const catalog = doc.recipeCatalog;
  const blocks = pending.map(([id, entry]) => {
    const status = recipeStatus[id] || {};
    const busy = disabled || status.busy || status.submitted;
    const label = status.busy ? 'Saving...' : status.submitted ? TXT_WAITING_FOR_CLAUDE : 'Save copy choices';
    const error = status.error ? `<p class="notice error inline-error" role="alert">${esc(status.error)}</p>` : '';
    const notice = status.declined
      ? `<div class="notice" role="status"><span>${esc(status.message || NOTE_DECLINED)}</span></div>`
      : status.submitted ? `<div class="notice" role="status"><span>Saved.</span></div>` : '';
    const foot = `${error}<div class="review-actions"><div class="review-buttons"><button type="button" class="primary" data-recipe-save="${esc(id)}" ${busy ? 'disabled' : ''}>${esc(label)}</button></div></div>${notice}`;
    return recipeDeliverableBlock(id, entry, recipeState, catalog, { disabled: busy, foot });
  }).join('');
  return `<section class="panel recipe-panel" aria-labelledby="recipe-title"><div class="section-head"><h2 id="recipe-title">Copy choices</h2></div>${blocks}</section>`;
}


// @module panels
// The deliverable this item (a storyboard or a final post) is for, in a
// person's words: the readable label once job-document.mjs provides one,
// else platform and format together, and only ever `fallback` when nothing
// else is known. Never the raw code ("D1") itself; that shows as its own
// small tag next to this label instead (see refTag/askForChanges below).
function deliverableLabel(item, fallback) {
  if (typeof item?.label === 'string' && item.label.trim()) return item.label.trim();
  const platform = item?.platform ? platformName(item.platform) : '';
  const format = typeof item?.format === 'string' && item.format.trim() ? humanize(item.format) : '';
  const joined = [platform, format].filter(Boolean).join(' · ');
  return joined || fallback;
}

// The small pill tag people already use to reference a panel or deliverable
// by code when asking for changes in chat ("P2", "D1"): the board's plain
// existing pill style, next to the readable content instead of standing in
// as the heading.
function refTag(ref) {
  return ref ? `<span class="pill sb-tag">${esc(ref)}</span>` : '';
}

// A compact "Ask for changes" control for one panel or deliverable: opens
// the review's shared changes box prefilled with this item's code. Always a
// button, never a real link, so there is no default navigation to jump the
// page; reviewAction (below) redraws and refocuses the box itself, the same
// no-jump pattern the concept cards and logo radios already use.
function askForChanges(ref) {
  return ref ? `<button type="button" class="sb-ask" data-review-action="changes" data-ref="${esc(ref)}">Ask for changes</button>` : '';
}

const PANEL_SOURCE_WORDS = Object.freeze({ new: 'New', kept: 'Kept' });
const CHECK_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>';
const CHANGE_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 3.5 12.5 5.5 6 12H4v-2z"/></svg>';
const FRAME_ICON = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/></svg>';

const trimmed = value => (typeof value === 'string' && value.trim() ? value.trim() : '');
const panelRefOf = (panel, index) => trimmed(panel?.ref) || trimmed(panel?.id) || `P${index + 1}`;
const panelLabelOf = (panel, index) => trimmed(panel?.label) || `Panel ${index + 1}`;
const boardRefOf = board => trimmed(board?.ref) || null;

export function panelKey(board, panel, index = 0) {
  return `${boardRefOf(board) || ''}:${panelRefOf(panel, index)}`;
}

function frameRatio(aspectRatio) {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(String(aspectRatio || '').trim());
  return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? `${Number(match[1])} / ${Number(match[2])}` : '9 / 16';
}

function secondsWord(value) {
  const number = Number(value);
  return `${Number.isInteger(number) ? number : number.toFixed(1).replace(/\.0$/, '')} s`;
}

export function runtimeNote(board) {
  const total = Number(board?.totalSeconds);
  const min = Number(board?.briefSeconds?.min);
  const max = Number(board?.briefSeconds?.max);
  if (!(total > 0) || !(min > 0 || max > 0)) return '';
  const low = min > 0 ? min : max;
  const high = max > 0 ? max : min;
  if (total >= low && total <= high) return '';
  const asked = low === high ? secondsWord(low) : `${secondsWord(low).replace(/ s$/, '')} to ${secondsWord(high)}`;
  return `<p class="sb-runtime">The storyboard runs ${esc(secondsWord(total))}; the brief asked for ${esc(asked)}.</p>`;
}

function panelFrameHtml(panel, index, { large = false } = {}) {
  const frame = panel?.frame || null;
  const sources = frame?.kind === 'image'
    ? (large ? [frame.reviewUrl, frame.thumb] : [frame.thumb, frame.reviewUrl])
    : [frame?.thumb];
  const src = sources.map(safePreviewUrl).find(Boolean);
  if (src) return `<img src="${esc(src)}" alt="${esc(panelLabelOf(panel, index))}" loading="lazy">`;
  if (large) return `<span class="sb-empty">${FRAME_ICON}<span>${panel?.source === 'kept' ? 'Existing image' : frame?.thumbOmitted ? 'On your computer' : 'Not made yet.'}</span></span>`;
  const shot = trimmed(panel?.shot);
  return `<span class="sb-sketch">${shot ? inlineMarkdown(shot) : '<span class="muted">No shot described</span>'}</span>`;
}

function panelFields(panel, board = null) {
  const none = '<span class="muted">None</span>';
  // A slide is a picture and the words on it, with nothing spoken.
  if (board?.format === 'carousel') return `<dl class="review-fields"><div><dt>Picture</dt><dd>${panel?.shot ? inlineMarkdown(panel.shot) : none}</dd></div><div><dt>Slide text</dt><dd>${panel?.onScreen ? inlineMarkdown(panel.onScreen) : none}</dd></div></dl>`;
  return `<dl class="review-fields"><div><dt>Shot</dt><dd>${panel?.shot ? inlineMarkdown(panel.shot) : none}${panel?.camera ? `<small class="sb-camera">${inlineMarkdown(panel.camera)}</small>` : ''}</dd></div><div><dt>On-screen text</dt><dd>${panel?.onScreen ? inlineMarkdown(panel.onScreen) : none}</dd></div><div><dt>Voiceover</dt><dd>${panel?.voiceover ? inlineMarkdown(panel.voiceover) : none}</dd></div></dl>`;
}

function stripCell(board, panel, index, { interactive = false, verdict = null, current = false, highlight = false } = {}) {
  const line = trimmed(panel?.voiceover) || trimmed(panel?.onScreen);
  const mark = verdict === 'approve' ? `<span class="sb-mark is-approved">${CHECK_ICON}</span>` : verdict === 'changes' ? `<span class="sb-mark is-changes">${CHANGE_ICON}</span>` : '';
  const duration = Number(panel?.durationSeconds) > 0 ? `<span class="sb-dur">${esc(secondsWord(panel.durationSeconds))}</span>` : '';
  const body = `<span class="sb-frame">${panelFrameHtml(panel, index)}${mark}</span><span class="sb-cell-meta">${refTag(panelRefOf(panel, index))}${duration}<span class="sb-source">${esc(PANEL_SOURCE_WORDS[panel?.source] || 'New')}</span></span><span class="sb-line">${line ? esc(line) : '<span class="muted">No line</span>'}</span>`;
  const cls = ['sb-cell', current ? 'is-current' : '', highlight ? 'is-highlight' : '', verdict === 'approve' ? 'is-approved' : verdict === 'changes' ? 'is-changes' : ''].filter(Boolean).join(' ');
  if (!interactive) return `<li class="${cls}"><div class="sb-cell-body">${body}</div></li>`;
  const state = verdict === 'approve' ? ', approved' : verdict === 'changes' ? ', change asked' : '';
  return `<li class="${cls}"><button type="button" class="sb-cell-body" data-sb-panel="${esc(panelKey(board, panel, index))}" aria-label="${esc(`${panelLabelOf(panel, index)}${state}`)}"${current ? ' aria-current="step"' : ''}>${body}</button></li>`;
}

export function storyboardStrip(board, { interactive = false, verdicts = {}, current = null, highlight = null } = {}) {
  const panels = board?.panels || [];
  const total = Number(board?.totalSeconds) > 0 ? Number(board.totalSeconds) : Number(board?.runtimeSeconds) > 0 ? Number(board.runtimeSeconds) : null;
  const voiceOver = board?.voiceOver ? (board.voiceOver.enabled ? `Voice-over: yes${board.voiceOver.voice ? `, ${board.voiceOver.voice}` : ''}` : 'Voice-over: no') : '';
  const meta = [board?.platform ? platformName(board.platform) : '', board?.aspectRatio || '', total ? secondsWord(total) : '', `${panels.length} ${board?.format === 'carousel' ? 'slide' : 'panel'}${panels.length === 1 ? '' : 's'}`, voiceOver].filter(Boolean).join(' · ');
  const boardRef = boardRefOf(board);
  const cells = panels.map((panel, index) => {
    const key = panelKey(board, panel, index);
    return stripCell(board, panel, index, { interactive, verdict: verdicts[key]?.verdict || null, current: current === key, highlight: highlight === key });
  }).join('');
  return `<section class="storyboard"><div class="storyboard-head"><div class="storyboard-title"><h3>${esc(deliverableLabel(board, 'Storyboard'))}</h3>${refTag(boardRef)}</div><div class="storyboard-sub"><span class="muted">${esc(meta)}</span>${interactive ? askForChanges(boardRef) : ''}</div></div>${runtimeNote(board)}${panels.length ? `<ol class="sb-strip" style="--sb-ratio:${frameRatio(board?.aspectRatio)}">${cells}</ol>` : '<p class="muted">No panels found.</p>'}</section>`;
}

function storyboardPanelsOf(boards) {
  return (boards || []).flatMap(board => (board?.panels || []).map((panel, index) => ({ board, panel, index, key: panelKey(board, panel, index) })));
}

export function currentPanelKey(boards, state = {}) {
  const all = storyboardPanelsOf(boards);
  if (!all.length) return null;
  if (all.some(item => item.key === state.slot)) return state.slot;
  return (all.find(item => !state.panels?.[item.key]?.verdict) || all[0]).key;
}

export function nextPanelKey(boards, state = {}, from = null) {
  const all = storyboardPanelsOf(boards);
  if (!all.length) return null;
  const at = Math.max(0, all.findIndex(item => item.key === from));
  for (let step = 1; step <= all.length; step += 1) {
    const item = all[(at + step) % all.length];
    if (!state.panels?.[item.key]?.verdict) return item.key;
  }
  return from;
}

// A saved panel or card change stays unsent until the decision carrying it reaches Claude (sent or already handled).
export function hasUnsentReviewChanges(state) {
  if (!state || state.submitted || state.settled) return false;
  const changed = saved => Object.values(saved || {}).some(item => item?.verdict === 'changes');
  return changed(state.panels) || changed(state.mediaPanels);
}

function notSentPill(state) {
  return state?.submitted || state?.settled ? '' : ' <span class="pill pending">Not sent yet</span>';
}

/**
 * What a message about one frame is about: "Frame 3" (a slide of a carousel), the storyboard file and the panel's name in it ("P3"). The
 * revision is added when the message starts, from the job the page shows.
 */
export function frameAbout(board, panel, index) {
  const path = trimmed(board?.path);
  const ref = panelRefOf(panel, index);
  return { label: `${board?.format === 'carousel' ? 'Slide' : 'Frame'} ${index + 1}`, ...(path ? { path, panel: ref } : {}) };
}
function frameAboutButton(board, panel, index, dis = '') {
  const about = frameAbout(board, panel, index);
  return `<button type="button" class="quiet" data-ab-open="@owner" data-ab-about="${esc(JSON.stringify(about))}" ${dis}>Message about this ${board?.format === 'carousel' ? 'slide' : 'frame'}</button>`;
}
/** The employee whose files hold `path` (the one who made it), else the Director. */
export function ownerOfFile(agents, path) {
  const owner = (Array.isArray(agents) ? agents : []).find(agent => agent?.id !== 'producer' && Array.isArray(agent.files) && agent.files.some(file => file?.path === path));
  return owner?.id || 'producer';
}
export function storyboardSlot(boards, state = {}, { disabled = false } = {}) {
  const all = storyboardPanelsOf(boards);
  if (!all.length) return '';
  const key = currentPanelKey(boards, state);
  const at = all.findIndex(item => item.key === key);
  const { board, panel, index } = all[at];
  const saved = state.panels?.[key] || {};
  const editing = state.panelEditing === key;
  const dis = disabled ? 'disabled' : '';
  const meta = [Number(panel?.durationSeconds) > 0 ? secondsWord(panel.durationSeconds) : '', PANEL_SOURCE_WORDS[panel?.source] || 'New'].filter(Boolean).join(' · ');
  const head = `<div class="sb-slot-head"><strong>${esc(panelLabelOf(panel, index))}</strong>${boards.length > 1 ? refTag(boardRefOf(board)) : ''}${refTag(panelRefOf(panel, index))}<span class="sb-source">${esc(meta)}</span><span class="sb-slot-step">${at + 1} of ${all.length}</span></div>`;
  // A panel counts as approved until the person asks for a change on it.
  const verdict = saved.verdict === 'changes'
    ? `<p class="sb-verdict is-changes">${CHANGE_ICON}<span>${esc(saved.note ? `Asked for changes: ${saved.note}` : 'Asked for changes')}</span>${notSentPill(state)}</p>`
    : `<p class="sb-verdict is-approved">${CHECK_ICON}<span>Approved</span></p>`;
  const error = editing && state.panelError ? `<p class="field-error" role="alert">${esc(state.panelError)}</p>` : '';
  const actions = editing
    ? `<div class="sb-change"><label for="sb-note">What should change in ${board?.format === 'carousel' ? 'this slide' : 'this panel'}?</label><textarea id="sb-note" name="sb_note" maxlength="1000" placeholder="For example: show the bottle in her hand." ${dis}>${esc(state.panelDraft ?? saved.note ?? '')}</textarea>${error}<div class="sb-slot-actions"><button type="button" class="quiet" data-sb-action="cancel-change" ${dis}>Cancel</button><button type="button" class="primary" data-sb-action="save-change" ${dis}>Ask for changes</button></div></div>`
    // With one panel there is nothing to go through: the storyboard's own Approve and Ask for changes are all there is.
    // "Message about this" opens a message to whoever made the storyboard, carrying the frame it is about (an About chip in the composer).
    : `<div class="sb-slot-actions">${all.length === 1 ? '' : `<button type="button" data-sb-action="change" ${dis}>Ask for changes</button>`}${frameAboutButton(board, panel, index, dis)}</div>`;
  const frame = panelFrameHtml(panel, index, { large: true });
  const image = frame.startsWith('<img') ? frame : '';
  const frameBox = image
    ? `<div class="sb-slot-frame">${safePreviewUrl(panel?.frame?.reviewUrl) && panel.frame.kind === 'image' ? `<button type="button" class="media-open" data-view-media="${esc(safePreviewUrl(panel.frame.reviewUrl))}" data-view-alt="${esc(panelLabelOf(panel, index))}" aria-label="Open ${esc(panelLabelOf(panel, index))} full size">${image}</button>` : image}</div>`
    : `<div class="sb-slot-frame is-empty${panel?.frame?.thumbOmitted ? ' is-omitted' : ''}">${frame}</div>`;
  return `<div class="sb-slot" style="--sb-ratio:${frameRatio(board?.aspectRatio)}">${frameBox}<div class="sb-slot-body">${head}${panelFields(panel, board)}${verdict}${actions}</div></div>`;
}

// Every panel counts as approved until the person asks for a change on it.
export function panelStates(boards, saved = {}) {
  return Object.fromEntries(storyboardPanelsOf(boards).map(item => [item.key, saved?.[item.key]?.verdict === 'changes' ? saved[item.key] : { verdict: 'approve', note: '' }]));
}

export function panelVerdicts(boards, verdicts = {}) {
  const multiple = (boards || []).length > 1;
  return storyboardPanelsOf(boards).filter(item => verdicts[item.key]?.verdict).map(item => {
    const saved = verdicts[item.key];
    const entry = { panel: panelRefOf(item.panel, item.index) };
    if (multiple && boardRefOf(item.board)) entry.deliverable = boardRefOf(item.board);
    entry.verdict = saved.verdict === 'changes' ? 'changes' : 'approve';
    if (entry.verdict === 'changes' && trimmed(saved.note)) entry.note = trimmed(saved.note);
    return entry;
  });
}

export function storyboardPanel(doc) {
  const boards = doc?.storyboards || [];
  if (!boards.length) return '';
  return `<section class="panel storyboard-panel" aria-labelledby="storyboard-title"><div class="section-head"><h2 id="storyboard-title">Storyboard</h2></div>${boards.map(board => storyboardStrip(board)).join('')}</section>`;
}

const SAMPLE_REST_WORDS = Object.freeze({ image: ['image', 'images'], video: ['video clip', 'video clips'] });

export function sampleRestWords(rest) {
  const parts = ['image', 'video'].map(kind => {
    const count = Number(rest?.[kind]) || 0;
    return count > 0 ? `${count} ${SAMPLE_REST_WORDS[kind][count === 1 ? 0 : 1]}` : '';
  }).filter(Boolean);
  return parts.join(' and ');
}

export function sampleView(doc) {
  const sample = doc?.review?.sample;
  if (!sample) return '';
  const boards = doc.storyboards || [];
  const found = storyboardPanelsOf(boards).find(item => trimmed(item.board?.ref) === trimmed(sample.deliverable) && panelRefOf(item.panel, item.index) === trimmed(sample.panel));
  const title = found ? panelLabelOf(found.panel, found.index) : 'Sample';
  const media = mediaTile({ kind: sample.kind, title: `${title} sample`, thumb: sample.thumb, poster: sample.poster, reviewUrl: sample.reviewUrl, durationSeconds: sample.durationSeconds }, { className: 'sample-frame' });
  const version = Number(sample.version) > 1 ? `<span class="count">Version ${esc(Number(sample.version))}</span>` : '';
  const head = `<div class="sb-slot-head"><strong>${esc(title)}</strong>${refTag(trimmed(sample.deliverable))}${refTag(trimmed(sample.panel))}${version}</div>`;
  const strips = boards.map(board => storyboardStrip(board, { highlight: found?.key || null })).join('');
  const count = storyboardPanelsOf(boards).length;
  const why = trimmed(found?.board?.sampleWhy);
  const looks = Array.isArray(found?.board?.looks) ? found.board.looks.filter(item => trimmed(item?.label) && trimmed(item?.text)) : [];
  const whyLine = why ? `<p class="sample-why"><strong>Why this panel:</strong> ${esc(why)}</p>` : '';
  const sets = looks.length
    ? `<div class="sample-sets"><p class="sample-sets-title">${esc(count > 1 ? `Sets the look for all ${count} panels. Check:` : 'Check:')}</p><ul>${looks.map(item => `<li><strong>${esc(trimmed(item.label))}:</strong> ${esc(trimmed(item.text))}</li>`).join('')}</ul></div>`
    : '';
  // Until the sample is approved the other panels have no picture yet, so they fold away and the card stays on the one picture.
  const rest = count > 1 && strips ? `<details class="sample-rest"><summary>${esc(`The other ${count - 1} panels, made after you approve this one`)}</summary>${strips}</details>` : strips;
  return `<div class="sample-view" style="--sb-ratio:${frameRatio(found?.board?.aspectRatio)}">${media}<div class="sb-slot-body">${head}${whyLine}${sets}${found ? panelFields(found.panel, found.board) : ''}</div></div>${rest}`;
}

// The pictures, the clips (older jobs) and the rough cut are each reviewed as a grid: one card per panel with its picture or player and the
// storyboard's words for it, and a per-card "Ask for changes" with a note. Every card counts as approved until a change is asked on
// it; "Approve all" sits under the grid. A change goes back to the named panels, and a redo of one is priced again first.
const MEDIA_GATE_IDS = new Set(['pictures', 'clips', 'cut', 'finish']);
const MEDIA_GATE_NOUNS = Object.freeze({ pictures: ['picture', 'pictures'], clips: ['clip', 'clips'], cut: ['video', 'videos'], finish: ['video', 'videos'] });
const mediaPanelKey = panel => `${trimmed(panel?.deliverable)}|${trimmed(panel?.panel)}`;
export const mediaPanelsOf = doc => (Array.isArray(doc?.review?.mediaSet?.panels) ? doc.review.mediaSet.panels : []);
const mediaPanelTitle = panel => trimmed(panel?.text?.label) || (trimmed(panel?.panel) === 'Cut' ? 'Rough cut' : trimmed(panel?.panel)) || 'Panel';

export function mediaPanelStates(doc, saved = {}) {
  return Object.fromEntries(mediaPanelsOf(doc).map(panel => {
    const key = mediaPanelKey(panel);
    return [key, saved?.[key]?.verdict === 'changes' ? saved[key] : { verdict: 'approve', note: '' }];
  }));
}

export function mediaSetView(doc, state = {}, { disabled = false } = {}) {
  const panels = mediaPanelsOf(doc);
  if (!panels.length) return '';
  const gate = doc.review.gate;
  const dis = disabled ? 'disabled' : '';
  const states = mediaPanelStates(doc, state.mediaPanels);
  const cards = panels.map(panel => {
    const key = mediaPanelKey(panel);
    const mine = states[key];
    const editing = state.mediaEditing === key;
    const title = mediaPanelTitle(panel);
    const media = mediaTile({ kind: panel.kind, title, thumb: panel.thumb, poster: panel.poster, reviewUrl: panel.reviewUrl, durationSeconds: panel.durationSeconds }, { className: 'sample-frame' });
    const version = Number(panel.version) > 1 ? `<span class="count">Version ${esc(Number(panel.version))}</span>` : '';
    const head = `<div class="sb-slot-head"><strong>${esc(title)}</strong>${refTag(trimmed(panel.deliverable))}${refTag(trimmed(panel.panel))}${version}</div>`;
    const verdict = mine.verdict === 'changes'
      ? `<p class="sb-verdict is-changes">${CHANGE_ICON}<span>${esc(mine.note ? `Asked for changes: ${mine.note}` : 'Asked for changes')}</span>${notSentPill(state)}</p>`
      : `<p class="sb-verdict is-approved">${CHECK_ICON}<span>Approved</span></p>`;
    const error = editing && state.mediaError ? `<p class="field-error" role="alert">${esc(state.mediaError)}</p>` : '';
    const actions = editing
      ? `<div class="sb-change"><label for="mr-note">What should change in ${esc(title)}?</label><textarea id="mr-note" name="mr_note" maxlength="1000" placeholder="For example: make the light warmer." ${dis}>${esc(state.mediaDraft ?? mine.note ?? '')}</textarea>${error}<div class="sb-slot-actions"><button type="button" class="quiet" data-mr-action="cancel" ${dis}>Cancel</button><button type="button" data-mr-action="save" data-mr-key="${esc(key)}" ${dis}>Ask for changes</button></div></div>`
      : `<div class="sb-slot-actions">${mine.verdict === 'changes' ? `<button type="button" class="quiet" data-mr-action="undo" data-mr-key="${esc(key)}" ${dis}>Keep as is</button>` : ''}<button type="button" data-mr-action="change" data-mr-key="${esc(key)}" ${dis}>Ask for changes</button></div>`;
    return `<article class="sb-slot media-card" style="--sb-ratio:${frameRatio(panel.board?.aspectRatio)}">${media}<div class="sb-slot-body">${head}${panel.text ? panelFields(panel.text, panel.board) : ''}${verdict}${actions}</div></article>`;
  }).join('');
  return `<div class="media-review-grid">${cards}</div>`;
}

export function labelCheckSection(check, accepted = {}, { disabled = false } = {}) {
  if (!check || check.state !== 'current') return '';
  const flags = Array.isArray(check.flags) ? check.flags : [];
  if (!flags.length) return '<p class="qc-clear">Labels and logos match.</p>';
  const dis = disabled ? 'disabled' : '';
  const items = flags.map(flag => {
    const on = Boolean(accepted[flag.id]);
    const still = safePreviewUrl(flag.still);
    const image = still ? `<button type="button" class="qc-still media-open" data-view-media="${esc(still)}" data-view-alt="Frame the label check flagged" aria-label="Open the flagged frame"><img src="${esc(still)}" alt="" loading="lazy"></button>` : '';
    const action = on
      ? `<span class="pill approved">Accepted</span><button type="button" class="sb-ask" data-flag-undo="${esc(flag.id)}" ${dis}>Undo</button>`
      : `<button type="button" data-flag-accept="${esc(flag.id)}" ${dis}>Accept as is</button>`;
    return `<li class="qc-flag${on ? ' is-accepted' : ''}">${image}<p>${esc(flag.text)}</p><div class="qc-actions">${action}</div></li>`;
  }).join('');
  return `<section class="qc-flags"><h3>Label check</h3><ul class="qc-list">${items}</ul></section>`;
}

// The checks on each post of a final post made from files the person supplied (review.checks). Approval runs the same
// ones, so what fails here is what would refuse it, and the card says so in the approve line.
export function suppliedChecksCard(checks, openKeys = new Set()) {
  const posts = (Array.isArray(checks?.posts) ? checks.posts : []).filter(post => post && Array.isArray(post.checks));
  if (!posts.length) return '';
  const rows = posts.map(post => `<article class="publish-post" role="listitem"><div class="publish-post-body"><div class="publish-post-head"><h4>${esc(post.label || 'Post')}</h4></div><div class="publish-check-list">${publishChecks({ checks: post.checks }, `final-checks:${post.id}`, openKeys)}</div></div></article>`).join('');
  return `<section class="supplied-checks" aria-label="Checks on each post"><h3>Checks</h3><div class="publish-posts" role="list">${rows}</div></section>`;
}

// The first thing the checks on a supplied post say is wrong, or null while every one passes.
function suppliedFirstProblem(checks) {
  for (const post of Array.isArray(checks?.posts) ? checks.posts : []) {
    const found = (post.checks || []).find(item => item && item.ok === false && typeof item.text === 'string');
    if (found) return found.text;
  }
  return null;
}

export function mediaTile(ref, { className = '' } = {}) {
  const name = esc(displayTitle(ref, 'Media'));
  const cls = `media-tile${className ? ` ${className}` : ''}`;
  if (ref?.kind === 'image') {
    const full = safePreviewUrl(ref.reviewUrl);
    const src = full || safePreviewUrl(ref.thumb);
    if (!src) return `<figure class="${cls}"><span class="media-none">${name}<small>Preview on your computer</small></span></figure>`;
    const image = `<img src="${esc(src)}" alt="${name}" loading="lazy">`;
    return `<figure class="${cls}">${full ? `<button type="button" class="media-open" data-view-media="${esc(full)}" data-view-alt="${name}" aria-label="Open ${name} full size">${image}</button>` : image}</figure>`;
  }
  if (ref?.kind === 'video') {
    const poster = safePreviewUrl(ref.poster);
    const duration = Number.isFinite(Number(ref.durationSeconds)) ? clock(Number(ref.durationSeconds) * 1000).replace(/^00:/, '') : '';
    const source = safePreviewUrl(ref.reviewUrl);
    if (source) return `<figure class="${cls} media-video"><video controls playsinline preload="metadata" src="${esc(source)}"${poster ? ` poster="${esc(poster)}"` : ''} aria-label="${name}"></video></figure>`;
    const body = poster
      ? `<img src="${esc(poster)}" alt="${name}, video poster frame" loading="lazy">`
      : `<span class="media-none">${name}<small>Video on your computer</small></span>`;
    return `<figure class="${cls} media-video">${body}${duration ? `<span class="media-duration">${esc(duration)}</span>` : ''}</figure>`;
  }
  return `<figure class="${cls}"><span class="media-none">${name}</span></figure>`;
}

export function postPreview(post) {
  const caption = String(post?.caption || '');
  const lines = caption.split(/\r?\n/);
  const hookIndex = lines.findIndex(line => line.trim());
  const rest = hookIndex >= 0 ? lines.slice(hookIndex + 1).join('\n').trim() : '';
  const postRef = typeof post?.deliverable === 'string' && post.deliverable.trim() ? post.deliverable.trim() : null;
  const title = deliverableLabel(post, 'Post');
  const media = post?.media || [];
  return `<article class="post-preview"><div class="post-head"><div class="post-title"><h3>${esc(title)}</h3>${refTag(postRef)}</div>${askForChanges(postRef)}</div>${media.length ? `<div class="media-grid">${media.map(ref => mediaTile(ref)).join('')}</div>` : ''}<dl class="review-fields">${post?.hook ? `<div><dt>Hook</dt><dd class="post-hook">${esc(post.hook)}</dd></div>` : ''}${rest ? `<div><dt>Post text</dt><dd class="post-caption">${esc(rest)}</dd></div>` : ''}${post?.cta ? `<div><dt>CTA</dt><dd>${esc(post.cta)}</dd></div>` : ''}${post?.hashtags?.length ? `<div><dt>Hashtags</dt><dd class="post-tags">${esc(post.hashtags.join(' '))}</dd></div>` : ''}</dl></article>`;
}

export function priceTable(quote, { used = null, withProvider = false } = {}) {
  const items = Array.isArray(quote?.items) ? quote.items : [];
  const rows = items.map(item => {
    const version = Number(item.version) > 1 ? `Redo, version ${Number(item.version)}` : '';
    const detail = [withProvider ? PRICE_PROVIDER_NAMES[item.provider] || '' : '', item.sample ? 'Sample' : '', version, item.detail || '', item.made ? 'Already made' : ''].filter(Boolean).join(' · ');
    const credits = creditNumber(item.credits);
    return `<tr><td><span class="price-item">${refTag(item.deliverable)}${refTag(item.panel)}<span>${esc(QUOTE_KIND_LABELS[item.kind] || humanize(item.kind))}</span></span>${detail ? `<small>${esc(detail)}</small>` : ''}</td><td class="num">${credits === null ? '<span class="muted">Not priced</span>' : esc(creditFigure(credits))}</td></tr>`;
  }).join('');
  const shown = PRICE_PROVIDERS.filter(provider => items.some(item => item.provider === provider) || (creditNumber(quote?.totals?.[provider]) || 0) > 0);
  const foot = (shown.length ? shown : ['threeEcho']).map(provider => `<tr><td>${esc(PRICE_TOTAL_LABELS[provider])}</td><td class="num">${esc(creditFigure(creditNumber(quote?.totals?.[provider]) || 0))}</td></tr>`).join('');
  const spent = { threeEcho: creditNumber(used?.threeEchoCredits?.spent) || 0, elevenLabs: creditNumber(used?.elevenLabsCredits?.spent) || 0 };
  const already = priceWords(spent);
  const facts = already ? `<dl class="price-facts"><div><dt>Already used on this job</dt><dd>${esc(already)}</dd></div></dl>` : '';
  return `<div class="price"><table class="price-table"><thead><tr><th>Item</th><th class="num">Credits</th></tr></thead><tbody>${rows || '<tr><td colspan="2" class="muted">Nothing is priced yet.</td></tr>'}</tbody><tfoot>${foot}</tfoot></table>${facts}</div>`;
}

// A storyboard that carries a price (review.quote, the same block the price card reads) is approved together with it.
export const pricedStoryboard = doc => doc?.review?.gate === 'storyboard' && Boolean(doc.review.quote);
const STORYBOARD_PRICED_LABEL = 'Approve and make the clips';

function redoLine(redo) {
  const perClip = creditNumber(redo?.perClip);
  const ceiling = creditNumber(redo?.ceiling);
  if (!perClip || perClip < 1 || !ceiling || ceiling < 1) return '';
  return `Includes up to ${creditFigure(perClip)} ${perClip === 1 ? 'redo' : 'redos'} per clip, up to ${creditFigure(ceiling)} extra ${ceiling === 1 ? 'credit' : 'credits'}.`;
}

// The sound plan already recorded for the video (the same `chosen` picks the cut card used to edit), shown read-only.
const SOUND_SOURCE_WORDS = Object.freeze({
  music: { library: 'From your library', upload: 'Your own track', make: 'Made for this video', none: 'None' },
  voice: { library: 'From your library', upload: 'Your own recording', make: 'Made for this video', none: 'None' },
  captions: { voice: 'From the voice-over words', script: 'From the script words', none: 'None' },
});
function soundSection(doc) {
  const chosen = doc?.combine?.chosen;
  if (!chosen || typeof chosen !== 'object') return '';
  const rows = [['voice', 'Voice-over'], ['music', 'Music'], ['captions', 'Captions']].map(([row, title]) => {
    const pick = chosen[row];
    const source = typeof pick === 'string' ? pick : pick?.source;
    const words = SOUND_SOURCE_WORDS[row][source];
    if (!words) return '';
    const name = typeof pick === 'object' && trimmed(pick.title) ? ` (${trimmed(pick.title)})` : '';
    return `<div><dt>${title}</dt><dd>${esc(words + name)}</dd></div>`;
  }).join('');
  return rows ? `<dl class="price-facts sound-plan">${rows}</dl>` : '';
}

// The price block under the storyboard panels: the price table, the redo line, the paying workspace, then the sound plan.
function storyboardPrice(project, doc, workspaceState, { disabled = false } = {}) {
  const review = doc.review;
  const redo = redoLine(review.redo);
  return `<section class="storyboard-price" aria-label="Price">${priceTable(review.quote, { used: project?.usage?.generation })}${redo ? `<p class="muted">${esc(redo)}</p>` : ''}${studioWorkspaceSection(doc, workspaceState, { disabled })}${soundSection(doc)}</section>`;
}

function studioWorkspaceBalanceWords(value) {
  const n = creditNumber(value);
  return n === null ? '' : `${creditFigure(n)} credit${n === 1 ? '' : 's'} available`;
}

export function studioWorkspaceRequired(doc) {
  const info = doc?.review?.studioWorkspace;
  return Boolean(info && !info.workspaceId && (info.workspaces || []).length > 1);
}

// `upload` is the same picker on the posting card, where the workspace is where the files go, not what pays.
export function studioWorkspaceSection(doc, state = {}, { disabled = false, upload = false } = {}) {
  const info = doc?.review?.studioWorkspace;
  const workspaces = Array.isArray(info?.workspaces) ? info.workspaces : [];
  if (!info) return '';
  if (!workspaces.length) return upload ? '<p class="muted">Loading your 3echo workspaces.</p>' : '';
  const busy = Boolean(state.busy);
  const submitted = Boolean(state.submitted);
  const locked = disabled || busy || submitted;
  const editing = Boolean(state.editing) || (!info.workspaceId && (workspaces.length > 1 || upload));
  if (!editing) {
    const balance = studioWorkspaceBalanceWords(info.creditAvailable);
    return `<div class="price-workspace"><p>${upload ? 'Files go to' : 'Paid from'}: <strong>${esc(info.name || 'A workspace')}</strong>${balance ? ` (${esc(balance)})` : ''}</p><button type="button" class="quiet" data-workspace-action="edit" ${disabled ? 'disabled' : ''}>Change</button></div>`;
  }
  const selected = state.selected || info.workspaceId || workspaces[0]?.id || '';
  const options = workspaces.map(item => {
    const balance = studioWorkspaceBalanceWords(item.creditAvailable);
    return `<option value="${esc(item.id)}" ${selected === item.id ? 'selected' : ''}>${esc(item.name)}${balance ? ` (${esc(balance)})` : ''}</option>`;
  }).join('');
  const label = upload ? (info.workspaceId ? 'Change the files workspace' : 'Choose the files workspace') : info.workspaceId ? 'Change which workspace pays' : 'Choose the paying workspace';
  const cancel = info.workspaceId ? `<button type="button" class="quiet" data-workspace-action="cancel" ${locked ? 'disabled' : ''}>Cancel</button>` : '';
  const brandOption = `<label class="price-workspace-scope"><input type="checkbox" name="studio_workspace_brand_default" ${state.brandDefault ? 'checked' : ''} ${locked ? 'disabled' : ''}> Also use this for every job from this brand</label>`;
  const error = state.error ? `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>` : '';
  const notice = !state.error && state.message ? `<p class="muted">${esc(state.message)}</p>` : '';
  return `<div class="price-workspace price-workspace-edit"><label for="studio-workspace-select">${esc(label)}</label><select id="studio-workspace-select" name="studio_workspace_select" ${locked ? 'disabled' : ''}>${options}</select>${brandOption}${error}${notice}<div class="review-buttons"><button type="button" class="primary" data-workspace-action="save" ${locked ? 'disabled' : ''}>${busy ? 'Saving...' : submitted ? TXT_WAITING_FOR_CLAUDE : 'Set workspace'}</button>${cancel}</div></div>`;
}

// @module publish
// The publish gate. Everything shown comes from `review.publish`, the projection the server builds from the
// posting plan the approval covers: the route and the routes on offer, where posts go, and one row per post.
// Ids never reach the page as words, only the text the projection carries.
export const PUBLISH_APPROVE_LABELS = Object.freeze({
  metricool_now: () => 'Approve and post now',
  metricool_schedule: () => 'Approve and schedule',
  metricool_draft: () => 'Approve and save as a draft',
  self: () => 'Approve and download',
});
// The self route's button while the posting kit is not ready yet.
export const PUBLISH_PREPARING_LABEL = 'Preparing download…';
// The board click is the person's approval for every route: nothing else is asked in chat.
export const PUBLISH_SAFETY_LINES = Object.freeze({
  metricool_now: 'Post now sends each post to Metricool right away. It goes out within minutes.',
  metricool_schedule: 'Nothing goes out until you approve. You can cancel in Metricool until then.',
  metricool_draft: 'Drafts stay in Metricool until you publish them.',
  self: 'Nothing is posted for you. The posting kit has each file, the post text and each step.',
});
export const PUBLISH_ROUTE_WORDS = Object.freeze({
  metricool_now: 'Post now',
  metricool_schedule: 'Schedule a post',
  metricool_draft: 'Save as a draft',
  self: "I'll post it myself",
});
export const PUBLISH_OUTDATED_LINE = "The plan is being rebuilt.";
export const PUBLISH_CHANGED_LINE = "The plan is being rebuilt.";
// While any posting-card request is out (a route, a post type or a posting time), the card says so once, at its top, and every
// control on it is held. The rows say the plan is being updated; nothing else on the card says "saving".
export const PUBLISH_SAVING_LINE = 'Saving your choice...';
export const PUBLISH_UPDATING_LINE = 'Updating the plan...';
export const PUBLISH_WAITING_LINE = "Waiting for Claude to save this.";
export const PUBLISH_SAVED_LINE = "Saved. The board will update shortly.";
/** The pause after an arrow key before the route it landed on is saved. */
export const PUBLISH_ROUTE_KEY_PAUSE_MS = 700;

/** The request a route choice sends: exactly these four fields (the transport adds the workspace). */
export function publishRouteArgs({ project, route, requestId }) {
  return { requestId, brand: project.brand, jobId: project.jobId, route };
}

export const POST_TYPE_NEEDED_LINE = 'Choose a post type first.';

/** The request a post type choice sends: exactly these five fields (the transport adds the workspace). */
export function postTypeArgs({ project, deliverable, placement, requestId }) {
  return { requestId, brand: project.brand, jobId: project.jobId, deliverable, placement };
}

/**
 * The request a posting time choice sends: exactly these five fields (the transport adds the workspace). `dateTime` is
 * `YYYY-MM-DDTHH:MM` in the plan's zone. With no `deliverable` it is the same time for every post, and that field is left out.
 */
export function postTimeArgs({ project, deliverable, dateTime, requestId }) {
  return { requestId, brand: project.brand, jobId: project.jobId, ...(deliverable ? { deliverable } : {}), dateTime };
}

export const POST_TIME_NEEDED_LINE = 'Choose a date and time.';
/** The soonest a scheduled post may be, as the server holds it. */
export const POST_TIME_LEAD_MINUTES = 5;
const POST_TIME_VALUE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function zoneOffsetMs(zone, instant) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant));
  const get = type => Number(parts.find(part => part.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(instant / 1000) * 1000;
}

/**
 * Why a time typed into the card cannot be sent, in the words the server uses, or '' when it can: it has to be a real date and
 * time in the zone the card shows (the one a saved time keeps), at least five minutes ahead. The server checks again; this only saves the wait for an answer that is
 * already known.
 */
export function postTimeProblem(value, { zone, zoneWords = '', now = Date.now() } = {}) {
  const match = typeof value === 'string' ? POST_TIME_VALUE.exec(value) : null;
  if (!match || typeof zone !== 'string' || !zone) return POST_TIME_NEEDED_LINE;
  const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let instant = null;
  try {
    instant = guess - zoneOffsetMs(zone, guess);
    instant = guess - zoneOffsetMs(zone, instant);
    const back = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(instant));
    const part = type => back.find(item => item.type === type)?.value;
    if (`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}` !== value) {
      // A time on the calendar that comes back different is one the clocks skip (spring forward); anything else is not a date.
      return new Date(guess).toISOString().slice(0, 16) === value ? `That time doesn't exist in ${zoneWords || zone} because the clocks change.` : POST_TIME_NEEDED_LINE;
    }
  } catch { return POST_TIME_NEEDED_LINE; }
  if (instant < now) return `Pick a time at least ${POST_TIME_LEAD_MINUTES} minutes ahead.`;
  if (instant < now + POST_TIME_LEAD_MINUTES * 60 * 1000) return `That time is less than ${POST_TIME_LEAD_MINUTES} minutes away. Pick a time at least ${POST_TIME_LEAD_MINUTES} minutes ahead.`;
  return '';
}

export function publishApproveLabel(route, count) {
  const make = PUBLISH_APPROVE_LABELS[route] || PUBLISH_APPROVE_LABELS.self;
  return make(count);
}

/** The route the person picked that the projection has not caught up with yet, or null. */
export function publishRoutePending(publish, routeState = {}) {
  const wanted = routeState?.pending;
  if (!wanted || !publish || publish.route === wanted) return null;
  return wanted;
}

/** The post requests that belong to the posting card: a post type or a posting time. An answer or a Mark as posted lives in the status list and the kit. */
const POST_CARD_KINDS = new Set(['type', 'time']);

/**
 * The request that holds the whole posting card, or null: a route choice the plan has not caught up with, else a post type or a
 * posting time still being saved. One request at a time, so the first found is the one the card waits on. `state` is that
 * request's own state (it carries the wait and the receipt).
 */
export function publishPending(publish, routeState = {}, postStates = {}) {
  if (publishRoutePending(publish, routeState)) return { kind: 'route', state: routeState };
  for (const [id, state] of Object.entries(postStates && typeof postStates === 'object' ? postStates : {})) {
    if (state?.pending && POST_CARD_KINDS.has(state.kind)) return { kind: state.kind, id, state };
  }
  return null;
}

// The one line that says a card request is out, at the top of the card: "Saving your choice...", or, once nobody has picked it up
// for a while, the same soft notice a decision gets (Notify Claude, Remind Claude). The same wait covers a request Claude has not
// picked up and one it saved whose updated plan has not arrived.
function publishSavingLine(pending, { signal = {}, now = Date.now() } = {}) {
  if (!pending) return '';
  const state = pending.state || {};
  const waiting = Boolean(state.requestId) && Number.isFinite(state.submittedAt) && now - state.submittedAt >= REMIND_DELAY_MS;
  if (waiting) return notifyClaudeNotice({ ...state, message: state.applied ? PUBLISH_SAVED_LINE : PUBLISH_WAITING_LINE }, signal, now);
  return `<p class="publish-busy publish-saving" role="status">${esc(PUBLISH_SAVING_LINE)}</p>`;
}

// What a post's own request left behind once it ended: the decline said in place, or the error, under the control it came from.
function postEndedLine(state, kind) {
  if (!state || state.pending || state.endedKind !== kind) return '';
  if (state.error) return `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>`;
  if (state.notice) return `<p class="publish-route-note" role="status">${esc(state.notice)}</p>`;
  return '';
}

const publishFailing = post => (Array.isArray(post?.checks) ? post.checks : []).filter(item => item && item.ok === false);

function publishRoutes(publish, routeState, { locked = false, held: otherHeld = false } = {}) {
  const routes = Array.isArray(publish.routes) ? publish.routes : [];
  // With only one way to go (a job planned before 0.8) there is nothing to choose, so no group is drawn.
  if (routes.length < 2) return '';
  const pending = publishRoutePending(publish, routeState);
  const selected = pending || routeState?.draft || publish.route;
  const reasons = [...new Set(routes.filter(item => item.available === false && item.reason).map(item => item.reason))];
  const held = locked || otherHeld || Boolean(pending);
  // A route that cannot be used is truly disabled. While anything on the card is saving the radios only say so with
  // aria-disabled, so keyboard focus stays on the group.
  const cards = routes.map(item => {
    const off = item.available === false;
    const attrs = [selected === item.id ? 'checked' : '', off ? 'disabled' : '', held && !off ? 'aria-disabled="true"' : '', off && reasons.length ? 'aria-describedby="publish-route-reason"' : ''].filter(Boolean).join(' ');
    return `<label class="route-card${off ? ' route-off' : ''}"><input type="radio" class="visually-hidden" name="publish_route" value="${esc(item.id)}" ${attrs}><span class="route-body"><span class="route-radio" aria-hidden="true"></span><span class="route-text"><strong>${esc(PUBLISH_ROUTE_WORDS[item.id] || item.label)}</strong></span></span></label>`;
  }).join('');
  const why = reasons.length ? `<p class="route-reason" id="publish-route-reason">${reasons.map(esc).join(' ')}</p>` : '';
  // The saving state is the card's, said once at its top. What is left here is how the last try ended: an error under the
  // choices, or a decline in the words the server gave.
  let status = '';
  if (pending || otherHeld) status = '';
  else if (routeState?.error) status = `<p class="notice error inline-error" role="alert">${esc(routeState.error)}</p>`;
  else if (routeState?.notice) status = `<p class="publish-route-note" role="status">${esc(routeState.notice)}</p>`;
  return `<fieldset class="publish-routes"><legend>How should posts go out?</legend><div class="route-grid">${cards}</div>${why}${status}</fieldset>`;
}

// Where the posts go, said before anything is approved: one line per network ("Instagram @coachfabian, through Metricool brand Coach Fabian"),
// read from the brand's own saved Metricool link. A post whose link is missing, gone or refused by the posting check gets a plain
// warning in its place. "Change" switches the BRAND's Metricool brand (the same pick as on the brand card, never a per-job choice) and the
// plan is rebuilt and has to be approved again; `metricool` carries the picker's state: { slug, brands, current, open, busy, selected, error }.
function publishDestination(publish, { metricool = null, locked = false } = {}) {
  const lines = [];
  const destinations = (Array.isArray(publish.posts) ? publish.posts : []).map(post => post?.destination).filter(item => item && typeof item === 'object' && typeof item.text === 'string' && item.text);
  const seen = new Set();
  for (const item of destinations) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    lines.push(item.ok === false
      ? `<li class="publish-destination-warn metricool-warning" role="alert">${esc(item.text)}</li>`
      : `<li>${esc(item.text)}${item.warn && typeof item.warning === 'string' && item.warning ? `<span class="publish-destination-warning metricool-warning" role="note">${esc(item.warning)}</span>` : ''}</li>`);
  }
  if (!destinations.length && publish.metricool?.label) lines.push(`<li>Posts go to Metricool brand <strong>${esc(publish.metricool.label)}</strong></li>`);
  if (publish.studioWorkspace?.name) lines.push(`<li>Media is uploaded to your 3echo workspace <strong>${esc(publish.studioWorkspace.name)}</strong></li>`);
  const onMetricool = destinations.length > 0 || Boolean(publish.metricool?.label);
  const list = lines.length ? `<ul class="publish-destination">${lines.join('')}</ul>` : '';
  return list + (onMetricool ? metricoolChange(metricool, destinations.some(item => item.ok === false), locked) : '');
}

// The Change control (or the picker it opens) under the destination lines. Nothing while the card is held or approved, when
// Metricool lists no other brand to move to, or when the board has no brand to save the pick on.
function metricoolChange(metricool, _refused, locked) {
  if (!metricool || !metricool.slug || locked) return '';
  const brands = Array.isArray(metricool.brands) ? metricool.brands : [];
  if (metricool.open) return metricoolPickerForm({ slug: metricool.slug, brands, current: metricool.current || '', selected: metricool.selected || '', busy: Boolean(metricool.busy), error: metricool.error || '', cancel: true });
  // Even a single saved Metricool brand leaves "Not through Metricool" to move to.
  if (!brands.length) return '';
  return `<p class="publish-destination-change"><button type="button" class="quiet" data-metricool-change="${esc(metricool.slug)}">Change</button><span class="muted"> the Metricool brand. The plan is rebuilt and needs approval again.</span></p>`;
}

function publishChecks(post, key = '', openKeys = new Set()) {
  const checks = Array.isArray(post?.checks) ? post.checks.filter(item => item && typeof item.text === 'string') : [];
  const failing = checks.filter(item => item.ok === false);
  // A warning lets the post go but is always shown in full, in amber, never counted among the passed checks.
  const warned = checks.filter(item => item.ok !== false && item.warn === true);
  const passed = checks.filter(item => item.ok !== false && item.warn !== true);
  const warnings = warned.length ? `<ul class="publish-warnings">${warned.map(item => `<li class="metricool-warning publish-check-warn" role="note"><span class="visually-hidden">Check this: </span>${esc(item.text)}</li>`).join('')}</ul>` : '';
  const passedList = passed.map(item => `<li>${esc(item.text)}</li>`).join('');
  const open = `data-open-key="${esc(key)}"${openKeys.has(key) ? ' open' : ''}`;
  // A post still waiting for its post type is not ready, whatever else passed.
  const needsType = Array.isArray(post?.typeChoices) && post.typeChoices.length > 0;
  if (!failing.length && needsType) return warnings + (passed.length ? `<details class="publish-ready publish-passed" ${open}><summary>${passed.length === 1 ? '1 check passed' : `${passed.length} checks passed`}</summary><ul>${passedList}</ul></details>` : '');
  if (!failing.length) {
    const tick = '<span class="publish-mark publish-mark-ok" aria-hidden="true"></span>';
    return warnings + (passed.length
      ? `<details class="publish-ready" ${open}><summary>${tick}Ready</summary><ul>${passedList}</ul></details>`
      : `<p class="publish-ready">${tick}Ready</p>`);
  }
  const problems = `<ul class="publish-problems">${failing.map(item => `<li><span class="publish-mark publish-mark-bad" aria-hidden="true"></span><span><span class="visually-hidden">Needs attention: </span>${esc(item.text)}</span></li>`).join('')}</ul>`;
  const rest = passed.length ? `<details class="publish-ready publish-passed" ${open}><summary>${passed.length === 1 ? '1 other check passed' : `${passed.length} other checks passed`}</summary><ul>${passedList}</ul></details>` : '';
  return problems + warnings + rest;
}

// The text that goes out, exactly as it will post: line breaks kept, collapsed or opened. Text that is short and on one
// line is plain. Anything longer gets two lines (the browser cuts it with an ellipsis) and its own button; the button,
// not the text, is what a screen reader reads as the control. A draw that finds the text fits drops the button.
function publishText(value, key, what, openKeys) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (text.length <= 110 && !/\n/.test(text)) return `<p class="publish-text-plain">${esc(text)}</p>`;
  const open = openKeys.has(key);
  return `<div class="publish-text${open ? ' is-open' : ''}"><p class="publish-text-preview">${esc(text)}</p><button type="button" class="quiet publish-toggle" data-publish-toggle="${esc(key)}" aria-expanded="${open ? 'true' : 'false'}" aria-label="${open ? 'Show less' : 'Show all'} of the ${what}">${open ? 'Show less' : 'Show all'}</button></div>`;
}

// The media tiles for one planned post, the same players and thumbnails the deliverable cards use. A planned post names
// its deliverable and the job-relative path of each file; the file is looked up among that deliverable's media first and
// then by path among all of them. A file with no card shows nothing.
export function publishPreviews(review, post, used = new Set()) {
  const wanted = (Array.isArray(post?.media) ? post.media : []).map(item => item?.path).filter(path => typeof path === 'string' && path);
  if (!wanted.length) return '';
  const own = (review?.posts || []).filter(item => post?.deliverable && item?.deliverable === post.deliverable).flatMap(item => item.media || []);
  const all = [...(review?.posts || []).flatMap(item => item.media || []), ...(review?.media || [])];
  return wanted.map(path => {
    const ref = own.find(item => item?.path === path) || all.find(item => item?.path === path);
    if (!ref) return '';
    used.add(ref.path);
    return mediaTile(ref);
  }).filter(Boolean).join('');
}

// A post planned before post types existed has none, and nothing else lets the person choose one: a compact select of
// only the types its media can be, with a Save button (a select changes as an arrow key passes over it, so nothing is sent
// until Save). While any request on the card is out the select and Save are held with aria-disabled, like the route group;
// the card says "Saving your choice..." once at its top. A decline or an error is said here, under the control it came from.
function postTypeBlock(post, state, ctx) {
  const kinds = (Array.isArray(post?.typeChoices) ? post.typeChoices : []).filter(item => item && typeof item.value === 'string' && typeof item.label === 'string');
  if (!kinds.length) return '';
  const id = post.id ?? '';
  const hold = ctx.locked ? 'disabled' : ctx.held ? 'aria-disabled="true"' : '';
  const picked = kinds.some(item => item.value === state?.typePick) ? state.typePick : '';
  const field = `publish-type-${esc(id)}`;
  const problem = state?.typeError ? `<p class="field-error" id="${field}-error" role="alert">${esc(state.typeError)}</p>` : '';
  return `<div class="publish-type"><label for="${field}">Post type</label><div class="publish-type-row"><select id="${field}" name="publish_type:${esc(id)}" data-post-type="${esc(id)}" ${hold}${state?.typeError ? ` aria-invalid="true" aria-describedby="${field}-error"` : ''}>${placementOptionsHtml(kinds, picked)}</select><button type="button" data-post-type-save="${esc(id)}" ${hold}>Save</button></div>${problem}${postEndedLine(state, 'type')}</div>`;
}

// "When". On the Schedule route the projection carries `when.input` (the zone the time is read in, how that zone is said, and the
// time now set as YYYY-MM-DDTHH:MM): a post with no time shows a date and time input open, with the zone named under it; a post
// with a time shows it with a Change button that opens the same input. The input has its own Save, like the post type select:
// nothing is sent while a date is being picked. Any other route has nothing to choose here and shows the text alone.
const whenInputOf = post => (post?.when?.input && typeof post.when.input === 'object' && typeof post.when.input.zone === 'string' && post.when.input.zone ? post.when.input : null);
// Whether the time shows its input (no time yet, or Change was pressed) rather than its text.
const whenEditing = (post, state, usesAll = false) => { const input = whenInputOf(post); if (!input) return false; const set = typeof input.dateTime === 'string' && input.dateTime !== ''; return state?.timeOpen === true || (!set && !usesAll); };

function postWhen(post, state, ctx) {
  const when = post?.when && typeof post.when === 'object' ? post.when : {};
  const text = typeof when.text === 'string' ? when.text : '';
  const input = whenInputOf(post);
  if (!input) return text ? esc(text) : '<span class="muted">Not set</span>';
  const id = post.id ?? '';
  const set = typeof input.dateTime === 'string' && input.dateTime !== '';
  const hold = ctx.locked ? 'disabled' : ctx.held ? 'aria-disabled="true"' : '';
  if (!whenEditing(post, state, ctx.usesAll)) return `<span class="publish-when-set"><span class="publish-when-text">${set ? esc(text) : 'Uses the time above'}</span><button type="button" class="quiet publish-when-change" data-post-time-open="${esc(id)}" ${hold}>Change</button></span>${postEndedLine(state, 'time')}`;
  const field = `publish-time-${esc(id)}`;
  const words = typeof input.zoneWords === 'string' && input.zoneWords ? input.zoneWords : input.zone;
  // The label line names the zone: the draft's own sentence (it names the zone itself), else the zone alone.
  const note = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : words;
  const value = typeof state?.timePick === 'string' && state.timePick ? state.timePick : set ? input.dateTime : '';
  const problem = state?.timeError ? `<p class="field-error" id="${field}-error" role="alert">${esc(state.timeError)}</p>` : '';
  const cancel = set ? `<button type="button" class="quiet" data-post-time-cancel="${esc(id)}" ${hold}>Cancel</button>` : '';
  return `<div class="publish-when-edit"><label class="publish-when-label" for="${field}">${esc(note)}</label><div class="publish-when-row"><input type="datetime-local" id="${field}" name="publish_time:${esc(id)}" data-post-time="${esc(id)}" data-zone="${esc(input.zone)}" value="${esc(value)}" step="60"${state?.timeError ? ` aria-invalid="true" aria-describedby="${field}-error"` : ''} ${hold}><button type="button" data-post-time-save="${esc(id)}" ${hold}>Save</button>${cancel}</div>${problem}${postEndedLine(state, 'time')}</div>`;
}

// The card-level "same time for every post": under the route choice, on Schedule and Draft with two or more posts. It is the
// main control while no post has a time (each row then says "Uses the time above" and keeps its own Change, to override just that
// post); with one shared time it shows that time with Change; with different times it says so and offers one time for all. The
// zone is named in its label. It follows the post's own field in everything else: its own Save, held while anything is saving.
export const ALL_POSTS = '__all';

function allTimeBlock(publish, state, ctx) {
  const all = publish?.allTime && typeof publish.allTime === 'object' && typeof publish.allTime.zone === 'string' && publish.allTime.zone ? publish.allTime : null;
  if (!all) return '';
  const hold = ctx.locked ? 'disabled' : ctx.held ? 'aria-disabled="true"' : '';
  const field = 'publish-time-all';
  let body;
  if (all.state !== 'none' && state?.timeOpen !== true) {
    const text = all.state === 'shared' ? esc(all.text) : 'Posts have different times';
    const button = all.state === 'shared' ? 'Change' : 'Set one time for all';
    body = `<span class="publish-when-set"><span class="publish-when-text">${text}</span><button type="button" class="quiet publish-when-change" data-post-time-open="${ALL_POSTS}" ${hold}>${button}</button></span>`;
  } else {
    const value = typeof state?.timePick === 'string' && state.timePick ? state.timePick : all.dateTime || '';
    const problem = state?.timeError ? `<p class="field-error" id="${field}-error" role="alert">${esc(state.timeError)}</p>` : '';
    const cancel = all.state !== 'none' ? `<button type="button" class="quiet" data-post-time-cancel="${ALL_POSTS}" ${hold}>Cancel</button>` : '';
    const label = typeof all.label === 'string' && all.label.trim() ? all.label.trim() : `Same time for every post, ${all.zoneWords || all.zone}`;
    body = `<div class="publish-when-edit"><label class="publish-when-label" for="${field}">${esc(label)}</label><div class="publish-when-row"><input type="datetime-local" id="${field}" name="publish_time:${ALL_POSTS}" data-post-time="${ALL_POSTS}" data-zone="${esc(all.zone)}" value="${esc(value)}" step="60"${state?.timeError ? ` aria-invalid="true" aria-describedby="${field}-error"` : ''} ${hold}><button type="button" data-post-time-save="${ALL_POSTS}" ${hold}>Save</button>${cancel}</div>${problem}</div>`;
  }
  return `<div class="publish-all-time"><h4 class="publish-all-title">Posting time</h4>${body}${postEndedLine(state, 'time')}</div>`;
}

/** What the plan shows for the time a request is waiting on, so the card can tell when it has arrived: one post's time, or every post's together. */
function timeSignature(publish, postId) {
  const posts = Array.isArray(publish?.posts) ? publish.posts : [];
  const timeOf = post => (typeof post?.when?.input?.dateTime === 'string' ? post.when.input.dateTime : '');
  return postId === ALL_POSTS ? posts.map(timeOf).join('|') : timeOf(posts.find(post => post?.id === postId));
}

// The pictures of one post. Several of them (a carousel) are a small strip, in the order they are posted.
export function postMedia(preview) {
  if (!preview) return '';
  const tiles = (String(preview).match(/<figure class="media-tile/g) || []).length;
  return tiles > 1 ? `<div class="publish-post-media is-strip" role="group" aria-label="Pictures, in the order they are posted">${preview}</div>` : `<div class="publish-post-media">${preview}</div>`;
}

function publishPostRow(post, jobId = '', openKeys = new Set(), preview = '', ctx = {}) {
  const ref = `${jobId}:${post.id ?? ''}`;
  const caption = publishText(post.text ?? post.caption, `publish-text:${ref}`, 'post text', openKeys);
  const first = publishText(post.firstComment, `publish-first:${ref}`, 'first comment', openKeys);
  const titleText = publishText(post.title, `publish-title:${ref}`, 'TikTok title', openKeys);
  const title = titleText ? `<div class="publish-wide"><dt>TikTok title</dt><dd>${titleText}</dd></div>` : '';
  const media = (Array.isArray(post.media) ? post.media : []).map(item => item?.name).filter(Boolean);
  // While a request on the card is out, every row shows the plan as it was, muted, and says it is being updated in place of its checks.
  const updating = Boolean(ctx.held);
  const checks = updating ? `<p class="publish-updating">${esc(PUBLISH_UPDATING_LINE)}</p>` : publishChecks(post, `publish-checks:${ref}`, openKeys);
  return `<article class="publish-post${preview ? ' has-preview' : ''}${updating ? ' is-updating' : ''}" role="listitem"${updating ? ' aria-busy="true"' : ''}>${postMedia(preview)}<div class="publish-post-body"><div class="publish-post-head"><h4>${esc(post.label || 'Post')}</h4>${post.account ? `<span class="publish-account">${esc(post.account)}</span>` : ''}</div><dl class="publish-facts"><div${whenEditing(post, ctx.state, ctx.usesAll) ? ' class="publish-when-fact"' : ''}><dt>When</dt><dd>${postWhen(post, ctx.state, ctx)}</dd></div><div><dt>Media</dt><dd>${media.length ? esc(media.join(', ')) : '<span class="muted">None</span>'}</dd></div>${post.aiLabel ? `<div><dt>AI label</dt><dd>${esc(post.aiLabel)}</dd></div>` : ''}${title}${caption ? `<div class="publish-wide"><dt>Post text</dt><dd>${caption}</dd></div>` : ''}${first ? `<div class="publish-wide"><dt>First comment</dt><dd>${first}</dd></div>` : ''}</dl><div class="publish-check-list">${postTypeBlock(post, ctx.state, ctx)}${checks}</div></div></article>`;
}

// A job planned before posting through Metricool says plainly that it ends with the hand-off package.
export const publishNoteLine = note => (typeof note === 'string' && note.trim() ? `<p class="publish-note muted">${esc(note.trim())}</p>` : '');

// The music the video was finished with, at the final approval: document.music is { title, source, licence } or { none: true }.
export function musicLine(music) {
  if (!music || typeof music !== 'object') return '';
  if (music.none === true) return '<p class="publish-note music-line muted">No music</p>';
  const title = trimmed(music.title);
  if (!title) return '';
  const where = music.source === 'brand' ? ' (your library)' : music.source === 'job' ? ' (added for this post)' : '';
  return `<p class="publish-note music-line muted">${esc(`Music: ${title}${where}`)}</p>`;
}

export function publishCard(publish, routeState = {}, { disabled = false, openKeys = new Set(), note = '', jobId = '', signal = {}, now = Date.now(), previews = null, postStates = {}, metricool = null } = {}) {
  if (!publish || typeof publish !== 'object') return '';
  const posts = Array.isArray(publish.posts) ? publish.posts : [];
  // Anything pending (a route, a post type or a posting time) holds the whole card: one saving line at the top, every control
  // held, every row muted.
  const pending = publishPending(publish, routeState, postStates);
  const held = Boolean(pending);
  const rows = posts.length ? `<div class="publish-posts" role="list">${posts.map(post => publishPostRow(post, jobId, openKeys, typeof previews === 'function' ? previews(post) : '', { state: postStates?.[post.id], signal, now, locked: disabled, held, usesAll: publish.allTime?.state === 'none' })).join('')}</div>` : '<p class="muted">No posts in this plan yet.</p>';
  return `<div class="publish-card"${held ? ' aria-busy="true"' : ''}>${publishSavingLine(pending, { signal, now })}${publishNoteLine(note)}${publishRoutes(publish, routeState, { locked: disabled, held })}${allTimeBlock(publish, postStates?.[ALL_POSTS], { locked: disabled, held })}${publishDestination(publish, { metricool, locked: disabled || held })}${rows}</div>`;
}

/**
 * The Approve button's wording and, when it cannot be pressed, why. The wording follows the plan as the board shows it, never a
 * choice still being saved, and the button stays held while anything on the card is pending.
 */
export function publishApproval(publish, routeState = {}, postStates = {}) {
  if (!publish || typeof publish !== 'object') return { disabled: true, label: 'Approve', line: 'Preparing the posting plan.' };
  const pending = publishPending(publish, routeState, postStates);
  const posts = Array.isArray(publish.posts) ? publish.posts : [];
  const route = Object.hasOwn(PUBLISH_APPROVE_LABELS, publish.route) ? publish.route : 'self';
  const label = publishApproveLabel(route, posts.length);
  const safety = PUBLISH_SAFETY_LINES[route];
  // The posting kit is not ready while the plan is being rebuilt or is not ready yet: the button says so and stays held.
  const preparing = route === 'self' ? PUBLISH_PREPARING_LABEL : label;
  // While a choice is saving, the card says so at its top; the button is only held.
  if (pending) return { disabled: true, label: preparing, line: '', safety };
  // An arrow-key pick waiting to be saved: the button is held so a click cannot approve the route the card still shows.
  if (routeState?.draft && routeState.draft !== publish.route) return { disabled: true, label: preparing, line: '', safety };
  if (publish.outdated) return { disabled: true, label: preparing, line: typeof publish.reason === 'string' && publish.reason.trim() ? publish.reason.trim() : PUBLISH_OUTDATED_LINE, safety };
  if (publish.changed) return { disabled: true, label: preparing, line: PUBLISH_CHANGED_LINE, safety };
  if (!posts.length) return { disabled: true, label: preparing, line: 'No posts to approve yet.', safety };
  if (!publish.ready) {
    const failing = posts.filter(post => publishFailing(post).length || (Array.isArray(post?.typeChoices) && post.typeChoices.length)).length;
    return { disabled: true, label: route === 'self' ? preparing : label, line: failing ? `${failing === 1 ? '1 post needs' : `${failing} posts need`} attention before this can be approved.` : 'Not ready to approve yet.', safety };
  }
  // Approve and schedule stays held until every post has a valid time (its own, or the one for all).
  if (route === 'metricool_schedule') {
    const unset = posts.filter(post => { const input = whenInputOf(post); return Boolean(input) && !(typeof input.dateTime === 'string' && input.dateTime); }).length;
    if (unset) return { disabled: true, label, line: POST_TIME_NEEDED_LINE, safety };
  }
  return { label, line: '', safety };
}

// ---------------------------------------------------------------------------------------------------------------
// After the posting plan is approved: where each post stands (sent through Metricool), or the posting kit (the person
// posts it themselves). Everything shown comes from the job document's `publishStatus` and `postingKit`; ids only ever
// travel as control values, never as words.
// ---------------------------------------------------------------------------------------------------------------
export const POST_STATUS_WORDS = Object.freeze({
  not_sent: 'Not sent yet',
  unconfirmed: 'Sending (unconfirmed)',
  needs_check: 'Waiting for your answer',
  handed_over: 'Waiting for you to post',
  scheduled: 'Scheduled',
  draft: 'Saved as a draft in Metricool',
  waiting_in_app: 'Waiting in the Metricool app',
  posted: 'Posted',
  failed: 'Failed',
  late: 'Late',
  check_in_metricool: 'Check in Metricool',
  marked: 'Posted by you',
});
const POST_STATUS_TONES = Object.freeze({ marked: 'go', handed_over: 'tape', not_sent: 'dim', unconfirmed: 'wait', needs_check: 'tape', scheduled: 'go', draft: 'wait', waiting_in_app: 'tape', posted: 'go', failed: 'hold', late: 'tape', check_in_metricool: 'tape' });
const POST_STATUS_NOTES = Object.freeze({ late: 'Still pending after its time.' });
export const POST_CHECK_QUESTION = 'Is this post in Metricool?';
export const POST_IN_METRICOOL = 'It is in Metricool';
export const POST_NOT_IN_METRICOOL = 'It is not in Metricool';
export const POST_ANSWER_SAVING_LINE = 'Saving your answer...';
export const POST_ANSWER_WAITING_LINE = "Waiting for Claude to save this.";
export const POST_ANSWER_SAVED_LINE = "Saved. The board will update shortly.";
export const POST_MARK_SAVING_LINE = 'Saving...';
export const POST_MARK_WAITING_LINE = "Waiting for Claude to save this.";
export const POST_MARK_SAVED_LINE = "Saved. The board will update shortly.";
export const KIT_LINK_LIMIT = 500;
export const KIT_COPIED_MS = 2000;
export const KIT_DOWNLOAD_WAITING = 'Preparing the download link';
export const KIT_PARTIAL_DONE = 'All marked as posted.';
export const KIT_PARTIAL_INTRO = 'Post each one yourself, then mark it posted.';
export const KIT_INTRO = 'Nothing is posted for you. Download, copy the post text, post, then mark it posted.';

/** The request an answer to "Is this post in Metricool?" sends: exactly these six fields (the transport adds the workspace). `lid` is the attempt the answer is for, as the status row carries it. */
export function resolvePostArgs({ project, postId, answer, requestId, lid }) {
  return { requestId, brand: project.brand, jobId: project.jobId, postId, answer, lid };
}

/** The request "Mark as posted" sends: exactly these fields, with the link only when there is one (the transport adds the workspace). */
export function markPostedArgs({ project, postId, link, requestId }) {
  const clean = typeof link === 'string' ? link.trim() : '';
  return { requestId, brand: project.brand, jobId: project.jobId, postId, ...(clean ? { link: clean } : {}) };
}

/** Why a link cannot be sent, in plain words, or '' when it is empty or fine. Only a full https address of at most 500 characters passes. */
export function markLinkProblem(value) {
  const link = typeof value === 'string' ? value.trim() : '';
  if (!link) return '';
  if (link.length > KIT_LINK_LIMIT) return `Link too long. Use at most ${KIT_LINK_LIMIT} characters.`;
  let url = null;
  try { url = new URL(link); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || !url.hostname || /\s/.test(link) || url.username || url.password) return 'Paste the full link.';
  return '';
}

/** A link that is safe to open from the page: a full https address with no sign-in details, or null. */
export function safeHttpsLink(value) {
  if (typeof value !== 'string' || !value || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null; } catch { return null; }
}

/** "Cmd+C" on a Mac, "Ctrl+C" elsewhere, from the browser's own platform text. */
export const copyShortcut = platform => (/mac|iphone|ipad|ipod/i.test(String(platform || '')) ? 'Cmd+C' : 'Ctrl+C');
/** How to copy by hand from the box: press and hold on a touch screen, else the keyboard shortcut. */
export const copyHint = (platform, touch = false) => (touch ? 'Press and hold to copy' : `Press ${copyShortcut(platform)} to copy`);
export const KIT_COPY_REFUSED = "Copy blocked. Copy the text below.";

const externalLink = (href, text, className = 'post-link') => `<a class="${className}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

// The request a post's own buttons sent, in the shape the route choice uses: nothing times out, the notice names the wait
// after the remind delay, and a decline or an error is said where the buttons are. `held` is true while a request is out.
function postRequestLine(state, lines, { signal = {}, now = Date.now() } = {}) {
  const pending = Boolean(state?.pending);
  const waitedSince = state?.submittedAt;
  const waiting = pending && Boolean(state.requestId) && Number.isFinite(waitedSince) && now - waitedSince >= REMIND_DELAY_MS;
  let html = '';
  if (waiting) html = notifyClaudeNotice({ ...state, message: state.applied ? lines.saved : lines.waiting }, signal, now);
  else if (pending) html = `<p class="publish-busy" role="status">${esc(lines.saving)}</p>`;
  else if (state?.error) html = `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>`;
  else if (state?.notice) html = `<p class="publish-route-note" role="status">${esc(state.notice)}</p>`;
  return { html, held: pending };
}

const ANSWER_LINES = { saving: POST_ANSWER_SAVING_LINE, waiting: POST_ANSWER_WAITING_LINE, saved: POST_ANSWER_SAVED_LINE };
const MARK_LINES = { saving: POST_MARK_SAVING_LINE, waiting: POST_MARK_WAITING_LINE, saved: POST_MARK_SAVED_LINE };

// "Is this post in Metricool?": the two answers. "It is not in Metricool" waits until the server says it is time
// (`checkAfter`); the server still checks when it is asked.
function postQuestion(post, state, ctx) {
  const id = post.id ?? '';
  const after = post.checkAfter && typeof post.checkAfter === 'object' ? post.checkAfter : null;
  const at = after ? Date.parse(after.at) : NaN;
  const early = Boolean(after) && (!Number.isFinite(at) || ctx.now < at);
  const request = postRequestLine(state, ANSWER_LINES, ctx);
  const held = request.held;
  const note = early ? `<p class="post-check-wait" id="post-check-wait-${esc(id)}">Check again after ${esc(after.text || 'a few minutes')}</p>` : '';
  return `<div class="post-check" role="group" aria-labelledby="post-check-q-${esc(id)}"${held ? ' aria-busy="true"' : ''}><p class="post-check-q" id="post-check-q-${esc(id)}">${esc(POST_CHECK_QUESTION)}</p><p class="post-check-help muted">Claude could not tell if this went out. Check Metricool.</p><div class="post-check-actions"><button type="button" data-post-answer="in_metricool" data-post-id="${esc(id)}" ${held ? 'aria-disabled="true" disabled' : ''}>${esc(POST_IN_METRICOOL)}</button><button type="button" data-post-answer="not_in_metricool" data-post-id="${esc(id)}" ${held || early ? 'disabled' : ''}${early ? ` aria-describedby="post-check-wait-${esc(id)}"` : ''}>${esc(POST_NOT_IN_METRICOOL)}</button></div>${note}${request.html}</div>`;
}

function postStatusRow(post, state, ctx) {
  const status = Object.hasOwn(POST_STATUS_WORDS, post?.status) ? post.status : 'check_in_metricool';
  const tone = POST_STATUS_TONES[status] || 'dim';
  const chip = `<span class="pill post-chip post-chip-${tone}">${esc(POST_STATUS_WORDS[status])}</span>`;
  const when = typeof post.when === 'string' && post.when ? `<span class="post-status-when">${esc(post.when)}</span>` : '';
  const reason = status === 'failed' && post.reason ? `<p class="post-status-reason">${esc(post.reason)}</p>` : '';
  const note = POST_STATUS_NOTES[status] ? `<p class="post-status-note">${esc(POST_STATUS_NOTES[status])}</p>` : '';
  const view = (status === 'posted' || status === 'marked') && safeHttpsLink(post.publicUrl) ? externalLink(safeHttpsLink(post.publicUrl), 'View post') : '';
  const planner = safeHttpsLink(post.plannerUrl) ? externalLink(safeHttpsLink(post.plannerUrl), 'Open in Metricool') : '';
  const links = view || planner ? `<p class="post-status-links">${view}${planner}</p>` : '';
  const question = status === 'needs_check' ? postQuestion(post, state, ctx) : '';
  return `<li class="post-status-row" role="listitem" data-post-id="${esc(post.id ?? '')}"><div class="post-status-main"><div class="post-status-head"><strong class="post-status-label">${esc(post.label || 'Post')}</strong>${when}</div>${chip}</div>${reason}${note}${links}${question}</li>`;
}

/**
 * The compact list that replaces the posting decision once something was sent through Metricool: one row per post with its
 * label, time and a status chip, a link to the post when it is live, "Open in Metricool" when the planner link is known,
 * and, for a post whose result is not known, the question the person answers. '' when nothing was sent.
 */
export function publishStatusPanel(status, postStates = {}, { signal = {}, now = Date.now() } = {}) {
  const posts = Array.isArray(status?.posts) ? status.posts.filter(post => post && typeof post === 'object') : [];
  if (!posts.length) return '';
  const rows = posts.map(post => postStatusRow(post, postStates?.[post.id] || {}, { signal, now })).join('');
  return `<section class="panel post-status-panel" aria-labelledby="post-status-title"><div class="section-head"><h2 id="post-status-title">Where your posts stand</h2></div><ul class="post-status-list" role="list">${rows}</ul></section>`;
}

// BEGIN test versions and social check (0.14 task 4)
// The four social checks at the final approval (review.socialCheck = { items: [{ id, ok, line }] }): plain lines, never a block.
export function socialCheckSection(check, openKeys = new Set()) {
  const items = (Array.isArray(check?.items) ? check.items : []).filter(item => item && typeof item.line === 'string' && item.line.trim());
  if (!items.length) return '';
  const list = publishChecks({ checks: items.map(item => ({ ok: item.ok !== false, text: item.line })) }, 'social-check', openKeys);
  return `<section class="supplied-checks social-check" aria-label="Social check"><h3>Social check</h3><div class="publish-check-list">${list}</div></section>`;
}

// The test versions of the video (doc.variants = [{ id, hook, cta, file, media }]): each plays in the usual media tile,
// with its own hook and call to action. The posting plan still posts the main video only.
export function testVersionsSection(variants) {
  const list = (Array.isArray(variants) ? variants : []).filter(item => item && item.media && typeof item.media === 'object');
  if (!list.length) return '';
  const rows = list.map(item => {
    const hook = trimmed(item.hook);
    const cta = trimmed(item.cta);
    const fields = `${hook ? `<div><dt>Hook</dt><dd class="post-hook">${esc(hook)}</dd></div>` : ''}${cta ? `<div><dt>Call to action</dt><dd>${esc(cta)}</dd></div>` : ''}`;
    return `<article class="post-preview test-version"><div class="post-head"><div class="post-title"><h4>${esc(`Test version ${String(item.id || '').replace(/^v/i, '')}`.trim())}</h4></div></div><div class="media-grid">${mediaTile({ ...item.media, title: `Test version ${String(item.id || '').replace(/^v/i, '')}` })}</div>${fields ? `<dl class="review-fields">${fields}</dl>` : ''}</article>`;
  }).join('');
  return `<section class="test-versions" aria-label="Test versions"><h3>Test versions</h3><p class="muted">Same video, other hooks. Only the main video is posted.</p><div class="post-list">${rows}</div></section>`;
}

// A post's test versions inside its posting kit, with the one plain line that says what they are for.
function kitVariants(post) {
  const list = (Array.isArray(post?.variants) ? post.variants : []).filter(item => item && typeof item === 'object');
  if (!list.length) return '';
  const rows = list.map(item => {
    const lines = [trimmed(item.hook) ? `Hook: ${trimmed(item.hook)}` : '', trimmed(item.cta) ? `Call to action: ${trimmed(item.cta)}` : ''].filter(Boolean);
    return `<li class="kit-file-row"><span class="kit-file-name">${esc(item.name || item.id || 'Test version')}</span>${lines.length ? `<span class="muted">${esc(lines.join(' · '))}</span>` : ''}</li>`;
  }).join('');
  return `<div class="kit-section kit-variants"><h5>Test versions</h5><ul class="kit-files">${rows}</ul></div>`;
}
// END test versions and social check

function kitFiles(post) {
  const media = Array.isArray(post.media) ? post.media.filter(item => item && typeof item === 'object') : [];
  if (!media.length) return '';
  const items = media.map(item => {
    const href = safeHttpsLink(item.appUrl);
    const name = item.name ? `<span class="kit-file-name">${esc(item.name)}</span>` : '';
    return `<li class="kit-file-row">${name}${href ? externalLink(href, 'Download', 'post-link kit-download') : `<span class="muted kit-file-wait">${esc(KIT_DOWNLOAD_WAITING)}</span>`}</li>`;
  }).join('');
  return `<div class="kit-section"><h5>Files</h5><ul class="kit-files">${items}</ul></div>`;
}

// The self route's button once the plan is approved: "Preparing download…" (held) until every file of the kit has its download
// link, then "Download files", which opens each file's link (the same links the rows below carry). '' for a kit with no files.
export function kitDownloadButton(kit) {
  if (kit?.route !== 'self') return '';
  const files = (Array.isArray(kit.posts) ? kit.posts : []).flatMap(post => (Array.isArray(post?.media) ? post.media.filter(item => item && typeof item === 'object') : []));
  if (!files.length) return '';
  const ready = files.every(item => safeHttpsLink(item.appUrl));
  return ready
    ? '<p class="kit-fetch-all"><button type="button" class="primary" data-kit-download-all>Download files</button></p>'
    : `<p class="kit-fetch-all"><button type="button" class="primary" disabled aria-busy="true">${esc(PUBLISH_PREPARING_LABEL)}</button></p>`;
}

function kitCopyBlock(post, field, label, state, { openKeys, jobId, hint }) {
  const value = field === 'caption' ? post.text : post.firstComment;
  if (typeof value !== 'string' || !value.trim()) return '';
  const ref = `${jobId}:${post.id ?? ''}`;
  const shown = state?.copied === field;
  const text = publishText(value, `kit-text:${field}:${ref}`, label.toLowerCase(), openKeys);
  const button = `<button type="button" class="kit-copy${shown ? ' is-copied' : ''}" data-kit-copy="${esc(`${post.id ?? ''}:${field}`)}" aria-label="Copy ${esc(label.toLowerCase())}">${shown ? 'Copied' : `Copy ${esc(label.toLowerCase())}`}</button>`;
  const fallback = state?.fallback === field
    ? `<div class="kit-fallback"><p class="kit-fallback-status" role="status">${esc(KIT_COPY_REFUSED)}</p><label class="visually-hidden" for="kit-fallback-${esc(post.id ?? '')}-${field}">${esc(label)}</label><textarea id="kit-fallback-${esc(post.id ?? '')}-${field}" name="kit-fallback:${esc(post.id ?? '')}:${field}" readonly rows="5" aria-describedby="kit-fallback-hint-${esc(post.id ?? '')}-${field}" data-kit-fallback="${esc(`${post.id ?? ''}:${field}`)}">${esc(value)}</textarea><div class="kit-fallback-foot"><span class="muted" id="kit-fallback-hint-${esc(post.id ?? '')}-${field}">${esc(hint)}</span><button type="button" class="quiet" data-kit-fallback-close="${esc(`${post.id ?? ''}:${field}`)}">Done</button></div></div>`
    : '';
  return `<div class="kit-section kit-copy-section"><div class="kit-section-head"><h5>${esc(label)}</h5>${button}</div>${text}${shown ? `<span class="visually-hidden" role="status">${esc(label)} copied</span>` : ''}${fallback}</div>`;
}

function kitMarkBlock(post, state, ctx) {
  const id = post.id ?? '';
  if (post.marked) {
    const link = safeHttpsLink(post.marked.link);
    const when = typeof post.marked.text === 'string' && post.marked.text ? ` ${esc(post.marked.text)}` : '';
    return `<div class="kit-mark kit-marked"><p class="kit-marked-line"><span class="publish-mark publish-mark-ok" aria-hidden="true"></span><span>Marked as posted${when ? ` <span class="muted">${when.trim()}</span>` : ''}</span></p>${link ? `<p class="post-status-links">${externalLink(link, 'View post')}</p>` : ''}</div>`;
  }
  const request = postRequestLine(state, MARK_LINES, ctx);
  const field = `kit-link-${esc(id)}`;
  const problem = state?.linkError ? `<p class="field-error" id="${field}-error" role="alert">${esc(state.linkError)}</p>` : '';
  const describedBy = problem ? ` aria-describedby="${field}-error" aria-invalid="true"` : '';
  return `<div class="kit-mark"><label for="${field}">Link to the post <span class="muted">(optional)</span></label><div class="kit-mark-row"><input id="${field}" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="${KIT_LINK_LIMIT}" name="kit-link:${esc(id)}" data-kit-link="${esc(id)}" placeholder="https://" value="${esc(state?.link || '')}" ${request.held ? 'disabled' : ''}${describedBy}><button type="button" class="primary" data-kit-mark="${esc(id)}" ${request.held ? 'disabled' : ''}>Mark as posted</button></div>${problem}${request.html}</div>`;
}

// The tile of each file of a kit post, the same one the posting decision shows for its rows (thumbnail or player). The job
// document carries it with the file (`media[].preview`); a file with none shows no tile, and its Download link still stands.
export function kitPreviews(post) {
  return (Array.isArray(post?.media) ? post.media : []).map(item => (item && typeof item.preview === 'object' && item.preview ? mediaTile(item.preview) : '')).filter(Boolean).join('');
}

function kitPost(post, state, ctx) {
  const checklist = (Array.isArray(post.checklist) ? post.checklist : []).filter(line => typeof line === 'string' && line.trim());
  // The AI label comes before the last line, which hands over to Mark as posted.
  const lines = checklist.map(line => `<li>${esc(line)}</li>`);
  if (post.aiLabel) lines.splice(Math.max(0, lines.length - 1), 0, `<li class="kit-ai"><strong>${esc(post.aiLabel)}.</strong></li>`);
  const items = lines.join('');
  const when = typeof post.when === 'string' && post.when ? `<dl class="publish-facts"><div><dt>When</dt><dd>${esc(post.when)}</dd></div></dl>` : '';
  const preview = kitPreviews(post);
  return `<article class="publish-post kit-post${preview ? ' has-preview' : ''}${post.marked ? ' is-marked' : ''}" role="listitem">${postMedia(preview)}<div class="publish-post-body"><div class="publish-post-head"><h4>${esc(post.label || 'Post')}</h4>${post.account ? `<span class="publish-account">${esc(post.account)}</span>` : ''}</div>${when}${kitFiles(post)}${kitVariants(post)}${kitCopyBlock(post, 'caption', 'Post text', state, ctx)}${kitCopyBlock(post, 'comment', 'First comment', state, ctx)}${items && !post.marked ? `<div class="kit-section"><h5>Before you post</h5><ol class="kit-checklist">${items}</ol></div>` : ''}${kitMarkBlock(post, state, ctx)}</div></article>`;
}

/**
 * The posting kit for "I'll post it myself": per post its time and account, a download link for each file, the caption
 * and first comment with Copy buttons (a read-only box to copy by hand when the clipboard is not allowed), a short
 * checklist with the AI label, and Mark as posted with an optional link. '' when the plan has no kit.
 */
export function postingKitPanel(kit, postStates = {}, { signal = {}, now = Date.now(), jobId = '', openKeys = new Set(), platform = '', touch = false } = {}) {
  const posts = Array.isArray(kit?.posts) ? kit.posts.filter(post => post && typeof post === 'object') : [];
  if (!posts.length) return '';
  const ctx = { signal, now, jobId, openKeys, hint: copyHint(platform, touch) };
  const marked = posts.filter(post => post.marked).length;
  const done = marked === posts.length;
  // "Finished" is said only once the job is complete; until then Claude is closing it.
  const finished = done && kit.settled !== false && kit.closed === true;
  const closing = done && kit.settled === true && kit.closed !== true;
  const count = finished ? 'All posted' : `${marked} of ${posts.length} posted`;
  const intro = finished ? 'All posts are marked posted.' : closing ? 'Closing this job.' : kit.route === 'partial' ? (done ? KIT_PARTIAL_DONE : KIT_PARTIAL_INTRO) : KIT_INTRO;
  return `<section class="panel posting-kit" aria-labelledby="posting-kit-title"><div class="section-head"><h2 id="posting-kit-title">Your posting kit</h2><span class="count">${esc(count)}</span></div><p class="muted kit-intro">${esc(intro)}</p>${kitDownloadButton(kit)}<div class="publish-posts" role="list">${posts.map(post => kitPost(post, postStates?.[post.id] || {}, ctx)).join('')}</div></section>`;
}

// @module review
function reviewFilesHtml(doc, paths) {
  const files = new Map((doc?.files || []).map(file => [file.path, file]));
  return paths.map(path => {
    const file = files.get(path);
    const title = displayTitle(file || { path }, 'Document');
    const body = file?.text != null
      ? (/\.md$/i.test(path) ? `<div class="md">${renderMarkdown(withoutTitle(file.text, title))}</div>` : `<pre class="doc-pre">${esc(file.text)}</pre>`)
      : `<p class="muted">${NOTE_TOO_LARGE}</p>`;
    return `<article class="doc-file"><h3>${esc(title)}</h3>${body}${file?.truncated ? `<p class="muted">${NOTE_SHORTENED}</p>` : ''}</article>`;
  }).join('');
}

function reviewBody(project, doc, state, { recipeState = {}, workspaceState = {}, routeState = {}, postStates = {}, openKeys = new Set(), signal = {}, metricool = null } = {}) {
  const review = doc.review;
  const gate = review.gate;
  const parts = [];
  const locked = Boolean(state.busy || state.submitted || state.needsReconciliation || state.settled);
  if (gate === 'findings') {
    parts.push(reportArticle(doc.report, { jobTitle: project?.title }));
    const covered = new Set([doc.report?.path, ...(doc.report?.stills || []).map(still => still.path)].filter(Boolean));
    const rest = (review.paths || []).filter(path => !covered.has(path) && !/^report\/stills\//i.test(path) && !IMAGE_FILE.test(path));
    if (rest.length) parts.push(reviewFilesHtml(doc, rest));
    return parts.join('');
  }
  if (gate === 'concept' && review.concepts) {
    // The picks (industry under the strategy, funnel stage, ad style, format and call to action on each card) come with the options the document offers.
    const strategy = { options: strategyOptionsOf(doc), chosen: state.strategyPicks || {}, added: state.strategyOwn || {}, edit: state.strategyEdit || null, openKeys, disabled: locked, industryOpen: Boolean(state.industryOpen) };
    parts.push(conceptStrategy(conceptSummaryOf(review.concepts, doc), industryRow(strategy, { disabled: locked }), { openKeys }));
    parts.push(conceptCards(review.concepts, state.choice, { disabled: state.busy || state.submitted, hooks: state.hooks || {}, own: state.ownLines || {}, edited: state.editedLines || {}, edit: state.hookEdit || null, strategy, panel: state.conceptPanel || null }));
  }
  if (gate === 'concept') parts.push(recipeReviewSection(doc, recipeState, { disabled: state.busy || state.submitted }));
  // Panel-by-panel decisions belong to the storyboard approval only (the server refuses them anywhere else), so a later
  // gate that still lists the storyboard shows it as a plain strip, with no per-panel buttons whose answer would be lost.
  if (review.storyboards?.length && gate === 'storyboard') {
    const current = currentPanelKey(review.storyboards, state);
    parts.push(review.storyboards.map(board => storyboardStrip(board, { interactive: true, verdicts: panelStates(review.storyboards, state.panels), current })).join(''));
    parts.push(storyboardSlot(review.storyboards, state, { disabled: locked }));
    if (pricedStoryboard(doc)) parts.push(storyboardPrice(project, doc, workspaceState, { disabled: locked }));
  } else if (review.storyboards?.length) {
    parts.push(review.storyboards.map(board => storyboardStrip(board)).join(''));
  }
  if (gate === 'sample') parts.push(sampleView(doc));
  if (MEDIA_GATE_IDS.has(gate)) parts.push(mediaSetView(doc, state, { disabled: locked }));
  if (gate === 'price' && review.quote) {
    parts.push(priceTable(review.quote, { used: project?.usage?.generation }));
    parts.push(studioWorkspaceSection(doc, workspaceState, { disabled: locked }));
  }
  const used = new Set();
  const planned = gate === 'publish' && review.publish;
  if (gate === 'publish' && review.publish && review.publish.route !== 'self' && !review.publish.studioWorkspace?.name && (review.publish.posts || []).some(post => post.media?.length)) parts.push(studioWorkspaceSection(doc, workspaceState, { disabled: locked, upload: true }));
  if (gate === 'publish') parts.push(publishCard(review.publish, routeState, { disabled: locked, openKeys, postStates, metricool, note: doc.publishNote, jobId: project?.jobId || doc.jobId || '', signal, previews: planned ? post => publishPreviews(review, post, used) : null }));
  // The deliverable cards repeat the text in another split, so the publish gate leaves them out once it has the plan.
  if (review.posts?.length && !planned) parts.push(`<div class="post-list">${review.posts.map(post => postPreview(post)).join('')}</div>`);
  if (gate === 'content') parts.push(testVersionsSection(doc.variants));
  // A file the post cards above already show is not shown a second time, even when the review also lists a copy of it
  // under another path (a post made from supplied files keeps the person's file in media/supplied/): same bytes, same tile.
  const shaOfPath = new Map((doc.files || []).filter(file => file?.path && file.sha256).map(file => [file.path, file.sha256]));
  const shown = new Set();
  if (!planned) (review.posts || []).forEach(post => (post?.media || []).forEach(ref => { if (ref?.path) { used.add(ref.path); if (shaOfPath.has(ref.path)) shown.add(shaOfPath.get(ref.path)); } }));
  const looseMedia = (review.media || []).filter(ref => !used.has(ref.path) && !(shaOfPath.has(ref.path) && shown.has(shaOfPath.get(ref.path))));
  if (looseMedia.length) parts.push(`<div class="media-grid">${looseMedia.map(ref => mediaTile(ref)).join('')}</div>`);
  if (gate === 'content' && doc.publishNote) parts.unshift(publishNoteLine(doc.publishNote));
  if (gate === 'content' && doc.music) parts.push(musicLine(doc.music));
  if (gate === 'content' && review.checks) parts.push(suppliedChecksCard(review.checks, openKeys));
  if (gate === 'content') parts.push(labelCheckSection(review.labelCheck, state.accepted || {}, { disabled: locked }));
  if (gate === 'content') parts.push(socialCheckSection(review.socialCheck, openKeys));
  const covered = new Set([review.concepts?.path, ...(review.storyboards || []).map(item => item.path), ...(review.posts || []).map(item => item.path), review.quote?.path, review.sample?.path, ...(review.media || []).map(item => item.path)].filter(Boolean));
  // The posting plan (publish/intent.json and the rest of publish/) is shown by the publish card, never as a file panel.
  const rest = (review.paths || []).filter(path => !covered.has(path) && !/^publish\//i.test(path) && !/\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|m4a|ogg)$/i.test(path));
  if (rest.length) parts.push(reviewFilesHtml(doc, rest));
  parts.push(readyChecksList(review.readyChecks));
  return parts.join('');
}

// The short "Ready check" above the buttons: a green tick for a check that passes, a red mark for a required one that does not
// (it holds Approve, see approval()), an amber mark for a warning that lets the review go.
function readyChecksList(checks) {
  const list = (Array.isArray(checks) ? checks : []).filter(item => item && typeof item.label === 'string' && item.label);
  if (!list.length) return '';
  const rows = list.map(item => {
    const tone = item.ok ? 'ok' : item.level === 'warning' ? 'warn' : 'bad';
    const said = item.ok ? 'Done: ' : tone === 'warn' ? 'Check this: ' : 'Not ready: ';
    return `<li class="ready-${tone}"><span class="ready-mark" aria-hidden="true"></span><span><span class="visually-hidden">${said}</span>${esc(item.label)}</span></li>`;
  }).join('');
  return `<section class="ready-checks" aria-label="Ready check"><h3>Ready check</h3><ul>${rows}</ul></section>`;
}

/** The required checks on the card that are not met yet (they hold Approve). */
export function readyBlockers(doc) {
  return (Array.isArray(doc?.review?.readyChecks) ? doc.review.readyChecks : []).filter(item => item && item.ok === false && item.level !== 'warning' && typeof item.label === 'string');
}

const COPY_GATES = new Set(['sample', 'pictures', 'clips', 'cut', 'finish', 'content', 'publish']);
const copiesWaiting = refs => {
  const kinds = new Set(refs.map(ref => ref.kind));
  const what = kinds.has('image') && kinds.has('video') ? 'pictures and video' : kinds.has('video') ? 'video' : 'pictures';
  return `No viewable ${what} yet. Approve in chat or ask for changes.`;
};

function unviewableMedia(doc) {
  const review = doc?.review;
  if (!review) return [];
  const urls = doc.reviewUrls && typeof doc.reviewUrls === 'object' ? doc.reviewUrls : {};
  const refs = [
    ...(review.sample ? [review.sample] : []),
    ...mediaPanelsOf(doc),
    ...(review.media || []),
    ...(review.posts || []).flatMap(post => post.media || []),
  ];
  return refs.filter(ref => {
    if (ref?.kind !== 'video' && ref?.kind !== 'image') return false;
    if (safePreviewUrl(ref.reviewUrl) || safePreviewUrl(urls[ref.path])) return false;
    return ref.kind === 'video' || !safePreviewUrl(ref.thumb);
  });
}

/**
 * The approve arguments' shown amount and label for the review, or why it
 * cannot be approved yet.
 */
function approval(gate, doc, state, recipeState = {}, routeState = {}, postStates = {}) {
  const plan = approvalBase(gate, doc, state, recipeState, routeState, postStates);
  const blockers = plan.disabled || plan.action === 'send-panels' ? [] : readyBlockers(doc);
  if (!blockers.length) return plan;
  return { ...plan, disabled: true, line: `Not ready yet: ${blockers[0].label}${blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : ''}` };
}

function approvalBase(gate, doc, state, recipeState = {}, routeState = {}, postStates = {}) {
  const unviewable = COPY_GATES.has(gate) ? unviewableMedia(doc) : [];
  if (unviewable.length) return { disabled: true, label: gate === 'sample' ? 'Approve sample' : MEDIA_GATE_IDS.has(gate) ? (gate === 'cut' || gate === 'finish' ? 'Approve' : 'Approve all') : 'Approve', line: copiesWaiting(unviewable) };
  if (gate === 'concept') {
    const concepts = doc?.review?.concepts;
    const concept = concepts?.concepts?.find(item => item.id === state.choice);
    if (!concept) return { disabled: true, label: 'Approve', line: TXT_PICK_A_CONCEPT_FIRST };
    const pending = unchosenRecipes(doc);
    if (pending.some(([id]) => !recipeReady(recipeState, id))) {
      return { disabled: true, label: `Approve concept ${concept.id}`, line: NOTE_CHOOSE_COPY };
    }
    const credits = conceptCredits(concepts, concept);
    return { label: `Approve concept ${concept.id}`, credits, line: credits ? `Approving allows up to ${credits.toLocaleString()} credits for media.` : 'Approving allows no media spend yet.' };
  }
  if (gate === 'price') {
    const totals = priceTotals(doc?.review?.quote);
    if (!totals) return { disabled: true, label: 'Approve price', line: NOTE_NEEDS_PRICE };
    if (studioWorkspaceRequired(doc)) return { disabled: true, label: 'Approve price', line: 'Choose the paying workspace first.' };
    const words = priceWords(totals);
    return { label: 'Approve price', line: words ? `Approving allows ${words} for this job.` : 'Approving allows no credits for this job.' };
  }
  if (gate === 'storyboard') {
    const all = storyboardPanelsOf(doc?.review?.storyboards);
    const priced = pricedStoryboard(doc);
    if (!all.length && !priced) return { label: 'Approve storyboard', line: '' };
    const word = all.every(item => item.board?.format === 'carousel') ? 'slide' : 'panel';
    const changes = Object.values(panelStates(doc?.review?.storyboards, state.panels)).filter(item => item.verdict === 'changes').length;
    if (changes) return { label: 'Ask for changes', action: 'send-panels', line: `${changes} ${word}${changes === 1 ? '' : 's'} to change, ${all.length - changes} approved.` };
    const approved = !all.length ? '' : all.length === 1 ? `The ${word} is approved.` : `All ${all.length} ${word}s approved.`;
    if (!priced) return { label: 'Approve storyboard', line: approved };
    // The same totals and workspace rules as the price card: approving the storyboard approves the price shown under it.
    const totals = priceTotals(doc.review.quote);
    if (!totals) return { disabled: true, label: STORYBOARD_PRICED_LABEL, line: NOTE_NEEDS_PRICE };
    if (studioWorkspaceRequired(doc)) return { disabled: true, label: STORYBOARD_PRICED_LABEL, line: 'Choose the paying workspace first.' };
    const words = priceWords(totals);
    return { label: STORYBOARD_PRICED_LABEL, line: [approved, words ? `Approving allows ${words} for this job.` : 'Approving allows no credits for this job.'].filter(Boolean).join(' ') };
  }
  if (MEDIA_GATE_IDS.has(gate)) {
    const all = mediaPanelsOf(doc);
    const [one, many] = MEDIA_GATE_NOUNS[gate];
    const changes = Object.values(mediaPanelStates(doc, state.mediaPanels)).filter(item => item.verdict === 'changes').length;
    if (changes) return { label: 'Ask for changes', action: 'send-panels', line: `${changes} to change, ${all.length - changes} approved.${gate === 'cut' || gate === 'finish' ? '' : ' A redo is priced again.'}` };
    const next = gate === 'pictures' ? 'Approving lets Claude make the video clips.' : gate === 'cut' || gate === 'finish' ? 'Approving lets Claude write the post text.' : 'Approving lets Claude join them and add the sound.';
    return { label: gate === 'cut' || gate === 'finish' ? 'Approve' : 'Approve all', line: all.length > 1 ? `All ${all.length} ${many} approved. ${next}` : `${next}` };
  }
  if (gate === 'sample') {
    const sample = doc?.review?.sample;
    const rest = sampleRestWords(sample?.rest);
    return { label: 'Approve sample', line: rest ? `Approving lets Claude make the other ${rest}.` : 'Approving lets Claude make the rest.' };
  }
  if (gate === 'content' && doc?.review?.checks) {
    // A final post made from files the person supplied has no label check; it is approved while every check on its posts passes.
    const problem = suppliedFirstProblem(doc.review.checks);
    if (!doc.review.checks.ready) return { disabled: true, label: 'Approve', line: problem ? `Fix these first: ${problem}` : 'Fix these first.' };
    return { label: 'Approve', line: '' };
  }
  if (gate === 'content') {
    const check = doc?.review?.labelCheck;
    if (check?.state === 'missing') return { disabled: true, label: 'Approve', line: 'Label check comes first.' };
    if (check?.state === 'stale') return { disabled: true, label: 'Approve', line: 'Media changed. It will be rechecked.' };
    const open = (check?.flags || []).filter(flag => !state.accepted?.[flag.id]).length;
    if (open) return { disabled: true, label: 'Approve', line: open === 1 ? 'Accept the label check item, or ask for changes.' : `Accept the ${open} label check items, or ask for changes.` };
    return { label: 'Approve', line: '' };
  }
  if (gate === 'publish') return publishApproval(doc?.review?.publish, routeState, postStates);
  if (gate === 'findings') return { label: 'Approve report', line: 'Approving finishes this job.' };
  return { label: 'Approve', line: '' };
}
const CHANGE_PLACEHOLDERS = Object.freeze({ findings: 'For example: compare prices too.' });

/**
 * The submit_decision request arguments for an Approve or Ask for changes
 * click, bound to the displayed revision and exact registered files, or an
 * error to show instead. Concept approvals carry the credits shown, and in
 * their note the opening line picked plus, one per line, each line the person
 * added (`own`) or edited (`edited`), and, when a strategy pick differs from its default or an option was added
 * (`strategyPicks`, `strategyOwn`), the "Strategy picks:" line and a "Your own ..." line per option added;
 * price approvals carry the totals shown.
 */
export function decisionArgs({ project, doc, verdict, choice = null, comment = '', requestId, recipeState = {}, panels = {}, accepted = {}, hooks = {}, own = {}, edited = {}, strategyPicks = {}, strategyOwn = {} }) {
  const review = pendingReview(project);
  if (!review?.artifacts?.length) return { error: REVIEW_WAITING.preparing };
  if (!['approve', 'request_changes'].includes(verdict)) return { error: 'Unsupported decision.' };
  const note = String(comment || '').trim();
  const gate = review.gate || review.reviewId;
  const args = { requestId, brand: project.brand, jobId: project.jobId, reviewId: review.reviewId || gate, revision: project.revision, artifacts: review.artifacts, decision: verdict };
  if (project.title) args.title = project.title;
  if (gate === 'storyboard') {
    const boards = doc?.review?.storyboards || [];
    const all = storyboardPanelsOf(boards);
    // The server hears a verdict for every panel: "approve" for each one with no change asked.
    const decided = panelVerdicts(boards, panelStates(boards, panels));
    if (verdict === 'approve' && decided.some(entry => entry.verdict !== 'approve')) return { error: TXT_SEND_THE_REQUESTED_CHANGES };
    if (verdict === 'request_changes' && !note && !decided.some(entry => entry.verdict === 'changes')) return { error: NOTE_SAY_CHANGE };
    if (decided.length) args.panels = decided;
    if (note && verdict === 'request_changes') args.note = note;
    // A storyboard that carries a price approves it too, with the totals shown (the same as the price card sends).
    if (verdict === 'approve' && pricedStoryboard(doc)) {
      const totals = priceTotals(doc.review.quote);
      if (!totals) return { error: NOTE_NEEDS_PRICE };
      args.totals = totals;
    }
    return { args };
  }
  if (MEDIA_GATE_IDS.has(gate)) {
    const states = mediaPanelStates(doc, panels);
    const decided = mediaPanelsOf(doc).map(panel => {
      const mine = states[mediaPanelKey(panel)];
      return { panel: trimmed(panel.panel), ...(trimmed(panel.deliverable) ? { deliverable: trimmed(panel.deliverable) } : {}), verdict: mine.verdict, ...(mine.verdict === 'changes' && trimmed(mine.note) ? { note: trimmed(mine.note) } : {}) };
    });
    if (verdict === 'approve' && decided.some(entry => entry.verdict !== 'approve')) return { error: TXT_SEND_THE_REQUESTED_CHANGES };
    if (verdict === 'request_changes' && !note && !decided.some(entry => entry.verdict === 'changes')) return { error: NOTE_SAY_CHANGE };
    if (decided.length) args.panels = decided;
    if (note && verdict === 'request_changes') args.note = note;
    return { args };
  }
  if (verdict === 'request_changes' && !note) return { error: NOTE_SAY_CHANGE };
  if (gate === 'content' && verdict === 'approve') {
    const flags = doc?.review?.labelCheck?.flags || [];
    const ids = flags.map(flag => flag.id).filter(id => accepted[id]);
    if (flags.length && ids.length !== flags.length) return { error: 'Accept each label check item first.' };
    if (ids.length) args.acceptedFlagIds = ids;
  }
  if (gate === 'concept') {
    const concepts = doc?.review?.concepts;
    const concept = concepts?.concepts?.find(item => item.id === choice) || null;
    if (verdict === 'approve') {
      if (!concept) return { error: TXT_PICK_A_CONCEPT_FIRST };
      const pending = unchosenRecipes(doc);
      if (pending.some(([id]) => !recipeReady(recipeState, id))) return { error: NOTE_CHOOSE_COPY };
      if (pending.length) args.recipe = Object.fromEntries(pending.map(([id]) => [id, recipePicks(recipeState, id)]));
      args.chosen = concept.id;
      args.credits = conceptCredits(concepts, concept);
      args.note = `Concept ${concept.id}: ${concept.title}`;
      const { lines } = hookLinesOf(concept, { own, edited });
      const made = lines.filter(line => line.own || line.edited);
      const at = Number.isInteger(hooks?.[concept.id]) && lines[hooks[concept.id]] ? hooks[concept.id] : 0;
      // The line picked is named as before; when the person wrote or edited lines, each one follows on a line of its own (the
      // picked one included), so Claude can file them and use the picked one word for word.
      if (lines.length > 1 || made.length) {
        const picked = lines[at];
        args.note += ` · Opening line: "${picked.own || picked.edited ? noteLine(picked.text).slice(0, HOOK_LINE_LIMIT) : picked.text}"`;
      }
      for (const line of made.filter(item => item.own)) args.note += `\nYour own opening line: "${noteLine(line.text).slice(0, HOOK_LINE_LIMIT)}"`;
      for (const line of made.filter(item => item.edited)) args.note += `\nEdited opening line (was "${noteLine(line.was)}"): "${noteLine(line.text).slice(0, HOOK_LINE_LIMIT)}"`;
      // The strategy picks follow the opening lines, and only when the person changed a pick or added an option.
      for (const line of strategyNoteLines(strategyOptionsOf(doc), concept, { chosen: strategyPicks, added: strategyOwn })) args.note += `\n${line}`;
    } else {
      if (concept) args.chosen = concept.id;
      args.note = concept ? `Concept ${concept.id}: ${note}` : note;
    }
    return { args };
  }
  if (gate === 'price' && verdict === 'approve') {
    const totals = priceTotals(doc?.review?.quote);
    if (!totals) return { error: NOTE_NEEDS_PRICE };
    args.totals = totals;
  }
  // Approving sends no note: the box says "What should change?", so a note there belongs to a request for changes only.
  if (note && verdict === 'request_changes') args.note = note;
  return { args };
}

/**
 * What stands in place of a review that cannot be used yet. A file that changed after it was shown locks the pick, so that one is a
 * notice the person is told about, not a quiet line: they need to know why nothing can be chosen and what to do.
 */
function waitingNote(status) {
  const line = esc(REVIEW_WAITING[status]);
  return status === 'changed' ? `<p class="notice review-locked" role="status"><span>${line}</span></p>` : `<p class="muted">${line}</p>`;
}

/**
 * Whether a submitted decision (its request arguments) is about the review the board shows now: the same job and review id
 * (gate), and the same files by path and checksum. Without checksums on both sides the revision stands in. A newer job
 * document that still shows the same files at the gate matches; a redo that put different files there does not.
 */
export function decisionMatchesReview(project, args) {
  const review = pendingReview(project);
  if (!review || !args || args.jobId !== project?.jobId) return false;
  if ((args.reviewId || '') !== (review.reviewId || review.gate || '')) return false;
  const key = list => (Array.isArray(list) ? list : []).map(file => `${file?.path || ''}|${file?.sha256 || ''}`).sort().join('\n');
  const sentFiles = Array.isArray(args.artifacts) ? args.artifacts : [];
  const shownFiles = Array.isArray(review.artifacts) ? review.artifacts : [];
  if (sentFiles.length && shownFiles.length) {
    const bare = list => list.every(file => !file?.sha256);
    if (bare(sentFiles) || bare(shownFiles)) return sentFiles.map(file => file?.path).sort().join('\n') === shownFiles.map(file => file?.path).sort().join('\n');
    return key(sentFiles) === key(shownFiles);
  }
  return args.revision === project.revision;
}

/**
 * What a typed note belongs to: the job, the review id and the exact files shown (path and checksum; the revision when the
 * review lists no files). A note typed on one review is never shown on, or sent with, another.
 */
export function reviewDraftKey(project) {
  const review = pendingReview(project);
  if (!review) return '';
  const files = (Array.isArray(review.artifacts) ? review.artifacts : []).map(file => `${file?.path || ''}|${file?.sha256 || ''}`).sort().join(',');
  return `${project.jobId}|${review.reviewId || review.gate || ''}|${files || `rev${project.revision}`}`;
}

/** Forget every note typed on a review: the box, the per-panel boxes and the per-card boxes. Not the saved panel verdicts. */
export function clearReviewDrafts(state) {
  if (!state) return state;
  Object.assign(state, { comment: '', commentOpen: false, panelDraft: '', mediaDraft: '', panelEditing: null, mediaEditing: null, panelError: '', mediaError: '' });
  return state;
}

/**
 * The review state for the review shown now. When the review is a different one from the state's own, nothing carries over:
 * no note, no panel verdict, no choice. Returns the state to keep using.
 */
export function scopeReviewState(state, project) {
  const key = reviewDraftKey(project);
  if (!key) return state;
  if (state.draftKey === key) return state;
  if (!state.draftKey) { state.draftKey = key; return state; }
  return { choice: null, comment: '', commentOpen: false, panelDraft: '', draftKey: key };
}

/**
 * The decision state to draw for a review. A decision the person already sent stays "sent" while it is for the review shown,
 * even when a newer job document still lists the gate as waiting; it lets go once the review is a different one.
 */
export function sentDecisionState(project, state) {
  if (!state || !(state.busy || state.submitted || state.needsReconciliation || state.settled) || !state.args) return state || {};
  if (!pendingReview(project) || decisionMatchesReview(project, state.args)) return state;
  return { ...state, busy: false, submitted: false, needsReconciliation: false, settled: false, declined: false, requestId: null, args: null, operation: null, message: '' };
}

/** What a settled card says: the decision on it was already made (applied, or declined as a repeat), so the buttons stay off. */
export function settledLine(state) {
  const said = typeof state?.message === 'string' ? state.message.trim() : '';
  return said ? `Already handled. ${said}` : 'Already handled. The Director is catching up.';
}

/**
 * Whether a request found in the requests collection settles the review shown: it is about these same files and was either
 * applied or declined as a repeat of a decision already made. A plain decline (a refusal, nothing changed) does not settle it,
 * so the buttons come back; a request still waiting is handled as "sent" elsewhere.
 */
export function settlesReview(project, request) {
  if (!request || request.operation !== 'submit_decision' || !decisionMatchesReview(project, request.args)) return false;
  const status = String(request.artifactReceipt?.status || request.status || '');
  if (status === 'applied') return true;
  return status === 'declined' && Boolean(request.handled || request.artifactReceipt?.handled);
}

/**
 * The review panel for the job's pending decision, drawn from the job document:
 * concept cards, storyboard panels, the itemised price, the final post with its
 * media, or the posting plan, with Approve and Ask for changes.
 */
export function reviewPanel(project, doc, rawState = {}, { docState = 'loaded', signal = {}, recipeState = {}, workspaceState = {}, routeState = {}, postStates = {}, openKeys = new Set(), downloads = null, metricool = null } = {}) {
  const review = pendingReview(project);
  if (!review) return '';
  const state = sentDecisionState(project, rawState);
  const gate = review.gate || review.reviewId;
  const status = reviewStatus(project, doc, docState);
  const ready = status === 'ready';
  const body = ready ? reviewBody(project, doc, state, { recipeState, workspaceState, routeState, postStates, openKeys, signal, metricool }) : waitingNote(status);
  const headExtra = ready && gate === 'findings' ? reportDownloads(downloads) : '';
  const decided = state.busy || state.submitted || state.needsReconciliation || state.settled;
  const plan = ready ? approval(gate, doc, state, recipeState, routeState, postStates) : { disabled: true, label: 'Approve', line: '' };
  const approveLabel = state.busy && state.verdict === 'approve' ? 'Saving...' : state.submitted && state.verdict === 'approve' ? TXT_WAITING_FOR_CLAUDE : plan.label;
  const notice = state.settled
    ? `<div class="notice" role="status"><span>${esc(settledLine(state))}</span></div>`
    : state.declined
      ? `<div class="notice" role="status"><span>${esc(state.message || NOTE_DECLINED)}</span></div>`
      : state.submitted || state.needsReconciliation ? notifyClaudeNotice(state, signal) : '';
  const error = state.error ? `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>` : '';
  const primaryButtons = `<button type="button" class="primary" data-review-action="${esc(plan.action || 'approve')}" ${!ready || decided || plan.disabled ? 'disabled' : ''}>${esc(plan.action === 'send-panels' && state.busy ? 'Saving...' : plan.action === 'send-panels' && state.submitted ? TXT_WAITING_FOR_CLAUDE : state.settled ? 'Already handled' : approveLabel)}</button>`;
  const actions = state.commentOpen
    ? `<div class="review-comment"><label for="review-comment">What should change?</label><textarea id="review-comment" name="comment" maxlength="4000" placeholder="${esc(CHANGE_PLACEHOLDERS[gate] || 'For example: shorten the hook.')}">${esc(state.comment || '')}</textarea><div class="review-actions"><div class="review-buttons"><button type="button" class="quiet" data-review-action="cancel-changes">Cancel</button><button type="button" class="primary" data-review-action="send-changes" ${decided ? 'disabled' : ''}>${state.busy && state.verdict === 'request_changes' ? 'Saving...' : state.submitted && state.verdict === 'request_changes' ? TXT_WAITING_FOR_CLAUDE : 'Ask for changes'}</button></div></div></div>`
    : `<div class="review-actions">${plan.safety ? `<div class="review-notes">${plan.line ? `<p class="review-line">${esc(plan.line)}</p>` : ''}<p class="review-line review-safety">${esc(plan.safety)}</p></div>` : plan.line ? `<p class="review-line">${esc(plan.line)}</p>` : ''}<div class="review-buttons"><button type="button" data-review-action="changes" ${!ready || decided ? 'disabled' : ''}>Ask for changes</button>${primaryButtons}</div></div>`;
  const title = gate === 'sample' && doc?.review?.sample?.kind === 'video' ? 'Approve the sample clip' : ready && pricedStoryboard(doc) ? 'Approve the storyboard and price' : GATE_TITLES[gate] || humanize(gate);
  const about = review.artifacts?.length && Number(review.version) > 0 ? `<span class="count review-version">${esc(cardAbout(gate, review.version, { clip: doc?.review?.sample?.kind === 'video' }))}</span>` : '';
  return `<section class="panel review-panel${gate === 'publish' ? ' review-panel-publish' : ''}" aria-labelledby="review-title"><div class="section-head${headExtra ? ' report-section-head' : ''}"><h2 id="review-title">${esc(title)}</h2>${about}${headExtra}</div><div id="review-form" class="review-body">${body}${error}${actions}</div>${notice}</section>`;
}

// @module inbox
export const INBOX_LIMIT = 20;
export const ANSWER_LIMIT = 1000;
export const INBOX_EMPTY = 'Nothing needs you right now.';
const INBOX_KINDS = new Set(['question', 'decision', 'brief', 'onboarding', 'post', 'stuck', 'handoff_offer', 'handoff_return']);
const BRIEF_MISSING = 'Some brief answers are missing.';
const WAITING_GATES = Object.freeze({ concept: 'concept', storyboard: 'storyboard', price: 'price', 'sample image': 'sample', 'test clip': 'sample', 'storyboard pictures': 'pictures', 'video clips': 'clips', 'joined video': 'cut', 'rough cut': 'cut', 'finished video': 'finish', 'final post': 'content', 'posting plan': 'publish', 'campaign plan': 'campaign_proposal', 'going live': 'campaign_activation', report: 'findings' });

const hasQuestionId = item => item?.questionId !== undefined && item?.questionId !== null && String(item.questionId).trim() !== '';

function inboxItemsOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter(item => item && typeof item === 'object' && INBOX_KINDS.has(item.kind) && (item.kind !== 'question' || hasQuestionId(item)))
    .slice(0, INBOX_LIMIT);
}

function legacyJobInbox(project) {
  const base = { jobId: project?.jobId || null, jobTitle: project?.title || '', brandName: project?.brandName || '', inline: false };
  const review = pendingReview(project);
  if (review) {
    const gate = review.gate || review.reviewId || null;
    return [{ ...base, kind: 'decision', gate, text: GATE_TITLES[gate] || NOTE_DECISION_WAITING }];
  }
  const intake = project?.intake;
  const briefOpen = (intake?.fields || []).some(field => field?.missing) || (intake?.other || []).length > 0 || (project?.blockers || []).length > 0;
  return briefOpen ? [{ ...base, kind: 'brief', text: BRIEF_MISSING }] : [];
}

export function jobInbox(project, doc = null) {
  const inbox = doc?.inbox && typeof doc.inbox === 'object' ? doc.inbox : null;
  const announcement = trimmed(inbox?.announcement) || trimmed(project?.nextAction) || humanize(project?.state);
  if (inbox && Array.isArray(inbox.items)) return { items: inboxItemsOf(inbox.items).filter(item => !postHandled(item)), announcement };
  return { items: legacyJobInbox(project), announcement };
}

function legacySummaryInbox(project) {
  const base = { jobId: project?.jobId || null, jobTitle: project?.title || '', brandName: project?.brandName || '', inline: false };
  if (project?.waitingOn) {
    const gate = WAITING_GATES[project.waitingOn] || null;
    return [{ ...base, kind: 'decision', gate, text: GATE_TITLES[gate] || `Review the ${project.waitingOn}.` }];
  }
  return Number(project?.blockerCount) > 0 ? [{ ...base, kind: 'brief', text: BRIEF_MISSING }] : [];
}

// The six subtopics the research found, as one question card: "Do these six subtopics look right?" with Looks right and Edit. It is
// derived from the brand's intelligence, so it is the same card in Needs you, on the brand page in the Director's thread and on the
// intelligence panel, and it is gone from every one of them when the subtopics are confirmed (from this board or in chat).
export function subtopicsQuestion(brand) {
  const intel = intelOf(brand);
  if (!brand?.slug || !intel || intelObject(intel.subtopics).status === 'confirmed') return null;
  const names = intelSubtopics(intel).map(item => item.name);
  if (!names.length) return null;
  const exact = names.length === INTEL_SUBTOPIC_COUNT;
  return {
    kind: 'onboarding', brand: brand.slug, brandName: trimmed(brand.name) || null, state: 'subtopics', needsYou: true, subtopics: names, exact,
    text: exact ? `Do these ${INTEL_SUBTOPIC_COUNT} subtopics look right?` : `I found ${names.length} subtopics and every job needs exactly ${INTEL_SUBTOPIC_COUNT}. Please adjust them.`,
  };
}

export function onboardingInboxItems(brands = [], drafts = []) {
  const all = (Array.isArray(brands) ? brands : []).filter(brand => brand?.slug);
  const open = all.filter(brand => !brandReady(brand));
  return [...open.flatMap(brand => {
    const draft = (Array.isArray(drafts) ? drafts : []).find(item => item?.kind === 'onboard' && item.brand === brand.slug) || null;
    const phase = brandResearchPhase(brand, draft);
    const name = trimmed(brand.name) || 'This brand';
    const base = { kind: 'onboarding', brand: brand.slug, brandName: trimmed(brand.name) || null };
    if (phase === 'running') return [{ ...base, state: 'running', needsYou: false, text: `${name}: researching. Nothing needed yet.` }];
    if (phase === 'complete') {
      const researched = brand.usage?.status === 'complete';
      return [{ ...base, state: 'review', needsYou: true, text: researched ? `${name}: research done. Check the profile and save.` : 'Check the profile and save.' }];
    }
    if (phase === 'failed') {
      const why = trimmed(brand.usage?.result?.reason).replace(/[.!?]+$/, '');
      return [{ ...base, state: 'failed', needsYou: true, text: `${name} research could not finish${why ? `: ${why}` : ''}. Fill in the brand profile by hand, then click Save and continue.` }];
    }
    return [];
  }), ...all.map(subtopicsQuestion).filter(Boolean)];
}

// Whether an Inbox item waits on the person, for every count of "waiting". The research-done item (state 'review') is news with a
// button that opens the brand profile: the Director says it, but nothing is waiting on it, so it never counts. A research that could
// not finish does (the profile has to be filled in by hand).
export const waitsOnPerson = item => (item?.kind !== 'onboarding' && !item?.closing) || (item?.needsYou === true && item.state !== 'review');

// A job that is stuck is a row of its own, unless the list already holds the question or decision that asks the person about it.
export function stuckInboxItems(projects = [], items = []) {
  const asked = new Set((Array.isArray(items) ? items : []).filter(item => item?.jobId && item.kind !== 'post').map(item => item.jobId));
  return (Array.isArray(projects) ? projects : []).filter(project => project?.jobId && project.stuck && typeof project.stuck === 'object' && !asked.has(project.jobId)).map(project => ({
    kind: 'stuck', jobId: project.jobId, jobTitle: trimmed(project.title), brandName: trimmed(project.brandName),
    text: `Stuck: ${agentPlain(project.stuck.reason, project.stuck.kind === 'internal' ? NOTE_WENT_WRONG : NOTE_NEEDS_HELP)}`,
  }));
}

export function workspaceInbox(snapshot, { drafts = [] } = {}) {
  const inbox = snapshot?.inbox && typeof snapshot.inbox === 'object' ? snapshot.inbox : null;
  const onboarding = onboardingInboxItems(snapshot?.brands, drafts);
  const asks = onboarding.filter(waitsOnPerson).length;
  if (inbox && Array.isArray(inbox.items)) {
    const rest = inbox.items.filter(item => item?.kind !== 'onboarding');
    const stuck = stuckInboxItems(snapshot?.projects, rest);
    const items = inboxItemsOf([...onboarding, ...stuck, ...rest]);
    return { items, count: (Number.isSafeInteger(inbox.count) ? Math.max(inbox.count, inboxItemsOf(rest).length) : inboxItemsOf(rest).length) + asks + stuck.length };
  }
  const legacy = (snapshot?.projects || []).flatMap(legacySummaryInbox);
  const stuck = stuckInboxItems(snapshot?.projects, legacy);
  return { items: [...onboarding, ...stuck, ...legacy].slice(0, INBOX_LIMIT), count: legacy.length + asks + stuck.length };
}

export function inboxOptions(options) {
  return (Array.isArray(options) ? options : []).map(option => {
    if (typeof option === 'string' || typeof option === 'number') {
      const text = String(option).trim();
      return text ? { value: option, label: text } : null;
    }
    if (!option || typeof option !== 'object') return null;
    const value = option.value ?? option.id ?? option.label;
    const label = trimmed(option.label) || (value === undefined || value === null ? '' : String(value).trim());
    return label ? { value, label } : null;
  }).filter(Boolean);
}

export function answerArgs(item, { choice = null, text = null, requestId } = {}) {
  if (!hasQuestionId(item)) return { error: 'This question is closed.' };
  const args = { requestId, questionId: item.questionId };
  if (text !== null && text !== undefined) {
    if (item.allowText === false) return { error: TXT_CHOOSE_ONE_OF_THE };
    const value = String(text).trim();
    if (!value) return { error: 'Type your answer first.' };
    if (value.length > ANSWER_LIMIT) return { error: `Keep your answer to ${ANSWER_LIMIT} characters or fewer.` };
    args.text = value;
  } else {
    const option = Number.isInteger(choice) ? inboxOptions(item.options)[choice] : null;
    if (!option) return { error: TXT_CHOOSE_ONE_OF_THE };
    args.choice = option.value;
    if (String(option.value) !== option.label) args.choiceLabel = option.label;
  }
  if (trimmed(item.jobTitle)) args.title = trimmed(item.jobTitle);
  return { args };
}

// Which agent an item comes from ("From the Strategist"); the Director is the one the person already talks to, so it adds nothing.
const agentWord = value => { const text = trimmed(value && typeof value === 'object' ? value.name || value.id : value); return /^(producer|director)$/i.test(text) ? '' : /^[a-z][a-z0-9_-]*$/.test(text) ? humanize(text) : text; };
function inboxFromLine(item) {
  const name = agentWord(item?.fromName) || agentWord(item?.from);
  return name ? `<p class="inbox-from">${esc(`From the ${name}`)}</p>` : '';
}

function inboxJobLine(item) {
  if (!item?.jobId) return trimmed(item?.brandName) ? `<p class="inbox-place">${esc(trimmed(item.brandName))}</p>` : '';
  const name = [trimmed(item.jobTitle) || 'Untitled job', trimmed(item.brandName)].filter(Boolean).join(' · ');
  return `<button type="button" class="inbox-job" data-project="${esc(item.jobId)}">${esc(name)}</button>`;
}

function inboxStatus(state = {}, signal = {}) {
  if (state.declined) return `<div class="notice" role="status"><span>${esc(state.message || NOTE_DECLINED)}</span></div>`;
  return state.submitted || state.needsReconciliation ? notifyClaudeNotice(state, signal) : '';
}

const inboxError = state => (state?.error ? `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>` : '');

function inboxSummary(item) {
  const summary = trimmed(item?.summary);
  if (summary) return summary;
  const credits = creditNumber(item?.credits);
  if (credits !== null) return `${creditFigure(credits)} ${credits === 1 ? 'credit' : 'credits'}`;
  return item?.credits && typeof item.credits === 'object' ? priceWords(item.credits) : '';
}

const IN_CHAT_LINE = 'Answer in chat. Posting and spending are approved only there.';

/** Takes of a voice-over or music track, side by side with a player each; the picking is done with the answer buttons below. */
export function takeList(takes) {
  const list = (Array.isArray(takes) ? takes : []).filter(take => take && trimmed(take.label));
  if (!list.length) return '';
  return `<div class="takes" role="group" aria-label="Takes to compare, side by side">${list.map(take => {
    const src = safePreviewUrl(take.url);
    return `<figure class="take"><figcaption>${esc(take.label)}</figcaption>${src ? `<audio controls preload="metadata" src="${esc(src)}">${esc(take.label)}</audio>` : '<p class="muted take-wait">Getting this ready to play...</p>'}</figure>`;
  }).join('')}</div>`;
}

// place keeps element ids unique when the same question is also shown on its stage (place 'stage').
/** The pictures a question is about, side by side, each opening full size. */
export function questionStillList(stills) {
  const list = (Array.isArray(stills) ? stills : []).filter(still => still && trimmed(still.label));
  if (!list.length) return '';
  return `<div class="q-stills" role="group" aria-label="Pictures for this question">${list.map(still => {
    const src = safePreviewUrl(still.url);
    const body = src ? `<button type="button" class="media-open" data-view-media="${esc(src)}" data-view-alt="${esc(still.label)}" aria-label="${esc(`Open ${still.label} full size`)}"><img src="${esc(src)}" alt="${esc(still.label)}"></button>` : '<p class="muted take-wait">Getting this ready to show...</p>';
    return `<figure class="q-still">${body}<figcaption>${esc(still.label)}</figcaption></figure>`;
  }).join('')}</div>`;
}

// A question answered anywhere is closed everywhere, and a closed card is one line: a tick, the title and the answer.
// A tap that came after the question was already answered shows what was saved and when ("Answered in chat at 3:42 pm").
export const questionClosed = (item, state = {}) => Boolean(state.answered && item && !item.inChat);
export function closedQuestionLine(item, state = {}) {
  const inOption = Number.isInteger(state.choice) ? inboxOptions(item.options)[state.choice]?.label : '';
  const answer = trimmed(state.savedAnswer) || trimmed(state.text) || inOption || '';
  const note = trimmed(state.closedNote);
  return `<div class="q-closed" role="status"><span class="q-tick">${CHECK_ICON}</span><span class="q-closed-title">${esc(inboxItemText(item))}</span>${answer ? `<b class="q-closed-answer">${esc(truncateText(answer, 120))}</b>` : ''}${note ? `<small class="q-closed-note">${esc(note)}</small>` : ''}</div>`;
}

function questionCard(item, state = {}, signal = {}, index = 0, { place = '' } = {}) {
  if (item.inChat) return `<p class="inbox-note">${esc(IN_CHAT_LINE)}</p>`;
  const key = String(item.questionId);
  const options = inboxOptions(item.options);
  const locked = Boolean(state.busy || state.submitted || state.needsReconciliation || state.answered);
  const chosen = Number.isInteger(state.choice) ? state.choice : null;
  const buttons = options.length
    ? `<div class="inbox-options" role="group" aria-label="Answers">${options.map((option, at) => `<button type="button" data-inbox-answer="${esc(key)}" data-choice="${at}"${chosen === at ? ' class="is-chosen" aria-pressed="true"' : ''} ${locked ? 'disabled' : ''}>${chosen === at ? CHECK_ICON : ''}<span>${esc(option.label)}</span></button>`).join('')}</div>`
    : '';
  const typed = item.allowText !== false;
  const typing = typed && !locked && (Boolean(state.open) || !options.length);
  const link = typed && options.length && !typing && !locked ? `<button type="button" class="sb-ask inbox-type" data-inbox-type="${esc(key)}">Type an answer</button>` : '';
  const id = `${place ? `${place}-` : ''}inbox-answer-${index}`;
  const box = typing
    ? `<form class="inbox-answer" data-inbox-form="${esc(key)}" novalidate><label class="visually-hidden" for="${id}">Your answer</label><textarea id="${id}" name="answer" maxlength="${ANSWER_LIMIT}" placeholder="Your answer">${esc(state.draft || '')}</textarea><div class="inbox-actions">${options.length ? `<button type="button" class="quiet" data-inbox-cancel="${esc(key)}">Cancel</button>` : ''}<button type="submit" class="primary">Send</button></div></form>`
    : '';
  const upload = item.wantsUpload && !locked ? questionUpload(item, state.upload || {}, { place }) : '';
  const sent = locked && state.text ? `<p class="inbox-sent">${esc(`"${truncateText(state.text, 160)}"`)}</p>` : '';
  const done = state.answered ? '<p class="inbox-note" role="status">Claude has your answer.</p>' : inboxStatus(state, signal);
  // "Type an answer" sits in the row with the answer buttons, so every card ends on one row of buttons.
  const row = buttons && link ? buttons.replace(/<\/div>$/, `${link}</div>`) : buttons || link;
  return `${questionStillList(item.stills)}${takeList(item.takes)}${row}${upload}${box}${sent}${inboxError(state)}${done}`;
}

// The server and saved board snapshots still use the longer message.
// Both versions mean the review has no action yet, regardless of displayed copy.
const REVIEW_NOT_READY = new Set(['Claude is getting this ready to show you.', 'The Director is getting this ready to show you.', 'Getting this ready.']);
const reviewNotReady = item => REVIEW_NOT_READY.has(trimmed(item?.summary));

// Small pictures of what a review is about (storyboard pictures, clips, the joined or finished video, the post), each opening the review.
function decisionPreviews(item, jobId) {
  const list = (Array.isArray(item?.previews) ? item.previews : []).slice(0, 3).map(entry => ({ video: entry?.kind === 'video', src: safePreviewUrl(entry?.thumb) })).filter(entry => entry.src);
  if (!list.length || !jobId) return '';
  const figures = list.map(({ video, src }) => `<button type="button" class="inbox-preview${video ? ' is-video' : ''}" data-inbox-jump="${esc(jobId)}" data-inbox-target="review" aria-label="Open the review"><img src="${esc(src)}" alt="${video ? 'A frame from the video' : 'A picture to check'}" loading="lazy"></button>`).join('');
  return `<div class="inbox-previews">${figures}</div>`;
}

// The card's header line on home and in chat: what it is about and its version.
const decisionAbout = item => (item.gate && Number(item.version) > 0 && !reviewNotReady(item) ? `<p class="inbox-place review-version">${esc(cardAbout(item.gate, item.version, { clip: /\.(mp4|mov|webm|m4v)$/i.test(String(item.artifacts?.[0]?.path || '')) }))}</p>` : '');

// A decision on home or in chat opens the card on its job page. Money and posting are approved there, on the full card, never from a thumbnail.
function decisionCard(item, ctx = {}) {
  const jobId = item.jobId || ctx.project?.jobId || '';
  const summary = inboxSummary(item);
  const summaryLine = text => (text ? `<p class="inbox-summary">${esc(text)}</p>` : '');
  if (reviewNotReady(item)) return summaryLine(summary);
  const reviewButton = `<button type="button" class="primary" data-inbox-jump="${esc(jobId)}" data-inbox-target="review">Review</button>`;
  // The Post-production offer sits beside Review: two ways to finish the same joined video.
  const offer = ctx.offer ? handoffButtons(ctx.offer, ctx.offerState || {}, { sendOnly: true, bare: true }) : '';
  return `${summaryLine(summary)}${decisionPreviews(item, jobId)}<div class="inbox-actions">${offer}${reviewButton}</div>${ctx.offer ? inboxError(ctx.offerState || {}) : ''}`;
}

const INBOX_FIELD_INPUTS = new Set(['select', 'checkboxes', 'textarea', 'url']);
const FIX_HIGHLIGHTED = "Fix the highlighted answers first.";

function fieldAnswered(field, values, intake) {
  if (field.input !== 'deliverables') return !intakeFieldEmpty(field, values);
  return deliverableRows(field, intakePlatforms(intake, values), values).some(row => row.format);
}

function flaggedField(field, keys) {
  return keys.some(key => key === field.key || (field.input === 'budget' && key.startsWith('budget_')) || (field.input === 'deliverables' && key.startsWith('deliv_')));
}

function itemField(item) {
  if (!item?.field || !INBOX_FIELD_INPUTS.has(item.input)) return null;
  const options = Array.isArray(item.choices) ? item.choices.filter(choice => choice && typeof choice === 'object') : [];
  if ((item.input === 'select' || item.input === 'checkboxes') && !options.length) return null;
  return { key: item.field, input: item.input, label: trimmed(item.text) || humanize(item.field), missing: true, value: null, options };
}

function briefFields(item, intake, errors = null) {
  const all = intake ? (intake.fields || []).filter(field => field && field.input !== 'photo') : [];
  if (item.field) {
    const own = all.find(field => field.key === item.field);
    if (own) return [own];
    const field = intake ? null : itemField(item);
    return field ? [field] : [];
  }
  const flagged = Object.keys(errors || {});
  return all.filter(field => field.missing || flaggedField(field, flagged));
}

export function inboxIntakeArgs(project, draft = {}, keys = [], { requestId, required = null, items = [] } = {}) {
  const fallback = items.map(itemField).filter(Boolean);
  const intake = project?.intake || (fallback.length ? { fields: fallback, platforms: [] } : null);
  if (!intake || !project?.jobId) return { errors: { form: 'Open the job.' } };
  const revision = [items.find(item => item?.field === required), ...items].find(item => Number.isSafeInteger(item?.revision))?.revision;
  const values = intakeValues(intake, draft);
  const fields = (intake.fields || []).filter(field => field && field.input !== 'photo' && keys.includes(field.key));
  const own = required ? fields.find(field => field.key === required) : null;
  if (own && !fieldAnswered(own, values, intake)) {
    const { errors } = intakePatch({ ...intake, fields: [own] }, draft);
    return { errors: Object.keys(errors).length ? errors : { form: TXT_ANSWER_THIS_FIRST } };
  }
  const answered = fields.filter(field => fieldAnswered(field, values, intake));
  if (!answered.length) return { errors: { form: TXT_ANSWER_THIS_FIRST } };
  const { patch, errors } = intakePatch({ ...intake, fields: answered }, draft);
  if (Object.keys(errors).length) return { errors };
  if (!Object.keys(patch).length) return { errors: { form: NOTE_NOTHING_CHANGED } };
  return { args: { requestId, brand: project.brand, jobId: project.jobId, expectedRevision: revision ?? project.revision, patch, ...(project.title ? { title: project.title } : {}) } };
}

function briefCard(item, ctx = {}, index = 0) {
  const { project = null, intake: state = {}, signal = {}, briefKeys = [], briefLead = true } = ctx;
  const jobId = item.jobId || project?.jobId || '';
  const intake = project && project.detailsLoaded !== false ? project.intake || null : null;
  const values = intakeValues(intake, state.values);
  const all = item.inline ? briefFields(item, intake) : [];
  const errors = all.length ? state.errors || prefillIntakeIssues(all, values) : null;
  const shown = item.inline ? briefFields(item, intake, errors) : [];
  if (!shown.length) {
    const summary = inboxSummary(item);
    return `${summary ? `<p class="inbox-summary">${esc(summary)}</p>` : ''}<div class="inbox-actions"><button type="button" class="primary" data-inbox-jump="${esc(jobId)}" data-inbox-target="brief">Finish the brief</button></div>`;
  }
  const single = Boolean(item.field);
  const keys = single ? [...new Set([item.field, ...briefKeys])] : shown.map(field => field.key);
  const here = state.inboxField && keys.includes(state.inboxField) ? state.inboxField === (item.field || null) : briefLead;
  const pending = Boolean(state.submitted || state.needsReconciliation);
  const label = here && state.busy ? 'Saving...' : here && state.submitted ? TXT_WAITING_FOR_CLAUDE : here && state.needsReconciliation ? TXT_NEEDS_CLAUDE_ATTENTION : 'Save';
  const message = errors?.form || (state.error && state.error !== FIX_HIGHLIGHTED ? state.error : '');
  const error = here && message ? `<p class="notice error inline-error" role="alert">${esc(message)}</p>` : '';
  const platforms = intakePlatforms(intake, values);
  const fields = shown.map(field => intakeFieldHtml(field, values, errors, platforms, null, { prefix: `inbox-${index}`, needed: false, labelled: !single, currency: projectCurrency(project) })).join('');
  const own = single ? ` data-inbox-field="${esc(item.field)}"` : '';
  return `<form class="inbox-fields" data-inbox-intake="${esc(jobId)}" data-inbox-fields="${esc(keys.join(' '))}"${own} novalidate>${fields}${error}<div class="inbox-actions"><button type="submit" class="primary" ${state.busy || pending ? 'disabled' : ''}>${label}</button></div></form>${here ? inboxStatus(state, signal) : ''}`;
}

// Jobs newest first, oldest at the bottom: by when the job was opened, else the date in its id (job-YYYYMMDD-...). Stable for ties.
function jobOpenedAt(project) {
  const started = Date.parse(project?.usage?.startedAt || '');
  if (!Number.isNaN(started)) return started;
  const day = /^job-(\d{4})(\d{2})(\d{2})-/.exec(String(project?.jobId || ''));
  return day ? Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : 0;
}
export function newestJobsFirst(list) {
  return (Array.isArray(list) ? list : []).map((project, at) => ({ project, at, time: jobOpenedAt(project) })).sort((a, b) => b.time - a.time || a.at - b.at).map(entry => entry.project);
}

const INBOX_TEXT_FALLBACK = Object.freeze({ decision: "A decision is waiting for you.", brief: BRIEF_MISSING, question: '' });

export function inboxKey(item) {
  if (item?.kind === 'onboarding') return `onboarding-${item.brand || ''}${item.state === 'subtopics' ? '-subtopics' : ''}`;
  if (item?.kind === 'post') return `post-${item.jobId || ''}-${item.target || ''}`;
  return item?.kind === 'question' ? `question-${item.questionId}` : [item?.kind || 'item', item?.jobId || '', item?.field || ''].filter(Boolean).join('-');
}

export function inboxItemText(item) {
  return trimmed(item?.text) || (item?.kind === 'decision' ? GATE_TITLES[item.gate] : '') || INBOX_TEXT_FALLBACK[item?.kind] || '';
}

// The button opens the brand's page, so on that page itself (`onPage`) the card is only the note: it never points at where the person already is.
function onboardingCard(item, state = {}) {
  if (item.state === 'subtopics' && item.brand) return subtopicsCard(item, state.subtopics || {});
  if (!item.needsYou || !item.brand || item.onPage) return '';
  return `<div class="inbox-actions"><button type="button" class="primary" data-onboard="${esc(item.brand)}">Open brand profile</button></div>`;
}

// The six subtopics as a question card: their names, then Looks right and Edit. The buttons carry the same data-intel-act as the brand's
// intelligence panel, so they confirm or edit the six wherever the card is drawn. After a tap the card says so and the buttons go, until
// the studio has saved them and the card leaves every list.
function subtopicsCard(item, state = {}) {
  const names = Array.isArray(item.subtopics) ? item.subtopics : [];
  const list = names.length ? `<ol class="sub-six">${names.map(name => `<li>${esc(name)}</li>`).join('')}</ol>` : '';
  const on = `data-intel-brand="${esc(item.brand)}"`;
  if (state.sent) return `<div class="sub-card" ${on}>${list}<p class="inbox-note" role="status">Sent. Waiting for your studio.</p></div>`;
  const confirm = item.exact ? '<button type="button" class="primary" data-intel-act="note-confirm">Looks right</button>' : '';
  return `<div class="sub-card" ${on}>${list}<p class="muted">Every post takes its topic from one of these.</p><div class="inbox-options" role="group" aria-label="Answers">${confirm}<button type="button" data-intel-act="note-edit">Edit</button></div></div>`;
}

// A post that needs the person: what it is, and a button that scrolls to the row or the kit on the job page.
const POST_JUMP = /^(kit|post:[A-Za-z0-9][A-Za-z0-9_-]{0,79})$/;
export const postJump = item => (item?.kind === 'post' && POST_JUMP.test(String(item.target || '')) ? { target: item.target, label: item.target === 'kit' ? 'Open the posting kit' : 'Show the post' } : null);
// A failure that reached Metricool stays on the page until the person says they handled it. That is a per-viewer convenience kept
// in the browser (never anything Claude or other viewers see), so every read and write of it is guarded.
const HANDLED_POSTS_KEY = 'socialCampaign.handledPosts';
const handledPosts = new Set();
let handledPostsLoaded = false;
function loadHandledPosts() {
  if (handledPostsLoaded) return;
  handledPostsLoaded = true;
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(HANDLED_POSTS_KEY) || '[]');
    if (Array.isArray(list)) for (const key of list.slice(-500)) if (typeof key === 'string') handledPosts.add(key);
  } catch { /* No storage: the item simply shows until the job moves on. */ }
}
// The key names the failing line too, so a later failure of the same post shows again.
export const postDismissKey = item => `${item?.jobId || ''}:${item?.target || ''}:${item?.lid || ''}`;
export function markPostHandled(key) {
  loadHandledPosts();
  if (typeof key !== 'string' || !key) return;
  handledPosts.add(key);
  try { globalThis.localStorage?.setItem(HANDLED_POSTS_KEY, JSON.stringify([...handledPosts].slice(-500))); } catch { /* Kept for this visit only. */ }
}
const postHandled = item => item?.kind === 'post' && item.dismissible === true && (loadHandledPosts(), handledPosts.has(postDismissKey(item)));

function stuckCard(item) {
  return item.jobId ? `<div class="inbox-actions"><button type="button" class="primary" data-project="${esc(item.jobId)}">Open the job</button></div>` : '';
}

// The Post-production round trip: an offer to send the video for a full edit, and the call to bring the final video back.
const HANDOFF_BUTTONS = Object.freeze({
  handoff_offer: [['handoff_send', 'Send to Post-production', 'primary'], ['handoff_decline', 'Finish it here', 'quiet']],
  handoff_return: [['handoff_return', 'Bring the final video back', 'primary']],
});
export const isHandoffItem = item => item?.kind === 'handoff_offer' || item?.kind === 'handoff_return';
export const handoffArgs = ({ project, requestId }) => ({ requestId, brand: project.brand, jobId: project.jobId });
// The one small line on a job saying which platforms research could read, or ''. The server words it. The board no longer draws it.
export const researchLine = project => (typeof project?.research?.line === 'string' ? project.research.line.trim() : '');
export const handoffStatusLine = project => (project?.handoff?.status === 'sent' ? trimmed(project.handoff.line) : '');
export function handoffButtons(item, state = {}, { sendOnly = false, bare = false } = {}) {
  const buttons = (HANDOFF_BUTTONS[item?.kind] || []).filter(([operation]) => !sendOnly || operation === 'handoff_send');
  if (!buttons.length || !item.jobId) return '';
  const locked = Boolean(state.busy || state.sent);
  const row = buttons.map(([operation, label, tone]) => `<button type="button" class="${tone}" data-handoff="${operation}" data-handoff-job="${esc(item.jobId)}"${locked ? ' disabled' : ''}>${esc(label)}</button>`).join('');
  const note = state.sent ? '<p class="inbox-note" role="status">Saved. Claude will carry on.</p>' : '';
  if (bare) return `${row}${note}`;
  return `<div class="inbox-actions">${row}</div>${note}${inboxError(state)}`;
}

function postCard(item) {
  const jump = item.closing ? null : postJump(item);
  const summary = trimmed(item.summary) ? `<p class="inbox-summary">${esc(trimmed(item.summary))}</p>` : '';
  const planner = safeHttpsLink(item.plannerUrl) ? `<a class="post-link" href="${esc(safeHttpsLink(item.plannerUrl))}" target="_blank" rel="noopener noreferrer">Open in Metricool</a>` : '';
  const dismiss = item.dismissible === true && item.jobId ? `<button type="button" class="quiet" data-post-dismiss="${esc(postDismissKey(item))}">Done, I've handled it</button>` : '';
  const show = jump && item.jobId ? `<button type="button" class="primary" data-inbox-jump="${esc(item.jobId)}" data-inbox-target="${esc(jump.target)}">${esc(jump.label)}</button>` : '';
  const actions = show || planner || dismiss ? `<div class="inbox-actions">${show}${planner}${dismiss}</div>` : '';
  return `${summary}${actions}`;
}

export function inboxCard(item, ctx = {}) {
  const index = Number.isInteger(ctx.index) ? ctx.index : 0;
  if (item.kind === 'question' && questionClosed(item, ctx.question)) return `<li class="inbox-item is-closed" data-inbox-key="${esc(inboxKey(item))}">${closedQuestionLine(item, ctx.question)}</li>`;
  const text = inboxItemText(item);
  const onboarding = item.kind === 'onboarding';
  const body = onboarding ? onboardingCard(item, ctx)
    : item.kind === 'post' ? postCard(item)
    : item.kind === 'stuck' ? stuckCard(item)
    : isHandoffItem(item) ? handoffButtons(item, ctx.handoff || {})
    : item.kind === 'question' ? questionCard(item, ctx.question || {}, ctx.signal || {}, index)
      : item.kind === 'decision' ? decisionCard(item, ctx)
        : briefCard(item, ctx, index);
  const more = Number.isInteger(ctx.more) && ctx.more > 0 ? `<p class="inbox-more">${esc(`${ctx.more} more ${ctx.more === 1 ? 'thing waits' : 'things wait'} in this job.`)}</p>` : '';
  const opens = ctx.opensJob && item.jobId ? ` data-card-job="${esc(item.jobId)}"` : '';
  return `<li class="inbox-item${onboarding && !item.needsYou ? ' is-info' : ''}${opens ? ' opens-job' : ''}" data-inbox-key="${esc(inboxKey(item))}"${opens}>${ctx.workspace && (!onboarding || item.state === 'subtopics') ? inboxJobLine(item) : ''}${inboxFromLine(item)}${item.kind === 'decision' ? decisionAbout(item) : ''}${text ? `<p class="inbox-text">${esc(text)}</p>` : ''}${more}${body}</li>`;
}

// Several questions from one job on one card: the job line once, then each question with its own answers.
function questionGroupCard(items, contexts, indexes, { signal = {}, workspace = false } = {}) {
  const head = items[0];
  const blocks = items.map((item, at) => {
    const text = inboxItemText(item);
    if (questionClosed(item, contexts[at].question)) return `<div class="inbox-question is-closed" data-inbox-key="${esc(inboxKey(item))}">${closedQuestionLine(item, contexts[at].question)}</div>`;
    return `<div class="inbox-question" data-inbox-key="${esc(inboxKey(item))}">${text ? `<p class="inbox-text">${esc(text)}</p>` : ''}${questionCard(item, contexts[at].question || {}, signal, indexes[at])}</div>`;
  }).join('');
  const lead = `<p class="inbox-summary">${esc(`${items.length} questions from Claude.`)}</p>`;
  return `<li class="inbox-item is-group" data-inbox-key="${esc(`questions-${head.jobId}`)}">${workspace ? inboxJobLine(head) : ''}${inboxFromLine(head)}${lead}${blocks}</li>`;
}

export function inboxPanel({ items = [], count = null, announcement = '', workspace = false, starter = '', signal = {}, context = () => ({}), bare = false, strip = false } = {}) {
  const all = inboxItemsOf(items);
  // The Post-production offer is the other way to finish the same joined video, so it sits inside that video's review card.
  const cutJobs = new Set(all.filter(item => item.kind === 'decision' && item.gate === 'cut' && item.jobId).map(item => item.jobId));
  const offers = new Map(all.filter(item => item.kind === 'handoff_offer' && cutJobs.has(item.jobId)).map(item => [item.jobId, item]));
  const list = all.filter(item => !(item.kind === 'handoff_offer' && offers.get(item.jobId) === item));
  const contexts = list.map(item => {
    const own = context(item) || {};
    const offer = item.kind === 'decision' && item.gate === 'cut' ? offers.get(item.jobId) : null;
    return offer ? { ...own, offer, offerState: (context(offer) || {}).handoff || {} } : own;
  });
  const isAnswered = at => list[at].kind === 'question' && Boolean(contexts[at].question?.submitted || contexts[at].question?.answered);
  // A job's questions share one card, so they count once while any of them is still open.
  const seenJobs = new Set();
  const answered = list.filter((item, at) => {
    if (item.kind !== 'question') return false;
    if (item.inChat || !item.jobId) return isAnswered(at);
    if (seenJobs.has(item.jobId)) return true;
    seenJobs.add(item.jobId);
    return list.every((other, j) => other.kind !== 'question' || other.inChat || other.jobId !== item.jobId || isAnswered(j));
  }).length;
  const hidden = Number.isSafeInteger(count) ? Math.max(0, count - all.length) : 0;
  const needs = Math.max(0, list.filter(waitsOnPerson).length - answered + hidden);
  const tag = needs ? `<span class="pill needed">${needs} ${needs === 1 ? 'needs' : 'need'} you</span>` : '';
  const empty = trimmed(announcement) || (workspace ? INBOX_EMPTY : '');
  const briefs = list.filter(item => item.kind === 'brief' && item.inline && item.field);
  const brief = item => {
    if (item.kind !== 'brief') return {};
    const same = briefs.filter(other => (other.jobId || null) === (item.jobId || null));
    return { briefKeys: same.map(other => other.field), briefLead: !same.length || same[0] === item };
  };
  // On the workspace pages, one card per job: only the job's most pressing step (a review first, then its oldest question, then the
  // rest), with a line saying how many more wait in the job. The card opens the job. Items with no job (a brand question) keep their own card.
  if (workspace) {
    const order = item => ({ decision: 0, question: 1, brief: 2, post: 3, handoff_return: 4, handoff_offer: 5, stuck: 6 }[item.kind] ?? 7);
    const jobs = new Map();
    const loose = [];
    list.forEach((item, index) => {
      if (!item.jobId) { loose.push([index]); return; }
      if (!jobs.has(item.jobId)) jobs.set(item.jobId, []);
      jobs.get(item.jobId).push(index);
    });
    // Within a kind the list is newest first, so the oldest question (the one asked first) is the last of its kind.
    const open = at => !isAnswered(at) && waitsOnPerson(list[at]);
    // An answered question steps aside so the next one shows straight away.
    const lead = indexes => [...indexes].sort((a, b) => Number(isAnswered(a)) - Number(isAnswered(b)) || order(list[a]) - order(list[b]) || (list[a].kind === 'question' ? b - a : a - b))[0];
    const groups = [...[...jobs.values()].map(indexes => ({ indexes, at: lead(indexes) })), ...loose.map(([index]) => ({ indexes: [index], at: index }))]
      .sort((a, b) => Math.min(...a.indexes) - Math.min(...b.indexes));
    const jobCards = groups.map(({ indexes, at }) => {
      const item = list[at];
      const more = indexes.filter(index => index !== at && open(index)).length;
      const card = inboxCard(item, { signal, ...contexts[at], ...brief(item), workspace, index: at, more, opensJob: Boolean(item.jobId) });
      return card;
    }).join('');
    const waiting = groups.filter(({ indexes }) => indexes.some(open)).length;
    const jobTag = waiting ? `<span class="pill needed">${waiting} ${waiting === 1 ? 'needs' : 'need'} you</span>` : '';
    if (strip) return list.length ? `<section class="needs-strip" aria-labelledby="needs-strip-title"><div class="section-head"><h2 id="needs-strip-title">Needs you</h2>${jobTag}</div><ol class="inbox-list">${jobCards}</ol></section>` : '';
    const jobBody = list.length ? `<ol class="inbox-list">${jobCards}</ol>` : empty ? `<p class="inbox-announce">${esc(empty)}</p>` : '';
    if (bare) return jobBody ? `<div class="director-inbox">${jobBody}</div>` : '';
    return `<aside class="inbox" aria-labelledby="inbox-title"><section class="panel inbox-panel"><div class="section-head"><h2 id="inbox-title">Needs you</h2>${jobTag}</div>${jobBody}${starter ? `<div class="inbox-starter">${starter}</div>` : ''}</section></aside>`;
  }
  // One card per job for its questions: the job's open questions sit together on the first one's card, one after the other.
  const groups = [];
  const byJob = new Map();
  list.forEach((item, index) => {
    const groupable = item.kind === 'question' && !item.inChat && item.jobId;
    if (groupable && byJob.has(item.jobId)) { byJob.get(item.jobId).push(index); return; }
    const group = [index];
    if (groupable) byJob.set(item.jobId, group);
    groups.push(group);
  });
  const cardOf = group => (group.length === 1
    ? inboxCard(list[group[0]], { signal, ...contexts[group[0]], ...brief(list[group[0]]), workspace, index: group[0] })
    : questionGroupCard(group.map(index => list[index]), group.map(index => contexts[index]), group, { signal, workspace }));
  const cards = groups.map(cardOf).join('');
  const body = list.length
    ? `<ol class="inbox-list">${cards}</ol>`
    : empty ? `<p class="inbox-announce">${esc(empty)}</p>` : '';
  if (bare) return body ? `<div class="director-inbox">${body}</div>` : '';
  // The compact "Needs you" strip at the top of the home and new-job pages, and nothing at all when there is nothing open.
  if (strip) return list.length ? `<section class="needs-strip" aria-labelledby="needs-strip-title"><div class="section-head"><h2 id="needs-strip-title">Needs you</h2>${tag}</div><ol class="inbox-list">${cards}</ol></section>` : '';
  return `<aside class="inbox" aria-labelledby="inbox-title"><section class="panel inbox-panel"><div class="section-head"><h2 id="inbox-title">Needs you</h2>${tag}</div>${body}${starter ? `<div class="inbox-starter">${starter}</div>` : ''}</section></aside>`;
}

const statusPill = state => `<span class="pill ${esc(String(state || 'pending').toLowerCase().split('_')[0])}">${esc(humanize(state))}</span>`;

export function stageApprovals(stage) {
  return (Array.isArray(stage?.approvals) ? stage.approvals : []).filter(entry => entry && GATE_COMMENT_NAMES[entry.gate]).map(entry => {
    const when = entry.at && Number.isFinite(Date.parse(entry.at)) ? ` ${time(entry.at)}` : '';
    const price = entry.gate === 'price' ? priceWords(entry.totals) : '';
    const checked = entry.gate === 'clips' && entry.signedOff === true;
    return `<small class="stage-approved">${esc(checked ? `${GATE_COMMENT_NAMES[entry.gate]} checked by the plugin${when}` : `${GATE_COMMENT_NAMES[entry.gate]} approved${when}${price ? ` · ${price}` : ''}`)}</small>`;
  }).join('');
}

// @module rail
const RAIL_SETTLED = new Set(['complete', 'pending', 'cancelled']);
const RAIL_UPCOMING = new Set(['pending', 'waiting', 'running']);
const RAIL_HERE_HELD = Object.freeze({ BLOCKED: 'Held up', ESCALATED: 'Held up', CHANGES_REQUESTED: 'Making your changes' });
const RAIL_NEEDS_HELP = new Set(['BLOCKED', 'ESCALATED']);
const RAIL_JUMPS = Object.freeze({ decision: ['review', 'Review'], brief: ['brief', 'Finish the brief'] });
const RAIL_TEXT = Object.freeze({
  notStarted: "Not started yet",
  finished: 'Finished',
  posting: 'Posting',
  lastStep: 'This is the last step.',
  allDone: 'All steps are done.',
  idle: 'Nothing now. The team is working.',
  done: 'Nothing, this job is finished.',
  held: 'Claude needs your help. See chat.',
});

function railJump(item) {
  if (item?.kind === 'post') return item.closing ? null : postJump(item);
  const jump = item ? RAIL_JUMPS[item.kind] : null;
  if (!jump || (item.kind === 'decision' && reviewNotReady(item))) return null;
  return { target: jump[0], label: jump[1] };
}

export function stepRailParts(project, doc = null) {
  const stages = (Array.isArray(project?.stages) ? project.stages : [])
    .map(stage => (typeof stage === 'string' ? { label: humanize(stage), status: 'pending' } : stage))
    .filter(stage => stage && typeof stage === 'object')
    .map(stage => ({ label: stage.label || stage.name || humanize(stage.id), status: stage.status || 'pending' }));
  if (!stages.length || project?.state === 'CANCELLED') return null;
  const heldHere = RAIL_HERE_HELD[project?.state] || '';
  const lastDone = stages.map(stage => stage.status).lastIndexOf('complete');
  let hereIndex = stages.findIndex(stage => !RAIL_SETTLED.has(stage.status));
  if (hereIndex < 0 && lastDone >= 0) hereIndex = stages.findIndex((stage, index) => index > lastDone && stage.status === 'pending');
  const finished = !heldHere && hereIndex < 0 && lastDone >= 0;
  // The last step is the posts going out (or being posted by the person) once the plan is approved.
  const posting = !heldHere && hereIndex === stages.length - 1 && Boolean(doc?.publishStatus?.posts?.length || doc?.postingKit?.posts?.length);
  const here = heldHere || (posting ? RAIL_TEXT.posting : hereIndex >= 0 ? stages[hereIndex].label : finished ? RAIL_TEXT.finished : RAIL_TEXT.notStarted);
  const next = heldHere ? null : stages.slice(hereIndex + 1).find(stage => RAIL_UPCOMING.has(stage.status))?.label || (finished ? RAIL_TEXT.allDone : RAIL_TEXT.lastStep);
  const item = jobInbox(project, doc).items[0] || null;
  const need = item ? trimmed(item.need) || inboxItemText(item)
    : RAIL_NEEDS_HELP.has(project?.state) ? trimmed(project?.blockedReason) || trimmed(project?.nextAction) || RAIL_TEXT.held
      : finished ? RAIL_TEXT.done : RAIL_TEXT.idle;
  return { here, next, need, jump: railJump(item) };
}

/**
 * The job page's top bar: the stops as thin segments across the page, with the current stop named above them ("Step 2 of 6: Storyboard
 * and price, waiting on you"). Every stop done reads "All 6 steps are done". A job with no stops yet draws nothing.
 */
export function jobStopsBar(project, { waiting = false, closed = false } = {}) {
  const { done, total } = stageProgress(project);
  if (!total) return '';
  const stages = (Array.isArray(project?.stages) ? project.stages : []).filter(stage => stage && typeof stage === 'object');
  const status = index => (stages.length === total ? String(stages[index].status || 'pending') : index < done ? 'complete' : 'pending').toLowerCase().replace(/[^a-z]/g, '');
  const at = stages.length === total ? stages.findIndex(stage => !RAIL_SETTLED.has(String(stage.status || 'pending'))) : -1;
  const here = at >= 0 ? stages[at] : null;
  const word = !here ? '' : waiting || status(at) === 'waiting' || status(at) === 'awaiting' ? TXT_WAITING_ON_YOU.toLowerCase() : status(at) === 'running' ? (closed ? ENGINE_CLOSED_WORD.toLowerCase() : 'the team is working') : '';
  const now = here ? `Step ${at + 1} of ${total}: ${trimmed(here.label || here.name) || humanize(here.id)}` : done >= total ? `All ${total} ${total === 1 ? 'step is' : 'steps are'} done` : `${done} of ${total} ${total === 1 ? 'step' : 'steps'} done`;
  const text = `${done} of ${total} ${total === 1 ? 'step' : 'steps'} done`;
  return `<div class="job-stops"><p class="job-now"><b>${esc(now)}</b>${word ? `<span>${esc(word)}</span>` : ''}</p><span class="minimap" role="img" aria-label="${esc(text)}">${Array.from({ length: total }, (_, index) => `<i class="s-${status(index)}"></i>`).join('')}</span></div>`;
}

export function overviewColumn({ strip = '', jobs = '', onboarding = '', onboardFirst = false } = {}) {
  return onboardFirst ? `${strip}${onboarding}${jobs}` : `${strip}${jobs}${onboarding}`;
}

// ---- Home on the new layout: the faces on a job row, its stop bar, the team across the running jobs, and what goes out this week ----
// Home reads these from the job documents it watches (the newest few jobs), so a row without its document yet shows no faces.
export const HOME_WATCHED_JOBS = 10;
const TEAM_RANK = Object.freeze({ needs_you: 0, working: 1, waiting: 2, done: 3 });
/** The people on one job, the Director first: the agents its document says have been called, each with how it looks now. */
export function jobPeople(doc, { closed = false } = {}) {
  return (agentBoxOf(doc, { closed })?.all || []).map(agent => ({ agent, view: agentView(agent) })).filter(person => person.view.called);
}
/** The row's faces: one small character per person on the job, with the names for a screen reader. */
export function jobFaces(people, max = 5) {
  if (!people.length) return '';
  const more = people.length - max;
  return `<span class="jr-who" role="img" aria-label="${esc(`On this job: ${people.map(person => agentNameOf(person.agent)).join(', ')}`)}">${people.slice(0, max).map(person => blob(person.agent.id, person.view.mood, 26)).join('')}${more > 0 ? `<span class="jr-more">+${more}</span>` : ''}</span>`;
}
/** The job's six stops as one thin bar: done green, the one in hand gold when it waits on the person and blue when the team has it. */
export function jobStopBar(project, waiting = false) {
  const { done, total } = stageProgress(project);
  if (!total) return { text: '', html: '' };
  const stages = (Array.isArray(project?.stages) ? project.stages : []).filter(stage => stage && typeof stage === 'object');
  const open = done < total && !FINAL_JOB_STATES.includes(project?.state);
  const status = index => (stages.length === total ? String(stages[index].status || 'pending') : index < done ? 'complete' : open && index === done ? (waiting ? 'waiting' : 'running') : 'pending').toLowerCase().replace(/[^a-z]/g, '');
  const now = trimmed(project?.stageSummary?.current);
  const text = open ? `Step ${done + 1} of ${total}${now ? `: ${now}` : ''}` : done >= total ? 'All steps done' : `${done} of ${total} steps done`;
  return { text, html: `<span class="minimap" role="img" aria-label="${esc(text)}">${Array.from({ length: total }, (_, index) => `<i class="s-${status(index)}"></i>`).join('')}</span>` };
}
/** Everyone on a running job, once: each person with the job they are most needed on (a question for you first, then work in hand), and how many jobs they are on. */
export function homeTeam(entries) {
  const byId = new Map();
  for (const { project, doc, closed } of entries) {
    for (const person of jobPeople(doc, { closed })) {
      const jobs = byId.get(person.agent.id) || [];
      jobs.push({ project, ...person });
      byId.set(person.agent.id, jobs);
    }
  }
  const rank = person => TEAM_RANK[person.view.state] ?? 4;
  return [...byId.values()].map(jobs => ({ ...jobs.slice().sort((a, b) => rank(a) - rank(b))[0], count: jobs.length }))
    .sort((a, b) => Number(isDirectorAgent(b.agent)) - Number(isDirectorAgent(a.agent)) || rank(a) - rank(b));
}
/** The Team on home. A row is a link to the job the person is on; the page opens their thread there (data-team-open). */
export function homeTeamList(people) {
  if (!people.length) return '<p class="muted">Nobody is on a job right now. The team gathers when you start one.</p>';
  const row = ({ agent, view, project, count }) => {
    const name = agentNameOf(agent);
    const title = trimmed(project.title) || 'Untitled job';
    const note = agentPlain(agent.note);
    const director = isDirectorAgent(agent);
    const line = director ? (view.state === 'needs_you' ? agentPlain(project.nextAction) || agentPlain(agent.task) : count > 1 ? `Running ${count} jobs` : agentPlain(agent.task))
      : view.state === 'waiting' && note ? note : agentPlain(agent.task);
    return `<li><a class="ag team-row st-${view.tone}" href="#/project/${esc(encodeURIComponent(project.jobId))}" data-team-open="${esc(agent.id)}" data-team-job="${esc(project.jobId)}" title="${esc(`Talk to ${name} in ${title}`)}"><span class="ag-f">${blob(agent.id, view.mood, 36)}<i class="ag-d" aria-hidden="true"></i></span><span class="ag-b"><span class="ag-n"><b>${esc(name)}</b><small class="team-job">${esc(title)}</small></span><span class="ag-l"><span class="ag-w">${esc(view.word)}</span>${line ? ` · ${esc(capWords(line, 12))}` : ''}</span></span></a></li>`;
  };
  return `<ul class="team-list">${people.map(row).join('')}</ul>`;
}
const WHEN_WORDS = /^([A-Za-z]{3}) (\d{1,2}) ([A-Za-z]{3}), (\d{1,2}):(\d{2}) ([ap])m/;
const MONTH_WORDS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "Sat 3 Oct, 9:00 am, Singapore time" read as a day and a clock in the plan's own words, plus a moment to sort and filter by (the zone is not converted). Null for any other text. */
export function postTimeParts(text, now = Date.now()) {
  const hit = WHEN_WORDS.exec(String(text || ''));
  const month = hit ? MONTH_WORDS.indexOf(hit[3].toLowerCase()) : -1;
  if (month < 0) return null;
  const [, weekday, day, , hours, minutes, half] = hit;
  const hour = (Number(hours) % 12) + (half === 'p' ? 12 : 0);
  // The words carry no year: take the one (last, this or next) where the day of the week fits, nearest to now.
  const years = [-1, 0, 1].map(step => new Date(new Date(now).getFullYear() + step, month, Number(day), hour, Number(minutes))).filter(at => at.getDate() === Number(day) && at.toLocaleDateString('en-US', { weekday: 'short' }) === weekday);
  const best = years.sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
  return best ? { at: best.getTime(), day: weekday, clock: `${Number(hours)}${minutes === '00' ? '' : `:${minutes}`} ${half}m` } : null;
}
const GOING_OUT = new Set(['scheduled', 'draft', 'waiting_in_app', 'handed_over', 'not_sent', 'unconfirmed', 'late']);
/** The posts of the approved posting plans that go out from today for a week, soonest first: the Metricool ones by their status, and the ones the person posts themselves until they mark them posted. */
export function goingOutThisWeek(entries, now = Date.now()) {
  const today = new Date(now);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).getTime();
  const rows = [];
  for (const { project, doc } of entries) {
    const sent = Array.isArray(doc?.publishStatus?.posts) ? doc.publishStatus.posts : [];
    const kit = (Array.isArray(doc?.postingKit?.posts) ? doc.postingKit.posts : []).filter(post => post && !post.marked && !sent.some(item => item?.id === post.id));
    for (const [post, status] of [...sent.map(post => [post, post?.status]), ...kit.map(post => [post, 'handed_over'])]) {
      const when = GOING_OUT.has(status) ? postTimeParts(post?.when, now) : null;
      if (when && when.at >= from && when.at < to) rows.push({ ...when, jobId: project.jobId, title: trimmed(project.title) || 'Untitled job', post: trimmed(post.label) || 'Post', word: POST_STATUS_WORDS[status] });
    }
  }
  return rows.sort((a, b) => a.at - b.at).slice(0, 8);
}
/** "Going out this week": a day and a clock, the job and the post with where it stands. */
export function goingOutList(rows) {
  if (!rows.length) return '<p class="muted">Nothing scheduled yet.</p>';
  return `<ul class="week">${rows.map(row => `<li><a href="#/project/${esc(encodeURIComponent(row.jobId))}"><span class="d">${esc(row.day)} <br>${esc(row.clock)}</span><span class="wk"><b>${esc(row.title)}</b><small>${esc(`${row.post}, ${row.word.toLowerCase()}`)}</small></span></a></li>`).join('')}</ul>`;
}

export function jobFlowStage(stage, index) {
  const s = typeof stage === 'string' ? { id: stage, label: humanize(stage), status: 'pending' } : stage || {};
  return `<div class="stage"><span class="stage-index ${s.status === 'running' ? 'active' : ''}">${String(index + 1).padStart(2, '0')}</span><div class="stage-title"><strong>${esc(s.label || s.name || humanize(s.id))}</strong>${stageApprovals(s)}${s.note ? `<small>${esc(s.note)}</small>` : ''}</div>${statusPill(s.status)}</div>`;
}

// The job's own stages and how many there are. The list is the one the planner made for this job,
// so a research job shows its few stages and a job that makes no media has no pricing stages; the
// count is that list's length, never a fixed ten.
export function jobFlowPanel(project) {
  const stages = Array.isArray(project?.stages) ? project.stages : [];
  const count = stages.length;
  return `<section class="panel job-flow"><div class="section-head"><h2>Job flow</h2><span class="count">${count} ${count === 1 ? 'stage' : 'stages'}</span></div>${stages.map(jobFlowStage).join('') || '<p class="muted">Stages appear once the brief is routed.</p>'}</section>`;
}

/** The job document's file entry for a project output, when it is the same revision. */
export function docFileFor(doc, artifact) {
  const file = (doc?.files || []).find(entry => entry.path === artifact?.path);
  if (!file) return null;
  if (artifact?.sha256 && file.sha256 && artifact.sha256 !== file.sha256) return null;
  return file;
}

export function outputReviewUrl(doc, file, path) {
  return safePreviewUrl(file?.reviewUrl) || safePreviewUrl(doc?.reviewUrls?.[path]);
}

export function previewUnavailableReason({ type = '', path = '', hasDoc = true } = {}) {
  const guess = type || (/\.(png|jpe?g|webp|gif)$/i.test(path) ? 'image' : /\.(mp4|webm|mov)$/i.test(path) ? 'video' : /\.(mp3|wav|m4a|ogg)$/i.test(path) ? 'audio' : '');
  const noun = /image/.test(guess) ? 'picture' : /video/.test(guess) ? 'video' : /audio/.test(guess) ? 'audio clip' : null;
  if (!hasDoc) return 'Still loading. Try again shortly.';
  if (noun) return `No viewable ${noun} yet. Ask Claude, or open it from your computer.`;
  if (/\.(md|txt|csv)$/i.test(path)) return 'Not on the board. Ask Claude to refresh, or open it on your computer.';
  return 'Cannot show this file type. Open it on your computer.';
}

/** Research and strategy as collapsible, readable panels. */
export function documentPanels(doc, openKeys = new Set()) {
  if (!doc) return '';
  const files = new Map((doc.files || []).map(file => [file.path, file]));
  const research = (doc.research || []).map(path => files.get(path)).filter(Boolean);
  const strategy = doc.strategy ? files.get(doc.strategy) : null;
  const block = file => `<article class="doc-file"><h3>${esc(outputLabel(file, doc).title)}</h3>${file.text != null ? `<div class="md">${renderMarkdown(withoutTitle(file.text, file.title))}</div>` : `<p class="muted">${NOTE_TOO_LARGE}</p>`}${file.truncated ? `<p class="muted">${NOTE_SHORTENED}</p>` : ''}</article>`;
  const panel = (key, title, list) => `<details class="panel doc-panel" data-open-key="${esc(key)}"${openKeys.has(key) ? ' open' : ''}><summary><span class="doc-summary-title">${esc(title)}</span>${list.length > 1 ? `<span class="count">${list.length} files</span>` : ''}</summary><div class="doc-body">${list.map(block).join('')}</div></details>`;
  return `${research.length ? panel('doc:research', 'Research', research) : ''}${strategy ? panel('doc:strategy', 'Strategy', [strategy]) : ''}`;
}

const CODE_TOKEN = /\b(?:job-[a-z0-9-]*\d[a-z0-9-]*|[0-9a-f]{8,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]+)\b/i;
const LANDED_OUTPUT = /^drafts\/(D\d+)\/([A-Za-z]+\d+)-v(\d+)(?:-\d+)?\.[a-z0-9]{2,5}$/i;
const QC_STILL = /^validation\/qc-frames\/[^/]+\/[^/]*?(\d+)\.[a-z0-9]{2,5}$/i;
const IMAGE_PATH = /\.(png|jpe?g|webp|gif|heic|avif)$/i;
const VIDEO_PATH = /\.(mp4|mov|webm|m4v)$/i;
const AUDIO_PATH = /\.(mp3|wav|m4a|ogg)$/i;
const DATA_PATH = /\.(json|jsonl|csv|ya?ml|tsv)$/i;
const CHECK_NAME = /(^|[-_.\s])(audit|review|checklist|qc|check|log)([-_.\s]|$)/i;
export const OUTPUT_GROUPS = Object.freeze([['stills', 'Stills'], ['research', 'Research'], ['data', 'Data files'], ['checks', 'Checks and records']]);
const REPORT_STILL_PATH = /^report\/stills\/[^/]+$/i;

function mediaWord(path) {
  if (IMAGE_PATH.test(path)) return 'image';
  if (VIDEO_PATH.test(path)) return 'video';
  if (AUDIO_PATH.test(path)) return 'voice-over';
  return null;
}

export function outputGroup(path) {
  const value = String(path || '');
  const name = value.split('/').pop() || '';
  if (REPORT_STILL_PATH.test(value) && IMAGE_FILE.test(value)) return 'stills';
  if (/^research\//i.test(value)) return 'research';
  if (/^(validation|approvals|revisions)\//i.test(value) || CHECK_NAME.test(name.replace(/\.[a-z0-9]{1,5}$/i, ''))) return 'checks';
  if (DATA_PATH.test(value)) return 'data';
  return 'main';
}

export function outputLabel(item, doc = null) {
  const path = String(item?.path || '');
  const pinned = (doc?.outputs?.pinned || []).find(entry => entry.path === path);
  if (pinned) return { title: pinned.title || 'Final version', tags: [pinned.deliverable].filter(Boolean), note: 'Final version', pinned: true };
  if (/^report\/report\.md$/i.test(path)) return { title: trimmed(doc?.report?.title) || 'Report', tags: [], note: 'Report' };
  if (REPORT_STILL_PATH.test(path) && IMAGE_FILE.test(path)) {
    const known = (doc?.report?.stills || []).find(still => still.path === path);
    return { title: stillLabel(known || { path, at: null }), tags: [], note: 'Still' };
  }
  const word = mediaWord(path);
  const landed = LANDED_OUTPUT.exec(path);
  if (landed && word) return { title: `${landed[2].toUpperCase()} ${word}`, tags: [landed[1].toUpperCase()], note: `Version ${Number(landed[3])}` };
  const still = QC_STILL.exec(path);
  if (still) return { title: `Label check still ${Number(still[1])}`, tags: [], note: 'Check' };
  if (/^research\//i.test(path) && word === 'image') {
    const number = /(\d+)\.[a-z0-9]{2,5}$/i.exec(path);
    return { title: number ? `Research still ${Number(number[1])}` : 'Research still', tags: [], note: 'Research' };
  }
  const approval = /^approvals\/([a-z_]+?)(?:-(\d+))?\.json$/i.exec(path);
  if (approval) return { title: `${GATE_COMMENT_NAMES[approval[1]] || humanize(approval[1])} approval${approval[2] && Number(approval[2]) > 1 ? ` ${Number(approval[2])}` : ''}`, tags: [], note: 'Approval' };
  const kindNote = item?.version ? `Version ${item.version}` : artifactKindLabel(item?.kind);
  if (/^validation\/qc-frames\//i.test(path)) return { title: 'Label check frames', tags: [], note: kindNote };
  const own = /^(?:(?:drafts|media)\/(D\d+)|validation)\/([^/]+?)\.[a-z0-9]{1,5}$/i.exec(path);
  if (own && !CODE_TOKEN.test(own[2])) {
    const stem = /^[A-Za-z]+\d+$/.test(own[2]) ? own[2].toUpperCase() : fileStemLabel(own[2]);
    return { title: word ? `${stem} ${word}` : stem, tags: own[1] ? [own[1].toUpperCase()] : [], note: kindNote };
  }
  const file = doc ? docFileFor(doc, item) : null;
  const given = displayTitle(file || item, '');
  const plain = given && !CODE_TOKEN.test(given) ? given : humanizeFileLabel(path);
  const fallback = word ? word[0].toUpperCase() + word.slice(1) : 'Document';
  const title = plain && !CODE_TOKEN.test(plain) ? plain : fallback;
  return { title, tags: [], note: kindNote };
}

function outputRow(item, index, doc) {
  const label = outputLabel(item, doc);
  return `<button class="artifact${label.pinned ? ' is-pinned' : ''}" data-artifact="${index}"><span class="artifact-copy"><span class="artifact-title">${esc(label.title)}${label.tags.map(refTag).join('')}</span><small>${esc(label.note)}</small></span><span aria-hidden="true">↗</span></button>`;
}

export function outputsList(artifacts = [], doc = null, openKeys = new Set(), { empty = 'Drafts and media appear here.' } = {}) {
  const pinnedOrder = new Map((doc?.outputs?.pinned || []).map((entry, order) => [entry.path, order]));
  const entries = artifacts.map((item, index) => ({ item, index, group: pinnedOrder.has(item?.path) ? 'pinned' : outputGroup(item?.path) }));
  if (!entries.length) return `<p class="muted">${esc(empty)}</p>`;
  const pinned = entries.filter(entry => entry.group === 'pinned').sort((a, b) => pinnedOrder.get(a.item.path) - pinnedOrder.get(b.item.path));
  const main = entries.filter(entry => entry.group === 'main');
  const rows = list => list.map(entry => outputRow(entry.item, entry.index, doc)).join('');
  const groups = OUTPUT_GROUPS.map(([group, title]) => {
    const list = entries.filter(entry => entry.group === group);
    if (!list.length) return '';
    const key = `outputs:${group}`;
    return `<details class="output-group" data-open-key="${esc(key)}"${openKeys.has(key) ? ' open' : ''}><summary><span class="output-group-title">${esc(title)}</span><span class="count">${list.length}</span></summary><div class="output-group-body">${rows(list)}</div></details>`;
  }).join('');
  return `<div class="outputs-list">${rows(pinned)}${rows(main)}${groups}</div>`;
}

// The Agent Box: the Director card, the rail of agents on a job and the one composer that messages them. Everything here
// reads `document.agents`; text the person sees is plain words, and a file is always shown by its title, never its path.
export const AGENT_MESSAGE_LIMIT = 1000;
const AGENT_PENDING_LIMIT = 20;
const AGENT_STATES = Object.freeze({
  needs_you: { label: 'Needs you', tone: 'needs' },
  working: { label: 'Working', tone: 'working' },
  waiting: { label: 'Waiting', tone: 'waiting' },
  up_next: { label: 'Up next', tone: 'next' },
  done: { label: 'Done', tone: 'done' },
});
const AGENT_JARGON = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\b[\w-]+\.(?:jsonl?|mjs|js|ts|md|html|png|jpe?g|mp4)\b|\b[A-Za-z]:\\/;
const agentPlain = (text, fallback = '') => { const value = trimmed(text); return value && !AGENT_JARGON.test(value) && !CODE_TOKEN.test(value) ? value : fallback; };
// "Strategist working" on a project card: one short line from the projection, with a pulse dot while an agent works.
// `closed`: no session watches the board (see agentBoxOf), so nothing is working and the line says the studio has to open first.
export function agentLineOf(project, { closed = false } = {}) {
  const line = agentPlain(truncateText(project?.agentLine, 80));
  const working = /\bworking\b/i.test(line);
  if (closed && working) return `<p class="card-agent">${esc(ENGINE_CLOSED_WORD)}</p>`;
  return line ? `<p class="card-agent">${working ? '<span class="ab-live" aria-hidden="true"></span>' : ''}${esc(line)}</p>` : '';
}
export function agentStateOf(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  return AGENT_STATES[key] ? key : 'waiting';
}
const isDirectorAgent = agent => agent?.id === 'producer';
export const AGENT_HANDED_NOTE = 'Handed to the Director for your decision';
/** One voice: the review card of a pending gate is in the Director's chat only. Any other agent's chat never carries it. */
export const chatDecisionCard = (agent, decision, gate) => Boolean(decision && gate) && isDirectorAgent(agent);
/** The plain line in the chat of the agent whose finished work waits on a decision: it is handed over, nothing is asked of the person there. */
export const agentHandedLine = agent => (!isDirectorAgent(agent) && trimmed(agent?.note) === AGENT_HANDED_NOTE ? AGENT_HANDED_NOTE : '');
const agentNameOf = agent => trimmed(agent?.name) || humanize(agent?.id);
// The Director first, then the others in the order the projection gives them; null when this job has no agents section.
// `closed`: no Claude session is watching this board (the page's own live check), so nothing can be working right now. Each card then carries engineClosed.
export function agentBoxOf(doc, { closed = false } = {}) {
  const source = doc?.agents;
  const all = (Array.isArray(source?.list) ? source.list : []).filter(agent => agent && typeof agent === 'object' && trimmed(agent.id)).map(agent => (closed ? { ...agent, engineClosed: true } : agent));
  if (!all.length) return null;
  const director = all.find(isDirectorAgent) || null;
  return { all: director ? [director, ...all.filter(agent => agent !== director)] : all, director, others: all.filter(agent => !isDirectorAgent(agent)), unassigned: source.unassigned && typeof source.unassigned === 'object' ? source.unassigned : {} };
}
function agentTime(value) {
  const at = new Date(value);
  if (!value || Number.isNaN(at.getTime())) return '';
  const today = at.toDateString() === new Date().toDateString();
  return at.toLocaleString(undefined, today ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function agentMessageProblem(text, agent) {
  const clean = agentMessageText(text);
  if (!clean) return 'Write your message first.';
  if (clean.length > AGENT_MESSAGE_LIMIT) return `Keep your message to ${AGENT_MESSAGE_LIMIT} characters or fewer.`;
  if ((Number(agent?.pendingMessages) || 0) >= AGENT_PENDING_LIMIT) return `The ${agentNameOf(agent)} has ${AGENT_PENDING_LIMIT} messages waiting. Wait for a reply.`;
  return '';
}
export const agentMessageText = text => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
/** What a message is about, as the request carries it: a short label, and the file, the revision and the storyboard panel when the button knew them. */
export function agentAboutOf(about) {
  const label = trimmed(about?.label).slice(0, 60);
  if (!label) return null;
  const path = trimmed(about?.path);
  const panel = trimmed(about?.panel);
  return { label, ...(path ? { path } : {}), ...(Number.isSafeInteger(about?.revision) && about.revision >= 0 ? { revision: about.revision } : {}), ...(panel ? { panel } : {}) };
}
/** The request the composer sends: exactly these fields, and `about` when the message started from a frame or file (the transport adds the workspace). */
export function agentMessageArgs({ project, agent, text, requestId, about = null }) {
  const subject = agentAboutOf(about);
  return { requestId, brand: project.brand, jobId: project.jobId, agent, text: agentMessageText(text), ...(subject ? { about: subject } : {}) };
}
/** The request "Try again" sends, for a job that went wrong on our side. */
export function retryStepArgs({ project, requestId }) {
  return { requestId, brand: project.brand, jobId: project.jobId };
}

// The six words a message shows. Each one is there only because its record is: the projection's `progress` is read from the
// job's records, never from time passing. A document from before it carries only `status`, which maps to the first three.
const MESSAGE_WORDS = Object.freeze({ saved: 'Saved', picked_up: 'Picked up', needs_answer: 'Needs your answer', working: 'Working', done: 'Done', failed: 'Failed' });
export const ENGINE_CLOSED_WORD = 'Waits for your studio to open';
export const agentMessageProgress = message => (MESSAGE_WORDS[message?.progress] ? message.progress : message?.status === 'answered' ? 'done' : message?.status === 'delivered' ? 'picked_up' : 'saved');
// The colour of a message's status line: answered, in hand, failed, or only sent.
const messageMark = progress => (progress === 'done' ? 'answered' : progress === 'failed' ? 'failed' : ['picked_up', 'working', 'needs_answer'].includes(progress) ? 'delivered' : 'sent');
function agentMessageStatus(agent, message) {
  const name = agentNameOf(agent);
  const progress = agentMessageProgress(message);
  const asleep = agent?.engineClosed === true;
  // While no session is watching the board nothing is working, so the board says it waits instead of "Working".
  if (progress === 'working' && asleep) return { progress, word: ENGINE_CLOSED_WORD, note: '' };
  const word = MESSAGE_WORDS[progress];
  if (progress === 'failed') return { progress, word, note: 'Send it again if you still need it.' };
  if (progress !== 'saved' && progress !== 'picked_up') return { progress, word, note: '' };
  if (asleep) return { progress, word, note: `${ENGINE_CLOSED_WORD}.` };
  if (progress === 'picked_up') return { progress, word, note: '' };
  if (isDirectorAgent(agent)) return { progress, word, note: 'The Director replies here.' };
  return { progress, word, note: agentStateOf(agent.state) === 'done' ? `The ${name} has finished. The Director will answer.` : `Passed on at the ${name}'s next step.` };
}

function agentChips(files, more, { artifacts, doc, label, by }) {
  const list = (Array.isArray(files) ? files : []).filter(file => file && trimmed(file.path));
  const extra = Number.isSafeInteger(more) && more > 0 ? more : 0;
  if (!list.length && !extra) return '';
  const chip = file => {
    const index = artifacts.findIndex(item => item?.path === file.path);
    const known = index >= 0 ? artifacts[index] : null;
    const given = trimmed(file.title);
    const title = given && !FILE_EXTENSION.test(given) && !CODE_TOKEN.test(given) ? given : outputLabel(known || { path: file.path }, doc).title;
    return known
      ? `<li><button type="button" class="ab-chip${file.pinned ? ' is-pinned' : ''}" data-artifact="${index}" aria-label="${esc(`Open ${title}${by ? `, ${by}` : ''}`)}">${esc(title)}</button></li>`
      : `<li><button type="button" class="ab-chip" disabled aria-label="${esc(`${title}, on your computer`)}">${esc(title)}<small>On your computer</small></button></li>`;
  };
  return `<ul class="ab-chips" aria-label="${esc(label)}">${list.map(chip).join('')}${extra ? `<li class="ab-more">${esc(`+${extra} more`)}</li>` : ''}</ul>`;
}

const DIRECTOR_ROLE = 'Runs the job';
function agentStuckBanner(stuck, retry = {}, signal = {}, project = null) {
  if (!stuck || typeof stuck !== 'object') return '';
  const internal = stuck.kind === 'internal';
  const reason = agentPlain(stuck.reason, internal ? NOTE_WENT_WRONG : NOTE_NEEDS_HELP);
  const since = agentTime(stuck.since);
  // Try again is only for a job that went wrong on our side, and only while the server says it can be tried (not mid-retry, not after a second failure).
  const mine = Boolean(retry.applied && retry.sinceSeen === stuck.since && !retry.submitted);
  const waiting = Boolean(retry.busy || retry.submitted || retry.needsReconciliation || mine);
  const button = stuck.canRetry === true && internal ? `<button type="button" class="ab-retry" data-ab-retry="${esc(project?.jobId || '')}" ${waiting ? 'disabled' : ''}>${retry.busy ? 'Trying again...' : 'Try again'}</button>` : '';
  const status = button ? (mine ? '<p class="inbox-note" role="status">Trying that step again.</p>' : inboxStatus(retry, signal)) + inboxError(retry) : '';
  return `<section class="ab-stuck" data-kind="${internal ? 'internal' : 'help'}" aria-labelledby="ab-stuck-title"><p class="ab-stuck-title" id="ab-stuck-title"><strong>Stuck:</strong> ${esc(reason)}</p>${since ? `<small>Since ${esc(since)}</small>` : ''}${button}${status}</section>`;
}

// The files nobody on the job owns: the person's own files with the button that adds more, records, and anything else.
function agentFilesBody(box, { chipContext, jobId, openKeys, omitted }) {
  const part = (key, title, files, { by = '' } = {}) => {
    const list = Array.isArray(files) ? files.slice(0, 8) : [];
    const more = (Array.isArray(files) && files.length > 8 ? files.length - 8 : 0) + (Number(box?.unassigned?.[`${key}More`]) || 0);
    const chips = agentChips(list, more, { ...chipContext, label: title, by });
    if (!chips) return '';
    const open = `agent-files:${jobId}:${key}`;
    return `<details class="ab-activity ab-files" data-open-key="${esc(open)}"${openKeys.has(open) ? ' open' : ''}><summary>${esc(title)} <span class="count">${list.length + more}</span></summary>${chips}</details>`;
  };
  const yours = agentChips(Array.isArray(box?.unassigned?.yours) ? box.unassigned.yours.slice(0, 8) : [], Number(box?.unassigned?.yoursMore) || 0, { ...chipContext, label: 'Your files', by: 'one of your files' }) || '<p class="muted ab-empty">Files you add show here.</p>';
  return `<div class="ab-yours"><div class="ab-yours-head"><span class="ab-label">Your files</span><button type="button" class="quiet" data-action="source">Add source files</button></div>${yours}</div>${part('records', 'Records', box?.unassigned?.records)}${part('other', 'Other files', box?.unassigned?.other)}${omitted ? `<p class="muted ab-omitted">${esc(`${omitted} more ${omitted === 1 ? 'file is' : 'files are'} on your computer.`)}</p>` : ''}`;
}

// ---------------------------------------------------------------------------
// The job page, in the Production Studio layout: stages made of step cards and gate sections in the centre, and on the
// right an Inbox of the agents that opens into a chat with each one. Everything a person reads here is plain words:
// a step is shown by its short name, an agent's own report text is never shown, and a file is shown by its title.
// ---------------------------------------------------------------------------

// @module art
// A picture for each kind of decision card: Microsoft Fluent 3D emoji (MIT licence, see THIRD_PARTY_NOTICES.md), shrunk to 92 px WebP (twice the 46 px they show at)
// and embedded so the page needs no network.
const STEP_IMG = Object.freeze({
  memo: 'data:image/webp;base64,UklGRloEAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSP0AAAABgKNtkyLlr6rZbMPNkdidA6yeALfMj7U32TsgEUTuTvdOF043jWtETAA+eklEhF4oIQAgeZESZFpKpZYMkphIPCforB6o7lc7kIhnegYC7wNr6qx1uj4A7xIO2f5C3mMhX1nSy9S59FKXKvlC3mNxIIvAxDK+emWsT2M11XtTtcb6NFer48IUQnhW/Tt90Kn/GZYAjOatuvH2DE19qxnsTzCkViO2OgQJsZDGlS4E0rj033+/1S26uNximEE1MRkdDMFo2NALF+2FbjSA/RFj2mgarZppMPkDMUZqpy4Od1obARNCEiPX3t8XZX97DkwISwkiTgjBSaIlfIwCAFZQOCA2AwAAMBQAnQEqXABcAD59NJVHpKMiIbY1z0CQD4lkAMmxTvteLh1Xf1J9235J3mHmK/WL9ive48+jfit5u8plPqe7R+Nbgrb5qlDzXXwPinyfsjyRgZev3rywyob7b01LXLB4OOcc/cpwOTA4WMPJwazQefgtEG2qyQ4Tcn9VeCi4oraaWPPFPgtIsKrI3CAOTYQAOQBk2mPpajhWjtQxePn9w6kmPo71KwzH4MAA/v6fVR/eavkftGcr5lLTV6P+niVDK0ffMz1j9/r2Q0f39NXv2gi7/xEQ254KrA34j2PIvEvNb01NnkJexd29gkwiMEh+XAH4XvvDhiLBFsPJl+YFYRsfqK1eT4cYBajhg/rRxQfUPNARqHoEZ2sBRfHdNa2RqM50IOnXuqfcfFt81zNcPwPpCVlsyl8XxJe0rE4ju8k+Ur8LrWFPa058iUsrKjG9FaY1jrmImL/yxJ3wiYWJBMrVPTvIH9qqaUKQVFf20QGmq/LT9bf1Cjz6QbjpdCQVoGre8h4HDNmA5HSBZZdtXP8zH//XQf/PQ//66JWuXZ+9N3BrpPKZPG1QN0AMQwOnAxL/edcHIP0IBzVYAjbkTSUAO6iTobulFcc+2SHxG+aZ5wtc1Dvwt87ewbdnac1tF08Dp4lPbocKeG+u2W2Zl+uB/8nx/PKWmPNbGjwE89QliPbuul42Pnuc8Tx9NqthkRjzlFmiUnM2tzC5y9WZjt2lqfOh4C9Vu4cadW5Vv51xGL4KQkO0mDqxnuMsdN9lgh2XAmlCWhguEi2reO25tdEqWDj8pqkWtFmR9I2iw3eVIaUQLZnUrrkQMApXkjKKfiCy3dGDY0kM32Hh6AqdM1eNgh8yzssyqfU24txhVjk11JFB0cY5snhRC6UlHT8Gzi3ZjpMnNY19hMVTvYEdB9fKf7Bd++aE8Jfv5IlAN3jm0HkiN1aiGts8bVQGOodYnNDi7UCfU7gN9DSUP3AsCzZlZEH2zwDraWa9soojX0+qA6/gTx2v2J8T/V+n+GFFltVOvthN2XYKVjdSU3yfsfiA8DEIB4uZJhndX3/j39mj//gPNQEhO5+xs15Q8dF8pgLAAAAA',
  picture: 'data:image/webp;base64,UklGRoIEAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSF4AAAABYBtJUqOjLgJi0vlHo8EC6wTWf0QgaNs2ybafQxjAu2iQnIbJH2x2zhPSuWzh+CKkTc4EeOJ66aQs3d3wu81FyNm2v9PXJuTqv/98PkK7tVFvhLTbJu0mK3YDfxYBVlA4IP4DAABwFgCdASpcAFwAPpFAm0klo6KkKddKkLASCWwYnybE7e6jDanm+P+58iYPmXCfVh+gN6x5jP2V9aP/G9Lp1LvoKdLX5KpMCWmAAzhrfC5T6sEXoTYF2+6920KwSzU7sY8ly3As5wkpPR6DM351+6hmKGdujK4wdP3FSiwGE7x4cC8pxT1npnfwI6BxLVY2UvlUmXJVULZmkD952lI/wxlj+Swcvm9OIfHdZAtHoVneQKZFxFw8jTlNWnl2IADZoedvoFqZlMfYSmNeyVrZdbad7n2vyQTbcQeYNpl3Iy4AoSei3waVtAFZn3fxeymoHrcb4M5BoVoQhA6cK1W2C4/2sxzaQmLtYIZmaJAqlKpb1Y+ijdXSS78fApUcRO1yx/8DY8jRE3CiVj0hTPkpFVPvrYNDyTYkZi5wketsZfmyZFd/O8YxEmPUdfpdxCWR9FpENZPi1g0Wuiz/tM2GpBcamPMNjGixaaWcWf+Cds6xkufuwUVVV1dtbwCMw0LfWeJ/Yfcfefy8eV2lbMyOVrZRLH7aOmQbvtcjt/bz3PPcMRLAmOZbW2SRCheysYG6/ATxn620ExJcob+Lptfu3/AaQIQJrir2+mUgKan5yvw2T85ovtvrafZccLPoYqQ7jZHNbV40eE3+93bYtXsRnyGsEaCNh/VV8bwOkFjVyx/wwMkOxYDGi/ohMi5jWHIHTs7pAnMkOU6nVYwyznoB3DNDfZXVlAgNpbprPS9HtQjedPfvf1N6jzw7XfC9HDk4LlIH7KxDXcsK+ZSbtydqSyb49n/z8FTsS0g8EPPt0m+kpVjtw0UmEZwgemSSwytwhkTlvVdE8/B5v/ArFphaAPqJUJMKNd2q7DEEF6bwObq+o4Tee4UTXDWsh3nOrXSrgKThaapfBkaep4Dp6PqFMtANkoCokk7CgCNrMGpyrS+GDjyvPMpYFNMgZSSLQjcYJKfFkLOWHTNF0Gkti7K6pRRMpHY1RXpPsbFBM5qQPxMgG0oNXhIXlloTQyaELwt57iFaMjHsNfarrt5v1CRW9qi+w/R0n3nmAkV99QS9BVG6s9f5vcBUzESFmj7R0yTjynSIUei9RUDH99hg4vl2p6dqk8Rabs4+RNm5LpdfJUL10yGqi33r3/ek21FJxejC69+YtDGiDB2mJFYl3TCqoL34Pe9EGuUkKcE+rzb2FxM3RKPjYcy+M/cwj/Cn0K5zyheGwvm3JUYcP1QJbuAOaMK5VMQC2cAGw6p+WH38NUdbGi95pTMGZ894zPsLZk9veaWPwTEpLMlqpq+duN0gJybJIfy3ZwP5eT8yAnXQpxskOl+Dbr50dff+F/hN4aC3iPrAnKRm/XViyoPC/LAAAA==',
  money: 'data:image/webp;base64,UklGRjAKAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSIQEAAABsIZtmyFJ1vt9ETU21rZt27Zt27Zt27Zt27bZqoyI793dc7o6KyMPfkbEBOD/vyJSX07gtK4cBowFtJZEsdxNzxw3DrRmRAB4rPIHybuHqwIQqQkRwLl+mPYbdhfdPA3OeQW0FgQYdxwAIx5gQVrBbQFgnKGQGhDtt+83nx04y0J3M5JkYjpg1nlP/vjRJaD5eawSjfy+h8Z/a8YfO2j8fFJodg0cyu5Y0AJ7tUArQjeXh8+uH9YN0RgTW02JyX6ZDS471YGPMrDvTZ4BL9nBY8GOaH2KfG0i51CDDgcz9sXSHwvCow7F97uNRV+4NTzqUTDBawytWOCR8KhLj3m+Ymoh8nwnUhvohxW6kvUSeblzitp0mO/hbvae7Jl5xNWGyDgv01pg5CvjiNSFYkn2sOUml4TWhcNi7EmtpB4uBlcXIiOepbVifG6ESj2Ic8AEJ3/U2Vvz81MnANRJfs4DGDj9Wie89Edv3W+ft+XcgwF4J1lpP2D4/Ac93cU+p7dPXWZcwLuMPDDJdvdFkimZtWApGckXDpwVaEgmKhj/8DfIVERjny2GSH5x3iyAy0EcsNOHZBGMJVsoyG9PHg3RyqnDnA+RIRrbmQL5/mqAr5iqbP0bk7HtFsmThsFVSmXg6WRgJVPk/ZNCK6QYehNDYkWtyTdmhK+Mw+A72TRWt8kPZ0GjIuoG3srCWOWCb08JVwnx7hwGY7ULPj1StRLY0Qpj1QteLlVQzNcREytvTW4H1zZxA19kZIZmv8wEbZfHoYzMMvKOfl7a42W6H5jysNi9PhptwgUMzDTwqTGq7fCY40eLubCIm8K3w+lJLJht4GPDIeUJpvjaYj6MXAauPMV2DMw42JUi5Yl70mJOxt8mgpSlmDXQcmLkNvBleezPyMzuhCtL8VBuiV+NAy1HMd5XtLzIrpXgy/FYtoO5JzsIjXIa2JMpt8ir4KWk0xhzC3zSaynicSNDbpGvjwNXisNDjLklfjBVaU/Uwaczwv8HeqgOPpgKrhSP6xlyi3x9bDlo4FTG3AKfcCol7W4pvyvgy/FYuoO5RzsADZSqGPsFLTN2LgdfDhR3M+aV+OkIaEledmLKK9p1cChZMVkHLavENeDLgsg1DDkl+3goyndY2qJlVHBfaHkiA+9lkU+0L6ZoBzyWLWLKpof7waON4nEJi1wCXxhPtR1wOsVHTHlY6FoaDbTXY7mmpRws8mA4tNtjZ1qqngVe0vDSNngcmEKoWmrymv4QtF8Ue3ZbUa0QePFAOFRRHNb/ltGqY4HxqIY4VFM8ZnuETMkqYZH8YHWooqrSwLC9viUtxGTtsBRDJP88ewJ4RYUdMOHRHwWSoVkUIcSYWo4xhKJoFkbyy0tnA5yg2gKM2fSyV35hi9YrW+x89+bdpwJEUHn1ACZYZONDL7jtydc/+vqn3zq6enp6ero7f//pm0/eevbuS4/dZukpAXhFltpo4F8HjZ5gsqmmnX7m2WabY445Zp15hummnnyisUMVAFzDIVtR3/AqKFe9906Qu4ioqmtZVUUE/6cFVlA4IIYFAACQHgCdASpcAFwAPo06l0elI6IhMdTceKARiWwAzBom2l5OfMvx7/i3SOdUxhHynO3kR9U3mAc8zzJftJ6uPo49AD9letA9AD9gPTn9jT9yfYA/bLMXH676a1czx7oP89GoL+t++I/qS5x6sy13t1YDiMyPusuImFlEUX53shdM/uFOzJ6j1jRO2LX85gcElFxJINsdCN+O3eugj5SDyTjUCkIZzsiC99bneaWnrzf/a5zBxqkRK9W6fkp36onh5ABb9g/mm1eG3yqecv9b0DecAK+4o4FjJMN0AgMnxbOCFLs3zW/lioVdm0DHnc14VVE6lnRq9isIkfu3l7SAAP7+BtFZ6+xN929NAwZeEkqai8QKN0/6lHvnQi61NU0NSwuMQ7dwtLz/39uvk52gufhHaFKh2TWc7akdwcEYyrhIDEb9l/38YvQ4+VVePvnDVS8KRlYvW2ZVUDxuhqPoUb8cQZ2PJ6KpyZlNVHZ5HJ6x96Rch4OHYMp+Y/CMWlZUvdNSZec/l1b//63d6uG5vm+X+bvq3eTAsLgOjpQxN00pv/DXyDkAbf8C2fljcHgznMU7o/K4KD8TUk+flgiEz4b815Pgevi62lTu8cZ/YmbbSmltvkNbhXaEMgrUhxO9Krf0OJQzyTAWVlCeIXCY49t7+1HQ3jOdnk8IMkj/qHe8nKfcY7eYRZ9NR2xQrS+WOEyI0fIp4VW93pSlEw1Zggio6Hk1qqqLw+U8rCJqo56FxhuRuFEJ4Amewtsw3r3jSjog+0W1IvQ2c+O+j/Mc8n6TX9O29GH7agve/afCLn8L7Vmpif9ThTwSEeqdULSfJif5DTosoIn1RyNwCFs+btEZKg0RE2eHuYL9TX+MhkDNyTv3ijBvYUbD8JsiTevFZDHUImvB24gstcfhzaAlUbxoblgauHUohEc/cOKjukdcVWGP9D5KIrxBdY4IrwyLzqnPgvNghJEqJ8Hs3DuZAZRFYLGlA7MXC9CxcjqE2IexQbHqErOuyqYFG61D/8bUXtgQGOXkH6EbIW1XbubLFkPDhwpIOvgGbsvwSTyHFVVOa+ClR0ETJDJ7M6/8ukjPdk62Fj8aeLJwyztqkGAJrjarKjrX8oZrbQVSbhk24VtPpeMxzG0qHfJl8FcWlCut3wedBlUQpFRYM5p86QQtAOiOMFITjcfRr4aAN6V020N7FoKPTzoitonuhV2HbqPs624PQEWkvnJLu8EdxwhpGkuwyLiTEivP+TRL6YjnpKJnwRZTdLlp95xNSJ2XgcgqsMFKRZ6+YG4GNYzq7NksqZehnAb1Et8TPoXzCP4IYGe9a2Y3LOxrBGUS8pyh/95WEE0X/YHf2BK0lkg4g+98W6CRuikLy/an9bUJ+k3tFbfEllSDuATBgr8yqWByb1Fdk8O5mfMrhZMpi+g/nWYr9jzwL4IbdqI9hSaqn16IlA1j8IyV8ah+uKUpAZcc1/cpwZy1D62OOGehj1w7ROIto0px1weD0rXyouHOiDNEYdhDdW5yIf9SJothiK0sErKUgbXBZe3uRQ0MShYbcVY3Yt3g7qNqon89PfXJhNFRjgKIX419zZV7zZsV8fQjwJ1nKpCsfaGDM6EI+8W3IvUPaYv502ToWwNYOSFTiX079t/GHE+sCiRM/W6kEjZryJFuhU+IN2/6aXBkfCut0Tff3WJHsW25VmyqsVxNc4Ozvuj5bdcXE5aAOxRUZ4AfKvIuKMmQ51zQ2P+ZQvM17RmGxtcR5a7HOOBHp9hmGm6LZNqIkhCF4KdUDOl9I0FD1J9Ey5gbl83zc2dATnfHI+cKjeEPmfu6ZUDlKkf9K7QI+VMJsCWlsS2p1oHAk1w4eXYt54wdaH4EAef4Wv/Ln//9WgQzMJl4AAAA',
  clapper: 'data:image/webp;base64,UklGRv4IAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSIcDAAABoATJtmnbGmvOtZ9t27bN3rdt202jZdu2bdu2zatz9l5rjsbTPmc/40dETADWaju3snLqE9VEVkKSNPJYerJyceo9AHSfd9h5Z+3ZCX6l4UQFADosPO72t2tI8vUFkJWAE1UBgMaTj7rr839IMk3LKf+ZCimY+MQDkLaj9r7uszJJhixEklbmy01QYKc+UQDtxu583psZScYQjcsOnA8tiFMVADp6l3Of+ZOkhSxyBYOdCV99zqliyV7bn/3sdySZpcG44pHPQlxVOfFeAPgOi097+tcSyZBm0Zir8ede0OoRn3gAjXvMOO6+37hkFqIxf2vYBkl1OPUeALrPOfLGz0jSQjRW0kLawEuqwqkAQIsZR1z/Zj3JkGWRFbUQSfLPQ+Ar40QVAJLh+1/73u8kLU2DsYIWs0iS6Vvn7zzUw+XnNPEA0Lz/9he9WxNJhjREVtBCGkiy5rMb9h3eTFBRVQCthmxx5vM1JBlDNGP+FrI0kvznwzuOntoYAETV5SfA4C1PeehHkowhsqIWskDSPrrj+EWdAEDUoaKC6bd/npHM0sxYQbMYjSR/uueExf0EgE/UocKKbf4gY5oGY/4WQzCS9s/TJy/u2QyAJF4dKq5u2DcsB2MFY5ZmJLNfXztnmx4CAKrqUJUeZ7JkzN1CmhrJn1+6eK/hWFLFOVSruOaPWsacLQQj2fDqpftMaQlAvBeHahZ0eZl5WAyBS3561X4TugBwSaIO1S5o/cQKWcgyI9nw/d1HTGznAWjiBUV0igtYXp6YlgPJui8fPnF+WwBwXsWhqAl2CyEuxUIWSPKrB0/bog8AiIpDoT3G/chIiyGS5J+PnbHFsEYANPEOhXfS+MVQNpIsvXbWVoNaAZDEq8NKMcHFZPbnW5fvNqgRAGiigpWmYsKDl+81QgBARBxWxr5RI6+ixZXcZImV99DZ06fPKPb02b0guSgm/M7CG78YBMnDY+tS8WIsT4Xms1kdrejB/puY1+b1LHy02knrwrYqrQRiaUo+gr7fMBYt42vdIHkoRnxPK1qwD/pC8/DYNmXho2XT8tqsbmVQMzGvzetXBrWT/i/R4tqVwV/j8lH0/t1i0TJ7pwckDyjuZLlg1sCznHe5CEb+xVJa6BI/GOgU+Tos/JAFf30KPPIW9Dv2utsKe+ttVx3cFYL8E8A3KWzjJgIoKqmJQ2EdxAsq7AqNtaEAVlA4IFAFAAAQHgCdASpcAFwAPpE4l0gloyohLVZtsUASCWQAyfgTjlhffKs0uzX6Ptu75gP2H/Wb3o/QBvGXPv+yj5Kuao9mv+Z4Wv01CqzLueg8EoR+I3Sm41fRI8ZvXv9V+wT+uPWF/Z32MP2ddB7cH3md8jL6Y2nXSsH0ki5rbaxCHGkLcJ2MqT7nlKMfng50xB7vyMG7xdjey3wtq68/+FHWQ7QCPhYM2NHRyXcD5L9dlyOl/kUEc3Gm4rageet/dIO2kR4f6Gc/h9MPostcha5AlHYTCWqxtTLe0fHmhth8HRwyh7MK6A9xJF2LfQpuUL9awENLEVgzKQmZ53AA/v206iv6LV9RDVA0VP+EJeaG8RZJpbOjaeFM3X0RHCKZ8kb/Wau/8ezS5LHDt4jg+LgpblH/WZSZ+l0UbJAs8MxpDoVUAxLWFCvsz6BjSh4eFKfuLs0hBrCilK47lBStGQtaNE129CuYoyLpZGUKb2GUH4b1m8+zgvqH8aUlp5itWt11ZmYyE9OxdCf23j+blxwUaIidAbirCgvRNU4BchqUEWiRSe537QLuCWRQEG+eRUJr6b2qzCsNmQBfl06h2J0ha59qEpV/pdea3/NjROfPPb+ITjNJO+dji7xakK3rsoW/kwe/AQAvYJgl35ZA27Hu6krZooWWALKDiROiB0kARTaDkTz6LqltBpxOQv08cTkheoecK7G/CLaPPX9ITHtmK5Grsqaz/g8VPdstfD8L6jVSL3P9PpAtoS0Ol7FA06+W8eHjSelF/qpykhO30vaS47qBQSvybVY2qnj55uubiN7HRlkXzX7fnsQg0mEGiuyNHpe0loa4kQhikKAnleHaOOo1nkXfN5NI9ctNQzU317UZCcm8UX1i4SYQtM9vsSHpu97IQ3VdicwlPJRMZNXcIJ9amIGN3408SZxNq6FBmQh/k1f9T402GwWqRoN6EWb/5gJdWm8lcO8vhxf9bXGCn2FQAWrmm69PzRwE51cbyrLBc2wOkH35zyPwavI2ZOsT9bZW6Iey5tNR1V75g5ze5KVPX8TMsDA5ks193KIi9PIBa4Jq4rd/n/9Dz83StAXTMZv9U79uYQwK6N/Tcro13bJVwQ7STtYqS/l7NfjMP6S3GHdz74K8DMSLJ922c/mqeMEr5LNa9Z3m8LNkqZt1Bu5ZpEKdEK6UIGj1V+3KXSTtuty5SWhIi2w5G9wY/BCcz4nIWUSrQptwU52FXLxoJSO+6D/ymA0hZiRG+79eWsrGPiSFjaNwG1finuwBH996+1vyhSD9ymuImvnUsuHW6ic30csWGX4VtNJqgNpV84H3bhwXsiA3Mg2pWfUcdTIQcPTPJqSUP0bYyKxv/bvzb1OGCVyFfCKX/rSSxKF2uRYeGoVtH5II3CNR825nPKIVEPZ4onWGi8PxYx44gm0Oq4NxfyEmz/gaeO88mUHoaYz+CLlNK0icb9CSWLTLXoUQf6IUm+e24NlWnp8BTRNO6su6iXqZ9P7nsbRMAKEA8rEWyFwVwMpSmki1wGfbZ2xO10JejqDYO4+DauVLHtiBQ1iBrViEmQzuUYJ/NVu6nxB6iG3/bsAA07JFP28vTERCyCCXfoC1EQzSPfgjBMNawbS4FemMVLypSg4f/wGy1GgPh8gCEnOFkJ4YkDOErp1vJCB8CdOkuPSrqIbfIuhgXYRA/w7oYF2NFzS8rsX2YF20kgkkZFQ9KhgHKoNSL5gi44DXgaK8jOuSmaezbAm9bOjPJW/yCyUEhzqpUcShRZs5PZw/qNAb7L5PciQR7oj9XTKSr03+SLSnI1STpXpDAAAA',
  eyes: 'data:image/webp;base64,UklGRgQJAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSPADAAABoEbb1iFJut/7vmjbdnd2j23btvXPtm3btm21bdv2IDM+3B9VGRmRK8Yza0XEBOD/o1XN7FTNKlMiWqGm0iIqLSWiFWoqrUVVi2gAUBLViwQ1jaQhkQIAierVEQUARleDRECDPkfe8c7gCdPGDXzr1kN71gMiqUTqAFHn/W94tf+4aROHvH/vcf0aA5HOzABdz3p/FZMuf+vkjlA6mRa0OvLFBUz68xdn9wFMNipC86vGkXTWeu+9s9aRHHlhI0RJIkRn9SfprHXee2+tIznt9k4wKgMBjhxBxtYzqY8tOfhAQGpTgh2+I13smdTbEjn5DECnphHdVaK1rDhYy99uNNA1BHLhejobWLGL6Z5tAp2SRssPSBeYZnDka80ggKgGj5AuMFUX+FMX6FS0avsdXWDawfOjlkqLNHye3jN1yzHdoVMQafoxS8yyxNcaam0eYikww5hD2oukgPtYDJmEIm8Czg1Fz0xLfLWOqEo0jmUcmK233LnwW3DMOOb50BUoaTmbnll7jvqejlmHsKqXkmQGd9Mz+0AGZu/5KnQiLT3mh2qg96zCEFZvBZMkwnXeMTdteBSRKieqcX/G+eE4vjOknMGua0PID+/jI2HKRTiXMXM05q0wqjYl+pmQMx83VOXQ7FvmiuW4jpDaBJ0n0eaJ49JCkp5z6fLE85dNoGvT6LOUPk+Cd1slKSzPG7/1/4Isyy9Bz/l0eeLDb5sm6TotZ7iybzmFVv1p88RycmdIGWVeYZwvXzWFqg0GV+RLzPugy0XYr+hDfgTnT4JBWVGtR9Llh+OM3tDlEOFe2vywfEkMEhq1xfIQqsH7agjh5/2QCAYv0VcDGarA80sYlUhUr5U+ZBbcgmnBZxZ8aTtoJBdcRJuZ49E704esLO+FQqW67nssZVTkKwr3sphRiT81k8oEXUeylEmR/dsp3fgjFkMWMWdvBI3KDTaZyjiDmKP7QGt0+J6lkF7MJTsjQpoGm4ymCykFy8EFaECj05e0PqXgOHMHGKSr0fl90oUUgiNfbwcDAILmT5AupBBc4PcFGKRtUP/ylaR1IVFwjlx2bl1o1CrQJ84nrfOJgrPk+tubwiB9USi8spz0cWyd997ZOPbkkqd7QARlRdDxvgVkiGPrvPfOxrEj13y4JaCRpRJguwfHxExaHHHP5oAoJBWgcPPgX5g0THx6T0AUMhYDdDroxneGz12xZvmcoW9es387IBJUKAZosfdlrwyetWzNinkjP7jtyB6A1qhCEwGo37ZHoV+hR9u6ACKNFHUEIGrdvdCvb8/2DQAYo1CdOjIoq0wkSFkio1C7MpFWqGKlRGstSiFTpURrLaLwVypWUDgg7gQAAFAbAJ0BKlwAXAA+jTyZR6UjoqEquA34oBGJQBoREJn2ZebY/kAPc35QHWd+gB0kn7a/uB7XOa7/2Bkuf0dKzjd9GbPg9V+wP+re+Z/sgo1IyyxwAt25+64q1LVxBQOhp7f6De9cTQAlbNd9OlJInTLbqIKtjY8qKNyrxyN0iMQa7+YtbzbxWnERDbTWBIF7ho/B/0ZE0wYzqPHOPd7RPv0eRNzfCY4KL8kR3z0ZmgROYzbmNuHwXm2GZP4EnLdM3CvePHk3YNnRxrNHtsKmd7uQv/y2dh6hi4+6RWP4TDOidgwAAP78XNAARfoxOlAmEYBaREmoms6MqGoR7/9dYhcepN9AOkUgWKCzUf4kfEF7szHpPD+Sz/FZQQ91nFv4p3apl6cO9/KAu9tvFhMmJeHfHXMN50R3oIq1+zgXlwq6u4GN0WHAfIutG1kIzOv/+x8kJihk1lnE7X9O+XXiixIUi6v/A3W3kWqWgV+f9Sz/e9Tz46ozEeX/hIEnl7ChY/ytr5HMTFHpGGyDwCD7meC3QZ8Q+YXdh8euIKqdlm9J964itXdAMvdUkX+TLLbyvm/r90mGkWpUxx6j9Prns1sx57SAk4/d7yU1xXVVei6zO60rUXBkiymjX+S/I89jtnCNhGTOx0mIsta5TJ/KaeUnW52vrQ27xXt3RjmJqWe4gu+KFKotnE8DH/dqakbqeJlG4PrXBv+5jFC1fHWW6dIo9g7YumWrxaO9vL5xF9AHf5pqivqFqhDIw01tXLB5uhqD+h23yBKi7+6TsluiBNhO3idYIdF41AkWdPiMVDNLsUUP86fquMVPtYu6OKm40lFTue8rRIKPZFE5ZnnyvGr/v5PRJtIwIPSeHUrv1VFumkM13oDV4NVlW6XMVop/7iOmQsp+X9TqZ8hJdCmQk5agB3zxg2DJqeChcnxOajtUF3IKEUhoskRTTcFn48orRU3LzUpFlLXk/19OPug8G87/gKF8UEa8MlG87uw5W9GBICJxa3X5ZFuGoYCmPqInFll+O3GJy6345GFmPGxImErxaG5cRbUKK3bAu+PHPDJK1eiCbqx1jbdHIWfVB6n0ARJVrmbpc+6IjMbqMLzM4iMZZl5rXAo5MbnAIPy3piLquiQLWuzdRhA/chwnZmapq4HX2SYSdz0ZJX7tPHQ6P/48wQZjTEIls6OzntfisUEmt9MiN/Ijl5tS8RscFcgNHZiIUCSGQV4wTu5NMmYwiP2lH/v6gJiAbhcl1w3qrduzaZp8OG80v0/UVs3MgKkpmYKAYCp5Nf0G73b11oYHyQVfzLEKvzNOwsNCe/KWFF1iNH1f7GprbJ0zLODhJbetfef/hHSUX7eL/NMbMTlD+P0I27uq0gCUma/WbKgv8YK/k+/HtJX9ER9i3hKF55KMKdwf/WiG1mawMgM9pICwbglTToyq/bXQFSd2CgScVhRxHD0Td6WCaf4vXdWShtqjm+vbPPYMRznFYOLRKQ/S7C4wNc0TorKAHSH8EgQrL5mnO+8cGiSrCaJHS9QAmqBLXWse1NlqyTgGN0RP8RUEB2LyqBrEWE64/FHrzwfBYAgoklAnEFU68Vk5GtAq9Y0x/d9TLSgq9r15PwlObyIU1MihiM89/Mv8yauC8UvOu5hMsWH2XExKkL7w6yLL5E+uhl2/C7BveNQX2H6gW+gA',
  package: 'data:image/webp;base64,UklGRnQIAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSKIDAAABoEVtmyFJ+v4/Imuwtm3btn1l27Zt27Zt27bNsTL0rTcyMxaXETEB+L9XDFRKZQALVFIi6aFa/4a9J4A15VHFbFeQfHotwJZGgW0/oXc16wunh5iCiBHMelekS6SP/HKnCqKl0Aqj7/EjQ+DvoycfXQiopAhWsMADZEj80xQ58sSpYHqmc9LDGIcPYEj8yzHxjY0BqHRKDLDik0yOfzc5xmv2XgJQ6Y4RjH3yMPrIjD6Sg4+fADAdkQpY7Q0yMG+Kkfxgvb7oaRfUYtozSZ+YPwXyunkgpn0G2OBthsBmo+fXB/WHaZlRTHWtY53YuCOfXwyVtEgt+mz5BWNgG4PjK1NBbWusYLabyZDYUs/3Nuyhp62QHvrs+S1DZHsTed2CgGmBAoveS3q2Onh+e9joEG1IFf0OGUAX2PJUk6+uChhtQCpgqWdIn9j+GBgumQFis6nFJEfVDIndjIFf7zAGTCYB1niBMbC7gXxwaUgWwThnDqNL7HJ0/Hkd2AxS4Vg6z46n4bwIVjIYuS6NYuddPB8mC66g617NBuruOV5YsJoX5bq8DJfkuqwMl+a6tAyX5bqkDJfnurhoF5XhilwX0JXgynx191y+c+lKcLVksTiXdcHOKcM1onnOpivYWWW4TjOdWQjzD3RGGa7PdVoZbrSZTi3DTVWmU0ohOSqcXALPm3uZTiqB4y25TizDrX1ywOKEMtzWN9PxZbg913GF6Jfp2IJVOLoEnnf2z3TUvx3Hu0bLdETRDi+B592jiWY5MtbdG8UHcu3HUaFjydPvJxYZVaa+i3SpSyHyg00gkgOC3nYf0YfuOMYLp4EisyhmOicyxG6ExLfWASyyawVZ4XnSp/bFwHjyhDAGTRpB/wN/YPRtc+QLKwJG0LACc14X6VKbouOA48aAETQvFbDBq0yhPYF8cCnAoJ3GYrJjhjOGdsTIAfuMjZ6irVIBCzyU6GJzyTPdNztQoc2qsNt/yuibCoFf7mxhBC1XxXTn1axTI468bjaoooMWWO1JMuSLiR9vorDoprEYd68BZMiTPHnh1DAWXRULzHJzTR8zePKd9QRW0GFRYMPXmPzfSY7Dzp0Aqui4Wkx8wmD6+JdC4rOrAgYFtMAi95Ih/UkKHHHMRKgURTQWo23xNel/lzz59CJAJSikGGDK84fRBQbPHw/sD1UUVAyw5pNkTd67EMSgsFphrP2/41c79YFFgStgtq1mh1gUWS0Aqyi1MYr/fQFWUDggrAQAAHAZAJ0BKlwAXAA+kTaXR6WioiOzldtosBIJZgDCPHdJkWEPltR6jtuF5gP2A9Yj0Z/6rfI/QA6UP92bFD/B2oI4sQAyK/0vnY88z1b7BW6gK/ic0joXQYeANbildfz0vUxvQU+12loT9wJB75wl03ypO24tmQ5uoNkH75cPLwtASdTiDiu8oMvuwLC4doecosiUmcHYvNQPmn604Ipq1ksVhv8XXVqurH+jyur5Ii22v5wLSsh2eFeoajxCiFq6Ilb5TtsQMVuaSceVkI9tX5+Au2hgAP78rRCa/+VGDoMU4QOz11tEPb+r24hAs3NCEYZOx39h1LF8Y6/B/9gky3bc0pHPw/u5HLMEXjRDk0olbfAR9j+3oWmdaow6N5kiEtV18TjN/DeL55+TTLOxz11fziAw84CNf7PPrVXObsiZCTV1qcIDzZc8F89sLDM3jBtvzNBtVQRCZJt+k3FgIn4Q95lUTYTx5juTW3MFFGeUjiiD0Iy0+jOb6RSrNA98Xf/LOebYb/cb3/toDTO1acV8TFr+vstqCkfEIld3X/9eEu+bX2YflL4YSpVt38ZGZjr3NkgYtc0b8VpAf71odjI5WQQImS/skAz2A3AH4JqDgD+ez0LKbXYkdnF3vBtdc6t5rGLHC2S/au7r1E3QK5V4NOL3r0EM2hRt2dJlJL+g/EGpCPTG3Ey4ePrc3FhfdcLRq7ikadaJVhXRYdgrVOTnTdJkK5Di8VCt6MVz5qMjLcLgwT7Iz15PTd12aYV/eWf9UqcV9P+UJ/yFYQqj+Zkxig618Qq2FDK0ueAe33ai70Je3JSLtr9uWGpIGRVwle3+02d/m/6fP8RY75ptBeRmXko1pvbdRpwDV/J2RXcoSTEi0ELPbz2Yfi6CVknyRsrtizguu8Z5qRe7nzmB10T7Nv6GjKR24PZ/5FuMFbeetlg/mb06YQgu5l5IbzI3vEO0CmYvuol0rfdTo9Xc94hvRQjIaebiu3+gVWs7iuX/VU1/yy252lvZc3tQWX/6Z2SzbW+HTGfh9KwXU08P9k9thkLmW26RNkhOTdE+Hej+KUjipKWUfW7DF7oIybfzB1TpMD3NKV4yVr81/dw1ZYlS38rqzuMHIaBoRr/NU9J76GUomc8s6/YyhVnXWVn8Nycldagg/3CBhSwNyAAo+SKbgV8H+ibZJcz/Zkq4pcE190agu4r1lNJ/VLUQvaYU+dpwNC3+xcWKiasMD9ZPqPENBItQUJOuDK07WST45ycgGM4FSWzcoXEjB3q54uw5WM7i8YwyJdJJfQ/bT/6a/Ja2sPzebiIHpwCFBDNo4DqIQApncxwLDgLyPp0+MBXz2MICWizbzSTqjcMpc2mxU/e3m1GUyJlTnpOVEWTPzDQN5Kz9cVF90mGDsRxiQI+UhzMikm64kb97CjFIqwSuxUAWfulYJemYk+DK9qtt59KuyDlowxxIKFDlNFxhgvNzCJ7P07raXT7PJCaM72TbS8Kg9xDHnz39ikr9q8f8D3+Qgt6qu4/ZlR4GOGQgdvvD+6yfQ3yMzA4WZ3ehQ4c+ykLzf/pNgwqrSernzBfm98GX/+AEX/6pyf/xYgAA',
  calendar: 'data:image/webp;base64,UklGRvAGAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSGgCAAAB18OojSRH557ZS/9DcPxRZggRkZOXvQJxD4K4yj2ytmQ4VupsERKNzmhFjRDKI/4k0LZtG1nJmP8/dqceENH/CYBUYNqiTX90ZtuYZ1CybVttJJ37vmRO5glkM4tHkVPJeRYzM/WC2SD//zohhcJ+xbAiYgL4c1QIbYHj+HWpIjvbqkQp16DaYFiPBnWtDfOmWS3WC6jXvVmienZzcGs6HQ+ENsjx1fz8/GR19tXcrCeDN56/uAngzqZLAOc/7rxF6sW4c+PpTVaSBNowB3en0uqzB6gP7j4Yl6YytrkUs7v30ZUMH5IrY9s9MxH5Cmb7S0xEKJa76qbEDk6Ye3vmXWpebxSGezl08zal4fOUCTNXX35s67aKl15YiaPY+a/z1CKY3cwWh+XpDNdl5OHIiVQ+nqxp9fqWFAm6VaPLxGhMKOLWhI71mFDlsyG6TKhCoZTRkI4yglXVBUWDOsXrnTwyWThVJ8JVl/9BqdA8tN/vCs1D+/2u0Dy0v5Q9ntIlYO/iORiRO5VgyOs2Jzd4JG6LZRs0F8HoZIhf5iwXhOo6qWi31aF7KJyM8Ms8NY0UCbqgotU5PEwljlIfCrwlp+9/Ug6k+mGZVrS6rXaW5lG4NQfUuY0mvf9+ylGU+r0mLelq3H6CguDhvSK6W3k0wX37PDN96FzZ0Byti21VKWZzw64G7O8vUr2SJNCGObg7Nc3n+/Tr7B59e3ITcJxNFwLOftp9E+8HNz74+db41nQ6qlAvwntyz4uz8+PF6VcLc/r2pIZJNRrUSWhzHDw3q/l6jqo1/fs6kZ1tVaIUrllCW+G486coVlA4IGIEAAAQGACdASpcAFwAPpFCm0olo6YhqPTaKMASCWQAyqzRklFpSuwQu8fmA/Y71qvRB5wHUAegB5bnsrfuVglDJl/n6X2aR5MEx39YBYGaUa2+EtBX6wMucFTran/Ol0OOXeb5R+W12N5jy9dmeHxchMWFUTXSa9GJm8BEhmUUn8EtI7h0K79DRmZiG8YJU5TdGdjy2FZ84Evuv1ecgbDrjuWLk1SPaCbaVEXQG9M9b1FxrivfE1+73CyC5pHDCgl3HB+6JwNI8BwLMAAA/uURgVkKzI1tp5qrf3lOBpO7+b7nfjKwLm6HH5/L0e2Fnw+lO/7fi5tl183W80IfmFWu9uRBvSrPFkco3QWPg7FjfDCHuQl82x0Nd84i2V2ogt4VBByVo9yuq9PnvJVmiEwRqfMTsqrRNHX99hHa2bGBlCUVQXRmI659iZq+XCkPbvtaJjXHtfj4wK5NfE2cHyrIB9V8Xqe0sJS9zHL+p05IqmJ6GTPjF/v/sQHMKjqYJ2brfiJgfSe+L9iMNSAABZjh9p5lWtqMAwf4tugTK/npg9W/As+Sv8+8Kq7/zfHZQAFmzL5sZYX8g0IKx29fbe3B4kdlTmgWxLXuLj7y1J0wV5P3jey/4TIyLHdR2RQiTkeXf1qT5MzZt9Li0t/WAsBfNySvSMbW9sos7AwDKRXxlVR+8d9PWjFZ99Oj0CtjCb8HFER4faRE1uafBy16UPkNzlFiG0WQEUL12GFS22MXHv3vKkG2OTsb7YdQcj7qCPLG37/+lAF+fv9I/Z2kvwGgR+8xuDtOAFzG8AsuuzW2DzkWHTTQncoYR4VHGk0fHGT7TEOpqyu8QGlOGsBHAnyC6gVUNXsPP6tDn4z69vwFMF09k6eyYxOXeL2qDM+74hLIJ3kGR9zwUBnHwG6B7kN9Mal948fOSW0jgkdWSvuXa6lNh2DkrEhLumXGNyJO5CK3AjJci+kfyUR3vPz2LR2vrw+24/c4puH/aAhcIgJ8H/9r4WaC/vtfV7HidwtV/vbMN6M1YIrnTqdCQqtnpZwfn/xAZOxq7xqPTUfkhO+/Nz4wsAFe+cFKwJ42uajCMbCPSl9tnXZOPHkOQpIM5Jm1jeG+u6RaahgBZjxm0ApEEFyUe71kwacY2bbzyKj2B850rkn1aLK1J8HjHYVtbg57wVcO1VOoRigBLpUCe6B9XsXPYgUDW2gTZXQ8OSIB9O30VOgN8Hr3ELo20GH6h2XWOpOuXs0+gSEBi5pI/jovpt3JHh3JDc2kpJjwr0Wa6qeYHjIQyjrEZ0qeI9ZM8y/z5//iY/1PDo4+9rvaENph7w2Wm5foAodb42ELKSj8xpSadoiKD//nENHnRtOh+9q+4bcZdo5O/2FwhT9HKp9AZZXb8FrH3/lDQqPiK75x1PV+MqqIfO1t5nkRZKoo1pQ6I6iv+ufI+T8OPUnlwqbPD7p5erP/fEMu3AtLoZmTfnJgf/pWhoJeEhISLmilWc9wjtrigAA=',
  sparkles: 'data:image/webp;base64,UklGRooMAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSEgGAAABsEXbtiHZ1lxrR2RVHdv32bq2bdu2bdu2bdu2bRvHqoy9154fmRkZEfn83kdETAD+f6ZqOSKdBUgJ6oBEOkdknr9CClOgfx9AOsVhwWnjfwMtSDH68Htu26FLpDNE04vIE+GKcW70gyR5htMOwbgvLL7bBSlCFCdzRlbv5YbQjlCswMAZC8IV4TDndB/IED/sJ9IZJ9FbPESSIkROoydJ45ZIOgHJa7TABwoRjPohWkPgY06lauISLOAjjT/MilSlHYdNaWyMHD8PXLXEAfL752hkiA+MA+Akn+KuGJow2GFIqwWMWPPayYwkGfnDpSsOAySP4uc/MjbzfKhHtUIifXd7l2Rk00jy1S26VXKksqWPbG5x/PxIKpTiQEYfIltG78lN4XIkuJahBTPujLRSh5Ixj1mM3CKPyqh3aK3q8foekeqIpjt/6MnQLJD1tzdJFK1TrDItxlaBX/wSWp3G/uvf+A2bRn5x+SrdyF3D0czYOgauBFcpB2CO52ik8Z4/AaJ5RPo+kIueJ4pWCpJ0Yb4QafHHv6A7EeR1mPV7hjyBL/Wg6uLcqwyB92tNkN9hY/qYJ9L/GVoxKE6MIcSDkKBNdecxY27jDuKq5rA8A2cu0JZg5HsM+QLvgFRNMPbLyHe7IG04LBYt5ov8diS0YtDkAvJ4OLSpOJmebZptjrRqDgtO+O53Im2IDvic1k7gnUilYlDMMysEbdawAyPbtTh+EdSq1ihos4Yxn9DaouddtTStnHPILc5hxIOMbD8aT1WoSrVyqxMAK7/IUARj4O2zA1AnHaBJAsjI9R/KaCw2Bk65ZplBAFIn1dLUAaOXPuNzksbCA8nXD51/EJCkUh1xgFv06BdJWmCpwcjsgT1nA9RVRYFB29w3gfTeWHrIAvnFdWs6iFZBFMMP/NBI7yMrad6TM17YsgYn5SHd+gsyemOFzZN8YRmolCTacy5pxqpHi/Q7qko5CQ5lZuxIH3pXQVKKk9EfhcAO7eXNPSJFOQUSzP81rVN8fH4UilLAIcEfv7SOyezRQYXh5yMAcck9rHdI7OXBcMUolnzzhbnhHP78CUPshBD44HCnKFKk77vk3f1EBH98lIzeqmWe5EWDoSg0kXUtyzgfFA4927wTyCzEqkSfkTMeX1GgKAg3MAQeAwEU6LvNw5NIn1kVQhbIb25eFRBFsU5GfchofC0FAHGAW/rkN0mGUFIMgeSTB80NOIeiU6w5M0Yymw0KAJo64OdrX/YjSYvFRSP58SnLDAeSBMWnOIkZGbgHkgZAkgRIf77FA72kFRXIideuOgJAmgiKV+n/CD1pvBPaDBB1AmD+a+u0YgLHn/QrAOoUpSYyz/hoDV+MEW3RqE6AjX6yUETguwsB4gQlSw17MCNJy7ZAdy4Argtrz7QCgn3yV9QUJYsq8JtPY2gIfHEMoCp5IN24jNZWDNwJ3ShZUwBDN3qfxqaBL600EEAqOaDypxmM7RhfG+S0JBEMWvyUj0hjy0i+deRC/SGaA4I7YmgnxCORolxFv20eJGnGnGakv3vjGiSHw0Zsi1PngCtH9Rd3ksEb2wxZIK8bCGml+M14Wj7jS4lIOQkO4fQsssCY1bkjaq0Efe9gli/wODiUm2JP9mZWRKgbN0PaCg77tGNcojSVoZfUySzEfNF7cvJJNUiOBIvPNMtj/HIIpCQIdOWrJ5BmeSySX1+4FESQUzHmZfo8ntc4Qeni4Gbd9VHSWkVm9239B8AJ8orTi5nl2wauPEiqQN+FH6U187xz9h7AJYL8KbaKIbayOH22SgCiDhj2WvQNgQ/3gyQqaDfBX76mtfJ8fDCkEo01bMsskrTeddGNIkWTRxha1Xk0XHUcZvsuBtL48RCRQlDD4TnMZq6MBJUV7bmPngy8CQ7FOsw/jbFZ4OvjoNVBiqMajNtLUpAgeZXWzPMiJFKpFafFGNn7B2hBcDiKoUmM9XWQosIqg9+lGZ9RFK6YNYuxwfjuYNEqIcGlNM8D4AqDpA/QNwSehgTVkhVCltVnhxbnsC7rTab/SbRaIslz5FXdIsWpDHmCM2Ps5blQVFwxx6N3/w6KEhMsNoVZxo/GilQNQJ8EglIVa75B/9DsEFTfQRXlisPYBeYZBEEnqqB0BwAOf6/VOcG/aQFWUDggHAYAAPAdAJ0BKlwAXAA+kTqXSCWjIiGseSxYsBIJbAYoAQP1b9URhftfnDVP/CcPigTtt0D+iD9AewBzk/MP5w/oi9AD+m/270u/Ya9AD9mfTm9hz9yvTL6gDhZP5L+IGvo2vy0nN9EzggPDDje9D/No9V+wH+tHpd+yX0E/2KbpgTu87J27Mu/y9wjABIfEGkTY9nSVzWRa5i/4LiXH9+pqqR2JXQU4JGg3UzpIHcPd+lpyTXv65fwRZROuO+WVCQIbwqfkRKU077knaevvgGWB9DUeBAFXZMFrUgMnr0rn+fBrU9iavf6G1BVnwJSo+h+t9aiAuSh3Xz6MAP79tO1H+ONK38TSHZ3o0iVVtd+h6hsCqOyDMF/DWQg7magCDF6j5JgEA97+9kfqPEOvFOFlXPFPcyWX2vQpbEcwh6llta4iVs8W7MVP/NXu/lzsoC9yWaDOYLQvzcCqwBx8y/DiH512+LfMB9Wu9ONR8V+OLDgDNDB6aQWkYfRsX2pwY7G5jHvGY60aLmtuXuvL1TIwO37dHYBItfftMb0En+uWBc53CAyfpbo0gFLoNBacBhWEKFE8THohvxWY9r/GH+GBHDkedmeHWRUmwC+VErRBlaJUR+0LzS5EYlBSpMwLUfJ2fKUfYt75ykoaAwqinMdca/6UE9sSy+e0lsG4J1niPXPQWouZNOLnnQpVPb1wvgvbyW+yZP0YXrzdPBOJvAXPE1s5tJ3eFq62BiJ7ynUDIKLVUMxO5o0f/U7kzDPk96Nu0A5AaqMnSlnhw9jy/XJBaK7nT53AMRoYA0vOl6OxZTk7eD2ivZXDT4HoKia3H7vcJzbcFMKgqVHUlQV8pdTNOsppnujnuqkhFMU/uBbd00aROEGvhf4wZdbjf1XngsH00ge1pDmZpXz/1vQrJk9A0oi3e8DI4TARU3pcaNLlffSuNl6K+p3pCZ9EvM8NkBzpbHSGI5ZCcjgZS29XcYAWEppcwHwvchQb9B2YyZOCsXJTDiweosdvCl9mWzt8YjTbOXyq4ATTybOw7/lffHvq7I93SNiG5AVS8WZXfBM4KStyvKkS557h4A1uYdo6h++eZO9D/SrQvSQ/C12vslN+J3WSTb9Rbvxg9Zg855J+JdvVB9zWjXU1u6HcCRby0zlRiqmXdlqUAf90kr6d0jzOR59dzptaNc7o2n1+ajl/rtak9ZIzWeelBjLt1RucAMcaKmXSJsy8TwhptnFzILA3N9O2zgR9mqN9Jli6O+cO+EwhQupMlg5PLD1PyEhzy/zv4SPxLNdTAyTwB2OMhFh26B/gTdpL6WkYCf61S6MrQkMJ0rBF8VfScoYsPbPaIyoU+6pr7CeTUpy3wUNZI/VrDKa9/rXCwnC7mi9EMcKFoYhXxnZKn36/mbaLyRECDShwGHUjcCxjpT2ABIiC74HOIV0Lh/zf6gpy9Unx1rekH/dwL1yIK87MjksBmWjsatAZP/tsuaPBCtLTNldDoG7cKm/em4wcafm83Ho4mLFzhMxNVzmJLHxXHXPGMsD+vHW9zswBp6d5GB50IgnGwm68+I3of8HlNqT6i8TmvrYVVw21jYUB/0bmb5hfZQ6yOl2f8NrZvwb+xOrUKKZogXWmStCKW3NXvjec5XIuxpnwdgGN3T9DzDNHlk1xsVpV9THAm7jsmv+BNkgkurCobMXnpTlV7grbYLVX6bFwCw6+US87SaPbibzTXiTf4SG20TgbjKbZXStSctWyzzF1tun/NweHmYTdX8EUfJ1hAsXwaJrsFltOO7ff5MQT3G1nkihaqHlJd7kSUdDXzi2E/3wcJ/9QoVejs47qu54I6lEJxC4XtxkTDsPywTDbbNpYdzQ/NRcOLzsbukT2sPPUUEosCvrHk/7b0l/58o3AqkXUKHMre8IheMAI6vGjn06YemlhWUO+Z2xQteiTVPAjwOL6RrZ8cgGnY83KNH2EDUY+3Q1g9UxDxmF25awQ92C4Rr1rwyL/ec/IKuZzNwi5JMjRljbrsR+ypqo6ul5qOalyTMKvcGQEOmCrVcNVK9IvnVz6FK6m+jN3mrsBvriSNm0CyvP//kuFhaT/MzRAAAA=',
});

const ICON_PATHS = Object.freeze({
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  send: '<path d="M4 12 20 4l-4 16-4-7z"/><path d="M12 13 20 4"/>',
  change: '<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  gate: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  q: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17h.01"/>',
});
const icon = name => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

// Every agent is a small character drawn here, with no outside library: a body in a colour and a shape of its own and a
// face that says how it is doing. It dozes until it is called, reads along while it works, looks up wide-eyed when it needs
// you, and beams when it is done.
const BLOB_MOODS = new Set(['happy', 'sleepy', 'surprised', 'sad', 'thinking']);
const BLOB_SHAPES = ['34%', '50%', '46% 54% 52% 48% / 54% 46% 54% 46%', '50% 50% 36% 36% / 56% 56% 40% 40%', '38% 38% 50% 50% / 40% 40% 56% 56%'];
// Each agent's place here sets its colour (47 degrees round the wheel per place) and its shape. A newer agent goes at the end so
// nobody else changes colour; BLOB_HUES gives it a hue of its own in the widest gap left.
const BLOB_ORDER = ['producer', 'researcher', 'strategist', 'copywriter', 'scriptwriter', 'media-buyer', 'videographer', 'editor', 'publisher', 'creative-director', 'trend-scout'];
const BLOB_HUES = Object.freeze({ 'creative-director': 322, 'trend-scout': 56 });
function faceSvg(mood) {
  const eye = (x, rx, ry, py) => `<g class="eye"><ellipse cx="${x}" cy="18" rx="${rx}" ry="${ry}" fill="#fff"/><g class="pu"><circle cx="${x}" cy="${py}" r="2.2" fill="#14161b"/><circle cx="${x + 0.9}" cy="${py - 1}" r=".75" fill="#fff"/></g></g>`;
  const open = (rx, ry, py) => eye(14, rx, ry, py) + eye(26, rx, ry, py);
  const line = d => `<path d="${d}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const lid = d => `${line(d)} stroke="#fff"/>`;
  const mouth = d => `${line(d)} stroke="rgb(0 0 0/.55)"/>`;
  const cheeks = '<circle cx="9.5" cy="24.5" r="2.2" fill="rgb(255 255 255/.28)"/><circle cx="30.5" cy="24.5" r="2.2" fill="rgb(255 255 255/.28)"/>';
  if (mood === 'happy') return lid('M10 19q4-5 8 0') + lid('M22 19q4-5 8 0') + cheeks + mouth('M15 26q5 5 10 0');
  if (mood === 'sleepy') return lid('M10 18q4 3.5 8 0') + lid('M22 18q4 3.5 8 0') + mouth('M17.5 27h5');
  if (mood === 'surprised') return `${open(4.9, 5.8, 17.2)}<ellipse cx="20" cy="29.5" rx="2.1" ry="2.5" fill="rgb(0 0 0/.55)"/>`;
  if (mood === 'sad') return open(4.2, 4.8, 19) + lid('M9.5 10.5l7 2.5') + lid('M30.5 10.5l-7 2.5') + mouth('M16 30q4-3 8 0');
  if (mood === 'thinking') return open(4.3, 5, 18.8) + mouth('M17.5 28h5');
  return open(4.3, 5, 18.4) + mouth('M16 27q4 3 8 0');
}
export function blob(name, mood, size = 34) {
  const known = BLOB_ORDER.indexOf(name);
  const index = known >= 0 ? known : BLOB_ORDER.length + (hueOf(name) % 7);
  const face = BLOB_MOODS.has(mood) ? mood : 'idle';
  return `<span class="av face m-${face}" style="width:${size}px;height:${size}px;--h:${BLOB_HUES[name] ?? (205 + index * 47) % 360};--d:-${((index * 0.83) % 4).toFixed(2)}s;border-radius:${BLOB_SHAPES[index % BLOB_SHAPES.length]}" aria-hidden="true"><svg viewBox="0 0 40 40">${faceSvg(face)}</svg></span>`;
}

// What an agent's row and chat say about it. Only the Director asks the person, so only its card reads "Waiting on you";
// an agent whose work waits on a decision reads "Waiting" with the note "Handed to the Director for your decision". An agent
// nobody has used yet is "not called yet".
const AGENT_VIEWS = Object.freeze({
  needs_you: { word: "Waiting on you", tone: 'ask', mood: 'surprised' },
  working: { word: 'Working', tone: 'working', mood: 'thinking' },
  waiting: { word: 'Waiting', tone: 'draft', mood: 'idle' },
  up_next: { word: 'Up next', tone: 'idle', mood: 'sleepy' },
  done: { word: 'Done', tone: 'done', mood: 'happy' },
});
export function agentView(agent) {
  let state = agentStateOf(agent?.state);
  const note = trimmed(agent?.note);
  const lists = [agent?.files, agent?.messages, agent?.runs];
  const used = state === 'working' || state === 'done' || state === 'needs_you' || lists.some(list => Array.isArray(list) && list.length > 0) || (state === 'waiting' && note !== '' && !/^starts after/i.test(note));
  // No session is watching the board (see agentBoxOf), so a card that reads working says it waits for the studio to open.
  if (used && state === 'working' && agent?.engineClosed === true) return { state, called: true, asleep: true, ...AGENT_VIEWS.waiting, word: ENGINE_CLOSED_WORD };
  if (used) return { state, called: true, ...AGENT_VIEWS[state] };
  return { state, called: false, word: state === 'up_next' ? 'Up next' : 'Waiting its turn', tone: 'idle', mood: 'sleepy' };
}

// @module flow
// Replies the person has opened. A per-viewer convenience kept in the browser, so every read and write of it is guarded.
const SEEN_REPLIES_KEY = 'socialCampaign.seenReplies';
const seenReplies = new Set();
let seenRepliesLoaded = false;
function loadSeenReplies() {
  if (seenRepliesLoaded) return;
  seenRepliesLoaded = true;
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(SEEN_REPLIES_KEY) || '[]');
    if (Array.isArray(list)) for (const id of list.slice(-500)) if (typeof id === 'string') seenReplies.add(id);
  } catch { /* No storage: a reply shows as new until the page is closed. */ }
}
const repliesOf = agent => (Array.isArray(agent?.messages) ? agent.messages : []).filter(message => message && message.id && message.status === 'answered' && trimmed(message.reply));
export const unreadReplies = agent => (loadSeenReplies(), repliesOf(agent).filter(message => !seenReplies.has(message.id)).length);
export function markRepliesSeen(agent) {
  loadSeenReplies();
  const fresh = repliesOf(agent).filter(message => !seenReplies.has(message.id));
  if (!fresh.length) return;
  for (const message of fresh) seenReplies.add(message.id);
  try { globalThis.localStorage?.setItem(SEEN_REPLIES_KEY, JSON.stringify([...seenReplies].slice(-500))); } catch { /* Kept for this visit only. */ }
}

function agentRow({ agent, view }, { needText = '', questions = 0, active = false }) {
  const name = agentNameOf(agent);
  const note = agentPlain(agent.note);
  const line = isDirectorAgent(agent) && view.state === 'needs_you' && needText ? needText : view.state === 'waiting' && note ? note : agentPlain(agent.task);
  const unread = unreadReplies(agent);
  const badge = questions ? `<span class="ag-count" title="Questions waiting on you">${questions}</span>` : unread ? '<i class="ag-dot" role="img" aria-label="New reply" title="A reply you have not read"></i>' : '';
  return `<button type="button" class="ag st-${view.tone}${active ? ' sel' : ''}" data-ab-open="${esc(agent.id)}"${line && capWords(line, 12) !== line ? ` title="${esc(line)}"` : ''}><span class="ag-f">${blob(agent.id, view.mood, 36)}<i class="ag-d" aria-hidden="true"></i></span><span class="ag-b"><span class="ag-n"><b>${esc(name)}</b></span><span class="ag-l"><span class="ag-w">${esc(view.word)}</span>${line ? ` · ${esc(capWords(line, 12))}` : ''}</span></span><span class="ag-t">${badge}</span></button>`;
}

/** The Team: the Director first, then the people on this job, then the ones not called yet. Each row is a face, a name, a state word and one line. */
export function agentInbox(agents, { needText = '', questions = 0, waitingOnYou = 0 } = {}) {
  const rows = (Array.isArray(agents) ? agents : []).map(agent => ({ agent, view: agentView(agent) }));
  const rank = { working: 0, needs_you: 1, waiting: 2, done: 3 };
  const director = rows.filter(row => isDirectorAgent(row.agent));
  const called = rows.filter(row => !isDirectorAgent(row.agent) && row.view.called)
    .sort((a, b) => (rank[a.view.state] ?? 4) - (rank[b.view.state] ?? 4) || (Date.parse(b.agent.since) || 0) - (Date.parse(a.agent.since) || 0));
  const quiet = rows.filter(row => !isDirectorAgent(row.agent) && !row.view.called);
  const summary = waitingOnYou ? `${waitingOnYou} ${waitingOnYou === 1 ? 'thing needs' : 'things need'} you` : 'Nothing needs you';
  const options = row => ({ needText, questions: isDirectorAgent(row.agent) ? questions : 0 });
  return `<section class="ag-inbox" aria-labelledby="ag-inbox-title"><div class="in-h"><h2 id="ag-inbox-title">Team</h2><span class="meta">${esc(summary)}</span></div><div class="in-l" data-scroll="inbox">${director.map(row => agentRow(row, options(row))).join('')}${called.length ? `<div class="in-sep">On this job</div>${called.map(row => agentRow(row, options(row))).join('')}` : ''}${quiet.length ? `<div class="in-sep">Not called yet</div>${quiet.map(row => agentRow(row, options(row))).join('')}` : ''}</div></section>`;
}

/** The offer to send a finished video to Post-production, as a card with its buttons. Nothing else is drawn here: a decision is its own card, a question has its own, and the Team row says what is waiting. */
export function inboxNeed(parts, jobId, item = null, handoff = {}) {
  if (!parts || !isHandoffItem(item)) return '';
  return `<section class="panel need-card" aria-label="${esc(parts.need)}"><p>${esc(parts.need)}</p>${handoffButtons({ ...item, jobId: item.jobId || jobId }, handoff)}</section>`;
}

function refMatches(ref, path) {
  const want = String(path ?? '').replace(/^\.?\//, '');
  const out = String(ref ?? '').replace(/^\.?\//, '').trim();
  if (!out || !want) return false;
  if (out === want) return true;
  if (!out.includes('*')) return out.endsWith('/') && want.startsWith(out);
  const body = out.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${out.endsWith('/') ? '' : '$'}`).test(want);
}

const tookWords = ms => (Number.isFinite(ms) && ms > 0 ? (ms < 90000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60000)} min`) : '');

// ---- Step history: what opens under a step card, a gate section or a task in an agent's chat ----
// A step is a window of time (when it began, when it finished). Its trace is who did it, what it made, and what that agent ran,
// said and was told inside the window. A step with no recorded time shows who and what only, never another step's activity.
const traceMs = value => { const at = Date.parse(value ?? ''); return Number.isFinite(at) ? at : null; };
const TRACE_RUN_WORDS = Object.freeze({ finished: 'Finished', failed: "Could not finish", stopped: 'Finished', running: 'Working now', lost: 'Stopped responding' });
// The activity rows that only repeat a message the Messages list already shows.
const TRACE_MESSAGE_ROWS = /^(You sent a message|Your message was passed on|Your message was answered|The Director answered your message)$/;
const traceWhen = value => (traceMs(value) === null ? '' : time(value));
function stepWindow(item) {
  const from = traceMs(item.startedAt);
  const to = item.status === 'done' ? traceMs(item.doneAt) : null;
  return { from, to, known: from !== null || to !== null || item.status !== 'done' };
}
function gateWindow(item) {
  const approved = (Array.isArray(item.history) ? item.history : []).filter(entry => entry?.decision === 'approved').at(-1);
  const from = traceMs(item.openedAt);
  const to = item.status === 'done' ? traceMs(approved?.at || item.approval?.at) : null;
  return { from, to, known: from !== null || to !== null || item.status !== 'done' };
}
const atOf = (value, win) => { const at = traceMs(value); return at !== null && (win.from === null || at >= win.from) && (win.to === null || at <= win.to); };
function runOverlaps(run, win) {
  const began = traceMs(run?.at);
  if (began === null) return false;
  const ended = traceMs(run.end) ?? (run.state === 'running' ? Infinity : began);
  return (win.to === null || began <= win.to) && (win.from === null || ended >= win.from);
}
function traceSection(title, inner) { return inner ? `<section class="trace-sec"><h4>${esc(title)}</h4>${inner}</section>` : ''; }
// A card's meta is one line, who and when ("Scriptwriter, 3:31 pm"), never a model name. Nothing is drawn when neither is known.
function traceMeta(id, person, at) {
  const when = agentTime(at).replace(/\s*([AP])M$/i, (_, half) => ` ${half.toLowerCase()}m`);
  const text = [trimmed(person?.name), when].filter(Boolean).join(', ');
  return text ? `<p class="trace-meta muted"><span class="trace-who">${person ? blob(id, person.mood, 20) : ''}<span>${esc(text)}</span></span></p>` : '';
}

// What the agents ran inside the window: one line each, with when, how long and how it ended.
function traceRuns(agents, win) {
  const named = agents.length > 1;
  const lines = agents.flatMap(agent => (Array.isArray(agent?.sessions) ? agent.sessions : []).filter(run => runOverlaps(run, win)).map(run => {
    const began = agentTime(run.at);
    const ended = run.end ? agentTime(run.end) : '';
    const took = tookWords(run.tookMs) || (traceMs(run.end) !== null && traceMs(run.at) !== null ? tookWords(traceMs(run.end) - traceMs(run.at)) : '');
    const when = [began && ended && ended !== began ? `${began} to ${ended}` : began, took, TRACE_RUN_WORDS[run.state] || ''].filter(Boolean).join(' · ');
    return { at: traceMs(run.at) || 0, html: `<li><b>${esc(`${named ? `${agentNameOf(agent)}: ` : ''}${agentPlain(run.task, 'Worked on this job')}`)}</b><span class="num">${esc(when)}</span>${agentPlain(run.summary) ? `<span>${esc(agentPlain(run.summary))}</span>` : ''}</li>` };
  }));
  return lines.length ? `<ol class="trace-list">${lines.sort((a, b) => a.at - b.at).map(line => line.html).join('')}</ol>` : '';
}

// The messages the person sent inside the window, each with the answer.
function traceMessages(agents, win) {
  const rows = agents.flatMap(agent => (Array.isArray(agent?.messages) ? agent.messages : []).filter(message => message && trimmed(message.text) && atOf(message.at, win)).map(message => ({ agent, message })))
    .sort((a, b) => (traceMs(a.message.at) || 0) - (traceMs(b.message.at) || 0));
  if (!rows.length) return '';
  return `<ol class="trace-list trace-msgs">${rows.map(({ agent, message }) => {
    const reply = message.status === 'answered' ? agentPlain(message.reply) : '';
    return `<li><b>You${agents.length > 1 ? ` to the ${esc(agentNameOf(agent))}` : ''}</b><span class="num">${esc(agentTime(message.at))}</span><span>${esc(truncateText(message.text, 240))}</span>${reply ? `<span class="trace-reply"><b>${esc(agentNameOf(agent))}:</b> ${esc(truncateText(reply, 240))}</span>` : ''}</li>`;
  }).join('')}</ol>`;
}

// What the Director did and what the person decided inside the window: the same rows as the chat's Details fold.
function traceMoves(agents, win) {
  const rows = agents.filter(isDirectorAgent).flatMap(agent => (Array.isArray(agent.activity) ? agent.activity : [])
    .map(row => ({ at: row?.at, text: agentPlain(row?.text) })).filter(row => row.text && !TRACE_MESSAGE_ROWS.test(row.text) && atOf(row.at, win)))
    .sort((a, b) => (traceMs(a.at) || 0) - (traceMs(b.at) || 0));
  return rows.length ? `<ol class="trace-list">${rows.map(row => `<li><span class="num">${esc(agentTime(row.at))}</span><span>${esc(row.text)}</span></li>`).join('')}</ol>` : '';
}

function traceFiles(files, ctx, label) {
  return agentChips(files, 0, { artifacts: ctx.chipContext?.artifacts || [], doc: ctx.chipContext?.doc || null, label, by: '' });
}

// A done step that made a storyboard keeps it readable: the boards of the job document whose file the step lists (or made).
function stepStoryboards(item, files, doc) {
  const made = path => (item.outputs || []).some(ref => refMatches(ref, path)) || files.some(file => file.path === path);
  return (Array.isArray(doc?.storyboards) ? doc.storyboards : []).filter(board => board && trimmed(board.path) && (board.panels || []).length && made(board.path));
}

// True when the storyboard gate is done and a done step already shows the storyboard (its readout), so the gate row need not repeat it.
export function storyboardKeptByStep(stages, who, doc) {
  const items = (stages || []).flatMap(stage => stage.items || []);
  if (!items.some(item => item.kind === 'gate' && item.gate === 'storyboard' && item.status === 'done')) return false;
  return items.some(item => {
    if (item.kind !== 'step' || item.status === 'pending') return false;
    const agent = who(item.agent)?.agent || null;
    const files = (Array.isArray(agent?.files) ? agent.files : []).filter(file => file && trimmed(file.path) && (item.outputs || []).some(ref => refMatches(ref, file.path)));
    return stepStoryboards(item, files, doc).length > 0;
  });
}

// Every panel of a storyboard with its words and picture, the same fields and frames as the storyboard review, read-only.
export function storyboardReadout(board) {
  const slots = (board?.panels || []).map((panel, index) => {
    const frame = panelFrameHtml(panel, index, { large: true });
    const picture = frame.startsWith('<img') ? `<div class="sb-slot-frame">${frame}</div>` : `<div class="sb-slot-frame is-empty${panel?.frame?.thumbOmitted ? ' is-omitted' : ''}">${frame}</div>`;
    const meta = [Number(panel?.durationSeconds) > 0 ? secondsWord(panel.durationSeconds) : '', PANEL_SOURCE_WORDS[panel?.source] || 'New'].filter(Boolean).join(' · ');
    return `<div class="sb-slot" style="--sb-ratio:${frameRatio(board?.aspectRatio)}">${picture}<div class="sb-slot-body"><div class="sb-slot-head"><strong>${esc(panelLabelOf(panel, index))}</strong>${refTag(panelRefOf(panel, index))}<span class="sb-source">${esc(meta)}</span></div>${panelFields(panel, board)}</div></div>`;
  });
  return slots.join('');
}

const QUESTION_STATE_WORDS = Object.freeze({ open: 'Still open', withdrawn: 'Withdrawn' });
// The first step keeps what the person asked for and the questions the Director put to them, each with its answer and when it came.
function requestTrace(item) {
  const request = item.request && trimmed(item.request.text) ? `<ol class="trace-list"><li><b>Your request</b><span class="num">${esc(traceWhen(item.request.at))}</span><span class="trace-quote">${esc(item.request.text)}</span></li></ol>` : '';
  const questions = (Array.isArray(item.questions) ? item.questions : []).filter(entry => trimmed(entry?.text)).map(entry => {
    const answered = entry.status === 'answered';
    const when = answered ? `Answered ${traceWhen(entry.answeredAt)}`.trim() : QUESTION_STATE_WORDS[entry.status] || 'Still open';
    return `<li><b>${esc(entry.text)}</b><span class="num">${esc(when)}</span>${answered && trimmed(entry.answer) ? `<span class="trace-quote">${esc(entry.answer)}</span>` : ''}</li>`;
  }).join('');
  return traceSection('What you asked', request) + traceSection('Questions and answers', questions ? `<ol class="trace-list">${questions}</ol>` : '');
}

/**
 * What opens under a step card or a task in an agent's chat. item: { name, line, agent, status, outputs, startedAt, doneAt }.
 * ctx: `agent` and `person` (the agent card and how it looks), `chipContext`, `agents` (everyone on the job, for the Director's moves),
 * `withWho` (false in that agent's own chat).
 */
export function stepTrace(item, ctx = {}) {
  const { agent = null, person = null, withWho = true, withFiles = true, compact = false } = ctx;
  const win = stepWindow(item);
  const status = item.status;
  const files = (Array.isArray(agent?.files) ? agent.files : []).filter(file => file && trimmed(file.path) && (item.outputs || []).some(ref => refMatches(ref, file.path)));
  const priceList = withFiles && item.quote && status === 'done' ? `<p><b>Price list</b></p>${priceTable(item.quote, { withProvider: true })}` : '';
  const made = !withFiles ? '' : priceList + (traceFiles(files, ctx, `Files from ${item.name}`) || (status === 'done' && !priceList && !item.request && !compact ? '<p class="muted">No files listed for this step.</p>' : ''));
  const boards = withFiles ? stepStoryboards(item, files, ctx.chipContext?.doc) : [];
  const shotPlan = boards.length ? traceSection('Storyboard', boards.map(board => storyboardStrip(board) + storyboardReadout(board)).join('')) : '';
  const meta = compact ? '' : traceMeta(item.agent || agent?.id, withWho ? person : null, status === 'done' ? item.doneAt || item.startedAt : item.startedAt);
  const session = win.known && !compact ? [traceRuns(agent ? [agent] : [], win), traceMessages(agent ? [agent] : [], win), traceMoves(agent ? [agent] : [], win)].join('') : '';
  const asked = withFiles ? requestTrace(item) : '';
  const none = !meta && !made && !session && !asked && !shotPlan;
  return `${meta}${asked}${traceSection(TXT_WHAT_IT_MADE, made)}${shotPlan}${traceSection('Session', session)}${none && !compact ? '<p class="muted">No history yet.</p>' : ''}`;
}

const APPROVAL_WORDS = Object.freeze({ approved: 'Approved', changes: 'Asked for changes' });
// What the person decided at a gate, one row each: every round of the history, or the single approval when there is no history.
function gateDecisionRows(item) {
  const history = Array.isArray(item.history) ? item.history : [];
  const price = item.gate === 'price' && item.approval?.totals ? priceWords(item.approval.totals) : '';
  return history.length
    ? history.map(entry => `<li><b>${esc(APPROVAL_WORDS[entry.decision] || 'Decided')}${entry.round > 1 ? ` (round ${entry.round})` : ''}</b><span class="num">${esc(traceWhen(entry.at))}</span>${entry.comment ? `<span class="trace-quote">${esc(truncateText(entry.comment, 200))}</span>` : ''}</li>`).join('')
    : item.status === 'done' && traceMs(item.approval?.at) !== null ? `<li><b>Approved</b><span class="num">${esc(`${traceWhen(item.approval.at)}${price ? ` · ${price}` : ''}`)}</span></li>` : '';
}
// The words for a decided gate: "Approved <when>", with the credits for the price. Empty when the approval has no time.
export function gateReceipt(item) {
  if (item?.status !== 'done' || !item.approval?.at || !Number.isFinite(Date.parse(item.approval.at))) return '';
  const price = item.gate === 'price' && item.approval?.totals ? priceWords(item.approval.totals) : '';
  return `Approved ${time(item.approval.at)}${price ? ` · ${price}` : ''}`;
}
/** What opens under a gate section: who prepared it, when it opened, what the person decided (with any change requests), and the session in between. */
export function gateTrace(item, ctx = {}) {
  const { agent = null, person = null, director = null, compact = false } = ctx;
  const win = gateWindow(item);
  const history = Array.isArray(item.history) ? item.history : [];
  const decisions = gateDecisionRows(item);
  const reviewed = [...new Set(history.flatMap(entry => (Array.isArray(entry.files) ? entry.files : [])))].map(path => ({ path }));
  const agents = [agent, director].filter((one, at, list) => one && list.indexOf(one) === at);
  const meta = compact ? '' : traceMeta(item.agent || agent?.id, person, item.openedAt);
  const session = win.known && !compact ? [traceRuns(agent ? [agent] : [], win), traceMessages(agents, win)].join('') : '';
  const decided = decisions ? `<ol class="trace-list">${decisions}</ol>` : '';
  return `${meta}${traceSection('Your decision', decided)}${traceSection('What you saw', (item.quote && item.status === 'done' ? priceTable(item.quote, { withProvider: true }) : '') + traceFiles(reviewed, ctx, `Files you reviewed for ${item.name}`))}${traceSection('Session', session)}`;
}

// One bubble for each finished step of this agent: the step's name, the files it made as links, and a small footer.
function workBubbles(agent, tasks, chipContext) {
  const done = tasks.filter(task => task.status === 'done');
  const files = Array.isArray(agent.files) ? agent.files.filter(file => file && trimmed(file.path)) : [];
  if (!done.length && !files.length) return '';
  const groups = (done.length ? done : [{ name: TXT_WHAT_IT_MADE, outputs: [] }]).map(task => ({ task, files: [] }));
  const taken = new Set();
  for (const group of groups) {
    for (const file of files) {
      if (taken.has(file.path) || !group.task.outputs.some(ref => refMatches(ref, file.path))) continue;
      taken.add(file.path);
      group.files.push(file);
    }
  }
  groups.at(-1).files.push(...files.filter(file => !taken.has(file.path)));
  const runs = Array.isArray(agent.runs) ? agent.runs : [];
  return groups.map((group, index) => {
    const run = runs[runs.length - (groups.length - index)] || null;
    const last = index === groups.length - 1;
    const chips = agentChips(group.files, last ? Number(agent.filesMore) || 0 : 0, { ...chipContext, label: `${group.task.name}, files from the ${agentNameOf(agent)}`, by: `by the ${agentNameOf(agent)}` });
    const foot = [run?.at ? agentTime(run.at) : '', tookWords(run?.tookMs)].filter(Boolean).join(' · ');
    return `<div class="msg-r a"><div class="bub"><div class="bub-h"><b>${esc(group.task.name)}</b></div>${chips || '<p class="bub-note">Finished.</p>'}${foot ? `<div class="bub-f"><span class="num">${esc(foot)}</span></div>` : ''}</div></div>`;
  }).join('');
}

// What the person said to this agent, each message right-aligned with the agent's reply under it.
function messageBubbles(agent) {
  const list = (Array.isArray(agent.messages) ? agent.messages : []).filter(message => message && trimmed(message.text));
  const name = agentNameOf(agent);
  const earlier = Number(agent.messagesMore) > 0 ? `<div class="sys"><span>${esc(`${agent.messagesMore} earlier ${agent.messagesMore === 1 ? 'message is' : 'messages are'} not shown`)}</span></div>` : '';
  return earlier + list.map(message => {
    const status = agentMessageStatus(agent, message);
    const reply = message.status === 'answered' ? agentPlain(message.reply) : '';
    const sent = [status.word, status.note, agentTime(message.at)].filter(Boolean).join(' · ');
    return `<div class="msg-r me" data-status="${esc(messageMark(status.progress))}"><div class="bub"><p>${esc(truncateText(message.text, 600))}</p>${message.attachment?.name ? `<span class="ab-chip att">${esc(truncateText(message.attachment.name, 40))}<small>${esc(message.attachment.label || 'Reference')}</small></span>` : ''}</div><span class="msg-t">${esc(sent)}</span></div>${reply ? `<div class="msg-r a"><div class="bub"><p>${esc(reply)}</p></div><span class="msg-t">${esc(`${name}${message.repliedAt ? ` · ${agentTime(message.repliedAt)}` : ''}`)}</span></div>` : ''}`;
  }).join('');
}

// ---- The room: the job as one ordered feed (document.room, plan 0.19 B2.1) ----
// The Director's thread shows it: what the person wrote to the Director and the Director's replies, one line for each result an employee made
// (its files as chips), the handoff lines, and the cards that are closed, each as one line. A person's thread is the same feed filtered to that
// person. An open card is the page's live card, drawn after the feed, so only closed cards are rows. A job document from before the room has none.
export const ROOM_OLDER_LINE = 'Older messages are on your computer';
/** The job document's room as { rows, older }, or null when the document has none (then the old bubbles are drawn). */
export function roomOf(doc) {
  const rows = doc?.room?.rows;
  if (!Array.isArray(rows)) return null;
  const older = Number(doc.room.older);
  return { rows: rows.filter(row => row && typeof row === 'object' && trimmed(row.k)), older: Number.isSafeInteger(older) && older > 0 ? older : 0 };
}
/**
 * The rows one thread shows. The Director's: its own talk, every result, the handoff lines and the closed cards, and each message to a person
 * as one line (roomRow draws it small); their replies stay in their thread. A person's: what was said to and by them, their results, the lines naming them and the closed cards about their files.
 */
export function roomRowsFor(room, agentId, agent = null) {
  const director = agentId === 'producer';
  return (room?.rows || []).filter(row => {
    if (row.k === 'you') return director || row.to === agentId;
    if (row.k === 'dir') return director;
    if (row.k === 'msg') return director ? !row.reply : row.who === agentId;
    if (row.k === 'hand') return director || (Array.isArray(row.with) && row.with.includes(agentId));
    // A closed card shows in the Director's thread, and in the thread of the person whose file it was about (the way an open card does).
    return row.k === 'card' && (director || (typeof row.about?.path === 'string' && threadPaths(agent).has(row.about.path)));
  });
}
// The files a person made and the things the person was asked about: the cards about them belong in that person's thread.
function threadPaths(agent) {
  return new Set([...(Array.isArray(agent?.files) ? agent.files.map(file => file?.path) : []), ...(Array.isArray(agent?.messages) ? agent.messages.map(message => message?.about?.path) : [])].filter(path => typeof path === 'string' && path));
}
/**
 * The open question cards that belong in one person's thread: the ones the Director raised about a file that person made, or about the
 * thing a message to them named. The Director's thread holds every card; this is the person's share of them, shown there as well.
 */
export function cardsForThread(items, agent) {
  const paths = threadPaths(agent);
  return (Array.isArray(items) ? items : []).filter(item => item?.kind === 'question' && typeof item.about?.path === 'string' && paths.has(item.about.path));
}
function roomRow(row, { agentOf, chipContext, named, viewer = '' }) {
  const time = agentTime(row.at);
  // In the Director's thread, a message to an employee is one line: who it was for, the start of it, and how far it got. The talk itself stays in that person's thread.
  if (viewer === 'producer' && row.k === 'you' && row.to !== 'producer') {
    const said = trimmed(row.text).replace(/\s+/g, ' ');
    const to = agentOf(row.to);
    const progress = agentMessageStatus(to, row).word;
    return said ? `<div class="room-hand" data-kind="talk"><span>${esc(`You to the ${agentNameOf(to)}: ${truncateText(said, 80)} · ${progress}`)}</span></div>` : '';
  }
  if (row.k === 'hand') {
    const line = agentPlain(row.text);
    return line ? `<div class="room-hand" data-kind="${esc(row.kind || 'handed')}"><span>${esc(line)}</span></div>` : '';
  }
  if (row.k === 'card') {
    const title = trimmed(row.title);
    const answer = trimmed(row.answer);
    const note = [trimmed(row.note), time].filter(Boolean).join(' · ');
    return title ? `<div class="msg-r a bub-wide room-card"><div class="bub"><div class="q-closed" role="status"><span class="q-tick">${CHECK_ICON}</span><span class="q-closed-title">${esc(title)}</span>${answer ? `<b class="q-closed-answer">${esc(truncateText(answer, 120))}</b>` : ''}</div></div>${note ? `<span class="msg-t">${esc(note)}</span>` : ''}</div>` : '';
  }
  if (row.k === 'you') {
    if (!trimmed(row.text)) return '';
    const status = row.brief ? null : agentMessageStatus(agentOf(row.to), row);
    const sent = (status ? [status.word, status.note, time] : ['Your request', time]).filter(Boolean).join(' · ');
    const mark = status ? messageMark(status.progress) : 'sent';
    const about = trimmed(row.about?.label) ? `<span class="ab-chip att">${esc(truncateText(row.about.label, 40))}<small>About</small></span>` : '';
    const file = row.attachment?.name ? `<span class="ab-chip att">${esc(truncateText(row.attachment.name, 40))}<small>${esc(row.attachment.label || 'Reference')}</small></span>` : '';
    return `<div class="msg-r me" data-status="${mark}"><div class="bub"><p>${esc(truncateText(row.text, 600))}</p>${about}${file}</div><span class="msg-t">${esc(sent)}</span></div>`;
  }
  const who = agentOf(row.k === 'dir' ? 'producer' : row.who);
  const name = agentNameOf(who);
  const line = agentPlain(row.text);
  if (!line) return '';
  const chips = row.k === 'msg' ? agentChips(row.files, row.filesMore, { ...chipContext, label: `Files from the ${name}`, by: `by the ${name}` }) : '';
  const head = row.k === 'msg' && named ? `<div class="bub-h"><b>${esc(name)}</b></div>` : '';
  return `<div class="msg-r a"><div class="bub">${head}<p>${esc(truncateText(line, 600))}</p>${chips}</div><span class="msg-t">${esc(row.k === 'dir' ? [name, time].filter(Boolean).join(' · ') : time)}</span></div>`;
}
/**
 * The feed one thread shows, as HTML, or null when the job has no room (the caller draws the older bubbles). `agents` are the job's agent cards
 * (to name a row's agent and word a message's progress), `liveKeys` the keys of the cards still open on the page, so a card is never drawn twice.
 */
export function roomFeed(room, agentId, { agents = [], chipContext = {}, liveKeys = new Set() } = {}) {
  if (!room) return null;
  const agentOf = id => agents.find(item => item?.id === id) || { id, name: humanize(id) };
  const rows = roomRowsFor(room, agentId, agents.find(item => item?.id === agentId)).filter(row => !(row.k === 'card' && row.key && liveKeys.has(row.key)));
  const older = room.older > 0 ? `<div class="sys"><span>${esc(ROOM_OLDER_LINE)}</span></div>` : '';
  return older + rows.map(row => roomRow(row, { agentOf, chipContext: { artifacts: [], ...chipContext }, named: agentId === 'producer', viewer: agentId })).join('');
}

const GATE_PICTURES = Object.freeze({ concept: 'sparkles', storyboard: 'picture', price: 'money', sample: 'picture', pictures: 'picture', clips: 'clapper', cut: 'clapper', finishing: 'sparkles', content: 'eyes', publish: 'calendar', findings: 'memo', campaign_proposal: 'memo', campaign_activation: 'package' });
const gatePicture = gate => STEP_IMG[GATE_PICTURES[gate]] || STEP_IMG.package;

export function agentComposer(agent, { about = 'the job', ui = {}, signal = {} } = {}) {
  const name = agentNameOf(agent);
  const attach = chatAttachment(ui.attach || {}, name);
  const draft = ui.draft || '';
  const hint = agent.engineClosed === true ? `${ENGINE_CLOSED_WORD}.` : isDirectorAgent(agent) ? 'The Director answers here.' : 'Also shows in the Director thread as one line.';
  const send = ui.send || {};
  // A message that started from a frame's or a file's "Ask for changes" carries what it is about, shown as a chip the person can take off.
  const subject = agentAboutOf(ui.about);
  const aboutChip = subject ? `<div class="cmp-about"><span class="ab-chip att">${esc(truncateText(subject.label, 40))}<small>About</small></span><button type="button" class="quiet sm" data-ab-about-clear aria-label="${esc(`Take off: about ${subject.label}`)}">Remove</button></div>` : '';
  return `<form class="composer ab-compose" data-ab-form novalidate aria-label="${esc(`Message ${name}`)}"><input type="hidden" name="to" value="${esc(agent.id)}">${aboutChip}<div class="cmp-row">${attach.button}<label class="visually-hidden" for="ab-text">${esc(`Your message to ${name}`)}</label><textarea id="ab-text" name="text" rows="1" maxlength="${AGENT_MESSAGE_LIMIT}" placeholder="${esc(`Message ${name} about ${about}`)}"${ui.error ? ' aria-invalid="true"' : ''} aria-describedby="ab-hint ab-count${ui.error ? ' ab-error' : ''}">${esc(draft)}</textarea><button type="submit" class="send icon" aria-label="Send message" title="Send message" ${send.busy ? 'disabled' : ''}>${icon('send')}</button></div>${attach.panel}<div class="cmp-meta"><p class="ab-hint" id="ab-hint">${esc(hint)}</p><p class="field-count" id="ab-count">${draft.length} / ${AGENT_MESSAGE_LIMIT}</p></div>${ui.error ? `<p class="notice error inline-error" id="ab-error" role="alert">${esc(ui.error)}</p>` : ''}${inboxStatus(send, signal)}${inboxError(send)}</form>`;
}

// The agent's own tasks on this job, in plan order, at the top of its chat. A task that began (done, working or waiting) opens to its
// history, the same trace the stage card shows; one not started yet is disabled. An agent with no plan rows (the Researcher on
// brand onboarding) lists its runs instead, each openable.
const TASK_PILLS = Object.freeze({ finished: ['done', 'Done'], failed: ['pending', "Could not finish"], stopped: ['done', 'Done'], running: ['running', 'Working'], lost: ['pending', 'Stopped responding'] });
function chatTasks(agent, tasks, { chipContext = {}, openKeys = null, jobId = '' } = {}) {
  const view = agentView(agent);
  const person = { name: agentNameOf(agent), mood: view.mood };
  const sessions = (Array.isArray(agent.sessions) ? agent.sessions : []).filter(run => run && typeof run === 'object');
  const rows = tasks.length
    ? tasks.map(task => ({ name: task.name, status: task.status, pill: [STEP_STATUSES.has(task.status) ? task.status : 'pending', STEP_STATUS_WORDS[task.status] || STEP_STATUS_WORDS.pending], line: task.line, item: { ...task, agent: agent.id }, files: true }))
    : sessions.map(run => {
      const [tone, word] = TASK_PILLS[run.state] || TASK_PILLS.finished;
      const name = agentPlain(run.task, 'A run on this job');
      return { name, status: run.state === 'running' ? 'running' : 'done', pill: [tone, word], line: '', item: { name, status: run.state === 'running' ? 'running' : 'done', agent: agent.id, startedAt: run.at, doneAt: run.end, outputs: [] }, files: false };
    });
  if (!rows.length) return '';
  const items = rows.map((row, index) => {
    // A step or run that reads running cannot be working while no session watches the board.
    const head = `<b>${esc(row.name)}</b><span class="pill st-${row.pill[0]}">${esc(agent.engineClosed === true && row.status === 'running' ? ENGINE_CLOSED_WORD : row.pill[1])}</span>`;
    if (row.status === 'pending') return `<li class="task is-locked" aria-disabled="true"><div class="task-row">${head}</div></li>`;
    const key = `task:${jobId}:${agent.id}:${index}:${row.name}`;
    const trace = stepTrace(row.item, { agent, person, chipContext, withWho: false, withFiles: row.files });
    return `<li class="task"><details data-open-key="${esc(key)}"${openKeys?.has(key) ? ' open' : ''}><summary class="task-row" title="${esc(`Show the history of ${row.name}`)}">${head}<span class="chev" aria-hidden="true">${icon('chev')}</span></summary><div class="trace" role="group" aria-label="${esc(`History of ${row.name}`)}">${trace}</div></details></li>`;
  }).join('');
  return `<section class="chat-tasks" aria-label="${esc(`Tasks of the ${person.name} on this job`)}"><h3>${tasks.length ? 'Tasks' : 'Runs'} <span class="count">${rows.length}</span></h3><ol>${items}</ol></section>`;
}

/**
 * One agent's chat, in the Inbox's column. ctx: `tasks` (this agent's steps, from the plan), `chipContext` (the job's files),
 * `needs` (the Director's open questions and decisions, as they already render), `stuck`, `item` (when the agent's step is at a
 * gate), `status` (one plain line), and `compose` (the composer, when the person can message this agent). `asks` and `waiting` are
 * the Brand onboarding page's: the Director's messages, one per open item (each already drawn, with its own buttons), and how many of
 * them wait on the person, which the header says as "Waiting on you · 3". `feed` is the room's lines for this thread (see roomFeed): given, it
 * takes the place of the message bubbles, and of the step bubbles too once the room holds this agent's results (`feedWork`); left out (a job
 * from before the room), the old bubbles are drawn. `word` says the state word in place of the agent's own, and `quiet` leaves out the
 * typing dots (the Brand onboarding page shows the Director's work as its research checklist).
 */
export function agentChat(agent, ctx = {}) {
  const { tasks = [], chipContext = {}, needs = '', stuck = '', item = null, status = '', compose = '', openKeys = null, jobId = '', asks = [], waiting = 0, feed = null, feedWork = false, word: saidWord = '', quiet = false } = ctx;
  const view = agentView(agent);
  const name = agentNameOf(agent);
  const director = isDirectorAgent(agent);
  const role = agentPlain(agent.role) || (director ? DIRECTOR_ROLE : agentPlain(agent.task));
  const card = item ? `<div class="msg-r a"><div class="dc s-waiting"><div class="dc-h"><span class="node pic" aria-hidden="true"><img src="${gatePicture(item.gate)}" alt=""></span><div><b>${esc(item.title)}</b><span class="pill st-waiting">Waiting on you</span></div></div>${item.line ? `<p>${esc(item.line)}</p>` : ''}<div class="bub-act"><button type="button" class="sm" data-ab-gate="${esc(item.gate)}">${icon('change')} Ask for changes</button><button type="button" class="sm" data-ab-gate="${esc(item.gate)}">${icon('open')} Open details</button></div></div></div>` : '';
  const typing = view.state === 'working' && !quiet ? (view.asleep ? `<div class="msg-r a"><div class="bub"><p class="bub-note">${esc(ENGINE_CLOSED_WORD)}</p></div></div>` : `<div class="msg-r a"><div class="bub"><span class="typing" role="img" aria-label="Working"><i></i><i></i><i></i></span><p class="bub-note">${esc(director ? TXT_WORKING_ON_IT : agentPlain(agent.task, TXT_WORKING_ON_IT))}</p></div></div>`) : '';
  const state = status ? `<div class="msg-r a"><div class="bub"><p>${esc(status)}</p></div></div>` : '';
  const needsBubble = needs ? `<div class="msg-r a bub-wide"><div class="bub bub-need">${needs}</div></div>` : '';
  const stuckBubble = stuck ? `<div class="msg-r a bub-wide"><div class="bub bub-stuck">${stuck}</div></div>` : '';
  const askBubbles = (Array.isArray(asks) ? asks : []).join('');
  const word = saidWord || (waiting > 0 ? `${view.word} · ${waiting}` : view.word);
  return `<aside class="thread chat${askBubbles ? ' has-asks' : ''}" aria-labelledby="ab-chat-title" data-chat="${esc(agent.id)}"><div class="th-h"><button type="button" class="ghost back" data-ab-back aria-label="Back to the team" title="Back to the team">${icon('back')}<span>Back</span></button><span class="ag-f">${blob(agent.id, view.mood, 32)}</span><div class="ch-who"><h2 id="ab-chat-title" tabindex="-1">${esc(name)}</h2><span class="ag-w st-${view.tone}">${esc(word)}</span></div></div><div class="chat-l" data-scroll="chat-${esc(agent.id)}"><div class="chat-intro">${blob(agent.id, view.mood, 52)}<b>${esc(name)}</b>${role ? `<p>${esc(role)}</p>` : ''}</div>${stuckBubble}${chatTasks(agent, tasks, { chipContext, openKeys, jobId })}${feed !== null ? `${director || feedWork ? '' : workBubbles(agent, tasks, chipContext)}${feed}` : `${director ? '' : workBubbles(agent, tasks, chipContext)}${messageBubbles(agent)}`}${needsBubble}${askBubbles}${state}${card}${typing}${chatDetails(agent, { openKeys, jobId })}</div>${compose}</aside>`;
}

// What the agent did lately, in a small fold at the end of its chat: short plain lines, newest last.
function chatDetails(agent, { openKeys, jobId }) {
  const rows = (Array.isArray(agent.activity) ? agent.activity : []).map(row => ({ at: row?.at, text: agentPlain(row?.text) })).filter(row => row.text)
    .sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0)).slice(-5);
  if (!rows.length) return '';
  const key = `agent-activity:${jobId}:${agent.id}`;
  return `<details class="chat-details" data-open-key="${esc(key)}"${openKeys?.has(key) ? ' open' : ''}><summary>Details <span class="count">${rows.length}</span></summary><ol>${rows.map(row => `<li><time datetime="${esc(row.at || '')}">${esc(agentTime(row.at))}</time><span>${esc(row.text)}</span></li>`).join('')}</ol></details>`;
}

// Step statuses as the server projects them: done, running, waiting (on the person) or pending.
const STEP_STATUS_WORDS = Object.freeze({ done: 'Done', running: 'Working', waiting: "Waiting on you", pending: 'Not started' });
// The stage turns running as soon as the one before it is done, a moment before the Director calls its agent.
const STEP_STARTING_WORD = 'Starting';
const STEP_STATUSES = new Set(Object.keys(STEP_STATUS_WORDS));
const planWord = value => String(value ?? '').replace(/`/g, '').trim();
function stepStatusFallback(stage, index) {
  const status = String(stage?.status || 'pending').toLowerCase();
  if (status === 'complete' || status === 'done') return 'done';
  if (index !== 0) return 'pending';
  return status === 'waiting' || status === 'awaiting' ? 'waiting' : status === 'running' ? 'running' : 'pending';
}
function gateItemOf(gate, status, stage, agent = null) {
  const approval = (Array.isArray(stage?.approvals) ? stage.approvals : []).find(entry => entry?.gate === gate) || null;
  const entry = (Array.isArray(stage?.gates) ? stage.gates : []).find(item => item?.gate === gate) || null;
  return {
    kind: 'gate', gate, name: GATE_TITLES[gate] || humanize(gate), status: STEP_STATUSES.has(status) ? status : 'pending', approval,
    agent: agent && agent !== 'human' && agent !== 'scripts' ? agent : null, openedAt: trimmed(entry?.openedAt), history: Array.isArray(entry?.history) ? entry.history : [], quote: entry?.quote || null,
  };
}

/**
 * The job's stages as the page draws them: each stage's step cards (one per plan row) and gate sections (the rows the person
 * decides, and the gates a stage names). A row run by a script is left out, and a stage with no rows is one step of its own.
 */
export function stageItems(project, { pendingGate = null } = {}) {
  const list = (Array.isArray(project?.stages) ? project.stages : []).map(stage => (typeof stage === 'string' ? { id: stage, label: humanize(stage), status: 'pending' } : stage)).filter(stage => stage && typeof stage === 'object');
  const placed = new Set();
  const stages = list.map(stage => {
    const items = [];
    (Array.isArray(stage.tasks) ? stage.tasks : []).forEach((task, index) => {
      const agent = planWord(task?.agent);
      const gate = planWord(task?.gate);
      const status = STEP_STATUSES.has(task?.status) ? task.status : stepStatusFallback(stage, index);
      if (agent !== 'human' && agent !== 'scripts') items.push({ kind: 'step', name: trimmed(task?.name) || 'Step', line: trimmed(task?.line), agent: agent || 'producer', status, outputs: Array.isArray(task?.outputs) ? task.outputs : [], startedAt: trimmed(task?.startedAt), doneAt: trimmed(task?.doneAt), request: task?.request || null, questions: Array.isArray(task?.questions) ? task.questions : [] });
      if (gate && !placed.has(gate)) { placed.add(gate); items.push(gateItemOf(gate, task.gateStatus || (agent === 'human' ? status : 'pending'), stage, agent)); }
    });
    for (const entry of Array.isArray(stage.gates) ? stage.gates : []) {
      const gate = planWord(entry?.gate);
      if (gate && !placed.has(gate)) { placed.add(gate); items.push(gateItemOf(gate, entry.status, stage)); }
    }
    return { id: stage.id, label: trimmed(stage.label) || humanize(stage.id), status: stage.status, note: trimmed(stage.note), items, source: stage };
  });
  // A pending review the plan never named still gets its place: the sample in the stage that makes the media, any other at the end.
  if (pendingGate && !placed.has(pendingGate) && stages.length) {
    const home = (pendingGate === 'sample' || MEDIA_GATE_IDS.has(pendingGate) ? stages.find(stage => stage.id === 'making-the-images-and-video') : null) || stages[stages.length - 1];
    home.items.push(gateItemOf(pendingGate, 'waiting', home.source));
  }
  for (const stage of stages) {
    for (const item of stage.items) if (item.kind === 'gate' && item.gate === pendingGate) item.status = 'waiting';
    if (!stage.items.length) stage.items.push({ kind: 'step', name: stage.label, line: stage.note, agent: 'producer', status: stepStatusFallback(stage.source, 0), outputs: [], quote: stage.source?.quote || null, startedAt: trimmed(stage.source?.startedAt), doneAt: trimmed(stage.source?.doneAt) });
  }
  return stages;
}

// A decided approval gate that belongs to a done step is drawn on that step's card, not as a row of its own. A gate belongs to the
// step plan row that names it (the step drawn just before it in its stage: the ideas, the shot plan), and the price gate belongs to
// the "Pricing the media" step. Any other gate keeps its row. The result has fresh stage and step objects; `gates` lists the merged gates.
export function mergeDecidedGates(model) {
  const gates = new Set();
  const priced = [];
  const stages = (Array.isArray(model) ? model : []).map(stage => {
    const items = stage.items.map(item => ({ ...item }));
    if (stage.id === 'pricing-the-media') priced.push(...items.filter(item => item.kind === 'step'));
    return { ...stage, items };
  });
  for (const stage of stages) {
    stage.items = stage.items.filter((item, index) => {
      if (item.kind !== 'gate' || item.status !== 'done') return true;
      const before = stage.items[index - 1];
      const owner = item.agent ? (before?.kind === 'step' && before.agent === item.agent ? before : null) : item.gate === 'price' ? priced.at(-1) || null : null;
      if (!owner || owner.status !== 'done' || owner.decided) return true;
      owner.decided = item;
      owner.receipt = gateReceipt(item);
      gates.add(item.gate);
      return false;
    });
  }
  return { stages: stages.filter(stage => stage.items.length), gates };
}
// What a step card holds for the gate it carries: the decision, and whatever the gate would have opened with.
function decidedGateTrace(gate, body) {
  const rows = gateDecisionRows(gate);
  return traceSection('Your approval', (body || '') + (rows ? `<ol class="trace-list">${rows}</ol>` : ''));
}

// The Director's open questions on a job, as one card with their answer buttons. The job page draws it once: above the steps, or in the Director's chat while that is open.
export function stageQuestions(items, { stateOf = () => ({}), signal = {} } = {}) {
  const all = (Array.isArray(items) ? items : []).filter(item => item?.kind === 'question' && item.questionId);
  if (!all.length) return '';
  // A question answered here (or taken by a window that answered first) closes to its one line; only the ones still waiting are counted.
  const closed = item => questionClosed(item, stateOf(item) || {});
  const open = all.filter(item => !closed(item));
  const blocks = all.map((item, at) => (closed(item)
    ? `<div class="inbox-question is-closed" data-inbox-key="${esc(inboxKey(item))}">${closedQuestionLine(item, stateOf(item) || {})}</div>`
    : `<div class="inbox-question" data-inbox-key="${esc(inboxKey(item))}"><p class="inbox-text">${esc(inboxItemText(item))}</p>${questionCard(item, stateOf(item) || {}, signal, at, { place: 'stage' })}</div>`)).join('');
  const head = open.length ? `<p class="stage-ask-h">${esc(open.length === 1 ? 'The Director needs your answer' : `The Director needs ${open.length} answers`)}</p>` : '';
  return `<div class="stage-ask${open.length ? '' : ' is-closed'}" role="group" aria-label="The Director's questions for you">${head}${blocks}</div>`;
}

// ---- The steps of a job, drawn as a fold of stops ----
// One card for each stop: its number, its name, a line about when, and (opened) the work it holds with its files. A stop that began opens and
// closes; one not reached yet is a quiet row with a number and a name. A step or a decision inside a stop shows no agent's name.
const stopTime = value => (Number.isFinite(Date.parse(value ?? '')) ? agentTime(value).replace(/\s*([AP])M$/i, (_, half) => ` ${half.toLowerCase()}m`) : '');
const stopTimes = values => values.filter(value => Number.isFinite(Date.parse(value ?? ''))).sort((a, b) => Date.parse(a) - Date.parse(b));
const approvedAtOf = gate => trimmed(gate?.approval?.at) || [...(Array.isArray(gate?.history) ? gate.history : [])].reverse().find(entry => entry?.decision === 'approved')?.at || '';
// How a stop stands: what its steps and decisions say, or else what the plan says of the stop itself.
function stopStatus(stage) {
  const has = status => stage.items.some(item => item.status === status);
  if (has('waiting') || stage.source?.status === 'waiting') return 'waiting';
  if (has('running') || stage.source?.status === 'running') return 'running';
  if (stage.source?.status === 'complete' || (stage.items.length > 0 && stage.items.every(item => item.status === 'done'))) return 'done';
  return has('done') ? 'running' : 'pending';
}
// "Picked by you, 3:06 pm", "Approved by you, 4:27 pm", "Done, 3:31 pm", "Started 3:31 pm", "Since 4:27 pm". Empty when no time is known.
function stopLine(status, items) {
  const gates = items.flatMap(item => (item.kind === 'gate' ? [item] : item.decided ? [item.decided] : []));
  if (status === 'done') {
    const gate = gates.filter(item => item.status === 'done' && stopTime(approvedAtOf(item))).at(-1);
    if (gate) return `${gate.gate === 'concept' ? 'Picked by you' : 'Approved by you'}, ${stopTime(approvedAtOf(gate))}`;
    const at = stopTime(stopTimes(items.map(item => item.doneAt)).at(-1));
    return at ? `Done, ${at}` : '';
  }
  if (status === 'running') { const at = stopTime(stopTimes(items.filter(item => item.status === 'running').map(item => item.startedAt))[0]); return at ? `Started ${at}` : ''; }
  if (status === 'waiting') { const at = stopTime(stopTimes(gates.filter(item => item.status === 'waiting').map(item => item.openedAt)).at(-1)); return at ? `Since ${at}` : ''; }
  return '';
}

// One step inside an opened stop: its name and plain line, and what it made.
function stopStep(item, { who, chipContext, bodies }) {
  const person = who(item.agent);
  const status = item.status;
  const starting = status === 'running' && person?.called === false;
  const said = status === 'pending' ? TXT_NOT_STARTED_YET : status === 'waiting' ? TXT_WAITING_ON_YOU : starting ? 'The Director is getting this started' : status === 'done' && item.receipt ? item.receipt : item.line || (status === 'done' ? 'Finished' : TXT_WORKING_ON_IT);
  const mark = status === 'done' ? icon('check') : status === 'running' ? '<span class="pip"></span>' : status === 'waiting' ? icon('q') : '';
  const decided = item.decided ? decidedGateTrace(item.decided, bodies[item.decided.gate]?.html || '') : '';
  const work = status === 'pending' ? '' : stepTrace(item, { agent: person?.agent || null, person, chipContext, compact: true }) + decided;
  return `<li class="sub s-${status}"><span class="sub-m" aria-hidden="true">${mark}</span><div class="sub-b"><span class="sub-t"><b>${esc(item.name)}</b><span class="sub-s">${esc(said)}</span></span>${work ? `<div class="stg-work">${work}</div>` : ''}</div></li>`;
}

// A decision inside an opened stop. The one waiting on the person is the card above the fold, so here it only points up to it.
function stopGate(item, { who, chipContext, bodies, placed, above }) {
  const own = bodies[item.gate] || null;
  const status = item.status;
  const said = status === 'waiting' ? TXT_WAITING_ON_YOU : status === 'done' ? gateReceipt(item) || 'Done' : TXT_NOT_STARTED_YET;
  const mark = status === 'done' ? icon('check') : status === 'waiting' ? icon('q') : '';
  const link = status === 'waiting' && above === item.gate ? `<button type="button" class="sm" data-ab-gate="${esc(item.gate)}">Show it above</button>` : '';
  // The card the person decides on is drawn here, in the stop it belongs to, with no step row of its own above it.
  let work = '';
  if (status !== 'pending') {
    if (own?.html) { placed.add(item.gate); work += `<div class="stg-panels">${own.html}</div>`; }
    const author = item.agent ? who(item.agent) : null;
    work += gateTrace(item, { agent: author?.agent || null, person: author, director: who('producer')?.agent || null, chipContext, compact: true });
  }
  return `<li class="sub sub-gate s-${status}" data-gate="${esc(item.gate)}"><span class="sub-m" aria-hidden="true">${mark}</span><div class="sub-b"><span class="sub-t"><b>${esc(item.name)}</b><span class="sub-s">${esc(said)}</span>${link}</span>${work ? `<div class="stg-work">${work}</div>` : ''}</div></li>`;
}

// The width under which the job page is one column: the Team becomes a row of faces above the steps.
const narrowWidth = () => Boolean(globalThis.matchMedia?.('(max-width: 900px)')?.matches);
// The width under which the brand page's two columns (the form and the Director) are one.
const narrowBrandPage = () => Boolean(globalThis.matchMedia?.('(max-width: 950px)')?.matches);

/**
 * The stops, drawn: an ordered list with one card for each stop (see above). `bodies` maps a gate to what opens inside it ({ html, open });
 * the gates that got a body are returned in `placed`, so the page can show anything left over after the stops. The card a stop waits on is
 * drawn inside that stop; `lift` (a phone) lifts it out, into `lifted`, when its stop is folded, and `above` names a gate whose card the page
 * draws above the list. `asking` is the open questions' card, drawn inside the stop waiting on the person (`asked` says it found one).
 * `ask` is the Director's chat id and its draft is what "Ask for changes" starts. `who` gives the agent card
 * behind a step (`agent`, `called`), `chipContext` links its files. `done` and `total` count the stops, once.
 */
export function stageFlow(model, { jobId = '', who = () => null, bodies = {}, isOpen = (key, open) => open, chipContext = {}, above = '', ask = 'producer', closed = false, asking = '', lift = false } = {}) {
  const placed = new Set();
  const lifted = [];
  const merged = mergeDecidedGates(model);
  for (const [gate, own] of Object.entries(bodies)) if (own?.html && merged.gates.has(gate)) placed.add(gate);
  let done = 0;
  // Where an open question sits: in the stop waiting on the person, else the one being worked on, else the last that began.
  const states = merged.stages.map(stopStatus);
  const askAt = asking ? [states.indexOf('waiting'), states.indexOf('running'), states.lastIndexOf('done')].find(index => index >= 0) ?? -1 : -1;
  const stops = merged.stages.map((stage, at) => {
    const status = states[at];
    const name = esc(stage.label);
    if (status === 'done') done += 1;
    if (status === 'pending') return `<li class="stg s-pending"><div class="stg-row"><span class="n">${at + 1}</span><span class="stg-t"><h3>${name}</h3></span></div></li>`;
    const key = `stop:${jobId}:${stage.id ?? at}:${status}`;
    // A stop that holds a panel the person should see (the posts that went out, the report) opens by itself even when done.
    const holds = stage.items.some(item => { const gate = item.kind === 'gate' ? item : item.decided; return Boolean(gate && bodies[gate.gate]?.html && bodies[gate.gate].open); });
    // A stop with an open question stays open, so the question is never folded away.
    const asks = at === askAt ? asking : '';
    const open = isOpen(key, status !== 'done' || holds) || Boolean(asks);
    // The card a stop waits on lives inside that stop. Folded on a phone, it is lifted out above the steps so it stays in reach.
    const own = new Map();
    if (lift && !open) {
      for (const item of stage.items) if (item.kind === 'gate' && item.status === 'waiting' && bodies[item.gate]?.html) { lifted.push(bodies[item.gate].html); placed.add(item.gate); own.set(item.gate, item.gate); }
    }
    const stopBodies = own.size ? Object.fromEntries(Object.entries(bodies).filter(([gate]) => !own.has(gate))) : bodies;
    // The card the person decides on comes first in its stop; the work behind it follows.
    const decides = item => item.kind === 'gate' && item.status === 'waiting' && Boolean(stopBodies[item.gate]?.html);
    const ordered = [...stage.items.filter(decides), ...stage.items.filter(item => !decides(item))];
    const rows = ordered.map(item => (item.kind === 'step' ? stopStep(item, { who, chipContext, bodies: stopBodies }) : stopGate(item, { who, chipContext, bodies: stopBodies, placed, above: own.has(item.gate) ? item.gate : above })));
    const foot = status === 'done' ? `<div class="stg-foot"><button type="button" class="sm" data-ab-open="${esc(ask)}" data-ab-draft="${esc(`Change the ${String(stage.label).toLowerCase()}: `)}">Ask for changes</button></div>` : '';
    const line = stopLine(status, stage.items);
    const running = stage.items.filter(item => item.kind === 'step' && item.status === 'running');
    const starting = status === 'running' && running.length > 0 && running.every(item => who(item.agent)?.called === false);
    // `closed`: no session watches the board, so a stop that reads running is waiting for the studio to open.
    const word = starting ? STEP_STARTING_WORD : closed && status === 'running' ? ENGINE_CLOSED_WORD : STEP_STATUS_WORDS[status];
    return `<li class="stg s-${status}"><details class="stg-d" data-open-key="${esc(key)}"${open ? ' open' : ''}><summary class="stg-row"><span class="n">${status === 'done' ? icon('check') : at + 1}</span><span class="stg-t"><h3>${name}</h3>${line ? `<span class="meta">${esc(line)}</span>` : ''}</span><span class="pill st-${status}">${esc(word)}</span><span class="chev" aria-hidden="true">${icon('chev')}</span></summary><div class="stg-body">${asks}<ol class="sub-list">${rows.join('')}</ol>${foot}</div></details></li>`;
  });
  return { html: stops.length ? `<ol class="flow" aria-label="Steps of this job">${stops.join('')}</ol>` : '', placed, done, total: stops.length, lifted: lifted.join(''), asked: askAt >= 0 };
}

/**
 * What the Director says on a brand's onboarding page: this brand's open items, each its own message with the item's own buttons
 * (the same cards, requests and answers as the Needs you box they replace). The brand's items are its onboarding item (research
 * done, or research that could not finish) and the questions asked for it or for the whole workspace; a job's items stay with
 * its job, and another brand's stay with theirs. The onboarding item leads, then the questions in the order they were asked.
 */
export function brandAsks(items, brandSlug) {
  const when = item => { const at = Date.parse(item?.at ?? ''); return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER; };
  const own = (Array.isArray(items) ? items : []).filter(item => item && typeof item === 'object' && (
    (item.kind === 'onboarding' && item.brand === brandSlug && item.state !== 'running')
    || (item.kind === 'question' && !item.jobId && (!item.brand || item.brand === brandSlug))));
  const questions = own.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === 'question')
    .sort((a, b) => when(a.item) - when(b.item) || a.index - b.index).map(({ item }) => item);
  return [...own.filter(item => item.kind === 'onboarding'), ...questions];
}

/**
 * The Director's messages for those items: one bubble each, holding the same card the Needs you box drew (`inboxCard`, so every
 * button sends the request it always did), and how many of them wait on the person. An answered question and the research-done item
 * are not waiting. `first` is the words of the first one that waits, for the Director's row in the Inbox.
 * context: item -> the page state of that card, as `inboxPanel` takes it.
 */
export function directorAsks(items, { context = () => ({}), signal = {} } = {}) {
  const list = Array.isArray(items) ? items : [];
  const contexts = list.map(item => context(item) || {});
  const answered = at => (list[at].kind === 'question' && Boolean(contexts[at].question?.submitted || contexts[at].question?.answered)) || (list[at].state === 'subtopics' && Boolean(contexts[at].subtopics?.sent));
  const waits = list.map((item, at) => waitsOnPerson(item) && !answered(at));
  const messages = list.map((item, at) => `<div class="msg-r a bub-wide" data-ask="${esc(inboxKey(item))}"><div class="bub bub-need"><ol class="inbox-list">${inboxCard(item, { signal, ...contexts[at], index: at })}</ol></div></div>`);
  const first = list.find((item, at) => waits[at]);
  return { messages, waiting: waits.filter(Boolean).length, first: first ? inboxItemText(first) : '' };
}

// The Director's panel beside the brand's form: its thread, the same one the job room opens. The Director is the only one who asks, so
// its thread holds what it has to say: a line while the person fills the form in, the research checklist (seven rows, each helper's part with
// its state) once research is asked for, then the brand's open items as messages (`brandAsks`, each with its own buttons, the six
// subtopics as one card among them), and the closed line when an item is answered. A brand the server sent no team for still gets the
// Director alone. A chat opens on it at once (chatId undefined; null is the team list the person went back to). Nobody can be messaged
// here, so any other chat shows who the agent is and what it is doing. The page knows research was just requested before the server does,
// so the Director is Working at once. `notes` ({messages, waiting, first}, from intelDirectorNotes) follow its other asks.
const ONBOARD_DIRECTOR_ROLE = 'Helps you set up the brand';
export const ONBOARD_INTRO_LINE = 'Add a website or one social account, then press Start research.';
export function onboardAgentsPanel(brand, draft = null, now = Date.now(), chatId, { items = [], context, signal, notes = null } = {}) {
  if (!brand?.slug) return '';
  const given = (Array.isArray(brand.agents?.list) ? brand.agents.list : []).filter(agent => agent && typeof agent === 'object' && trimmed(agent.id));
  const phase = brandResearchPhase(brand, draft, now);
  const running = phase === 'running';
  // The research-done note and the failure note say what to do on this page; they never point at it.
  const onPage = item => (item.kind === 'onboarding' && item.state !== 'subtopics'
    ? { ...item, onPage: true, ...(item.state === 'review' ? { text: `${item.brandName ? `${item.brandName}: research done` : 'Research done'}. Check the details in the form, then press Save and continue.` } : {}) }
    : item);
  const asks = intelAsks(directorAsks(brandAsks(items, brand.slug).map(onPage), { context, signal }), notes);
  const sent = given.find(isDirectorAgent) || {
    id: 'producer', name: 'Director', state: running ? 'working' : brandReady(brand) ? 'done' : phase === 'new' ? 'waiting' : 'needs_you', files: [], activity: [], runs: [], messages: [],
    task: running ? 'Getting your brand ready' : brandReady(brand) ? 'Your brand is ready for jobs' : phase === 'failed' ? 'Research could not finish. Fill in the profile by hand' : phase === 'complete' ? 'Waiting for you to check the brand profile' : '',
  };
  // Start research was pressed and the studio has not picked it up yet: the list shows at once, every part waiting.
  const starting = !running && draft?.action === 'start' && !draft.declined && !draft.error && Boolean(draft.busy || draft.submitted || draft.needsReconciliation);
  const idle = phase === 'new' && !starting && asks.waiting === 0 && !brandReady(brand);
  const base = { ...sent, role: ONBOARD_DIRECTOR_ROLE };
  const director = asks.waiting > 0 ? { ...base, state: 'needs_you', task: asks.first || base.task }
    : idle ? { ...base, state: 'waiting', task: '', note: 'Here to help' }
      : starting ? { ...base, state: 'waiting', task: '', note: 'Starting the research' }
      : running && base.state === 'needs_you' ? { ...base, state: 'working', task: 'Getting your brand ready' } : base;
  const intel = intelOf(brand);
  const before = [];
  if (idle && !asks.messages.length) before.push(`<div class="msg-r a"><div class="bub"><p>${esc(ONBOARD_INTRO_LINE)}</p></div></div>`);
  if (starting) before.push(researchChecklist(researchRows(null, { asleep: true }), { starting: true }));
  else if (running || (!brandReady(brand) && intelSteps(intel).length)) before.push(researchChecklist(researchRows(intel, { asleep: agentView(director).asleep === true })));
  const agents = [director, ...given.filter(agent => !isDirectorAgent(agent))];
  const open = (chatId === undefined ? director.id : chatId) || null;
  const chat = open ? agents.find(agent => agent.id === open) : null;
  // A brand that is ready and has nothing to say has no panel: the page is the form alone.
  if (chat && isDirectorAgent(chat) && chatId === undefined && !before.length && !asks.messages.length) return '';
  if (chat) return agentChat(chat, isDirectorAgent(chat) ? { asks: [...before, ...asks.messages], waiting: asks.waiting, word: idle ? 'Here to help' : starting ? 'Starting' : '', quiet: true } : { status: agentPlain(chat.task) });
  return `<div class="onboard-agents">${agentInbox(agents, { now, needText: asks.first, questions: asks.waiting, waitingOnYou: asks.waiting })}</div>`;
}

// @module intel
// Brand intelligence on the brand page: what Claude learned about a brand, from `brand.intelligence` ({status, updatedAt, steps, own,
// competitors, viral, subtopics, plan, formatNames, banksSummary, newBrand}, which the server adds once a deep research pass has started;
// a brand without it draws nothing). While the research runs the panel is a checklist with a progress bar. When it is ready the panel has
// six tabs: the 6 by 5 plan (a cell asks first, on the page, then starts a post), the person's own winners, the 6 subtopics (confirm, edit,
// add your own, remove), the competitors' winners, what is viral now, and a compact summary of the banks that links to the Brand library.
// A post card has a picture (or a platform tile), the numbers, the labels and two controls: Open post and Copy link. The page state (open
// tab, subtopic edits, the cell being confirmed) lives in the app, one record per brand; everything here is a function of the brand and it.
export const INTEL_TABS = Object.freeze([
  { id: 'plan', label: 'Post plan' },
  { id: 'own', label: 'Your winners' },
  { id: 'subtopics', label: 'Topics' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'viral', label: 'Viral now' },
  { id: 'banks', label: 'What customers say' },
]);
export const INTEL_SUBTOPIC_COUNT = 6;
export const INTEL_SUBTOPIC_MAX = 8;
const INTEL_MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
const INTEL_PLATFORM_WORDS = Object.freeze({ tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X', linkedin: 'LinkedIn', meta: 'Meta ad', meta_ad: 'Meta ad', meta_ads: 'Meta ad', tiktok_ad: 'TikTok ad', tiktok_ads: 'TikTok ad' });
const INTEL_STEP_WORDS = Object.freeze({ done: 'Done', running: 'In progress', todo: 'Not started' });
// The banks the summary shows, in order: the key in `banksSummary`, the kind of the Brand library group it links to, and its name.
const INTEL_BANKS = Object.freeze([
  { key: 'pains', kind: 'pain', title: 'Pains' },
  { key: 'objections', kind: 'objection', title: 'Objections' },
  { key: 'desires', kind: 'desire', title: 'Desires' },
  { key: 'angles', kind: 'angle', title: 'Angles' },
  { key: 'hooks', kind: 'hook', title: 'Hooks' },
  { key: 'ctas', kind: 'cta', title: 'CTAs' },
]);
const INTEL_LABELS = Object.freeze([['format', 'Format'], ['editing', 'Editing'], ['visualHook', 'Visual hook'], ['series', 'Series'], ['subtopic', 'Subtopic']]);
const intelObject = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const intelList = value => (Array.isArray(value) ? value : []);
const intelRecords = value => intelList(value).filter(item => item && typeof item === 'object' && !Array.isArray(item));
const intelCountOf = value => (Number.isFinite(value) && value >= 0 ? value : null);
const intelId = value => (typeof value === 'string' ? value.trim() : '');

// The page state of one brand's intelligence panel: the open tab, the subtopic edit in progress (`rows`, each {id?, name}), the request
// states, and which post card shows Copied or the hand-copy box.
export function freshIntelState() {
  return { tab: 'plan', editing: false, rows: [], busy: false, error: '', sent: null, cell: null, cellBusy: false, cellError: '', cellSent: '', copied: '', fallback: '' };
}

// The brand's intelligence document, or null: a brand with none (or an empty one) draws nothing at all.
export function intelOf(brand) {
  const intel = brand?.intelligence;
  if (!intel || typeof intel !== 'object' || Array.isArray(intel)) return null;
  const has = Boolean(intel.status || intelList(intel.steps).length || intelList(intel.own).length || intelList(intel.competitors).length || intelList(intel.viral).length
    || intelList(intelObject(intel.subtopics).items).length || intelList(intelObject(intel.plan).cells).length || Object.keys(intelObject(intel.banksSummary)).length);
  return has ? intel : null;
}
export const intelIsRunning = intel => intel?.status === 'running';

// 1,234 as 1.2K, 67,700 as 67.7K, 1,200,000 as 1.2M. Anything that is not a count is an empty string.
export function intelCount(value) {
  if (intelCountOf(value) === null) return '';
  const short = amount => (amount >= 100 ? String(Math.round(amount)) : String(Math.round(amount * 10) / 10));
  if (value < 1000) return String(Math.round(value));
  if (value < 999500) return `${short(value / 1000)}K`;
  return `${short(value / 1e6)}M`;
}
// "4 Oct", or "4 Oct 2024" when it is not this year; an empty string for a value that is not a date.
export function intelDay(value, now = Date.now()) {
  const found = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof value === 'string' ? value : '');
  if (!found) return '';
  const month = Number(found[2]);
  const day = Number(found[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${day} ${INTEL_MONTHS[month - 1]}${Number(found[1]) === new Date(now).getFullYear() ? '' : ` ${found[1]}`}`;
}
const intelPlatform = value => INTEL_PLATFORM_WORDS[String(value || '').toLowerCase()] || (trimmed(value) ? humanize(value) : 'Post');

// The subtopic items, cleaned: {id, name, topViews, postCount, source}.
export function intelSubtopics(intel) {
  return intelRecords(intelObject(intel?.subtopics).items).filter(item => trimmed(item.name)).map(item => ({
    id: intelId(item.id), name: trimmed(item.name), topViews: intelCountOf(item.topViews), postCount: intelCountOf(item.postCount), source: item.source === 'yours' ? 'yours' : 'data',
  }));
}
// The name of a label, a plan row or a plan column: the format library's name for an id, the subtopic's own name, the person's custom
// words, or a plain reading of the id when the library did not send its name.
function intelName(intel, value, group) {
  if (value && typeof value === 'object') return trimmed(value.custom) || trimmed(value.name) || (value.id ? intelName(intel, value.id, group) : '');
  const id = intelId(value);
  if (!id) return '';
  const names = intelObject(intel?.formatNames);
  if (Object.prototype.hasOwnProperty.call(names, id) && trimmed(names[id])) return trimmed(names[id]);
  if (group === 'subtopic') {
    const found = intelSubtopics(intel).find(item => item.id === id);
    if (found) return found.name;
  }
  return /^[A-Z]-[A-Z0-9-]+$/.test(id) ? humanize(id.replace(/^[A-Z]-/, '')) : id;
}
function intelPlan(intel) {
  const plan = intelObject(intel?.plan);
  const subtopics = intelSubtopics(intel);
  const cells = intelRecords(plan.cells);
  return {
    rows: intelList(plan.subtopics).map(intelId).filter(Boolean).map(id => ({ id, name: subtopics.find(item => item.id === id)?.name || intelName(intel, id, 'subtopic') })),
    cols: intelList(plan.formats).map(intelId).filter(Boolean).map(id => ({ id, name: intelName(intel, id, 'format') })),
    cell: (subtopic, format) => cells.find(cell => intelId(cell.subtopic) === subtopic && intelId(cell.format) === format) || null,
  };
}
// The steps of the research checklist: {label, detail, state: done|running|todo}.
export function intelSteps(intel) {
  return intelRecords(intel?.steps).filter(step => trimmed(step.label)).map(step => ({ id: trimmed(step.id), label: trimmed(step.label), detail: trimmed(step.detail), state: step.state === 'done' || step.state === 'running' ? step.state : 'todo' }));
}

// The checklist the Director shows beside the brand's form: seven rows, each the part of the research one helper does, with its face, the
// helper's name and where it stands. The server keeps eleven finer steps (see brand-intelligence.mjs); each row is the group of them it
// stands for, done when all are done and working while any has started. With no checklist yet (research was only just asked for) the five
// parts that start together show as working, or as waiting when no studio is open, and the Director's own two later.
export const RESEARCH_ROWS = Object.freeze([
  { id: 'website', label: 'Your website and accounts', who: 'Researcher', agent: 'researcher', steps: ['website', 'accounts'] },
  { id: 'own', label: 'Your best posts, taken apart', who: 'Researcher', agent: 'researcher', steps: ['own_top', 'own_teardown'] },
  { id: 'rivals', label: 'Competitors and their best posts', who: 'Researcher', agent: 'researcher', steps: ['competitors', 'rivals_teardown'] },
  { id: 'viral', label: 'What is viral in your niche', who: 'Trend Scout', agent: 'trend-scout', steps: ['viral'] },
  { id: 'pains', label: 'Customer pain points', who: 'Researcher', agent: 'researcher', steps: ['pains'] },
  { id: 'subtopics', label: 'Six subtopics', who: 'Director', agent: 'producer', steps: ['subtopics'] },
  { id: 'plan', label: 'A plan of 30 post ideas', who: 'Strategist', agent: 'strategist', steps: ['plan', 'files'] },
]);
export const RESEARCH_ROW_WORDS = Object.freeze({ done: 'Done', working: 'Working', waiting: 'Waiting', later: 'Later' });
export function researchRows(intel, { asleep = false } = {}) {
  const steps = intelSteps(intel);
  const known = new Set(RESEARCH_ROWS.flatMap(row => row.steps));
  if (!steps.length) return RESEARCH_ROWS.map((row, at) => ({ ...row, state: at < 5 ? (asleep ? 'waiting' : 'working') : 'later', detail: '' }));
  // A checklist of steps this board does not know (the Director may write its own) is shown as it is, one row each.
  if (!steps.some(step => known.has(step.id))) return steps.map(step => ({ id: step.id, label: step.label, who: '', agent: 'producer', state: step.state === 'done' ? 'done' : step.state === 'running' ? 'working' : 'later', detail: step.detail }));
  return RESEARCH_ROWS.map(row => {
    const mine = row.steps.map(id => steps.find(step => step.id === id)).filter(Boolean);
    const state = !mine.length || mine.every(step => step.state === 'todo') ? 'later' : mine.every(step => step.state === 'done') ? 'done' : 'working';
    const detail = (mine.find(step => step.state === 'running' && step.detail) || [...mine].reverse().find(step => step.detail))?.detail || '';
    return { ...row, state, detail: state === 'later' ? '' : detail };
  });
}
// The Director's message with the seven rows. `lead` says in one line where the research stands.
export function researchChecklist(rows, { starting = false } = {}) {
  const done = rows.filter(row => row.state === 'done').length;
  const lead = starting ? 'Research starts as soon as your studio picks it up.' : done === rows.length ? 'Research is done.' : 'Research is running. You can keep working.';
  const face = row => blob(row.agent, row.state === 'done' ? 'happy' : row.state === 'working' ? 'thinking' : 'sleepy', 28);
  const list = rows.map(row => `<li class="is-${row.state}">${face(row)}<span class="ob-research-text">${esc(row.label)}<small>${esc([row.who, row.detail].filter(Boolean).join(' · '))}</small></span><span class="pill ${row.state === 'later' || row.state === 'waiting' ? '' : row.state}">${esc(RESEARCH_ROW_WORDS[row.state])}</span></li>`).join('');
  return `<div class="msg-r a bub-wide ob-research-msg" data-ob-research><div class="bub"><p>${esc(lead)}</p><ol class="ob-research" aria-label="Research, step by step">${list}</ol></div></div>`;
}

// Why the subtopics cannot be saved as they stand, or '' when they can. A confirmed list has exactly 6 distinct names; while editing the
// person can go up to 8 to swap one for another.
export function intelSubtopicsProblem(rows) {
  const names = intelList(rows).map(row => String(row?.name ?? '').trim());
  if (names.some(name => !name)) return 'Fill in the empty subtopic or remove it.';
  if (new Set(names.map(name => name.toLowerCase())).size < names.length) return 'Two subtopics share a name. Rename or remove one.';
  if (names.length > INTEL_SUBTOPIC_COUNT) return `Remove ${names.length - INTEL_SUBTOPIC_COUNT} to keep exactly ${INTEL_SUBTOPIC_COUNT}.`;
  if (names.length < INTEL_SUBTOPIC_COUNT) return `Add ${names.length === INTEL_SUBTOPIC_COUNT - 1 ? 'one more' : `${INTEL_SUBTOPIC_COUNT - names.length} more`} to reach ${INTEL_SUBTOPIC_COUNT}.`;
  return '';
}
// The items a subtopics_confirm request carries: {id, name} for a kept subtopic, {name} for one the person added.
export const intelSubtopicItems = rows => intelList(rows).map(row => { const name = String(row?.name ?? '').trim(); const id = intelId(row?.id); return id ? { id, name } : { name }; });
// What the edit form says about the rows as they stand: the problem (empty when they can be saved) and the line shown under the list.
export function intelEditStatus(rows) {
  const issue = intelSubtopicsProblem(rows);
  return { issue, text: issue || `${intelList(rows).length} of ${INTEL_SUBTOPIC_COUNT} subtopics. Ready to save.` };
}
const intelNamesKey = rows => intelList(rows).map(row => String(row?.name ?? '').trim().toLowerCase()).join('\n');
const INTEL_SENT_MS = 15 * 60 * 1000;
// A subtopics_confirm the person sent has landed once the document says confirmed with the same names. Until then the panel says it was
// sent (for a while: a request the server never lands should not leave the panel waiting for good).
export function intelSentLanded(intel, sent) {
  return Boolean(sent) && intelObject(intel?.subtopics).status === 'confirmed' && intelNamesKey(intelSubtopics(intel)) === intelNamesKey(sent.rows);
}
function intelSentPending(intel, sent, now) {
  return Boolean(sent) && !intelSentLanded(intel, sent) && !(Number.isFinite(sent.at) && now - sent.at > INTEL_SENT_MS);
}

function intelNumbers(post, now) {
  const views = intelCountOf(post.views);
  const likes = intelCountOf(post.likes);
  const first = views !== null ? `${intelCount(views)} views` : likes !== null ? `Likes only · ${intelCount(likes)}` : 'No numbers shown';
  return [first, intelDay(post.date, now)].filter(Boolean).join(' · ');
}
// A picture that failed to load once is not asked for again (`bad` holds those addresses): the card keeps its platform tile.
function intelThumb(post, bad, thumbs) {
  const src = postThumbSrc(post, thumbs);
  const picture = src && !(bad && bad.has(src)) ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
  return `<div class="intel-thumb">${picture}<span class="intel-plat">${esc(intelPlatform(post.platform))}</span><span class="intel-play" aria-hidden="true"></span></div>`;
}
/**
 * One post, taken apart: a picture (or a platform tile with a play mark when there is no safe picture), the title, the numbers, the labels,
 * the competitor's name when it is one's, and Open post (a real https link, new tab) with Copy link.
 * opts: {section, index, competitor, copied, fallback, hint, now, bad, thumbs}; `copied` and `fallback` are the card key that shows Copied or the
 * hand-copy box (the key is `section:id`); `bad` is the set of picture addresses that did not load; `thumbs` is the brand's pictures (postThumbSrc).
 */
export function intelPostCard(post, intel, { section = 'post', index = 0, competitor = '', copied = '', fallback = '', hint = '', now = Date.now(), bad = null, thumbs = null } = {}) {
  const key = `${section}:${intelId(post.id) || index}`;
  const title = trimmed(post.title) || 'Untitled post';
  const href = safeHttpsLink(post.url);
  const labels = intelObject(post.labels);
  const pills = INTEL_LABELS.map(([field, word]) => { const name = intelName(intel, labels[field], field); return name ? `<span class="pill">${esc(`${word}: ${name}`)}</span>` : ''; }).join('');
  const maker = trimmed(post.competitor) || competitor;
  const links = href
    ? `<a class="intel-open" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`Open post in a new tab: ${title}`)}">Open post ↗</a><button type="button" class="intel-copy${copied === key ? ' is-copied' : ''}" data-intel-act="copy" data-intel-arg="${esc(key)}" data-intel-url="${esc(href)}" data-intel-focus="copy:${esc(key)}" aria-label="${esc(`${copied === key ? 'Link copied' : 'Copy link'}: ${title}`)}">${copied === key ? 'Copied' : 'Copy link'}</button>`
    : '<span class="muted">No link saved.</span>';
  const box = href && fallback === key
    ? `<div class="kit-fallback intel-fallback"><p class="kit-fallback-status" role="status">${esc(KIT_COPY_REFUSED.replace('the text', 'the link'))}</p><label class="visually-hidden" for="intel-fallback-${esc(section)}-${index}">Link to this post</label><input id="intel-fallback-${esc(section)}-${index}" type="text" readonly value="${esc(href)}" data-intel-fallback="${esc(key)}" aria-describedby="intel-fallback-hint-${esc(section)}-${index}"><div class="kit-fallback-foot"><span class="muted" id="intel-fallback-hint-${esc(section)}-${index}">${esc(hint || copyHint(''))}</span><button type="button" class="quiet" data-intel-act="copy-done" data-intel-arg="${esc(key)}">Done</button></div></div>`
    : '';
  return `<article class="intel-card" data-intel-post="${esc(key)}">${intelThumb(post, bad, thumbs)}<div class="intel-card-body">${maker ? `<span class="pill intel-comp">${esc(maker)}</span>` : ''}<h3 class="intel-title" title="${esc(title)}">${esc(title)}</h3><p class="intel-num">${esc(intelNumbers(post, now))}</p>${pills ? `<div class="intel-tags">${pills}</div>` : ''}<div class="intel-links">${links}</div>${box}</div></article>`;
}
function intelCards(items, intel, ui, section, ctx) {
  return `<div class="intel-cards">${items.map(({ post, competitor }, index) => intelPostCard(post, intel, { section, index, competitor, copied: ui.copied, fallback: ui.fallback, hint: ctx.hint, now: ctx.now, bad: ctx.bad, thumbs: ctx.thumbs })).join('')}</div>`;
}

// The 6 by 5 plan: the subtopics down, the formats across, an idea in every cell. A cell is a button; the one chosen opens a confirm step
// under the table (never a pop-up) and only that step's button starts the post.
function intelPlanPanel(intel, ui) {
  const plan = intelPlan(intel);
  if (!plan.rows.length || !plan.cols.length) {
    return '<p class="intel-empty">No plan yet.</p>';
  }
  const head = `<tr><th scope="col">Subtopic</th>${plan.cols.map(col => `<th scope="col">${esc(col.name)}</th>`).join('')}</tr>`;
  const body = plan.rows.map((row, r) => `<tr><th scope="row">${esc(row.name)}</th>${plan.cols.map((col, c) => {
    const cell = plan.cell(row.id, col.id);
    if (!cell || !trimmed(cell.idea)) return '<td><span class="intel-cell-empty">No idea yet</span></td>';
    const on = Boolean(ui.cell) && ui.cell.subtopic === row.id && ui.cell.format === col.id;
    return `<td><button type="button" class="intel-cell" aria-pressed="${on}" data-intel-act="cell" data-intel-sub="${esc(row.id)}" data-intel-fmt="${esc(col.id)}" data-intel-focus="cell:${r}:${c}"><span class="visually-hidden">${esc(`${row.name}, ${col.name}: `)}</span>${esc(cell.idea)}</button></td>`;
  }).join('')}</tr>`).join('');
  const chosen = ui.cell ? { row: plan.rows.find(row => row.id === ui.cell.subtopic), col: plan.cols.find(col => col.id === ui.cell.format) } : null;
  const cell = chosen?.row && chosen.col ? plan.cell(chosen.row.id, chosen.col.id) : null;
  const detail = cell ? [['Angle', cell.angle], ['Hook', cell.hook]].filter(([, text]) => trimmed(text)).map(([word, text]) => `<p class="muted">${esc(`${word}: ${text.trim()}`)}</p>`).join('') : '';
  const confirm = cell
    ? `<div class="intel-confirm" role="group" aria-labelledby="intel-confirm-title" tabindex="-1" data-intel-focus="cell-confirm"><p id="intel-confirm-title"><strong>Start a post from this cell?</strong></p><p class="muted">${esc(chosen.row.name)} &times; ${esc(chosen.col.name)}</p><p class="intel-idea">${esc(cell.idea)}</p>${detail}<div class="intel-actions"><button type="button" class="primary" data-intel-act="cell-go" data-intel-focus="cell-go"${ui.cellBusy ? ' disabled aria-busy="true"' : ''}>${ui.cellBusy ? 'Sending...' : 'Start this post'}</button><button type="button" class="quiet" data-intel-act="cell-cancel" data-intel-focus="cell-cancel">Cancel</button></div>${ui.cellError ? `<p class="inline-error" role="alert">${esc(ui.cellError)}</p>` : ''}</div>`
    : '';
  const sent = ui.cellSent && !cell ? `<p class="intel-note" role="status" tabindex="-1" data-intel-focus="cell-sent">${esc(ui.cellSent)}</p>` : '';
  return `<p class="intel-intro">Your ${plan.rows.length} subtopics down, the ${plan.cols.length} formats that work best across. Every cell is a post idea. Choose one to start a post from it; you confirm before anything is made.</p><div class="intel-scroll" tabindex="0" role="region" aria-label="Post plan, scrolls sideways on a narrow screen"><table class="intel-plan"><thead>${head}</thead><tbody>${body}</tbody></table></div>${confirm}${sent}`;
}

function intelOwnPanel(intel, ui, ctx) {
  const posts = intelRecords(intel.own).map(post => ({ post, competitor: '' }));
  const empty = intel.newBrand
    ? 'None yet.'
    : 'No winners yet.';
  return `<p class="intel-intro">Your best posts feed concept A.</p>${posts.length ? intelCards(posts, intel, ui, 'own', ctx) : `<p class="intel-empty">${esc(empty)}</p>`}`;
}
function intelCompetitorsPanel(intel, ui, ctx) {
  const groups = intelRecords(intel.competitors);
  const posts = groups.flatMap(group => intelRecords(group.posts).map(post => ({ post, competitor: trimmed(group.name) })));
  const names = groups.map(group => trimmed(group.name)).filter(Boolean);
  const who = names.length ? ` ${names.length === 1 ? 'Competitor' : 'Competitors'}: ${names.join(', ')}.` : '';
  return `<p class="intel-intro">${esc(`Competitor winners feed concept B.${who}`)}</p>${posts.length ? intelCards(posts, intel, ui, 'competitor', ctx) : '<p class="intel-empty">No competitor posts yet.</p>'}`;
}
function intelViralPanel(intel, ui, ctx) {
  const posts = intelRecords(intel.viral).map(post => ({ post, competitor: '' }));
  return `<p class="intel-intro">Rising now. Feeds concept C.</p>${posts.length ? intelCards(posts, intel, ui, 'viral', ctx) : '<p class="intel-empty">Nothing viral found yet.</p>'}`;
}

// The 6 subtopics: cards to read, and the controls that confirm, edit, add and remove. Confirming sends all of them at once.
function intelSubtopicsPanel(intel, ui, now) {
  const items = intelSubtopics(intel);
  const meta = intelObject(intel.subtopics);
  const intro = '<p class="intel-intro">The 6 top subtopics in your niche.</p>';
  const problem = ui.error ? `<p class="inline-error" role="alert">${esc(ui.error)}</p>` : '';
  if (ui.editing) {
    const rows = ui.rows;
    const { issue, text: status } = intelEditStatus(rows);
    const list = rows.map((row, at) => `<li class="intel-edit-row"><label class="visually-hidden" for="intel-sub-${at}">${esc(`Subtopic ${at + 1}`)}</label><input id="intel-sub-${at}" type="text" maxlength="80" autocomplete="off" value="${esc(row.name)}" data-intel-row="${at}" data-intel-focus="row:${at}" placeholder="Name a subtopic"><button type="button" class="quiet" data-intel-act="remove" data-intel-arg="${at}" data-intel-focus="remove:${at}" aria-label="${esc(`Remove subtopic ${at + 1}${trimmed(row.name) ? `: ${row.name.trim()}` : ''}`)}">Remove</button></li>`).join('');
    return `${intro}<form class="intel-edit" data-intel-form novalidate><ul class="intel-edit-rows">${list}</ul><p class="intel-count${issue ? ' is-bad' : ''}" role="status" aria-live="polite">${esc(status)}</p>${problem}<div class="intel-actions"><button type="submit" class="primary" data-intel-focus="save"${issue || ui.busy ? ' disabled' : ''}${ui.busy ? ' aria-busy="true"' : ''}>${ui.busy ? 'Sending...' : `Save these ${INTEL_SUBTOPIC_COUNT}`}</button><button type="button" data-intel-act="add" data-intel-focus="add"${rows.length >= INTEL_SUBTOPIC_MAX || ui.busy ? ' disabled' : ''}>+ Add your own</button><button type="button" class="quiet" data-intel-act="cancel-edit" data-intel-focus="cancel-edit"${ui.busy ? ' disabled' : ''}>Cancel</button></div></form>`;
  }
  if (!items.length) return `${intro}<p class="intel-empty">Appear once posts are analysed.</p>`;
  const cards = items.map(item => {
    const facts = item.source === 'yours' ? 'Added by you' : [item.topViews !== null ? `Top post ${intelCount(item.topViews)}` : '', item.postCount !== null ? `${item.postCount} ${item.postCount === 1 ? 'post' : 'posts'}` : ''].filter(Boolean).join(' · ');
    return `<li class="intel-sub"><strong>${esc(item.name)}</strong>${facts ? `<span class="intel-sub-meta">${esc(facts)}</span>` : ''}${item.source === 'yours' ? '<span class="pill">Yours</span>' : ''}</li>`;
  }).join('');
  const confirmed = meta.status === 'confirmed';
  const waiting = intelSentPending(intel, ui.sent, now);
  const ready = items.length === INTEL_SUBTOPIC_COUNT;
  const state = waiting ? '<p class="intel-note" role="status">Sent.</p>'
    : !ready && !confirmed ? `<p class="intel-note" role="status">I found ${items.length}, and every job needs exactly ${INTEL_SUBTOPIC_COUNT}. Edit them, or add your own.</p>` : '';
  const confirmButton = waiting ? '' : confirmed ? '<span class="pill ready">Confirmed</span>'
    : `<button type="button" class="primary" data-intel-act="confirm" data-intel-focus="confirm"${ready && !ui.busy ? '' : ' disabled'}${ui.busy ? ' aria-busy="true"' : ''}>${ui.busy ? 'Sending...' : 'Looks right'}</button>`;
  return `${intro}<ul class="intel-subs">${cards}</ul>${state}${problem}<div class="intel-actions">${confirmButton}<button type="button" data-intel-act="edit" data-intel-focus="edit">Edit</button><button type="button" data-intel-act="add-own" data-intel-focus="add-own">+ Add your own</button></div>`;
}

function intelBank(value) {
  const pick = entry => (typeof entry === 'string' ? trimmed(entry) : trimmed(entry?.text) || trimmed(entry?.name));
  if (typeof value === 'number') return { count: intelCountOf(value) === null ? null : Math.floor(value), top: '' };
  if (typeof value === 'string') return { count: null, top: trimmed(value) };
  if (Array.isArray(value)) return { count: value.length, top: pick(value[0]) };
  if (value && typeof value === 'object') {
    const items = intelList(value.items);
    const count = [value.count, value.total, value.n].find(item => intelCountOf(item) !== null);
    return { count: count === undefined ? (items.length || null) : Math.floor(count), top: trimmed(value.top) || trimmed(value.text) || trimmed(value.sample) || pick(value.top) || pick(items[0]) };
  }
  return { count: null, top: '' };
}
// The banks in short: how many of each, the top one, and a link to that bank in the Brand library when the library has it.
function intelBanksPanel(intel, ctx) {
  const summary = intelObject(intel.banksSummary);
  const cards = INTEL_BANKS.map(bank => {
    const row = intelBank(summary[bank.key]);
    const linked = ctx.libraryKinds.has(bank.kind);
    return `<div class="intel-bank"><div class="intel-bank-title"><span>${esc(bank.title)}</span>${row.count !== null ? `<span class="count num">${row.count}</span>` : ''}</div>${row.top || !row.count ? `<p class="intel-bank-top">${esc(row.top || 'None saved yet.')}</p>` : ''}${linked ? `<button type="button" class="intel-bank-link" data-intel-act="bank" data-intel-arg="${esc(bank.kind)}" data-intel-focus="bank:${esc(bank.kind)}" aria-label="${esc(`Open ${bank.title.toLowerCase()} in the Brand library`)}">Open in Brand library</button>` : ''}</div>`;
  }).join('');
  return `<p class="intel-intro">What customers say.</p><div class="intel-banks">${cards}</div>`;
}

function intelTabs(slug, name, current) {
  const buttons = INTEL_TABS.map(tab => `<button type="button" role="tab" id="intel-tab-${esc(slug)}-${tab.id}" aria-selected="${tab.id === current}"${tab.id === current ? ` aria-controls="intel-panel-${esc(slug)}"` : ''} tabindex="${tab.id === current ? 0 : -1}" data-intel-act="tab" data-intel-arg="${tab.id}" data-intel-focus="tab:${tab.id}">${esc(tab.label)}</button>`).join('');
  return `<div class="intel-tabs" role="tablist" aria-label="${esc(`Brand intelligence for ${name}`)}">${buttons}</div>`;
}
function intelRunningBody(intel) {
  if (!intelSteps(intel).length) return '<p class="muted">The Director is starting the research.</p>';
  // The same seven rows as the Director's list beside the brand's form.
  const steps = researchRows(intel);
  const done = steps.filter(step => step.state === 'done').length;
  const percent = Math.round((done / steps.length) * 100);
  const rows = steps.map(step => {
    const state = step.state === 'done' ? 'done' : step.state === 'later' ? 'todo' : 'running';
    const detail = [step.who, step.detail].filter(Boolean).join(' · ');
    return `<li class="is-${state}"><span class="intel-dot" aria-hidden="true"></span><span class="intel-step-text">${esc(step.label)}<span class="visually-hidden">${esc(` (${INTEL_STEP_WORDS[state]})`)}</span>${detail ? `<span class="intel-step-detail">${esc(detail)}</span>` : ''}</span></li>`;
  }).join('');
  return `<div class="intel-progress"><span class="intel-progress-line">${esc(`${done} of ${steps.length} steps done`)}</span><div class="intel-bar" role="progressbar" aria-label="Research progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="--intel-pct:${percent}%"></i></div></div><ol class="intel-steps">${rows}</ol><p class="muted intel-foot">You can keep working.</p>`;
}

/**
 * The brand's intelligence panel: a folded panel in the style of the Brand library. ui: the brand's page state (freshIntelState);
 * opts: open (the panel is open), now, hint (how to copy by hand), libraryKinds (the kinds of bank the Brand library has, for the links),
 * badPictures (the picture addresses that did not load).
 * Nothing is drawn for a brand without intelligence.
 */
export function brandIntelligence(brand, ui = freshIntelState(), { open = false, now = Date.now(), hint = '', libraryKinds = new Set(), badPictures = null } = {}) {
  const intel = intelOf(brand);
  const slug = trimmed(brand?.slug);
  if (!intel || !slug) return '';
  const name = trimmed(brand.name) || slug;
  const running = intelIsRunning(intel);
  const steps = intelSteps(intel);
  const updated = intelDay(intel.updatedAt, now);
  const line = running
    ? [name, steps.length ? `${researchRows(intel).filter(row => row.state === 'done').length} of ${researchRows(intel).length} steps done` : 'Starting'].join(' · ')
    : [name, updated ? `Updated ${updated}` : ''].filter(Boolean).join(' · ');
  const summary = `<summary><span class="library-head"><span class="doc-summary-title">Brand intelligence</span><span class="library-counts">${esc(line)}</span></span><span class="pill ${running ? 'running' : 'ready'}">${running ? 'Research running' : 'Ready'}</span></summary>`;
  const ctx = { hint, now, bad: badPictures, thumbs: brand.thumbs, libraryKinds: libraryKinds instanceof Set ? libraryKinds : new Set() };
  // A refresh of research that already finished keeps the tabs under its checklist; a first run shows the checklist alone.
  let body = running ? intelRunningBody(intel) : '';
  if (!running || intelPlan(intel).rows.length) {
    const tab = INTEL_TABS.some(item => item.id === ui.tab) ? ui.tab : 'plan';
    const panel = tab === 'plan' ? intelPlanPanel(intel, ui)
      : tab === 'own' ? intelOwnPanel(intel, ui, ctx)
        : tab === 'subtopics' ? intelSubtopicsPanel(intel, ui, now)
          : tab === 'competitors' ? intelCompetitorsPanel(intel, ui, ctx)
            : tab === 'viral' ? intelViralPanel(intel, ui, ctx)
              : intelBanksPanel(intel, ctx);
    const fresh = intel.newBrand ? '<p class="intel-note">New on social, so Your winners is empty. The plan uses competitors and niche.</p>' : '';
    body += `${fresh}${intelTabs(slug, name, tab)}<div class="intel-panel" role="tabpanel" id="intel-panel-${esc(slug)}" aria-labelledby="intel-tab-${esc(slug)}-${tab}" tabindex="0" data-intel-panel="${esc(slug)}">${panel}</div>`;
  }
  return `<details class="panel doc-panel brand-intel" data-open-key="brand-intel:${esc(slug)}" data-intel-brand="${esc(slug)}"${open ? ' open' : ''}>${summary}<div class="doc-body">${body}</div></details>`;
}

/**
 * What the Director says on the brand page about this brand's intelligence, as chat messages for `onboardAgentsPanel`: the best post found
 * so far while the research runs, and, once the six subtopics are confirmed, that card as one closed line. While they wait for the person they
 * are a question card (see subtopicsQuestion), so they are not repeated here. Returns {messages, waiting, first}; nothing to say is an empty list.
 */
export function intelDirectorNotes(brand, ui = freshIntelState(), now = Date.now()) {
  const none = { messages: [], waiting: 0, first: '' };
  const intel = intelOf(brand);
  const slug = trimmed(brand?.slug);
  if (!intel || !slug) return none;
  const say = (key, inner) => `<div class="msg-r a" data-intel-note="${key}"><div class="bub">${inner}</div></div>`;
  const messages = [];
  if (intelIsRunning(intel)) {
    const best = intelRecords(intel.own).filter(post => trimmed(post.title)).sort((a, b) => (intelCountOf(b.views) ?? intelCountOf(b.likes) ?? -1) - (intelCountOf(a.views) ?? intelCountOf(a.likes) ?? -1))[0];
    if (best) {
      const numbers = intelCountOf(best.views) !== null ? `, ${intelCount(best.views)} views` : intelCountOf(best.likes) !== null ? `, ${intelCount(best.likes)} likes` : '';
      messages.push(say('best', `<p>Your best post so far: &ldquo;${esc(trimmed(best.title))}&rdquo;${esc(numbers)}.</p>`));
    }
  }
  const subtopics = intelObject(intel.subtopics);
  if (subtopics.status === 'confirmed' && intelList(subtopics.items).length) {
    const at = agentTime(subtopics.confirmedAt);
    const note = [at, 'Every post takes its topic from them.'].filter(Boolean).join(' · ');
    messages.push(`<div class="msg-r a bub-wide room-card" data-intel-note="subtopics-closed"><div class="bub"><div class="q-closed" role="status"><span class="q-tick">${CHECK_ICON}</span><span class="q-closed-title">Six subtopics</span><b class="q-closed-answer">Confirmed</b></div></div><span class="msg-t">${esc(note)}</span></div>`);
  }
  return { messages, waiting: 0, first: '' };
}
// The Director's own messages with the intelligence notes after them.
export function intelAsks(asks, notes) {
  const extra = intelList(notes?.messages);
  if (!extra.length) return asks;
  return { messages: [...intelList(asks?.messages), ...extra], waiting: (asks?.waiting || 0) + (Number.isFinite(notes.waiting) ? notes.waiting : 0), first: asks?.first || trimmed(notes.first) };
}

// @module transport
// Subscribe to the workspace projection and recover from exactly one class of
// failure: a terminal "unavailable" from a dead platform bridge. Per db.d.ts a
// fresh onSnapshot is the only recovery for that code, so clear the dead
// unsubscribe and subscribe once more; any other terminal code (revoked,
// invalid_argument, ...) is reported but never retried.
export function watchWorkspace(transport, handlers = {}) {
  const onSnapshot = typeof handlers.onSnapshot === 'function' ? handlers.onSnapshot : () => {};
  const onError = typeof handlers.onError === 'function' ? handlers.onError : () => {};
  let unsubscribe = null;
  function subscribeOnce() {
    if (typeof transport?.subscribe !== 'function') return;
    unsubscribe = transport.subscribe(
      snapshot => onSnapshot(snapshot),
      error => {
        onError(error);
        if (error?.code === 'unavailable') {
          const previous = unsubscribe;
          if (typeof previous === 'function') previous();
          unsubscribe = null;
          subscribeOnce();
        }
      },
    );
  }
  subscribeOnce();
  return () => { if (typeof unsubscribe === 'function') unsubscribe(); unsubscribe = null; };
}

// The workspace projection is written last in every board sync, so when it changes the page asks once more for what the open
// job shows: the job document and the receipt of every request still out. The live watches stay the first way a change arrives;
// this is the second, for a watch that has gone quiet. Returns true when a job document changed.
export async function refreshLive({ transport, docs, jobIds = [], receipts = [] }) {
  let changed = false;
  if (typeof transport?.readJobDocument === 'function') {
    await Promise.all([...jobIds].map(async jobId => {
      try {
        const next = await transport.readJobDocument(jobId);
        if (JSON.stringify(next ?? null) === JSON.stringify(docs.get(jobId) ?? null)) return;
        if (next) docs.set(jobId, next); else docs.delete(jobId);
        changed = true;
      } catch { /* The live watch stays the way this job document arrives. */ }
    }));
  }
  if (typeof transport?.readRequest === 'function') {
    await Promise.all(receipts.map(async ({ requestId, handle }) => {
      try { const receipt = await transport.readRequest(requestId); if (receipt) handle(receipt); } catch { /* Same: the watch on the receipt remains. */ }
    }));
  }
  return changed;
}

function randomId(host) {
  const randomUUID = host?.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(host.crypto);
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function recordData(saved) {
  if (!saved) return null;
  if (saved.exists === false) return null;
  return typeof saved.data === 'function' ? saved.data() : saved;
}

function workspaceIdOf(snapshot) {
  return snapshot?.workspace?.workspaceId ?? snapshot?.workspaceId ?? null;
}

function emptySnapshot(workspaceId) {
  return {
    schemaVersion: 1,
    workspace: { workspaceId },
    projects: [],
    brands: [],
    connection: { status: 'waiting', message: 'Ask Claude to sync this board.' },
  };
}

function validateWorkspaceSnapshot(snapshot, workspaceId) {
  const actual = workspaceIdOf(snapshot);
  if (!actual || String(actual) !== String(workspaceId)) {
    throw new Error('Wrong workspace. Open the right board.');
  }
  return snapshot;
}

function signalMessage(outcome) {
  return SIGNAL_OUTCOMES[outcome] || NOT_NOTIFIED_MESSAGE;
}

const GATE_COMMENT_NAMES = Object.freeze({
  concept: 'Concept',
  storyboard: 'Storyboard',
  price: 'Price',
  sample: 'Sample',
  pictures: 'Pictures',
  clips: 'Video clips',
  cut: 'Rough cut',
  content: 'Final post',
  publish: 'Posting plan',
  campaign_proposal: 'Campaign plan',
  campaign_activation: 'Going live',
  findings: 'Report',
});
function truncateText(value, max) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}
function quotedTitle(title) {
  const text = truncateText(title, 120);
  return text ? ` for "${text}"` : '';
}
function parseChangeNote(note) {
  const text = String(note || '').trim();
  const match = /^([A-Za-z]\d{1,3}):\s*([\s\S]*)$/.exec(text);
  return match ? { ref: match[1], note: match[2].trim() } : { ref: null, note: text };
}
export function requestComment(operation, args = {}) {
  switch (operation) {
    case 'onboard_brand': {
      const name = args?.name || 'the new brand';
      if (!args?.brand || args.start) return `Start onboarding for ${name}.`;
      return args.kit ? `Brand profile and kit saved for ${name}.` : `Brand profile saved for ${name}.`;
    }
    case 'create_brand':
      return `Create the brand ${truncateText(args?.name, 80) || 'with this name'}.`;
    case 'save_brand_details':
      return args?.kit ? "Save the brand's details and kit." : "Save the brand's details.";
    case 'start_research':
      return 'Start research for this brand.';
    case 'brand_rename':
      return `Rename the brand to ${truncateText(args?.name, 80) || 'this name'}.`;
    case 'create_job': {
      const what = newJobWord(args?.kind);
      return args?.brandName
        ? `New ${what} for ${args.brandName}: "${truncateText(args?.title, 120)}".`
        : `New ${what}: "${truncateText(args?.title, 120)}".`;
    }
    case 'update_intake':
      return `Brief answers saved${quotedTitle(args?.title)}.`;
    case 'attach_product_photo':
      return `${args?.subject === 'character' ? 'Character picture' : 'Product photo'} added${quotedTitle(args?.title)}.`;
    case 'add_reference':
      return `Reference added${quotedTitle(args?.title)}.`;
    case 'remove_reference':
      return `Reference removed${quotedTitle(args?.title)}.`;
    case 'continue_job':
      return args?.title ? `Carry on with "${truncateText(args.title, 120)}".` : 'Carry on with this job.';
    case 'import_inputs':
      return `Source files requested${quotedTitle(args?.title)}.`;
    case 'refresh_board':
      return 'Update the board to the newest version.';
    case 'connectors_continue':
      return 'Connectors done. On to your brand.';
    case 'connect_provider':
      return `Connect ${args?.providerName || 'this connector'}.`;
    case 'choose_recipe':
      return `Copy choices saved${quotedTitle(args?.title)} (${args?.deliverable || 'this post'}).`;
    case 'choose_metricool_brand':
      return `Metricool brand for ${args?.brandName || 'this brand'} set to ${args?.label || 'a different brand'}.`;
    case 'bank_remove':
      return 'Remove an item from the brand library.';
    case 'subtopics_confirm':
      return `Confirm the ${Array.isArray(args?.items) ? `${args.items.length} ` : ''}subtopics for ${args?.brand || 'this brand'}.`;
    case 'plan_cell_start':
      return `Start a post from the 6x5 plan for ${args?.brand || 'this brand'}.`;
    case 'brand_folder_add': {
      const name = trimmed(args?.label) || String(args?.folder || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      return name ? `Add the folder "${truncateText(name, 80)}" to the brand's footage.` : "Add a folder to the brand's footage.";
    }
    case 'brand_folder_pick':
      return "Open a folder picker on my computer.";
    case 'choose_publish_route':
      return `Posts will go out this way: ${PUBLISH_ROUTE_WORDS[args?.route] || 'a different route'}.`;
    case 'choose_post_type':
      return `Post type saved: ${POST_NOUNS[args?.placement] || 'a different one'}.`;
    case 'choose_post_time':
      return `Posting time saved: ${typeof args?.dateTime === 'string' && args.dateTime ? args.dateTime.replace('T', ' ') : 'a different one'}.`;
    case 'resolve_post':
      return args?.answer === 'in_metricool' ? 'This post is in Metricool.' : 'This post is not in Metricool.';
    case 'mark_posted':
      return args?.link ? `Marked a post as posted, with its link.` : 'Marked a post as posted.';
    case 'choose_studio_workspace':
      return `Studio workspace${quotedTitle(args?.title)} set to ${args?.workspaceName || 'a different workspace'}.`;
    case 'agent_message': {
      const who = agentWord(args?.agent) || 'Director';
      return `Message for the ${who}: "${truncateText(args?.text, 80)}".`;
    }
    case 'retry_step':
      return 'Try the stuck step again.';
    case 'handoff_send':
      return 'Send this to Post-production.';
    case 'handoff_decline':
      return 'Finish this one here, without Post-production.';
    case 'handoff_return':
      return 'Bring the final video back from Post-production.';
    case 'answer_question': {
      const choice = truncateText(String(args?.choiceLabel ?? args?.choice ?? ''), 80);
      const typed = truncateText(args?.text, 80);
      const said = choice || (typed ? `"${typed}"` : 'an answer');
      const end = /[.!?]$/.test(said) ? '' : '.';
      const title = truncateText(args?.title, 120);
      return title ? `Answered for "${title}": ${said}${end}` : `Answered: ${said}${end}`;
    }
    case 'submit_decision': {
      const gateName = GATE_COMMENT_NAMES[args?.reviewId] || humanize(args?.reviewId);
      if (args?.decision === 'approve') {
        if (args?.reviewId === 'price') {
          const words = priceWords(args?.totals);
          return words ? `Price approved: ${words}.` : 'Price approved.';
        }
        return `${gateName} approved${quotedTitle(args?.title)}.`;
      }
      const changed = Array.isArray(args?.panels) ? args.panels.filter(entry => entry?.verdict === 'changes') : [];
      if (changed.length) {
        const names = changed.map(entry => `${entry.deliverable ? `${entry.deliverable} ` : ''}${entry.panel}`);
        const which = names.length === 1 ? `panel ${names[0]}` : `panels ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
        const said = changed.length === 1 && changed[0].note ? changed[0].note : args?.note;
        const quote = said ? ` "${truncateText(said, 80)}"` : '';
        return `Changes asked on the ${gateName.toLowerCase()}${quotedTitle(args?.title)} (${which}).${quote}`;
      }
      const { ref, note } = parseChangeNote(args?.note);
      const panel = ref ? ` (panel ${ref})` : '';
      const quote = note ? ` "${truncateText(note, 80)}"` : '';
      return `Changes asked on the ${gateName.toLowerCase()}${quotedTitle(args?.title)}${panel}.${quote}`;
    }
    default:
      return 'A new request was saved on the board.';
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// claude.ai asks each viewer once before a page may message Claude. Asking the moment the board opens keeps that
// prompt out of the middle of a click. permissions is built in (never declared); a "no" just leaves clicks to ask later.
let consentAsked = false;
export async function askBoardConsent(host = globalThis) {
  if (consentAsked) return null;
  consentAsked = true;
  try {
    const perms = await host.claude?.use?.('permissions');
    if (!perms || typeof perms.state !== 'function' || typeof perms.request !== 'function') return null;
    const state = await perms.state('comments');
    if (state !== 'prompt') return state;
    const answer = await perms.request(['comments']);
    return answer?.comments ?? null;
  } catch { return null; }
}

export async function createTransport(config = {}, host = globalThis) {
  const mode = config.mode || 'artifact';
  if (mode !== 'artifact') throw new Error(TXT_OPEN_THIS_BOARD_INSIDE);
  if (!host.claude?.use) throw new Error(TXT_OPEN_THIS_BOARD_INSIDE);
  const workspaceId = String(config.workspaceId || '').trim();
  if (!workspaceId) throw new Error('Setup is missing. Ask Claude to reopen the board.');
  const db = await host.claude.use('db');
  if (!db?.doc) throw new Error('Cannot save right now. Try again from Claude.');
  const workspaceRef = db.doc(ARTIFACT_WORKSPACE_DOC);
  const inFlight = new Map();
  const savedRequestIds = new Set();
  let signalState = { status: 'idle', message: 'Notify Claude to process a saved request.' };
  let forbiddenForVisit = false;
  let viewerId;

  // Who is making requests: the viewer's opaque id on this artifact from the user
  // capability, asked once per visit. null when the page has no identity for them,
  // and the request then carries no `by`.
  async function requesterId() {
    if (viewerId === undefined) {
      try {
        const user = await host.claude.use('user');
        viewerId = typeof user?.id === 'function' ? (await user.id()) || null : null;
      } catch { viewerId = null; }
    }
    return viewerId;
  }

  async function readSnapshot() {
    const saved = await workspaceRef.get();
    const snapshot = recordData(saved);
    return snapshot ? validateWorkspaceSnapshot(snapshot, workspaceId) : emptySnapshot(workspaceId);
  }

  function subscribe(onSnapshot, onError) {
    if (typeof workspaceRef.onSnapshot !== 'function') return () => {};
    const handle = saved => {
      try {
        const snapshot = recordData(saved);
        onSnapshot(snapshot ? validateWorkspaceSnapshot(snapshot, workspaceId) : emptySnapshot(workspaceId));
      } catch (error) {
        onError?.(error);
      }
    };
    const unsubscribe = workspaceRef.onSnapshot(handle, error => onError?.(error));
    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
  }
  // The job's board document (jobDocs/<jobId>): its review, research, strategy
  // and output contents. A document for another workspace or job reads as none.
  function subscribeJobDocument(jobId, onDocument, onError) {
    if (!JOB_DOCUMENT_ID.test(String(jobId || ''))) return () => {};
    const ref = db.doc(`${JOB_DOCUMENT_COLLECTION}/${jobId}`);
    const handle = saved => {
      try {
        const document = recordData(saved);
        onDocument(document && String(document.workspaceId) === workspaceId && document.jobId === jobId ? document : null);
      } catch (error) {
        onError?.(error);
      }
    };
    if (typeof ref.onSnapshot === 'function') {
      const unsubscribe = ref.onSnapshot(handle, error => onError?.(error));
      return typeof unsubscribe === 'function' ? unsubscribe : () => {};
    }
    Promise.resolve().then(() => ref.get()).then(handle, error => onError?.(error));
    return () => {};
  }
  async function readJobDocument(jobId) {
    if (!JOB_DOCUMENT_ID.test(String(jobId || ''))) return null;
    const document = recordData(await db.doc(`${JOB_DOCUMENT_COLLECTION}/${jobId}`).get());
    return document && String(document.workspaceId) === workspaceId && document.jobId === jobId ? document : null;
  }
  async function readRequest(requestId) {
    return recordData(await db.doc(`requests/${requestId}`).get());
  }
  // The decisions already sent for a job, from the requests collection: a query on the job when the database offers one, plus
  // the request ids the page remembered. Only this workspace's own submit_decision requests come back.
  async function findDecisionRequests(jobId, knownIds = []) {
    const found = new Map();
    const take = saved => {
      const request = recordData(saved);
      if (request && request.operation === 'submit_decision' && String(request.workspaceId) === workspaceId && request.args?.jobId === jobId) found.set(request.requestId, request);
    };
    try {
      const query = typeof db.collection === 'function' ? db.collection('requests').where('args.jobId', '==', jobId) : null;
      const snapshot = query ? await query.get() : null;
      if (snapshot) (snapshot.docs || []).forEach(take);
    } catch { /* No query here: the remembered ids below still find it. */ }
    for (const id of knownIds) {
      if (!REQUEST_ID.test(String(id))) continue;
      try { take(await db.doc(`requests/${id}`).get()); } catch { /* Skipped. */ }
    }
    return [...found.values()];
  }
  function subscribeRequest(requestId, onReceipt, onError) {
    const requestRef = db.doc(`requests/${requestId}`);
    if (typeof requestRef.onSnapshot !== 'function') return () => {};
    const handle = saved => {
      try { onReceipt(recordData(saved)); } catch (error) { onError?.(error); }
    };
    const unsubscribe = requestRef.onSnapshot(handle, error => onError?.(error));
    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
  }

  // That the person said a job's planned pipeline is not right is kept in the board's own database, one small record per job,
  // so a reload, another device or another viewer does not offer the button again. It applies to the plan it was said about:
  // a different pipeline or reason (Claude changed the plan) starts clean.
  async function readPlanNote(project) {
    const saved = recordData(await db.doc(`planNotes/${project.jobId}`).get());
    return Boolean(saved) && saved.kind === (project.kind || null) && saved.reason === (project.kindReason || null);
  }
  async function markPlanNote(project) {
    await db.doc(`planNotes/${project.jobId}`).set({ jobId: project.jobId, workspaceId, kind: project.kind || null, reason: project.kindReason || null, at: new Date().toISOString() });
  }

  async function bellLog(reason, outcome, detail, requestId = null) {
    const record = {
      at: new Date().toISOString(),
      reason: String(reason || 'Notify Claude').slice(0, 300),
      outcome,
      detail: detail == null ? null : String(detail).slice(0, 600),
      requestId,
      workspaceId,
    };
    try { await db.doc('meta/bell').set(record); } catch { /* The request remains authoritative. */ }
  }

  // Render-time gate: call this when the Signal control renders (and again
  // whenever it is shown again) and enable it only on "available". A prior
  // "forbidden" rejection from signal() below is permanent for this view, so
  // it keeps reporting "off" without asking again.
  async function checkSignalAvailability() {
    if (forbiddenForVisit) return 'off';
    let comments;
    try { comments = await host.claude.use('comments'); } catch { comments = null; }
    if (!comments || typeof comments.canSendToClaude !== 'function') return 'off';
    try {
      const state = await comments.canSendToClaude();
      return state === 'available' || state === 'writers_only' || state === 'no_session' ? state : 'off';
    } catch {
      return 'unavailable';
    }
  }

  // The action path already checked availability at render time; this call
  // to sendToClaude happens straight away, with no repeat canSendToClaude
  // check and no permissions.request (the first write asks for consent
  // itself, per comments.d.ts). Every rejection is branched on its code and
  // never retried in a loop.
  async function signal(reason = 'Notify Claude', { requestId = null, operation = null, args = null } = {}) {
    signalState = { status: 'sending', message: 'Notifying Claude...' };
    let comments;
    try { comments = await host.claude.use('comments'); } catch { comments = null; }
    if (!comments || typeof comments.sendToClaude !== 'function') {
      signalState = { status: 'unavailable', message: signalMessage('unavailable') };
      await bellLog(reason, 'unavailable', 'comments capability is unavailable', requestId);
      return { status: 'unavailable', message: signalState.message, requestId };
    }
    try {
      const element = host.document?.getElementById?.('app') || host.document?.body;
      const anchor = typeof comments.anchorFor === 'function' ? await comments.anchorFor(element) : null;
      const text = truncateText(
        requestId ? requestComment(operation, args || {}) : reason === 'Notify Claude' ? 'Please check the board for my updates.' : reason,
        300,
      );
      await comments.sendToClaude({ anchor, text });
      signalState = { status: 'sent', message: SIGNAL_OUTCOMES.sent };
      await bellLog(reason, 'sent', null, requestId);
      return { status: 'sent', message: signalState.message, requestId };
    } catch (error) {
      const code = error?.code;
      if (code === 'forbidden') forbiddenForVisit = true;
      const outcome = SIGNAL_ERROR_OUTCOMES[code] || 'unavailable';
      signalState = { status: outcome, message: signalMessage(outcome) };
      await bellLog(reason, outcome, error?.message || code || String(error), requestId);
      return { status: outcome, message: signalState.message, requestId };
    }
  }

  function sameRequest(saved, request) {
    const prior = recordData(saved);
    if (!prior) return false;
    const priorArgs = prior.args || {};
    return prior.operation === request.operation
      && String(prior.requestId || '') === request.requestId
      && String(prior.workspaceId || '') === request.workspaceId
      && stableJson(priorArgs) === stableJson(request.args);
  }

  return {
    mode: 'artifact',
    get signalState() { return signalState; },
    async call(operation, args = {}) {
      if (operation === 'snapshot') return readSnapshot();
      if (typeof operation !== 'string' || !operation.trim()) throw new Error('A board operation is required.');
      const requestId = String(args.requestId || randomId(host));
      if (!REQUEST_ID.test(requestId)) throw new Error('A request ID is required.');
      if (args.workspaceId != null && String(args.workspaceId) !== workspaceId) {
        throw new Error('This request belongs to a different workspace.');
      }
      const requestArgs = { ...args, requestId, workspaceId };
      const active = inFlight.get(requestId);
      if (active) {
        if (active.operation !== operation || stableJson(active.args) !== stableJson(requestArgs)) throw new Error(TXT_REQUEST_ID_WAS_REUSED);
        return active.promise;
      }
      const work = (async () => {
        const by = await requesterId();
        const request = {
          requestId,
          operation,
          args: requestArgs,
          workspaceId,
          source: 'artifact',
          createdAt: new Date().toISOString(),
          status: 'requested',
          ...(by ? { by } : {}),
        };
        const ref = db.doc(`requests/${requestId}`);
        // Only resubmitting a request ID this transport already saved needs a
        // fresh get; a brand-new ID writes straight through with one set.
        if (savedRequestIds.has(requestId)) {
          const existing = await ref.get();
          if (recordData(existing)) {
            if (!sameRequest(existing, request)) throw new Error(TXT_REQUEST_ID_WAS_REUSED);
            const prior = recordData(existing);
            return { status: prior.status || 'requested', requestId, message: prior.message || 'Already saved. Claude will handle it once.' };
          }
        }
        await ref.set(request);
        savedRequestIds.add(requestId);
        const signalled = await signal('Board request saved', { requestId, operation, args: requestArgs });
        const message = signalled.status === 'sent'
          ? 'Saved. Claude has been notified.'
          : NO_SESSION_SIGNAL_OUTCOMES.has(signalled.status)
            ? signalled.message
            : `Request saved. ${signalled.message}`;
        return { status: 'requested', requestId, message, signal: signalled.status };
      })();
      inFlight.set(requestId, { operation, args: requestArgs, promise: work });
      try { return await work; } finally { inFlight.delete(requestId); }
    },
    subscribe,
    subscribeRequest,
    subscribeJobDocument,
    readJobDocument,
    readRequest,
    findDecisionRequests,
    signal,
    checkSignalAvailability,
    readPlanNote,
    markPlanNote,
  };
}

// @module app
if (typeof document !== 'undefined') {
  const config = JSON.parse(document.getElementById('board-config')?.textContent || '{}');
  configurePipelines(config);
  const logoData = String(globalThis.__boardLogo || document.getElementById('board-logo')?.textContent || '').trim();
  const logoSrc = logoData.startsWith('data:image/') ? logoData : '';
  const app = document.getElementById('app');
  let boardUpdatePending = false;
  let transport, data = {projects:[],brands:[]}, error = '', loading = false, drawer = null, drawerTab = 'output', returnFocus = null, unsubscribe = null, inline = null, inlineDrafts = new Map(), starterValues = {}, starterRefs = freshNewJobRefs();
  let signalAvailability = null, signalAvailabilityPending = false;
  let connectorsView = false;
  // Continue was pressed on the setup Connectors step: move on at once, before Claude records it.
  let connectorsContinued = false;
  let viewer = null;
  let returnSelector = null;
  let downloadsApi;
  const openKeys = new Set();
  // A gate section opens by itself the first time it is shown in a state (waiting on the person, say); after that it stays as the person left it.
  const gateSeen = new Set();
  function gateOpen(key, open) { if (!gateSeen.has(key)) { gateSeen.add(key); if (open) openKeys.add(key); } return openKeys.has(key); }
  const connectorPending = new Set();
  // provider -> { at, state, brandCount }: a connect or refresh sent to Claude, shown as waiting until the board shows a change.
  const connectorWaiting = new Map();
  const CONNECTOR_WAIT_MS = 3 * 60 * 1000;
  // A board update asked of Claude: the time it was sent, shown as "Updating board…" until the wait runs out (the republished page replaces this one).
  let boardUpdateSentAt = 0;
  function boardUpdateAvailable() { return data?.board?.outdated === true && data.board.updateWaiting !== true; }
  function boardUpdateWaiting() {
    if (!boardUpdateSentAt) return false;
    if (Date.now() - boardUpdateSentAt > CONNECTOR_WAIT_MS || !boardUpdateAvailable()) { boardUpdateSentAt = 0; return false; }
    return true;
  }
  async function requestBoardUpdate() {
    if (!boardUpdateAvailable() || boardUpdateWaiting() || boardUpdatePending) { await refresh(); return; }
    boardUpdatePending = true;
    render();
    try {
      transport ||= await createTransport(config);
      const result = await transport.call('refresh_board', { requestId: randomId(globalThis) });
      boardUpdateSentAt = Date.now();
      notify(result?.message || TXT_SAVED_CLAUDE_WILL_UPDATE);
    } catch (e) {
      notify(e.message);
    } finally {
      boardUpdatePending = false;
    }
    await refresh();
  }
  function connectorIsWaiting(connector) {
    const sent = connectorWaiting.get(connector.key);
    if (!sent) return false;
    const changed = connector.state !== sent.state || (connector.brandCount ?? null) !== sent.brandCount;
    if (changed || Date.now() - sent.at > CONNECTOR_WAIT_MS) { connectorWaiting.delete(connector.key); return false; }
    return true;
  }
  // The Metricool brand picker on a brand card: which cards have it open, which are saving, and
  // the pick and last error per brand.
  const metricoolUi = { open: new Set(), busy: new Set(), picks: new Map(), errors: new Map() };
  // The Brand library: the items whose removal was sent (kept dimmed until the library no longer lists them), and the last error per item.
  const libraryUi = { removing: new Set(), errors: new Map(), copy: { copied: null, fallback: null, hint: '', timer: null } };
  // Per-job page state: the intake draft and the review choice, comment and
  // request status, kept across re-renders and reset when the job moves on.
  const jobUi = new Map();
  // Job documents read from the artifact database, and whether each has been read yet.
  const jobDocs = new Map();
  const jobDocStates = new Map();
  let jobDocWatch = { jobId: null, unsubscribe: null };
  const jobRequestWatches = new Map();
  const jobRequestReaders = new Map();
  const questionUi = new Map();
  const inboxQuestions = new Map();
  const inboxBriefs = new Map();
  const inboxDocWatches = new Map();
  let pendingJump = null;
  const selectedId = () => routeOf(location.hash).id || '';
  const selected = () => (data.projects || []).find(p => p.jobId === selectedId());
  const current = () => { const project = selected(); return project ? jobView(project, docFor(project)) : undefined; };
  const readyBrands = () => (data.brands || []).filter(brandReady);
  const pill = (state, label) => `<span class="pill ${esc(String(state || 'pending').toLowerCase().split('_')[0])}">${esc(trimmed(label) || humanize(state))}</span>`;
  function notify(message) { document.getElementById('notice').textContent = message; setTimeout(() => { document.getElementById('notice').textContent = ''; }, 6500); }
  const artifactMode = () => transport?.mode === 'artifact';
  function captureInlineValues() {
    if (!inline) return;
    const form = app.querySelector('#inline-form');
    if (!form) return;
    const values = Object.fromEntries(new FormData(form));
    form.querySelectorAll('input[type="checkbox"]').forEach(field => { values[field.name] = field.checked; });
    inline.values = { ...(inline.values || {}), ...values };
    const focused = document.activeElement;
    if (focused && form.contains(focused) && focused.name) {
      inline.focusName = focused.name;
      inline.selectionStart = typeof focused.selectionStart === 'number' ? focused.selectionStart : null;
      inline.selectionEnd = typeof focused.selectionEnd === 'number' ? focused.selectionEnd : null;
    } else {
      // Focus is on a button or outside the form: forget the last field so
      // the next render does not pull focus back to a field left long ago.
      inline.focusName = null;
      inline.selectionStart = null;
      inline.selectionEnd = null;
    }
  }
  function restoreForm(form, values) {
    if (!form || !values) return;
    for (const [name, value] of Object.entries(values)) {
      // Kit controls render from the draft's kit state (kitSection), not
      // from captured form values: restoring them would put a removed row's
      // stale value into the row that took its index, and a file input's
      // value cannot be set at all (assigning it throws InvalidStateError).
      if (name.startsWith('kit_')) continue;
      const field = form.elements.namedItem(name);
      if (!field || field.type === 'file') continue;
      if (field instanceof RadioNodeList) {
        [...field].forEach(item => { item.checked = String(item.value) === String(value); });
      } else if (field.type === 'checkbox') {
        field.checked = value === true || value === 'on' || value === 'true' || value === field.value;
      } else {
        field.value = value;
      }
    }
  }
  function connectorsPanel(forced) {
    const connectors = data.connectors || [];
    const back = forced ? '' : '<div class="toolbar"><button class="quiet" data-action="connectors-close">&larr; Back</button></div>';
    const optional = connectors.some(connector => connector.optional) ? ' Metricool, Meta ads and TikTok ads are optional.' : '';
    const intro = `<p class="muted">Connect the tools Claude uses to make media.${optional}${forced ? ' Press Continue when ready.' : ''}</p>`;
    const busy = connectorPending.size > 0;
    const next = forced ? `<div class="connectors-next"><p class="muted">${connectors.some(connector => connector.state === 'not_connected') ? 'Add the rest later from Connectors.' : 'All set.'}</p><button class="primary" data-action="connectors-continue"${busy ? ' disabled' : ''}>Continue</button></div>` : '';
    return `<div class="slate-head"><h1>Connectors</h1>${back}</div>${intro}<section class="connectors-grid">${connectors.map(connector => connectorCard(connector, { busy: connectorPending.has(connector.key), waiting: connectorIsWaiting(connector) })).join('')}</section>${next}`;
  }
  async function continueConnectors() {
    if (!transport || connectorsContinued) return;
    connectorsContinued = true;
    render();
    try {
      const result = await transport.call('connectors_continue', { requestId: randomId(globalThis) });
      notify(result?.message || 'Saved. On to your brand.');
      await refresh();
    } catch (e) {
      connectorsContinued = false;
      notify(e.message);
      render();
    }
  }
  async function submitConnectorAction(operation, provider) {
    if (!transport || connectorPending.has(provider)) return;
    connectorPending.add(provider);
    render();
    try {
      const current = (data.connectors || []).find(item => item.key === provider);
      const providerName = current?.name;
      const result = await transport.call(operation, {requestId: randomId(globalThis), provider, ...(providerName ? { providerName } : {})});
      if (operation === 'connect_provider') connectorWaiting.set(provider, { at: Date.now(), state: current?.state ?? null, brandCount: current?.brandCount ?? null });
      notify(result?.message || NOTE_SAVED);
      await refresh();
    } catch (e) {
      notify(e.message);
    } finally {
      connectorPending.delete(provider);
      render();
    }
  }
  function topbar(project) {
    const logo = logoSrc ? `<img src="${esc(logoSrc)}" alt="3Echo">` : '<span class="brand-fallback" aria-hidden="true">3E</span>';
    // data.connection.status is the parked Studio sync status: it never reports
    // "ready" for the artifact relay, so freshness reads from the projection's
    // own updatedAt instead (see boardSyncDetail).
    const ready = Boolean(data.updatedAt);
    // The words follow the dot: a board the studio has not written yet says so once, not "Online board" over a grey dot.
    const status = ready ? 'Online board' : 'Waiting for your studio';
    const detail = ready ? boardSyncDetail(data.updatedAt) : '';
    const connectorsLink = Array.isArray(data.connectors) && data.connectors.length && data.setupStep && data.setupStep !== 'connectors'
      ? '<button class="quiet" data-action="connectors">Connectors</button>' : '';
    const route = routeOf(location.hash);
    const groupId = project ? PIPELINE_KINDS[project.kind]?.group || '' : route.page === 'pipeline' ? route.group : '';
    const door = groupId ? pipelineGroupPages(data.projects || []).find(item => item.group === groupId) : null;
    // Back goes up one level: a job to its group's page, a group's page to home. The title names where this page is.
    const back = project ? (door ? { href: `#/pipeline/${encodeURIComponent(door.group)}`, label: door.title } : { href: '#/', label: 'Social Campaign' }) : route.page === 'pipeline' ? { href: '#/', label: 'Social Campaign' } : null;
    const title = project ? trimmed(project.title) || kindNameOf(project.kind) || kindLabelOf(project) : route.page === 'pipeline' ? door?.title || 'Social Campaign' : 'Social Campaign';
    const backLink = back ? `<a class="back" href="${esc(back.href)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>${esc(back.label)}</a>` : '';
    return `<header class="top"><div class="brand">${backLink}<a href="#/" class="brand-logo" aria-label="Social Campaign home">${logo}</a><span class="sep" aria-hidden="true"></span><span class="brand-copy"><strong>${esc(title)}</strong></span></div><div class="header-tools"><span class="connection"><i class="dot ${ready ? 'ready' : ''}"></i><b>${esc(status)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</span><span class="header-actions">${connectorsLink}${boardUpdateAvailable() ? `<button class="header-refresh" data-action="update-board" title="A newer version of the board is installed. Claude will republish it." ${loading || boardUpdatePending || boardUpdateWaiting() ? 'disabled aria-busy="true"' : ''}>${boardUpdatePending || boardUpdateWaiting() ? 'Updating board…' : loading ? 'Refreshing...' : 'Update board'}</button>` : `<button class="header-refresh" data-action="refresh" ${loading ? 'disabled' : ''}>${loading ? 'Refreshing...' : 'Refresh'}</button>`}</span></div></header>`;
  }
  function ensureSignalAvailability() {
    if (!artifactMode() || signalAvailabilityPending || typeof transport?.checkSignalAvailability !== 'function') return;
    signalAvailabilityPending = true;
    transport.checkSignalAvailability().then(state => {
      signalAvailabilityPending = false;
      if (state !== signalAvailability) { signalAvailability = state; render(); }
    }).catch(() => { signalAvailabilityPending = false; });
  }
  function inlineJobForm() {
    inline.values ||= {};
    inline.refs ||= freshNewJobRefs();
    return composerForm(inline, { brands: data.brands || [] });
  }
  function newJobDraft() { return {kind:'new', values:{text:'', links:''}}; }
  function defaultInline() {
    const incomplete = (data.brands || []).find(brand => !brandReady(brand));
    if (incomplete) return onboardDraft(incomplete);
    return readyBrands().length ? newJobDraft() : onboardDraft(null);
  }
  function inlineStart() {
    if (loading && !inline) return '';
    if ((data.projects || []).length && !inline) return '';
    if (!inline) inline = defaultInline();
    if (inline.kind === 'new') return inlineJobForm();
    if (artifactMode()) ensureSignalAvailability();
    adoptBrand(inline, data.brands || []);
    const brand = inline.brand ? (data.brands || []).find(item => item.slug === inline.brand) : null;
    reconcileOnboardDraft(inline, brand);
    const signalInfo = { artifact: artifactMode(), availability: signalAvailability, busy: transport?.signalState?.status === 'sending' };
    return inlineOnboardingForm(brand, inline, signalInfo, { connected: data.metricoolConnected === true, brands: data.metricoolBrands || [] });
  }
  // A job waits on the person when a decision is open or it has something in the Inbox; its card gets the gold ring.
  const jobsWaitingOn = items => new Set((Array.isArray(items) ? items : []).filter(item => item && item.jobId && item.kind !== 'onboarding').map(item => item.jobId));
  const cardWaiting = (project, waitingJobs) => !FINAL_JOB_STATES.includes(project?.state) && jobWaiting(project, waitingJobs);
  function projectCard(project, waiting = false) {
    const brand = project.brand === NO_BRAND ? '' : project.brandName || 'Unassigned brand';
    const { done, total } = stageProgress(project);
    // Opened, credits used and where it lives sit on the job page, under About this job.
    const lines = [['Steps', total ? `${done} of ${total} done` : ''], ['Now', trimmed(project.stageSummary?.current)]].filter(([, value]) => value);
    const activity = agentLineOf(project, { closed: signalAvailability === 'no_session' }) || `<p>${esc(project.nextAction || humanize(project.state))}</p>`;
    // One link to the job, never a button around a heading: the whole card is the link, so Tab and Enter work like a click.
    return `<a class="project-card${waiting ? ' is-waiting' : ''}" href="#/project/${esc(encodeURIComponent(project.jobId))}" style="--h:${hueOf(project.jobId)}"><div class="pc-top card-art"><div class="pc-glass"><span class="pc-kind">${esc(kindLabelOf(project))}</span><h3>${esc(project.title || 'Untitled job')}</h3>${brand ? `<span class="pc-sub">${esc(brand)}</span>` : ''}</div></div><div class="pc-body card-body"><div class="pc-kv">${lines.map(([label, value]) => `<span>${esc(label)}</span><b class="num">${esc(value)}</b>`).join('')}</div>${pill(project.state, project.stateLabel)}</div><div class="pc-act">${activity}</div><div class="pc-dots" aria-hidden="true"></div></a>`;
  }
  // The home page's row for one job: its title and where it is, its state, the faces of the people on it and its six stops as a thin bar. Gold when it waits on the person.
  function jobRow(project, waiting = false) {
    const brand = project.brand === NO_BRAND ? '' : project.brandName || '';
    const bar = jobStopBar(project, waiting);
    const sub = [kindLabelOf(project), brand, bar.text].filter(Boolean).join(' · ');
    const faces = FINAL_JOB_STATES.includes(project.state) ? '' : jobFaces(jobPeople(docFor(project), { closed: signalAvailability === 'no_session' }));
    return `<a class="job-row${waiting ? ' is-waiting' : ''}" href="#/project/${esc(encodeURIComponent(project.jobId))}"><div class="jr-top"><div class="jr-main"><b>${esc(project.title || 'Untitled job')}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div><div class="jr-state">${pill(project.state, project.stateLabel)}</div>${faces}</div><div class="jr-bar">${bar.html || '<span class="job-progress-text">No steps yet</span>'}</div></a>`;
  }
  const projectById = jobId => (data.projects || []).find(project => project.jobId === jobId) || null;
  function viewOf(jobId) {
    const shown = current();
    if (shown?.jobId === jobId) return shown;
    const project = projectById(jobId);
    return project ? jobView(project, docFor(project)) : null;
  }
  function questionState(questionId) {
    const key = String(questionId);
    let state = questionUi.get(key);
    if (!state) { state = {}; questionUi.set(key, state); }
    return state;
  }
  function inboxContext(item, project) {
    if (item.kind === 'question') {
      inboxQuestions.set(String(item.questionId), item);
      return { question: questionUi.get(String(item.questionId)) || {} };
    }
    // The six subtopics: after a tap the card reads "Sent" in every place it is drawn, from the one record of the brand's intelligence page.
    if (item.kind === 'onboarding' && item.state === 'subtopics') return { subtopics: { sent: intelSentPending(intelOf(intelBrand(item.brand)), intelState(item.brand).sent, Date.now()) } };
    const view = project || (item.jobId ? viewOf(item.jobId) : null);
    if (!view) return {};
    if (item.kind === 'brief') inboxBriefs.set(view.jobId, [...(inboxBriefs.get(view.jobId) || []), item]);
    const ui = uiFor(view);
    const watched = inboxDocWatches.has(view.jobId) || jobDocWatch.jobId === view.jobId;
    const docState = jobDocStates.get(view.jobId) || (watched ? 'loading' : 'loaded');
    return { project: view, doc: docFor(view), docState, review: ui.review, intake: ui.intake, ...(isHandoffItem(item) ? { handoff: agentBoxState(view).handoff } : {}) };
  }
  function inboxAside(inbox, { project = null, workspace = false, starter = '', bare = false, strip = false } = {}) {
    inboxQuestions.clear();
    inboxBriefs.clear();
    return inboxPanel({ ...inbox, workspace, starter, bare, strip, signal: signalInfo(), context: item => inboxContext(item, project) });
  }
  function syncInboxDocuments(jobIds = []) {
    const wanted = artifactMode() && typeof transport?.subscribeJobDocument === 'function' ? new Set(jobIds) : new Set();
    for (const [jobId, stop] of inboxDocWatches) {
      if (wanted.has(jobId)) continue;
      if (typeof stop === 'function') stop();
      inboxDocWatches.delete(jobId);
    }
    for (const jobId of wanted) {
      if (inboxDocWatches.has(jobId) || (jobDocWatch.jobId === jobId && jobDocWatch.unsubscribe)) continue;
      if (!jobDocStates.has(jobId)) jobDocStates.set(jobId, 'loading');
      inboxDocWatches.set(jobId, transport.subscribeJobDocument(jobId, doc => {
        if (doc) jobDocs.set(jobId, doc); else jobDocs.delete(jobId);
        jobDocStates.set(jobId, 'loaded');
        queueMicrotask(render);
      }, () => {
        // A watch that ended is dropped, so the next render subscribes this job again.
        inboxDocWatches.delete(jobId);
        jobDocStates.set(jobId, 'loaded');
        queueMicrotask(render);
      }));
    }
  }
  function uiFor(project) {
    let ui = jobUi.get(project.jobId);
    if (!ui) {
      ui = { revision: project.revision, intake: { values: {} }, review: { choice: null, comment: '', commentOpen: false }, recipe: {}, recipeStatus: {}, workspace: {}, route: {}, posts: {} };
      jobUi.set(project.jobId, ui);
    }
    if (ui.revision !== project.revision) {
      // The job moved on: keep what the person typed, drop every request status.
      ui.revision = project.revision;
      ui.intake = { values: ui.intake.values || {} };
      // A decision already sent stays sent (with its receipt watch) across the new revision; it lets go below, once the review
      // shown is a different one, or when its receipt ends.
      if (!((ui.review.submitted && ui.review.requestId && ui.review.args) || (ui.review.settled && ui.review.args))) {
        // The opening lines the person wrote or edited are kept with their note (scopeReviewState drops them with it when the files change).
        // So are the options they added to a strategy row and the box they are typing in; which option is picked starts over, as the opening line picked does.
        ui.review = { choice: null, comment: ui.review.comment || '', commentOpen: false, panelDraft: ui.review.panelDraft || '', draftKey: ui.review.draftKey, ...(ui.review.ownLines ? { ownLines: ui.review.ownLines } : {}), ...(ui.review.editedLines ? { editedLines: ui.review.editedLines } : {}), ...(ui.review.hookEdit ? { hookEdit: ui.review.hookEdit } : {}), ...(ui.review.strategyOwn ? { strategyOwn: ui.review.strategyOwn } : {}), ...(ui.review.strategyEdit ? { strategyEdit: ui.review.strategyEdit } : {}) };
        stopJobRequestWatch(project.jobId + ':review');
      }
      ui.recipe = {};
      ui.recipeStatus = {};
      ui.workspace = {};
      stopJobRequestWatch(project.jobId + ':intake');
      stopJobRequestWatch(project.jobId + ':workspace');
      // A route choice stays pending across the new revision until the plan on the board shows it; so does a post's own
      // answer or mark, until the status list or the kit shows it.
    }
    if (ui.review.args && (ui.review.requestId || ui.review.settled) && pendingReview(project) && !decisionMatchesReview(project, ui.review.args)) {
      forgetSentDecision(project.jobId);
      ui.review = { choice: null, comment: '', commentOpen: false, panelDraft: '' };
      stopJobRequestWatch(project.jobId + ':review');
    }
    // A note typed on one review never follows the person to another.
    ui.review = scopeReviewState(ui.review, project);
    return ui;
  }
  function docFor(project) {
    if (!project) return null;
    const doc = jobDocs.get(project.jobId);
    return doc && doc.jobId === project.jobId ? doc : null;
  }
  // Whether the person has already said this job's plan is not right: read once per job and plan, kept for this visit.
  const planNotes = new Map();
  function planNoteSent(project) {
    return planNotes.get(project.jobId)?.sent === true;
  }
  function ensurePlanNote(project) {
    if (!artifactMode() || typeof transport?.readPlanNote !== 'function' || !project.kindReason) return;
    const key = `${project.kind}|${project.kindReason}`;
    if (planNotes.get(project.jobId)?.key === key) return;
    planNotes.set(project.jobId, { key, sent: false });
    transport.readPlanNote(project).then(found => {
      if (!found) return;
      const known = planNotes.get(project.jobId);
      if (known?.key === key) { known.sent = true; render(); }
    }).catch(() => { /* Without the record the button simply shows. */ });
  }
  function ensureJobDocument(project) {
    if (!artifactMode() || typeof transport?.subscribeJobDocument !== 'function') return;
    if (jobDocWatch.jobId === project.jobId && jobDocWatch.unsubscribe) return;
    jobDocWatch.unsubscribe?.();
    const jobId = project.jobId;
    if (!jobDocStates.has(jobId)) jobDocStates.set(jobId, 'loading');
    jobDocWatch = { jobId, unsubscribe: null };
    jobDocWatch.unsubscribe = transport.subscribeJobDocument(jobId, doc => {
      if (doc) jobDocs.set(jobId, doc); else jobDocs.delete(jobId);
      jobDocStates.set(jobId, 'loaded');
      queueMicrotask(render);
    }, () => {
      jobDocStates.set(jobId, 'loaded');
      if (jobDocWatch.jobId === jobId) jobDocWatch = { jobId: null, unsubscribe: null };
      queueMicrotask(render);
    });
  }
  // A route request's watch only has the job id and the state; the state is the job's route state. A route that Claude
  // applied stays pending until the plan shows it (the plan drops it); a decline or a failure ends it here.
  function routeApplied(state) {
    clearTimeout(state.reminderTimer);
    Object.assign(state, { applied: true, requestId: state.sentRequestId, submittedAt: state.sentAt });
    scheduleReminderWake(state);
  }
  function routeEnded(jobId, state, field, text) {
    dropRoute(jobId, state);
    state[field] = text;
    state.shownRoute = jobDocs.get(jobId)?.review?.publish?.route ?? null;
  }
  // A post's own request (an answer, or Mark as posted) is followed the same way, one watch per post. What the person
  // typed and the copy feedback belong to the post, not to the request, so ending a request keeps them.
  function dropPost(jobId, postId, state) {
    clearTimeout(state.reminderTimer);
    Object.assign(state, { pending: null, kind: undefined, busy: false, submitted: false, applied: false, requestId: null, sentRequestId: null, sentAt: null, submittedAt: null, lastReminderAt: null, reminding: false, reminderTimer: null, operation: null, args: null });
    stopJobRequestWatch(jobId + ':post:' + postId);
  }
  function postEnded(jobId, postId, state, field, text) {
    const kind = state.kind;
    dropPost(jobId, postId, state);
    state[field] = text;
    state.endedKind = kind;
  }
  // Whether a request on the posting card is out: a route choice, or a post type or posting time of any post. The card holds every
  // control while one is, so a second one never starts behind it.
  function cardBusy(project, except = null) {
    const ui = uiFor(project);
    if (ui.route?.pending) return true;
    return Object.entries(ui.posts || {}).some(([id, state]) => id !== except && state?.pending && (state.kind === 'type' || state.kind === 'time'));
  }
  function stopJobRequestWatch(key) {
    const unsubscribe = jobRequestWatches.get(key);
    if (typeof unsubscribe === 'function') unsubscribe();
    jobRequestWatches.delete(key);
    jobRequestReaders.delete(key);
  }
  // A sent decision is remembered by its request id (the request itself lives in the requests collection), so a reload finds
  // it again. The id is only a pointer; the request's own status decides whether the card still shows it as sent.
  const SENT_DECISIONS_KEY = 'socialCampaign.sentDecisions';
  function sentDecisionIds() {
    try { const found = JSON.parse(globalThis.localStorage?.getItem(SENT_DECISIONS_KEY) || '{}'); return found && typeof found === 'object' ? found : {}; } catch { return {}; }
  }
  function rememberSentDecision(jobId, requestId) {
    try { globalThis.localStorage?.setItem(SENT_DECISIONS_KEY, JSON.stringify({ ...sentDecisionIds(), [jobId]: requestId })); } catch { /* The requests collection is still the record. */ }
  }
  function forgetSentDecision(jobId) {
    try { const all = sentDecisionIds(); delete all[jobId]; globalThis.localStorage?.setItem(SENT_DECISIONS_KEY, JSON.stringify(all)); } catch { /* Same. */ }
  }
  const sentDecisionReads = new Map();
  function ensureSentDecision(project) {
    const review = pendingReview(project);
    if (!review || !artifactMode() || typeof transport?.findDecisionRequests !== 'function') return;
    const files = (review.artifacts || []).map(file => `${file.path}|${file.sha256 || ''}`).join(',');
    const key = `${project.jobId}|${review.reviewId || review.gate}|${files}`;
    if (sentDecisionReads.get(project.jobId) === key) return;
    sentDecisionReads.set(project.jobId, key);
    const hint = sentDecisionIds()[project.jobId];
    transport.findDecisionRequests(project.jobId, hint ? [hint] : []).then(found => {
      // After a reload: a decision already applied on these same files, or declined as a repeat, settles the card it left showing.
      const settled = (found || []).filter(request => settlesReview(project, request)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
      if (settled) {
        const ui = uiFor(project);
        if (!ui.review.busy && !ui.review.submitted) {
          Object.assign(ui.review, { settled: true, busy: false, submitted: false, declined: false, args: settled.args, requestId: null, message: String(settled.artifactReceipt?.status || settled.status) === 'declined' ? (settled.artifactReceipt?.message || settled.message || '') : '' });
          render();
        }
        return;
      }
      const mine = (found || []).filter(request => request && request.operation === 'submit_decision' && !request.status?.match?.(/^(applied|declined|failed|error|rejected|needs_reconciliation)$/) && decisionMatchesReview(project, request.args));
      const request = mine.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
      const ui = uiFor(project);
      if (!request || ui.review.busy || ui.review.submitted) return;
      Object.assign(ui.review, { requestId: request.requestId, busy: false, submitted: true, verdict: request.args.decision === 'request_changes' ? 'request_changes' : 'approve', submittedAt: Date.parse(request.createdAt || '') || Date.now(), operation: 'submit_decision', args: request.args, error: '', declined: false, receivedFor: String(request.artifactReceipt?.status || request.status) === 'received' ? request.requestId : null });
      watchJobRequest(project.jobId, 'review', ui.review);
      render();
    }).catch(() => { /* Without the record the buttons simply show. */ });
  }
  // Follow a job-page request (intake answers or a decision) to its receipt.
  function watchJobRequest(jobId, part, state) {
    const key = jobId + ':' + part;
    stopJobRequestWatch(key);
    if (!transport?.subscribeRequest || !state.requestId) return;
    const requestId = state.requestId;
    const handle = receipt => {
      if (!receipt || state.requestId !== requestId) return;
      const acknowledgement = receipt.artifactReceipt || receipt;
      const status = String(acknowledgement.status || receipt.status || 'requested');
      if (part === 'review' && status !== 'requested' && status !== 'sent' && status !== 'received') forgetSentDecision(jobId);
      if (part === 'review' && ['needs_reconciliation', 'error', 'failed', 'rejected'].includes(status)) {
        // A decision that failed can be made again: the card shows the reason and the buttons come back.
        stopJobRequestWatch(key);
        const said = acknowledgement.message || receipt.message || 'Claude could not apply this. Try again.';
        const changed = changedRefusal(said);
        Object.assign(state, { busy: false, submitted: false, needsReconciliation: false, requestId: null, args: null, operation: null, error: changed ? CHANGED_LINE : said, submittedAt: null, lastReminderAt: null, reminding: false });
        render();
        if (changed) { void resyncLive(); void refresh(); }
      } else if (status === 'received') {
        // Claude picked the request up: the card stays submitted and only its line changes.
        if (state.receivedFor !== requestId) { state.receivedFor = requestId; render(); }
      } else if (status === 'applied') {
        stopJobRequestWatch(key);
        // An applied decision keeps its card settled until the job document catches up and stops listing the review.
        const keep = part === 'review' && state.args ? { settled: true, args: state.args } : { args: null };
        Object.assign(state, { busy: false, submitted: false, needsReconciliation: false, requestId: null, error: '', message: '', submittedAt: null, lastReminderAt: null, reminding: false, operation: null, ...keep, ...(part === 'answer' ? { answered: true, closedNote: trimmed(acknowledgement.result?.message), savedAnswer: trimmed(acknowledgement.result?.answer) } : {}), ...(part === 'retry' ? { applied: true } : {}) });
        if (part === 'route' || part.startsWith('post:')) routeApplied(state);
        notify(part.startsWith('post:') ? 'Claude saved this.' : part === 'intake' ? 'Claude saved your answers.' : part === 'workspace' ? 'Claude saved the workspace choice.' : part === 'route' ? 'Claude saved how these posts go out.' : part === 'answer' ? trimmed(acknowledgement.result?.message) || NOTE_HAS_ANSWER : part === 'agent-msg' ? 'Claude passed your message on.' : part === 'retry' ? 'The Director is trying that step again.' : 'Claude applied your decision.');
        void refresh();
      } else if (status === 'declined') {
        stopJobRequestWatch(key);
        // Declined because it repeats a decision already made: the card is settled, not re-armed.
        const handled = part === 'review' && state.args && Boolean(receipt.handled || acknowledgement.handled);
        // Declined because the card was no longer the latest: say it in the plain line, then load the latest card.
        const said = acknowledgement.message || receipt.message || NOTE_DECLINED;
        const changed = part === 'review' && changedRefusal(said);
        Object.assign(state, { busy: false, submitted: false, needsReconciliation: false, requestId: null, error: '', declined: true, message: changed ? CHANGED_LINE : said, submittedAt: null, lastReminderAt: null, reminding: false, operation: null, args: handled ? state.args : null, ...(handled ? { settled: true } : {}) });
        if (part === 'route') routeEnded(jobId, state, 'notice', state.message);
        else if (part.startsWith('post:')) postEnded(jobId, part.slice(5), state, 'notice', state.message);
        render();
        if (changed) { void resyncLive(); void refresh(); }
      } else if (['needs_reconciliation', 'error', 'failed', 'rejected'].includes(status)) {
        Object.assign(state, { busy: false, submitted: false, needsReconciliation: true, error: acknowledgement.message || receipt.message || 'Could not apply this. Claude must check first.', submittedAt: null, lastReminderAt: null, reminding: false });
        if (part === 'route') routeEnded(jobId, state, 'error', state.error);
        else if (part.startsWith('post:')) postEnded(jobId, part.slice(5), state, 'error', state.error);
        render();
      }
    };
    jobRequestWatches.set(key, transport.subscribeRequest(requestId, handle, () => {}));
    jobRequestReaders.set(key, { requestId, handle });
  }
  // Ask again for what the open page shows (see refreshLive); runs after every workspace snapshot, one at a time.
  let resyncing = false, resyncAgain = false;
  async function resyncLive() {
    if (!artifactMode()) return;
    if (resyncing) { resyncAgain = true; return; }
    resyncing = true;
    try {
      const jobIds = new Set(inboxDocWatches.keys());
      const shown = selected();
      if (shown) jobIds.add(shown.jobId);
      if (await refreshLive({ transport, docs: jobDocs, jobIds, receipts: [...jobRequestReaders.values()] })) {
        for (const jobId of jobIds) jobDocStates.set(jobId, 'loaded');
        render();
      }
    } finally {
      resyncing = false;
      if (resyncAgain) { resyncAgain = false; void resyncLive(); }
    }
  }
  function ensureDownloads() {
    if (downloadsApi !== undefined || !artifactMode() || typeof globalThis.claude?.use !== 'function') return;
    downloadsApi = null;
    Promise.resolve().then(() => globalThis.claude.use('downloads')).then(api => {
      downloadsApi = api && typeof api.save === 'function' ? api : null;
      if (downloadsApi) render();
    }, () => { downloadsApi = null; });
  }
  function downloadView(ui) {
    ensureDownloads();
    const state = ui.download || {};
    if (downloadsApi) return { busy: Boolean(state.busy), note: state.note || '' };
    return state.note ? { available: false, note: state.note } : null;
  }
  async function saveReport(format) {
    const project = current();
    const doc = docFor(project);
    if (!project || !doc?.report || !downloadsApi) return;
    const ui = uiFor(project);
    const state = (ui.download ||= {});
    if (state.busy) return;
    const file = format === 'html' ? reportHtmlFile(doc.report, project.title) : reportMarkdownFile(doc.report, project.title);
    Object.assign(state, { busy: true, note: '' });
    render();
    try {
      await downloadsApi.save({ filename: file.filename, data: file.data });
    } catch (e) {
      const outcome = downloadOutcome(e?.code);
      state.note = outcome.note;
      if (outcome.unavailable) downloadsApi = null;
    } finally {
      state.busy = false;
      render();
      if (downloadsApi) focusQuietly(`[data-report-download="${format}"]`);
    }
  }
  function signalInfo() {
    if (artifactMode()) ensureSignalAvailability();
    return { artifact: artifactMode(), availability: signalAvailability, busy: transport?.signalState?.status === 'sending' };
  }
  function legacyBlockers(project) {
    const blockers = [...new Set((project.blockers || []).map(intakeLabel))];
    return blockers.length ? `<section class="panel intake"><div class="section-head"><h2>Finish the brief</h2></div><div class="intake-other"><span class="intake-label-text">Still needed</span><ul>${blockers.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div></section>` : '';
  }
  function details(project) {
    ensureJobDocument(project);
    ensurePlanNote(project);
    ensureSentDecision(project);
    syncInboxDocuments();
    const ui = uiFor(project);
    const doc = docFor(project);
    const docState = jobDocStates.get(project.jobId) || 'loading';
    const brandLabel = project.brandName || 'Unassigned brand';
    const nextLine = project.nextAction || humanize(project.state);
    const railParts = stepRailParts(project, doc);
    const subtitle = [brandLabel, railParts?.here || trimmed(project.stageSummary?.current)].filter(Boolean).join(' · ');
    const closedNow = signalAvailability === 'no_session';
    let waitsNow = false;
    const headOf = line => `<div class="page-head" style="--h:${hueOf(project.jobId)}"><div class="job-head-main"><span class="job-mark" aria-hidden="true"></span><div class="job-head-copy"><h1>${esc(project.title || 'Untitled job')}</h1><p class="job-sub">${esc(subtitle)}</p>${plannedAsLine(project, { sent: planNoteSent(project) })}${line ? `<div class="job-line">${shortLine(line)}</div>` : ''}</div></div><div class="job-head-chips"><span class="kind-chip">${esc(kindLabelOf(project))}</span>${pill(project.state, project.stateLabel)}${handoffStatusLine(project) ? `<span class="kind-chip handoff-chip">${esc(handoffStatusLine(project))}</span>` : ''}</div>${jobStopsBar(project, { waiting: waitsNow, closed: closedNow })}</div>`;
    const head = headOf(nextLine);
    if (project.detailsLoaded === false) return `${head}<div class="layout"><div><section class="panel intake">${jobLoadingLine(docState)}</section></div></div>`;
    const intakePanel = project.intake !== undefined ? intakeForm(project, ui.intake, signalInfo()) : legacyBlockers(project);
    const downloads = downloadView(ui);
    const shown = doc?.review?.publish;
    if (ui.route && shown) {
      // The plan moved off the route it had when the choice was made (the choice landed, or someone changed it in chat):
      // the pending choice is over, and a message about an earlier try goes with it.
      if (ui.route.pending && shown.route !== ui.route.fromRoute) dropRoute(project.jobId, ui.route);
      if ((ui.route.error || ui.route.notice) && ui.route.shownRoute !== undefined && shown.route !== ui.route.shownRoute) Object.assign(ui.route, { error: '', notice: '', shownRoute: undefined });
    }
    const pendingGate = pendingReview(project)?.gate || pendingReview(project)?.reviewId || null;
    const sent = Array.isArray(doc?.publishStatus?.posts) && doc.publishStatus.posts.length ? doc.publishStatus : null;
    // A post's answer or mark that the board now shows is no longer pending.
    for (const [postId, state] of Object.entries(ui.posts || {})) {
      if (!state.pending) continue;
      const row = (sent?.posts || []).find(item => item?.id === postId);
      const kitRow = (doc?.postingKit?.posts || []).find(item => item?.id === postId);
      // A post type the plan now shows (the post has none to choose any more) is no longer pending.
      const planPost = (doc?.review?.publish?.posts || []).find(item => item?.id === postId);
      const typeShown = state.kind === 'type' && Boolean(doc?.review?.publish) && !(planPost?.typeChoices?.length);
      // A posting time the plan now shows differently (the plan moved off the time it had when the choice was made) is no longer pending.
      const timeShown = state.kind === 'time' && Boolean(doc?.review?.publish) && timeSignature(doc.review.publish, postId) !== state.fromTime;
      if ((state.kind === 'resolve' && row && row.status !== 'needs_check') || (state.kind === 'mark' && kitRow?.marked) || typeShown || timeShown) {
        dropPost(project.jobId, postId, state);
        if (timeShown) Object.assign(state, { timeOpen: false, timePick: '', timeError: '' });
      }
    }
    // Once something was sent the plan is frozen, so the status list stands where the posting decision was.
    const review = sent && pendingGate === 'publish' ? '' : reviewPanel(project, doc, ui.review, { docState, signal: signalInfo(), recipeState: ui.recipe, workspaceState: ui.workspace, routeState: ui.route, postStates: ui.posts, openKeys, downloads, metricool: planMetricool(project) });
    const sentPanel = publishStatusPanel(sent, ui.posts, { signal: signalInfo() });
    const kitPanel = postingKitPanel(doc?.postingKit, ui.posts, { signal: signalInfo(), jobId: project.jobId, openKeys, platform: typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent, touch: Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches) });
    const report = pendingGate === 'findings' ? '' : reportPanel(doc, { downloads, jobTitle: project.title });
    const reportJob = isReportJob(project);
    const recipeStandalone = doc && pendingGate !== 'concept' ? recipePanel(doc, ui.recipe, ui.recipeStatus) : '';
    let storyboard = pendingGate === 'sample' || pendingGate === 'storyboard' || MEDIA_GATE_IDS.has(pendingGate) ? '' : storyboardPanel(doc);
    const omitted = project.artifactsOmitted || 0;
    const omittedLine = omitted ? `<p class="muted">${esc(`${omitted} more ${omitted === 1 ? 'file is' : 'files are'} on your computer.`)}</p>` : '';
    // The Inbox and the chats replace the Inbox panel, the Director card and the agent rail. A job document with no agents
    // section still gets a Director to open, and keeps its files in the old Outputs list so nothing becomes unreachable.
    const agentBox = agentBoxOf(doc, { closed: signalAvailability === 'no_session' });
    const boxUi = agentBoxState(project);
    const stub = { id: 'producer', name: 'Director', state: null };
    const box = agentBox || { all: [stub], director: stub, others: [], unassigned: {} };
    const now = Date.now();
    const chipContext = { artifacts: project.artifacts || [], doc };
    const fromKey = new Map((Array.isArray(agentBox?.director?.needs) ? agentBox.director.needs : []).filter(need => need && typeof need === 'object' && need.key && need.from).map(need => [need.key, agentNameOf((agentBox?.all || []).find(item => item.id === need.from) || { id: need.from })]));
    const inboxView = jobInbox(project, doc);
    const needItems = fromKey.size ? inboxView.items.map(item => (item.fromName || item.from || !fromKey.has(inboxKey(item)) ? item : { ...item, fromName: fromKey.get(inboxKey(item)) })) : inboxView.items;
    const openNeeds = needItems.filter(item => !item.closing);
    const chatAgent = boxUi.chat ? box.all.find(item => item.id === boxUi.chat) || null : null;
    if (boxUi.chat && !chatAgent) boxUi.chat = null;
    // Who is on a step card, and how they look: from the agents of this job.
    const who = id => { const agent = box.all.find(item => item.id === id); if (!agent) return null; const view = agentView(agent); return { name: agentNameOf(agent), mood: view.mood, called: view.called, agent }; };
    // What opens inside each gate section: the review for the gate waiting on the person, and what belongs to a gate once it is past.
    const bodies = {};
    if (pendingGate && review) bodies[pendingGate] = { html: review, open: true };
    const extra = (gate, html, open = false) => { if (!html) return; bodies[gate] = { html: (bodies[gate]?.html || '') + html, open: Boolean(bodies[gate]?.open) || open }; };
    extra('publish', sentPanel + kitPanel, true);
    extra('findings', report, true);
    // Once the storyboard is approved and a done step (the Shot plan) keeps it readable, the approval row holds only the decision:
    // the panels are shown once, inside that step.
    const stages = stageItems(project, { pendingGate });
    if (storyboard && storyboardKeptByStep(stages, who, doc)) storyboard = '';
    extra('storyboard', storyboard);
    const openQuestions = needItems.filter(item => item.kind === 'question' && !item.closing);
    // A card the Director raised for a person's thread is drawn in that thread while it is open, not above the steps as well.
    const threadCards = chatAgent && !isDirectorAgent(chatAgent) ? cardsForThread(openQuestions, chatAgent) : [];
    const stageAsking = stageQuestions(openQuestions.filter(item => !threadCards.includes(item)), { stateOf: item => questionState(item.questionId), signal: signalInfo() });
    // What the job waits on (its review, or the posts that went out) is drawn inside the step it belongs to, and the Director's open questions
    // inside the step waiting on the person; the Director's chat holds a pointer to the card and the questions themselves while it is open.
    const inDirectorChat = Boolean(chatAgent && isDirectorAgent(chatAgent));
    const card = pendingGate ? bodies[pendingGate]?.html || '' : '';
    const flow = stageFlow(stages, { jobId: project.jobId, who, bodies, isOpen: gateOpen, chipContext, ask: box.director?.id || 'producer', closed: closedNow, asking: inDirectorChat ? '' : stageAsking, lift: narrowWidth() });
    // A card no step could hold (the job has no steps yet) and a card lifted out of a folded step on a phone come first.
    const cardAbove = flow.lifted || (card && !flow.placed.has(pendingGate) ? card : '');
    const left = (gate, html) => (gate === pendingGate || flow.placed.has(gate) ? '' : html);
    const standalone = left('publish', sentPanel + kitPanel) + left('findings', report) + left('storyboard', storyboard) + recipeStandalone;
    const filesPanel = agentBox
      ? `<details class="panel doc-panel" data-open-key="more:files"${openKeys.has('more:files') ? ' open' : ''}><summary><span class="doc-summary-title">Outputs and files</span></summary><div class="doc-body">${agentFilesBody(agentBox, { chipContext, jobId: project.jobId, openKeys, omitted })}</div></details>`
      : `<details class="panel doc-panel" data-open-key="more:files"${openKeys.has('more:files') ? ' open' : ''}><summary><span class="doc-summary-title">Outputs and files</span></summary><div class="doc-body"><div class="section-head"><span></span><button class="quiet" data-action="source">Add source files</button></div>${outputsList(project.artifacts || [], doc, openKeys, reportJob ? { empty: 'The report will appear here.' } : {})}${omittedLine}</div></details>`;
    const asking = needItems.filter(item => item.kind === 'question' && item.wantsUpload && !item.closing && !item.inChat && !questionState(item.questionId).answered);
    if (ui.refs) pruneRemoving(ui.refs, project.references || []);
    const referencesBox = referencesPanel(project, ui.refs || {}, { openKeys, asking, uploadState: item => questionState(item.questionId).upload, brandFiles: (data.brands || []).find(item => item.slug === project.brand)?.brandFiles || [] });
    // What the job has used is credits, never tokens or hours; they sit in About this job.
    const aboutRows = [['Brand', project.brand === NO_BRAND ? '' : brandLabel], ['Kind of job', kindLabelOf(project)], ['Opened', openedWord(project.usage?.startedAt)], ['Where', project.ownershipStatus === 'unbound' ? 'Local draft' : ''], ...jobCreditRows(project)].filter(([, value]) => value);
    const aboutPanel = `<details class="panel doc-panel" data-open-key="more:about"${openKeys.has('more:about') ? ' open' : ''}><summary><span class="doc-summary-title">About this job</span></summary><div class="doc-body"><dl class="about-list">${aboutRows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></div></details>`;
    // The right column: the Team, or the chat with one person.
    const tasksOf = id => (project.stages || []).flatMap(stage => (Array.isArray(stage?.tasks) ? stage.tasks : [])).filter(task => planWord(task?.agent) === id).map(task => ({ name: trimmed(task.name) || 'Step', line: trimmed(task.line), status: STEP_STATUSES.has(task.status) ? task.status : 'pending', outputs: Array.isArray(task.outputs) ? task.outputs : [], startedAt: trimmed(task.startedAt), doneAt: trimmed(task.doneAt) }));
    const decision = pendingGate ? needItems.find(item => item.kind === 'decision' && item.gate === pendingGate) : null;
    let side;
    const top = needItems[0] || null;
    if (chatAgent) {
      markRepliesSeen(chatAgent);
      const director = isDirectorAgent(chatAgent);
      const steps = tasksOf(chatAgent.id);
      const todo = steps.find(step => step.status !== 'done') || steps.at(-1);
      // The decision the card above holds is not drawn a second time here: the chat has its one plain pointer to it (the waiting card below).
      const chatNeeds = needItems.filter(item => !(card && item.kind === 'decision' && item.gate === pendingGate));
      const shownNeeds = director ? chatNeeds : threadCards;
      const needs = shownNeeds.length ? inboxAside({ ...inboxView, items: shownNeeds }, { project, bare: true }) : '';
      // One voice: the decision card is the Director's. The agent that wrote the work behind the gate shows a plain "handed over" line.
      const waiting = chatDecisionCard(chatAgent, decision, pendingGate);
      const handed = agentHandedLine(chatAgent);
      side = agentChat(chatAgent, {
        now, tasks: steps, chipContext, needs, openKeys, jobId: project.jobId,
        feed: roomFeed(roomOf(doc), chatAgent.id, { agents: box.all, chipContext, liveKeys: new Set(needItems.filter(item => !item.closing).map(inboxKey)) }),
        feedWork: roomRowsFor(roomOf(doc), chatAgent.id).some(row => row.k === 'msg' && !row.reply),
        status: director ? handoffStatusLine(project) : handed,
        stuck: director ? agentStuckBanner(agentBox?.director?.stuck, boxUi.retry, signalInfo(), project) : '',
        item: waiting ? { gate: pendingGate, jobId: project.jobId, title: GATE_TITLES[pendingGate] || humanize(pendingGate), line: trimmed(decision.summary) } : null,
        compose: agentBox ? agentComposer(chatAgent, { about: director ? 'the job' : todo?.name || 'its work', ui: boxUi, signal: signalInfo() }) : '',
      });
    } else {
      side = agentInbox(box.all, { needText: railParts && top ? (top.kind === 'decision' && GATE_TITLES[top.gate]) || railParts.need : '', questions: openNeeds.filter(item => item.kind === 'question').length, waitingOnYou: openNeeds.length });
    }
    // The thread's cards (inboxAside above) and a page opened straight from a link register only their own; every open question here answers.
    for (const item of openQuestions) inboxQuestions.set(String(item.questionId), item);
    // Above the steps: the brief form, a card no step could hold, questions no step could hold, and the offer to send the video on. The steps
    // are the page's middle column, always drawn; what waits on the person sits inside them.
    const lead = intakePanel + cardAbove + (inDirectorChat ? '' : (flow.asked ? '' : stageAsking) + (railParts ? inboxNeed(railParts, project.jobId, top, boxUi.handoff) : ''));
    waitsNow = Boolean(pendingGate) || openNeeds.length > 0;
    return `${headOf(railParts?.need === nextLine ? '' : nextLine)}${brandDriftNotice(project)}<div class="studio${chatAgent ? ' open' : ''}"><div class="studio-main">${lead ? `<div class="studio-now"${cardAbove ? ` data-gate="${esc(pendingGate)}"` : ''}>${lead}</div>` : ''}${flow.done ? '<div class="flow-tools" role="group" aria-label="Done steps"><button type="button" class="sm" data-stops="all">Show all</button><button type="button" class="sm" data-stops="min">Minimal</button></div>' : ''}${flow.html}${referencesBox}${standalone}<div class="studio-more">${documentPanels(doc, openKeys)}${filesPanel}${aboutPanel}</div></div><div class="studio-side">${side}</div></div>`;
  }
  // The picker state for the posting plan card: the same brand-level pick and state the brand card uses.
  function planMetricool(project) {
    const brand = (data.brands || []).find(item => item.slug === project?.brand);
    if (!brand || !brandReady(brand) || !data.metricoolConnected) return null;
    const state = metricoolFor(brand);
    return { slug: brand.slug, brands: state.brands, current: brand.publishing?.optedOut ? NO_METRICOOL : brand.publishing && brand.publishing.found !== false ? brand.publishing.blogId : '', open: state.open, busy: state.busy, selected: state.selected, error: state.error };
  }
  function metricoolFor(brand) {
    return { brands: data.metricoolBrands || [], open: metricoolUi.open.has(brand.slug), busy: metricoolUi.busy.has(brand.slug), selected: metricoolUi.picks.get(brand.slug) || '', error: metricoolUi.errors.get(brand.slug) || '' };
  }
  async function submitMetricoolBrand(slug) {
    const brand = (data.brands || []).find(item => item.slug === slug);
    const blogId = metricoolUi.picks.get(slug) || brand?.publishing?.blogId || '';
    const chosen = blogId === NO_METRICOOL ? { label: 'Not through Metricool' } : (data.metricoolBrands || []).find(item => item.id === blogId);
    if (!transport || !brand || !chosen || metricoolUi.busy.has(slug)) return;
    metricoolUi.busy.add(slug);
    metricoolUi.errors.delete(slug);
    render();
    try {
      const result = await transport.call('choose_metricool_brand', { requestId: randomId(globalThis), brand: slug, blogId, brandName: brand.name, label: chosen.label });
      metricoolUi.open.delete(slug);
      metricoolUi.picks.delete(slug);
      notify(result?.message || NOTE_SAVED);
      await refresh();
    } catch (e) {
      metricoolUi.errors.set(slug, e.message);
    } finally {
      metricoolUi.busy.delete(slug);
      render();
    }
  }
  function brandStrip() {
    const brands = data.brands || [];
    if (!brands.length) return { brands: '', intel: '', library: '' };
    // A removal that went through is done once the library stops listing the item.
    for (const key of [...libraryUi.removing]) {
      const at = key.indexOf(':');
      const library = brands.find(brand => brand.slug === key.slice(0, at))?.library;
      const listed = [...(Array.isArray(library?.yours) ? library.yours : [])].some(item => item?.id === key.slice(at + 1));
      if (!listed) libraryUi.removing.delete(key);
    }
    const libraries = brands.map(brand => brandLibrarySection(brand, { open: openKeys.has(`brand-library:${brand.slug}`), removing: libraryUi.removing, errors: libraryUi.errors, openKeys, copy: libraryUi.copy })).join('');
    const intelligence = brands.map(brand => intelPanelFor(brand)).join('');
    // Three parts, because home puts them in two columns: the brands, their intelligence, and their library.
    return {
      brands: `<section class="brand-strip"><div class="section-head"><div><span class="eyebrow">Brand context</span><h2>Your brands</h2></div><span class="count">${brands.length}</span></div><div class="brand-list">${brands.map(brand=>brandChip(brand, metricoolFor(brand))).join('')}</div></section>`,
      intel: intelligence ? `<div class="brand-intels">${intelligence}</div>` : '',
      library: libraries ? `<div class="brand-libraries">${libraries}</div>` : '',
    };
  }
  // Remove one of the person's own items from a brand's library: a board request (`bank_remove`) that Claude lands with brand_bank_save.
  async function submitBankRemove(slug, id) {
    const key = libraryKey(slug, id);
    if (!transport || !slug || !id || libraryUi.removing.has(key)) return;
    libraryUi.removing.add(key);
    libraryUi.errors.delete(key);
    render();
    try {
      const result = await transport.call('bank_remove', { requestId: randomId(globalThis), brand: slug, id });
      notify(result?.message || NOTE_SAVED);
      await refresh();
    } catch (e) {
      libraryUi.removing.delete(key);
      libraryUi.errors.set(key, e.message || NOTE_SEND_FAILED);
    } finally {
      render();
    }
  }
  function overview() {
    // The setup step itself; the top bar's Connectors link is drawn by render over any page.
    if (data.setupStep === 'connectors' && !connectorsContinued && Array.isArray(data.connectors) && data.connectors.length) return connectorsPanel(true);
    const projects = data.projects || [];
    const firstRun = readyBrands().length === 0 && projects.length === 0;
    // The brief box is the one way to start a job, so it stays on home with jobs listed: a blank draft, or the one set aside while the
    // person was on the Brand onboarding page.
    if (!inline && !loading && projects.length) { inline = inlineDrafts.get('new') || newJobDraft(); inlineDrafts.delete('new'); }
    const onboarding = inlineStart();
    const newJob = Boolean(inline && inline.kind === 'new');
    const stageTitle = newJob ? 'Jobs' : firstRun || (inline && inline.kind === 'onboard') ? 'Brand onboarding' : 'Jobs';
    // Home offers the Brand onboarding page; that page offers the way back, to the jobs and the brief box.
    const tools = firstRun ? '' : inline?.kind === 'onboard' ? '<button data-action="jobs">Back to jobs</button>' : '<button data-action="brand">Brand onboarding</button>';
    const head = `<div class="slate-head"><h1>${esc(stageTitle)}</h1><div class="toolbar">${tools}</div></div>`;
    const strip = brandStrip();
    // On the Brand onboarding page the agent cards say who is working, so they stand in for the "research has started" note.
    const onboardBrand = inline?.kind === 'onboard' && inline.brand ? (data.brands || []).find(item => item.slug === inline.brand) : null;
    const workspaceItems = workspaceInbox(data, { drafts: [inline, ...inlineDrafts.values()].filter(Boolean) });
    // The Director asks the brand's open items in its own chat, so this page has no Needs you box of its own: each question keeps its
    // buttons (and its answer request) on the Director's message. The cards register here for the answer handlers.
    inboxQuestions.clear();
    inboxBriefs.clear();
    // The name step has no brand yet; a nameless stand-in gives the Director column ("Here to help") from the start.
    const agentsPanel = onboardAgentsPanel(onboardBrand || (inline?.kind === 'onboard' ? { slug: 'new-brand', name: '' } : null), inline, Date.now(), onboardChat, { items: workspaceItems.items, context: item => inboxContext(item, null), signal: signalInfo(), notes: onboardBrand ? intelDirectorNotes(onboardBrand, intelState(onboardBrand.slug)) : null });
    if (!agentsPanel) onboardChat = undefined;
    const inbox = agentsPanel ?{ ...workspaceItems, items: workspaceItems.items.filter(item => !(item.kind === 'onboarding' && item.state === 'running' && item.brand === onboardBrand?.slug)) } : workspaceItems;
    const waitingJobs = jobsWaitingOn(workspaceItems.items);
    const jobsHtml = () => firstRun ? '' : `<section class="jobs-section"><div class="section-head"><h2>In flight</h2><span class="count">${projects.length}</span></div>${projects.length ? `<div class="project-grid">${newestJobsFirst(projects).map(project => projectCard(project, cardWaiting(project, waitingJobs))).join('')}</div>` : `<p class="muted empty-jobs">${readyBrands().length ? TXT_NO_JOBS_YET_DESCRIBE : TXT_NO_JOBS_YET_FINISH}</p>`}</section>`;
    // The brand page: Needs you first (a strip above the form, so a phone sees it before the form), then the form. With the Director's chat on
    // the page that chat is the side column and holds the open items itself. The brands list is not repeated under the form; home has it.
    // The brand's own "research done" card stays as a note, without a button that opens the page the person is already on.
    const here = item => {
      if (!(item.kind === 'onboarding' && item.needsYou && onboardBrand && item.brand === onboardBrand.slug)) return item;
      const lead = item.state === 'review' && item.brandName ? `${item.brandName}: research done. ` : '';
      return { ...item, onPage: true, ...(item.state === 'review' ? { text: `${lead}Check the details below, then press Save and continue.` } : {}) };
    };
    // A note that says nothing is needed ("researching") is not a reason for a gold strip; the progress above the form already says it.
    const needsList = inbox.items.filter(item => !(item.kind === 'onboarding' && item.needsYou === false)).map(here);
    const needsHere = !agentsPanel && needsList.length ? inboxAside({ ...inbox, items: needsList }, { workspace: true, strip: true }) : '';
    // Under 950px the page is one column and the Director's column sits under the form, unless it holds a card that waits for the person or the
    // research list: then it comes first in the markup too, so the keyboard and a screen reader reach it before the form.
    const sideFirst = Boolean(agentsPanel) && narrowBrandPage() && /bub-need|data-ob-research/.test(agentsPanel);
    const brandPage = column => {
      if (!agentsPanel) return `${head}<div class="overview-main">${column}</div>`;
      const side = `<div class="onboard-side">${agentsPanel}</div>`;
      return `${head}<div class="layout">${sideFirst ? `${side}<div>${column}</div>` : `<div>${column}</div>${side}`}</div>`;
    };
    if (firstRun) {
      syncInboxDocuments();
      return brandPage(`${needsHere}${onboarding}`);
    }
    if (inline?.kind === 'onboard') {
      syncInboxDocuments();
      return brandPage(`${needsHere}${overviewColumn({ jobs: jobsHtml(), onboarding, onboardFirst: true })}`);
    }
    // Home: "Needs you" comes first and holds every open item, the job ones included, with the same cards (pictures, Approve,
    // Ask for changes) as the Director's chat. Then the brief box, the one way to start a job, and the jobs under it, one row each
    // from brief to posted, newest first, each with the faces of the people on it. Then the brands with their intelligence. The second
    // column (under the first on a phone) is the Team, what goes out this week, and the brand library.
    const needsItems = inbox.items;
    // Newest first, like the In flight cards; finished jobs go to the bottom.
    const rank = project => (FINAL_JOB_STATES.includes(project?.state) ? 1 : 0);
    const ordered = newestJobsFirst(projects).map((project, at) => ({ project, at })).sort((a, b) => rank(a.project) - rank(b.project) || a.at - b.at).map(entry => entry.project);
    // The faces, the team and the week's posts come from the job documents of the newest jobs, so home watches those.
    const watched = ordered.slice(0, HOME_WATCHED_JOBS);
    syncInboxDocuments(watched.map(project => project.jobId));
    const closed = signalAvailability === 'no_session';
    const entries = watched.map(project => ({ project, doc: docFor(project), closed }));
    const team = homeTeam(entries.filter(entry => !FINAL_JOB_STATES.includes(entry.project.state)));
    const needs = needsItems.length ? inboxAside({ items: needsItems }, { workspace: true, strip: true }) : '';
    const rows = `<section class="jobs-section"><div class="section-head"><h2>Jobs, from brief to posted</h2><span class="count">${projects.length}</span></div>${projects.length ? `<div class="job-rows">${ordered.map(project => jobRow(project, cardWaiting(project, waitingJobs))).join('')}</div>` : `<p class="muted empty-jobs">${readyBrands().length ? TXT_NO_JOBS_YET_DESCRIBE : TXT_NO_JOBS_YET_FINISH}</p>`}</section>`;
    const panel = (id, title, body) => `<section class="panel home-panel" aria-labelledby="${id}"><div class="section-head"><h2 id="${id}">${title}</h2></div>${body}</section>`;
    return `${head}<div class="ov-grid"><div class="ov-col">${needs}${onboarding}${rows}${strip.brands}${strip.intel}</div><div class="ov-col">${panel('home-team-h', 'Team', homeTeamList(team))}${panel('home-week-h', 'Going out this week', goingOutList(goingOutThisWeek(entries)))}${strip.library}</div></div>`;
  }
  // A Team row on home: the job's chat state says whose thread is open, so set it before the link takes the person to the job.
  function openTeamThread(jobId, agentId) {
    const project = projectById(jobId);
    if (!project || !agentId) return;
    const box = agentBoxState(project);
    if (box.chat) box.drafts[box.chat] = box.draft;
    Object.assign(box, { chat: agentId, to: agentId, draft: box.drafts[agentId] || '', error: '', ...(box.to === agentId ? {} : { about: null }) });
  }
  // One pipeline group's page: its title, the jobs in it, then the brief box to start another.
  function pipelinePage(group) {
    const waitingJobs = jobsWaitingOn(workspaceInbox(data).items);
    const page = pipelineGroupPages(data.projects || []).find(item => item.group === group);
    if (!page) return '<div class="slate-head"><h1>Nothing here</h1></div><p class="muted"><a href="#/">Back to all jobs</a></p>';
    const jobs = page.jobs.length
      ? `<section class="jobs-section"><div class="section-head"><h2>In flight</h2><span class="count">${page.jobs.length}</span></div><div class="project-grid">${newestJobsFirst(page.jobs).map(project => projectCard(project, cardWaiting(project, waitingJobs))).join('')}</div></section>`
      : '<p class="muted empty-jobs">No jobs of this kind yet. Start one below.</p>';
    const composer = inline ? inlineStart() : `<section class="panel">${composerForm({ values: starterValues, refs: starterRefs }, { brands: data.brands || [], variant: 'inbox' })}</section>`;
    return `<div class="slate-head"><h1>${esc(page.title)}</h1></div>${jobs}<div class="pipeline-composer" id="pipeline-composer">${composer}</div>`;
  }

  function drawerOutput(a) {
    const doc = docFor(current());
    const file = docFileFor(doc, a);
    const preview = outputReviewUrl(doc, file, a.path) || safePreviewUrl(a.url);
    const type = a.mimeType || file?.mimeType || '';
    const title = esc(outputLabel(a, doc).title);
    if (doc?.report && a.path === doc.report.path) return reportArticle(doc.report, { jobTitle: outputLabel(a, doc).title });
    if (/image/.test(type)) {
      const src = preview || safePreviewUrl(file?.thumb) || safePreviewUrl((doc?.report?.stills || []).find(still => still.path === a.path)?.thumb);
      if (src) return `<figure class="drawer-media"><img alt="${title}" src="${esc(src)}"></figure>`;
    }
    if (/video/.test(type)) {
      const poster = safePreviewUrl(file?.poster);
      if (preview) return `<figure class="drawer-media"><video controls playsinline preload="metadata" src="${esc(preview)}"${poster ? ` poster="${esc(poster)}"` : ''} aria-label="${title}"></video></figure>`;
      if (file) return `${mediaTile({ kind: 'video', title: outputLabel(a, doc).title, poster: file.poster, durationSeconds: file.durationSeconds })}<p class="muted drawer-note">The video is on your computer.</p>`;
    }
    if (/audio/.test(type) && preview) return `<audio controls src="${esc(preview)}"></audio>`;
    if (preview && !/image|video|audio/.test(type)) return `<a href="${esc(preview)}" target="_blank" rel="noopener noreferrer">Open output</a>`;
    // An internal .json file (a concept, storyboard, generation manifest...) is
    // structured data for Claude, not something to dump raw on the board: the
    // storyboard and other review panels already show its readable fields.
    if (/\.json$/i.test(a.path || '')) return '<p class="muted">Data file. Open it from your computer.</p>';
    const text = file?.text ?? a.content;
    if (text != null) return `${/\.md$/i.test(a.path || '') ? `<div class="md">${renderMarkdown(text)}</div>` : `<pre>${esc(text)}</pre>`}${file?.truncated ? `<p class="muted drawer-note">${NOTE_SHORTENED}</p>` : ''}`;
    if (file?.omitted) return `<p class="muted">${NOTE_TOO_LARGE}</p>`;
    const reason = previewUnavailableReason({ type, path: a.path, hasDoc: Boolean(doc) });
    return `<pre>${esc(a.summary || reason)}</pre>`;
  }
  function renderDrawer() {
    const a = drawer;
    const doc = docFor(current());
    const file = docFileFor(doc, a);
    const tabs = drawerTabs(file);
    if (!tabs.includes(drawerTab)) drawerTab = 'output';
    let content;
    if(drawerTab==='output') content=drawerOutput(a);
    else if(drawerTab==='prompt') content=drawerPrompt(file);
    else if(drawerTab==='trace') content=drawerMade(file);
    else content=drawerAbout(a, file);
    const label = outputLabel(a, doc);
    return `<div class="scrim" data-action="close"></div><section class="drawer" role="dialog" aria-modal="true" aria-label="Output details"><div class="drawer-head"><div><span class="eyebrow">Project output</span><h2 class="drawer-title">${esc(label.title)}${label.tags.map(refTag).join('')}</h2></div><button data-action="close" aria-label="Close output details">✕</button></div><div class="tabs" role="tablist">${tabs.map(tab=>`<button role="tab" aria-selected="${drawerTab===tab}" data-tab="${tab}">${esc(DRAWER_TAB_LABELS[tab] || humanize(tab))}</button>`).join('')}</div><div class="drawer-body" role="tabpanel">${content}</div></section>`;
  }
  function renderViewer() {
    if (viewer.ref) return `<div class="scrim viewer-scrim" data-action="close"></div><section class="viewer ref-viewer" role="dialog" aria-modal="true" aria-labelledby="ref-viewer-title"><button class="viewer-close" data-action="close" aria-label="Close larger view">✕</button><div class="ref-viewer-card">${referenceViewer(viewer.ref)}</div></section>`;
    return `<div class="scrim viewer-scrim" data-action="close"></div><section class="viewer" role="dialog" aria-modal="true" aria-label="${esc(viewer.alt || 'Full size')}"><button class="viewer-close" data-action="close" aria-label="Close full size view">✕</button><img src="${esc(viewer.src)}" alt="${esc(viewer.alt || '')}"></section>`;
  }
  let researchWake = null;
  function scheduleResearchWake() {
    clearTimeout(researchWake);
    researchWake = null;
    const at = nextPendingExpiry(data.brands, Date.now());
    if (at !== null) researchWake = setTimeout(() => { researchWake = null; render(); }, Math.max(50, at - Date.now() + 50));
  }
  // What was typed in the Inbox starter survives a redraw; it is cleared once it is sent.
  function captureStarter() {
    const form = app.querySelector('#starter-form');
    if (form) starterValues = Object.fromEntries(new FormData(form));
  }
  setPickPreviewReady(() => render());
  // A text box on the brand page is about four lines tall and grows with what is typed. Browsers that know field-sizing do it in CSS; for the
  // others the height follows the text here.
  const FIELD_SIZING = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');
  function fitBox(box) {
    if (FIELD_SIZING || !box) return;
    box.style.height = 'auto';
    if (box.scrollHeight > 0) box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
  }
  function render() {
    const project = current();
    rememberBrandMarkets(data.brands);
    captureStarter();
    const jobFocus = captureJobFocus();
    const jumped = Object.values(JUMP_TARGETS).find(selector => document.activeElement?.matches?.(`${selector}[tabindex="-1"]`)) || null;
    const stripScroll = [...app.querySelectorAll('.sb-strip')].map(strip => strip.scrollLeft);
    const paneScroll = capturePaneScroll();
    app.innerHTML=topbar(project)+'<main class="wrap">'+(error?`<div class="notice error" role="alert">${esc(error)}</div>`:'')+(connectorsView && Array.isArray(data.connectors) && data.connectors.length ? connectorsPanel(false) : project?details(project):routeOf(location.hash).page === 'pipeline' ? pipelinePage(routeOf(location.hash).group) : overview())+'</main>'+ (drawer?renderDrawer():'') + (viewer?renderViewer():'');
    const inlineForm = app.querySelector('#inline-form');
    restoreForm(inlineForm, inline?.values);
    inlineForm?.querySelectorAll('.context-textarea').forEach(fitBox);
    if (inlineForm && document.activeElement === document.body) {
      if (inline?.kitFocus) {
        const kitTarget = inlineForm.querySelector(inline.kitFocus);
        if (kitTarget) { kitTarget.focus({preventScroll:true}); kitTarget.scrollIntoView({block:'nearest', inline:'nearest'}); }
      } else if (inline?.focusName) {
        const named = inlineForm.elements.namedItem(inline.focusName);
        const focused = named instanceof RadioNodeList ? [...named].find(item => item.checked) || named[0] : named;
        focused?.focus({preventScroll:true});
        if (focused && typeof focused.setSelectionRange === 'function' && Number.isInteger(inline.selectionStart) && Number.isInteger(inline.selectionEnd)) {
          try { focused.setSelectionRange(inline.selectionStart, inline.selectionEnd); } catch { /* Some native controls do not expose a selection range. */ }
        }
      }
    }
    if (inline) inline.kitFocus = null;
    app.querySelectorAll('.sb-strip').forEach((strip, index) => { if (stripScroll[index]) strip.scrollLeft = stripScroll[index]; });
    restorePaneScroll(paneScroll);
    loadKitFonts();
    restoreJobFocus(jobFocus);
    announceAgents(project);
    // A caption that fits in its two lines has nothing to open, so it shows no Show all control.
    app.querySelectorAll('.publish-text:not(.is-open)').forEach(item => {
      const preview = item.querySelector('.publish-text-preview');
      if (preview && preview.scrollHeight <= preview.clientHeight + 1) { item.classList.add('publish-text-short'); item.querySelector('.publish-toggle')?.remove(); }
    });
    scheduleResearchWake();
    schedulePostWake(project);
    const landed = jumped && document.activeElement === document.body ? app.querySelector(jumped) : null;
    if (landed) { landed.setAttribute('tabindex', '-1'); landed.focus({ preventScroll: true }); }
    if (pendingJump && project) {
      if (project.jobId !== pendingJump.jobId) pendingJump = null;
      else if (project.detailsLoaded !== false) { jumpTo(pendingJump.selector); pendingJump = null; }
    }
  }
  const ONBOARDING_SECTION = 'section.onboarding';
  const JUMP_TARGETS = Object.freeze({ review: 'section.review-panel', brief: 'section.intake' });
  function jumpTo(selector) {
    const element = app.querySelector(selector);
    if (!element) return false;
    // A target inside a folded gate section opens the section first.
    for (let node = element.closest('details'); node; node = node.parentElement?.closest('details')) {
      if (!node.open) { node.open = true; if (node.dataset.openKey) openKeys.add(node.dataset.openKey); }
    }
    const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    element.setAttribute('tabindex', '-1');
    element.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    element.focus({ preventScroll: true });
    return true;
  }
  function jumpFromInbox(jobId, target) {
    const post = /^post:([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/.exec(String(target || ''));
    const selector = post ? `li.post-status-row[data-post-id="${CSS.escape(post[1])}"]` : target === 'kit' ? 'section.posting-kit' : JUMP_TARGETS[target] || JUMP_TARGETS.review;
    if (!jobId || current()?.jobId === jobId) { jumpTo(selector); return; }
    pendingJump = { jobId, selector };
    location.hash = '#/project/' + encodeURIComponent(jobId);
  }
  function openAnswerBox(questionId) {
    const state = questionState(questionId);
    state.open = true;
    state.error = '';
    render();
    const box = app.querySelector(`:is(.inbox-item,.inbox-question)[data-inbox-key="${CSS.escape(`question-${questionId}`)}"] textarea`);
    if (!box) return;
    box.focus({ preventScroll: true });
    box.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const end = box.value.length;
    try { box.setSelectionRange(end, end); } catch { box.blur(); box.focus({ preventScroll: true }); }
  }
  function closeAnswerBox(questionId) {
    const state = questionState(questionId);
    state.open = false;
    state.error = '';
    render();
    focusQuietly(`[data-inbox-type="${CSS.escape(String(questionId))}"]`);
  }
  async function answerQuestion(questionId, { choice = null, text = null } = {}) {
    const item = inboxQuestions.get(String(questionId));
    if (!item || !transport) return;
    const state = questionState(questionId);
    if (state.busy || state.submitted || state.needsReconciliation || state.answered) return;
    const requestId = state.requestId || randomId(globalThis);
    const { args, error } = answerArgs(item, { choice, text, requestId });
    if (error) {
      state.error = error;
      render();
      if (text !== null) focusQuietly(`:is(.inbox-item,.inbox-question)[data-inbox-key="${CSS.escape(`question-${questionId}`)}"] textarea`);
      return;
    }
    Object.assign(state, { requestId, busy: true, error: '', declined: false, choice: args.text ? null : choice, text: args.text || '', operation: 'answer_question', args });
    render();
    try {
      const result = await transport.call('answer_question', args);
      if (result?.status === 'requested') {
        Object.assign(state, { busy: false, submitted: true, submittedAt: state.submittedAt || Date.now(), message: result.message || '', signal: result.signal || null });
        scheduleReminderWake(state);
        watchJobRequest(`question:${questionId}`, 'answer', state);
        render();
      } else {
        Object.assign(state, { busy: false, answered: true, requestId: null });
        notify(result?.message || NOTE_HAS_ANSWER);
        await refresh();
      }
    } catch (e) {
      Object.assign(state, { busy: false, requestId: null, error: e.message });
      render();
    }
  }
  function revealCurrentCell() {
    const cell = app.querySelector('.sb-cell.is-current');
    const strip = cell?.closest('.sb-strip');
    if (!strip) return;
    const box = cell.getBoundingClientRect();
    const frame = strip.getBoundingClientRect();
    if (box.left < frame.left) strip.scrollLeft -= frame.left - box.left + 8;
    else if (box.right > frame.right) strip.scrollLeft += box.right - frame.right + 8;
  }
  async function refresh() {
    if(loading) return;
    captureInlineValues();
    loading=true; render();
    try {
      transport ||= await createTransport(config);
      void askBoardConsent();
      if (!unsubscribe) {
        unsubscribe = watchWorkspace(transport, {
          onSnapshot: next => { captureInlineValues(); data = next; error = ''; render(); void resyncLive(); },
          onError: nextError => { error = nextError?.message || 'The artifact projection could not be read.'; render(); },
        });
      }
      data = await transport.call('snapshot'); error='';
    }
    catch(e) { error=e.message; }
    finally {
      loading=false;
      render();
    }
  }
  function close() { captureInlineValues(); if(viewer){viewer=null;}else{drawer=null;} render(); const back = returnFocus?.isConnected ? returnFocus : returnSelector ? app.querySelector(returnSelector) : null; back?.focus({preventScroll:true}); }
  function draftKey(value) { return value?.kind === 'onboard' ? 'onboard:' + (value.brand || 'new') : value?.kind || 'new'; }
  function ensureInlineKit() { inline ||= {kind:'onboard', brand:null, values:{}}; inline.kit ||= {}; return inline.kit; }
  // Folders of videos, photos and fonts added on the onboarding page (see kitFolders): the draft keeps what is typed and the requests still
  // waiting. Each is a `brand_folder_add` board request that Claude applies; the row stays until the brand's footage lists the folder.
  function folderUiOf(create = false) {
    if (!inline || inline.kind !== 'onboard') return null;
    if (create) return (ensureInlineKit().folders ||= { path: '', label: '', rights: '', error: '', busy: false, pasteOpen: false, pending: [] });
    return inline.kit?.folders || null;
  }
  function stopFolderWatch(entry) {
    if (typeof entry?.unsubscribe === 'function') entry.unsubscribe();
    if (entry) entry.unsubscribe = null;
  }
  function watchFolderAdd(entry) {
    stopFolderWatch(entry);
    if (!transport?.subscribeRequest) return;
    entry.unsubscribe = transport.subscribeRequest(entry.requestId, receipt => {
      if (!receipt) return;
      const acknowledgement = receipt.artifactReceipt || receipt;
      const status = String(acknowledgement.status || receipt.status || 'requested');
      if (status === 'applied') {
        const result = acknowledgement.result || receipt.result || {};
        Object.assign(entry, { status: 'applied', folderId: typeof result.folderId === 'string' ? result.folderId : null, appliedAt: Date.now(), message: '', ...(entry.kind === 'pick' && typeof result.name === 'string' && result.name.trim() ? { name: result.name.trim().slice(0, 120) } : {}) });
        stopFolderWatch(entry);
        void refresh();
      } else if (status === 'declined') {
        Object.assign(entry, { status: 'declined', message: acknowledgement.message || receipt.message || 'Declined in chat. Nothing was added.' });
        stopFolderWatch(entry);
      } else if (['needs_reconciliation', 'error', 'failed', 'rejected'].includes(status)) {
        Object.assign(entry, { status: 'error', message: acknowledgement.message || receipt.message || 'Could not read that folder. Claude must check first.' });
        stopFolderWatch(entry);
      } else return;
      render();
    }, () => {});
  }
  async function submitFolderAdd() {
    const ui = folderUiOf(true);
    const slug = inline?.brand;
    if (!transport || !ui || !slug || ui.busy) return;
    captureInlineValues();
    const checked = folderRequestArgs(ui);
    if (checked.error) { ui.error = checked.error; inline.kitFocus = kitFocusSelector('add-folder'); render(); return; }
    const requestId = randomId(globalThis);
    const entry = { requestId, name: checked.name, rights: checked.args.rights, status: 'sent', message: '' };
    ui.error = ''; ui.busy = true; render();
    try {
      const result = await transport.call('brand_folder_add', { requestId, brand: slug, ...checked.args });
      entry.status = 'waiting';
      ui.pending.push(entry);
      Object.assign(ui, { path: '', label: '', rights: '' });
      watchFolderAdd(entry);
      notify(result?.message || 'Saved. Claude will read the folder.');
    } catch (e) {
      ui.error = e.message || NOTE_SEND_FAILED;
    } finally {
      ui.busy = false;
      render();
    }
  }
  // "Choose a folder...": the request carries the person's answer on whose files these are, never a path. Claude opens the operating system's folder
  // dialog on this computer (the board cannot see local paths), imports the folder it gets back and answers with the same receipt as a typed path.
  async function submitFolderPick() {
    const ui = folderUiOf(true);
    const slug = inline?.brand;
    if (!transport || !ui || !slug || ui.busy) return;
    captureInlineValues();
    const checked = folderPickArgs(ui);
    if (checked.error) { ui.error = checked.error; inline.kitFocus = kitFocusSelector('rights-folder'); render(); return; }
    const requestId = randomId(globalThis);
    const entry = { requestId, kind: 'pick', name: checked.name, rights: checked.args.rights, status: 'sent', message: '' };
    ui.error = ''; ui.busy = true; render();
    try {
      const result = await transport.call('brand_folder_pick', { requestId, brand: slug, ...checked.args });
      entry.status = 'waiting';
      ui.pending.push(entry);
      Object.assign(ui, { label: '', rights: '' });
      watchFolderAdd(entry);
      notify(result?.message || 'Saved. A folder picker opens on your computer.');
    } catch (e) {
      ui.error = e.message || NOTE_SEND_FAILED;
    } finally {
      ui.busy = false;
      inline.kitFocus = kitFocusSelector('rights-folder');
      render();
    }
  }
  function dismissFolder(index) {
    const ui = folderUiOf();
    if (!ui || !Number.isInteger(index) || !ui.pending[index]) return;
    stopFolderWatch(ui.pending[index]);
    ui.pending.splice(index, 1);
    render();
  }
  // Read a File into a decoded <img>, ready to draw to canvas. SVGs load the
  // same way as raster types since the browser rasterizes the data URL.
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not read the image.'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function drawScaled(image, maxSize) {
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const w = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const h = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(image, 0, 0, w, h);
    return canvas;
  }
  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not export image.')), mimeType, quality));
  }
  // Export a logo at maxSize (or smaller, preserving aspect ratio): PNG
  // first, and only if that is over limitBytes, WebP at falling quality
  // until it fits (or the lowest tried quality, best effort).
  async function exportUnderLimit(image, maxSize, limitBytes) {
    const canvas = drawScaled(image, maxSize);
    let blob = await canvasToBlob(canvas, 'image/png');
    let mimeType = 'image/png';
    if (blob.size > limitBytes) {
      mimeType = 'image/webp';
      let quality = 0.92;
      blob = await canvasToBlob(canvas, mimeType, quality);
      while (blob.size > limitBytes && quality > 0.3) {
        quality -= 0.12;
        blob = await canvasToBlob(canvas, mimeType, quality);
      }
    }
    return { mimeType, blob, width: canvas.width, height: canvas.height };
  }
  async function handleLogoFile(file) {
    const kit = ensureInlineKit();
    if (!file) return;
    // Keep what the person typed in the other fields: the re-render below
    // rebuilds the form from inline.values.
    captureInlineValues();
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) { kit.logo = { error: NOTE_LOGO_TYPE }; inline.kitFocus = kitFocusSelector('replace-logo'); render(); return; }
    try {
      const image = await loadImageFromFile(file);
      const main = await exportUnderLimit(image, 512, 40 * 1024);
      const thumb = await exportUnderLimit(image, 64, 6 * 1024);
      // Always rendered locally for the on-card preview; never sent in the asset
      // path (only the asset ids are), and re-sent as dataBase64 in the fallback.
      const previewDataUrl = `data:${main.mimeType};base64,${await blobToBase64(main.blob)}`;
      let assets = null;
      if (artifactMode() && globalThis.claude?.use) {
        try { assets = await globalThis.claude.use('assets'); } catch { assets = null; }
      }
      const uploaded = await encodeLogoUpload(assets, main, thumb);
      kit.logo = { ...uploaded, previewDataUrl, error: null };
    } catch {
      kit.logo = { error: NOTE_LOGO_TYPE };
    }
    captureInlineValues();
    inline.kitFocus = kitFocusSelector('replace-logo');
    render();
  }
  // Fonts: the kit keeps a font by its family name, so an uploaded font file is read right here (its name from the file, as the folder digest reads it
  // on the computer) and its bytes are loaded as a FontFace so the specimen shows the real letters. The file is not saved or sent anywhere.
  let uploadedFontCount = 0;
  async function loadUploadedFont(family, bytes) {
    if (typeof FontFace !== 'function' || !document.fonts) return null;
    const alias = `sc-upload-${++uploadedFontCount}`;
    try {
      const face = new FontFace(alias, bytes.slice(0));
      await face.load();
      document.fonts.add(face);
      uploadedFonts.set(fontKey(family), alias);
      return alias;
    } catch { return null; }
  }
  async function handleFontFile(file) {
    const kit = ensureInlineKit();
    if (!file) return;
    captureInlineValues();
    Object.assign(kit, { fontError: '', fontStatus: '' });
    const brandForKit = inline?.brand ? (data.brands || []).find(item => item.slug === inline.brand) : null;
    const current = (Array.isArray(kit.fonts) ? kit.fonts : (brandForKit?.kit?.fonts || [])).map(font => ({ ...font }));
    const finish = () => { captureInlineValues(); inline.kitFocus = kitFocusSelector('upload-font'); render(); };
    const problem = fontFileProblem(file);
    if (problem) { kit.fontError = problem; finish(); return; }
    try {
      const bytes = await file.arrayBuffer();
      const family = (await fontFamilyFromBytes(bytes)) || fontFamilyFromFileName(file.name);
      if (!family) { kit.fontError = 'No font name found. Type it instead.'; finish(); return; }
      const known = current.some(font => fontKey(font.family) === fontKey(family));
      if (!known && current.length >= KIT_LIMITS.maxFonts) { kit.fontError = `The kit holds up to ${KIT_LIMITS.maxFonts} fonts. Remove one first.`; finish(); return; }
      const alias = await loadUploadedFont(family, bytes);
      if (!known) current.push({ family, use: nextFontUse(current) });
      kit.fonts = current;
      kit.fontStatus = (known ? `${family} is already in your fonts.` : `Added ${family} from ${file.name}.`) + (alias ? '' : ' No preview available.');
    } catch { kit.fontError = 'Could not read that font. Try another file.'; }
    finish();
  }
  // Fonts of the kit: ask Google Fonts for each family shown in a font row, once, so the specimen shows the real letters. A family Google does not
  // know and this computer does not have is marked, and its row says the preview is unavailable instead of passing off the fallback letters.
  const askedFonts = new Set();
  function fontIsInstalled(family) {
    try {
      const context = document.createElement('canvas').getContext('2d');
      const width = font => { context.font = `40px ${font}`; return context.measureText('mmmmmmmmmmlli 0123').width; };
      return ['monospace', 'serif', 'sans-serif'].some(base => width(`'${family}', ${base}`) !== width(base));
    } catch { return false; }
  }
  function markFontMissing(key) {
    fontPreview.missing.add(key);
    app.querySelectorAll(`.kit-font-row[data-font-key="${CSS.escape(key)}"]`).forEach(row => {
      if (uploadedFonts.has(key)) return;
      row.classList.add('is-fallback');
      const note = row.querySelector('[data-font-note]');
      if (note) note.textContent = 'Preview unavailable';
    });
  }
  function loadKitFonts() {
    app.querySelectorAll('.kit-font-row[data-font-key]').forEach(row => {
      const key = row.dataset.fontKey;
      const family = row.querySelector('.kit-font-name')?.value || '';
      if (!key || askedFonts.has(key) || uploadedFonts.has(key)) return;
      askedFonts.add(key);
      const href = googleFontHref(family);
      if (!href) { if (!fontIsInstalled(family)) markFontMissing(key); return; }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.addEventListener('error', () => { if (!fontIsInstalled(family)) markFontMissing(key); });
      document.head.append(link);
    });
  }
  // Optional photos of the brand's world, added at setup. Each one goes through the same
  // downscale and asset-store upload as a product photo (preparePhotoFile below), and rides
  // on the same Start onboarding or Save and continue click as `kit.references`.
  async function handleRefFiles(fileList) {
    const kit = ensureInlineKit();
    const files = [...(fileList || [])];
    if (!files.length) return;
    captureInlineValues();
    const brandForKit = inline?.brand ? (data.brands || []).find(item => item.slug === inline.brand) : null;
    const room = Math.max(0, KIT_PHOTOS_MAX - (Number(brandForKit?.referencePhotos) || 0) - (kit.references || []).length);
    const prepared = [];
    for (const file of files.slice(0, room)) prepared.push(await preparePhotoFile(file));
    kit.references = [...(kit.references || []), ...prepared.filter(photo => !photo.error)];
    kit.referencesError = prepared.find(photo => photo.error)?.error || (files.length > room ? `Up to ${KIT_PHOTOS_MAX} photos. The rest were left out.` : '');
    captureInlineValues();
    inline.kitFocus = kitFocusSelector('add-ref');
    render();
  }
  // Export a product photo at maxSize (or smaller, preserving aspect ratio) as
  // JPEG at quality. Used at 2048/0.9 for the asset-store path (no byte
  // ceiling to hit there), and through exportPhotoUnderLimit below for the
  // pre-assets inline fallback, which does have one.
  async function exportPhoto(image, maxSize, quality) {
    const canvas = drawScaled(image, maxSize);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    return { mimeType: 'image/jpeg', blob, width: canvas.width, height: canvas.height };
  }
  async function exportPhotoUnderLimit(image, limitBytes) {
    let maxSize = 2048;
    let quality = 0.9;
    let result = await exportPhoto(image, maxSize, quality);
    while (result.blob.size > limitBytes && quality > 0.4) {
      quality -= 0.1;
      result = await exportPhoto(image, maxSize, quality);
    }
    while (result.blob.size > limitBytes && maxSize > 512) {
      maxSize = Math.round(maxSize * 0.75);
      quality = 0.9;
      result = await exportPhoto(image, maxSize, quality);
      while (result.blob.size > limitBytes && quality > 0.4) {
        quality -= 0.1;
        result = await exportPhoto(image, maxSize, quality);
      }
    }
    return result;
  }
  // Downscale, then upload to the asset store (or fall back to inline base64
  // capped at 180 KiB), exactly as handleLogoFile does for the brand kit's
  // logo: capture the other fields' typed values before and after, since this
  // re-renders the form.
  async function preparePhotoFile(file) {
    if (!PHOTO_ACCEPT.includes(file.type)) return { error: NOTE_PHOTO_TYPE };
    try {
      const image = await loadImageFromFile(file);
      const main = await exportPhoto(image, 2048, 0.9);
      const previewDataUrl = `data:${main.mimeType};base64,${await blobToBase64(main.blob)}`;
      let assets = null;
      if (artifactMode() && globalThis.claude?.use) {
        try { assets = await globalThis.claude.use('assets'); } catch { assets = null; }
      }
      const forUpload = assets ? main : await exportPhotoUnderLimit(image, 180 * 1024);
      const uploaded = await encodePhotoUpload(assets, forUpload, file.name);
      return { ...uploaded, previewDataUrl, error: null };
    } catch {
      return { error: NOTE_PHOTO_TYPE };
    }
  }
  // The Finish the brief photo field attaches the moment a valid file is
  // picked (there is nothing else to review first, unlike the other intake
  // answers), so Replace just sends a fresh attach with the new file.
  async function handleIntakePhotoFile(project, file) {
    if (!file) return;
    const state = uiFor(project).intake;
    const photo = await preparePhotoFile(file);
    if (photo.error) { state.photo = photo; render(); return; }
    render();
    await submitProductPhoto(project, photo);
  }
  async function submitProductPhoto(project, photo) {
    if (!transport) return;
    const state = uiFor(project).intake;
    const payload = photoPayload(photo);
    if (!payload) { state.photo = { error: NOTE_PHOTO_TYPE }; render(); return; }
    const requestId = randomId(globalThis);
    state.photo = { ...photo, requestId, busy: true, error: null, message: '' };
    render();
    const character = Boolean(project.intake?.fields?.some(field => field?.key === 'subjectPhoto'));
    const args = { requestId, brand: project.brand, jobId: project.jobId, expectedRevision: project.revision, photo: payload, ...(character ? { subject: 'character' } : {}), ...(project.title ? { title: project.title } : {}) };
    try {
      const result = await transport.call('attach_product_photo', args);
      if (result?.status === 'requested') {
        Object.assign(state.photo, { busy: false, message: result.message || NOTE_SAVING });
        watchJobRequest(project.jobId, 'photo', state.photo);
        render();
      } else {
        state.photo = null;
        notify(result?.message || (character ? 'Character picture saved.' : 'Product photo saved.'));
        await refresh();
      }
    } catch (e) {
      Object.assign(state.photo, { busy: false, error: e.message });
      render();
    }
  }
  // --- Add a reference (job page) -------------------------------------------------------------
  function refStateFor(project) {
    const ui = uiFor(project);
    ui.refs ||= { type: 'picture', file: null, fileName: '', text: '', note: '', link: '', queue: [], typeTouched: false, busy: false, error: '', message: '' };
    ui.refs.queue ||= [];
    return ui.refs;
  }
  function currentRefProject() {
    const id = selectedId();
    return (data.projects || []).find(item => item.jobId === id) || null;
  }
  function captureRefInputs(state) {
    const note = app.querySelector('[name="ref_note"]');
    const text = app.querySelector('[name="ref_text"]');
    const link = app.querySelector('[name="ref_link"]');
    if (note) state.note = note.value;
    if (text) state.text = text.value;
    if (link) state.link = link.value;
  }
  // Put picked or dropped files in the queue. Until the person changes the dropdown, each file gets the type that fits it.
  function queueRefFiles(state, files) {
    const queue = state.queue ||= [];
    let problem = '', first = null;
    for (const file of files) {
      if (queue.some(item => item.file.name === file.name && item.file.size === file.size)) continue;
      if (queue.length >= REFERENCE_QUEUE_MAX) { problem = `Add up to ${REFERENCE_QUEUE_MAX} files at a time.`; break; }
      const type = state.typeTouched ? state.type : detectedReferenceType(file);
      const wrong = referenceProblem(type, file);
      if (wrong) { problem ||= wrong; continue; }
      queue.push({ file, type });
      first ||= type;
    }
    if (first && !state.typeTouched) state.type = first;
    state.error = problem;
    state.message = '';
  }
  function onRefChange(field, dropped = null) {
    const project = currentRefProject();
    if (!project) return;
    const state = refStateFor(project);
    captureRefInputs(state);
    if (!dropped && field.name === 'ref_type') {
      state.type = field.value;
      state.typeTouched = true;
      const before = state.queue.length;
      state.queue = state.queue.filter(item => !referenceProblem(state.type, item.file)).map(item => ({ ...item, type: state.type }));
      state.error = state.queue.length < before ? `Some files do not fit "${REFERENCE_TYPES.find(item => item.id === state.type)?.label || 'that type'}" and were removed.` : '';
      state.message = '';
    } else {
      queueRefFiles(state, dropped || [...(field.files || [])]);
    }
    render();
  }
  async function submitReference(project) {
    if (!transport) return;
    const state = refStateFor(project);
    captureRefInputs(state);
    if (state.busy) return;
    const files = [...state.queue];
    const typed = !files.length && state.type === 'caption' && state.text.trim();
    const linked = referenceLinkOf(state.link);
    if (linked.error) { state.error = linked.error; render(); return; }
    if (!files.length && !typed && !linked.url) {
      state.error = state.type === 'caption' ? NOTE_TEXT_MISSING : 'Choose a file, or paste a link.';
      render();
      return;
    }
    state.busy = true; state.error = ''; state.message = '';
    render();
    const total = files.length + (typed ? 1 : 0) + (linked.url ? 1 : 0);
    let sent = 0, name = '';
    try {
      let assets = null;
      if (artifactMode() && globalThis.claude?.use) {
        try { assets = await globalThis.claude.use('assets'); } catch { assets = null; }
      }
      const send = async reference => {
        const requestId = randomId(globalThis);
        const result = await transport.call('add_reference', { requestId, brand: project.brand, jobId: project.jobId, expectedRevision: project.revision, reference, ...(project.title ? { title: project.title } : {}) });
        sent += 1;
        return result;
      };
      let result = null;
      for (const item of files) {
        name = total > 1 ? item.file.name : '';
        const problem = referenceProblem(item.type, item.file);
        if (problem) throw new Error(problem);
        result = await send(await encodeReferenceUpload(assets, { type: item.type, file: item.file, note: state.note, role: state.role }));
        state.queue = state.queue.filter(entry => entry !== item);
      }
      if (typed) { name = ''; result = await send(await encodeReferenceUpload(assets, { type: state.type, file: null, text: state.text, note: state.note, role: state.role })); }
      if (linked.url) {
        name = linked.url;
        const note = String(state.note || '').replace(/\s+/g, ' ').trim();
        if (note.length > REFERENCE_NOTE_MAX) throw new Error(`Keep the note under ${REFERENCE_NOTE_MAX} characters.`);
        result = await send({ action: 'link', url: linked.url, ...(note ? { note } : {}) });
        state.link = '';
      }
      const onlyLink = total === 1 && Boolean(linked.url);
      Object.assign(state, { busy: false, file: null, fileName: '', text: '', note: '', typeTouched: false, role: '', queue: [], message: onlyLink ? 'Saving the link.' : total > 1 ? `Sent ${total} references.` : (result?.message || NOTE_SAVING) });
      notify(result?.status === 'requested' ? (onlyLink ? 'Link sent to Claude.' : total > 1 ? `${total} references sent to Claude.` : 'Reference sent to Claude.') : (result?.message || 'Reference saved.'));
      render();
      await refresh();
    } catch (e) {
      const why = e.message || 'Could not add that reference.';
      Object.assign(state, { busy: false, error: `${name ? `${name}: ` : ''}${why}${sent ? ` ${sent} of ${total} ${sent === 1 ? 'was' : 'were'} sent; the rest are still waiting.` : ''}` });
      render();
    }
  }
  // Copy one of the brand's saved files (its logo or a photo) into this job. Only the file's id travels; the server finds the file.
  async function submitBrandReference(project) {
    if (!transport) return;
    const state = refStateFor(project);
    const file = ((data.brands || []).find(item => item.slug === project.brand)?.brandFiles || []).find(item => item.id === state.brandPick);
    if (!file || state.busy) return;
    state.busy = true; state.error = ''; state.message = '';
    render();
    try {
      const reference = { type: 'picture', action: 'brand', brandAssetId: file.id, ...(file.kind === 'logo' ? { role: 'logo' } : {}) };
      const result = await transport.call('add_reference', { requestId: randomId(globalThis), brand: project.brand, jobId: project.jobId, expectedRevision: project.revision, reference, ...(project.title ? { title: project.title } : {}) });
      Object.assign(state, { busy: false, brandPick: '', message: result?.message || NOTE_SAVING });
      notify(result?.status === 'requested' ? 'Brand file sent to Claude.' : (result?.message || 'Reference saved.'));
      render();
      await refresh();
    } catch (e) {
      Object.assign(state, { busy: false, error: e.message || 'Could not add that file.' });
      render();
    }
  }
  // Take a saved reference off the job: the request is applied by the server (files are moved aside, not deleted) and the card
  // goes when the next snapshot no longer lists it.
  async function removeSavedReference(project, id) {
    if (!transport) return;
    const state = refStateFor(project);
    if (state.removing?.[id]) return;
    state.confirm = null; state.removeError = '';
    (state.removing ||= {})[id] = Date.now();
    render();
    try {
      const requestId = randomId(globalThis);
      const result = await transport.call('remove_reference', { requestId, brand: project.brand, jobId: project.jobId, referenceId: id, expectedRevision: project.revision, ...(project.title ? { title: project.title } : {}) });
      notify(result?.status === 'requested' ? 'Removing that reference.' : (result?.message || 'Reference removed.'));
      render();
      await refresh();
    } catch (e) {
      delete state.removing[id];
      state.removeError = e.message || 'Could not remove that reference.';
      render();
    }
  }
  // --- References in the new-job form (before the job exists) ----------------------------------
  function newRefsOf() { return inline && inline.kind === 'new' ? (inline.refs ||= freshNewJobRefs()) : starterRefs; }
  function captureNewRefInputs(state) {
    const note = app.querySelector('[name="nref_note"]');
    const text = app.querySelector('[name="nref_text"]');
    if (note) state.note = note.value;
    if (text) state.text = text.value;
  }
  function onNewRefChange(field, dropped = null) {
    const state = newRefsOf();
    captureNewRefInputs(state);
    if (!dropped && field.name === 'nref_type') {
      Object.assign(state, { type: field.value, file: null, fileName: '', error: '', typeTouched: true });
    } else {
      const files = dropped || [...(field.files || [])];
      if (files.length > 1) {
        // Several at once go straight onto the list, each as the type that fits it (or the one the person chose).
        let problem = '';
        for (const file of files) {
          const type = state.typeTouched ? state.type : detectedReferenceType(file);
          const wrong = referenceProblem(type, file);
          if (wrong) { problem ||= wrong; continue; }
          if ((state.items || []).length >= NEW_JOB_REFERENCES_MAX) { problem ||= `Add up to ${NEW_JOB_REFERENCES_MAX} references now; the rest can go on the job page.`; break; }
          const checked = newJobReferenceItem({ type, file, text: '', note: state.note, role: state.role });
          if (checked.error) { problem ||= checked.error; continue; }
          state.items = [...(state.items || []), checked.item];
        }
        Object.assign(state, { file: null, fileName: '', text: '', note: problem ? state.note : '', role: problem ? state.role : '', error: problem, typeTouched: false });
      } else {
        const file = files[0] || null;
        if (file && !state.typeTouched) state.type = detectedReferenceType(file);
        const problem = referenceProblem(state.type, file);
        Object.assign(state, { file: problem ? null : file, fileName: problem || !file ? '' : file.name, error: problem });
      }
    }
    state.open = true;
    render();
  }
  // Move what is in the control onto the list. Returns false, with the problem shown, when it cannot go.
  function queueNewRef(state) {
    captureNewRefInputs(state);
    if ((state.items || []).length >= NEW_JOB_REFERENCES_MAX) { state.error = `Add up to ${NEW_JOB_REFERENCES_MAX} references now; the rest can go on the job page.`; return false; }
    const checked = newJobReferenceItem(state);
    if (checked.error) { state.error = checked.error; return false; }
    state.items = [...(state.items || []), checked.item];
    Object.assign(state, { file: null, fileName: '', text: '', note: '', role: '', error: '', typeTouched: false });
    return true;
  }
  // The wire shape of every listed reference: files to the asset store (inline when small), text inline. Done once per item.
  async function encodeNewRefs(state) {
    let assets = null;
    if (artifactMode() && globalThis.claude?.use) {
      try { assets = await globalThis.claude.use('assets'); } catch { assets = null; }
    }
    const out = [];
    for (const item of state.items) {
      item.encoded ||= await encodeReferenceUpload(assets, { type: item.type, file: item.file, text: item.text, note: item.note, role: item.role });
      out.push(item.encoded);
    }
    return out;
  }
  // --- Files from the chat paperclip and from a question that asks for one ----------------------
  function uploadStateFor(prefix, field) {
    if (prefix === 'aref') { const project = current(); return project ? (agentBoxState(project).attach ||= freshNewJobRefs()) : null; }
    const id = field?.closest?.('[data-qref]')?.dataset.qref;
    return id ? (questionState(id).upload ||= { ...freshNewJobRefs(), type: inboxQuestions.get(id)?.wantsUpload?.type || 'picture' }) : null;
  }
  function onUploadFieldChange(prefix, field, dropped = null) {
    const state = uploadStateFor(prefix, field);
    if (!state) return;
    const scope = field.closest('[data-qref],[data-aref]') || app;
    const note = scope.querySelector(`[name="${prefix}_note"]`);
    const text = scope.querySelector(`[name="${prefix}_text"]`);
    if (note) state.note = note.value;
    if (text) state.text = text.value;
    if (!dropped && field.name === `${prefix}_type`) {
      Object.assign(state, { type: field.value, file: null, fileName: '', error: '', typeTouched: true });
    } else {
      const file = dropped ? dropped[0] || null : field.files?.[0] || null;
      if (file && !state.typeTouched) state.type = referenceTypeFor(state.type, file);
      const problem = referenceProblem(state.type, file);
      Object.assign(state, { file: problem ? null : file, fileName: problem || !file ? '' : file.name, error: problem });
    }
    state.message = '';
    render();
  }
  // --- Drop a file on a control, or paste a screenshot: the same as choosing it with the button ---
  function acceptFiles(prefix, files, scope) {
    const list = [...files];
    if (!list.length) return;
    if (prefix === 'ref') onRefChange(scope, list);
    else if (prefix === 'nref') onNewRefChange(scope, list);
    else if (prefix === 'aref' || prefix === 'qref') onUploadFieldChange(prefix, scope, list);
  }
  const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
  const dropZoneOf = target => target?.closest?.('[data-ref-drop]') || null;
  const logoDropOf = target => target?.closest?.('[data-kit-drop]') || null;
  app.addEventListener('dragenter', event => { const zone = dropZoneOf(event.target); if (zone && hasFiles(event)) { event.preventDefault(); zone.classList.add('is-dragover'); return; } const logo = logoDropOf(event.target); if (logo && hasFiles(event)) { event.preventDefault(); if (!logo.closest('fieldset:disabled')) logo.classList.add('is-dragover'); } });
  app.addEventListener('dragover', event => { const zone = dropZoneOf(event.target); if (zone && hasFiles(event)) { event.preventDefault(); zone.classList.add('is-dragover'); return; } const logo = logoDropOf(event.target); if (logo && hasFiles(event)) { event.preventDefault(); if (!logo.closest('fieldset:disabled')) logo.classList.add('is-dragover'); } });
  app.addEventListener('dragleave', event => { const zone = dropZoneOf(event.target) || logoDropOf(event.target); if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('is-dragover'); });
  app.addEventListener('drop', event => {
    const logo = logoDropOf(event.target);
    if (logo) {
      event.preventDefault();
      logo.classList.remove('is-dragover');
      const picked = event.dataTransfer?.files?.[0];
      if (picked && !logo.closest('fieldset:disabled')) void handleLogoFile(picked);
      return;
    }
    const zone = dropZoneOf(event.target);
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('is-dragover');
    if (zone.querySelector('input[type="file"]')?.disabled) return;
    acceptFiles(zone.dataset.refDrop, event.dataTransfer?.files || [], zone);
  });
  // Ctrl/Cmd+V of a picture goes to the control the person is in or pointing at, or to the open "Add a reference" panel.
  const PASTE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  document.addEventListener('paste', event => {
    const clip = event.clipboardData;
    const pictures = [...(clip?.files || [])].filter(file => /^image\//.test(file.type));
    if (!pictures.length || !app.contains(event.target) && event.target !== document.body && event.target !== document.documentElement) return;
    const typing = event.target?.closest?.('input,textarea,[contenteditable="true"]');
    if (typing && clip.getData('text/plain')) return;
    const zone = dropZoneOf(event.target)
      || event.target?.closest?.('.ref-form,details.new-refs')?.querySelector?.('[data-ref-drop]')
      || app.querySelector('[data-ref-drop]:hover')
      || app.querySelector('details[data-open-key="more:refs"][open] [data-ref-drop="ref"]');
    if (!zone || zone.querySelector('input[type="file"]')?.disabled) return;
    event.preventDefault();
    const named = pictures.map((file, at) => new File([file], `pasted-picture${at ? `-${at + 1}` : ''}.${PASTE_EXT[file.type] || 'png'}`, { type: file.type }));
    acceptFiles(zone.dataset.refDrop, named, zone);
  });
  // Send the file as an add_reference request: from the chat (shown there as a chip) or as the answer to a question that asked for it.
  async function sendUploadedReference(prefix, field) {
    if (!transport) return;
    const state = uploadStateFor(prefix, field);
    const project = current();
    const questionId = prefix === 'qref' ? field.closest('[data-qref]')?.dataset.qref : null;
    const item = questionId ? inboxQuestions.get(questionId) : null;
    const ownerJob = item ? viewOf(item.jobId) : project;
    if (!state || !ownerJob || state.busy) return;
    const scope = field.closest('[data-qref],[data-aref]') || app;
    const note = scope.querySelector(`[name="${prefix}_note"]`);
    const text = scope.querySelector(`[name="${prefix}_text"]`);
    if (note) state.note = note.value;
    if (text) state.text = text.value;
    const checked = newJobReferenceItem(state);
    if (checked.error) { state.error = checked.error; render(); return; }
    Object.assign(state, { busy: true, error: '', message: '' });
    render();
    try {
      let assets = null;
      if (artifactMode() && globalThis.claude?.use) {
        try { assets = await globalThis.claude.use('assets'); } catch { assets = null; }
      }
      const reference = await encodeReferenceUpload(assets, { type: state.type, file: state.file, text: state.text, note: state.note, role: state.role });
      const requestId = randomId(globalThis);
      const args = { requestId, brand: ownerJob.brand, jobId: ownerJob.jobId, expectedRevision: ownerJob.revision, reference, ...(ownerJob.title ? { title: ownerJob.title } : {}), ...(prefix === 'aref' ? { to: agentBoxState(ownerJob).chat || agentBoxState(ownerJob).to || 'producer' } : {}), ...(questionId ? { questionId } : {}) };
      const result = await transport.call('add_reference', args);
      Object.assign(state, { busy: false, file: null, fileName: '', text: '', note: '', role: '', typeTouched: false, open: false, message: result?.message || 'Sent to Claude.' });
      if (questionId) state.type = item?.wantsUpload?.type || 'picture';
      notify(result?.status === 'requested' ? 'File sent to Claude.' : (result?.message || 'File saved.'));
      render();
      await refresh();
    } catch (e) {
      Object.assign(state, { busy: false, error: e.message || 'Could not send that file.' });
      render();
    }
  }
  app.addEventListener('error', event => {
    const picture = event.target;
    if (!(picture instanceof HTMLImageElement) || picture.dataset.postThumb === undefined) return;
    failedPostThumbs.add(picture.getAttribute('src'));
    picture.remove();
  }, true);
  app.addEventListener('toggle', event => {
    if (event.target?.matches?.('details.new-refs')) newRefsOf().open = event.target.open;
    if (event.target?.matches?.('details[data-kit-paste]')) { const ui = folderUiOf(true); if (ui) ui.pasteOpen = event.target.open; }
  }, true);
  app.addEventListener('input', event => {
    const name = event.target?.name;
    if (name === 'nref_note' || name === 'nref_text') { captureNewRefInputs(newRefsOf()); return; }
    if (name === 'aref_note' || name === 'aref_text' || name === 'qref_note' || name === 'qref_text') {
      const state = uploadStateFor(name.startsWith('aref') ? 'aref' : 'qref', event.target);
      if (state) state[name.endsWith('note') ? 'note' : 'text'] = event.target.value;
      return;
    }
    if (name !== 'ref_note' && name !== 'ref_text' && name !== 'ref_link') return;
    const project = currentRefProject();
    if (project) captureRefInputs(refStateFor(project));
  });
  app.addEventListener('change', event => {
    const name = event.target?.name;
    if (name === 'ref_type' || name === 'ref_file') onRefChange(event.target);
    if (name === 'nref_type' || name === 'nref_file') onNewRefChange(event.target);
    if (name === 'aref_type' || name === 'aref_file') onUploadFieldChange('aref', event.target);
    if (name === 'qref_type' || name === 'qref_file') onUploadFieldChange('qref', event.target);
  });
  function openInline(value) { captureInlineValues(); if(inline && value && inline !== value) inlineDrafts.set(draftKey(inline), inline); const requested=value || defaultInline(); inline=inlineDrafts.get(draftKey(requested)) || requested; render(); const field=app.querySelector('#inline-form input:not([type="hidden"]),#inline-form select,#inline-form textarea'); if(inline?.kind==='onboard'){jumpTo(ONBOARDING_SECTION);field?.focus({preventScroll:true});}else field?.focus(); }
  app.addEventListener('click', async event=>{
    // A Team row on home is a link to the job the person is on; the thread is set open first, then the link goes there.
    const teamRow=event.target.closest('[data-team-open]');
    if(teamRow){openTeamThread(teamRow.dataset.teamJob,teamRow.dataset.teamOpen);return;}
    // A Needs-you card opens its job when the click lands on the card itself, not on a button, link or answer box inside it.
    const card=event.target.closest('[data-card-job]');
    if(card&&!event.target.closest('a,button,input,textarea,select,label,form,video,[data-view-media]')){location.hash='#/project/'+encodeURIComponent(card.dataset.cardJob);return;}
    const target=event.target.closest('button,[data-action],[data-onboard],[data-project],[data-artifact],[data-tab],[data-review-action],[data-mr-action],[data-kit-action],[data-photo-action],[data-recipe-save],[data-ref-action],[data-ref-role],[data-ref-brand],[data-nref-action],[data-nref-remove],[data-aref-action],[data-qref-send],[data-ref-open],[data-ref-remove],[data-ref-keep],[data-ref-confirm],[data-ref-unqueue]');if(!target)return;
    if(target.dataset.arefAction==='toggle'){const shown=current();if(shown){const state=agentBoxState(shown).attach||=freshNewJobRefs();state.open=!state.open;state.error='';render();}return;}
    if(target.dataset.arefAction==='send'){void sendUploadedReference('aref',target);return;}
    if(target.dataset.qrefSend!==undefined){void sendUploadedReference('qref',target);return;}
    if(target.dataset.nrefAction==='add'){const state=newRefsOf();state.open=true;queueNewRef(state);render();return;}
    if(target.dataset.nrefRemove!==undefined){const state=newRefsOf();state.items=(state.items||[]).filter((_,index)=>String(index)!==target.dataset.nrefRemove);state.error='';render();return;}
    if(target.dataset.refRole!==undefined){
      const prefix=target.dataset.refPrefix;
      const scope=target.closest('.ref-form')||app;
      const state=prefix==='ref'?(currentRefProject()?refStateFor(currentRefProject()):null):prefix==='nref'?newRefsOf():uploadStateFor(prefix,target);
      if(state){
        const note=scope.querySelector(`[name="${prefix}_note"]`);const text=scope.querySelector(`[name="${prefix}_text"]`);
        if(note)state.note=note.value;if(text)state.text=text.value;
        state.role=state.role===target.dataset.refRole?'':target.dataset.refRole;
        if(prefix==='nref')state.open=true;
        render();
      }
      return;
    }
    if(target.dataset.refBrand!==undefined){const refProject=currentRefProject();if(refProject){const state=refStateFor(refProject);state.brandPick=state.brandPick===target.dataset.refBrand?'':target.dataset.refBrand;render();}return;}
    if(target.dataset.refAction==='brand'){const refProject=currentRefProject();if(refProject)void submitBrandReference(refProject);return;}
    if(target.dataset.refOpen!==undefined){const refProject=currentRefProject();const ref=refProject?.references?.find(item=>item.id===target.dataset.refOpen);if(!ref)return;captureInlineValues();returnFocus=target;returnSelector=`[data-ref-open="${CSS.escape(ref.id)}"]`;viewer={ref};render();app.querySelector('.viewer-close')?.focus();return;}
    if(target.dataset.refRemove!==undefined){const refProject=currentRefProject();if(refProject){const state=refStateFor(refProject);state.confirm=target.dataset.refRemove;state.removeError='';render();app.querySelector(`[data-ref-keep="${CSS.escape(target.dataset.refRemove)}"]`)?.focus();}return;}
    if(target.dataset.refKeep!==undefined){const refProject=currentRefProject();if(refProject){refStateFor(refProject).confirm=null;render();app.querySelector(`[data-ref-remove="${CSS.escape(target.dataset.refKeep)}"]`)?.focus();}return;}
    if(target.dataset.refConfirm!==undefined){const refProject=currentRefProject();if(refProject)void removeSavedReference(refProject,target.dataset.refConfirm);return;}
    if(target.dataset.refUnqueue!==undefined){const refProject=currentRefProject();if(refProject){const state=refStateFor(refProject);state.queue=state.queue.filter((_,index)=>String(index)!==target.dataset.refUnqueue);state.error='';render();}return;}
    if(target.dataset.refAction==='send'){const refProject=currentRefProject();if(refProject)void submitReference(refProject);return;}
    if(target.dataset.publishToggle!==undefined){
      const key=target.dataset.publishToggle;
      if(openKeys.has(key))openKeys.delete(key);else openKeys.add(key);
      render();
      app.querySelector(`[data-publish-toggle="${CSS.escape(key)}"]`)?.focus({preventScroll:true});
      return;
    }
    if(target.dataset.postDismiss!==undefined){markPostHandled(target.dataset.postDismiss);render();return;}
    // A held control only says so with aria-disabled (so focus stays where it was): it does nothing.
    if(target.getAttribute('aria-disabled')==='true'&&(target.dataset.postTypeSave!==undefined||target.dataset.postTimeSave!==undefined||target.dataset.postTimeOpen!==undefined||target.dataset.postTimeCancel!==undefined)){event.preventDefault();return;}
    if(target.dataset.postTypeSave!==undefined){const shown=current();if(shown)void submitPostType(shown,target.dataset.postTypeSave);return;}
    if(target.dataset.postTimeSave!==undefined){const shown=current();if(shown)void submitPostTime(shown,target.dataset.postTimeSave);return;}
    if(target.dataset.postTimeOpen!==undefined){const shown=current();if(shown)openPostTime(shown,target.dataset.postTimeOpen,true);return;}
    if(target.dataset.postTimeCancel!==undefined){const shown=current();if(shown)openPostTime(shown,target.dataset.postTimeCancel,false);return;}
    if(target.dataset.postAnswer!==undefined){const shown=current();if(shown)void submitResolvePost(shown,target.dataset.postId,target.dataset.postAnswer);return;}
    if(target.dataset.kitDownloadAll!==undefined){[...app.querySelectorAll('.posting-kit a.kit-download')].forEach((link,at)=>setTimeout(()=>link.click(),at*350));return;}
    if(target.dataset.postCopy!==undefined){void copyPostLink(target.dataset.postCopy,target.dataset.postUrl||'');return;}
    if(target.dataset.postCopyDone!==undefined){closePostFallback(target.dataset.postCopyDone);return;}
    if(target.dataset.kitCopy!==undefined){const shown=current();const at=target.dataset.kitCopy.lastIndexOf(':');if(shown&&at>0)void copyKitText(shown,target.dataset.kitCopy.slice(0,at),target.dataset.kitCopy.slice(at+1));return;}
    if(target.dataset.kitFallbackClose!==undefined){const shown=current();const at=target.dataset.kitFallbackClose.lastIndexOf(':');if(shown&&at>0)closeKitFallback(shown,target.dataset.kitFallbackClose.slice(0,at),target.dataset.kitFallbackClose.slice(at+1));return;}
    if(target.dataset.kitMark!==undefined){const shown=current();if(shown)void submitMarkPosted(shown,target.dataset.kitMark);return;}
    if(target.dataset.kitAction){
      captureInlineValues();
      captureInlineValues();
      const kit = ensureInlineKit();
      const brandForKit = inline?.brand ? (data.brands || []).find(item => item.slug === inline.brand) : null;
      const projected = brandForKit?.kit || {};
      const action = target.dataset.kitAction;
      if (action === 'add-folder') { void submitFolderAdd(); return; }
      if (action === 'pick-folder') { void submitFolderPick(); return; }
      if (action.endsWith('-font')) Object.assign(kit, { fontError: '', fontStatus: '' });
      if (action === 'dismiss-folder') { dismissFolder(Number(target.dataset.index)); return; }
      if (action === 'add-color') {
        kit.palette = (Array.isArray(kit.palette) ? kit.palette : (projected.palette || [])).map(c => ({...c}));
        if (kit.palette.length < KIT_LIMITS.maxColors) kit.palette.push({ value: '#000000', role: 'other' });
        inline.kitFocus = kitFocusSelector('add-color', null, kit.palette.length);
      } else if (action === 'remove-color') {
        kit.palette = (Array.isArray(kit.palette) ? kit.palette : (projected.palette || [])).map(c => ({...c}));
        const removedIndex = Number(target.dataset.index);
        kit.palette.splice(removedIndex, 1);
        inline.kitFocus = kitFocusSelector('remove-color', removedIndex, kit.palette.length);
      } else if (action === 'add-font') {
        kit.fonts = (Array.isArray(kit.fonts) ? kit.fonts : (projected.fonts || [])).map(f => ({...f}));
        if (kit.fonts.length < KIT_LIMITS.maxFonts) kit.fonts.push({ family: '', use: 'other' });
        inline.kitFocus = kitFocusSelector('add-font', null, kit.fonts.length);
      } else if (action === 'remove-font') {
        kit.fonts = (Array.isArray(kit.fonts) ? kit.fonts : (projected.fonts || [])).map(f => ({...f}));
        const removedIndex = Number(target.dataset.index);
        kit.fonts.splice(removedIndex, 1);
        inline.kitFocus = kitFocusSelector('remove-font', removedIndex, kit.fonts.length);
      } else if (action === 'remove-logo') {
        kit.logo = { action: 'remove' };
        inline.kitFocus = kitFocusSelector('remove-logo');
      } else if (action === 'use-logo') {
        // Use this: a logo the kit suggested from the brand's own places becomes the logo. Only its id is sent; the picture is already on this computer.
        const pick = (Array.isArray(projected.suggested?.logos) ? projected.suggested.logos : []).find(item => item?.id === target.dataset.id);
        if (pick) kit.logo = { action: 'suggested', id: pick.id, previewDataUrl: pick.thumb || null, places: suggestedLogoPlaces(Array.isArray(pick.sources) && pick.sources.length ? pick.sources : [pick.source]), error: null };
        inline.kitFocus = kitFocusSelector('use-logo');
      } else if (action === 'pass-logo') {
        // Not this: the suggestion is set aside for this visit, and the next one (if any) is offered.
        kit.logoPassed = [...(Array.isArray(kit.logoPassed) ? kit.logoPassed : []), target.dataset.id];
        inline.kitFocus = kitFocusSelector('pass-logo');
      } else if (action === 'remove-ref') {
        kit.references = (Array.isArray(kit.references) ? kit.references : []).filter((_, at) => at !== Number(target.dataset.index));
        inline.kitFocus = kitFocusSelector('remove-ref');
      }
      render();
      return;
    }
    if(target.dataset.onboard){
      const brand=(data.brands || []).find(item=>item.slug===target.dataset.onboard);
      if(!brand)return;
      if(inline?.kind === 'onboard' && inline.brand === brand.slug){captureInlineValues();render();jumpTo(ONBOARDING_SECTION);return;}
      openInline(onboardDraft(brand));
      return;
    }
    if(target.dataset.inboxAnswer!==undefined){void answerQuestion(target.dataset.inboxAnswer,{choice:Number(target.dataset.choice)});return;}
    if(target.dataset.inboxType!==undefined){openAnswerBox(target.dataset.inboxType);return;}
    if(target.dataset.inboxCancel!==undefined){closeAnswerBox(target.dataset.inboxCancel);return;}
    if(target.dataset.abOpen!==undefined){
      let about=null;
      try{about=target.dataset.abAbout?JSON.parse(target.dataset.abAbout):null;}catch{about=null;}
      // "@owner" opens the thread of whoever made the file the message is about.
      const shown=current();
      const who=target.dataset.abOpen==='@owner'?ownerOfFile(shown?agentBoxOf(docFor(shown))?.all:[],about?.path):target.dataset.abOpen;
      openChat(who,target.dataset.abDraft||'',about);
      return;
    }
    if(target.dataset.abAboutClear!==undefined){const shown=current();if(shown){agentBoxState(shown).about=null;render();focusQuietly('#ab-text');}return;}
    if(target.dataset.abBack!==undefined){closeChat();return;}
    if(target.dataset.abGate!==undefined){leaveChatForJump();jumpToGate(target.dataset.abGate);return;}
    // Show all / Minimal above the steps: every done card opens or folds at once; the waiting step and the quiet rows stay as they are.
    if(target.dataset.stops!==undefined){const open=target.dataset.stops==='all';for(const card of app.querySelectorAll('.stg.s-done details.stg-d')){card.open=open;const key=card.dataset.openKey;if(key){if(open)openKeys.add(key);else openKeys.delete(key);}}return;}
    if(target.dataset.inboxJump!==undefined){leaveChatForJump();jumpFromInbox(target.dataset.inboxJump, target.dataset.inboxTarget);return;}
    if(target.dataset.metricoolChange!==undefined){metricoolUi.open.add(target.dataset.metricoolChange);metricoolUi.errors.delete(target.dataset.metricoolChange);render();app.querySelector(`[data-metricool-brand="${CSS.escape(target.dataset.metricoolChange)}"]`)?.focus();return;}
    if(target.dataset.metricoolCancel!==undefined){metricoolUi.open.delete(target.dataset.metricoolCancel);metricoolUi.picks.delete(target.dataset.metricoolCancel);metricoolUi.errors.delete(target.dataset.metricoolCancel);render();return;}
    if(target.dataset.metricoolSave!==undefined){void submitMetricoolBrand(target.dataset.metricoolSave);return;}
    if(target.dataset.bankRemove!==undefined){void submitBankRemove(target.dataset.bankBrand,target.dataset.bankRemove);return;}
    if(target.dataset.connect){void submitConnectorAction('connect_provider', target.dataset.connect);return;}
    if(target.dataset.project){location.hash='#/project/'+encodeURIComponent(target.dataset.project);return;}
    if(target.dataset.abRetry!==undefined){const shown=current();if(shown)void submitRetryStep(shown);return;}
    if(target.dataset.handoff&&target.dataset.handoffJob){void submitHandoff(target.dataset.handoffJob,target.dataset.handoff);return;}
    if(target.dataset.artifact!==undefined){returnFocus=target;returnSelector=`[data-artifact="${CSS.escape(target.dataset.artifact)}"]`;drawer=current()?.artifacts?.[Number(target.dataset.artifact)];drawerTab='output';render();app.querySelector('.drawer button')?.focus();return;}
    if(target.dataset.tab){drawerTab=target.dataset.tab;render();app.querySelector(`[data-tab="${drawerTab}"]`)?.focus();return;}
    if(target.dataset.viewMedia){const src=safePreviewUrl(target.dataset.viewMedia);if(!src)return;captureInlineValues();returnFocus=target;returnSelector=`[data-view-media="${CSS.escape(target.dataset.viewMedia)}"]`;viewer={src,alt:target.dataset.viewAlt || ''};render();app.querySelector('.viewer-close')?.focus();return;}
    if(target.dataset.sbPanel!==undefined){panelAction('select', target.dataset.sbPanel);return;}
    if(target.dataset.sbAction){panelAction(target.dataset.sbAction);return;}
    if(target.dataset.mrAction){mediaPanelAction(target.dataset.mrAction, target.dataset.mrKey);return;}
    if(target.dataset.flagAccept||target.dataset.flagUndo){flagAction(target.dataset.flagAccept || target.dataset.flagUndo, Boolean(target.dataset.flagAccept));return;}
    if(target.dataset.conceptOpen!==undefined){event.preventDefault();openConceptPanel(target.dataset.conceptOpen,target.dataset.conceptFocus,target);return;}
    if(target.dataset.conceptClose!==undefined){closeConceptPanel();return;}
    if(target.dataset.conceptChoose!==undefined){chooseConceptFromPanel(target.dataset.conceptChoose);return;}
    if(target.dataset.industryToggle!==undefined){toggleIndustryList();return;}
    if(target.dataset.hookAdd!==undefined){startHookEdit(target.dataset.hookAdd,'new');return;}
    if(target.dataset.hookEdit!==undefined){const cut=target.dataset.hookEdit.lastIndexOf(':');startHookEdit(target.dataset.hookEdit.slice(0,cut),Number(target.dataset.hookEdit.slice(cut+1)));return;}
    if(target.dataset.hookSave!==undefined){saveHookEdit();return;}
    if(target.dataset.hookCancel!==undefined){cancelHookEdit();return;}
    if(target.dataset.hookDrop!==undefined){dropHookLine();return;}
    if(target.dataset.pickAdd!==undefined){startPickEdit(target.dataset.pickAdd);return;}
    if(target.dataset.pickSave!==undefined){savePickEdit();return;}
    if(target.dataset.pickCancel!==undefined){cancelPickEdit();return;}
    if(target.dataset.pickDrop!==undefined){dropPickOwn(target.dataset.pickDrop,target.dataset.pickId);return;}
    if(target.dataset.reviewAction){void reviewAction(target.dataset.reviewAction, target.dataset.ref);return;}
    if(target.dataset.recipeSave){const project=current();if(project)void submitRecipe(project, target.dataset.recipeSave);return;}
    if(target.dataset.workspaceAction){workspaceAction(target.dataset.workspaceAction);return;}
    if(target.dataset.reportDownload){void saveReport(target.dataset.reportDownload);return;}
    switch(target.dataset.action){
      case'refresh':await refresh();break;
      case'update-board':await requestBoardUpdate();break;
      case'start-research':await submitInline(null,'start');break;
      case'close':close();break;
      case'jobs':openInline(newJobDraft());inlineDrafts.delete('new');break;
      case'brand':{const brand=(data.brands || []).find(item=>!brandReady(item));openInline(onboardDraft(brand || null));break;}
      case'connectors':connectorsView=true;render();globalThis.scrollTo?.(0,0);break;
      case'connectors-close':connectorsView=false;render();break;
      case'connectors-continue':await continueConnectors();break;
      case'signal':try{const result=await transport?.signal?.('Notify Claude');notify(result?.message || NOTE_NOTIFY_FAILED);render();}catch(e){notify(e.message);}break;
      case'not-right':{const shown=current();if(!shown)break;try{const result=await transport?.signal?.(notRightMessage(shown));if(result?.status==='sent'){planNotes.set(shown.jobId,{key:`${shown.kind}|${shown.kindReason}`,sent:true});try{await transport?.markPlanNote?.(shown);}catch{/* The note still shows for this visit. */}}notify(result?.status==='sent'?'The Director has been told. Watch Needs you.':(result?.message || NOTE_NOTIFY_FAILED));render();}catch(e){notify(e.message);}break;}
      case'remind':await remindRequest(target.dataset.requestId);break;
      case'source':
        { const p=current(); const jobLabel=p?.title || 'this job'; const brandLabel=p?.brandName || 'the selected brand'; try { const result=await transport?.signal?.(`Please select the local source files for ${jobLabel} for ${brandLabel} in Claude.`); notify(result?.message || 'Ask Claude in chat to pick the source files.'); render(); } catch(e) { notify(e.message); } }
        break;
    }
  });
  // Patch one field's live error state directly in the DOM (no full render,
  // so focus and scroll position are undisturbed) and keep inline.fieldErrors
  // in sync so a later render() does not resurrect a message the person
  // already fixed.
  function fieldErrorId(name) { return name === 'name' ? 'field-name-error' : `channel-${name}-error`; }
  // On the brand's details page an empty channel is fine (it is not answered yet), so the live check only flags a link that is filled in wrongly.
  function liveChannelError(name, value, unavailable) {
    const onDetails = app.querySelector('#inline-form')?.dataset.onboardStep === 'details';
    if (onDetails && !normalizeChannelInput(name, value)) return null;
    return channelFieldError(name, value, unavailable);
  }
  // Start research turns on as soon as the page has a name and a website or one social account, and says what is missing until then.
  function syncStartResearch() {
    const button = app.querySelector('[data-action="start-research"]');
    const form = app.querySelector('#inline-form');
    if (!button || !form) return;
    const values = Object.fromEntries(new FormData(form));
    form.querySelectorAll('input[type="checkbox"]').forEach(field => { values[field.name] = field.checked; });
    const minimum = researchMinimum(values);
    button.disabled = !minimum.ok || Boolean(inline?.busy || inline?.submitted || inline?.needsReconciliation);
    const hint = app.querySelector('[data-start-hint]');
    if (hint) hint.textContent = minimum.ok ? RESEARCH_READY_HINT : minimum.message;
  }
  function updateFieldErrorUI(name, message) {
    if (inline?.fieldErrors) {
      if (message) inline.fieldErrors[name] = message;
      else delete inline.fieldErrors[name];
    }
    const input = app.querySelector(name === 'name' ? '#inline-form input[name="name"]' : '#channel-' + name);
    if (!input) return;
    const errorId = fieldErrorId(name);
    let errorEl = document.getElementById(errorId);
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', errorId);
      if (!errorEl) {
        errorEl = document.createElement('p');
        errorEl.className = 'field-error';
        errorEl.id = errorId;
        errorEl.setAttribute('role', 'alert');
        input.insertAdjacentElement('afterend', errorEl);
      }
      errorEl.textContent = message;
    } else {
      input.setAttribute('aria-invalid', 'false');
      input.removeAttribute('aria-describedby');
      errorEl?.remove();
    }
  }
  // Normalize a channel field the moment focus leaves it, so a bare domain or
  // handle becomes a real URL before the person ever sees a validation error,
  // and re-check that one field live so a fixed error clears immediately.
  app.addEventListener('blur', event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || field.type !== 'text') return;
    if (field.name === 'name') {
      updateFieldErrorUI('name', String(field.value || '').trim() ? null : NOTE_BRAND_NAME);
      return;
    }
    if (!CHANNEL_NAMES.includes(field.name)) return;
    const normalized = normalizeChannelInput(field.name, field.value);
    if (normalized !== field.value) field.value = normalized;
    updateFieldErrorUI(field.name, liveChannelError(field.name, field.value, field.disabled));
    syncStartResearch();
  }, true);
  function stopRequestWatch(active) {
    if (typeof active?.requestUnsubscribe === 'function') active.requestUnsubscribe();
    if (active) active.requestUnsubscribe = null;
  }
  function watchRequest(active) {
    stopRequestWatch(active);
    if (!transport?.subscribeRequest || !active?.requestId) return;
    active.requestUnsubscribe = transport.subscribeRequest(active.requestId, receipt => {
      const ownsDraft = inline === active || inlineDrafts.get(draftKey(active)) === active;
      if (!receipt || !ownsDraft) return;
      const isCurrent = inline === active;
      const acknowledgement = receipt.artifactReceipt || receipt;
      const result = acknowledgement.result || receipt.result || {};
      const status = String(acknowledgement.status || receipt.status || result.status || 'requested');
      if (status === 'applied') {
        stopRequestWatch(active);
        active.busy = false;
        if (active.kind === 'onboard' && !active.finalizingOnboarding) {
          // The three steps keep this same card open: creating the brand turns the
          // name form into the brand's own page, saving details leaves it as it is,
          // and starting research moves its button and notice through Researching...
          // to Save and continue. Capture the brand's slug (a brand-new draft had
          // none yet) so the later saves update this same brand, and clear this
          // request's own bookkeeping so the pending notice steps aside.
          const action = active.action || 'start';
          if (!active.brand && inlineDrafts.get('onboard:new') === active) inlineDrafts.delete('onboard:new');
          active.brand = result.brand?.slug || active.brand;
          if (action === 'start') active.researchRequested = true;
          if (action === 'create') { active.edited = {}; active.unlocked = {}; }
          active.submitted = false;
          active.needsReconciliation = false;
          active.requestId = null;
          active.message = '';
          active.submittedAt = null;
          active.lastReminderAt = null;
          active.reminding = false;
          active.operation = null;
          active.args = null;
          active.action = null;
          notify(acknowledgement.message || receipt.message || result.message || (action === 'create' ? 'Brand created. Add its details.' : action === 'details' ? 'Details saved.' : 'Saved. The Director is researching this brand.'));
          if (action === 'details') {
            // What was typed is saved: once the board has read it back, the form follows the saved copy again, and the kit edits
            // (logo, colours, fonts) are the saved ones. The photos wait for Start research, so they stay.
            void refresh().then(() => {
              active.edited = {}; active.unlocked = {};
              if (active.kit) { delete active.kit.logo; delete active.kit.palette; delete active.kit.fonts; }
              if (inline === active) render();
            });
          } else {
            if (action === 'start') { active.edited = {}; active.unlocked = {}; }
            void refresh();
          }
          if (isCurrent) render();
        } else {
          inlineDrafts.delete(draftKey(active));
          if (isCurrent) inline = null;
          notify(acknowledgement.message || receipt.message || result.message || 'Claude applied the request to this board.');
          void refresh().then(() => { if (result.jobId) location.hash = '#/project/' + encodeURIComponent(result.jobId); });
        }
      } else if (status === 'declined') {
        // A final, non-error state: stop watching, clear busy/pending, and
        // leave the same form open (with a fresh request id) so the person
        // can start a new request without navigating away.
        stopRequestWatch(active);
        active.busy = false;
        active.submitted = false;
        active.needsReconciliation = false;
        active.error = '';
        active.declined = true;
        active.requestId = null;
        active.message = acknowledgement.message || receipt.message || NOTE_DECLINED;
        active.submittedAt = null;
        active.lastReminderAt = null;
        active.reminding = false;
        active.operation = null;
        active.args = null;
        notify(active.message);
        if (isCurrent) render();
      } else if (['needs_reconciliation','error','failed','rejected'].includes(status)) {
        if (status === 'rejected' && (acknowledgement.noMutation === true || receipt.noMutation === true)) stopRequestWatch(active);
        active.busy = false;
        active.submitted = false;
        active.needsReconciliation = !(status === 'rejected' && (acknowledgement.noMutation === true || receipt.noMutation === true));
        if (!active.needsReconciliation) active.requestId = null;
        active.error = acknowledgement.message || receipt.message || receipt.error || result.message || 'Could not apply this. Check the form and retry.';
        active.message = active.needsReconciliation ? 'Claude must check this request first.' : '';
        active.submittedAt = null;
        active.lastReminderAt = null;
        active.reminding = false;
        if (isCurrent) render();
      } else {
        active.submitted = true;
        active.submittedAt ||= Date.now();
        scheduleReminderWake(active);
        active.message = acknowledgement.message || receipt.message || result.message || NOTE_SAVED;
        if (isCurrent) render();
      }
    }, error => {
      const isCurrent = inline === active;
      if (!isCurrent && inlineDrafts.get(draftKey(active)) !== active) return;
      active.busy = false;
      active.submitted = true;
      active.submittedAt ||= Date.now();
      scheduleReminderWake(active);
      active.message = 'Saved. Updates resume when Claude reconnects.';
      active.error = error?.message || '';
      if (isCurrent) render();
    });
  }
  function scheduleReminderWake(state) {
    if (!state) return;
    clearTimeout(state.reminderTimer);
    const waitSince = state.lastReminderAt || state.submittedAt;
    if (!Number.isFinite(waitSince)) return;
    const delay = Math.max(0, REMIND_DELAY_MS - (Date.now() - waitSince)) + 200;
    state.reminderTimer = setTimeout(() => {
      state.reminderTimer = null;
      if (state.requestId) { captureInlineValues(); render(); }
    }, delay);
  }
  function findPendingStateByRequestId(requestId) {
    if (inline?.requestId === requestId) return inline;
    for (const draft of inlineDrafts.values()) { if (draft.requestId === requestId) return draft; }
    for (const ui of jobUi.values()) {
      if (ui?.intake?.requestId === requestId) return ui.intake;
      if (ui?.review?.requestId === requestId) return ui.review;
      if (ui?.route?.requestId === requestId) return ui.route;
      if (ui?.agentBox?.send?.requestId === requestId) return ui.agentBox.send;
      if (ui?.agentBox?.retry?.requestId === requestId) return ui.agentBox.retry;
      for (const post of Object.values(ui?.posts || {})) { if (post?.requestId === requestId) return post; }
    }
    for (const state of questionUi.values()) { if (state.requestId === requestId) return state; }
    return null;
  }
  async function remindRequest(requestId) {
    if (!requestId || !transport?.signal) return;
    const state = findPendingStateByRequestId(requestId);
    if (!state || state.reminding) return;
    captureInlineValues();
    state.reminding = true;
    render();
    try {
      const result = await transport.signal('Remind Claude', { requestId, operation: state.operation, args: state.args });
      notify(result?.message || 'Claude was notified again.');
    } catch (e) {
      notify(e.message);
    } finally {
      state.reminding = false;
      state.lastReminderAt = Date.now();
      scheduleReminderWake(state);
      render();
    }
  }
  // The Metricool brand picked on the onboarding form travels with the request only when it is a pick the brand does not already have.
  function metricoolPickArgs(values, brand) {
    const picked = typeof values.metricoolBlogId === 'string' ? values.metricoolBlogId.trim() : '';
    const saved = brand?.publishing?.optedOut ? NO_METRICOOL : brand?.publishing && brand.publishing.found !== false ? brand.publishing.blogId : '';
    return picked && picked !== saved && (picked === NO_METRICOOL || (data.metricoolBrands || []).some(item => item.id === picked)) ? { metricoolBlogId: picked } : {};
  }
  // Whether the person touched the logo, colours or fonts on this page (or added photos): only then does a request carry a kit.
  function kitTouched(kit, { photos = true } = {}) {
    return Boolean(kit && (kit.logo?.action || Array.isArray(kit.palette) || Array.isArray(kit.fonts) || (photos && Array.isArray(kit.references) && kit.references.length)));
  }
  // The brand's page in three steps (see inlineOnboardingForm): `mode` is 'start' when Start research was pressed; a plain submit of the details
  // page saves the details. The new-brand form sends `create_brand`; a brand that already did research keeps `onboard_brand` (Save and continue).
  async function submitInline(event, mode = null) {
    event?.preventDefault();
    const active = inline;
    const form = event?.target instanceof HTMLFormElement ? event.target : app.querySelector('#inline-form');
    if (!form) return;
    const values = Object.fromEntries(new FormData(form));
    form.querySelectorAll('input[type="checkbox"]').forEach(field => { values[field.name] = field.checked; });
    if (active?.kind === 'onboard') {
      for (const name of CHANNEL_NAMES) values[name] = normalizeChannelInput(name, values[name]);
    }
    if (!active || active.busy) return;
    if (active.needsReconciliation) { active.error = NOTE_NEEDS_CHECK; render(); return; }
    const currentBrand = active.kind === 'onboard' && active.brand ? (data.brands || []).find(item => item.slug === active.brand) : null;
    const researchPhase = active.kind === 'onboard' ? brandResearchPhase(currentBrand, active) : null;
    if (researchPhase === 'running') { active.error = 'The Director is still researching this brand.'; render(); return; }
    if (active.kind === 'onboard' && active.brand && !currentBrand) return;
    let action = null;
    if (active.kind === 'onboard') {
      action = !currentBrand ? 'create' : researchPhase === 'new' ? (mode === 'start' ? 'start' : 'details') : 'finish';
      if (action === 'create') {
        const named = brandNameArgs(values.name);
        if (named.error) { active.values = values; active.fieldErrors = { name: named.error }; active.error = ''; render(); return; }
        active.fieldErrors = null;
        active.finalizingOnboarding = false;
        values.name = named.name;
      } else {
        // Every field is editable, so a field the person changed counts as theirs (a cleared one clears what research saved).
        const nameError = brandNameArgs(values.name).error;
        const fieldErrors = { ...(nameError ? { name: nameError } : {}), ...validateProfile(values, active.prefilled, ownedFields(active), { partial: action !== 'finish' }) };
        if (Object.keys(fieldErrors).length) { active.values = values; active.fieldErrors = fieldErrors; active.error = NOTE_FIX_FIELDS; render(); return; }
        active.fieldErrors = null;
        if (action === 'start') {
          const minimum = researchMinimum(values);
          if (!minimum.ok) { active.values = values; active.error = minimum.message; render(); return; }
        }
        // A submit while the phase is already complete or failed is the finishing
        // save (see watchRequest's applied branch): once that one is applied, the
        // card closes and the board moves on, rather than staying open for a
        // research pass that already ran its course.
        active.finalizingOnboarding = action === 'finish';
        const kitErrors = validateKit(active.kit || {});
        if (Object.keys(kitErrors).length) { active.values = values; active.kitErrors = kitErrors; active.error = NOTE_FIX_FIELDS; render(); return; }
        active.kitErrors = null;
      }
    } else {
      const checked = newJobArgs(values, { brands: data.brands || [], requestId: 'pending' });
      if (checked.errors) {
        active.values = values; active.fieldErrors = checked.errors; active.error = ''; render();
        app.querySelector('#inline-form [aria-invalid="true"]')?.focus();
        return;
      }
      active.fieldErrors = null;
      // A reference still sitting in the control when Send is pressed goes with the job, as if it had been added.
      const pending = active.refs;
      if (pending && (pending.file || (pending.type === 'caption' && String(pending.text || '').trim())) && !queueNewRef(pending)) {
        pending.open = true; active.error = ''; render();
        return;
      }
    }
    const requestId = active.requestId ||= randomId(globalThis);
    const operation = active.kind !== 'onboard' ? 'create_job'
      : action === 'create' ? 'create_brand'
      : action === 'details' ? 'save_brand_details'
      : action === 'start' ? 'start_research'
      : 'onboard_brand';
    let args;
    if (active.kind !== 'onboard') args = newJobArgs(values, { brands: data.brands || [], requestId }).args;
    else if (action === 'create') args = { requestId, name: values.name };
    else if (action === 'details') {
      // Photos are not saved with the details: they go in with Start research.
      const kit = kitTouched(active.kit, { photos: false }) ? kitPayload(currentBrand, { ...active.kit, references: [] }) : null;
      if (kit) delete kit.references;
      args = { requestId, brand: active.brand, profile: detailsProfile(values), ...(kit ? { kit } : {}) };
    } else if (action === 'start') {
      args = { requestId, brand: active.brand, profile: detailsProfile(values), ...metricoolPickArgs(values, currentBrand), ...(kitTouched(active.kit) ? { kit: kitPayload(currentBrand, active.kit || {}) } : {}) };
    } else {
      // The name goes as the brand has it now; a changed name is its own request (below).
      args = { requestId, name: currentBrand?.name || String(values.name).trim(), ...(active.brand ? { brand: active.brand } : {}), profile: buildProfile(values, active.prefilled, ownedFields(active)), ...metricoolPickArgs(values, currentBrand), kit: kitPayload(currentBrand, active.kit || {}) };
    }
    // A name changed on the brand's page is saved with whichever Save was pressed.
    const renaming = active.kind === 'onboard' && action !== 'create' && nameChanged(currentBrand, values.name) ? submitBrandRename(currentBrand, values.name) : null;
    active.operation = operation; active.args = args; active.action = action;
    active.values = values; active.pendingName = values.name; active.busy = true; active.error = ''; active.declined = false; render();
    try {
      if (active.kind !== 'onboard' && active.refs?.items?.length) args.references = await encodeNewRefs(active.refs);
      // The finishing save closes the page, and the answer to the rename must be seen first: it goes after the rename is applied (with the
      // new name, which the save checks against the brand's), and a refused rename leaves the page open on the refusal with nothing else sent.
      if (renaming && action === 'finish') {
        if (!await renaming) { active.busy = false; active.requestId = null; render(); return; }
        args.name = brandNameArgs(values.name).name;
      }
      const result = await transport.call(operation, args);
      active.busy = false;
      if (result?.status && result.status !== 'applied' && !result.brand && !result.jobId) {
        active.submitted = result.status === 'requested';
        active.signal = result.signal || null;
        if (active.submitted) { active.submittedAt ||= Date.now(); scheduleReminderWake(active); }
        active.message = result.message || (result.status === 'requested'
          ? NOTE_SAVED
          : result.status === 'declined'
            ? NOTE_DECLINED
            : 'Claude needs attention before applying this.');
        if (result.status === 'requested') watchRequest(active);
        else if (result.status === 'declined') {
          // Final, non-error state: leave the form open with a clean slate
          // (fresh request id on the next submit) instead of an error state.
          active.needsReconciliation = false;
          active.error = '';
          active.declined = true;
          active.requestId = null;
        } else { active.needsReconciliation = true; active.error = NOTE_NEEDS_CHECK; }
        notify(active.message);
        await refresh();
        return;
      }
      stopRequestWatch(active);
      if (active.refs === starterRefs) starterRefs = freshNewJobRefs();
      inline = null;
      notify(result?.message || 'Saved to your workspace.');
      await refresh();
      if (result?.jobId) location.hash = '#/project/' + encodeURIComponent(result.jobId);
    } catch (e) { active.busy = false; active.error = e.message; inline = active; render(); }
  }
  // The brand's name is an input on its page. A changed name is sent with the next Save as `brand_rename`; only the display name changes (the
  // folder keeps its original name), and the page shows a note once Claude has applied it.
  function renameStateOf() { return inline && inline.kind === 'onboard' ? (inline.rename ||= { busy: false, error: '' }) : null; }
  // Every field is editable, so a field the person changed counts as theirs: clearing one clears what research saved for it.
  function ownedFields(draft) { return { ...(draft?.unlocked || {}), ...Object.fromEntries(Object.keys(draft?.edited || {}).map(name => [name, true])) }; }
  // Whether the name box holds a different valid name than the brand has now (and no rename is already on its way).
  function nameChanged(brand, raw) {
    const named = brandNameArgs(raw);
    return Boolean(brand) && !named.error && named.name !== brand.name && !renameStateOf()?.busy;
  }
  // Resolves true once Claude has applied the rename, false when it was refused or could not be sent. The answer goes to the page that asked
  // (`draft`), not to whatever page is open when it arrives, so it is never lost.
  async function submitBrandRename(brand, raw) {
    const draft = inline;
    const state = renameStateOf();
    const named = brandNameArgs(raw);
    if (!state || state.busy || !transport || named.error || named.name === brand.name) return false;
    state.error = ''; state.busy = true; draft.renamedNote = '';
    const requestId = randomId(globalThis);
    let answer;
    const answered = new Promise(resolve => { answer = resolve; });
    const done = (patch, note = '') => { Object.assign(state, { busy: false, ...patch }); draft.renamedNote = note; render(); answer(!patch.error); };
    try {
      const result = await transport.call('brand_rename', { requestId, brand: brand.slug, name: named.name });
      notify(result?.message || 'Saved. Claude will rename the brand.');
      let unsubscribe = null;
      const stop = () => { if (typeof unsubscribe === 'function') unsubscribe(); unsubscribe = null; };
      unsubscribe = transport.subscribeRequest?.(requestId, receipt => {
        if (!receipt) return;
        const acknowledgement = receipt.artifactReceipt || receipt;
        const status = String(acknowledgement.status || receipt.status || 'requested');
        if (status === 'applied') { stop(); done({ error: '' }, 'Name saved.'); void refresh(); }
        else if (status === 'declined') { stop(); done({ error: String(acknowledgement.message || receipt.message || NOTE_NO_RENAME).replace(/^Declined in chat\. Nothing was changed\.\s*/i, '') || NOTE_NO_RENAME }); }
        else if (['needs_reconciliation', 'error', 'failed', 'rejected'].includes(status)) { stop(); done({ error: acknowledgement.message || receipt.message || 'Could not rename. Claude must check first.' }); }
      }, () => {});
    } catch (e) {
      done({ error: e.message || NOTE_SEND_FAILED });
    }
    return answered;
  }
  function readIntakeForm(form) {
    const formData = new FormData(form);
    const values = {};
    for (const [name, value] of formData.entries()) if (name !== 'platforms' && name !== 'intake-photo-file') values[name] = value;
    if (form.querySelector('[name="platforms"]')) values.platforms = formData.getAll('platforms');
    return values;
  }
  async function submitIntake(form, project = current()) {
    const inboxForm = form.dataset.inboxIntake !== undefined;
    if (!project || (!inboxForm && !project.intake) || !transport) return;
    const state = uiFor(project).intake;
    if (state.busy || state.submitted || state.needsReconciliation) return;
    state.values = inboxForm ? { ...(state.values || {}), ...readIntakeForm(form) } : readIntakeForm(form);
    state.inboxField = inboxForm ? form.dataset.inboxField || null : null;
    const requestId = state.requestId || randomId(globalThis);
    const { args, errors } = inboxForm
      ? inboxIntakeArgs(project, state.values, String(form.dataset.inboxFields || '').split(' ').filter(Boolean), { requestId, required: form.dataset.inboxField || null, items: inboxBriefs.get(project.jobId) || [] })
      : intakeArgs(project, state.values, requestId);
    if (errors) {
      state.errors = errors;
      state.error = errors.form ? '' : NOTE_FIX_ANSWERS;
      render();
      const own = state.inboxField ? `[data-inbox-field="${CSS.escape(state.inboxField)}"]` : '';
      app.querySelector(inboxForm ? `[data-inbox-intake="${CSS.escape(project.jobId)}"]${own} [aria-invalid="true"]` : '#intake-form [aria-invalid="true"]')?.focus();
      return;
    }
    Object.assign(state, { errors: null, error: '', declined: false, busy: true, requestId, operation: 'update_intake', args });
    render();
    try {
      const result = await transport.call('update_intake', args);
      state.busy = false;
      if (result?.status === 'requested') {
        state.submitted = true;
        state.submittedAt ||= Date.now();
        scheduleReminderWake(state);
        state.message = result.message || '';
        state.signal = result.signal || null;
        watchJobRequest(project.jobId, 'intake', state);
        render();
      } else {
        state.requestId = null;
        notify(result?.message || 'Answers saved.');
        await refresh();
      }
    } catch (e) {
      Object.assign(state, { busy: false, requestId: null, error: e.message });
      render();
    }
  }
  // Opening lines on a concept card: add one, edit one, or take one back. They live in the review state only (ownLines, editedLines and
  // the box being typed in, hookEdit); the approval carries them in its note (see decisionArgs) and nothing is saved from here.
  const hookKey = (id, at) => `${id}:${at}`;
  // The concept panel ("View details"): which concept it shows is state.conceptPanel, so it survives every redraw (editing an opening
  // line inside it redraws the review). It is drawn inside the review, so the pick and opening-line handlers reach it; it only overlays.
  let conceptOpener = null;
  const conceptShell = () => { const project = current(); return project ? { project, state: uiFor(project).review } : null; };
  function openConceptPanel(id, focus, opener) {
    const found = conceptShell();
    if (!found) return;
    conceptOpener = opener?.closest?.('[data-concept-open]') ? { selector: `[data-concept-open="${CSS.escape(id)}"]${opener.dataset.conceptFocus ? `[data-concept-focus="${CSS.escape(opener.dataset.conceptFocus)}"]` : ':not([data-concept-focus])'}` } : null;
    found.state.conceptPanel = id;
    render();
    const panel = app.querySelector('.cc-panel');
    if (!panel) return;
    panel.classList.add('is-entering');
    app.querySelector('.cc-scrim')?.classList.add('is-entering');
    const body = panel.querySelector('.cc-panel-body');
    const target = focus === 'hooks' ? (panel.querySelector('[data-cc-sec="hooks"] input:checked') || panel.querySelector('[data-cc-sec="hooks"] button:not(:disabled)')) : null;
    if (focus === 'why') panel.querySelector('[data-cc-sec="why"]')?.scrollIntoView({ block: 'start' });
    (target || panel.querySelector('.cc-x') || panel).focus({ preventScroll: true });
    if (body && focus !== 'why') body.scrollTop = 0;
  }
  function closeConceptPanel() {
    const found = conceptShell();
    if (!found || !found.state.conceptPanel) return;
    const id = found.state.conceptPanel;
    found.state.conceptPanel = null;
    render();
    const back = (conceptOpener && app.querySelector(conceptOpener.selector)) || app.querySelector(`[data-concept-open="${CSS.escape(id)}"]`);
    conceptOpener = null;
    back?.focus({ preventScroll: true });
  }
  // "Choose this concept" in the panel is the same as clicking the concept's radio, then the panel closes.
  function chooseConceptFromPanel(id) {
    const found = conceptShell();
    if (!found || found.state.busy || found.state.submitted) return;
    found.state.choice = id;
    found.state.error = '';
    closeConceptPanel();
  }
  function toggleIndustryList() {
    const found = conceptShell();
    if (!found) return;
    const open = !(found.state.industryOpen || found.state.strategyEdit?.row === 'industry');
    found.state.industryOpen = open;
    if (!open && found.state.strategyEdit?.row === 'industry') found.state.strategyEdit = null;
    render();
    app.querySelector('[data-industry-toggle]')?.focus({ preventScroll: true });
  }
  function hookTarget() {
    const project = current();
    if (!project) return null;
    const state = uiFor(project).review;
    if (state.busy || state.submitted || state.needsReconciliation || state.settled) return null;
    return { project, state };
  }
  function hookConcept(project, id) {
    return docFor(project)?.review?.concepts?.concepts?.find(item => item.id === id) || null;
  }
  function focusHook(selector) {
    const element = app.querySelector(selector);
    if (!element) return;
    element.focus({ preventScroll: true });
    if (element.matches('input[type="text"]')) { try { element.setSelectionRange(element.value.length, element.value.length); } catch { /* No selection here. */ } }
  }
  function startHookEdit(id, at) {
    const found = hookTarget();
    const concept = found && hookConcept(found.project, id);
    if (!concept) return;
    const { lines } = hookLinesOf(concept, { own: found.state.ownLines, edited: found.state.editedLines });
    if (at !== 'new' && !lines[at]) return;
    found.state.hookEdit = { id, at, text: at === 'new' ? '' : lines[at].text };
    render();
    focusHook(`[data-hook-input="${CSS.escape(hookKey(id, at))}"]`);
  }
  function cancelHookEdit() {
    const found = hookTarget();
    const edit = found?.state.hookEdit;
    if (!edit) return;
    found.state.hookEdit = null;
    render();
    focusHook(edit.at === 'new' ? `[data-hook-add="${CSS.escape(edit.id)}"]` : `[data-hook-edit="${CSS.escape(hookKey(edit.id, edit.at))}"]`);
  }
  function saveHookEdit() {
    const found = hookTarget();
    const edit = found?.state.hookEdit;
    if (!edit) return;
    const concept = hookConcept(found.project, edit.id);
    if (!concept) { found.state.hookEdit = null; render(); return; }
    const done = applyHookEdit(found.state, concept);
    if (done.error) { edit.error = done.error; render(); focusHook(`[data-hook-input="${CSS.escape(hookKey(edit.id, edit.at))}"]`); return; }
    render();
    focusHook(`input[name="hook_choice_${CSS.escape(edit.id)}"][value="${done.pick}"]`);
  }
  function dropHookLine() {
    const found = hookTarget();
    const edit = found?.state.hookEdit;
    const concept = edit && hookConcept(found.project, edit.id);
    if (!concept || !dropHookEdit(found.state, concept)) return;
    render();
    focusHook(`[data-hook-add="${CSS.escape(edit.id)}"]`);
  }
  // Strategy picks on a concept card or the industry row: add an option of one's own (the box being typed in is state.strategyEdit, see
  // applyPickEdit). Picking a chip is the change handler's. Nothing is saved from here; the approval carries the picks in its note.
  function startPickEdit(rowKey) {
    const found = hookTarget();
    const parts = found ? pickRowParts(rowKey) : null;
    if (!parts || (parts.id !== null && !hookConcept(found.project, parts.id))) return;
    found.state.strategyEdit = { row: rowKey, text: '' };
    if (parts.id !== null) openKeys.add(`strategy-picks:${parts.id}`);
    render();
    focusHook(`[data-pick-input="${CSS.escape(rowKey)}"]`);
  }
  function cancelPickEdit() {
    const found = hookTarget();
    const edit = found?.state.strategyEdit;
    if (!edit) return;
    found.state.strategyEdit = null;
    render();
    focusHook(`[data-pick-add="${CSS.escape(edit.row)}"]`);
  }
  // The small x on an option added in this review: it goes, and the row goes back to its default when it was the pick.
  function dropPickOwn(rowKey, id) {
    const found = hookTarget();
    if (!found || !dropPickOption(found.state, rowKey, id)) return;
    render();
    focusHook(`[data-pick-add="${CSS.escape(rowKey)}"],[data-pick-input="${CSS.escape(rowKey)}"]`);
  }
  function savePickEdit() {
    const found = hookTarget();
    const edit = found?.state.strategyEdit;
    if (!edit) return;
    const parts = pickRowParts(edit.row);
    const doc = docFor(found.project);
    const done = applyPickEdit(found.state, strategyOptionsOf(doc), parts?.id ? hookConcept(found.project, parts.id) : null);
    if (done.error) { edit.error = done.error; render(); focusHook(`[data-pick-input="${CSS.escape(edit.row)}"]`); return; }
    render();
    focusHook(`input[name="pick_${CSS.escape(edit.row)}"][value="${CSS.escape(done.pick)}"]`);
  }
  async function submitDecision(project, verdict) {
    const state = uiFor(project).review;
    if (!transport || state.busy || state.submitted || state.needsReconciliation || state.settled) return;
    const comment = app.querySelector('#review-comment')?.value ?? state.comment ?? '';
    state.comment = comment;
    // An opening line still being typed is not part of the approval: ask for it to be saved or dropped first, so it is never lost quietly.
    if (verdict === 'approve' && state.hookEdit && cleanHookLine(state.hookEdit.text)) { state.error = 'Save or cancel your opening line first.'; render(); return; }
    if (verdict === 'approve' && state.strategyEdit && cleanHookLine(state.strategyEdit.text)) { state.error = 'Save or cancel your option first.'; render(); return; }
    const requestId = state.requestId || randomId(globalThis);
    const { args, error } = decisionArgs({ project, doc: docFor(project), verdict, choice: state.choice, comment, requestId, recipeState: uiFor(project).recipe, panels: state.panels || {}, accepted: state.accepted || {}, hooks: state.hooks || {}, own: state.ownLines || {}, edited: state.editedLines || {}, strategyPicks: state.strategyPicks || {}, strategyOwn: state.strategyOwn || {} });
    if (error) { state.error = error; render(); return; }
    Object.assign(state, { requestId, busy: true, verdict, error: '', declined: false, operation: 'submit_decision', args });
    render();
    try {
      const result = await transport.call('submit_decision', args);
      Object.assign(state, { busy: false, submitted: true, submittedAt: state.submittedAt || Date.now(), message: result?.message || '', signal: result?.signal || null });
      // The request is written: the note went with it, so the box starts empty for whatever review comes next.
      clearReviewDrafts(state);
      scheduleReminderWake(state);
      if (artifactMode()) { rememberSentDecision(project.jobId, state.requestId); watchJobRequest(project.jobId, 'review', state); }
      render();
    } catch (e) {
      // A refusal because the card is no longer the latest shows the plain line and loads the latest card.
      const changed = changedRefusal(e.message);
      Object.assign(state, { busy: false, requestId: null, error: changed ? CHANGED_LINE : e.message });
      render();
      if (changed) { void resyncLive(); void refresh(); }
    }
  }
  async function submitRecipe(project, deliverableId) {
    const ui = uiFor(project);
    const status = (ui.recipeStatus[deliverableId] ||= {});
    if (!transport || status.busy || status.submitted) return;
    if (!recipeReady(ui.recipe, deliverableId)) { status.error = 'Choose all five copy choices before saving.'; render(); return; }
    const requestId = status.requestId || randomId(globalThis);
    const args = { requestId, brand: project.brand, jobId: project.jobId, deliverable: deliverableId, picks: recipePicks(ui.recipe, deliverableId), title: project.title };
    Object.assign(status, { requestId, busy: true, error: '', declined: false });
    render();
    try {
      const result = await transport.call('choose_recipe', args);
      Object.assign(status, { busy: false, submitted: true, message: result?.message || '', signal: result?.signal || null });
      if (artifactMode()) watchJobRequest(`${project.jobId}:${deliverableId}`, 'recipe', status);
      render();
    } catch (e) {
      Object.assign(status, { busy: false, requestId: null, error: e.message });
      render();
    }
  }
  // A route choice in flight: what was picked, the request, and the route the plan had when it was made. It follows the
  // decision pattern: the watch stays on until a receipt, and a soft notice with Notify Claude shows after the remind
  // delay. Further choices are held while one is pending, so a retry never queues behind it.
  function routeStateOf(project) {
    const ui = uiFor(project);
    return (ui.route ||= {});
  }
  function dropRoute(jobId, state) {
    clearTimeout(state.reminderTimer);
    Object.assign(state, { pending: null, busy: false, submitted: false, applied: false, requestId: null, sentRequestId: null, sentAt: null, fromRoute: undefined, submittedAt: null, lastReminderAt: null, reminding: false, reminderTimer: null, operation: null, args: null });
    stopJobRequestWatch(jobId + ':route');
  }
  async function submitPublishRoute(project, route) {
    const state = routeStateOf(project);
    clearTimeout(state.keyTimer);
    state.draft = null;
    const plan = docFor(project)?.review?.publish;
    if (!transport || !plan || state.pending || cardBusy(project)) return;
    if ((route === plan.route && !plan.outdated) || (plan.routes || []).some(item => item.id === route && item.available === false)) { render(); return; }
    const requestId = randomId(globalThis);
    const args = publishRouteArgs({ project, route, requestId });
    Object.assign(state, { requestId, sentRequestId: requestId, pending: route, fromRoute: plan.route, busy: true, applied: false, error: '', notice: '', declined: false, shownRoute: undefined, operation: 'choose_publish_route', args });
    render();
    try {
      const result = await transport.call('choose_publish_route', publishRouteArgs({ project, route, requestId }));
      if (state.requestId !== requestId) return;
      state.busy = false;
      if (artifactMode()) {
        Object.assign(state, { submitted: true, submittedAt: Date.now(), signal: result?.signal || null });
        state.sentAt = state.submittedAt;
        watchJobRequest(project.jobId, 'route', state);
        scheduleReminderWake(state);
      } else {
        dropRoute(project.jobId, state);
        await refresh();
      }
      render();
    } catch (e) {
      if (state.requestId !== requestId) return;
      routeEnded(project.jobId, state, 'error', e.message);
      render();
    }
  }
  // A radio moved with an arrow key is saved after a short pause, so passing over a route on the way to another
  // does not send it. A pointer click, Space and Enter save at once.
  function publishRouteChange(project, field) {
    const state = routeStateOf(project);
    if (state.pending || field.getAttribute('aria-disabled') === 'true') { state.arrowMove = false; setTimeout(render, 0); return; }
    clearTimeout(state.keyTimer);
    if (state.arrowMove) {
      state.arrowMove = false;
      state.draft = field.value;
      state.keyTimer = setTimeout(() => { void submitPublishRoute(project, field.value); }, PUBLISH_ROUTE_KEY_PAUSE_MS);
      return;
    }
    void submitPublishRoute(project, field.value);
  }
  // The Agent Box's own page state: which chat is open, who the composer is addressed to, the unsent draft, and the two requests it can send.
  function agentBoxState(project) {
    const ui = uiFor(project);
    return (ui.agentBox ||= { to: '', draft: '', drafts: {}, chat: null, error: '', send: {}, retry: {}, handoff: {} });
  }
  // ---- the Inbox and the chats: opening and closing a chat, a draft for each agent, and keeping each list where it was scrolled ----
  // undefined: the Brand onboarding page opens the Director's chat by itself when it has something to say; null: the person went back to the Inbox.
  let onboardChat;
  const narrowScreen = narrowWidth;
  function capturePaneScroll() {
    const saved = new Map();
    app.querySelectorAll('[data-scroll]').forEach(pane => saved.set(pane.dataset.scroll, { top: pane.scrollTop, end: pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40 }));
    return saved;
  }
  // A chat opens at its newest message and stays there while the person is reading the end; the Inbox keeps its place.
  function restorePaneScroll(saved) {
    app.querySelectorAll('[data-scroll]').forEach(pane => {
      const was = saved.get(pane.dataset.scroll);
      const chat = pane.dataset.scroll.startsWith('chat-');
      if (was) pane.scrollTop = chat && was.end ? pane.scrollHeight : was.top;
      else if (chat) pane.scrollTop = pane.scrollHeight;
    });
  }
  // `draft` is a start for the message ("Change the idea: "); a message the person already began is kept.
  // `about` is what the message will be about when it starts from a frame's or a file's "Ask for changes" ({ label, path?, revision?, panel? }); it shows as a chip in the composer.
  function openChat(id, draft = '', about = null) {
    const project = current();
    if (!project) { onboardChat = id; render(); focusQuietly('#ab-chat-title'); return; }
    const box = agentBoxState(project);
    if (box.chat) box.drafts[box.chat] = box.draft;
    const subject = agentAboutOf(about);
    Object.assign(box, { chat: id, to: id, draft: box.drafts[id] || draft, error: '', ...(subject ? { about: { revision: project.revision, ...subject } } : box.to === id ? {} : { about: null }) });
    render();
    focusQuietly('#ab-chat-title');
    // Narrow screens show the chat in the page, under the card: bring it into view.
    if (narrowScreen()) app.querySelector('.studio-side')?.scrollIntoView({ block: 'start' });
  }
  function closeChat({ focus = true } = {}) {
    const project = current();
    let was = null;
    if (project) {
      const box = agentBoxState(project);
      was = box.chat;
      if (was) box.drafts[was] = box.draft;
      Object.assign(box, { chat: null, draft: '', error: '' });
    } else { was = onboardChat === undefined ? 'producer' : onboardChat; onboardChat = null; }
    render();
    if (focus && was) focusQuietly(`[data-ab-open="${CSS.escape(was)}"]`);
  }
  // On a narrow screen the open chat takes the Team's place between the card and the steps, so it closes before a jump to the card or a step.
  function leaveChatForJump() {
    const project = current();
    if (project && agentBoxState(project).chat && narrowScreen()) closeChat({ focus: false });
  }
  // "Ask for changes", "Open details" and "Show it above" all go to the card that holds the decision (jumpTo opens any fold around it).
  function jumpToGate(gate) {
    const selector = `[data-gate="${CSS.escape(String(gate))}"]`;
    jumpTo(app.querySelector(selector) ? selector : JUMP_TARGETS.review);
  }
  const AGENT_SEND_FAILED = 'Message not saved. Try again.';
  async function submitAgentMessage(project, form) {
    const box = agentBoxState(project);
    const agents = agentBoxOf(docFor(project))?.all || [];
    box.to = form.elements.namedItem('to')?.value || box.to;
    box.draft = form.elements.namedItem('text')?.value ?? box.draft;
    const agent = agents.find(item => item.id === box.to) || agents[0];
    const state = box.send;
    if (!transport || !agent || state.busy) return;
    box.error = agentMessageProblem(box.draft, agent);
    if (box.error) { render(); focusQuietly('#ab-text'); return; }
    const requestId = randomId(globalThis);
    const args = agentMessageArgs({ project, agent: agent.id, text: box.draft, requestId, about: box.about });
    Object.assign(state, { requestId, sentRequestId: requestId, busy: true, submitted: false, needsReconciliation: false, declined: false, error: '', message: 'Saved. Claude will pass it on.', operation: 'agent_message', args });
    render();
    focusQuietly('#ab-text');
    try {
      const result = await transport.call('agent_message', args);
      if (state.requestId !== requestId) return;
      box.draft = '';
      box.about = null;
      state.busy = false;
      if (artifactMode()) {
        Object.assign(state, { submitted: true, submittedAt: Date.now(), signal: result?.signal || null });
        watchJobRequest(project.jobId, 'agent-msg', state);
        scheduleReminderWake(state);
      } else {
        await refresh();
      }
      render();
    } catch {
      if (state.requestId !== requestId) return;
      Object.assign(state, { busy: false, submitted: false, requestId: null, operation: null, args: null });
      box.error = AGENT_SEND_FAILED;
      render();
      focusQuietly('#ab-text');
    }
  }
  // The Post-production offer and return: one request, then the skill does the work. The buttons stay locked once it is saved.
  async function submitHandoff(jobId, operation) {
    const project = viewOf(jobId);
    if (!transport || !project || !HANDOFF_BUTTONS.handoff_offer.concat(HANDOFF_BUTTONS.handoff_return).some(([name]) => name === operation)) return;
    const state = agentBoxState(project).handoff;
    if (state.busy || state.sent) return;
    const requestId = randomId(globalThis);
    const args = handoffArgs({ project, requestId });
    Object.assign(state, { requestId, busy: true, error: '', operation, args });
    render();
    try {
      const result = await transport.call(operation, args);
      if (state.requestId !== requestId) return;
      Object.assign(state, { busy: false, sent: operation });
      if (artifactMode()) { state.signal = result?.signal || null; } else { await refresh(); }
      render();
    } catch {
      if (state.requestId !== requestId) return;
      Object.assign(state, { busy: false, requestId: null, operation: null, args: null, error: 'Could not save that. Try once more.' });
      render();
    }
  }
  async function submitRetryStep(project) {
    const box = agentBoxState(project);
    const state = box.retry;
    const stuck = agentBoxOf(docFor(project))?.director?.stuck;
    if (!transport || !stuck || stuck.kind !== 'internal' || state.busy || state.submitted) return;
    const requestId = randomId(globalThis);
    const args = retryStepArgs({ project, requestId });
    Object.assign(state, { requestId, sentRequestId: requestId, busy: true, submitted: false, needsReconciliation: false, declined: false, applied: false, sinceSeen: stuck.since, error: '', message: 'Saved. Claude will retry that step.', operation: 'retry_step', args });
    render();
    try {
      const result = await transport.call('retry_step', args);
      if (state.requestId !== requestId) return;
      state.busy = false;
      if (artifactMode()) {
        Object.assign(state, { submitted: true, submittedAt: Date.now(), signal: result?.signal || null });
        watchJobRequest(project.jobId, 'retry', state);
        scheduleReminderWake(state);
      } else {
        await refresh();
      }
      render();
    } catch {
      if (state.requestId !== requestId) return;
      Object.assign(state, { busy: false, requestId: null, operation: null, args: null, error: 'Could not ask Claude to retry. Try again.' });
      render();
    }
  }
  // One polite live region that outlives every redraw, so a change between two renders (an agent finishing, a reply
  // arriving) is said once.
  const agentSeen = new Map();
  function announceAgents(project) {
    const list = project ? agentBoxOf(docFor(project))?.all : null;
    if (!list) return;
    const now = new Map(list.map(agent => [agent.id, { name: agentNameOf(agent), state: agentStateOf(agent.state), answered: (agent.messages || []).filter(message => message?.status === 'answered').length }]));
    const before = agentSeen.get(project.jobId);
    agentSeen.set(project.jobId, now);
    if (!before) return;
    const lines = [];
    for (const [id, agent] of now) {
      const was = before.get(id);
      if (!was) continue;
      if (was.state !== agent.state) lines.push(`The ${agent.name} is now ${AGENT_STATES[agent.state].label.toLowerCase()}.`);
      if (agent.answered > was.answered) lines.push(`The ${agent.name} answered your message.`);
    }
    if (!lines.length) return;
    let live = document.getElementById('agent-live');
    if (!live) {
      live = document.createElement('div');
      live.id = 'agent-live';
      live.className = 'visually-hidden';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      document.body.append(live);
    }
    live.textContent = lines.join(' ');
  }
  function postStateOf(project, postId) {
    const ui = uiFor(project);
    return ((ui.posts ||= {})[postId] ||= {});
  }
  // Send one post's request (the answer to "Is this post in Metricool?", or Mark as posted) and follow it to its receipt,
  // like a route choice: it stays pending until the board shows the result, never times out, and a decline is said in place.
  async function sendPostRequest(project, postId, kind, operation, args) {
    const state = postStateOf(project, postId);
    if (!transport || state.pending) return;
    // A post type or a posting time is a request on the posting card, which holds everything while one is out.
    if ((kind === 'type' || kind === 'time') && cardBusy(project)) return;
    const requestId = randomId(globalThis);
    const sent = { ...args, requestId };
    Object.assign(state, { kind, requestId, sentRequestId: requestId, pending: kind, busy: true, applied: false, error: '', notice: '', declined: false, endedKind: undefined, operation, args: sent });
    render();
    try {
      const result = await transport.call(operation, sent);
      if (state.requestId !== requestId) return;
      state.busy = false;
      if (artifactMode()) {
        Object.assign(state, { submitted: true, submittedAt: Date.now(), signal: result?.signal || null });
        state.sentAt = state.submittedAt;
        watchJobRequest(project.jobId, 'post:' + postId, state);
        scheduleReminderWake(state);
      } else {
        dropPost(project.jobId, postId, state);
        await refresh();
      }
      render();
    } catch (e) {
      if (state.requestId !== requestId) return;
      postEnded(project.jobId, postId, state, 'error', e.message);
      render();
    }
  }
  async function submitResolvePost(project, postId, answer) {
    if (answer !== 'in_metricool' && answer !== 'not_in_metricool') return;
    const row = (docFor(project)?.publishStatus?.posts || []).find(item => item?.id === postId);
    if (!row || row.status !== 'needs_check' || typeof row.lid !== 'string' || !row.lid) return;
    await sendPostRequest(project, postId, 'resolve', 'resolve_post', resolvePostArgs({ project, postId, answer, requestId: '', lid: row.lid }));
  }
  // The post type of a post planned before post types existed. Nothing is sent without a choice from the list the plan shows.
  async function submitPostType(project, postId) {
    const state = postStateOf(project, postId);
    const field = app.querySelector(`[data-post-type="${CSS.escape(postId)}"]`);
    if (field) state.typePick = field.value;
    const post = (docFor(project)?.review?.publish?.posts || []).find(item => item?.id === postId);
    const kinds = Array.isArray(post?.typeChoices) ? post.typeChoices : [];
    if (!post || typeof post.deliverable !== 'string' || !post.deliverable || !kinds.length) return;
    if (!kinds.some(item => item?.value === state.typePick)) { state.typeError = POST_TYPE_NEEDED_LINE; render(); focusQuietly(`[data-post-type="${CSS.escape(postId)}"]`); return; }
    state.typeError = '';
    await sendPostRequest(project, postId, 'type', 'choose_post_type', postTypeArgs({ project, deliverable: post.deliverable, placement: state.typePick, requestId: '' }));
  }
  // The posting time of a post on the Schedule route. What was typed is checked here first, with the server's own words, so a time
  // that is past or too soon is answered at once; nothing is sent for a time that is already the plan's.
  async function submitPostTime(project, postId) {
    const state = postStateOf(project, postId);
    const field = app.querySelector(`[data-post-time="${CSS.escape(postId)}"]`);
    if (field) state.timePick = field.value;
    const plan = docFor(project)?.review?.publish;
    const all = postId === ALL_POSTS;
    const post = all ? null : (plan?.posts || []).find(item => item?.id === postId);
    const input = all ? plan?.allTime : post?.when?.input;
    if (!input?.zone || (!all && (!post || typeof post.deliverable !== 'string' || !post.deliverable))) return;
    const problem = postTimeProblem(state.timePick, { zone: input.zone, zoneWords: input.zoneWords });
    if (problem) { state.timeError = problem; render(); focusQuietly(`[data-post-time="${CSS.escape(postId)}"]`); return; }
    state.timeError = '';
    if (state.timePick === input.dateTime) { Object.assign(state, { timeOpen: false, timePick: '' }); render(); focusQuietly(`[data-post-time-open="${CSS.escape(postId)}"]`); return; }
    state.fromTime = timeSignature(plan, postId);
    // One request for every post when it is the card's own field: the deliverable is left out and the server sets them all at once.
    if (all) { await sendPostRequest(project, postId, 'time', 'choose_post_time', postTimeArgs({ project, dateTime: state.timePick, requestId: '' })); return; }
    await sendPostRequest(project, postId, 'time', 'choose_post_time', postTimeArgs({ project, deliverable: post.deliverable, dateTime: state.timePick, requestId: '' }));
  }
  function openPostTime(project, postId, open) {
    const state = postStateOf(project, postId);
    if (cardBusy(project)) return;
    Object.assign(state, { timeOpen: open, timeError: '', ...(open ? {} : { timePick: '' }) });
    render();
    focusQuietly(open ? `[data-post-time="${CSS.escape(postId)}"]` : `[data-post-time-open="${CSS.escape(postId)}"]`);
  }
  async function submitMarkPosted(project, postId) {
    const state = postStateOf(project, postId);
    const field = app.querySelector(`[data-kit-link="${CSS.escape(postId)}"]`);
    if (field) state.link = field.value;
    const problem = markLinkProblem(state.link);
    if (problem) { state.linkError = problem; render(); focusQuietly(`[data-kit-link="${CSS.escape(postId)}"]`); return; }
    state.linkError = '';
    if (!(docFor(project)?.postingKit?.posts || []).some(item => item?.id === postId && !item.marked)) return;
    await sendPostRequest(project, postId, 'mark', 'mark_posted', markPostedArgs({ project, postId, link: state.link, requestId: '' }));
  }
  // Copy a kit text. The clipboard may not be allowed inside the artifact, so a refusal (or no clipboard at all) opens a
  // read-only box with the text already selected, for the person to copy by hand.
  async function copyKitText(project, postId, field) {
    const post = (docFor(project)?.postingKit?.posts || []).find(item => item?.id === postId);
    const text = field === 'caption' ? post?.text : field === 'comment' ? post?.firstComment : '';
    if (!post || typeof text !== 'string' || !text) return;
    const state = postStateOf(project, postId);
    clearTimeout(state.copyTimer);
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') { await navigator.clipboard.writeText(text); copied = true; }
    } catch { copied = false; }
    if (copied) {
      Object.assign(state, { copied: field, fallback: null });
      // Focus goes back to the button only when it was on it, or had fallen to the page: never when the person moved on.
      state.copyTimer = setTimeout(() => {
        const button = `[data-kit-copy="${CSS.escape(postId + ':' + field)}"]`;
        const active = document.activeElement;
        const keep = !active || active === document.body || Boolean(active.matches?.(button));
        state.copied = null;
        state.copyTimer = null;
        render();
        if (keep) focusQuietly(button);
      }, KIT_COPIED_MS);
    } else {
      Object.assign(state, { copied: null, fallback: field });
    }
    render();
    if (copied) { focusQuietly(`[data-kit-copy="${CSS.escape(postId + ':' + field)}"]`); return; }
    const box = app.querySelector(`[data-kit-fallback="${CSS.escape(postId + ':' + field)}"]`);
    if (box) { box.focus({ preventScroll: true }); box.select(); }
  }
  function closeKitFallback(project, postId, field) {
    const state = postStateOf(project, postId);
    if (state.fallback === field) state.fallback = null;
    render();
    focusQuietly(`[data-kit-copy="${CSS.escape(postId + ':' + field)}"]`);
  }
  // Copy a post link from a Brand library card. The copy starts inside the click, as the clipboard asks. The clipboard may not be allowed inside the
  // artifact, so a refusal (or no clipboard at all) opens a read-only box with the link already selected, for the person to copy by hand.
  async function copyPostLink(key, url) {
    const copy = libraryUi.copy;
    clearTimeout(copy.timer);
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') { await navigator.clipboard.writeText(url); copied = true; }
    } catch { copied = false; }
    copy.hint = copyHint(typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent, Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches));
    Object.assign(copy, copied ? { copied: key, fallback: null } : { copied: null, fallback: key });
    if (copied) copy.timer = setTimeout(() => { copy.copied = null; copy.timer = null; render(); }, KIT_COPIED_MS);
    render();
    if (copied) { focusQuietly(`[data-post-copy="${CSS.escape(key)}"]`); return; }
    const box = app.querySelector(`[data-post-fallback="${CSS.escape(key)}"]`);
    if (box) { box.focus({ preventScroll: true }); box.select(); }
  }
  function closePostFallback(key) {
    if (libraryUi.copy.fallback === key) libraryUi.copy.fallback = null;
    render();
    focusQuietly(`[data-post-copy="${CSS.escape(key)}"]`);
  }
  let postWake = null;
  // "It is not in Metricool" opens at checkAfter, so the page is drawn again then.
  function schedulePostWake(project) {
    clearTimeout(postWake);
    postWake = null;
    const doc = project ? docFor(project) : null;
    const times = (doc?.publishStatus?.posts || []).map(post => Date.parse(post?.checkAfter?.at || '')).filter(at => Number.isFinite(at) && at > Date.now());
    if (times.length) postWake = setTimeout(() => { postWake = null; render(); }, Math.max(50, Math.min(...times) - Date.now() + 50));
  }
  function workspaceAction(action) {
    const project = current();
    if (!project) return;
    const state = uiFor(project).workspace;
    if (action === 'edit') { Object.assign(state, { editing: true, error: '', message: '', busy: false, submitted: false, requestId: null }); render(); focusQuietly('#studio-workspace-select'); return; }
    if (action === 'cancel') { state.editing = false; state.error = ''; render(); return; }
    if (action === 'save') void submitStudioWorkspace(project);
  }
  async function submitStudioWorkspace(project) {
    const state = uiFor(project).workspace;
    if (!transport || state.busy || state.submitted) return;
    const info = docFor(project)?.review?.studioWorkspace;
    const workspaces = info?.workspaces || [];
    const workspaceId = state.selected || info?.workspaceId || workspaces[0]?.id || '';
    if (!workspaceId) { state.error = 'Choose a workspace.'; render(); return; }
    const chosen = workspaces.find(item => item.id === workspaceId);
    const scope = state.brandDefault ? 'brand' : 'job';
    const requestId = state.requestId || randomId(globalThis);
    const args = { requestId, jobId: project.jobId, workspaceId, scope, title: project.title, workspaceName: chosen?.name };
    Object.assign(state, { requestId, busy: true, error: '', declined: false });
    render();
    try {
      const result = await transport.call('choose_studio_workspace', args);
      Object.assign(state, { busy: false, submitted: true, editing: false, message: result?.message || '', signal: result?.signal || null });
      if (artifactMode()) watchJobRequest(project.jobId, 'workspace', state);
      render();
    } catch (e) {
      Object.assign(state, { busy: false, requestId: null, error: e.message });
      render();
    }
  }
  // The changes box keeps whatever a person already typed: a panel or
  // deliverable's "Ask for changes" click appends its "P2: "/"D1: " prompt on
  // a new line instead of overwriting it, so a second click (a different
  // panel, say) never loses the first note.
  function appendChangeRef(existing, ref) {
    const text = String(existing || '');
    const prefix = `${ref}: `;
    return text.trim() ? `${text}\n${prefix}` : prefix;
  }
  async function reviewAction(action, ref) {
    const project = current();
    if (!project) return;
    const state = uiFor(project).review;
    if (action === 'changes') {
      state.commentOpen = true;
      state.error = '';
      if (ref) state.comment = appendChangeRef(state.comment, ref);
      render();
      // Same no-jump pattern as the concept cards and logo radios (inline.kitFocus
      // above): preventScroll plus an explicit nearest-only scrollIntoView, never
      // the browser's own default scroll-to-focus, which can jump the page.
      const box = app.querySelector('#review-comment');
      if (box) {
        box.focus({ preventScroll: true });
        box.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const end = box.value.length;
        try { box.setSelectionRange(end, end); } catch { /* Not every control supports a selection range. */ }
      }
      return;
    }
    if (action === 'cancel-changes') { state.commentOpen = false; state.error = ''; render(); app.querySelector('[data-review-action="changes"]')?.focus(); return; }
    if (action === 'approve') await submitDecision(project, 'approve');
    else if (action === 'send-changes' || action === 'send-panels') await submitDecision(project, 'request_changes');
  }
  function focusQuietly(selector) {
    const element = app.querySelector(selector);
    if (element) element.focus({ preventScroll: true });
    return element;
  }
  function panelAction(action, key = null) {
    const project = current();
    if (!project) return;
    const state = uiFor(project).review;
    const boards = docFor(project)?.review?.storyboards || [];
    if (!boards.length || (action !== 'select' && (state.busy || state.submitted || state.needsReconciliation))) return;
    state.panels ||= {};
    const slot = currentPanelKey(boards, state);
    if (action === 'select') {
      state.slot = key;
      state.panelEditing = null;
      state.panelError = '';
      render();
      revealCurrentCell();
      focusQuietly(`[data-sb-panel="${CSS.escape(key)}"]`);
      return;
    }
    if (action === 'change') {
      state.panelEditing = slot;
      state.panelDraft = state.panels[slot]?.note || '';
      state.panelError = '';
      state.slot = slot;
      render();
      const box = focusQuietly('#sb-note');
      if (box) { const end = box.value.length; try { box.setSelectionRange(end, end); } catch { box.blur(); box.focus({ preventScroll: true }); } }
      return;
    }
    if (action === 'cancel-change') {
      state.panelEditing = null;
      state.panelError = '';
      render();
      focusQuietly('[data-sb-action="change"]');
      return;
    }
    if (action === 'save-change') {
      const note = String(app.querySelector('#sb-note')?.value ?? state.panelDraft ?? '').trim();
      if (!note) { state.panelError = 'Say what to change in this panel.'; render(); focusQuietly('#sb-note'); return; }
      state.panels[slot] = { verdict: 'changes', note };
      state.panelEditing = null;
      state.panelDraft = '';
      state.panelError = '';
      state.slot = slot;
      state.error = '';
      render();
      revealCurrentCell();
      focusQuietly('[data-sb-action="change"]');
    }
  }
  // One card of the pictures, clips or joined-video grid: ask for a change with a note, keep it as it is, or leave the box.
  function mediaPanelAction(action, key = null) {
    const project = current();
    if (!project) return;
    const state = uiFor(project).review;
    if (state.busy || state.submitted || state.needsReconciliation) return;
    state.mediaPanels ||= {};
    if (action === 'change') {
      state.mediaEditing = key;
      state.mediaDraft = state.mediaPanels[key]?.note || '';
      state.mediaError = '';
      render();
      const box = focusQuietly('#mr-note');
      if (box) { const end = box.value.length; try { box.setSelectionRange(end, end); } catch { box.blur(); box.focus({ preventScroll: true }); } }
      return;
    }
    if (action === 'cancel') { state.mediaEditing = null; state.mediaError = ''; render(); return; }
    if (action === 'undo') { delete state.mediaPanels[key]; state.error = ''; render(); return; }
    if (action === 'save') {
      const note = String(app.querySelector('#mr-note')?.value ?? state.mediaDraft ?? '').trim();
      if (!note) { state.mediaError = NOTE_SAY_CHANGE; render(); focusQuietly('#mr-note'); return; }
      state.mediaPanels[key] = { verdict: 'changes', note };
      state.mediaEditing = null;
      state.mediaDraft = '';
      state.mediaError = '';
      state.error = '';
      render();
    }
  }
  function flagAction(id, accept) {
    const project = current();
    if (!project || !id) return;
    const state = uiFor(project).review;
    if (state.busy || state.submitted || state.needsReconciliation) return;
    state.accepted ||= {};
    if (accept) state.accepted[id] = true; else delete state.accepted[id];
    state.error = '';
    render();
    focusQuietly(accept ? `[data-flag-undo="${CSS.escape(id)}"]` : `[data-flag-accept="${CSS.escape(id)}"]`);
  }
  // Job-page fields keep their values in the page state as they are typed, so a
  // board refresh never loses them; ticking a platform redraws its format rows.
  function intakeEdit(field) {
    const form = field.closest?.('#intake-form,[data-inbox-intake]');
    if (!form) return null;
    const jobId = form.dataset.inboxIntake ?? current()?.jobId;
    const project = jobId ? projectById(jobId) : null;
    if (!project) return null;
    const state = uiFor(project).intake;
    const read = readIntakeForm(form);
    state.values = form.id === 'intake-form' ? read : { ...(state.values || {}), ...read };
    const twins = [app.querySelector('#intake-form'), ...app.querySelectorAll('[data-inbox-intake]')]
      .filter(other => other && other !== form && (other.dataset.inboxIntake ?? current()?.jobId) === jobId);
    for (const other of twins) {
      const twin = other.elements.namedItem(field.name);
      if (!twin || field.type === 'file') continue;
      if (twin instanceof RadioNodeList) [...twin].forEach(item => { if (item.value === field.value) item.checked = field.checked; });
      else if (twin.type === 'checkbox') twin.checked = field.checked;
      else twin.value = field.value;
    }
    return { form, project, state };
  }
  // The question under each row follows the choices: rebuilt from the rows as they stand now, removed once a
  // post type that fits is chosen. A red rule from the router stays until the answer is saved.
  function refreshPlacementAsks(form) {
    const rows = [...(form?.querySelectorAll('[data-deliv-row]') || [])];
    const read = rowElement => {
      const select = rowElement.querySelector('select[name$="_placement"]');
      const format = rowElement.querySelector('select[name$="_format"]');
      if (!select || !format) return null;
      return { element: rowElement, platform: select.dataset.platform, options: JSON.parse(select.dataset.options || '[]'), ratios: JSON.parse(select.dataset.ratios || '[]'), format: format.value, placement: select.value };
    };
    const read1 = rows.map(read).filter(Boolean);
    placementAsks(read1).forEach((ask, index) => {
      const note = read1[index].element.querySelector('.deliv-note[data-ask]');
      if (!note) return;
      if (!ask) { note.remove(); return; }
      note.textContent = ask.text;
      note.className = `${ask.kind === 'conflict' ? 'field-error' : 'field-hint'} deliv-note`;
    });
  }
  app.addEventListener('input', event => {
    const field = event.target;
    if (field.dataset?.brandName !== undefined) {
      const state = renameStateOf();
      if (state?.error) { state.error = ''; field.setAttribute('aria-invalid', 'false'); document.getElementById('field-name-error')?.remove(); }
    }
    const answerForm = field.closest?.('[data-inbox-form]');
    if (answerForm) { questionState(answerForm.dataset.inboxForm).draft = field.value; return; }
    if (field.closest?.('[data-ab-form]') && field.name === 'text') {
      const shown = current();
      if (!shown) return;
      const box = agentBoxState(shown);
      box.draft = field.value;
      document.getElementById('ab-count')?.replaceChildren(`${field.value.length} / ${AGENT_MESSAGE_LIMIT}`);
      if (box.error) { box.error = ''; field.removeAttribute('aria-invalid'); document.getElementById('ab-error')?.remove(); }
      return;
    }
    if (field.dataset?.kitFolder === 'path' || field.dataset?.kitFolder === 'label') {
      const ui = folderUiOf(true);
      if (ui) {
        ui[field.dataset.kitFolder] = field.value;
        if (ui.error) { ui.error = ''; document.getElementById('kit-folder-path')?.removeAttribute('aria-invalid'); document.getElementById('kit-folder-error')?.remove(); }
      }
      return;
    }
    if (intakeEdit(field)) return;
    if (inline?.kind === 'onboard' && field.closest?.('#inline-form')) {
      markContextEdited(inline, field.name);
      if (CHANNEL_NAMES.includes(field.name)) syncStartResearch();
      const limit = CONTEXT_LIMITS.text[field.name];
      const counter = limit ? document.getElementById(`context-${field.name}-count`) : null;
      if (counter) {
        const length = contextTextLength(field.value);
        counter.textContent = `${length} / ${limit}`;
        counter.classList.toggle('over', length > limit);
        counter.hidden = !contextCountShown(length, limit);
      }
      if (field.classList?.contains('context-textarea')) fitBox(field);
    }
    const project = current();
    if (!project) return;
    if (field.dataset?.postTime !== undefined) {
      if (field.getAttribute('aria-disabled') === 'true') { setTimeout(render, 0); return; }
      const state = postStateOf(project, field.dataset.postTime);
      state.timePick = field.value;
      if (state.timeError) { state.timeError = ''; field.removeAttribute('aria-invalid'); field.closest('.publish-when-edit')?.querySelector('.field-error')?.remove(); }
      return;
    }
    if (field.dataset?.kitLink !== undefined) { const state = postStateOf(project, field.dataset.kitLink); state.link = field.value; if (state.linkError) { state.linkError = ''; field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); field.closest('.kit-mark')?.querySelector('.field-error')?.remove(); } return; }
    if (field.dataset?.hookInput !== undefined) {
      const edit = uiFor(project).review.hookEdit;
      if (edit) {
        edit.text = field.value;
        if (edit.error) { edit.error = ''; field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); field.closest('.hook-form')?.querySelector('.field-error')?.remove(); }
      }
      return;
    }
    if (field.dataset?.pickInput !== undefined) {
      const edit = uiFor(project).review.strategyEdit;
      if (edit) {
        edit.text = field.value;
        if (edit.error) { edit.error = ''; field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); field.closest('.hook-form')?.querySelector('.field-error')?.remove(); }
      }
      return;
    }
    if (field.id === 'review-comment') { uiFor(project).review.comment = field.value; return; }
    if (field.id === 'sb-note') { uiFor(project).review.panelDraft = field.value; return; }
    if (field.id === 'mr-note') { uiFor(project).review.mediaDraft = field.value; return; }
    const recipeName = recipeFieldFromName(field.name);
    if (recipeName?.own) recipeFieldState(uiFor(project).recipe, recipeName.deliverableId, recipeName.field).own[recipeName.subkey] = field.value;
  });
  app.addEventListener('keydown', event => {
    const field = event.target;
    if (field instanceof HTMLInputElement && (field.dataset.kitFolder === 'path' || field.dataset.kitFolder === 'label')) {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void submitFolderAdd(); }
      return;
    }
    // The box for an opening line: Enter saves it, Escape drops it.
    if (field instanceof HTMLInputElement && field.dataset.hookInput !== undefined) {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); saveHookEdit(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelHookEdit(); }
      return;
    }
    // The box for an option of one's own on a strategy row: the same keys.
    if (field instanceof HTMLInputElement && field.dataset.pickInput !== undefined) {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); savePickEdit(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelPickEdit(); }
      return;
    }
    if (field instanceof HTMLInputElement && field.dataset.kitLink !== undefined && event.key === 'Enter') {
      event.preventDefault();
      const shown = current();
      if (shown) void submitMarkPosted(shown, field.dataset.kitLink);
      return;
    }
    if (!(field instanceof HTMLInputElement) || field.name !== 'publish_route') return;
    const project = current();
    if (!project) return;
    const state = routeStateOf(project);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') { state.arrowMove = true; return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (state.pending || field.disabled || field.getAttribute('aria-disabled') === 'true') return;
      state.arrowMove = false;
      void submitPublishRoute(project, field.value);
    }
  });
  app.addEventListener('pointerdown', event => {
    if (!event.target.closest?.('.route-card')) return;
    const project = current();
    if (project) routeStateOf(project).arrowMove = false;
  });
  app.addEventListener('change', event => {
    const field = event.target;
    // A label click is still activating its control while this change event
    // runs: redrawing synchronously would swap the control out from under the
    // browser, which then scrolls the page to the top. Redraw once it is done.
    if (field.name === 'intake-photo-file' && field.closest?.('#intake-form')) {
      const shown = current();
      if (shown) void handleIntakePhotoFile(shown, field.files?.[0] || null);
      return;
    }
    // A format change changes which post types fit it. Their options are rebuilt where they stand, keeping
    // the chosen one when it still fits, so the form is not redrawn and focus and typed text stay put.
    if (/^deliv_.+_format$/.test(field.name) && field.closest?.('#intake-form,[data-inbox-intake]')) {
      for (const select of app.querySelectorAll(`select[name="${CSS.escape(field.name.replace(/_format$/, '_placement'))}"]`)) {
        const list = placementOptionList(JSON.parse(select.dataset.options || '[]'), select.dataset.platform, field.value, JSON.parse(select.dataset.ratios || '[]'));
        const kept = list.some(option => option.value === select.value) ? select.value : '';
        select.innerHTML = placementOptionsHtml(list, kept);
        select.value = kept;
      }
      refreshPlacementAsks(field.closest('#intake-form,[data-inbox-intake]'));
    }
    if (/^deliv_.+_placement$/.test(field.name)) refreshPlacementAsks(field.closest?.('#intake-form,[data-inbox-intake]'));
    if (intakeEdit(field)) {
      if (field.name === 'platforms') setTimeout(render, 0);
      return;
    }
    if (field.name === 'metricool_brand_select') {
      metricoolUi.picks.set(field.dataset.metricoolBrand, field.value);
      setTimeout(render, 0);
      return;
    }
    const project = current();
    if (!project) return;
    if (field.name === 'concept_choice') {
      const state = uiFor(project).review;
      state.choice = field.value;
      state.error = '';
      setTimeout(render, 0);
      return;
    }
    if (field.name.startsWith('hook_choice_')) {
      // Picking an opening line also picks its concept.
      const state = uiFor(project).review;
      const id = field.name.slice('hook_choice_'.length);
      state.hooks = { ...(state.hooks || {}), [id]: Number(field.value) };
      state.choice = id;
      state.error = '';
      setTimeout(render, 0);
      return;
    }
    if (field.type === 'radio' && field.name.startsWith('pick_')) {
      // Picking a chip on a concept's row also picks its concept; the industry row belongs to the job.
      const row = field.name.slice('pick_'.length);
      const parts = pickRowParts(row);
      if (!parts) return;
      const state = uiFor(project).review;
      state.strategyPicks = { ...(state.strategyPicks || {}), [row]: field.value };
      if (parts.id !== null) state.choice = parts.id;
      state.error = '';
      setTimeout(render, 0);
      return;
    }
    if (field.name === 'publish_route') {
      publishRouteChange(project, field);
      return;
    }
    if (field.name.startsWith('publish_type:')) {
      if (field.getAttribute('aria-disabled') === 'true') { setTimeout(render, 0); return; }
      const picked = postStateOf(project, field.dataset.postType);
      picked.typePick = field.value;
      if (picked.typeError) { picked.typeError = ''; setTimeout(render, 0); }
      return;
    }
    if (field.name === 'studio_workspace_select') {
      uiFor(project).workspace.selected = field.value;
      return;
    }
    if (field.name === 'studio_workspace_brand_default') {
      uiFor(project).workspace.brandDefault = field.checked;
      return;
    }
    const recipeName = recipeFieldFromName(field.name);
    if (recipeName) {
      const state = recipeFieldState(uiFor(project).recipe, recipeName.deliverableId, recipeName.field);
      const catalog = docFor(project)?.recipeCatalog;
      if (recipeName.own) {
        state.own[recipeName.subkey] = field.value;
        if (recipeName.subkey === 'family') {
          const family = catalog?.hookFamilies?.find(item => item.code === field.value);
          state.own.mechanism = family?.mechanisms?.[0]?.code || '';
        }
        if (recipeName.subkey === 'family' || recipeName.subkey === 'style') setTimeout(render, 0);
      } else {
        state.pick = field.value;
        if (field.value === RECIPE_OWN_VALUE && !Object.keys(state.own || {}).length) Object.assign(state.own, defaultRecipeOwn(recipeName.field, catalog));
        setTimeout(render, 0);
      }
    }
  });
  function captureJobFocus() {
    const element = document.activeElement;
    const scope = element?.name ? element.closest?.('#intake-form,#review-form,.recipe-panel,.inbox-item,.posting-kit,#starter-form,.ab-compose') : null;
    if (!scope) return null;
    const box = element.type === 'checkbox' || element.type === 'radio';
    let start = null;
    let end = null;
    try { start = typeof element.selectionStart === 'number' ? element.selectionStart : null; end = typeof element.selectionEnd === 'number' ? element.selectionEnd : null; } catch { start = end = null; }
    const within = scope.classList.contains('inbox-item') ? `.inbox-item[data-inbox-key="${CSS.escape(scope.dataset.inboxKey || '')}"] [name]` : '#intake-form [name], #review-form [name], .recipe-panel [name], .posting-kit [name], #starter-form [name], .ab-compose [name]';
    return { within, name: element.name, value: box ? element.value : null, start, end };
  }
  function restoreJobFocus(focus) {
    if (!focus || (document.activeElement && document.activeElement !== document.body)) return;
    const group = [...app.querySelectorAll(focus.within)].filter(item => item.name === focus.name);
    const element = group.find(item => focus.value === null || item.value === focus.value) || (focus.name === 'publish_route' ? group.find(item => item.checked) : null);
    if (!element) return;
    element.focus({ preventScroll: true });
    if (focus.start !== null && typeof element.setSelectionRange === 'function') {
      try { element.setSelectionRange(focus.start, focus.end); } catch { /* Not every control has a selection. */ }
    }
  }
  app.addEventListener('change', event => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== 'checkbox' || !checkbox.name.endsWith('_unavailable')) return;
    const name = checkbox.name.slice(0, -'_unavailable'.length);
    const field = app.querySelector('#channel-' + name);
    if (!field) return;
    inline ||= {kind:'onboard', brand:null, values:{}};
    inline.values ||= {};
    if (checkbox.checked) {
      inline.values[name] = field.value;
      field.value = '';
      field.disabled = true;
      updateFieldErrorUI(name, null);
    } else {
      field.disabled = false;
      field.value = inline.values[name] || '';
      updateFieldErrorUI(name, liveChannelError(name, field.value, false));
    }
    syncStartResearch();
  });
  app.addEventListener('change', event => {
    const field = event.target;
    const name = field.name || '';
    if (field.dataset?.kitFolder === 'rights') {
      const ui = folderUiOf(true);
      if (ui) {
        ui.rights = field.value;
        if (ui.error) { ui.error = ''; document.getElementById('kit-folder-error')?.remove(); document.getElementById('kit-folder-path')?.removeAttribute('aria-invalid'); }
        const pickButton = app.querySelector('[data-kit-action="pick-folder"]');
        if (pickButton) pickButton.disabled = Boolean(ui.busy);
        const pickHint = app.querySelector('[data-pick-hint]');
        if (pickHint) pickHint.textContent = KIT_FOLDER_PICK_HINT;
      }
      return;
    }
    if (name === 'kit_logo_file') { void handleLogoFile(field.files?.[0] || null); return; }
    if (name === 'kit_font_file') { void handleFontFile(field.files?.[0] || null); return; }
    if (name === 'kit_ref_file') { void handleRefFiles(field.files); return; }
    const colorIndex = /^kit_color_(swatch|hex|role)_(\d+)$/.exec(name);
    if (colorIndex) {
      captureInlineValues();
      const kit = ensureInlineKit();
      const brandForKit = inline?.brand ? (data.brands || []).find(item => item.slug === inline.brand) : null;
      const projected = brandForKit?.kit || {};
      kit.palette = (Array.isArray(kit.palette) ? kit.palette : (projected.palette || [])).map(c => ({...c}));
      const index = Number(colorIndex[2]);
      kit.palette[index] ||= { value: '#000000', role: 'other' };
      if (colorIndex[1] === 'swatch') kit.palette[index] = { ...kit.palette[index], value: String(field.value || '').toUpperCase() };
      else if (colorIndex[1] === 'hex') { const hex = normalizeHex(field.value); if (hex) kit.palette[index] = { ...kit.palette[index], value: hex }; }
      else kit.palette[index] = { ...kit.palette[index], role: field.value };
      render();
      return;
    }
    const fontIndex = /^kit_font_(family|use)_(\d+)$/.exec(name);
    if (fontIndex) {
      captureInlineValues();
      const kit = ensureInlineKit();
      const brandForKit = inline?.brand ? (data.brands || []).find(item => item.slug === inline.brand) : null;
      const projected = brandForKit?.kit || {};
      kit.fonts = (Array.isArray(kit.fonts) ? kit.fonts : (projected.fonts || [])).map(f => ({...f}));
      const index = Number(fontIndex[2]);
      kit.fonts[index] ||= { family: '', use: 'other' };
      if (fontIndex[1] === 'family') kit.fonts[index] = { ...kit.fonts[index], family: field.value };
      else kit.fonts[index] = { ...kit.fonts[index], use: field.value };
      render();
      return;
    }
  });
  app.addEventListener('submit', async event=>{
    if (event.target.id === 'inline-form') { void submitInline(event); return; }
    // The Inbox starter hands what was typed to the same composer the home page shows: it becomes the open draft, sends from
    // there, and shows its progress or any problem in that card.
    if (event.target.id === 'starter-form') { starterValues = {}; inline = newJobDraft(); inline.refs = starterRefs; void submitInline(event); return; }
    if (event.target.id === 'intake-form') { event.preventDefault(); void submitIntake(event.target); return; }
    if (event.target.dataset?.inboxForm !== undefined) {
      event.preventDefault();
      const questionId = event.target.dataset.inboxForm;
      const text = event.target.elements.namedItem('answer')?.value ?? '';
      questionState(questionId).draft = text;
      void answerQuestion(questionId, { text });
      return;
    }
    if (event.target.dataset?.abForm !== undefined) {
      event.preventDefault();
      const shown = current();
      if (shown) void submitAgentMessage(shown, event.target);
      return;
    }
    if (event.target.dataset?.inboxIntake !== undefined) {
      event.preventDefault();
      const project = viewOf(event.target.dataset.inboxIntake);
      if (project) void submitIntake(event.target, project);
      return;
    }
  });
  document.addEventListener('keydown',event=>{
    if(!drawer&&!viewer&&current()&&uiFor(current()).review.conceptPanel&&app.querySelector('.cc-panel')){
      if(event.key==='Escape'){event.preventDefault();closeConceptPanel();return;}
      if(event.key==='Tab'){const box=app.querySelector('.cc-panel');const controls=[...box.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,summary,a[href]')].filter(item=>item.getClientRects().length);const first=controls[0],last=controls.at(-1);if(!box.contains(document.activeElement)){event.preventDefault();first?.focus();}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}return;}
    }
    if(event.key==='Escape'&&(drawer||viewer)){close();return;}
    if(event.key==='Tab'&&(drawer||viewer)){const box=app.querySelector(viewer?'.viewer':'.drawer');const controls=[...box.querySelectorAll('button:not(:disabled),input,select,textarea,a[href],video[controls],audio[controls]')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  app.addEventListener('toggle', event => {
    const key = event.target?.dataset?.openKey;
    if (!key) return;
    const changed = openKeys.has(key) !== event.target.open;
    if (event.target.open) openKeys.add(key); else openKeys.delete(key);
    // On a phone the card a step waits on is lifted out of that step when it is folded, and goes back in when it opens again.
    if (changed && event.target.matches('.stg-d') && narrowWidth() && event.target.closest('.stg.s-waiting')) render();
  }, true);
  // Brand intelligence: the intel module draws the panel, this is its page state and its requests. One record per brand survives every redraw
  // (the open tab, the subtopic edit, the cell being confirmed, which post card shows Copied). Each control of the panel carries data-intel-act.
  // Drawing again from a panel control keeps what is typed in the onboarding form (the form is drawn from the draft's values).
  function redraw() { captureInlineValues(); render(); }
  const intelStates = new Map();
  const intelBadPictures = new Set();
  let intelKeep = null;
  function intelState(slug) {
    let state = intelStates.get(slug);
    if (!state) { state = freshIntelState(); intelStates.set(slug, state); }
    return state;
  }
  const intelBrand = slug => (data.brands || []).find(item => item.slug === slug);
  const intelHint = () => copyHint(typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent, Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches));
  const intelFocusSelector = id => `[data-intel-focus="${CSS.escape(id)}"]`;
  // The page is drawn again as a whole, so a redraw would drop the focus (and the caret) of a control inside a panel. Drawing a panel runs
  // before the old page is replaced: it notes which control has focus, and a microtask puts it back once the new page is in.
  function restoreIntelFocus() {
    const keep = intelKeep;
    intelKeep = null;
    if (!keep) return;
    const active = document.activeElement;
    if (active && active !== document.body && app.contains(active)) return;
    const element = app.querySelector(intelFocusSelector(keep.id));
    if (!element) return;
    element.focus({ preventScroll: true });
    if (keep.start !== null && typeof element.setSelectionRange === 'function') { try { element.setSelectionRange(keep.start, keep.end ?? keep.start); } catch { /* Not every control has a selection. */ } }
  }
  // One brand's panel. It opens by itself the first time it is shown in a state: while the research runs, for the brand on the onboarding page,
  // and for the only brand that has one; after that it stays as the person left it.
  function intelPanelFor(brand) {
    const intel = intelOf(brand);
    if (!intel || !brand.slug) return '';
    const active = document.activeElement;
    const keepId = active?.dataset?.intelFocus && active.closest?.('.brand-intel,.chat') ? active.dataset.intelFocus : '';
    if (keepId) { intelKeep = { id: keepId, start: typeof active.selectionStart === 'number' ? active.selectionStart : null, end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null }; queueMicrotask(restoreIntelFocus); }
    const state = intelState(brand.slug);
    if (intelSentLanded(intel, state.sent)) state.sent = null;
    const key = `brand-intel:${brand.slug}`;
    // The panel starts closed and opens only when the person toggles it; its summary line says enough while research runs.
    const kinds = new Set((Array.isArray(brand.library?.banks) ? brand.library.banks : []).filter(bank => bank && Array.isArray(bank.items) && bank.items.some(item => item && !item.removed && trimmed(item.text))).map(bank => bank.kind));
    return brandIntelligence(brand, state, { open: openKeys.has(key), now: Date.now(), hint: intelHint(), libraryKinds: kinds, badPictures: intelBadPictures });
  }
  function setIntelTab(slug, tab) {
    if (!INTEL_TABS.some(item => item.id === tab)) return;
    Object.assign(intelState(slug), { tab, copied: '', fallback: '' });
    redraw();
    focusQuietly(intelFocusSelector(`tab:${tab}`));
  }
  // The subtopic edit: the rows start as the draft's subtopics, the person renames, removes or adds up to 8, and saves exactly 6.
  function startIntelEdit(slug, { add = false, jump = false } = {}) {
    const intel = intelOf(intelBrand(slug));
    if (!intel) return;
    const state = intelState(slug);
    if (!state.editing) state.rows = intelSubtopics(intel).map(item => ({ id: item.id, name: item.name }));
    if (add && state.rows.length < INTEL_SUBTOPIC_MAX) state.rows.push({ name: '' });
    Object.assign(state, { editing: true, error: '', sent: null, tab: 'subtopics' });
    openKeys.add(`brand-intel:${slug}`);
    redraw();
    if (jump) jumpTo(`[data-intel-panel="${CSS.escape(slug)}"]`);
    focusQuietly(intelFocusSelector(`row:${add ? state.rows.length - 1 : 0}`));
  }
  function cancelIntelEdit(slug) {
    Object.assign(intelState(slug), { editing: false, rows: [], error: '' });
    redraw();
    focusQuietly(intelFocusSelector('edit'));
  }
  function addIntelRow(slug) {
    const state = intelState(slug);
    if (state.rows.length >= INTEL_SUBTOPIC_MAX) return;
    state.rows.push({ name: '' });
    state.error = '';
    redraw();
    focusQuietly(intelFocusSelector(`row:${state.rows.length - 1}`));
  }
  function removeIntelRow(slug, at) {
    const state = intelState(slug);
    if (!Number.isInteger(at) || at < 0 || at >= state.rows.length) return;
    state.rows.splice(at, 1);
    state.error = '';
    redraw();
    focusQuietly(intelFocusSelector(state.rows.length ? `row:${Math.min(at, state.rows.length - 1)}` : 'add'));
  }
  // Save the subtopics: every one of the list, so the request replaces the draft whole. A subtopic the person added has no id.
  async function submitSubtopics(slug, rows, { focusEdit = false } = {}) {
    const state = intelState(slug);
    if (state.busy) return;
    const problem = intelSubtopicsProblem(rows);
    if (problem) { state.error = problem; redraw(); return; }
    if (!transport) { state.error = NOTE_NOT_CONNECTED; redraw(); return; }
    state.busy = true;
    state.error = '';
    redraw();
    try {
      const result = await transport.call('subtopics_confirm', { requestId: randomId(globalThis), brand: slug, items: intelSubtopicItems(rows) });
      Object.assign(state, { sent: { rows: rows.map(row => ({ id: row.id, name: String(row.name).trim() })), at: Date.now() }, editing: false, rows: [], error: '' });
      notify(result?.message || NOTE_SAVED);
      await refresh();
    } catch (e) {
      state.error = e.message || NOTE_SEND_FAILED;
    } finally {
      state.busy = false;
      redraw();
    }
    if (focusEdit && !state.error) focusQuietly(intelFocusSelector('edit'));
  }
  function confirmIntelSubtopics(slug, options) {
    const intel = intelOf(intelBrand(slug));
    if (intel) void submitSubtopics(slug, intelSubtopics(intel).map(item => ({ id: item.id, name: item.name })), options);
  }
  // A plan cell: the first click opens the confirm step under the table (a second click on the same cell closes it); only that step's button
  // sends plan_cell_start for the subtopic and format of the cell.
  function chooseIntelCell(slug, subtopic, format) {
    const state = intelState(slug);
    const same = Boolean(state.cell) && state.cell.subtopic === subtopic && state.cell.format === format;
    Object.assign(state, { cell: same ? null : { subtopic, format }, cellError: '', cellSent: '' });
    redraw();
    if (same) { focusQuietly(`[data-intel-sub="${CSS.escape(subtopic)}"][data-intel-fmt="${CSS.escape(format)}"]`); return; }
    const box = focusQuietly(intelFocusSelector('cell-confirm'));
    const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    box?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }
  function cancelIntelCell(slug) {
    const state = intelState(slug);
    const cell = state.cell;
    Object.assign(state, { cell: null, cellError: '' });
    redraw();
    if (cell) focusQuietly(`[data-intel-sub="${CSS.escape(cell.subtopic)}"][data-intel-fmt="${CSS.escape(cell.format)}"]`);
  }
  async function startIntelCell(slug) {
    const state = intelState(slug);
    const cell = state.cell;
    if (!cell || state.cellBusy) return;
    if (!transport) { state.cellError = NOTE_NOT_CONNECTED; redraw(); return; }
    state.cellBusy = true;
    state.cellError = '';
    redraw();
    try {
      const result = await transport.call('plan_cell_start', { requestId: randomId(globalThis), brand: slug, subtopic: cell.subtopic, format: cell.format });
      Object.assign(state, { cell: null, cellSent: 'Sent. The post shows with your jobs when ready.' });
      notify(result?.message || NOTE_SAVED);
      await refresh();
    } catch (e) {
      state.cellError = e.message || NOTE_SEND_FAILED;
    } finally {
      state.cellBusy = false;
      redraw();
    }
    if (state.cellSent && !state.cell) focusQuietly(intelFocusSelector('cell-sent'));
  }
  // Copy link: the clipboard is asked inside the click itself. A refusal (or no clipboard at all) opens a read-only box with the link selected.
  function copyIntelLink(button) {
    const url = safeHttpsLink(button.dataset.intelUrl || '');
    const key = button.dataset.intelArg || '';
    const slug = button.closest('[data-intel-brand]')?.dataset.intelBrand;
    if (!url || !key || !slug) return;
    const state = intelState(slug);
    clearTimeout(state.copyTimer);
    let attempt;
    try { attempt = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function' ? navigator.clipboard.writeText(url) : Promise.reject(new Error('No clipboard')); } catch (e) { attempt = Promise.reject(e); }
    attempt.then(() => {
      Object.assign(state, { copied: key, fallback: '' });
      state.copyTimer = setTimeout(() => { state.copied = ''; state.copyTimer = null; redraw(); }, KIT_COPIED_MS);
      notify('Link copied.');
      redraw();
    }, () => {
      Object.assign(state, { copied: '', fallback: key });
      redraw();
      const box = app.querySelector(`[data-intel-fallback="${CSS.escape(key)}"]`);
      if (box) { box.focus({ preventScroll: true }); box.select(); }
    });
  }
  // A bank in the summary opens that bank in the Brand library, which opens with it.
  function openIntelBank(slug, kind) {
    openKeys.add(`brand-library:${slug}`);
    openKeys.add(`brand-library:${slug}:${kind}`);
    redraw();
    jumpTo(`details.library-bank[data-open-key="${CSS.escape(`brand-library:${slug}:${kind}`)}"]`);
  }
  app.addEventListener('click', event => {
    const control = event.target.closest?.('[data-intel-act]');
    const slug = control?.closest('[data-intel-brand]')?.dataset.intelBrand;
    if (!control || !slug) return;
    const arg = control.dataset.intelArg;
    switch (control.dataset.intelAct) {
      case 'tab': setIntelTab(slug, arg); break;
      case 'cell': chooseIntelCell(slug, control.dataset.intelSub || '', control.dataset.intelFmt || ''); break;
      case 'cell-go': void startIntelCell(slug); break;
      case 'cell-cancel': cancelIntelCell(slug); break;
      case 'copy': copyIntelLink(control); break;
      case 'copy-done': { const state = intelState(slug); state.fallback = ''; redraw(); focusQuietly(intelFocusSelector(`copy:${arg}`)); break; }
      case 'confirm': confirmIntelSubtopics(slug, { focusEdit: true }); break;
      case 'note-confirm': confirmIntelSubtopics(slug); break;
      case 'edit': startIntelEdit(slug); break;
      case 'note-edit': startIntelEdit(slug, { jump: true }); break;
      case 'add-own': startIntelEdit(slug, { add: true }); break;
      case 'add': addIntelRow(slug); break;
      case 'remove': removeIntelRow(slug, Number(arg)); break;
      case 'cancel-edit': cancelIntelEdit(slug); break;
      case 'bank': openIntelBank(slug, arg); break;
    }
  });
  // The tabs: arrow keys, Home and End move between them (and open the one reached).
  app.addEventListener('keydown', event => {
    const field = event.target;
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const tab = field.closest?.('[data-intel-act="tab"]');
    if (tab) {
      const ids = INTEL_TABS.map(item => item.id);
      const at = ids.indexOf(tab.dataset.intelArg);
      const next = event.key === 'ArrowRight' ? (at + 1) % ids.length : event.key === 'ArrowLeft' ? (at + ids.length - 1) % ids.length : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1;
      const slug = tab.closest('[data-intel-brand]')?.dataset.intelBrand;
      if (next < 0 || at < 0 || !slug) return;
      event.preventDefault();
      setIntelTab(slug, ids[next]);
      return;
    }
    // A subtopic box: Escape drops the edit.
    if (field instanceof HTMLInputElement && field.dataset.intelRow !== undefined && event.key === 'Escape') {
      const slug = field.closest('[data-intel-brand]')?.dataset.intelBrand;
      if (slug) { event.preventDefault(); cancelIntelEdit(slug); }
    }
  });
  // Typing in a subtopic box keeps the row and updates the count line and the Save button in place (no redraw, so the caret stays).
  app.addEventListener('input', event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || field.dataset.intelRow === undefined) return;
    const slug = field.closest('[data-intel-brand]')?.dataset.intelBrand;
    const state = slug ? intelStates.get(slug) : null;
    const row = state?.rows[Number(field.dataset.intelRow)];
    if (!row) return;
    row.name = field.value;
    state.error = '';
    const form = field.closest('form');
    const { issue, text } = intelEditStatus(state.rows);
    const line = form?.querySelector('.intel-count');
    if (line) { line.textContent = text; line.classList.toggle('is-bad', Boolean(issue)); }
    const save = form?.querySelector('button[type="submit"]');
    if (save && !state.busy) save.disabled = Boolean(issue);
    form?.querySelector('.inline-error')?.remove();
  });
  app.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.intelForm === undefined) return;
    event.preventDefault();
    const slug = form.closest('[data-intel-brand]')?.dataset.intelBrand;
    if (slug) void submitSubtopics(slug, intelState(slug).rows, { focusEdit: true });
  });
  // A picture that does not load (an address that expired, a site that blocks other pages) is dropped, and not asked for again: the card keeps its tile.
  app.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('.intel-thumb')) return;
    intelBadPictures.add(image.getAttribute('src'));
    image.remove();
  }, true);
  addEventListener('hashchange',()=>{drawer=null;viewer=null;connectorsView=false;render();});
  // Leaving the page with a saved panel or card change nobody sent loses it: ask first.
  addEventListener('beforeunload', event => {
    if (![...jobUi.values()].some(ui => hasUnsentReviewChanges(ui.review))) return;
    event.preventDefault();
    event.returnValue = '';
  });
  void refresh();
}
