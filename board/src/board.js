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
// The words and colours of each pipeline group's door on the home page. The groups themselves (and which job kind is in which)
// come from the catalogue; a group this table does not know still gets a door, in the next free palette.
const DOOR_PALETTES = Object.freeze(['orange', 'teal', 'violet', 'pink', 'green']);
const DOOR_WORDS = Object.freeze({
  post: { title: 'Posts and campaigns', promise: 'A brief in, posts out.', palette: 'orange', icon: 'post' },
  publish_post: { title: 'Post from your files', promise: 'Your files in, posts out.', palette: 'teal', icon: 'upload' },
  research: { title: 'Research', promise: 'A question in, a report out.', palette: 'violet', icon: 'search' },
  creative_analysis: { title: 'Analysis', promise: 'Your results in, next steps out.', palette: 'pink', icon: 'chart' },
  video_breakdown: { title: 'Video breakdown', promise: 'A video in, its shots explained.', palette: 'green', icon: 'film' },
});
const DOOR_ICONS = Object.freeze({
  post: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  chart: '<path d="M5 20V11"/><path d="M12 20V4"/><path d="M19 20v-6"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
});
export function pipelineGroups() {
  const groups = [];
  for (const words of Object.values(PIPELINE_KINDS)) if (words.group && !groups.includes(words.group)) groups.push(words.group);
  return groups;
}
export const groupOfKind = kind => PIPELINE_KINDS[kind]?.group || 'post';
export function doorCounts(jobs, working, waiting = 0) {
  if (!jobs) return 'No jobs yet';
  return [`${jobs} ${jobs === 1 ? 'job' : 'jobs'}`, working ? `${working} working` : '', waiting ? `${waiting} waiting on you` : ''].filter(Boolean).join(', ');
}
// Finished, cancelled and blocked jobs are in neither count on a door.
const DOOR_SETTLED_STATES = new Set(['COMPLETE', 'CANCELLED', 'BLOCKED', 'ESCALATED']);
const doorOpen = project => !DOOR_SETTLED_STATES.has(String(project?.state || '').toUpperCase());
// Waiting on the person: a decision is open, or the job has something in the Inbox (a question, a brief, a stuck note).
const jobWaiting = (project, inboxJobs) => Boolean(project?.waitingOn) || inboxJobs.has(project?.jobId);
const jobWorking = project => project?.usage?.running === true || /\bworking\b/i.test(String(project?.agentLine || ''));
// One door per pipeline group: its words, its palette, the jobs in it, how many Claude is working on and how many wait on the person.
export function pipelineDoors(projects = [], inboxItems = []) {
  const list = Array.isArray(projects) ? projects : [];
  const inboxJobs = new Set((Array.isArray(inboxItems) ? inboxItems : []).filter(item => item && item.jobId && item.kind !== 'onboarding').map(item => item.jobId));
  return pipelineGroups().map((group, index) => {
    const jobs = list.filter(project => groupOfKind(project?.kind) === group);
    const open = jobs.filter(doorOpen);
    const waiting = open.filter(project => jobWaiting(project, inboxJobs)).length;
    const working = open.filter(project => !jobWaiting(project, inboxJobs) && jobWorking(project)).length;
    const words = DOOR_WORDS[group] || { title: humanize(group), promise: 'Jobs of this kind.', palette: DOOR_PALETTES[index % DOOR_PALETTES.length], icon: 'post' };
    return { group, ...words, jobs, working, waiting, counts: doorCounts(jobs.length, working, waiting) };
  });
}
export function doorHtml(door, { hero = false } = {}) {
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
  const inner = `<span class="door-ic" aria-hidden="true"><svg viewBox="0 0 24 24">${DOOR_ICONS[door.icon] || DOOR_ICONS.post}</svg></span><span class="door-b"><span class="door-t"><em>${esc(door.title)}.</em> ${esc(door.promise)}</span><span class="door-s">${esc(door.counts)}</span></span>`;
  if (hero) return `<div class="door door-static p-${esc(door.palette)}">${inner}<button type="button" class="door-btn" data-action="compose">Start a job ${arrow}</button></div>`;
  return `<button type="button" class="door p-${esc(door.palette)}" data-nav="#/pipeline/${encodeURIComponent(door.group)}">${inner}<span class="door-btn">Open ${arrow}</span></button>`;
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
const VIDEO_FILE_HINT = 'For a video file on your computer, give it to Claude in chat.';
const REPORT_MARK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>';
export function parseLinks(text) {
  const links = [];
  let error = null;
  for (const raw of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const value = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    if (value.length > LINK_MAX_LENGTH) { error = `Each link must be ${LINK_MAX_LENGTH} characters or fewer.`; continue; }
    let valid = false;
    try { const url = new URL(value); valid = url.protocol === 'https:' && Boolean(url.hostname) && url.hostname.includes('.') && !url.username && !url.password; } catch { valid = false; }
    if (!valid) { error = 'Each link must be a full address that starts with https://.'; continue; }
    if (!links.includes(value)) links.push(value);
  }
  if (!error && links.length > LINK_LIMIT) error = `Add up to ${LINK_LIMIT} links.`;
  return { links, error };
}
const intakeLabel = value => ({kind:'Type of content',objective:'Campaign goal',distribution:'Organic or paid distribution',platforms:'Social platforms',deliverables:'Formats and quantities','deliverables (at least one)':'Formats and quantities',audience:'Target audience',evidence:'Available references and supporting material'})[value] || value;
const time = value => value ? new Date(value).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' }) : 'Not synced yet';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : 'Not reported';
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
  return relative ? `Updated ${relative}` : 'Waiting for Claude to sync this board';
}
const metric = (label, value, note) => `<div class="stat"><span class="eyebrow">${esc(label)}</span><b>${esc(value)}</b><small>${esc(note)}</small></div>`;
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
// The job page's stats row: Claude token usage, wall-clock time, and media
// generation spend. Built from project.usage so it renders the same whether
// called from the job page or exercised directly in a test.
export function jobStats(project, now = Date.now()) {
  const usage = project?.usage || {};
  const timeNote = usage.running ? 'Start to now, including waiting for you' : 'Start to end, including waiting for you';
  const elapsedMs = liveMs(usage.elapsedMs, usage.openSince, now);
  const studio = creditFraction(usage.generation?.threeEchoCredits);
  const voice = creditsInUse(usage.generation?.elevenLabsCredits) ? creditFraction(usage.generation.elevenLabsCredits) : null;
  const note = voice ? `3Echo Studio credits used. Voice: ${voice} ElevenLabs credits.` : '3Echo Studio credits used';
  const shared = `${metric('Tokens', number(usage.tokens), 'Claude usage for this job')}${metric('Time', clock(elapsedMs), timeNote)}`;
  if (isReportJob(project)) return `<div class="stats two">${shared}</div>`;
  // A job whose own stages never make media has no media generation to report, unless credits were spent anyway. Until the stages are loaded there is nothing to go on, so the card stays.
  const listed = Array.isArray(project?.stages) ? project.stages.filter(stage => stage && typeof stage === 'object') : [];
  const spent = creditsInUse(usage.generation?.threeEchoCredits) || creditsInUse(usage.generation?.elevenLabsCredits);
  if (listed.length && !spent && !listed.some(stage => stage.id === 'making-the-images-and-video')) return `<div class="stats two">${shared}</div>`;
  return `<div class="stats">${shared}${metric('Media generation', studio ? `${studio} credits` : 'Not reported', note)}</div>`;
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
function unpack(result) {
  if (result?.isError) throw new Error(result.content?.find(x => x.type === 'text')?.text || 'Studio could not complete the request.');
  if (result?.structuredContent) return result.structuredContent;
  if (Array.isArray(result?.content)) {
    const text = result.content.find(x => x.type === 'text')?.text;
    if (text) return JSON.parse(text);
  }
  return result;
}

const ARTIFACT_WORKSPACE_DOC = 'socialCampaign/workspace';
const JOB_DOCUMENT_COLLECTION = 'jobDocs';
const JOB_DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const NO_SESSION_MESSAGE = 'Saved. Claude picks this up as soon as your Claude chat is open.';
const SIGNAL_OUTCOMES = Object.freeze({
  sent: 'The running Claude session has been notified.',
  no_session: NO_SESSION_MESSAGE,
  writers_only: 'This board is read-only for your account, so Claude was not notified.',
  claude_unavailable: NO_SESSION_MESSAGE,
  forbidden: 'Commenting from this board is off for your account. Ask Claude in chat to sync this board.',
  consent_required: 'Comments were not allowed, so Claude was not notified. Ask Claude in chat to sync this board.',
  rate_limited: 'Too many signals were sent. Wait a moment before trying again.',
  unavailable: 'The Claude notification capability is unavailable. Ask Claude in chat to sync this board.',
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
  { name: 'market', label: 'Positioning', short: 'positioning', placeholder: 'What do you offer, and what makes it different?', maxlength: CONTEXT_LIMITS.text.market },
  { name: 'voice', label: 'Brand voice', short: 'brand voice', placeholder: 'How should your brand sound?', maxlength: CONTEXT_LIMITS.text.voice },
  { name: 'contentPillars', label: 'Content pillars (one per line)', short: 'content pillars', placeholder: 'One topic per line' },
  { name: 'competitors', label: 'Top 3 competitors (one per line)', short: 'top 3 competitors', placeholder: 'Up to 3 names or URLs, one per line' },
]);
export const CONTEXT_FIELD_NAMES = CONTEXT_FIELDS.map(field => field.name);
export const TARGET_MARKET_FIELD = Object.freeze({ name: 'targetMarket', label: 'Target market', short: 'target market', placeholder: 'Singapore', maxlength: 60 });
const TARGET_MARKET_TOO_LONG = 'Keep the target market under 60 characters.';
const normalizeTargetMarket = value => String(value ?? '').replace(/\s+/g, ' ').trim();

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
  const profile = brand?.profile || {};
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
  const ownedContext = name => Boolean(edited[name]) && (Boolean(String(values[name] ?? '').trim()) || Boolean(draft.unlocked?.[name]));
  for (const name of CONTEXT_FIELD_NAMES) {
    if (ownedContext(name) || draft.unlocked?.[name]) unlocked[name] = true;
    if (!ownedContext(name)) values[name] = saved[name];
  }
  for (const name of DRAFT_TEXT_FIELDS) {
    if (!edited[name]) values[name] = saved[name];
  }
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
  if (!normalized) return `Add ${CHANNEL_ARTICLES[name]} ${CHANNEL_LABELS[name]} URL, or check "We don't have one".`;
  if (!/^https?:\/\//i.test(normalized)) return `Enter a full URL for ${CHANNEL_LABELS[name]} (for example https://...), or check "We don't have one".`;
  return null;
}

// Amendment 5: competitors are capped at 3 everywhere. This only catches too
// many; fewer than 3 (or none) is valid and left for research to fill.
function competitorLines(raw) {
  return String(raw ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

export function validateProfile(values = {}, prefilled = {}, unlocked = {}) {
  const errors = {};
  if (!String(values.name || '').trim()) errors.name = 'Enter a brand name.';
  for (const name of CHANNEL_NAMES) {
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
  if (pillars.length > CONTEXT_LIMITS.pillarsMax) errors.contentPillars = `List up to ${CONTEXT_LIMITS.pillarsMax} content pillars, one per line.`;
  else if (pillars.some(item => item.length > CONTEXT_LIMITS.pillarItemMax)) errors.contentPillars = `Keep each content pillar to ${CONTEXT_LIMITS.pillarItemMax} characters or fewer.`;
  if (!pillars.length && unlocked.contentPillars && String(prefilled.contentPillars ?? '').trim()) errors.contentPillars = 'Add at least one content pillar.';
  const competitors = competitorLines(values.competitors);
  if (competitors.length > CONTEXT_LIMITS.competitorsMax) errors.competitors = 'List up to 3 competitors, one per line.';
  else if (competitors.some(item => item.length > CONTEXT_LIMITS.competitorItemMax)) errors.competitors = `Keep each competitor to ${CONTEXT_LIMITS.competitorItemMax} characters or fewer.`;
  return errors;
}

function channelField(name, values = {}, fieldErrors = null) {
  const value = values[name] || '';
  const unavailable = values[name + '_unavailable'] || /^not available$/i.test(value);
  const fieldError = unavailable ? null : fieldErrors?.[name];
  const errorId = `channel-${name}-error`;
  return `<div class="channel-field"><label for="channel-${name}">${esc(CHANNEL_LABELS[name])}</label><input id="channel-${name}" name="${name}" type="text" maxlength="2000" inputmode="url" placeholder="${esc(CHANNEL_PLACEHOLDERS[name])}" value="${esc(unavailable ? '' : value)}" ${unavailable ? 'disabled' : ''} aria-invalid="${fieldError ? 'true' : 'false'}" ${fieldError ? `aria-describedby="${errorId}"` : ''}>${fieldError ? `<p class="field-error" id="${errorId}" role="alert">${esc(fieldError)}</p>` : ''}<label class="toggle"><input type="checkbox" name="${name}_unavailable" ${unavailable ? 'checked' : ''}> <span>We don't have one</span></label></div>`;
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

// One declared context field: a normal textarea, prefilled and locked
// (readonly) when the saved profile already has a value for it, with a
// pencil "Edit" button beside its label to unlock it. A field with no
// saved value renders as a normal, already-editable textarea with no
// button. `prefilled` is the draft's original snapshot (what "has a saved
// value" is judged against, not the live in-progress value), and
// `unlocked` tracks which fields the person has already clicked Edit on.
export function contextField(field, values = {}, prefilled = {}, unlocked = {}, fieldErrors = null, suggested = false) {
  const value = values[field.name] ?? '';
  const hasSaved = Boolean(String(prefilled[field.name] || '').trim());
  const isUnlocked = Boolean(unlocked[field.name]);
  const readOnly = hasSaved && !isUnlocked;
  const editButton = readOnly
    ? `<button type="button" class="field-edit" data-unlock="${field.name}" aria-label="Edit ${esc(field.short)}"><svg aria-hidden="true" viewBox="0 0 16 16" width="13" height="13"><path d="M11.3 1.3a1 1 0 0 1 1.4 0l2 2a1 1 0 0 1 0 1.4l-8 8-3.6.9.9-3.6 8-8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg><span>Edit</span></button>`
    : '';
  const fieldError = fieldErrors?.[field.name];
  const errorId = `context-${field.name}-error`;
  const limit = CONTEXT_LIMITS.text[field.name];
  const length = contextTextLength(value);
  const count = limit ? `<p class="field-count${length > limit ? ' over' : ''}" id="context-${field.name}-count">${length} / ${limit}</p>` : '';
  return `<div class="context-field"><div class="context-field-head"><label for="context-${field.name}">${esc(field.label)}</label>${suggested ? '<span class="pill">Suggested, please check</span>' : ''}${editButton}</div><textarea id="context-${field.name}" name="${field.name}" class="context-textarea" ${field.maxlength ? `maxlength="${field.maxlength}"` : ''} placeholder="${esc(field.placeholder)}" ${readOnly ? 'readonly' : ''} aria-invalid="${fieldError ? 'true' : 'false'}" ${fieldError ? `aria-describedby="${errorId}"` : ''}>${esc(value)}</textarea>${count}${fieldError ? `<p class="field-error" id="${errorId}" role="alert">${esc(fieldError)}</p>` : ''}</div>`;
}

// Section 8: the "Logo, colours and fonts" fieldset inside the onboarding
// card. `kit` here is the small in-progress edit state kept on the inline
// draft (state.kit): only what the person has touched, defaulting to the
// projection's brand.kit (section 7) for anything left alone. Rendering is
// defensive: a missing/absent brand.kit is treated as empty, never thrown.
export const KIT_COLOR_ROLES = Object.freeze(['primary', 'secondary', 'accent', 'background', 'text', 'other']);
export const KIT_FONT_USES = Object.freeze(['headings', 'body', 'captions', 'other']);
export const KIT_LIMITS = Object.freeze({ maxColors: 8, maxFonts: 4 });
const KIT_SOCIAL_PLATFORMS = Object.freeze({ instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' });

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
  const captureStatus = brand.kit?.capture?.status;
  if (captureStatus === 'waiting' || captureStatus === 'running') return 'loading';
  if (researchPhase === 'running' && !CAPTURE_SETTLED.has(captureStatus)) return 'loading';
  if (researchPhase === 'new') return 'new';
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
    if (!normalizeHex(color?.value)) errors[`color_${index}`] = 'Use a six-digit colour like #1A2B3C.';
  });
  if (palette.length && !palette.some(color => color?.role === 'primary')) {
    errors.palette = 'Choose one primary colour.';
  }
  fonts.forEach((font, index) => {
    if (!String(font?.family ?? '').trim()) errors[`font_${index}`] = 'Enter a font name, for example Inter.';
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
  return { logo, palette, fonts };
}

// The kickoff ("Start onboarding") onboard_brand call happens before any
// research has run, so there is nothing yet to compare a draft against:
// `kit` is included only when the person actually added something (an
// uploaded logo, or at least one colour or font), and omitted entirely
// otherwise, so an untouched kickoff never opens a kit review with nothing
// in it.
export function kitKickoffArgs(kit = {}) {
  const hasLogo = (kit.logo?.action === 'upload' && Boolean(kit.logo?.dataBase64))
    || (kit.logo?.action === 'asset' && Boolean(kit.logo?.assetId));
  const hasPalette = Array.isArray(kit.palette) && kit.palette.length > 0;
  const hasFonts = Array.isArray(kit.fonts) && kit.fonts.length > 0;
  if (!hasLogo && !hasPalette && !hasFonts) return {};
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
  { id: 'caption', label: 'Caption or text', hint: 'Type it, or choose a TXT or MD file', kinds: ['text'] },
  { id: 'addon', label: 'Add-on', hint: 'Any picture, video, audio, PDF or text file', kinds: ['image', 'video', 'audio', 'document', 'text'] },
]);
const REFERENCE_EXT = Object.freeze({
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', aac: 'audio', pdf: 'document', txt: 'text', md: 'text', srt: 'text', vtt: 'text',
});
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
  if (!type) return 'Choose what this is first.';
  if (!file) return '';
  const kind = referenceKindOf(file.name);
  if (!kind || !type.kinds.includes(kind)) return `${type.label} takes ${type.hint}. Pick a different file, or change what it is.`;
  if (kind === 'text') return file.size > REFERENCE_TEXT_MAX * 4 ? 'That text file is too long. Trim it or paste the part you want.' : '';
  const limit = REFERENCE_LIMIT_MB[kind];
  if (file.size > limit * 1024 * 1024) return `That file is too big for the board (limit ${limit} MB for ${kind === 'document' ? 'documents' : kind}). Try a smaller or shorter copy.`;
  return '';
}
// The wire shape of one reference. A file goes to the asset store when `assets` is there, else inline when small;
// text always goes inline. Throws a plain-worded Error. Never reads the file into chat.
export async function encodeReferenceUpload(assets, { type, file, text, note }) {
  const cleanNote = String(note || '').replace(/\s+/g, ' ').trim();
  if (cleanNote.length > REFERENCE_NOTE_MAX) throw new Error(`Keep the note under ${REFERENCE_NOTE_MAX} characters.`);
  const base = { type, ...(cleanNote ? { note: cleanNote } : {}) };
  const kind = file ? referenceKindOf(file.name) : 'text';
  if (kind === 'text') {
    const body = file ? await file.text() : String(text || '');
    if (!body.trim()) throw new Error('Type some text, or choose a file.');
    if (body.length > REFERENCE_TEXT_MAX) throw new Error(`That text is too long (limit ${REFERENCE_TEXT_MAX.toLocaleString('en-US')} characters). Shorten it or split it.`);
    return { ...base, action: 'text', text: body, fileName: file ? file.name : 'caption.txt' };
  }
  const common = { ...base, fileName: file.name, mimeType: file.type || '', size: file.size };
  if (assets) {
    try {
      const asset = await assets.upload(file, { type: file.type || 'application/octet-stream' });
      return { ...common, action: 'asset', assetId: asset.id };
    } catch {
      if (file.size > REFERENCE_INLINE_MAX) throw new Error('The board could not upload that file right now. It may be too big for storage or storage is busy. Try again, or use a smaller copy.');
    }
  } else if (file.size > REFERENCE_INLINE_MAX) {
    throw new Error('Uploading this file needs the board opened inside Claude. Open it from your Claude session and try again.');
  }
  return { ...common, action: 'upload', dataBase64: await blobToBase64(file) };
}
// The control that adds one reference: what it is, the file or the typed text, and a note. The job page's panel and the
// new-job form both use it; `prefix` only keeps their field names and ids apart ('ref' on the job page, 'nref' in the form).
function referenceControl(state = {}, { prefix = 'ref', busy = false, idKey = '' } = {}) {
  const type = REFERENCE_TYPES.find(item => item.id === (state.type || 'picture')) || REFERENCE_TYPES[0];
  const isText = type.id === 'caption';
  const fileId = `${prefix}-file${idKey ? `-${idKey}` : ''}`;
  const fileInput = `<input type="file" id="${fileId}" class="kit-file visually-hidden" name="${prefix}_file" accept="${type.kinds.includes('text') && type.kinds.length === 1 ? '.txt,.md,.srt,.vtt' : ''}" aria-label="Choose a file to add" ${busy ? 'disabled' : ''}>`;
  const picked = state.fileName ? `<span class="muted">${esc(state.fileName)}</span>` : `<span class="muted">${esc(type.hint)}</span>`;
  const textArea = isText ? `<label class="field-wide">Caption or notes<textarea name="${prefix}_text" rows="4" maxlength="${REFERENCE_TEXT_MAX}" ${busy ? 'disabled' : ''}>${esc(state.text || '')}</textarea></label>` : '';
  return `<label>What is it<select name="${prefix}_type" ${busy ? 'disabled' : ''}>${REFERENCE_TYPES.map(item => `<option value="${item.id}"${item.id === type.id ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>${textArea}<div class="ref-file">${fileInput}<label class="kit-file-button" for="${fileId}">${KIT_ICONS.upload}<span>${isText ? 'Or choose a text file' : 'Choose a file'}</span></label>${picked}</div><label>Note (optional)<input name="${prefix}_note" maxlength="${REFERENCE_NOTE_MAX}" value="${esc(state.note || '')}" placeholder="e.g. match this colour and pace" ${busy ? 'disabled' : ''}></label>`;
}
// The References panel on a job page: what is saved, and the control that adds more.
export function referencesPanel(project, state = {}, { openKeys = new Set(), open: forceOpen = false } = {}) {
  const refs = Array.isArray(project?.references) ? project.references : [];
  const busy = Boolean(state.busy);
  const chips = refs.map(ref => `<li><button type="button" class="ab-chip" disabled aria-label="${esc(`${ref.label}: ${ref.name}`)}">${esc(ref.name)}<small>${esc(ref.label)}${ref.note ? ` · ${esc(truncateText(ref.note, 60))}` : ''}</small></button></li>`).join('');
  const list = refs.length ? `<ul class="ab-chips" aria-label="References on this job">${chips}</ul>` : '<p class="muted">Nothing added yet. Pictures, clips, audio or wording you add here are used for this job.</p>';
  const form = `<div class="ref-form">${referenceControl(state, { prefix: 'ref', busy })}<div class="ref-actions"><button type="button" class="primary" data-ref-action="send" ${busy ? 'disabled' : ''}>${busy ? 'Saving...' : 'Add reference'}</button></div>${state.error ? `<p class="field-error" role="alert">${esc(state.error)}</p>` : ''}${!state.error && state.message ? `<p class="muted" role="status">${esc(state.message)}</p>` : ''}</div>`;
  const open = forceOpen || openKeys.has('more:refs') || busy || Boolean(state.error);
  return `<details class="panel doc-panel" data-open-key="more:refs"${open ? ' open' : ''}><summary><span class="doc-summary-title">Add a reference</span>${refs.length ? ` <span class="count">${refs.length}</span>` : ''}</summary><div class="doc-body">${list}${form}</div></details>`;
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

// The paperclip in the agent chat composer, and the same control below it: pick a file, check its type, add a note, send.
const PAPERCLIP = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 11-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>';
export function chatAttachment(state = {}, agentName = 'Director') {
  const busy = Boolean(state.busy);
  const open = Boolean(state.open || state.error || busy);
  const button = `<button type="button" class="attach icon" data-aref-action="toggle" aria-label="Attach a file" aria-expanded="${open ? 'true' : 'false'}" title="Attach a file" ${busy ? 'disabled' : ''}>${PAPERCLIP}</button>`;
  const panel = open
    ? `<div class="ab-attach ref-form" data-aref><p class="field-hint">Send ${esc(agentName)} a picture, clip, audio or text. It is saved on this job.</p>${referenceControl(state, { prefix: 'aref', busy })}<div class="ref-actions"><button type="button" class="primary" data-aref-action="send" ${busy ? 'disabled' : ''}>${busy ? 'Sending...' : 'Send file'}</button></div>${state.error ? `<p class="field-error" role="alert">${esc(state.error)}</p>` : ''}${!state.error && state.message ? `<p class="muted" role="status">${esc(state.message)}</p>` : ''}</div>`
    : '';
  return { button, panel };
}

// The upload control inside a question card, when the Director asked for a file.
export function questionUpload(item, state = {}) {
  const busy = Boolean(state.busy);
  const shown = { ...state, type: state.type || item?.wantsUpload?.type || 'picture' };
  const key = String(item?.questionId || '');
  return `<div class="inbox-upload ref-form" data-qref="${esc(key)}">${referenceControl(shown, { prefix: 'qref', busy, idKey: key })}<div class="ref-actions"><button type="button" class="primary" data-qref-send="${esc(key)}" ${busy ? 'disabled' : ''}>${busy ? 'Sending...' : 'Send file'}</button></div>${state.error ? `<p class="field-error" role="alert">${esc(state.error)}</p>` : ''}${!state.error && state.message ? `<p class="muted" role="status">${esc(state.message)}</p>` : ''}</div>`;
}

// The same control inside the new-job form, before the job exists: each one the person adds waits in a short list and is
// sent with the job, so Claude's first read of the brief already has it. Several are allowed.
export const NEW_JOB_REFERENCES_MAX = 8;
export function freshNewJobRefs() { return { type: 'picture', file: null, fileName: '', text: '', note: '', error: '', open: false, items: [] }; }
// Check what is in the control and, when it is a reference, return it as a list item; else { error }.
export function newJobReferenceItem(state) {
  const type = REFERENCE_TYPES.find(item => item.id === state.type);
  if (!type) return { error: 'Choose what this is first.' };
  const text = String(state.text || '');
  if (state.file) {
    const problem = referenceProblem(state.type, state.file);
    if (problem) return { error: problem };
  } else if (!(type.id === 'caption' && text.trim())) {
    return { error: type.id === 'caption' ? 'Type some text, or choose a text file.' : 'Choose a file first.' };
  }
  const note = String(state.note || '').replace(/\s+/g, ' ').trim();
  if (note.length > REFERENCE_NOTE_MAX) return { error: `Keep the note under ${REFERENCE_NOTE_MAX} characters.` };
  return { item: { type: state.type, file: state.file || null, text: state.file ? '' : text, note, name: state.file ? state.file.name : 'Typed text', label: type.label } };
}
export function newJobReferences(refs = freshNewJobRefs(), { busy = false } = {}) {
  const items = Array.isArray(refs.items) ? refs.items : [];
  const list = items.length
    ? `<ul class="ab-chips" aria-label="References for this job">${items.map((item, index) => `<li><span class="ab-chip">${esc(truncateText(item.name, 40))}<small>${esc(item.label)}${item.note ? ` · ${esc(truncateText(item.note, 60))}` : ''}</small></span> <button type="button" class="sb-ask" data-nref-remove="${index}" aria-label="${esc(`Remove ${item.name}`)}" ${busy ? 'disabled' : ''}>Remove</button></li>`).join('')}</ul>`
    : '';
  const full = items.length >= NEW_JOB_REFERENCES_MAX;
  const control = full
    ? `<p class="muted">That is ${NEW_JOB_REFERENCES_MAX} references. You can add more on the job page after it starts.</p>`
    : `<div class="ref-form">${referenceControl(refs, { prefix: 'nref', busy })}<div class="ref-actions"><button type="button" class="sb-ask" data-nref-action="add" ${busy ? 'disabled' : ''}>Add to this job</button></div></div>`;
  const open = refs.open || items.length > 0 || Boolean(refs.error);
  return `<details class="new-refs field-wide" data-open-key="new:refs"${open ? ' open' : ''}><summary>References (optional)${items.length ? ` <span class="count">${items.length}</span>` : ''}</summary><div class="new-refs-body"><p class="field-hint">Pictures, clips, audio, wording or other files you want used for this job.</p>${list}${control}${refs.error ? `<p class="field-error" role="alert">${esc(refs.error)}</p>` : ''}</div></details>`;
}

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
export function kitFocusSelector(action, index, count) {
  if (action === 'add-color') return `[name="kit_color_hex_${count - 1}"]`;
  if (action === 'add-font') return `[name="kit_font_family_${count - 1}"]`;
  if (action === 'remove-color') return count > 0 ? `[name="kit_color_hex_${Math.min(index, count - 1)}"]` : '[data-kit-action="add-color"]';
  if (action === 'remove-font') return count > 0 ? `[name="kit_font_family_${Math.min(index, count - 1)}"]` : '[data-kit-action="add-font"]';
  if (action === 'remove-logo' || action === 'replace-logo') return '#kit-logo-file';
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
});

// One labelled block of the kit grid (Logo, Colours or Fonts). It reuses the
// context fields' own .context-field/.context-field-head markup, so its label
// row, label style and label-to-control spacing are exactly those of
// "Audience" above it, with the "Added by you" pill where their Edit button sits.
function kitBlock(key, label, body, tag = '', extraClass = '') {
  return `<div class="context-field kit-block${extraClass ? ` ${extraClass}` : ''}" role="group" aria-labelledby="kit-${key}-label"><div class="context-field-head"><span class="kit-label" id="kit-${key}-label">${esc(label)}</span>${tag}</div><div class="kit-stack">${body}</div></div>`;
}

export function kitSection(brand, kit = {}, fieldErrors = null, held = false) {
  const phase = kitPhase(brand, held);
  const loading = phase === 'loading';
  const dis = loading ? 'disabled' : '';
  const projected = brand?.kit || {};
  const provided = projected.provided || {};
  const showTags = phase === 'ready';
  const tag = '<span class="pill">Added by you</span>';
  const logoState = kit.logo || {};
  const palette = Array.isArray(kit.palette) ? kit.palette : (projected.palette || []);
  const fonts = Array.isArray(kit.fonts) ? kit.fonts : (projected.fonts || []);
  const removed = logoState.action === 'remove';
  const ownUpload = logoState.action === 'upload' || logoState.action === 'asset';
  const preview = kitImageSrc(removed ? null : ownUpload ? (logoState.previewDataUrl || null) : projected.logo?.thumb || null);
  const hasLogo = !removed && Boolean(preview || ownUpload || projected.logo);
  const savedLogo = !logoState.action && Boolean(projected.logo);
  const logoAlt = brand?.name ? `${brand.name} logo` : 'Logo';
  const logoError = fieldErrors?.logo || null;
  const fileInput = label => `<input type="file" id="kit-logo-file" class="kit-file visually-hidden" name="kit_logo_file" accept="image/png,image/jpeg,image/webp,image/svg+xml"${label ? ` aria-label="${label}"` : ''} aria-invalid="${logoError ? 'true' : 'false'}" ${logoError ? 'aria-describedby="kit-logo-error"' : ''} ${dis}>`;
  const logoBody = hasLogo
    ? `<div class="kit-logo-preview${preview ? '' : ' kit-logo-preview-none'}">${preview ? `<img src="${esc(preview)}" alt="${esc(logoAlt)}">` : `<span>${savedLogo ? 'Logo saved (no preview)' : 'No preview'}</span>`}</div><div class="kit-logo-actions">${fileInput('Replace logo')}<label class="kit-file-button" for="kit-logo-file">Replace</label><button type="button" class="quiet" data-kit-action="remove-logo" ${dis}>Remove logo</button></div>`
    : `${fileInput('')}<label class="kit-upload" for="kit-logo-file">${KIT_ICONS.upload}<span class="kit-upload-title">Upload logo</span><span class="kit-upload-hint">PNG, JPG, WebP or SVG</span></label>`;
  const logoBlock = kitBlock('logo', 'Logo', `${logoBody}${logoError ? `<p class="field-error" id="kit-logo-error" role="alert">${esc(logoError)}</p>` : ''}`, showTags && provided.logo ? tag : '', 'kit-logo-block');

  const removeButton = (action, index, label) => `<button type="button" class="quiet kit-icon-button" data-kit-action="${action}" data-index="${index}" aria-label="${label}" ${dis}>${KIT_ICONS.remove}</button>`;
  const colorRows = palette.map((color, index) => {
    const n = index + 1;
    const error = fieldErrors?.[`color_${index}`];
    const errorId = `kit-color-${index}-error`;
    return `<div class="kit-row kit-color-row"><input type="color" class="kit-swatch" name="kit_color_swatch_${index}" value="${esc(normalizeHex(color?.value) || '#000000')}" aria-label="Pick colour ${n}" ${dis}><input type="text" name="kit_color_hex_${index}" maxlength="7" placeholder="#1A2B3C" value="${esc(color?.value || '')}" aria-label="Colour ${n} hex code" spellcheck="false" autocomplete="off" aria-invalid="${error ? 'true' : 'false'}" ${error ? `aria-describedby="${errorId}"` : ''} ${dis}><select name="kit_color_role_${index}" aria-label="Colour ${n} role" ${fieldErrors?.palette ? 'aria-describedby="kit-palette-error"' : ''} ${dis}>${KIT_COLOR_ROLES.map(role => `<option value="${role}" ${color?.role === role ? 'selected' : ''}>${humanize(role)}</option>`).join('')}</select>${removeButton('remove-color', index, `Remove colour ${n}`)}${error ? `<p class="field-error" id="${errorId}" role="alert">${esc(error)}</p>` : ''}</div>`;
  }).join('');
  const settled = phase === 'ready' && CAPTURE_SETTLED.has(projected.capture?.status) && !(projected.palette || []).length;
  const socialPlatform = KIT_SOCIAL_PLATFORMS[projected.paletteSource];
  const paletteNote = socialPlatform && !provided.palette && palette.length ? `<p class="muted">From your ${socialPlatform} profile picture.</p>` : '';
  const emptyColours = settled ? 'We could not read your colours. Add them here.' : 'No colours yet';
  const colorsBody = `${paletteNote}${colorRows || `<p class="muted">${emptyColours}</p>`}${fieldErrors?.palette ? `<p class="field-error" id="kit-palette-error" role="alert">${esc(fieldErrors.palette)}</p>` : ''}<button type="button" class="kit-add" data-kit-action="add-color" ${loading || palette.length >= KIT_LIMITS.maxColors ? 'disabled' : ''}>${KIT_ICONS.plus}<span>Add colour</span></button>`;
  const colorsBlock = kitBlock('colors', 'Colours', colorsBody, showTags && provided.palette ? tag : '');

  const fontOptions = (projected.fonts || []).map(font => `<option value="${esc(font.family)}">`).join('');
  const fontRows = fonts.map((font, index) => {
    const n = index + 1;
    const error = fieldErrors?.[`font_${index}`];
    const errorId = `kit-font-${index}-error`;
    // Quotes, semicolons and braces are dropped so a typed name can only
    // ever be a font family inside the inline style, never more CSS.
    const family = String(font?.family || '').trim().replace(/['"\\;{}<>]/g, '');
    const sampleFamily = family ? `'${family}', var(--sans)` : 'var(--sans)';
    return `<div class="kit-row kit-font-row"><input type="text" name="kit_font_family_${index}" maxlength="80" placeholder="Inter" list="kit-font-options" value="${esc(font?.family || '')}" aria-label="Font ${n} name" autocomplete="off" aria-invalid="${error ? 'true' : 'false'}" ${error ? `aria-describedby="${errorId}"` : ''} ${dis}><select name="kit_font_use_${index}" aria-label="Font ${n} use" ${dis}>${KIT_FONT_USES.map(use => `<option value="${use}" ${font?.use === use ? 'selected' : ''}>${humanize(use)}</option>`).join('')}</select><span class="kit-font-sample" aria-hidden="true" style="font-family:${esc(sampleFamily)}">Aa</span>${removeButton('remove-font', index, `Remove font ${n}`)}${error ? `<p class="field-error" id="${errorId}" role="alert">${esc(error)}</p>` : ''}</div>`;
  }).join('');
  const fontsBody = `<datalist id="kit-font-options">${fontOptions}</datalist>${fontRows || '<p class="muted">No fonts yet</p>'}<button type="button" class="kit-add" data-kit-action="add-font" ${loading || fonts.length >= KIT_LIMITS.maxFonts ? 'disabled' : ''}>${KIT_ICONS.plus}<span>Add font</span></button>`;
  const fontsBlock = kitBlock('fonts', 'Fonts', fontsBody, showTags && provided.fonts ? tag : '');

  const note = loading
    ? 'Reading your logo, colours and fonts...'
    : phase === 'new'
      ? 'Have your logo, brand colours or fonts? Add them now and Claude will skip looking for them.'
      : 'Check these and change anything that is not right.';
  return `<fieldset class="kit-fieldset" ${dis} aria-labelledby="kit-heading"${loading ? ' aria-busy="true"' : ''}><div class="kit-head"><h3 id="kit-heading">Logo, colours and fonts</h3><p class="muted">${note}</p></div><div class="kit-grid">${logoBlock}${colorsBlock}${fontsBlock}</div></fieldset>`;
}

// brandReady (section 3/8): readyForJobs when the projection reports it,
// else onboardingStatus === 'complete' for a legacy brand with no kit gate.
export function brandReady(brand) {
  if (typeof brand?.readyForJobs === 'boolean') return brand.readyForJobs;
  return brand?.onboardingStatus === 'complete';
}

// The onboarding card: title "Brand profile" (promoted from the former
// eyebrow), the "First step"/"Continue" tag, the brand name and four
// channels, then the five context fields directly below them as normal
// labelled fields (no collapsible wrapper, no "optional" language). `state`
// is the inline draft this form renders for; passing it
// explicitly, instead of reading a module-level variable, keeps this
// function usable from outside the browser runtime closure.
export function inlineOnboardingForm(brand, state = {}, signal = {}) {
  const existing = Boolean(brand);
  const prefilled = state.prefilled || contextPrefill(existing ? profileFormValues(brand) : {});
  const unlocked = state.unlocked || {};
  const values = { ...(existing ? profileFormValues(brand) : {}), ...(state.values || {}) };
  if (existing && !values.name) values.name = brand.name;
  const fieldErrors = state.fieldErrors || null;
  const phase = brandResearchPhase(brand, state);
  const pending = state.submitted || state.needsReconciliation;
  const note = state.declined
    ? `<div class="notice" role="status"><span>${esc(state.message || 'Declined in chat. Nothing was changed.')}</span></div>`
    : pending
      ? notifyClaudeNotice(state, signal)
      : phase === 'running'
        ? '<div class="notice" role="status"><span>Claude is researching this brand. The empty fields fill in when it is done.</span></div>'
        : phase === 'failed'
          ? '<div class="notice" role="status"><span>Research could not finish. Fill in what you know, then save.</span></div>'
          : phase === 'new'
            ? `<p class="muted">Add the brand's links and anything you already know. Claude researches the rest.</p>`
            : '';
  const buttonLabel = state.busy ? 'Saving...'
    : state.submitted ? 'Waiting for Claude'
    : state.needsReconciliation ? 'Needs Claude attention'
    : phase === 'running' ? 'Researching...'
    : phase === 'new' ? 'Start onboarding'
    : 'Save and continue';
  const buttonDisabled = state.busy || pending || phase === 'running';
  const kit = kitSection(existing ? brand : null, state.kit || {}, state.kitErrors || null, !existing && phase === 'running');
  return `<section class="start-card onboarding"><div class="start-head"><div><h2>Brand profile</h2></div><span class="stage-tag">${existing ? 'Continue' : 'First step'}</span></div>${note}<form id="inline-form" class="start-form" novalidate><input type="hidden" name="brand" value="${esc(brand?.slug || '')}"><div class="form-grid"><label class="field-wide">Brand name<input name="name" value="${esc(values.name || '')}" maxlength="160" placeholder="e.g. Acme Goods" autocomplete="organization" ${existing ? 'readonly' : 'required'} aria-invalid="${fieldErrors?.name ? 'true' : 'false'}" ${fieldErrors?.name ? 'aria-describedby="field-name-error"' : ''}>${fieldErrors?.name ? `<p class="field-error" id="field-name-error" role="alert">${esc(fieldErrors.name)}</p>` : ''}</label></div><div class="channel-grid">${CHANNEL_NAMES.map(name => channelField(name, values, fieldErrors)).join('')}</div><div class="channel-grid context-grid">${targetMarketField(values, fieldErrors)}${CONTEXT_FIELDS.map(field => contextField(field, values, prefilled, unlocked, fieldErrors, researchSuggested(brand, field.name, values, prefilled))).join('')}</div>${kit}${state.error ? `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>` : ''}<div class="start-foot"><button class="primary" type="submit" ${buttonDisabled ? 'disabled' : ''}>${buttonLabel}</button></div></form></section>`;
}

const COMPOSER_TITLE_LIMIT = 80;
const COMPOSER_TEXT_LIMIT = 6000;
const COMPOSER_QUESTION = 'What do you want to get done?';
const COMPOSER_PLACEHOLDER = 'For example: an Instagram Reel for our new serum, or a report on who leads the vitamin C market.';
const COMPOSER_BRAND_HINT = 'Posts and campaigns need one. Claude will ask.';
const COMPOSER_FILES_LINE = 'Have files? Add them under References, or in chat after you send this.';

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
  if (!text) errors.text = 'Say what you want to get done.';
  const slug = String(values.brand ?? '').trim();
  const brand = slug && slug !== NO_BRAND ? brands.filter(brandReady).find(item => item.slug === slug) || null : null;
  if (slug && slug !== NO_BRAND && !brand) errors.brand = 'Choose one of your brands, or leave it empty.';
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
  const text = newJobField(`${id}-text`, COMPOSER_QUESTION, `<textarea id="${id}-text" name="text" rows="${inbox ? 4 : 5}" maxlength="${COMPOSER_TEXT_LIMIT}" placeholder="${esc(COMPOSER_PLACEHOLDER)}" ${newJobAria(`${id}-text`, { error: errors.text })}>${esc(values.text || '')}</textarea>`, { error: errors.text, wide: true, hidden: true });
  const brand = ready.length
    ? newJobField(`${id}-brand`, 'Brand', `<select id="${id}-brand" name="brand" ${newJobAria(`${id}-brand`, { error: errors.brand, hint: COMPOSER_BRAND_HINT })}><option value="" ${brandValue ? '' : 'selected'}>No brand chosen</option>${ready.map(item => `<option value="${esc(item.slug)}" ${brandValue === item.slug ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>`, { error: errors.brand, hint: COMPOSER_BRAND_HINT })
    : '<div class="new-field"><span class="new-field-label">Brand</span><p class="field-note">Posts and campaigns need a brand. <button type="button" class="sb-ask" data-action="brand">Onboard a brand</button></p></div>';
  const links = newJobField(`${id}-links`, 'Links (optional)', `<textarea id="${id}-links" class="links-input" name="links" rows="2" maxlength="${LINK_LIMIT * 2100}" placeholder="One link per line" spellcheck="false" ${newJobAria(`${id}-links`, { error: errors.links })}>${esc(values.links || '')}</textarea>`, { error: errors.links });
  const blocked = state.busy || state.submitted || state.needsReconciliation;
  const label = state.busy ? 'Sending...' : state.submitted ? 'Waiting for Claude' : state.needsReconciliation ? 'Needs Claude attention' : 'Send';
  const problem = state.error ? `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>` : '';
  const foot = `<div class="start-foot"><small class="composer-files">${esc(COMPOSER_FILES_LINE)}</small><button class="primary" type="submit" ${blocked ? 'disabled' : ''}>${label}</button></div>`;
  const form = `<form id="${inbox ? 'starter-form' : 'inline-form'}" class="start-form composer-form" novalidate>${text}<div class="composer-grid">${brand}${links}</div>${newJobReferences(state.refs, { busy: state.busy || state.submitted })}${problem}${foot}</form>`;
  if (inbox) return `<section class="composer composer-inbox" aria-labelledby="starter-title"><h3 class="composer-title" id="starter-title">${COMPOSER_QUESTION}</h3>${form}</section>`;
  const notice = state.declined ? `<div class="notice" role="status"><span>${esc(state.message || 'Declined in chat. Nothing was changed.')}</span></div>` : '';
  return `<section class="start-card new-job composer"><div class="start-head"><h2 id="composer-title">${COMPOSER_QUESTION}</h2></div>${notice}${form}</section>`;
}

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
  return `<p class="planned-as"><span class="planned-text">Claude planned this as <strong>${esc(name)}</strong>: ${esc(reason)}</span>${action}</p>`;
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
  return `<div class="notice" role="status"><span>The brand profile has changed since this job was planned (was version ${esc(brandProfile.plannedRevision)}, now version ${esc(brandProfile.currentRevision)}). Ask Claude to check whether the plan still fits.</span></div>`;
}

export function brandPillarsPill(brand) {
  const count = Array.isArray(brand?.profile?.contentPillars) ? brand.profile.contentPillars.filter(item => String(item || '').trim()).length : 0;
  if (!count) return '';
  return brand.pillarsConfirmed ? '<span class="pill ready">Pillars confirmed</span>' : '<span class="pill needed">Pillars not confirmed</span>';
}

export function brandVoiceLine(brand) {
  const voice = brand?.voice;
  if (!voice || voice.complete) return '';
  const reasons = Array.isArray(voice.reasons) ? voice.reasons.filter(item => typeof item === 'string' && item.trim()) : [];
  return reasons.length ? `<p class="muted brand-chip-voice">${esc(reasons.join(' '))}</p>` : '';
}

export function brandChip(brand, metricool = {}) {
  const ready = brandReady(brand);
  const researching = brandResearchPhase(brand) === 'running';
  const state = ready ? 'ready' : 'onboarding';
  const note = researching ? '<p class="muted brand-chip-voice">Claude is researching this brand. The profile fills in when it\'s done.</p>' : brandVoiceLine(brand);
  const action = researching
    ? '<button class="quiet" type="button" disabled>Researching...</button>'
    : `<button class="quiet" data-onboard="${esc(brand.slug)}">${ready ? 'Update' : 'Continue'}</button>`;
  const pillars = researching ? '' : brandPillarsPill(brand);
  return `<div class="brand-chip"><span class="avatar">${esc((brand.name || 'BR').slice(0,2).toUpperCase())}</span><span class="brand-chip-body"><span class="brand-chip-name"><strong>${esc(brand.name)}</strong><small>${esc(ready ? 'Ready for jobs' : 'Onboarding in progress')}</small>${note}${brandStudioWorkspaceLine(brand)}${brandMetricoolLine(brand, metricool)}</span><span class="brand-chip-state"><span class="pill ${state}">${esc(humanize(state))}</span>${pillars}</span>${action}</span></div>`;
}

// Where this brand's posts go: the Metricool brand it posts through, with one chip per
// platform saying whether Metricool's account matches the channel the brand card lists, and a
// Change control (at the end of the chips row, or of the warning when the saved brand is gone)
// when there is another Metricool brand to move to, or when the saved one is gone. A brand with no choice shows nothing (the Inbox asks for up to six brands)
// unless Metricool has more than six: then a picker shows here, since an Inbox question only
// holds six buttons. Only a ready brand gets a picker. `metricool` carries the saved list and the
// picker's own state, nothing else.
const COVERAGE_PLATFORMS = Object.freeze([['facebook', 'Facebook'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']]);
// Each chip is short enough to stay on one line at phone width; the full sentence is its title.
const COVERAGE_WORDS = Object.freeze({
  linked: ['ready', name => `${name} linked`, name => `${name} in Metricool matches the channel on this brand card.`],
  not_linked: ['needed', name => `${name} not linked`, name => `${name} is on this brand card but is not linked in Metricool.`],
  different_handle: ['needed', name => `${name} different handle`, name => `${name} in Metricool is a different account from the one on this brand card.`],
  unverified: ['needed', name => `${name}: check`, name => `Cannot tell whether ${name} in Metricool is the same account as on this brand card: check it in Metricool.`],
  only_in_metricool: ['needed', name => `${name}: only in Metricool`, name => `${name} is linked in Metricool but is not on this brand card.`],
});

export function metricoolCoverageChips(coverage, trailing = '') {
  const chips = COVERAGE_PLATFORMS.map(([key, name]) => {
    const word = COVERAGE_WORDS[coverage?.[key]];
    return word ? `<span class="pill ${word[0]}" title="${esc(word[2](name))}" aria-label="${esc(word[2](name))}">${esc(word[1](name))}</span>` : '';
  }).join('');
  return chips || trailing ? `<span class="metricool-chips">${chips}${trailing}</span>` : '';
}

export function brandMetricoolLine(brand, { brands = [], open = false, busy = false, selected = '', error = '' } = {}) {
  const publishing = brand?.publishing;
  const slug = esc(brand?.slug || '');
  const ready = brandReady(brand);
  if (publishing?.unreadable) return '<div class="brand-chip-publish"><p class="muted metricool-warning">Could not read this brand\'s Metricool details</p></div>';
  const gone = Boolean(publishing) && publishing.found === false;
  const askHere = !publishing && brands.length > 6 && ready;
  if (!publishing && !askHere) return '';
  if (publishing && publishing.connected === false) return '<div class="brand-chip-publish"><p class="muted">Metricool is not connected</p></div>';
  if ((open || askHere) && ready) {
    const current = publishing && !gone ? publishing.blogId : '';
    const chosen = selected || current;
    const options = [`<option value="" ${chosen ? '' : 'selected'} disabled>Choose a Metricool brand</option>`, ...brands.map(item => `<option value="${esc(item.id)}" ${item.id === chosen ? 'selected' : ''}>${esc(item.label)}</option>`)].join('');
    const cancel = publishing ? `<button type="button" class="quiet" data-metricool-cancel="${slug}" ${busy ? 'disabled' : ''}>Cancel</button>` : '';
    const label = askHere ? 'Which Metricool brand should this brand post through?' : 'Post through this Metricool brand';
    return `<div class="brand-chip-publish brand-chip-publish-edit"><label class="muted" for="metricool-select-${slug}">${esc(label)}</label><span class="metricool-pick"><select id="metricool-select-${slug}" name="metricool_brand_select" data-metricool-brand="${slug}" ${busy ? 'disabled' : ''}>${options}</select><button type="button" class="primary" data-metricool-save="${slug}" ${busy || !chosen || chosen === current ? 'disabled' : ''}>${busy ? 'Saving...' : 'Use this brand'}</button>${cancel}</span>${error ? `<p class="muted metricool-error" role="alert">${esc(error)}</p>` : ''}</div>`;
  }
  // Change sits at the end of the chips row, or at the end of the warning when the saved brand is gone.
  const canChange = ready && (brands.length > 1 || (gone && brands.length > 0));
  const change = canChange ? `<button type="button" class="quiet" data-metricool-change="${slug}">Change</button>` : '';
  if (gone) {
    return `<div class="brand-chip-publish"><p class="muted metricool-warning">Metricool no longer lists the brand <strong>${esc(publishing.label)}</strong>, so posts have nowhere to go.${change ? ` ${change}` : ''}</p></div>`;
  }
  return `<div class="brand-chip-publish"><p class="muted">Posts go out through Metricool, brand <strong>${esc(publishing.label)}</strong></p>${metricoolCoverageChips(publishing.coverage, change)}</div>`;
}

export function brandStudioWorkspaceLine(brand) {
  const name = brand?.studioWorkspace?.name;
  return name ? `<p class="muted brand-chip-workspace">Paid from ${esc(name)}</p>` : '';
}

// One connector on the Connectors setup step, also reused when the header's
// "Connectors" link reopens the same step later: a small provider mark with
// its initials (the same two-letter convention as the brand avatar), name
// and description on the left, and either its Connect/Skip actions or a
// state pill on the right. `busy` disables the actions while a request for
// this connector is in flight.
const CONNECTOR_GUIDANCE = Object.freeze({
  threeecho_studio: 'Add 3Echo Studio in claude.ai: Settings, Connectors, then come back and say done.',
  metricool: 'Add Metricool in claude.ai: Settings, Connectors, then come back and say done.',
});

export function connectorCard(connector, { busy = false } = {}) {
  const state = connector.state;
  const mark = esc(String(connector.name || '').slice(0, 2).toUpperCase());
  const key = esc(connector.key);
  // Metricool is added in claude.ai and then looked for. Once connected, the same connect request reads its brands
  // again, so the button says what it does: Refresh brands, for after a brand or social account is added in Metricool.
  const refreshable = connector.key === 'metricool';
  const connect = (extra = '', label = 'Connect') => `<button${extra} data-connect="${key}" ${busy ? 'disabled' : ''}>${label}</button>`;
  const actions = state === 'connected'
    ? `<span class="pill connected">Connected</span>${refreshable ? connect(' title="Read the brand list again after you add a brand or a social account in Metricool"', 'Refresh brands') : ''}`
    : state === 'skipped'
      ? `<span class="pill skipped">Skipped</span>${connect()}`
      : `${connect(' class="primary"')}<button data-skip="${key}" ${busy ? 'disabled' : ''}>Skip for now</button>`;
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
  const text = esc(helper || state.message || 'Saved. Claude picks this up automatically; if nothing happens, notify Claude.');
  const delivered = state.signal === 'sent';
  const showButton = artifact && availability !== 'off' && !delivered;
  const canNotify = availability === 'available';
  const button = showButton ? `<button type="button" data-action="signal" ${busy || !canNotify ? 'disabled' : ''}>${busy ? 'Notifying...' : 'Notify Claude'}</button>` : '';
  const waitSince = state.lastReminderAt || state.submittedAt;
  const dueForReminder = Number.isFinite(waitSince) && now - waitSince >= REMIND_DELAY_MS;
  const showReminder = artifact && Boolean(state.requestId) && (dueForReminder || state.reminding);
  const remindButton = showReminder ? `<button type="button" class="quiet" data-action="remind" data-request-id="${esc(state.requestId)}" ${state.reminding ? 'disabled' : ''}>${state.reminding ? 'Reminding...' : 'Remind Claude'}</button>` : '';
  const actions = button || remindButton ? `<span class="notice-actions">${button}${remindButton}</span>` : '';
  return `<div class="notice pending" role="status"><span>${text}</span>${actions}</div>`;
}

function usageFooterRow(label, tokens, elapsedMs, { note = '', cls = '' } = {}) {
  return `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</td><td class="num">${esc(number(tokens))}</td><td class="num">${esc(clock(elapsedMs))}</td></tr>`;
}

// "Usage by stage": job view lists this job's own stage rows (in the order
// given, waiting rows muted) then a bold Total, then the brand's shared
// research row; the overview lists one row per job (its title, tokens, and
// live time), then one Brand research row per brand. Missing measurements
// always render as "Not reported", never 0. An open row (job, stage, or a
// running brand research run) carries openSince and its shown time is
// topped up live via liveMs; now is a parameter so a test can render it
// deterministically. Returns '' when there is nothing to show.
// `bare` is the job page's Usage fold: the stage rows and brand research only, as the totals sit just above it.
export function usageFooter({ project, brands = [], projects = [], now = Date.now(), bare = false } = {}) {
  const rows = [];
  let credits = '';
  if (project) {
    const usage = project.usage || {};
    for (const stage of usage.stages || []) {
      rows.push(usageFooterRow(stage.label || humanize(stage.id), stage.tokens, liveMs(stage.elapsedMs, stage.openSince, now), { cls: stage.kind === 'waiting' ? 'usage-waiting' : '' }));
    }
    if (!bare) rows.push(usageFooterRow('Total', usage.tokens, liveMs(usage.elapsedMs, usage.openSince, now), { cls: 'usage-total' }));
    const brand = (brands || []).find(item => item.slug === project.brand);
    const brandStage = brand?.usage?.stages?.[0];
    if (brandStage) {
      rows.push(usageFooterRow('Brand research', brandStage.tokens, liveMs(brandStage.elapsedMs, brandStage.openSince, now), { note: 'Shared by every job for this brand; not part of the job total.' }));
    }
    const generation = usage.generation || {};
    const studio = creditFraction(generation.threeEchoCredits);
    const voice = creditFraction(generation.elevenLabsCredits);
    credits = !bare && (studio || voice) && !isReportJob(project) ? `<dl class="price-facts usage-credits"><div><dt>3Echo Studio credits used</dt><dd>${esc(studio || '0')}</dd></div><div><dt>ElevenLabs voice credits used</dt><dd>${esc(voice || '0')}</dd></div></dl>` : '';
  } else {
    for (const job of projects || []) {
      const usage = job.usage || {};
      rows.push(usageFooterRow(job.title || 'Untitled job', usage.tokens, liveMs(usage.elapsedMs, usage.openSince, now)));
    }
    for (const brand of brands || []) {
      const brandStage = brand?.usage?.stages?.[0];
      if (!brandStage) continue;
      rows.push(usageFooterRow(`Brand research (${brand.name})`, brandStage.tokens, liveMs(brandStage.elapsedMs, brandStage.openSince, now)));
    }
  }
  if (!rows.length) return '';
  const table = `<table><thead><tr><th>Stage</th><th class="num">Tokens</th><th class="num">Time</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  if (bare) return `<div class="usage-footer usage-stages">${table}</div>`;
  return `<section class="panel usage-footer"><div class="section-head"><h2>Usage by stage</h2></div>${table}${credits}</section>`;
}

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
  const shortened = report.truncated ? '<p class="muted">Shortened for the board. The full report is on your computer.</p>' : '';
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

const SHORTENED_COPY = 'This copy was shortened. The full report is on your computer.';

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
  rate_limited: 'Try again in a moment.',
  extension_not_enabled: 'This format can\'t be saved here.',
  rejected_extension: 'This format can\'t be saved here.',
  too_large: 'This file is too big to save here.',
});
const DOWNLOAD_FAILED = new Set(['bad_request', 'transform_error', 'request_unknown']);

export function downloadOutcome(code) {
  if (code === 'declined') return { note: '' };
  if (DOWNLOAD_NOTES[code]) return { note: DOWNLOAD_NOTES[code] };
  if (DOWNLOAD_FAILED.has(code)) return { note: 'The file could not be saved.' };
  return { note: 'Files can\'t be saved here.', unavailable: true };
}

// ---- Intake form ----------------------------------------------------------

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
const POST_TYPE_WORDS = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
export const isVerticalPostType = (platform, placement) => VERTICAL_TYPES.includes(placement) && (placement !== 'video' || platform === 'tiktok');
export function placementIssue(platform, placement, format, ratios = []) {
  if (!placement) return '';
  const name = { reel: 'A Reel', story: 'A Story', video: 'A TikTok video' }[placement] || 'This post type';
  if (format) {
    if ((placement === 'reel' || (platform === 'tiktok' && placement === 'video')) && !VIDEO_FORMATS.includes(format)) return `${name} needs a video format.`;
    if (placement === 'story' && !STORY_FORMATS.includes(format)) return 'A Story needs an image or video format.';
    if (platform === 'tiktok' && placement === 'photo' && !PHOTO_FORMATS.includes(format)) return 'A TikTok photo post needs the Image or Carousel format.';
    if (platform === 'instagram' && placement === 'post' && format === 'text_only') return 'An Instagram post needs an image or video format.';
    if (placement === 'carousel' && format !== 'carousel') return 'A carousel needs the Carousel format.';
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
      else if (!links.length) { if (field.missing) errors[key] = field.need === 'video' ? 'Add a link to the video, or give the file to Claude in chat.' : field.need === 'link_or_file' ? 'Add at least one link, or give the files to Claude in chat.' : 'Add at least one link.'; }
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
      if (!/^[A-Z]{3}$/.test(currency)) errors.budget_currency = 'Enter a three-letter currency code, for example SGD.';
      if (!amountText || !Number.isFinite(amount) || amount < 0) errors.budget_amount = 'Enter the most you want to spend.';
      if (!errors.budget_currency && !errors.budget_amount && (field.missing || changed(['budget_currency', 'budget_amount']))) patch.budget = { ...(field.value?.extra || {}), currency, maxTotalAmount: amount };
    } else if (field.input === 'url') {
      const text = normalizeChannelInput('website', values[key]);
      let valid = false;
      try { valid = /^https?:$/.test(new URL(text).protocol); } catch { valid = false; }
      if (!valid) { if (field.missing || text) errors[key] = 'Enter a full URL, for example https://example.com.'; }
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
        if (!Number.isInteger(count) || count < 1 || count > 100) { errors[`${row.key}_count`] = 'Enter a whole number from 1 to 100.'; rowErrors = true; }
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
  if (!Object.keys(patch).length) return { errors: { form: 'Change or answer at least one item before saving.' } };
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
const PLATFORM_NEEDS = { instagram: 'a picture or a video', tiktok: 'a video, a picture or a set of pictures', facebook: 'a picture, a video or words' };
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

function intakeFieldHtml(field, values, errors, platforms, photo, { prefix = 'intake', needed = true, labelled = true } = {}) {
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
    return `<div class="intake-field" role="group" aria-labelledby="${id}-label">${head('legend')}<div class="budget-row"><input name="budget_currency" maxlength="3" placeholder="SGD" autocomplete="off" aria-label="Currency" value="${esc(values.budget_currency || '')}" ${invalid(errors, 'budget_currency', prefix)}><input type="number" name="budget_amount" min="0" step="any" placeholder="Most you will spend" aria-label="Maximum total amount" value="${esc(values.budget_amount ?? '')}" ${invalid(errors, 'budget_amount', prefix)}></div>${fieldError(errors, 'budget_currency', prefix)}${fieldError(errors, 'budget_amount', prefix)}</div>`;
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
    ? `<div class="notice" role="status"><span>${esc(state.message || 'Declined in chat. Nothing was changed.')}</span></div>`
    : pending ? notifyClaudeNotice(state, signal) : '';
  const otherList = other.length ? `<div class="intake-other"><span class="intake-label-text">${fields.length ? 'Also needed, in chat' : 'Still needed'}</span><ul>${other.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : '';
  if (!fields.length) {
    return `<section class="panel intake" aria-labelledby="intake-title"><div class="section-head"><h2 id="intake-title">Finish the brief</h2></div>${notice}${otherList}</section>`;
  }
  const buttonLabel = state.busy ? 'Saving...' : state.submitted ? 'Waiting for Claude' : state.needsReconciliation ? 'Needs Claude attention' : 'Save and continue';
  const error = state.error || errors?.form ? `<p class="notice error inline-error" role="alert">${esc(errors?.form || state.error)}</p>` : '';
  const platforms = intakePlatforms(intake, values);
  const brief = intake.brief && !fields.some(field => field.key === 'request') ? `<div class="intake-brief"><span class="intake-label-text">Your brief</span><p>${esc(intake.brief)}</p></div>` : '';
  return `<section class="panel intake" aria-labelledby="intake-title"><div class="section-head"><h2 id="intake-title">Finish the brief</h2></div>${notice}<form id="intake-form" class="intake-form" novalidate>${brief}<div class="intake-grid">${fields.map(field => intakeFieldHtml(field, values, errors, platforms, state.photo)).join('')}</div>${otherList}${error}<div class="intake-foot"><button class="primary" type="submit" ${state.busy || pending ? 'disabled' : ''}>${buttonLabel}</button></div></form></section>`;
}

// ---- Reviews --------------------------------------------------------------

const DRAWER_TAB_LABELS = Object.freeze({ output: 'Output', prompt: 'Prompt', trace: 'How it was made', about: 'About' });

export function drawerTabs(file) {
  return file?.made ? ['output', 'prompt', 'trace', 'about'] : ['output', 'about'];
}

export function drawerPrompt(file) {
  const prompt = typeof file?.prompt === 'string' ? file.prompt.trim() : '';
  return prompt ? `<pre class="drawer-prompt">${esc(prompt)}</pre>` : '<p class="muted">No prompt was recorded for this output.</p>';
}

const fact = (label, value) => (value ? `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>` : '');

export function drawerMade(file) {
  const made = file?.made;
  if (!made) return '<p class="muted">Nothing was recorded for how this output was made.</p>';
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
  sample: 'Approve the sample image',
  pictures: 'Check the pictures',
  clips: 'Check the video clips',
  cut: 'Check the joined video',
  content: 'Approve the final post',
  publish: 'Confirm where and when to post',
  campaign_proposal: 'Approve the campaign plan',
  campaign_activation: 'Approve going live',
  findings: 'Approve the report',
});
const REVIEW_WAITING = Object.freeze({
  preparing: 'Claude is preparing the files for this review.',
  loading: 'Loading this review...',
  syncing: 'Waiting for Claude to put this review on the board.',
  changed: 'This changed after it was shown to you. Ask Claude to show it again.',
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
  if (project?.stageSummary) return { done: project.stageSummary.done || 0, total: project.stageSummary.total || 0 };
  const stages = project?.stages || [];
  return { done: stages.filter(stage => typeof stage !== 'string' && stage.status === 'complete').length, total: stages.length };
}

export function jobLoadingLine(state = 'loading') {
  return `<p class="muted job-loading" role="status">${esc(state === 'loading' ? 'Loading this job...' : 'Waiting for Claude to put this job on the board.')}</p>`;
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
const PRICE_TOTAL_LABELS = Object.freeze({ threeEcho: '3Echo Studio credits', elevenLabs: 'ElevenLabs voice credits' });
const PRICE_WORDS = Object.freeze({ threeEcho: ['Studio credit', 'Studio credits'], elevenLabs: ['voice credit', 'voice credits'] });
const PRICE_PROVIDER_NAMES = Object.freeze({ threeEcho: '3Echo Studio', elevenLabs: 'ElevenLabs' });
const QUOTE_KIND_LABELS = Object.freeze({ image: 'Image', video: 'Video clip', voice: 'Voice-over' });

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

export function conceptCards(concepts, choice = null, { disabled = false } = {}) {
  const list = concepts?.concepts || [];
  if (!list.length) return '<p class="muted">No concepts were found in this file.</p>';
  return `<div class="concept-grid" role="radiogroup" aria-label="Concepts">${list.map(concept => {
    const credits = Number.isInteger(concept.credits) ? `${concept.credits.toLocaleString()} credits for media` : '';
    const fields = (concept.fields || []).filter(field => String(field.value || '').trim());
    const fieldRows = fields.map(field => {
      const isSourceRef = /^insight it rests on$/i.test(field.label || '');
      const humanized = isSourceRef ? humanizeSourceRef(field.value) : null;
      const value = humanized ? esc(humanized) : inlineMarkdown(field.value);
      return `<div>${field.label ? `<dt>${esc(field.label)}</dt>` : ''}<dd${/\n/.test(field.value) ? ' class="lines"' : ''}>${value}</dd></div>`;
    }).join('');
    return `<label class="concept-card"><input type="radio" class="visually-hidden" name="concept_choice" value="${esc(concept.id)}" ${choice === concept.id ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="concept-body"><span class="concept-head"><span class="concept-id" aria-hidden="true">${esc(concept.id)}</span><span class="concept-title"><strong>${esc(concept.title)}</strong>${concept.recommended ? '<span class="pill ready">Recommended</span>' : ''}</span><span class="concept-radio" aria-hidden="true"></span></span>${fields.length ? `<dl class="review-fields">${fieldRows}</dl>` : ''}${credits ? `<span class="concept-foot">${esc(credits)}</span>` : ''}</span></label>`;
  }).join('')}</div>`;
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

const CTA_STYLE_FALLBACK = Object.freeze([['link_caption', 'Link in the caption'], ['link_bio', 'Link in the bio'], ['story_sticker', 'Story link sticker'], ['comment_keyword', 'Comment a keyword'], ['dm', 'Send a DM'], ['save', 'Ask people to save'], ['share_send', 'Ask people to share'], ['question', 'Ask a question'], ['follow', 'Ask people to follow'], ['none', 'No call to action']].map(([code, label]) => ({ code, label })));

function recipeOwnForm(deliverableId, field, own, catalog, disabled) {
  const prefix = `recipe_${deliverableId}_${field}_own`;
  const dis = disabled ? 'disabled' : '';
  if (field === 'pillar') return `<div class="recipe-own"><label for="${prefix}">Your content pillar</label><input id="${prefix}" name="${prefix}" type="text" maxlength="60" value="${esc(own.pillar || '')}" ${dis}></div>`;
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
  return `<section class="recipe-section"><h3>Copy choices</h3><p class="muted">Choose the content pillar, angle, hook, call to action and hashtags for each post before approving.</p>${blocks}</section>`;
}

export function recipePanel(doc, recipeState, recipeStatus, { disabled = false } = {}) {
  const pending = unchosenRecipes(doc);
  if (!pending.length) return '';
  const catalog = doc.recipeCatalog;
  const blocks = pending.map(([id, entry]) => {
    const status = recipeStatus[id] || {};
    const busy = disabled || status.busy || status.submitted;
    const label = status.busy ? 'Saving...' : status.submitted ? 'Waiting for Claude' : 'Save copy choices';
    const error = status.error ? `<p class="notice error inline-error" role="alert">${esc(status.error)}</p>` : '';
    const notice = status.declined
      ? `<div class="notice" role="status"><span>${esc(status.message || 'Declined in chat. Nothing was changed.')}</span></div>`
      : status.submitted ? `<div class="notice" role="status"><span>Saved. Your Claude session will pick this up.</span></div>` : '';
    const foot = `${error}<div class="review-actions"><div class="review-buttons"><button type="button" class="primary" data-recipe-save="${esc(id)}" ${busy ? 'disabled' : ''}>${esc(label)}</button></div></div>${notice}`;
    return recipeDeliverableBlock(id, entry, recipeState, catalog, { disabled: busy, foot });
  }).join('');
  return `<section class="panel recipe-panel" aria-labelledby="recipe-title"><div class="section-head"><h2 id="recipe-title">Copy choices</h2></div><p class="muted">Choose the content pillar, angle, hook, call to action and hashtags for each post.</p>${blocks}</section>`;
}


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
  if (large) return `<span class="sb-empty">${FRAME_ICON}<span>${panel?.source === 'kept' ? 'Existing image' : frame?.thumbOmitted ? 'Frame is on your computer' : 'Not made yet. Pictures come after you approve the price and the first one.'}</span></span>`;
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
  const meta = [board?.platform ? platformName(board.platform) : '', board?.aspectRatio || '', total ? secondsWord(total) : '', `${panels.length} ${board?.format === 'carousel' ? 'slide' : 'panel'}${panels.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  const boardRef = boardRefOf(board);
  const cells = panels.map((panel, index) => {
    const key = panelKey(board, panel, index);
    return stripCell(board, panel, index, { interactive, verdict: verdicts[key]?.verdict || null, current: current === key, highlight: highlight === key });
  }).join('');
  return `<section class="storyboard"><div class="storyboard-head"><div class="storyboard-title"><h3>${esc(deliverableLabel(board, 'Storyboard'))}</h3>${refTag(boardRef)}</div><div class="storyboard-sub"><span class="muted">${esc(meta)}</span>${interactive ? askForChanges(boardRef) : ''}</div></div>${runtimeNote(board)}${panels.length ? `<ol class="sb-strip" style="--sb-ratio:${frameRatio(board?.aspectRatio)}">${cells}</ol>` : '<p class="muted">No panels were found in this storyboard.</p>'}</section>`;
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
    ? `<p class="sb-verdict is-changes">${CHANGE_ICON}<span>${esc(saved.note ? `Change asked: ${saved.note}` : 'Change asked')}</span></p>`
    : `<p class="sb-verdict is-approved">${CHECK_ICON}<span>Approved</span></p>`;
  const error = editing && state.panelError ? `<p class="field-error" role="alert">${esc(state.panelError)}</p>` : '';
  const actions = editing
    ? `<div class="sb-change"><label for="sb-note">What should change in ${board?.format === 'carousel' ? 'this slide' : 'this panel'}?</label><textarea id="sb-note" name="sb_note" maxlength="1000" placeholder="For example: show the bottle in her hand." ${dis}>${esc(state.panelDraft ?? saved.note ?? '')}</textarea>${error}<div class="sb-slot-actions"><button type="button" class="quiet" data-sb-action="cancel-change" ${dis}>Cancel</button><button type="button" class="primary" data-sb-action="save-change" ${dis}>Save change</button></div></div>`
    // With one panel there is nothing to go through: the storyboard's own Approve and Ask for changes are all there is.
    : all.length === 1 ? '' : `<div class="sb-slot-actions"><button type="button" data-sb-action="change" ${dis}>Change ${board?.format === 'carousel' ? 'this slide' : 'this panel'}</button></div>`;
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
  return `<div class="sample-view" style="--sb-ratio:${frameRatio(found?.board?.aspectRatio)}">${media}<div class="sb-slot-body">${head}${found ? panelFields(found.panel, found.board) : ''}</div></div>${strips}`;
}

// The pictures, the clips and the joined video are each reviewed as a grid: one card per panel with its picture or player and the
// storyboard's words for it, and a per-card "Ask for changes" with a note. Every card counts as approved until a change is asked on
// it; "Approve all" sits under the grid. A change goes back to the named panels, and a redo of one is priced again first.
const MEDIA_GATE_IDS = new Set(['pictures', 'clips', 'cut']);
const MEDIA_GATE_NOUNS = Object.freeze({ pictures: ['picture', 'pictures'], clips: ['clip', 'clips'], cut: ['video', 'videos'] });
const mediaPanelKey = panel => `${trimmed(panel?.deliverable)}|${trimmed(panel?.panel)}`;
export const mediaPanelsOf = doc => (Array.isArray(doc?.review?.mediaSet?.panels) ? doc.review.mediaSet.panels : []);
const mediaPanelTitle = panel => trimmed(panel?.text?.label) || (trimmed(panel?.panel) === 'Cut' ? 'Joined video' : trimmed(panel?.panel)) || 'Panel';

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
      ? `<p class="sb-verdict is-changes">${CHANGE_ICON}<span>${esc(mine.note ? `Change asked: ${mine.note}` : 'Change asked')}</span></p>`
      : `<p class="sb-verdict is-approved">${CHECK_ICON}<span>Approved</span></p>`;
    const error = editing && state.mediaError ? `<p class="field-error" role="alert">${esc(state.mediaError)}</p>` : '';
    const actions = editing
      ? `<div class="sb-change"><label for="mr-note">What should change in ${esc(title)}?</label><textarea id="mr-note" name="mr_note" maxlength="1000" placeholder="For example: make the light warmer." ${dis}>${esc(state.mediaDraft ?? mine.note ?? '')}</textarea>${error}<div class="sb-slot-actions"><button type="button" class="quiet" data-mr-action="cancel" ${dis}>Cancel</button><button type="button" data-mr-action="save" data-mr-key="${esc(key)}" ${dis}>Save change</button></div></div>`
      : `<div class="sb-slot-actions">${mine.verdict === 'changes' ? `<button type="button" class="quiet" data-mr-action="undo" data-mr-key="${esc(key)}" ${dis}>Keep as is</button>` : ''}<button type="button" data-mr-action="change" data-mr-key="${esc(key)}" ${dis}>Ask for changes</button></div>`;
    return `<article class="sb-slot media-card" style="--sb-ratio:${frameRatio(panel.board?.aspectRatio)}">${media}<div class="sb-slot-body">${head}${panel.text ? panelFields(panel.text, panel.board) : ''}${verdict}${actions}</div></article>`;
  }).join('');
  return `<div class="media-review-grid">${cards}</div>`;
}

export function labelCheckSection(check, accepted = {}, { disabled = false } = {}) {
  if (!check || check.state !== 'current') return '';
  const flags = Array.isArray(check.flags) ? check.flags : [];
  if (!flags.length) return '<p class="qc-clear">Every label and logo matches the brand.</p>';
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
  return `<article class="post-preview"><div class="post-head"><div class="post-title"><h3>${esc(title)}</h3>${refTag(postRef)}</div>${askForChanges(postRef)}</div>${media.length ? `<div class="media-grid">${media.map(ref => mediaTile(ref)).join('')}</div>` : ''}<dl class="review-fields">${post?.hook ? `<div><dt>Hook</dt><dd class="post-hook">${esc(post.hook)}</dd></div>` : ''}${rest ? `<div><dt>Caption</dt><dd class="post-caption">${esc(rest)}</dd></div>` : ''}${post?.cta ? `<div><dt>CTA</dt><dd>${esc(post.cta)}</dd></div>` : ''}${post?.hashtags?.length ? `<div><dt>Hashtags</dt><dd class="post-tags">${esc(post.hashtags.join(' '))}</dd></div>` : ''}</dl></article>`;
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
  if (!workspaces.length) return upload ? '<p class="muted">Claude is getting your 3echo workspaces.</p>' : '';
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
  const label = upload ? (info.workspaceId ? 'Change which 3echo workspace your files go to' : 'Choose which 3echo workspace your files go to') : info.workspaceId ? 'Change which workspace pays' : 'Choose which workspace pays for this job';
  const cancel = info.workspaceId ? `<button type="button" class="quiet" data-workspace-action="cancel" ${locked ? 'disabled' : ''}>Cancel</button>` : '';
  const brandOption = `<label class="price-workspace-scope"><input type="checkbox" name="studio_workspace_brand_default" ${state.brandDefault ? 'checked' : ''} ${locked ? 'disabled' : ''}> Also use this for every job from this brand</label>`;
  const error = state.error ? `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>` : '';
  const notice = !state.error && state.message ? `<p class="muted">${esc(state.message)}</p>` : '';
  return `<div class="price-workspace price-workspace-edit"><label for="studio-workspace-select">${esc(label)}</label><select id="studio-workspace-select" name="studio_workspace_select" ${locked ? 'disabled' : ''}>${options}</select>${brandOption}${error}${notice}<div class="review-buttons"><button type="button" class="primary" data-workspace-action="save" ${locked ? 'disabled' : ''}>${busy ? 'Saving...' : submitted ? 'Waiting for Claude' : 'Set workspace'}</button>${cancel}</div></div>`;
}

// The publish gate. Everything shown comes from `review.publish`, the projection the server builds from the
// posting plan the approval covers: the route and the routes on offer, where posts go, and one row per post.
// Ids never reach the page as words, only the text the projection carries.
export const PUBLISH_APPROVE_LABELS = Object.freeze({
  metricool_schedule: count => `Approve and schedule ${count} ${count === 1 ? 'post' : 'posts'}`,
  metricool_draft: count => `Approve and save ${count} ${count === 1 ? 'draft' : 'drafts'}`,
  metricool_now: () => 'Approve and post now',
  self: () => 'Approve and get the posting kit',
});
export const PUBLISH_SAFETY_LINES = Object.freeze({
  metricool_schedule: 'Nothing goes out until you approve. You can cancel a scheduled post in Metricool until it goes out. Claude will ask you to confirm in the chat before it posts.',
  metricool_draft: 'Nothing goes out until you approve. Drafts are saved in Metricool and stay there until you publish them. Claude will ask you to confirm in the chat before it posts.',
  metricool_now: 'Nothing goes out until you approve. After that, each post goes out within a few minutes. Claude will ask you to confirm in the chat before it posts.',
  self: 'Nothing is posted for you. After you approve, the posting kit has each file, caption and step.',
});
export const PUBLISH_ROUTE_WORDS = Object.freeze({
  metricool_schedule: 'Schedule with Metricool',
  metricool_draft: 'Save as a draft in Metricool',
  metricool_now: 'Post now (goes out within a few minutes)',
  self: "I'll post it myself",
});
export const PUBLISH_OUTDATED_LINE = 'Something changed since this plan was made, so it is being rebuilt.';
export const PUBLISH_CHANGED_LINE = 'The plan changed after it was prepared; it is being rebuilt.';
// While any posting-card request is out (a route, a post type or a posting time), the card says so once, at its top, and every
// control on it is held. The rows say the plan is being updated; nothing else on the card says "saving".
export const PUBLISH_SAVING_LINE = 'Saving your choice...';
export const PUBLISH_UPDATING_LINE = 'Updating the plan...';
export const PUBLISH_WAITING_LINE = 'Still waiting for Claude to save this choice.';
export const PUBLISH_SAVED_LINE = 'Claude saved this choice, but the updated plan has not reached the board yet.';
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

export const POST_TIME_NEEDED_LINE = 'Choose a date and a time.';
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
      return new Date(guess).toISOString().slice(0, 16) === value ? `That time doesn't exist in ${zoneWords || zone} because the clocks change. Pick another time.` : POST_TIME_NEEDED_LINE;
    }
  } catch { return POST_TIME_NEEDED_LINE; }
  if (instant < now) return `That time has already passed. Pick a time at least ${POST_TIME_LEAD_MINUTES} minutes ahead.`;
  if (instant < now + POST_TIME_LEAD_MINUTES * 60 * 1000) return `That time is less than ${POST_TIME_LEAD_MINUTES} minutes away. Pick a time at least ${POST_TIME_LEAD_MINUTES} minutes ahead.`;
  return '';
}

export function publishApproveLabel(route, count) {
  const make = PUBLISH_APPROVE_LABELS[route] || PUBLISH_APPROVE_LABELS.self;
  return make(count).replace(/ 0 (posts|drafts)$/, ' $1');
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
    return `<label class="route-card${off ? ' route-off' : ''}"><input type="radio" class="visually-hidden" name="publish_route" value="${esc(item.id)}" ${attrs}><span class="route-body"><span class="route-radio" aria-hidden="true"></span><span class="route-text"><strong>${esc(item.label)}</strong></span></span></label>`;
  }).join('');
  const why = reasons.length ? `<p class="route-reason" id="publish-route-reason">${reasons.map(esc).join(' ')}</p>` : '';
  // The saving state is the card's, said once at its top. What is left here is how the last try ended: an error under the
  // choices, or a decline in the words the server gave.
  let status = '';
  if (pending || otherHeld) status = '';
  else if (routeState?.error) status = `<p class="notice error inline-error" role="alert">${esc(routeState.error)}</p>`;
  else if (routeState?.notice) status = `<p class="publish-route-note" role="status">${esc(routeState.notice)}</p>`;
  return `<fieldset class="publish-routes"><legend>How should these posts go out?</legend><div class="route-grid">${cards}</div>${why}${status}</fieldset>`;
}

function publishDestination(publish) {
  const lines = [];
  if (publish.metricool?.label) lines.push(`Posts go to Metricool brand <strong>${esc(publish.metricool.label)}</strong>`);
  if (publish.studioWorkspace?.name) lines.push(`Media is uploaded to your 3echo workspace <strong>${esc(publish.studioWorkspace.name)}</strong>`);
  return lines.length ? `<ul class="publish-destination">${lines.map(line => `<li>${line}</li>`).join('')}</ul>` : '';
}

function publishChecks(post, key = '', openKeys = new Set()) {
  const checks = Array.isArray(post?.checks) ? post.checks.filter(item => item && typeof item.text === 'string') : [];
  const failing = checks.filter(item => item.ok === false);
  const passed = checks.filter(item => item.ok !== false);
  const passedList = passed.map(item => `<li>${esc(item.text)}</li>`).join('');
  const open = `data-open-key="${esc(key)}"${openKeys.has(key) ? ' open' : ''}`;
  // A post still waiting for its post type is not ready, whatever else passed.
  const needsType = Array.isArray(post?.typeChoices) && post.typeChoices.length > 0;
  if (!failing.length && needsType) return passed.length ? `<details class="publish-ready publish-passed" ${open}><summary>${passed.length === 1 ? '1 check passed' : `${passed.length} checks passed`}</summary><ul>${passedList}</ul></details>` : '';
  if (!failing.length) {
    const tick = '<span class="publish-mark publish-mark-ok" aria-hidden="true"></span>';
    return passed.length
      ? `<details class="publish-ready" ${open}><summary>${tick}Ready</summary><ul>${passedList}</ul></details>`
      : `<p class="publish-ready">${tick}Ready</p>`;
  }
  const problems = `<ul class="publish-problems">${failing.map(item => `<li><span class="publish-mark publish-mark-bad" aria-hidden="true"></span><span><span class="visually-hidden">Needs attention: </span>${esc(item.text)}</span></li>`).join('')}</ul>`;
  const rest = passed.length ? `<details class="publish-ready publish-passed" ${open}><summary>${passed.length === 1 ? '1 other check passed' : `${passed.length} other checks passed`}</summary><ul>${passedList}</ul></details>` : '';
  return problems + rest;
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
  const caption = publishText(post.text ?? post.caption, `publish-text:${ref}`, 'caption', openKeys);
  const first = publishText(post.firstComment, `publish-first:${ref}`, 'first comment', openKeys);
  const titleText = publishText(post.title, `publish-title:${ref}`, 'TikTok title', openKeys);
  const title = titleText ? `<div class="publish-wide"><dt>TikTok title</dt><dd>${titleText}</dd></div>` : '';
  const media = (Array.isArray(post.media) ? post.media : []).map(item => item?.name).filter(Boolean);
  // While a request on the card is out, every row shows the plan as it was, muted, and says it is being updated in place of its checks.
  const updating = Boolean(ctx.held);
  const checks = updating ? `<p class="publish-updating">${esc(PUBLISH_UPDATING_LINE)}</p>` : publishChecks(post, `publish-checks:${ref}`, openKeys);
  return `<article class="publish-post${preview ? ' has-preview' : ''}${updating ? ' is-updating' : ''}" role="listitem"${updating ? ' aria-busy="true"' : ''}>${postMedia(preview)}<div class="publish-post-body"><div class="publish-post-head"><h4>${esc(post.label || 'Post')}</h4>${post.account ? `<span class="publish-account">${esc(post.account)}</span>` : ''}</div><dl class="publish-facts"><div${whenEditing(post, ctx.state, ctx.usesAll) ? ' class="publish-when-fact"' : ''}><dt>When</dt><dd>${postWhen(post, ctx.state, ctx)}</dd></div><div><dt>Media</dt><dd>${media.length ? esc(media.join(', ')) : '<span class="muted">None</span>'}</dd></div>${post.aiLabel ? `<div><dt>AI label</dt><dd>${esc(post.aiLabel)}</dd></div>` : ''}${title}${caption ? `<div class="publish-wide"><dt>Caption</dt><dd>${caption}</dd></div>` : ''}${first ? `<div class="publish-wide"><dt>First comment</dt><dd>${first}</dd></div>` : ''}</dl><div class="publish-check-list">${postTypeBlock(post, ctx.state, ctx)}${checks}</div></div></article>`;
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

export function publishCard(publish, routeState = {}, { disabled = false, openKeys = new Set(), note = '', jobId = '', signal = {}, now = Date.now(), previews = null, postStates = {} } = {}) {
  if (!publish || typeof publish !== 'object') return '';
  const posts = Array.isArray(publish.posts) ? publish.posts : [];
  // Anything pending (a route, a post type or a posting time) holds the whole card: one saving line at the top, every control
  // held, every row muted.
  const pending = publishPending(publish, routeState, postStates);
  const held = Boolean(pending);
  const rows = posts.length ? `<div class="publish-posts" role="list">${posts.map(post => publishPostRow(post, jobId, openKeys, typeof previews === 'function' ? previews(post) : '', { state: postStates?.[post.id], signal, now, locked: disabled, held, usesAll: publish.allTime?.state === 'none' })).join('')}</div>` : '<p class="muted">There are no posts in this plan yet.</p>';
  return `<div class="publish-card"${held ? ' aria-busy="true"' : ''}>${publishSavingLine(pending, { signal, now })}${publishNoteLine(note)}${publishRoutes(publish, routeState, { locked: disabled, held })}${allTimeBlock(publish, postStates?.[ALL_POSTS], { locked: disabled, held })}${publishDestination(publish)}${rows}</div>`;
}

/**
 * The Approve button's wording and, when it cannot be pressed, why. The wording follows the plan as the board shows it, never a
 * choice still being saved, and the button stays held while anything on the card is pending.
 */
export function publishApproval(publish, routeState = {}, postStates = {}) {
  if (!publish || typeof publish !== 'object') return { disabled: true, label: 'Approve', line: 'Claude is still preparing the posting plan.' };
  const pending = publishPending(publish, routeState, postStates);
  const posts = Array.isArray(publish.posts) ? publish.posts : [];
  const label = publishApproveLabel(publish.route, posts.length);
  const safety = PUBLISH_SAFETY_LINES[publish.route] || PUBLISH_SAFETY_LINES.self;
  // While a choice is saving, the card says so at its top; the button is only held.
  if (pending) return { disabled: true, label, line: '', safety };
  if (publish.outdated) return { disabled: true, label, line: typeof publish.reason === 'string' && publish.reason.trim() ? publish.reason.trim() : PUBLISH_OUTDATED_LINE, safety };
  if (publish.changed) return { disabled: true, label, line: PUBLISH_CHANGED_LINE, safety };
  if (!posts.length) return { disabled: true, label, line: 'There are no posts to approve yet.', safety };
  if (!publish.ready) {
    const failing = posts.filter(post => publishFailing(post).length || (Array.isArray(post?.typeChoices) && post.typeChoices.length)).length;
    return { disabled: true, label, line: failing ? `${failing === 1 ? '1 post needs' : `${failing} posts need`} attention before this can be approved.` : 'This plan is not ready to approve yet.', safety };
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
  handed_over: 'Waiting for you to post it',
  scheduled: 'Scheduled',
  draft: 'Saved as a draft in Metricool',
  waiting_in_app: 'Waiting for you in the Metricool app',
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
export const POST_ANSWER_WAITING_LINE = 'Still waiting for Claude to save this answer.';
export const POST_ANSWER_SAVED_LINE = 'Claude saved this answer, but the board has not caught up yet.';
export const POST_MARK_SAVING_LINE = 'Saving...';
export const POST_MARK_WAITING_LINE = 'Still waiting for Claude to save this.';
export const POST_MARK_SAVED_LINE = 'Claude saved this, but the board has not caught up yet.';
export const KIT_LINK_LIMIT = 500;
export const KIT_COPIED_MS = 2000;
export const KIT_DOWNLOAD_WAITING = 'Claude is preparing the download link';
export const KIT_PARTIAL_DONE = 'Every post here is marked as posted.';
export const KIT_PARTIAL_INTRO = 'These posts did not go out through Metricool. Post each one yourself, then mark it as posted.';
export const KIT_INTRO = 'Nothing is posted for you. For each post, download the file, copy the caption, post it yourself, then mark it as posted.';

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
  if (link.length > KIT_LINK_LIMIT) return `The link is too long. Use at most ${KIT_LINK_LIMIT} characters.`;
  let url = null;
  try { url = new URL(link); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || !url.hostname || /\s/.test(link) || url.username || url.password) return 'Paste the full link, starting with https://.';
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
export const KIT_COPY_REFUSED = "Copy wasn't allowed. Copy the text below.";

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
  return `<div class="post-check" role="group" aria-labelledby="post-check-q-${esc(id)}"${held ? ' aria-busy="true"' : ''}><p class="post-check-q" id="post-check-q-${esc(id)}">${esc(POST_CHECK_QUESTION)}</p><p class="post-check-help muted">Claude could not tell whether this one went out. Look in Metricool, then tell it which is true.</p><div class="post-check-actions"><button type="button" data-post-answer="in_metricool" data-post-id="${esc(id)}" ${held ? 'aria-disabled="true" disabled' : ''}>${esc(POST_IN_METRICOOL)}</button><button type="button" data-post-answer="not_in_metricool" data-post-id="${esc(id)}" ${held || early ? 'disabled' : ''}${early ? ` aria-describedby="post-check-wait-${esc(id)}"` : ''}>${esc(POST_NOT_IN_METRICOOL)}</button></div>${note}${request.html}</div>`;
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
  return `<section class="test-versions" aria-label="Test versions"><h3>Test versions</h3><p class="muted">The same video with a different hook and call to action, for ads or A/B tests. Only the main video is posted.</p><div class="post-list">${rows}</div></section>`;
}

// A post's test versions inside its posting kit, with the one plain line that says what they are for.
function kitVariants(post) {
  const list = (Array.isArray(post?.variants) ? post.variants : []).filter(item => item && typeof item === 'object');
  if (!list.length) return '';
  const rows = list.map(item => {
    const lines = [trimmed(item.hook) ? `Hook: ${trimmed(item.hook)}` : '', trimmed(item.cta) ? `Call to action: ${trimmed(item.cta)}` : ''].filter(Boolean);
    return `<li class="kit-file-row"><span class="kit-file-name">${esc(item.name || item.id || 'Test version')}</span>${lines.length ? `<span class="muted">${esc(lines.join(' · '))}</span>` : ''}</li>`;
  }).join('');
  return `<div class="kit-section kit-variants"><h5>Test versions</h5><p class="muted">Test versions for ads or A/B tests</p><ul class="kit-files">${rows}</ul></div>`;
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
  return `<article class="publish-post kit-post${preview ? ' has-preview' : ''}${post.marked ? ' is-marked' : ''}" role="listitem">${postMedia(preview)}<div class="publish-post-body"><div class="publish-post-head"><h4>${esc(post.label || 'Post')}</h4>${post.account ? `<span class="publish-account">${esc(post.account)}</span>` : ''}</div>${when}${kitFiles(post)}${kitVariants(post)}${kitCopyBlock(post, 'caption', 'Caption', state, ctx)}${kitCopyBlock(post, 'comment', 'First comment', state, ctx)}${items && !post.marked ? `<div class="kit-section"><h5>Before you post</h5><ol class="kit-checklist">${items}</ol></div>` : ''}${kitMarkBlock(post, state, ctx)}</div></article>`;
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
  const intro = finished ? 'Every post is marked as posted. This job is finished.' : closing ? 'Claude is closing this job.' : kit.route === 'partial' ? (done ? KIT_PARTIAL_DONE : KIT_PARTIAL_INTRO) : KIT_INTRO;
  return `<section class="panel posting-kit" aria-labelledby="posting-kit-title"><div class="section-head"><h2 id="posting-kit-title">Your posting kit</h2><span class="count">${esc(count)}</span></div><p class="muted kit-intro">${esc(intro)}</p><div class="publish-posts" role="list">${posts.map(post => kitPost(post, postStates?.[post.id] || {}, ctx)).join('')}</div></section>`;
}

function reviewFilesHtml(doc, paths) {
  const files = new Map((doc?.files || []).map(file => [file.path, file]));
  return paths.map(path => {
    const file = files.get(path);
    const title = displayTitle(file || { path }, 'Document');
    const body = file?.text != null
      ? (/\.md$/i.test(path) ? `<div class="md">${renderMarkdown(withoutTitle(file.text, title))}</div>` : `<pre class="doc-pre">${esc(file.text)}</pre>`)
      : '<p class="muted">Too large for the board. Open it from your computer.</p>';
    return `<article class="doc-file"><h3>${esc(title)}</h3>${body}${file?.truncated ? '<p class="muted">Shortened for the board. The full file is on your computer.</p>' : ''}</article>`;
  }).join('');
}

function reviewBody(project, doc, state, { recipeState = {}, workspaceState = {}, routeState = {}, postStates = {}, openKeys = new Set(), signal = {} } = {}) {
  const review = doc.review;
  const gate = review.gate;
  const parts = [];
  const locked = Boolean(state.busy || state.submitted || state.needsReconciliation);
  if (gate === 'findings') {
    parts.push(reportArticle(doc.report, { jobTitle: project?.title }));
    const covered = new Set([doc.report?.path, ...(doc.report?.stills || []).map(still => still.path)].filter(Boolean));
    const rest = (review.paths || []).filter(path => !covered.has(path) && !/^report\/stills\//i.test(path) && !IMAGE_FILE.test(path));
    if (rest.length) parts.push(reviewFilesHtml(doc, rest));
    return parts.join('');
  }
  if (gate === 'concept' && review.concepts) parts.push(conceptCards(review.concepts, state.choice, { disabled: state.busy || state.submitted }));
  if (gate === 'concept') parts.push(recipeReviewSection(doc, recipeState, { disabled: state.busy || state.submitted }));
  // Panel-by-panel decisions belong to the storyboard approval only (the server refuses them anywhere else), so a later
  // gate that still lists the storyboard shows it as a plain strip, with no per-panel buttons whose answer would be lost.
  if (review.storyboards?.length && gate === 'storyboard') {
    const current = currentPanelKey(review.storyboards, state);
    parts.push(review.storyboards.map(board => storyboardStrip(board, { interactive: true, verdicts: panelStates(review.storyboards, state.panels), current })).join(''));
    parts.push(storyboardSlot(review.storyboards, state, { disabled: locked }));
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
  if (gate === 'publish') parts.push(publishCard(review.publish, routeState, { disabled: locked, openKeys, postStates, note: doc.publishNote, jobId: project?.jobId || doc.jobId || '', signal, previews: planned ? post => publishPreviews(review, post, used) : null }));
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
  return parts.join('');
}

const COPY_GATES = new Set(['sample', 'pictures', 'clips', 'cut', 'content', 'publish']);
const copiesWaiting = refs => {
  const kinds = new Set(refs.map(ref => ref.kind));
  const what = kinds.has('image') && kinds.has('video') ? 'pictures and video' : kinds.has('video') ? 'video' : 'pictures';
  return `Viewable copies of the ${what} aren't on the board yet. You can approve in chat, or ask for changes here.`;
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
  const unviewable = COPY_GATES.has(gate) ? unviewableMedia(doc) : [];
  if (unviewable.length) return { disabled: true, label: gate === 'sample' ? 'Approve sample' : MEDIA_GATE_IDS.has(gate) ? (gate === 'cut' ? 'Approve' : 'Approve all') : 'Approve', line: copiesWaiting(unviewable) };
  if (gate === 'concept') {
    const concepts = doc?.review?.concepts;
    const concept = concepts?.concepts?.find(item => item.id === state.choice);
    if (!concept) return { disabled: true, label: 'Approve', line: 'Pick a concept to approve it.' };
    const pending = unchosenRecipes(doc);
    if (pending.some(([id]) => !recipeReady(recipeState, id))) {
      return { disabled: true, label: `Approve concept ${concept.id}`, line: 'Choose the copy for every post before approving.' };
    }
    const credits = conceptCredits(concepts, concept);
    return { label: `Approve concept ${concept.id}`, credits, line: credits ? `Approving allows up to ${credits.toLocaleString()} credits for media.` : 'Approving allows no media spend yet.' };
  }
  if (gate === 'price') {
    const totals = priceTotals(doc?.review?.quote);
    if (!totals) return { disabled: true, label: 'Approve price', line: 'Every item needs a price before this can be approved.' };
    if (studioWorkspaceRequired(doc)) return { disabled: true, label: 'Approve price', line: 'Choose which workspace pays before this can be approved.' };
    const words = priceWords(totals);
    return { label: 'Approve price', line: words ? `Approving allows ${words} for this job.` : 'Approving allows no credits for this job.' };
  }
  if (gate === 'storyboard') {
    const all = storyboardPanelsOf(doc?.review?.storyboards);
    if (!all.length) return { label: 'Approve storyboard', line: '' };
    const word = all.every(item => item.board?.format === 'carousel') ? 'slide' : 'panel';
    const changes = Object.values(panelStates(doc?.review?.storyboards, state.panels)).filter(item => item.verdict === 'changes').length;
    if (changes) return { label: 'Send changes', action: 'send-panels', line: `${changes} ${word}${changes === 1 ? '' : 's'} to change, ${all.length - changes} approved.` };
    return { label: 'Approve storyboard', line: all.length === 1 ? `The ${word} is approved.` : `All ${all.length} ${word}s approved.` };
  }
  if (MEDIA_GATE_IDS.has(gate)) {
    const all = mediaPanelsOf(doc);
    const [one, many] = MEDIA_GATE_NOUNS[gate];
    const changes = Object.values(mediaPanelStates(doc, state.mediaPanels)).filter(item => item.verdict === 'changes').length;
    if (changes) return { label: 'Send changes', action: 'send-panels', line: `${changes} to change, ${all.length - changes} approved. A redo is priced again before it is made.` };
    const next = gate === 'pictures' ? 'Approving lets Claude make the video clips.' : gate === 'cut' ? 'Approving lets Claude ask what to add: captions, music, both or nothing.' : 'Approving lets Claude join them into one video.';
    return { label: gate === 'cut' ? 'Approve' : 'Approve all', line: all.length > 1 ? `All ${all.length} ${many} approved. ${next}` : `${next}` };
  }
  if (gate === 'sample') {
    const sample = doc?.review?.sample;
    const rest = sampleRestWords(sample?.rest);
    return { label: 'Approve sample', line: rest ? `Approving lets Claude make the other ${rest}.` : 'Approving lets Claude make the rest.' };
  }
  if (gate === 'content' && doc?.review?.checks) {
    // A final post made from files the person supplied has no label check; it is approved while every check on its posts passes.
    const problem = suppliedFirstProblem(doc.review.checks);
    if (!doc.review.checks.ready) return { disabled: true, label: 'Approve', line: problem ? `Fix these first: ${problem}` : 'Fix these first. Claude is still getting the checks ready.' };
    return { label: 'Approve', line: '' };
  }
  if (gate === 'content') {
    const check = doc?.review?.labelCheck;
    if (check?.state === 'missing') return { disabled: true, label: 'Approve', line: 'Claude checks the labels and logos before this can be approved.' };
    if (check?.state === 'stale') return { disabled: true, label: 'Approve', line: 'Some images or video changed after the label check. Claude checks them again before this can be approved.' };
    const open = (check?.flags || []).filter(flag => !state.accepted?.[flag.id]).length;
    if (open) return { disabled: true, label: 'Approve', line: open === 1 ? 'Accept the item from the label check as is, or ask for changes.' : `Accept the ${open} items from the label check as is, or ask for changes.` };
    return { label: 'Approve', line: '' };
  }
  if (gate === 'publish') return publishApproval(doc?.review?.publish, routeState, postStates);
  if (gate === 'findings') return { label: 'Approve report', line: 'Approving finishes this job.' };
  return { label: 'Approve', line: '' };
}
const CHANGE_PLACEHOLDERS = Object.freeze({ findings: 'For example: compare prices too, and add one more competitor.' });

/**
 * The submit_decision request arguments for an Approve or Ask for changes
 * click, bound to the displayed revision and exact registered files, or an
 * error to show instead. Concept approvals carry the credits shown; price
 * approvals carry the totals shown.
 */
export function decisionArgs({ project, doc, verdict, choice = null, comment = '', requestId, recipeState = {}, panels = {}, accepted = {} }) {
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
    if (verdict === 'approve' && decided.some(entry => entry.verdict !== 'approve')) return { error: 'A change is asked on a panel, so send the changes instead.' };
    if (verdict === 'request_changes' && !note && !decided.some(entry => entry.verdict === 'changes')) return { error: 'Say what should change.' };
    if (decided.length) args.panels = decided;
    if (note && verdict === 'request_changes') args.note = note;
    return { args };
  }
  if (MEDIA_GATE_IDS.has(gate)) {
    const states = mediaPanelStates(doc, panels);
    const decided = mediaPanelsOf(doc).map(panel => {
      const mine = states[mediaPanelKey(panel)];
      return { panel: trimmed(panel.panel), ...(trimmed(panel.deliverable) ? { deliverable: trimmed(panel.deliverable) } : {}), verdict: mine.verdict, ...(mine.verdict === 'changes' && trimmed(mine.note) ? { note: trimmed(mine.note) } : {}) };
    });
    if (verdict === 'approve' && decided.some(entry => entry.verdict !== 'approve')) return { error: 'A change is asked on one, so send the changes instead.' };
    if (verdict === 'request_changes' && !note && !decided.some(entry => entry.verdict === 'changes')) return { error: 'Say what should change.' };
    if (decided.length) args.panels = decided;
    if (note && verdict === 'request_changes') args.note = note;
    return { args };
  }
  if (verdict === 'request_changes' && !note) return { error: 'Say what should change.' };
  if (gate === 'content' && verdict === 'approve') {
    const flags = doc?.review?.labelCheck?.flags || [];
    const ids = flags.map(flag => flag.id).filter(id => accepted[id]);
    if (flags.length && ids.length !== flags.length) return { error: 'Accept each item from the label check first.' };
    if (ids.length) args.acceptedFlagIds = ids;
  }
  if (gate === 'concept') {
    const concepts = doc?.review?.concepts;
    const concept = concepts?.concepts?.find(item => item.id === choice) || null;
    if (verdict === 'approve') {
      if (!concept) return { error: 'Pick a concept first.' };
      const pending = unchosenRecipes(doc);
      if (pending.some(([id]) => !recipeReady(recipeState, id))) return { error: 'Choose the copy for every post before approving.' };
      if (pending.length) args.recipe = Object.fromEntries(pending.map(([id]) => [id, recipePicks(recipeState, id)]));
      args.chosen = concept.id;
      args.credits = conceptCredits(concepts, concept);
      args.note = `Concept ${concept.id}: ${concept.title}`;
    } else {
      if (concept) args.chosen = concept.id;
      args.note = concept ? `Concept ${concept.id}: ${note}` : note;
    }
    return { args };
  }
  if (gate === 'price' && verdict === 'approve') {
    const totals = priceTotals(doc?.review?.quote);
    if (!totals) return { error: 'Every item needs a price before this can be approved.' };
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
  if (!state || !(state.busy || state.submitted || state.needsReconciliation) || !state.args) return state || {};
  if (!pendingReview(project) || decisionMatchesReview(project, state.args)) return state;
  return { ...state, busy: false, submitted: false, needsReconciliation: false, requestId: null, args: null, operation: null, message: '' };
}

/**
 * The review panel for the job's pending decision, drawn from the job document:
 * concept cards, storyboard panels, the itemised price, the final post with its
 * media, or the posting plan, with Approve and Ask for changes.
 */
export function reviewPanel(project, doc, rawState = {}, { docState = 'loaded', signal = {}, recipeState = {}, workspaceState = {}, routeState = {}, postStates = {}, openKeys = new Set(), downloads = null } = {}) {
  const review = pendingReview(project);
  if (!review) return '';
  const state = sentDecisionState(project, rawState);
  const gate = review.gate || review.reviewId;
  const status = reviewStatus(project, doc, docState);
  const ready = status === 'ready';
  const body = ready ? reviewBody(project, doc, state, { recipeState, workspaceState, routeState, postStates, openKeys, signal }) : waitingNote(status);
  const headExtra = ready && gate === 'findings' ? reportDownloads(downloads) : '';
  const decided = state.busy || state.submitted || state.needsReconciliation;
  const plan = ready ? approval(gate, doc, state, recipeState, routeState, postStates) : { disabled: true, label: 'Approve', line: '' };
  const approveLabel = state.busy && state.verdict === 'approve' ? 'Saving...' : state.submitted && state.verdict === 'approve' ? 'Waiting for Claude' : plan.label;
  const notice = state.declined
    ? `<div class="notice" role="status"><span>${esc(state.message || 'Declined in chat. Nothing was changed.')}</span></div>`
    : state.submitted || state.needsReconciliation ? notifyClaudeNotice(state, signal) : '';
  const error = state.error ? `<p class="notice error inline-error" role="alert">${esc(state.error)}</p>` : '';
  const actions = state.commentOpen
    ? `<div class="review-comment"><label for="review-comment">What should change?</label><textarea id="review-comment" name="comment" maxlength="4000" placeholder="${esc(CHANGE_PLACEHOLDERS[gate] || 'For example: make the hook shorter and show the product sooner.')}">${esc(state.comment || '')}</textarea><div class="review-actions"><div class="review-buttons"><button type="button" class="quiet" data-review-action="cancel-changes">Cancel</button><button type="button" class="primary" data-review-action="send-changes" ${decided ? 'disabled' : ''}>${state.busy && state.verdict === 'request_changes' ? 'Saving...' : state.submitted && state.verdict === 'request_changes' ? 'Waiting for Claude' : 'Send changes'}</button></div></div></div>`
    : `<div class="review-actions">${plan.safety ? `<div class="review-notes">${plan.line ? `<p class="review-line">${esc(plan.line)}</p>` : ''}<p class="review-line review-safety">${esc(plan.safety)}</p></div>` : plan.line ? `<p class="review-line">${esc(plan.line)}</p>` : ''}<div class="review-buttons"><button type="button" data-review-action="changes" ${!ready || decided ? 'disabled' : ''}>Ask for changes</button><button type="button" class="primary" data-review-action="${esc(plan.action || 'approve')}" ${!ready || decided || plan.disabled ? 'disabled' : ''}>${esc(plan.action === 'send-panels' && state.busy ? 'Saving...' : plan.action === 'send-panels' && state.submitted ? 'Waiting for Claude' : approveLabel)}</button></div></div>`;
  const title = gate === 'sample' && doc?.review?.sample?.kind === 'video' ? 'Approve the sample clip' : GATE_TITLES[gate] || humanize(gate);
  return `<section class="panel review-panel${gate === 'publish' ? ' review-panel-publish' : ''}" aria-labelledby="review-title"><div class="section-head${headExtra ? ' report-section-head' : ''}"><h2 id="review-title">${esc(title)}</h2>${headExtra}</div><div id="review-form" class="review-body">${body}${error}${actions}</div>${notice}</section>`;
}

export const INBOX_LIMIT = 20;
export const ANSWER_LIMIT = 1000;
export const INBOX_EMPTY = 'Nothing needs you right now.';
const INBOX_KINDS = new Set(['question', 'decision', 'brief', 'onboarding', 'post', 'stuck', 'handoff_offer', 'handoff_return']);
export const INLINE_DECISIONS = new Set(['price', 'sample']);
const BRIEF_MISSING = 'A few answers are missing from the brief.';
const WAITING_GATES = Object.freeze({ concept: 'concept', storyboard: 'storyboard', price: 'price', 'sample image': 'sample', 'storyboard pictures': 'pictures', 'video clips': 'clips', 'joined video': 'cut', 'final post': 'content', 'posting plan': 'publish', 'campaign plan': 'campaign_proposal', 'going live': 'campaign_activation', report: 'findings' });

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
    return [{ ...base, kind: 'decision', gate, text: GATE_TITLES[gate] || 'A decision is waiting for you.' }];
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

export function onboardingInboxItems(brands = [], drafts = []) {
  const open = (Array.isArray(brands) ? brands : []).filter(brand => brand?.slug && !brandReady(brand));
  return open.flatMap(brand => {
    const draft = (Array.isArray(drafts) ? drafts : []).find(item => item?.kind === 'onboard' && item.brand === brand.slug) || null;
    const phase = brandResearchPhase(brand, draft);
    const name = trimmed(brand.name) || 'This brand';
    const base = { kind: 'onboarding', brand: brand.slug, brandName: trimmed(brand.name) || null };
    if (phase === 'running') return [{ ...base, state: 'running', needsYou: false, text: `${name} onboarding has started. Claude is researching the brand. Nothing needed from you yet.` }];
    if (phase === 'complete') {
      const researched = brand.usage?.status === 'complete';
      return [{ ...base, state: 'review', needsYou: true, text: researched ? `${name} research is done. Check the brand profile and click Save and continue.` : 'Check the brand profile and click Save and continue.' }];
    }
    if (phase === 'failed') return [{ ...base, state: 'failed', needsYou: true, text: `${name} research could not finish. Fill in the brand profile by hand, then click Save and continue.` }];
    return [];
  });
}

// A job that is stuck is a row of its own, unless the list already holds the question or decision that asks the person about it.
export function stuckInboxItems(projects = [], items = []) {
  const asked = new Set((Array.isArray(items) ? items : []).filter(item => item?.jobId && item.kind !== 'post').map(item => item.jobId));
  return (Array.isArray(projects) ? projects : []).filter(project => project?.jobId && project.stuck && typeof project.stuck === 'object' && !asked.has(project.jobId)).map(project => ({
    kind: 'stuck', jobId: project.jobId, jobTitle: trimmed(project.title), brandName: trimmed(project.brandName),
    text: `Stuck: ${agentPlain(project.stuck.reason, project.stuck.kind === 'internal' ? 'Something went wrong on our side' : 'Claude needs your help to carry on')}`,
  }));
}

export function workspaceInbox(snapshot, { drafts = [] } = {}) {
  const inbox = snapshot?.inbox && typeof snapshot.inbox === 'object' ? snapshot.inbox : null;
  const onboarding = onboardingInboxItems(snapshot?.brands, drafts);
  const asks = onboarding.filter(item => item.needsYou).length;
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
  if (!hasQuestionId(item)) return { error: 'This question is no longer open.' };
  const args = { requestId, questionId: item.questionId };
  if (text !== null && text !== undefined) {
    if (item.allowText === false) return { error: 'Choose one of the answers.' };
    const value = String(text).trim();
    if (!value) return { error: 'Type your answer first.' };
    if (value.length > ANSWER_LIMIT) return { error: `Keep your answer to ${ANSWER_LIMIT} characters or fewer.` };
    args.text = value;
  } else {
    const option = Number.isInteger(choice) ? inboxOptions(item.options)[choice] : null;
    if (!option) return { error: 'Choose one of the answers.' };
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
  if (state.declined) return `<div class="notice" role="status"><span>${esc(state.message || 'Declined in chat. Nothing was changed.')}</span></div>`;
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

const IN_CHAT_LINE = 'Answer this one in the chat. Claude only takes your go-ahead for posting or spending from the chat.';

function questionCard(item, state = {}, signal = {}, index = 0) {
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
  const id = `inbox-answer-${index}`;
  const box = typing
    ? `<form class="inbox-answer" data-inbox-form="${esc(key)}" novalidate><label class="visually-hidden" for="${id}">Your answer</label><textarea id="${id}" name="answer" maxlength="${ANSWER_LIMIT}" placeholder="Your answer">${esc(state.draft || '')}</textarea><div class="inbox-actions">${options.length ? `<button type="button" class="quiet" data-inbox-cancel="${esc(key)}">Cancel</button>` : ''}<button type="submit" class="primary">Send</button></div></form>`
    : '';
  const upload = item.wantsUpload && !locked ? questionUpload(item, state.upload || {}) : '';
  const sent = locked && state.text ? `<p class="inbox-sent">${esc(`"${truncateText(state.text, 160)}"`)}</p>` : '';
  const done = state.answered ? '<p class="inbox-note" role="status">Claude has your answer.</p>' : inboxStatus(state, signal);
  return `${buttons}${upload}${link}${box}${sent}${inboxError(state)}${done}`;
}

function sampleThumb(doc) {
  const sample = doc?.review?.sample;
  if (!sample) return '';
  const video = sample.kind === 'video';
  const full = video ? null : safePreviewUrl(sample.reviewUrl);
  const src = video ? safePreviewUrl(sample.poster) : safePreviewUrl(sample.thumb) || full;
  if (!src) return '';
  const board = (doc.storyboards || []).find(item => trimmed(item?.ref) && trimmed(item.ref) === trimmed(sample.deliverable)) || (doc.storyboards || [])[0];
  const image = `<img src="${esc(src)}" alt="${video ? 'Sample clip' : 'Sample image'}">`;
  const body = full ? `<button type="button" class="media-open" data-view-media="${esc(full)}" data-view-alt="Sample image" aria-label="Open the sample image full size">${image}</button>` : image;
  return `<figure class="inbox-thumb" style="--sb-ratio:${frameRatio(board?.aspectRatio)}">${body}</figure>`;
}

const REVIEW_NOT_READY = 'Claude is getting this ready to show you.';

export function inboxDecisionArgs(item, { brand = null, requestId } = {}) {
  const artifacts = Array.isArray(item?.artifacts) ? item.artifacts.filter(entry => entry && typeof entry.path === 'string' && typeof entry.sha256 === 'string') : [];
  if (!item?.jobId || !INLINE_DECISIONS.has(item.gate) || !artifacts.length || !Number.isSafeInteger(item.revision)) return { error: 'Open the review to decide this.' };
  const args = { requestId, brand, jobId: item.jobId, reviewId: item.gate, revision: item.revision, artifacts: artifacts.map(({ path, sha256 }) => ({ path, sha256 })), decision: 'approve' };
  if (trimmed(item.jobTitle)) args.title = trimmed(item.jobTitle);
  if (item.gate === 'price') {
    const credits = item.credits && typeof item.credits === 'object' ? item.credits : null;
    if (!credits || PRICE_PROVIDERS.some(provider => credits[provider] !== undefined && creditNumber(credits[provider]) === null)) return { error: 'Every item needs a price before this can be approved.' };
    args.totals = Object.fromEntries(PRICE_PROVIDERS.map(provider => [provider, creditNumber(credits[provider]) || 0]));
  }
  return { args };
}

function decisionCard(item, ctx = {}) {
  const { project = null, doc = null, docState = 'loaded', review: state = {}, signal = {} } = ctx;
  const gate = item.gate || null;
  const jobId = item.jobId || project?.jobId || '';
  const summary = inboxSummary(item);
  const summaryLine = text => (text ? `<p class="inbox-summary">${esc(text)}</p>` : '');
  if (trimmed(item.summary) === REVIEW_NOT_READY) return summaryLine(summary);
  const inline = Boolean(item.inline) && !inboxDecisionArgs(item).error;
  const reviewButton = `<button type="button"${inline ? '' : ' class="primary"'} data-inbox-jump="${esc(jobId)}" data-inbox-target="review">Review</button>`;
  if (!inline) return `${summaryLine(summary)}<div class="inbox-actions">${reviewButton}</div>`;
  const shown = doc && doc.revision === item.revision && doc.review?.gate === gate ? doc : null;
  const status = shown && project && project.detailsLoaded !== false ? reviewStatus(project, shown, docState) : null;
  const plan = status === 'ready' ? approval(gate, shown, state, {}) : { label: gate === 'price' ? 'Approve price' : 'Approve sample', line: '' };
  const blocked = (docState === 'loading' && !shown) || status === 'changed' || Boolean(plan.disabled);
  const decided = Boolean(state.busy || state.submitted || state.needsReconciliation);
  const label = state.busy && state.verdict === 'approve' ? 'Saving...' : state.submitted && state.verdict === 'approve' ? 'Waiting for Claude' : plan.label;
  const line = plan.disabled && plan.line ? plan.line : status === 'changed' ? REVIEW_WAITING.changed : summary || plan.line;
  const thumb = gate === 'sample' && shown ? sampleThumb(shown) : '';
  return `${summaryLine(line)}${thumb}${inboxError(state)}<div class="inbox-actions">${reviewButton}<button type="button" class="primary" data-inbox-approve="${esc(jobId)}" ${blocked || decided ? 'disabled' : ''}>${esc(label)}</button></div>${inboxStatus(state, signal)}`;
}

const INBOX_FIELD_INPUTS = new Set(['select', 'checkboxes', 'textarea', 'url']);
const FIX_HIGHLIGHTED = 'Fix the highlighted answers before saving.';

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
  if (!intake || !project?.jobId) return { errors: { form: 'Open the job to answer this.' } };
  const revision = [items.find(item => item?.field === required), ...items].find(item => Number.isSafeInteger(item?.revision))?.revision;
  const values = intakeValues(intake, draft);
  const fields = (intake.fields || []).filter(field => field && field.input !== 'photo' && keys.includes(field.key));
  const own = required ? fields.find(field => field.key === required) : null;
  if (own && !fieldAnswered(own, values, intake)) {
    const { errors } = intakePatch({ ...intake, fields: [own] }, draft);
    return { errors: Object.keys(errors).length ? errors : { form: 'Answer this first.' } };
  }
  const answered = fields.filter(field => fieldAnswered(field, values, intake));
  if (!answered.length) return { errors: { form: 'Answer this first.' } };
  const { patch, errors } = intakePatch({ ...intake, fields: answered }, draft);
  if (Object.keys(errors).length) return { errors };
  if (!Object.keys(patch).length) return { errors: { form: 'Change or answer at least one item before saving.' } };
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
  const label = here && state.busy ? 'Saving...' : here && state.submitted ? 'Waiting for Claude' : here && state.needsReconciliation ? 'Needs Claude attention' : 'Save';
  const message = errors?.form || (state.error && state.error !== FIX_HIGHLIGHTED ? state.error : '');
  const error = here && message ? `<p class="notice error inline-error" role="alert">${esc(message)}</p>` : '';
  const platforms = intakePlatforms(intake, values);
  const fields = shown.map(field => intakeFieldHtml(field, values, errors, platforms, null, { prefix: `inbox-${index}`, needed: false, labelled: !single })).join('');
  const own = single ? ` data-inbox-field="${esc(item.field)}"` : '';
  return `<form class="inbox-fields" data-inbox-intake="${esc(jobId)}" data-inbox-fields="${esc(keys.join(' '))}"${own} novalidate>${fields}${error}<div class="inbox-actions"><button type="submit" class="primary" ${state.busy || pending ? 'disabled' : ''}>${label}</button></div></form>${here ? inboxStatus(state, signal) : ''}`;
}

const INBOX_TEXT_FALLBACK = Object.freeze({ decision: 'A decision is waiting for you.', brief: BRIEF_MISSING, question: '' });

export function inboxKey(item) {
  if (item?.kind === 'onboarding') return `onboarding-${item.brand || ''}`;
  if (item?.kind === 'post') return `post-${item.jobId || ''}-${item.target || ''}`;
  return item?.kind === 'question' ? `question-${item.questionId}` : [item?.kind || 'item', item?.jobId || '', item?.field || ''].filter(Boolean).join('-');
}

export function inboxItemText(item) {
  return trimmed(item?.text) || (item?.kind === 'decision' ? GATE_TITLES[item.gate] : '') || INBOX_TEXT_FALLBACK[item?.kind] || '';
}

function onboardingCard(item) {
  if (!item.needsYou || !item.brand) return '';
  return `<div class="inbox-actions"><button type="button" class="primary" data-onboard="${esc(item.brand)}">Open brand profile</button></div>`;
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
export const handoffStatusLine = project => (project?.handoff?.status === 'sent' ? trimmed(project.handoff.line) : '');
export function handoffButtons(item, state = {}) {
  const buttons = HANDOFF_BUTTONS[item?.kind];
  if (!buttons || !item.jobId) return '';
  const locked = Boolean(state.busy || state.sent);
  const row = buttons.map(([operation, label, tone]) => `<button type="button" class="${tone}" data-handoff="${operation}" data-handoff-job="${esc(item.jobId)}"${locked ? ' disabled' : ''}>${esc(label)}</button>`).join('');
  const note = state.sent ? '<p class="inbox-note" role="status">Saved. Claude will carry on.</p>' : '';
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
  const text = inboxItemText(item);
  const onboarding = item.kind === 'onboarding';
  const body = onboarding ? onboardingCard(item)
    : item.kind === 'post' ? postCard(item)
    : item.kind === 'stuck' ? stuckCard(item)
    : isHandoffItem(item) ? handoffButtons(item, ctx.handoff || {})
    : item.kind === 'question' ? questionCard(item, ctx.question || {}, ctx.signal || {}, index)
      : item.kind === 'decision' ? decisionCard(item, ctx)
        : briefCard(item, ctx, index);
  return `<li class="inbox-item${onboarding && !item.needsYou ? ' is-info' : ''}" data-inbox-key="${esc(inboxKey(item))}">${ctx.workspace && !onboarding ? inboxJobLine(item) : ''}${inboxFromLine(item)}${text ? `<p class="inbox-text">${esc(text)}</p>` : ''}${body}</li>`;
}

export function inboxPanel({ items = [], count = null, announcement = '', workspace = false, starter = '', signal = {}, context = () => ({}), bare = false, strip = false } = {}) {
  const list = inboxItemsOf(items);
  const contexts = list.map(item => context(item) || {});
  const answered = list.filter((item, at) => item.kind === 'question' && (contexts[at].question?.submitted || contexts[at].question?.answered)).length;
  const needs = Math.max(0, Math.max(Number.isSafeInteger(count) ? count : 0, list.filter(item => (item.kind !== 'onboarding' && !item.closing) || item.needsYou).length) - answered);
  const tag = needs ? `<span class="pill needed">${needs} ${needs === 1 ? 'needs' : 'need'} you</span>` : '';
  const empty = trimmed(announcement) || (workspace ? INBOX_EMPTY : '');
  const briefs = list.filter(item => item.kind === 'brief' && item.inline && item.field);
  const brief = item => {
    if (item.kind !== 'brief') return {};
    const same = briefs.filter(other => (other.jobId || null) === (item.jobId || null));
    return { briefKeys: same.map(other => other.field), briefLead: !same.length || same[0] === item };
  };
  const body = list.length
    ? `<ol class="inbox-list">${list.map((item, index) => inboxCard(item, { signal, ...contexts[index], ...brief(item), workspace, index })).join('')}</ol>`
    : empty ? `<p class="inbox-announce">${esc(empty)}</p>` : '';
  if (bare) return body ? `<div class="director-inbox">${body}</div>` : '';
  // The compact strip on the home and new-job pages: only what is not tied to a job, and nothing at all when there is none.
  if (strip) return list.length ? `<section class="needs-strip" aria-labelledby="needs-strip-title"><div class="section-head"><h2 id="needs-strip-title">Needs you</h2>${tag}</div><ol class="inbox-list">${list.map((item, index) => inboxCard(item, { signal, ...contexts[index], ...brief(item), workspace, index })).join('')}</ol></section>` : '';
  return `<aside class="inbox" aria-labelledby="inbox-title"><section class="panel inbox-panel"><div class="section-head"><h2 id="inbox-title">Needs you</h2>${tag}</div>${body}${starter ? `<div class="inbox-starter">${starter}</div>` : ''}</section></aside>`;
}

const statusPill = state => `<span class="pill ${esc(String(state || 'pending').toLowerCase().split('_')[0])}">${esc(humanize(state))}</span>`;

export function stageApprovals(stage) {
  return (Array.isArray(stage?.approvals) ? stage.approvals : []).filter(entry => entry && GATE_COMMENT_NAMES[entry.gate]).map(entry => {
    const when = entry.at && Number.isFinite(Date.parse(entry.at)) ? ` ${time(entry.at)}` : '';
    const price = entry.gate === 'price' ? priceWords(entry.totals) : '';
    return `<small class="stage-approved">${esc(`${GATE_COMMENT_NAMES[entry.gate]} approved${when}${price ? ` · ${price}` : ''}`)}</small>`;
  }).join('');
}

const RAIL_SETTLED = new Set(['complete', 'pending', 'cancelled']);
const RAIL_UPCOMING = new Set(['pending', 'waiting', 'running']);
const RAIL_HERE_HELD = Object.freeze({ BLOCKED: 'Held up', ESCALATED: 'Held up', CHANGES_REQUESTED: 'Making the changes you asked for' });
const RAIL_NEEDS_HELP = new Set(['BLOCKED', 'ESCALATED']);
const RAIL_JUMPS = Object.freeze({ decision: ['review', 'Review'], brief: ['brief', 'Finish the brief'] });
const RAIL_TEXT = Object.freeze({
  notStarted: 'Not started yet',
  finished: 'Finished',
  posting: 'Posting',
  lastStep: 'This is the last step.',
  allDone: 'All steps are done.',
  idle: 'Nothing right now, Claude is working.',
  done: 'Nothing, this job is finished.',
  held: 'Claude needs your help. Check the chat.',
});

function railJump(item) {
  if (item?.kind === 'post') return item.closing ? null : postJump(item);
  const jump = item ? RAIL_JUMPS[item.kind] : null;
  if (!jump || (item.kind === 'decision' && trimmed(item.summary) === REVIEW_NOT_READY)) return null;
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

export function stepRail(project, doc = null) {
  const parts = stepRailParts(project, doc);
  if (!parts) return '';
  const jobId = project?.jobId || '';
  const button = parts.jump && jobId ? `<button type="button" class="primary" data-inbox-jump="${esc(jobId)}" data-inbox-target="${esc(parts.jump.target)}">${esc(parts.jump.label)}</button>` : '';
  const cell = (label, body, extra = '') => `<div class="step-rail-cell${extra}"><span class="eyebrow">${label}</span>${body}</div>`;
  const next = parts.next ? cell('What\'s next', `<strong>${esc(parts.next)}</strong>`) : '';
  return `<section class="panel step-rail${parts.next ? '' : ' step-rail-pair'}" aria-label="Where this job is">${cell('Where you are', `<strong>${esc(parts.here)}</strong>`)}${next}${cell('What you need to do', `<p>${esc(parts.need)}</p>${button}`, ' step-rail-need')}</section>`;
}

export function overviewColumn({ strip = '', jobs = '', onboarding = '', onboardFirst = false } = {}) {
  return onboardFirst ? `${strip}${onboarding}${jobs}` : `${strip}${jobs}${onboarding}`;
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
  return `<section class="panel job-flow"><div class="section-head"><h2>Job flow</h2><span class="count">${count} ${count === 1 ? 'stage' : 'stages'}</span></div>${stages.map(jobFlowStage).join('') || '<p class="muted">The stages appear when the brief is routed. Ask Claude to complete the missing brief details.</p>'}</section>`;
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
  if (!hasDoc) return 'The details for this job are still loading. Try again in a moment.';
  if (noun) return `Claude has not added a viewable copy of this ${noun} to the board yet. Ask Claude to add one, or open it from your computer.`;
  return 'The board cannot show this kind of file. Open it from your computer.';
}

/** Research and strategy as collapsible, readable panels. */
export function documentPanels(doc, openKeys = new Set()) {
  if (!doc) return '';
  const files = new Map((doc.files || []).map(file => [file.path, file]));
  const research = (doc.research || []).map(path => files.get(path)).filter(Boolean);
  const strategy = doc.strategy ? files.get(doc.strategy) : null;
  const block = file => `<article class="doc-file"><h3>${esc(outputLabel(file, doc).title)}</h3>${file.text != null ? `<div class="md">${renderMarkdown(withoutTitle(file.text, file.title))}</div>` : '<p class="muted">Too large for the board. Open it from your computer.</p>'}${file.truncated ? '<p class="muted">Shortened for the board. The full file is on your computer.</p>' : ''}</article>`;
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

export function outputsList(artifacts = [], doc = null, openKeys = new Set(), { empty = 'Drafts, media, and the delivery package will appear here.' } = {}) {
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
export function agentLineOf(project) {
  const line = agentPlain(truncateText(project?.agentLine, 80));
  return line ? `<p class="card-agent">${/\bworking\b/i.test(line) ? '<span class="ab-live" aria-hidden="true"></span>' : ''}${esc(line)}</p>` : '';
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
export function agentBoxOf(doc) {
  const source = doc?.agents;
  const all = (Array.isArray(source?.list) ? source.list : []).filter(agent => agent && typeof agent === 'object' && trimmed(agent.id));
  if (!all.length) return null;
  const director = all.find(isDirectorAgent) || null;
  return { all: director ? [director, ...all.filter(agent => agent !== director)] : all, director, others: all.filter(agent => !isDirectorAgent(agent)), unassigned: source.unassigned && typeof source.unassigned === 'object' ? source.unassigned : {} };
}
export function agentElapsed(since, now = Date.now()) {
  const start = Date.parse(since);
  if (!Number.isFinite(start) || start > now) return '';
  const minutes = Math.floor((now - start) / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${Math.floor(minutes / 60)} h`;
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
  if ((Number(agent?.pendingMessages) || 0) >= AGENT_PENDING_LIMIT) return `The ${agentNameOf(agent)} has ${AGENT_PENDING_LIMIT} messages waiting. Wait for a reply before sending more.`;
  return '';
}
export const agentMessageText = text => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
/** The request the composer sends: exactly these fields (the transport adds the workspace). */
export function agentMessageArgs({ project, agent, text, requestId }) {
  return { requestId, brand: project.brand, jobId: project.jobId, agent, text: agentMessageText(text) };
}
/** The request "Try again" sends, for a job that went wrong on our side. */
export function retryStepArgs({ project, requestId }) {
  return { requestId, brand: project.brand, jobId: project.jobId };
}

function agentMessageStatus(agent, message) {
  const name = agentNameOf(agent);
  if (message.status === 'answered') return { word: 'Answered', note: '' };
  if (message.status === 'delivered') return { word: `Delivered${message.deliveredAt ? ' ' + agentTime(message.deliveredAt) : ''}`, note: '' };
  if (isDirectorAgent(agent)) return { word: 'Sent', note: 'The Director replies here.' };
  return { word: 'Sent', note: agentStateOf(agent.state) === 'done' ? `The ${name} has finished, so the Director will answer.` : `Passed on at the ${name}'s next step.` };
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

const DIRECTOR_ROLE = 'Runs the job and talks to you';
function agentStuckBanner(stuck, retry = {}, signal = {}, project = null) {
  if (!stuck || typeof stuck !== 'object') return '';
  const internal = stuck.kind === 'internal';
  const reason = agentPlain(stuck.reason, internal ? 'Something went wrong on our side' : 'Claude needs your help to carry on');
  const since = agentTime(stuck.since);
  // Try again is only for a job that went wrong on our side, and only while the server says it can be tried (not mid-retry, not after a second failure).
  const mine = Boolean(retry.applied && retry.sinceSeen === stuck.since && !retry.submitted);
  const waiting = Boolean(retry.busy || retry.submitted || retry.needsReconciliation || mine);
  const button = stuck.canRetry === true && internal ? `<button type="button" class="ab-retry" data-ab-retry="${esc(project?.jobId || '')}" ${waiting ? 'disabled' : ''}>${retry.busy ? 'Trying again...' : 'Try again'}</button>` : '';
  const status = button ? (mine ? '<p class="inbox-note" role="status">Trying that step again. This updates when it is done.</p>' : inboxStatus(retry, signal)) + inboxError(retry) : '';
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

// A picture for each kind of step: Microsoft Fluent 3D emoji (MIT licence, see THIRD_PARTY_NOTICES.md), shrunk to 92 px WebP (twice the 46 px they show at)
// and embedded so the page needs no network.
const STEP_IMG = Object.freeze({
  folder: 'data:image/webp;base64,UklGRsQFAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSGYCAAABoENtu2nb+f5/znVt27YZp7ojpW3b7lDZ6NwltW3btq29z5przi/OXJl/nCIiJgD/qy2Vr7L6qqpccYpWVcpSDNnnkiuvyHjl5Zedffh8wJXksP7phvm/uXgIqnIcFrzB0GSOTSTvn46qGK0uY5ctpprPLYIvRDHh2dS0QdZ8YwV8KbPeZ0us+c4a+FI+aI2B722MSoxiww+2RC8xioEfboBXoxj42Y6AuvxSFBvWp48UtOilJEbyjYsO332H7bbPue0mo6BSEhnZ5gPbQaUoxroO2dndBa6sNlM3fTBV1Ciy5n5wZoV0lmU8B07sOgsAxBl1QZ/+ffsoVAxK/OKVV1974epNoGLPL3cPhLMoxRhjT+hsBW/Qz/fwliEiVsX4zRI4q1LDLeyK6buldtW8ayjErlPFwagUuxvgrQp8dLSoXZehglEpdXYUsyJfGw9nVcNr4cSqmPaBh1X8cjLUqibdCIFZPBTOqpS6C6BWBd7ZH7/alpqniFoVY70pnFU1HxwFtaqH58CLUTF1tkYFoxo+PwFqVeA18GJVCnuhglGJ702EWtXweiisijxEvFWJnVlQqxrepgKrAo+BsyrFzlKoVSHdMRhiVc0T4ZFh+tsWxPjVRjkE459iKC/w9gGqGaTvdawtOA29kNHjaAMSP91YfBaZ83ZqSmt4t1fJIRXOYCgtpsNQIav6Ec+wLivxnRHQPHBY9RFDU1LN4+GQ22PdU2SoQ1Nm+I6PDRbJBofRZ77Igl9dBocWHTDrwCsfePW9Et968pL5ULSqFeBHTZlR4vTxgEfbzgtKVYffoYgWKvj7FFZQOCA4AwAAUBMAnQEqXABcAD6RQJlJJaOoISq0DAEAEglkAMSaQF4eqBZDmH/OeqLbseYD9gPV8/Gb3Z7yl5AHWlOhGnNQRW1lMA/TM9VhypzpWG2WTe9sFjTcs/BkGDu3nQFjk/uWnaxIomjH5oGxf2TNsAquHzjykpPZfDK7tdhVKpUdPwZvYln7y3CztWeXqde5ALlQmlW/FkZ/ML3XzILOFFOSG7Mf5AD+/szl/++Th4Z8tS3HjPt0CIqjdJIneddZlJWtod3wMnVY9QZt2ZrFRlQddhFlwmFXFMlvav/7//wTt/Ntw+lLLI+g/1PsNPv7UhnKt8ZvONF19JIZ/RSdSnuP0ru3iBXK2LXPfhlDKbYFrx5y8ULtfJ+tXUAUtrkeF+vhFCul06oLzzalBRFvXXXDzMEhxRHSvKxTyrQQKfa5zrYW4XwJtNlRsfH8eAh0mbcsEdoyXtQgp9Z1PzE7dhRJS/zFa6f/oDdEyUlahndeNxgBgxswjLuCVd7n2CSnTdge6o0EA2yng/HL+13XyyJBIgotpk+qPahKmalox2FE3QXnrJTYHy7qJb2yONaus+WBzOqCuE9BUlJGwAuMHTOh8iSewHXm6OvAK63Cmq0IifP/rxiBh186lEoPSdredLQtQE/+9rIOn7xr7gv9iLhWYVQJ/+MZ+PH22T77FMTAP4mNrRhypE33y8pQXyyN5eCnpnUlj2/rZ+Ipl4U0QQkmpyMqqh61Azrxr5JUMbb2Iyrqn6RdUQ6rgbl/7/M3KyILiK18B3hyruncKfVMvB47ExIpy0sOu7dqLdtsWdZ0nI/nA3KNEtn4jymJTaJuzgqKVA9InDiqAzsbPs3q3Cve/rzKhlZaGc9SVXXeOoQZNmdlXB2H3LuLqjt1dpZbH0kjxCTMdgon9wUrau33fgJv4f3M/ek/8f9ZfMuZzl2vlBi/Tc+OVjHx/bnfJul6MxJrhw3hLsFzO97sO3zl9yJrPGII9PNg+Ru14vdPcIEVE/1x4QIloK+rRow+G9geouYbCkkoJijtSYcwjY69Lc/cVNb+f+ZJ+Homeu99Uxn3RLos8PdvWtRaRvL6a/Jiyo7Myp/D7cRqoAA=',
  magnifier: 'data:image/webp;base64,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',
  memo: 'data:image/webp;base64,UklGRloEAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSP0AAAABgKNtkyLlr6rZbMPNkdidA6yeALfMj7U32TsgEUTuTvdOF043jWtETAA+eklEhF4oIQAgeZESZFpKpZYMkphIPCforB6o7lc7kIhnegYC7wNr6qx1uj4A7xIO2f5C3mMhX1nSy9S59FKXKvlC3mNxIIvAxDK+emWsT2M11XtTtcb6NFer48IUQnhW/Tt90Kn/GZYAjOatuvH2DE19qxnsTzCkViO2OgQJsZDGlS4E0rj033+/1S26uNximEE1MRkdDMFo2NALF+2FbjSA/RFj2mgarZppMPkDMUZqpy4Od1obARNCEiPX3t8XZX97DkwISwkiTgjBSaIlfIwCAFZQOCA2AwAAMBQAnQEqXABcAD59NJVHpKMiIbY1z0CQD4lkAMmxTvteLh1Xf1J9235J3mHmK/WL9ive48+jfit5u8plPqe7R+Nbgrb5qlDzXXwPinyfsjyRgZev3rywyob7b01LXLB4OOcc/cpwOTA4WMPJwazQefgtEG2qyQ4Tcn9VeCi4oraaWPPFPgtIsKrI3CAOTYQAOQBk2mPpajhWjtQxePn9w6kmPo71KwzH4MAA/v6fVR/eavkftGcr5lLTV6P+niVDK0ffMz1j9/r2Q0f39NXv2gi7/xEQ254KrA34j2PIvEvNb01NnkJexd29gkwiMEh+XAH4XvvDhiLBFsPJl+YFYRsfqK1eT4cYBajhg/rRxQfUPNARqHoEZ2sBRfHdNa2RqM50IOnXuqfcfFt81zNcPwPpCVlsyl8XxJe0rE4ju8k+Ur8LrWFPa058iUsrKjG9FaY1jrmImL/yxJ3wiYWJBMrVPTvIH9qqaUKQVFf20QGmq/LT9bf1Cjz6QbjpdCQVoGre8h4HDNmA5HSBZZdtXP8zH//XQf/PQ//66JWuXZ+9N3BrpPKZPG1QN0AMQwOnAxL/edcHIP0IBzVYAjbkTSUAO6iTobulFcc+2SHxG+aZ5wtc1Dvwt87ewbdnac1tF08Dp4lPbocKeG+u2W2Zl+uB/8nx/PKWmPNbGjwE89QliPbuul42Pnuc8Tx9NqthkRjzlFmiUnM2tzC5y9WZjt2lqfOh4C9Vu4cadW5Vv51xGL4KQkO0mDqxnuMsdN9lgh2XAmlCWhguEi2reO25tdEqWDj8pqkWtFmR9I2iw3eVIaUQLZnUrrkQMApXkjKKfiCy3dGDY0kM32Hh6AqdM1eNgh8yzssyqfU24txhVjk11JFB0cY5snhRC6UlHT8Gzi3ZjpMnNY19hMVTvYEdB9fKf7Bd++aE8Jfv5IlAN3jm0HkiN1aiGts8bVQGOodYnNDi7UCfU7gN9DSUP3AsCzZlZEH2zwDraWa9soojX0+qA6/gTx2v2J8T/V+n+GFFltVOvthN2XYKVjdSU3yfsfiA8DEIB4uZJhndX3/j39mj//gPNQEhO5+xs15Q8dF8pgLAAAAA',
  script: 'data:image/webp;base64,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',
  picture: 'data:image/webp;base64,UklGRoIEAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSF4AAAABYBtJUqOjLgJi0vlHo8EC6wTWf0QgaNs2ybafQxjAu2iQnIbJH2x2zhPSuWzh+CKkTc4EeOJ66aQs3d3wu81FyNm2v9PXJuTqv/98PkK7tVFvhLTbJu0mK3YDfxYBVlA4IP4DAABwFgCdASpcAFwAPpFAm0klo6KkKddKkLASCWwYnybE7e6jDanm+P+58iYPmXCfVh+gN6x5jP2V9aP/G9Lp1LvoKdLX5KpMCWmAAzhrfC5T6sEXoTYF2+6920KwSzU7sY8ly3As5wkpPR6DM351+6hmKGdujK4wdP3FSiwGE7x4cC8pxT1npnfwI6BxLVY2UvlUmXJVULZmkD952lI/wxlj+Swcvm9OIfHdZAtHoVneQKZFxFw8jTlNWnl2IADZoedvoFqZlMfYSmNeyVrZdbad7n2vyQTbcQeYNpl3Iy4AoSei3waVtAFZn3fxeymoHrcb4M5BoVoQhA6cK1W2C4/2sxzaQmLtYIZmaJAqlKpb1Y+ijdXSS78fApUcRO1yx/8DY8jRE3CiVj0hTPkpFVPvrYNDyTYkZi5wketsZfmyZFd/O8YxEmPUdfpdxCWR9FpENZPi1g0Wuiz/tM2GpBcamPMNjGixaaWcWf+Cds6xkufuwUVVV1dtbwCMw0LfWeJ/Yfcfefy8eV2lbMyOVrZRLH7aOmQbvtcjt/bz3PPcMRLAmOZbW2SRCheysYG6/ATxn620ExJcob+Lptfu3/AaQIQJrir2+mUgKan5yvw2T85ovtvrafZccLPoYqQ7jZHNbV40eE3+93bYtXsRnyGsEaCNh/VV8bwOkFjVyx/wwMkOxYDGi/ohMi5jWHIHTs7pAnMkOU6nVYwyznoB3DNDfZXVlAgNpbprPS9HtQjedPfvf1N6jzw7XfC9HDk4LlIH7KxDXcsK+ZSbtydqSyb49n/z8FTsS0g8EPPt0m+kpVjtw0UmEZwgemSSwytwhkTlvVdE8/B5v/ArFphaAPqJUJMKNd2q7DEEF6bwObq+o4Tee4UTXDWsh3nOrXSrgKThaapfBkaep4Dp6PqFMtANkoCokk7CgCNrMGpyrS+GDjyvPMpYFNMgZSSLQjcYJKfFkLOWHTNF0Gkti7K6pRRMpHY1RXpPsbFBM5qQPxMgG0oNXhIXlloTQyaELwt57iFaMjHsNfarrt5v1CRW9qi+w/R0n3nmAkV99QS9BVG6s9f5vcBUzESFmj7R0yTjynSIUei9RUDH99hg4vl2p6dqk8Rabs4+RNm5LpdfJUL10yGqi33r3/ek21FJxejC69+YtDGiDB2mJFYl3TCqoL34Pe9EGuUkKcE+rzb2FxM3RKPjYcy+M/cwj/Cn0K5zyheGwvm3JUYcP1QJbuAOaMK5VMQC2cAGw6p+WH38NUdbGi95pTMGZ894zPsLZk9veaWPwTEpLMlqpq+duN0gJybJIfy3ZwP5eT8yAnXQpxskOl+Dbr50dff+F/hN4aC3iPrAnKRm/XViyoPC/LAAAA==',
  money: 'data:image/webp;base64,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',
  clapper: 'data:image/webp;base64,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',
  camera: 'data:image/webp;base64,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',
  eyes: 'data:image/webp;base64,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',
  package: 'data:image/webp;base64,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',
  calendar: 'data:image/webp;base64,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',
  sparkles: 'data:image/webp;base64,UklGRooMAABXRUJQVlA4WAoAAAAQAAAAWwAAWwAAQUxQSEgGAAABsEXbtiHZ1lxrR2RVHdv32bq2bdu2bdu2bdu2bRvHqoy9154fmRkZEfn83kdETAD+f6ZqOSKdBUgJ6oBEOkdknr9CClOgfx9AOsVhwWnjfwMtSDH68Htu26FLpDNE04vIE+GKcW70gyR5htMOwbgvLL7bBSlCFCdzRlbv5YbQjlCswMAZC8IV4TDndB/IED/sJ9IZJ9FbPESSIkROoydJ45ZIOgHJa7TABwoRjPohWkPgY06lauISLOAjjT/MilSlHYdNaWyMHD8PXLXEAfL752hkiA+MA+Akn+KuGJow2GFIqwWMWPPayYwkGfnDpSsOAySP4uc/MjbzfKhHtUIifXd7l2Rk00jy1S26VXKksqWPbG5x/PxIKpTiQEYfIltG78lN4XIkuJahBTPujLRSh5Ixj1mM3CKPyqh3aK3q8foekeqIpjt/6MnQLJD1tzdJFK1TrDItxlaBX/wSWp3G/uvf+A2bRn5x+SrdyF3D0czYOgauBFcpB2CO52ik8Z4/AaJ5RPo+kIueJ4pWCpJ0Yb4QafHHv6A7EeR1mPV7hjyBL/Wg6uLcqwyB92tNkN9hY/qYJ9L/GVoxKE6MIcSDkKBNdecxY27jDuKq5rA8A2cu0JZg5HsM+QLvgFRNMPbLyHe7IG04LBYt5ov8diS0YtDkAvJ4OLSpOJmebZptjrRqDgtO+O53Im2IDvic1k7gnUilYlDMMysEbdawAyPbtTh+EdSq1ihos4Yxn9DaouddtTStnHPILc5hxIOMbD8aT1WoSrVyqxMAK7/IUARj4O2zA1AnHaBJAsjI9R/KaCw2Bk65ZplBAFIn1dLUAaOXPuNzksbCA8nXD51/EJCkUh1xgFv06BdJWmCpwcjsgT1nA9RVRYFB29w3gfTeWHrIAvnFdWs6iFZBFMMP/NBI7yMrad6TM17YsgYn5SHd+gsyemOFzZN8YRmolCTacy5pxqpHi/Q7qko5CQ5lZuxIH3pXQVKKk9EfhcAO7eXNPSJFOQUSzP81rVN8fH4UilLAIcEfv7SOyezRQYXh5yMAcck9rHdI7OXBcMUolnzzhbnhHP78CUPshBD44HCnKFKk77vk3f1EBH98lIzeqmWe5EWDoSg0kXUtyzgfFA4927wTyCzEqkSfkTMeX1GgKAg3MAQeAwEU6LvNw5NIn1kVQhbIb25eFRBFsU5GfchofC0FAHGAW/rkN0mGUFIMgeSTB80NOIeiU6w5M0Yymw0KAJo64OdrX/YjSYvFRSP58SnLDAeSBMWnOIkZGbgHkgZAkgRIf77FA72kFRXIideuOgJAmgiKV+n/CD1pvBPaDBB1AmD+a+u0YgLHn/QrAOoUpSYyz/hoDV+MEW3RqE6AjX6yUETguwsB4gQlSw17MCNJy7ZAdy4Argtrz7QCgn3yV9QUJYsq8JtPY2gIfHEMoCp5IN24jNZWDNwJ3ShZUwBDN3qfxqaBL600EEAqOaDypxmM7RhfG+S0JBEMWvyUj0hjy0i+deRC/SGaA4I7YmgnxCORolxFv20eJGnGnGakv3vjGiSHw0Zsi1PngCtH9Rd3ksEb2wxZIK8bCGml+M14Wj7jS4lIOQkO4fQsssCY1bkjaq0Efe9gli/wODiUm2JP9mZWRKgbN0PaCg77tGNcojSVoZfUySzEfNF7cvJJNUiOBIvPNMtj/HIIpCQIdOWrJ5BmeSySX1+4FESQUzHmZfo8ntc4Qeni4Gbd9VHSWkVm9239B8AJ8orTi5nl2wauPEiqQN+FH6U187xz9h7AJYL8KbaKIbayOH22SgCiDhj2WvQNgQ/3gyQqaDfBX76mtfJ8fDCkEo01bMsskrTeddGNIkWTRxha1Xk0XHUcZvsuBtL48RCRQlDD4TnMZq6MBJUV7bmPngy8CQ7FOsw/jbFZ4OvjoNVBiqMajNtLUpAgeZXWzPMiJFKpFafFGNn7B2hBcDiKoUmM9XWQosIqg9+lGZ9RFK6YNYuxwfjuYNEqIcGlNM8D4AqDpA/QNwSehgTVkhVCltVnhxbnsC7rTab/SbRaIslz5FXdIsWpDHmCM2Ps5blQVFwxx6N3/w6KEhMsNoVZxo/GilQNQJ8EglIVa75B/9DsEFTfQRXlisPYBeYZBEEnqqB0BwAOf6/VOcG/aQFWUDggHAYAAPAdAJ0BKlwAXAA+kTqXSCWjIiGseSxYsBIJbAYoAQP1b9URhftfnDVP/CcPigTtt0D+iD9AewBzk/MP5w/oi9AD+m/270u/Ya9AD9mfTm9hz9yvTL6gDhZP5L+IGvo2vy0nN9EzggPDDje9D/No9V+wH+tHpd+yX0E/2KbpgTu87J27Mu/y9wjABIfEGkTY9nSVzWRa5i/4LiXH9+pqqR2JXQU4JGg3UzpIHcPd+lpyTXv65fwRZROuO+WVCQIbwqfkRKU077knaevvgGWB9DUeBAFXZMFrUgMnr0rn+fBrU9iavf6G1BVnwJSo+h+t9aiAuSh3Xz6MAP79tO1H+ONK38TSHZ3o0iVVtd+h6hsCqOyDMF/DWQg7magCDF6j5JgEA97+9kfqPEOvFOFlXPFPcyWX2vQpbEcwh6llta4iVs8W7MVP/NXu/lzsoC9yWaDOYLQvzcCqwBx8y/DiH512+LfMB9Wu9ONR8V+OLDgDNDB6aQWkYfRsX2pwY7G5jHvGY60aLmtuXuvL1TIwO37dHYBItfftMb0En+uWBc53CAyfpbo0gFLoNBacBhWEKFE8THohvxWY9r/GH+GBHDkedmeHWRUmwC+VErRBlaJUR+0LzS5EYlBSpMwLUfJ2fKUfYt75ykoaAwqinMdca/6UE9sSy+e0lsG4J1niPXPQWouZNOLnnQpVPb1wvgvbyW+yZP0YXrzdPBOJvAXPE1s5tJ3eFq62BiJ7ynUDIKLVUMxO5o0f/U7kzDPk96Nu0A5AaqMnSlnhw9jy/XJBaK7nT53AMRoYA0vOl6OxZTk7eD2ivZXDT4HoKia3H7vcJzbcFMKgqVHUlQV8pdTNOsppnujnuqkhFMU/uBbd00aROEGvhf4wZdbjf1XngsH00ge1pDmZpXz/1vQrJk9A0oi3e8DI4TARU3pcaNLlffSuNl6K+p3pCZ9EvM8NkBzpbHSGI5ZCcjgZS29XcYAWEppcwHwvchQb9B2YyZOCsXJTDiweosdvCl9mWzt8YjTbOXyq4ATTybOw7/lffHvq7I93SNiG5AVS8WZXfBM4KStyvKkS557h4A1uYdo6h++eZO9D/SrQvSQ/C12vslN+J3WSTb9Rbvxg9Zg855J+JdvVB9zWjXU1u6HcCRby0zlRiqmXdlqUAf90kr6d0jzOR59dzptaNc7o2n1+ajl/rtak9ZIzWeelBjLt1RucAMcaKmXSJsy8TwhptnFzILA3N9O2zgR9mqN9Jli6O+cO+EwhQupMlg5PLD1PyEhzy/zv4SPxLNdTAyTwB2OMhFh26B/gTdpL6WkYCf61S6MrQkMJ0rBF8VfScoYsPbPaIyoU+6pr7CeTUpy3wUNZI/VrDKa9/rXCwnC7mi9EMcKFoYhXxnZKn36/mbaLyRECDShwGHUjcCxjpT2ABIiC74HOIV0Lh/zf6gpy9Unx1rekH/dwL1yIK87MjksBmWjsatAZP/tsuaPBCtLTNldDoG7cKm/em4wcafm83Ho4mLFzhMxNVzmJLHxXHXPGMsD+vHW9zswBp6d5GB50IgnGwm68+I3of8HlNqT6i8TmvrYVVw21jYUB/0bmb5hfZQ6yOl2f8NrZvwb+xOrUKKZogXWmStCKW3NXvjec5XIuxpnwdgGN3T9DzDNHlk1xsVpV9THAm7jsmv+BNkgkurCobMXnpTlV7grbYLVX6bFwCw6+US87SaPbibzTXiTf4SG20TgbjKbZXStSctWyzzF1tun/NweHmYTdX8EUfJ1hAsXwaJrsFltOO7ff5MQT3G1nkihaqHlJd7kSUdDXzi2E/3wcJ/9QoVejs47qu54I6lEJxC4XtxkTDsPywTDbbNpYdzQ/NRcOLzsbukT2sPPUUEosCvrHk/7b0l/58o3AqkXUKHMre8IheMAI6vGjn06YemlhWUO+Z2xQteiTVPAjwOL6RrZ8cgGnY83KNH2EDUY+3Q1g9UxDxmF25awQ92C4Rr1rwyL/ec/IKuZzNwi5JMjRljbrsR+ypqo6ul5qOalyTMKvcGQEOmCrVcNVK9IvnVz6FK6m+jN3mrsBvriSNm0CyvP//kuFhaT/MzRAAAA=',
  tray: 'data:image/webp;base64,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',
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
const BLOB_ORDER = ['producer', 'researcher', 'strategist', 'copywriter', 'scriptwriter', 'media-buyer', 'videographer', 'editor', 'publisher', 'creative-director'];
const BLOB_HUES = Object.freeze({ 'creative-director': 322 });
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
  needs_you: { word: 'Waiting on you', tone: 'ask', mood: 'surprised' },
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
  if (used) return { state, called: true, ...AGENT_VIEWS[state] };
  return { state, called: false, word: state === 'up_next' ? 'Up next' : 'Waiting its turn', tone: 'idle', mood: 'sleepy' };
}
export function agentAgo(value, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at) || at > now) return '';
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : agentTime(value);
}

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

function agentRow({ agent, view }, { now, needText = '', questions = 0, active = false }) {
  const name = agentNameOf(agent);
  const time = agentAgo(agent.since, now);
  const note = agentPlain(agent.note);
  const line = isDirectorAgent(agent) && view.state === 'needs_you' && needText ? needText : view.state === 'waiting' && note ? note : agentPlain(agent.task);
  const unread = unreadReplies(agent);
  const badge = questions ? `<span class="ag-count" title="Questions waiting on you">${questions}</span>` : unread ? '<i class="ag-dot" role="img" aria-label="New reply" title="A reply you have not read"></i>' : '';
  return `<button type="button" class="ag st-${view.tone}${active ? ' sel' : ''}" data-ab-open="${esc(agent.id)}"><span class="ag-f">${blob(agent.id, view.mood, 36)}<i class="ag-d" aria-hidden="true"></i></span><span class="ag-b"><span class="ag-n"><b>${esc(name)}</b>${time ? `<span class="ag-time num">${esc(time)}</span>` : ''}</span><span class="ag-l"><span class="ag-w">${esc(view.word)}</span>${line ? ` · ${esc(line)}` : ''}</span></span><span class="ag-t">${badge}</span></button>`;
}

/** The Inbox: the Director first, then the agents that have been called, then the ones not called yet. */
export function agentInbox(agents, { now = Date.now(), need = '', needText = '', questions = 0, waitingOnYou = 0 } = {}) {
  const rows = (Array.isArray(agents) ? agents : []).map(agent => ({ agent, view: agentView(agent) }));
  const rank = { working: 0, needs_you: 1, waiting: 2, done: 3 };
  const director = rows.filter(row => isDirectorAgent(row.agent));
  const called = rows.filter(row => !isDirectorAgent(row.agent) && row.view.called)
    .sort((a, b) => (rank[a.view.state] ?? 4) - (rank[b.view.state] ?? 4) || (Date.parse(b.agent.since) || 0) - (Date.parse(a.agent.since) || 0));
  const quiet = rows.filter(row => !isDirectorAgent(row.agent) && !row.view.called);
  const working = rows.filter(row => row.view.state === 'working').length;
  const summary = [waitingOnYou ? `${waitingOnYou} waiting on you` : '', working ? `${working} working` : ''].filter(Boolean).join(' · ');
  const options = row => ({ now, needText, questions: isDirectorAgent(row.agent) ? questions : 0 });
  return `<section class="ag-inbox" aria-labelledby="ag-inbox-title"><div class="in-h"><h2 id="ag-inbox-title">Inbox</h2>${summary ? `<span class="meta num">${esc(summary)}</span>` : ''}</div>${need}<div class="in-l" data-scroll="inbox">${[...director, ...called].map(row => agentRow(row, options(row))).join('')}${quiet.length ? `<div class="in-sep">Not called yet</div>${quiet.map(row => agentRow(row, options(row))).join('')}` : ''}</div></section>`;
}

/** "What you need to do": the top thing waiting on the person, with the button that goes to it. */
export function inboxNeed(parts, jobId, item = null, handoff = {}) {
  if (!parts) return '';
  if (isHandoffItem(item)) return `<div class="in-need"><span class="eyebrow">What you need to do</span><p>${esc(parts.need)}</p>${handoffButtons({ ...item, jobId: item.jobId || jobId }, handoff)}</div>`;
  const jump = parts.jump && jobId
    ? `<button type="button" class="primary" data-inbox-jump="${esc(jobId)}" data-inbox-target="${esc(parts.jump.target)}">${esc(parts.jump.label)}</button>`
    : item?.kind === 'question' ? '<button type="button" class="primary" data-ab-open="producer">Answer in the chat</button>' : '';
  return `<div class="in-need${item || jump ? '' : ' is-idle'}"><span class="eyebrow">What you need to do</span><p>${esc(parts.need)}</p>${jump}</div>`;
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
const TRACE_RUN_WORDS = Object.freeze({ finished: 'Finished', failed: 'Could not finish', stopped: 'Finished', running: 'Working now', lost: 'Stopped responding' });
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
function traceFact(label, value) { return value ? `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>` : ''; }
function traceSection(title, inner) { return inner ? `<section class="trace-sec"><h4>${esc(title)}</h4>${inner}</section>` : ''; }
const traceWho = (id, person, model) => (person ? `<span class="trace-who">${blob(id, person.mood, 20)}<span>${esc(person.name)}${trimmed(model) ? ` · ${esc(model)}` : ''}</span></span>` : '');

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
  const { agent = null, person = null, withWho = true, withFiles = true } = ctx;
  const win = stepWindow(item);
  const status = item.status;
  const files = (Array.isArray(agent?.files) ? agent.files : []).filter(file => file && trimmed(file.path) && (item.outputs || []).some(ref => refMatches(ref, file.path)));
  const priceList = withFiles && item.quote && status === 'done' ? `<p><b>Price list</b></p>${priceTable(item.quote, { withProvider: true })}` : '';
  const made = !withFiles ? '' : priceList + (traceFiles(files, ctx, `Files from ${item.name}`) || (status === 'done' && !priceList && !item.request ? '<p class="muted">No files listed for this step.</p>' : ''));
  const took = win.from !== null && win.to !== null && win.to >= win.from ? tookWords(win.to - win.from) : '';
  const boards = withFiles ? stepStoryboards(item, files, ctx.chipContext?.doc) : [];
  const shotPlan = boards.length ? traceSection('Storyboard', boards.map(board => storyboardStrip(board) + storyboardReadout(board)).join('')) : '';
  const facts = [
    withWho ? traceFact('Done by', traceWho(item.agent || agent?.id, person, agent?.model)) : '',
    traceFact(status === 'done' || status === 'running' ? 'Started' : 'Waiting since', esc(traceWhen(item.startedAt))),
    status === 'done' ? traceFact('Finished', esc([traceWhen(item.doneAt), took].filter(Boolean).join(' · '))) : '',
    status === 'running' ? traceFact('Now', 'Working on it') : '',
    status === 'waiting' ? traceFact('Now', 'Waiting on you') : '',
  ].join('');
  const session = win.known ? [traceRuns(agent ? [agent] : [], win), traceMessages(agent ? [agent] : [], win), traceMoves(agent ? [agent] : [], win)].join('') : '';
  const asked = withFiles ? requestTrace(item) : '';
  const none = !facts && !made && !session && !asked && !shotPlan;
  const sessionBody = win.known ? (session || '<p class="muted">Nothing was recorded for this step.</p>') : '<p class="muted">The time of this step was not recorded.</p>';
  return `<dl class="trace-facts">${facts}</dl>${asked}${traceSection('What it made', made)}${shotPlan}${traceSection('Session', sessionBody)}${none ? '<p class="muted">No history yet.</p>' : ''}`;
}

const APPROVAL_WORDS = Object.freeze({ approved: 'Approved', changes: 'Asked for changes' });
/** What opens under a gate section: who prepared it, when it opened, what the person decided (with any change requests), and the session in between. */
export function gateTrace(item, ctx = {}) {
  const { agent = null, person = null, director = null } = ctx;
  const win = gateWindow(item);
  const history = Array.isArray(item.history) ? item.history : [];
  const price = item.gate === 'price' && item.approval?.totals ? priceWords(item.approval.totals) : '';
  const decisions = history.length
    ? history.map(entry => `<li><b>${esc(APPROVAL_WORDS[entry.decision] || 'Decided')}${entry.round > 1 ? ` (round ${entry.round})` : ''}</b><span class="num">${esc(traceWhen(entry.at))}</span>${entry.comment ? `<span class="trace-quote">${esc(truncateText(entry.comment, 200))}</span>` : ''}</li>`).join('')
    : item.status === 'done' && traceMs(item.approval?.at) !== null ? `<li><b>Approved</b><span class="num">${esc(`${traceWhen(item.approval.at)}${price ? ` · ${price}` : ''}`)}</span></li>` : '';
  const reviewed = [...new Set(history.flatMap(entry => (Array.isArray(entry.files) ? entry.files : [])))].map(path => ({ path }));
  const agents = [agent, director].filter((one, at, list) => one && list.indexOf(one) === at);
  const facts = [
    traceFact('Prepared by', traceWho(item.agent || agent?.id, person, agent?.model)),
    traceFact('Asked you', esc(traceWhen(item.openedAt))),
    item.status === 'waiting' ? traceFact('Now', 'Waiting on you') : '',
  ].join('');
  const session = win.known ? [traceRuns(agent ? [agent] : [], win), traceMessages(agents, win)].join('') : '';
  const decided = decisions ? `<ol class="trace-list">${decisions}</ol>` : '';
  return `<dl class="trace-facts">${facts}</dl>${traceSection('Your decision', decided || (item.status === 'waiting' ? '<p class="muted">Not decided yet.</p>' : ''))}${traceSection('What you saw', (item.quote && item.status === 'done' ? priceTable(item.quote, { withProvider: true }) : '') + traceFiles(reviewed, ctx, `Files you reviewed for ${item.name}`))}${traceSection('Session', win.known ? (session || '<p class="muted">Nothing else was recorded for this decision.</p>') : '')}`;
}

// One bubble for each finished step of this agent: the step's name, the files it made as links, and a small footer.
function workBubbles(agent, tasks, chipContext) {
  const done = tasks.filter(task => task.status === 'done');
  const files = Array.isArray(agent.files) ? agent.files.filter(file => file && trimmed(file.path)) : [];
  if (!done.length && !files.length) return '';
  const groups = (done.length ? done : [{ name: 'What it made', outputs: [] }]).map(task => ({ task, files: [] }));
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
  const model = trimmed(agent.model);
  return groups.map((group, index) => {
    const run = runs[runs.length - (groups.length - index)] || null;
    const last = index === groups.length - 1;
    const chips = agentChips(group.files, last ? Number(agent.filesMore) || 0 : 0, { ...chipContext, label: `${group.task.name}, files from the ${agentNameOf(agent)}`, by: `by the ${agentNameOf(agent)}` });
    const foot = [model, run?.at ? agentTime(run.at) : '', tookWords(run?.tookMs)].filter(Boolean).join(' · ');
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
    return `<div class="msg-r me" data-status="${esc(message.status === 'answered' || message.status === 'delivered' ? message.status : 'sent')}"><div class="bub"><p>${esc(truncateText(message.text, 600))}</p>${message.attachment?.name ? `<span class="ab-chip att">${esc(truncateText(message.attachment.name, 40))}<small>${esc(message.attachment.label || 'Reference')}</small></span>` : ''}</div><span class="msg-t">${esc(sent)}</span></div>${reply ? `<div class="msg-r a"><div class="bub"><p>${esc(reply)}</p></div><span class="msg-t">${esc(`${name}${message.repliedAt ? ` · ${agentTime(message.repliedAt)}` : ''}`)}</span></div>` : ''}`;
  }).join('');
}

const GATE_PICTURES = Object.freeze({ concept: 'sparkles', storyboard: 'picture', price: 'money', sample: 'picture', pictures: 'picture', clips: 'clapper', cut: 'clapper', finishing: 'sparkles', content: 'eyes', publish: 'calendar', findings: 'memo', campaign_proposal: 'memo', campaign_activation: 'package' });
// The picture for a step is picked from what the step is: its short name says it.
const STEP_PICTURES = Object.freeze([
  [/request|setting the plan/, 'folder'], [/price|cost/, 'money'], [/storyboard|media spec|shot plan|slide plan|cut plan|still frames/, 'picture'],
  [/report|strategy|brief|campaign plan|ad requirements|finishing/, 'memo'], [/caption|copy|words/, 'script'], [/idea/, 'sparkles'],
  [/research|sources|watching|breaking down|reading the posts|key phrases/, 'magnifier'], [/making/, 'clapper'],
  [/check|logo|review|quality/, 'eyes'], [/going live|posting|post plan/, 'calendar'], [/ready to post|hand/, 'package'],
]);
function stepPicture(name) {
  const text = String(name || '').toLowerCase();
  return STEP_IMG[STEP_PICTURES.find(([pattern]) => pattern.test(text))?.[1]] || STEP_IMG.tray;
}
const gatePicture = gate => STEP_IMG[GATE_PICTURES[gate]] || STEP_IMG.package;

export function agentComposer(agent, { about = 'the job', ui = {}, signal = {} } = {}) {
  const name = agentNameOf(agent);
  const attach = chatAttachment(ui.attach || {}, name);
  const draft = ui.draft || '';
  const hint = isDirectorAgent(agent) ? 'The Director answers here.' : `The Director passes this on at the ${name}'s next step.`;
  const send = ui.send || {};
  return `<form class="composer ab-compose" data-ab-form novalidate aria-label="${esc(`Message ${name}`)}"><input type="hidden" name="to" value="${esc(agent.id)}"><div class="cmp-row">${attach.button}<label class="visually-hidden" for="ab-text">${esc(`Your message to ${name}`)}</label><textarea id="ab-text" name="text" rows="1" maxlength="${AGENT_MESSAGE_LIMIT}" placeholder="${esc(`Message ${name} about ${about}`)}"${ui.error ? ' aria-invalid="true"' : ''} aria-describedby="ab-hint ab-count${ui.error ? ' ab-error' : ''}">${esc(draft)}</textarea><button type="submit" class="send icon" aria-label="Send message" title="Send message" ${send.busy ? 'disabled' : ''}>${icon('send')}</button></div>${attach.panel}<div class="cmp-meta"><p class="ab-hint" id="ab-hint">${esc(hint)}</p><p class="field-count" id="ab-count">${draft.length} / ${AGENT_MESSAGE_LIMIT}</p></div>${ui.error ? `<p class="notice error inline-error" id="ab-error" role="alert">${esc(ui.error)}</p>` : ''}${inboxStatus(send, signal)}${inboxError(send)}</form>`;
}

// The agent's own tasks on this job, in plan order, at the top of its chat. A task that began (done, working or waiting) opens to its
// history, the same trace the stage card shows; one not started yet is disabled. An agent with no plan rows (the Researcher on
// brand onboarding) lists its runs instead, each openable.
const TASK_PILLS = Object.freeze({ finished: ['done', 'Done'], failed: ['pending', 'Could not finish'], stopped: ['done', 'Done'], running: ['running', 'Working'], lost: ['pending', 'Stopped responding'] });
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
    const head = `<b>${esc(row.name)}</b><span class="pill st-${row.pill[0]}">${esc(row.pill[1])}</span>`;
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
 * gate), `status` (one plain line), and `compose` (the composer, when the person can message this agent).
 */
export function agentChat(agent, ctx = {}) {
  const { tasks = [], chipContext = {}, needs = '', stuck = '', item = null, status = '', compose = '', openKeys = null, jobId = '' } = ctx;
  const view = agentView(agent);
  const name = agentNameOf(agent);
  const director = isDirectorAgent(agent);
  const role = agentPlain(agent.role) || (director ? DIRECTOR_ROLE : agentPlain(agent.task));
  const card = item ? `<div class="msg-r a"><div class="dc s-waiting"><div class="dc-h"><span class="node pic" aria-hidden="true"><img src="${gatePicture(item.gate)}" alt=""></span><div><b>${esc(item.title)}</b><span class="pill st-waiting">Waiting on you</span></div></div>${item.line ? `<p>${esc(item.line)}</p>` : ''}<div class="bub-act"><button type="button" class="sm" data-ab-gate="${esc(item.gate)}">${icon('change')} Request change</button><button type="button" class="sm" data-ab-gate="${esc(item.gate)}">${icon('open')} Open details</button></div></div></div>` : '';
  const typing = view.state === 'working' ? `<div class="msg-r a"><div class="bub"><span class="typing" role="img" aria-label="Working"><i></i><i></i><i></i></span><p class="bub-note">${esc(director ? 'Working on it' : agentPlain(agent.task, 'Working on it'))}</p></div></div>` : '';
  const state = status ? `<div class="msg-r a"><div class="bub"><p>${esc(status)}</p></div></div>` : '';
  const needsBubble = needs ? `<div class="msg-r a bub-wide"><div class="bub bub-need">${needs}</div></div>` : '';
  const stuckBubble = stuck ? `<div class="msg-r a bub-wide"><div class="bub bub-stuck">${stuck}</div></div>` : '';
  return `<aside class="thread chat" aria-labelledby="ab-chat-title" data-chat="${esc(agent.id)}"><div class="th-h"><button type="button" class="ghost icon" data-ab-back aria-label="Back to the inbox" title="Back to the inbox">${icon('back')}</button><span class="ag-f">${blob(agent.id, view.mood, 32)}</span><div class="ch-who"><h2 id="ab-chat-title" tabindex="-1">${esc(name)}</h2><span class="ag-w st-${view.tone}">${esc(view.word)}</span></div></div><div class="chat-l" data-scroll="chat-${esc(agent.id)}"><div class="chat-intro">${blob(agent.id, view.mood, 52)}<b>${esc(name)}</b>${role ? `<p>${esc(role)}</p>` : ''}</div>${stuckBubble}${chatTasks(agent, tasks, { chipContext, openKeys, jobId })}${director ? '' : workBubbles(agent, tasks, chipContext)}${messageBubbles(agent)}${needsBubble}${state}${card}${typing}${chatDetails(agent, { openKeys, jobId })}</div>${compose}</aside>`;
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
const STEP_STATUS_WORDS = Object.freeze({ done: 'Done', running: 'Working', waiting: 'Waiting on you', pending: 'Not started' });
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

function stepCard(item, prev, who, { trace = '', open = false, key = '' } = {}) {
  const person = who(item.agent) || { name: humanize(item.agent), mood: 'sleepy' };
  const status = item.status;
  const starting = status === 'running' && person.called === false;
  const said = status === 'pending' ? (prev ? `Waits on ${prev}` : 'Not started yet') : status === 'waiting' ? 'Waiting on you' : starting ? `The Director is calling the ${person.name}` : item.line || (status === 'done' ? 'Finished' : 'Working on it');
  const glyph = status === 'done' ? icon('check') : status === 'waiting' ? icon('q') : status === 'running' ? '<span class="pip"></span>' : '';
  const row = `<span class="node pic" aria-hidden="true"><img src="${stepPicture(item.name)}" alt=""><i class="st">${glyph}</i></span><div class="step-m"><span class="step-t"><b>${esc(item.name)}</b><span class="pill st-${status}">${starting ? STEP_STARTING_WORD : STEP_STATUS_WORDS[status]}</span></span><span class="step-s">${esc(said.replace(/\.$/, ''))}</span></div><span class="step-a">${blob(item.agent, person.mood, 22)}<span class="ag-s">${esc(person.name)}</span></span>`;
  // A step that is done, working or waiting opens to its history. One not reached yet is shown disabled: no control, no history.
  if (status === 'pending') return `<li class="step s-pending is-locked" aria-disabled="true"><div class="step-row">${row}</div></li>`;
  return `<li class="step s-${status} has-trace"><details class="step-d" data-open-key="${esc(key)}"${open ? ' open' : ''}><summary class="step-row" title="${esc(`Show the history of ${item.name}`)}">${row}<span class="chev" aria-hidden="true">${icon('chev')}</span></summary><div class="trace" role="group" aria-label="${esc(`History of ${item.name}`)}">${trace}</div></details></li>`;
}

function gateSection(item, { jobId, body, open, isOpen, trace = '' }) {
  const status = item.status;
  const price = item.gate === 'price' && item.approval?.totals ? priceWords(item.approval.totals) : '';
  const approved = item.approval?.at && Number.isFinite(Date.parse(item.approval.at)) ? `Approved ${time(item.approval.at)}${price ? ` · ${price}` : ''}` : 'Done';
  const meta = status === 'waiting' ? 'Waiting on you' : status === 'done' ? approved : 'Not started yet';
  const badge = status === 'done' ? icon('check') : status === 'waiting' ? icon('user') : icon('gate');
  const head = `<span class="gl" aria-hidden="true">${badge}</span><span class="gt"><b>${esc(item.name)}</b><span class="meta">${esc(meta)}</span></span>`;
  const cls = `gateband g-${status}`;
  // The history opens for a gate that is done or waiting on the person. A gate not reached yet is disabled, unless it already holds something to show.
  const history = status === 'pending' ? '' : trace;
  if (!body && !history) return `<li class="${cls}${status === 'pending' ? ' is-locked' : ''}" data-gate="${esc(item.gate)}"${status === 'pending' ? ' aria-disabled="true"' : ''}><div class="gb">${head}</div></li>`;
  const key = `gate:${jobId}:${item.gate}:${status}`;
  return `<li class="${cls}" data-gate="${esc(item.gate)}"><details class="gate" data-open-key="${esc(key)}"${isOpen(key, open || status === 'waiting') ? ' open' : ''}><summary class="gb">${head}<span class="chev" aria-hidden="true">${icon('chev')}</span></summary><div class="gate-body">${body}${history ? `<div class="trace" role="group" aria-label="${esc(`History of ${item.name}`)}">${history}</div>` : ''}</div></details></li>`;
}

/**
 * The stages, drawn: a heading ("Stage 2  Writing", "1 of 3 done") and under it the step cards joined by a line, with each
 * gate section between them. `bodies` maps a gate to what opens inside it ({ html, open }); the gates that got a body are
 * returned in `placed`, so the page can show anything left over after the stages. A step or gate that is done, working or
 * waiting opens to its history (`who` gives the agent card behind a step as `agent`, `chipContext` links its files);
 * one not reached yet is disabled.
 */
export function stageFlow(model, { jobId = '', who = () => null, bodies = {}, isOpen = (key, open) => open, chipContext = {} } = {}) {
  const placed = new Set();
  let prev = '';
  const stages = model.map((stage, at) => {
    const done = stage.items.filter(item => item.status === 'done').length;
    const rows = stage.items.map((item, index) => {
      if (item.kind === 'step') {
        const person = who(item.agent);
        const key = `step:${jobId}:${stage.id ?? at}:${item.name}`;
        const card = stepCard(item, prev, who, { trace: item.status === 'pending' ? '' : stepTrace(item, { agent: person?.agent || null, person, chipContext }), open: isOpen(key, false), key });
        prev = item.name;
        return card;
      }
      const own = bodies[item.gate] || null;
      if (own?.html) placed.add(item.gate);
      prev = item.name;
      const author = item.agent ? who(item.agent) : null;
      const director = who('producer');
      const trace = item.status === 'pending' ? '' : gateTrace(item, { agent: author?.agent || null, person: author, director: director?.agent || null, chipContext });
      return gateSection(item, { jobId, body: own?.html || '', open: Boolean(own?.open), isOpen, trace });
    });
    return `<li class="stg"><div class="stg-h"><h3>Stage ${at + 1} <span>${esc(stage.label)}</span></h3><span class="cnt num">${done} of ${stage.items.length} done</span></div><ol class="steps">${rows.join('')}</ol></li>`;
  });
  return { html: stages.length ? `<ol class="flow" aria-label="Steps of this job">${stages.join('')}</ol>` : '', placed };
}

// The Brand onboarding page's own Inbox and chat: the Director and the Researcher (and anyone else who ran), from brand.agents.
// Nobody can be messaged here, so a chat shows who the agent is and what it is doing. The page knows research was just
// requested before the server does, so the Director is Working at once.
export function onboardAgentsPanel(brand, draft = null, now = Date.now(), chatId = null) {
  const list = (Array.isArray(brand?.agents?.list) ? brand.agents.list : []).filter(agent => agent && typeof agent === 'object' && trimmed(agent.id));
  if (!list.length) return '';
  const running = brandResearchPhase(brand, draft, now) === 'running';
  const agents = list.map(agent => (isDirectorAgent(agent) && running && agent.state === 'needs_you' ? { ...agent, state: 'working', task: 'Getting your brand ready' } : agent));
  const open = chatId ? agents.find(agent => agent.id === chatId) : null;
  if (open) return agentChat(open, { status: agentPlain(open.task) });
  return `<div class="onboard-agents">${agentInbox(agents, { now, waitingOnYou: agents.filter(agent => agentView(agent).state === 'needs_you').length })}</div>`;
}

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
    connection: { status: 'waiting', message: 'Ask the running Claude session to sync this board.' },
  };
}

function validateWorkspaceSnapshot(snapshot, workspaceId) {
  const actual = workspaceIdOf(snapshot);
  if (!actual || String(actual) !== String(workspaceId)) {
    throw new Error('This board belongs to a different workspace. Open the board for the selected workspace.');
  }
  return snapshot;
}

function signalMessage(outcome) {
  return SIGNAL_OUTCOMES[outcome] || 'Claude was not notified. Ask Claude in chat to sync this board.';
}

const GATE_COMMENT_NAMES = Object.freeze({
  concept: 'Concept',
  storyboard: 'Storyboard',
  price: 'Price',
  sample: 'Sample',
  pictures: 'Pictures',
  clips: 'Video clips',
  cut: 'Joined video',
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
function requestComment(operation, args = {}) {
  switch (operation) {
    case 'onboard_brand': {
      const name = args?.name || 'the new brand';
      if (!args?.brand || args.start) return `Start onboarding for ${name}.`;
      return args.kit ? `Brand profile and kit saved for ${name}.` : `Brand profile saved for ${name}.`;
    }
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
    case 'continue_job':
      return args?.title ? `Carry on with "${truncateText(args.title, 120)}".` : 'Carry on with this job.';
    case 'import_inputs':
      return `Source files requested${quotedTitle(args?.title)}.`;
    case 'skip_provider':
      return `Skip ${args?.providerName || 'this connector'} for now.`;
    case 'connectors_continue':
      return 'Connectors done. On to your brand.';
    case 'connect_provider':
      return `Connect ${args?.providerName || 'this connector'}.`;
    case 'choose_recipe':
      return `Copy choices saved${quotedTitle(args?.title)} (${args?.deliverable || 'this post'}).`;
    case 'choose_metricool_brand':
      return `Metricool brand for ${args?.brandName || 'this brand'} set to ${args?.label || 'a different brand'}.`;
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
  if (mode !== 'artifact') throw new Error('This board only works as a Claude artifact. Ask Claude to open it for you.');
  if (!host.claude?.use) throw new Error('This board only works when it is opened inside Claude. Ask Claude to open it for you.');
  const workspaceId = String(config.workspaceId || '').trim();
  if (!workspaceId) throw new Error('This board is missing some setup information. Ask Claude to open it again.');
  const db = await host.claude.use('db');
  if (!db?.doc) throw new Error('This board cannot save changes right now. Try again from Claude.');
  const workspaceRef = db.doc(ARTIFACT_WORKSPACE_DOC);
  const inFlight = new Map();
  const savedRequestIds = new Set();
  let signalState = { status: 'idle', message: 'Notify Claude when there is a saved board request to process.' };
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
        requestId ? requestComment(operation, args || {}) : reason === 'Notify Claude' ? 'Please check the board for my latest updates.' : reason,
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
      if (!REQUEST_ID.test(requestId)) throw new Error('A stable request ID is required for this action.');
      if (args.workspaceId != null && String(args.workspaceId) !== workspaceId) {
        throw new Error('This request belongs to a different workspace.');
      }
      const requestArgs = { ...args, requestId, workspaceId };
      const active = inFlight.get(requestId);
      if (active) {
        if (active.operation !== operation || stableJson(active.args) !== stableJson(requestArgs)) throw new Error('Request ID was reused with different data.');
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
            if (!sameRequest(existing, request)) throw new Error('Request ID was reused with different data.');
            const prior = recordData(existing);
            return { status: prior.status || 'requested', requestId, message: prior.message || 'This request is already saved. The running Claude session will validate it once.' };
          }
        }
        await ref.set(request);
        savedRequestIds.add(requestId);
        const signalled = await signal('Board request saved', { requestId, operation, args: requestArgs });
        const message = signalled.status === 'sent'
          ? 'Request saved. The running Claude session has been notified.'
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

if (typeof document !== 'undefined') {
  const config = JSON.parse(document.getElementById('board-config')?.textContent || '{}');
  configurePipelines(config);
  const logoData = String(document.getElementById('board-logo')?.textContent || '').trim();
  const logoSrc = logoData.startsWith('data:image/') ? logoData : '';
  const app = document.getElementById('app');
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
  // The Metricool brand picker on a brand card: which cards have it open, which are saving, and
  // the pick and last error per brand.
  const metricoolUi = { open: new Set(), busy: new Set(), picks: new Map(), errors: new Map() };
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
  const inboxDecisions = new Map();
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
    const optional = connectors.some(connector => connector.optional) ? ' Metricool is optional: it schedules your posts, and setup does not wait for it.' : '';
    const intro = `<p class="muted">Connect the tools Claude uses to make images, video and voice.${optional}${forced ? ' You can skip and connect later from Connectors at the top.' : ''}</p>`;
    const busy = connectorPending.size > 0;
    const next = forced ? `<div class="connectors-next"><p class="muted">${connectors.some(connector => connector.state === 'not_connected') ? 'Anything not connected is skipped for now.' : 'All set.'}</p><button class="primary" data-action="connectors-continue"${busy ? ' disabled' : ''}>Continue</button></div>` : '';
    return `<div class="slate-head"><h1>Connectors</h1>${back}</div>${intro}<section class="connectors-grid">${connectors.map(connector => connectorCard(connector, { busy: connectorPending.has(connector.key) })).join('')}</section>${next}`;
  }
  async function continueConnectors() {
    if (!transport || connectorsContinued) return;
    connectorsContinued = true;
    render();
    try {
      const result = await transport.call('connectors_continue', { requestId: randomId(globalThis) });
      notify(result?.message || 'Saved. Claude moves on to your brand.');
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
      const providerName = (data.connectors || []).find(item => item.key === provider)?.name;
      const result = await transport.call(operation, {requestId: randomId(globalThis), provider, ...(providerName ? { providerName } : {})});
      notify(result?.message || 'Request saved. Claude will validate it and update this board.');
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
    const status = 'Online board';
    const detail = boardSyncDetail(data.updatedAt);
    const connectorsLink = Array.isArray(data.connectors) && data.connectors.length && data.setupStep && data.setupStep !== 'connectors'
      ? '<button class="quiet" data-action="connectors">Connectors</button>' : '';
    const route = routeOf(location.hash);
    const groupId = project ? PIPELINE_KINDS[project.kind]?.group || '' : route.page === 'pipeline' ? route.group : '';
    const door = groupId ? pipelineDoors(data.projects || [], workspaceInbox(data).items).find(item => item.group === groupId) : null;
    // Back goes up one level: a job to its group's page, a group's page to home. The title names where this page is.
    const back = project ? (door ? { href: `#/pipeline/${encodeURIComponent(door.group)}`, label: door.title } : { href: '#/', label: 'Social Campaign' }) : route.page === 'pipeline' ? { href: '#/', label: 'Social Campaign' } : null;
    const title = project ? kindNameOf(project.kind) || kindLabelOf(project) : route.page === 'pipeline' ? door?.title || 'Social Campaign' : 'Social Campaign';
    const backLink = back ? `<a class="back" href="${esc(back.href)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>${esc(back.label)}</a>` : '';
    return `<header class="top"><div class="brand">${backLink}<a href="#/" class="brand-logo" aria-label="Social Campaign home">${logo}</a><span class="sep" aria-hidden="true"></span><span class="brand-copy"><strong>${esc(title)}</strong></span></div><div class="header-tools"><span class="connection"><i class="dot ${ready ? 'ready' : ''}"></i><b>${esc(status)}</b><small>${esc(detail)}</small></span><span class="header-actions">${connectorsLink}<button class="header-refresh" data-action="refresh" ${loading ? 'disabled' : ''}>${loading ? 'Refreshing...' : 'Refresh'}</button></span></div></header>`;
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
    return inlineOnboardingForm(brand, inline, signalInfo);
  }
  // A job waits on the person when a decision is open or it has something in the Inbox; its card gets the gold ring.
  const jobsWaitingOn = items => new Set((Array.isArray(items) ? items : []).filter(item => item && item.jobId && item.kind !== 'onboarding').map(item => item.jobId));
  const cardWaiting = (project, waitingJobs) => !FINAL_JOB_STATES.includes(project?.state) && jobWaiting(project, waitingJobs);
  function projectCard(project, waiting = false) {
    const brand = project.brand === NO_BRAND ? '' : project.brandName || 'Unassigned brand';
    const { done, total } = stageProgress(project);
    const tokens = typeof project.usage?.tokens === 'number' && Number.isFinite(project.usage.tokens) ? `${compactCount(project.usage.tokens)} tokens` : '';
    const lines = [['Opened', openedWord(project.usage?.startedAt)], ['Claude usage', tokens], ['Steps', total ? `${done} of ${total} done` : ''], ['Now', trimmed(project.stageSummary?.current)], ['Where', project.ownershipStatus === 'unbound' ? 'Local draft' : '']].filter(([, value]) => value);
    const activity = agentLineOf(project) || `<p>${esc(project.nextAction || humanize(project.state))}</p>`;
    return `<button class="project-card${waiting ? ' is-waiting' : ''}" data-project="${esc(project.jobId)}" style="--h:${hueOf(project.jobId)}"><span class="pc-top card-art"><span class="pc-glass"><span class="pc-kind">${esc(kindLabelOf(project))}</span><h3>${esc(project.title || 'Untitled job')}</h3>${brand ? `<span class="pc-sub">${esc(brand)}</span>` : ''}</span></span><span class="pc-body card-body"><span class="pc-kv">${lines.map(([label, value]) => `<span>${esc(label)}</span><b class="num">${esc(value)}</b>`).join('')}</span>${pill(project.state, project.stateLabel)}</span><span class="pc-act">${activity}</span><span class="pc-dots" aria-hidden="true"></span></button>`;
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
    const view = project || (item.jobId ? viewOf(item.jobId) : null);
    if (!view) return {};
    if (item.kind === 'decision') inboxDecisions.set(view.jobId, item);
    if (item.kind === 'brief') inboxBriefs.set(view.jobId, [...(inboxBriefs.get(view.jobId) || []), item]);
    const ui = uiFor(view);
    const watched = inboxDocWatches.has(view.jobId) || jobDocWatch.jobId === view.jobId;
    const docState = jobDocStates.get(view.jobId) || (watched ? 'loading' : 'loaded');
    return { project: view, doc: docFor(view), docState, review: ui.review, intake: ui.intake, ...(isHandoffItem(item) ? { handoff: agentBoxState(view).handoff } : {}) };
  }
  function inboxAside(inbox, { project = null, workspace = false, starter = '', bare = false, strip = false } = {}) {
    inboxQuestions.clear();
    inboxDecisions.clear();
    inboxBriefs.clear();
    return inboxPanel({ ...inbox, workspace, starter, bare, strip, signal: signalInfo(), context: item => inboxContext(item, project) });
  }
  const answeredInPlace = item => item.kind === 'decision' && item.jobId && !inboxDecisionArgs(item).error;
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
      if (!(ui.review.submitted && ui.review.requestId && ui.review.args)) {
        ui.review = { choice: null, comment: ui.review.comment || '', commentOpen: false, panelDraft: ui.review.panelDraft || '', draftKey: ui.review.draftKey };
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
    if (ui.review.requestId && ui.review.args && pendingReview(project) && !decisionMatchesReview(project, ui.review.args)) {
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
      const mine = (found || []).filter(request => request && request.operation === 'submit_decision' && !request.status?.match?.(/^(applied|declined|failed|error|rejected|needs_reconciliation)$/) && decisionMatchesReview(project, request.args));
      const request = mine.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
      const ui = uiFor(project);
      if (!request || ui.review.busy || ui.review.submitted) return;
      Object.assign(ui.review, { requestId: request.requestId, busy: false, submitted: true, verdict: request.args.decision === 'request_changes' ? 'request_changes' : 'approve', submittedAt: Date.parse(request.createdAt || '') || Date.now(), operation: 'submit_decision', args: request.args, error: '', declined: false });
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
      if (part === 'review' && status !== 'requested' && status !== 'sent') forgetSentDecision(jobId);
      if (part === 'review' && ['needs_reconciliation', 'error', 'failed', 'rejected'].includes(status)) {
        // A decision that failed can be made again: the card shows the reason and the buttons come back.
        stopJobRequestWatch(key);
        Object.assign(state, { busy: false, submitted: false, needsReconciliation: false, requestId: null, args: null, operation: null, error: acknowledgement.message || receipt.message || 'Claude could not apply this. Try again.', submittedAt: null, lastReminderAt: null, reminding: false });
        render();
      } else if (status === 'applied') {
        stopJobRequestWatch(key);
        Object.assign(state, { busy: false, submitted: false, needsReconciliation: false, requestId: null, error: '', message: '', submittedAt: null, lastReminderAt: null, reminding: false, operation: null, args: null, ...(part === 'answer' ? { answered: true } : {}), ...(part === 'retry' ? { applied: true } : {}) });
        if (part === 'route' || part.startsWith('post:')) routeApplied(state);
        notify(part.startsWith('post:') ? 'Claude saved this.' : part === 'intake' ? 'Claude saved your answers.' : part === 'workspace' ? 'Claude saved the workspace choice.' : part === 'route' ? 'Claude saved how these posts go out.' : part === 'answer' ? 'Claude has your answer.' : part === 'agent-msg' ? 'Claude passed your message on.' : part === 'retry' ? 'Claude is trying that step again.' : 'Claude applied your decision.');
        void refresh();
      } else if (status === 'declined') {
        stopJobRequestWatch(key);
        Object.assign(state, { busy: false, submitted: false, needsReconciliation: false, requestId: null, error: '', declined: true, message: acknowledgement.message || receipt.message || 'Declined in chat. Nothing was changed.', submittedAt: null, lastReminderAt: null, reminding: false, operation: null, args: null });
        if (part === 'route') routeEnded(jobId, state, 'notice', state.message);
        else if (part.startsWith('post:')) postEnded(jobId, part.slice(5), state, 'notice', state.message);
        render();
      } else if (['needs_reconciliation', 'error', 'failed', 'rejected'].includes(status)) {
        Object.assign(state, { busy: false, submitted: false, needsReconciliation: true, error: acknowledgement.message || receipt.message || 'Claude could not apply this. It needs checking before another try.', submittedAt: null, lastReminderAt: null, reminding: false });
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
    const headOf = line => `<div class="page-head" style="--h:${hueOf(project.jobId)}"><div class="job-head-main"><span class="job-mark" aria-hidden="true"></span><div class="job-head-copy"><h1>${esc(project.title || 'Untitled job')}</h1><p class="job-sub">${esc(subtitle)}</p>${plannedAsLine(project, { sent: planNoteSent(project) })}${line ? `<p>${esc(line)}</p>` : ''}</div></div><div class="job-head-chips"><span class="kind-chip">${esc(kindLabelOf(project))}</span>${pill(project.state, project.stateLabel)}${handoffStatusLine(project) ? `<span class="kind-chip handoff-chip">${esc(handoffStatusLine(project))}</span>` : ''}</div>${jobProgress(project)}</div>`;
    const head = headOf(nextLine);
    if (project.detailsLoaded === false) return `${head}${jobStats(project)}<div class="layout"><div><section class="panel intake">${jobLoadingLine(docState)}</section></div></div>`;
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
    const review = sent && pendingGate === 'publish' ? '' : reviewPanel(project, doc, ui.review, { docState, signal: signalInfo(), recipeState: ui.recipe, workspaceState: ui.workspace, routeState: ui.route, postStates: ui.posts, openKeys, downloads });
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
    const agentBox = agentBoxOf(doc);
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
    const flow = stageFlow(stages, { jobId: project.jobId, who, bodies, isOpen: gateOpen, chipContext });
    const left = (gate, html) => (flow.placed.has(gate) ? '' : html);
    const standalone = left('publish', sentPanel + kitPanel) + left('findings', report) + left('storyboard', storyboard) + (flow.placed.has(pendingGate) ? '' : review) + recipeStandalone;
    const filesPanel = agentBox
      ? `<details class="panel doc-panel" data-open-key="more:files"${openKeys.has('more:files') ? ' open' : ''}><summary><span class="doc-summary-title">Outputs and files</span></summary><div class="doc-body">${agentFilesBody(agentBox, { chipContext, jobId: project.jobId, openKeys, omitted })}</div></details>`
      : `<details class="panel doc-panel" data-open-key="more:files"${openKeys.has('more:files') ? ' open' : ''}><summary><span class="doc-summary-title">Outputs and files</span></summary><div class="doc-body"><div class="section-head"><span></span><button class="quiet" data-action="source">Add source files</button></div>${outputsList(project.artifacts || [], doc, openKeys, reportJob ? { empty: 'The report will appear here.' } : {})}${omittedLine}</div></details>`;
    const wantsFile = needItems.some(item => item.kind === 'question' && item.wantsUpload && !item.closing);
    const referencesBox = referencesPanel(project, ui.refs || {}, { openKeys, open: wantsFile });
    const usagePanel = `<details class="panel doc-panel" data-open-key="more:usage"${openKeys.has('more:usage') ? ' open' : ''}><summary><span class="doc-summary-title">Usage</span></summary><div class="doc-body">${jobStats(project)}${usageFooter({ project, brands: data.brands || [], bare: true })}</div></details>`;
    const aboutRows = [['Brand', project.brand === NO_BRAND ? '' : brandLabel], ['Kind of job', kindLabelOf(project)], ['Opened', openedWord(project.usage?.startedAt)], ['Where', project.ownershipStatus === 'unbound' ? 'Local draft' : '']].filter(([, value]) => value);
    const aboutPanel = `<details class="panel doc-panel" data-open-key="more:about"${openKeys.has('more:about') ? ' open' : ''}><summary><span class="doc-summary-title">About this job</span></summary><div class="doc-body"><dl class="about-list">${aboutRows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></div></details>`;
    // The right column: the Inbox, or the chat with one agent.
    const tasksOf = id => (project.stages || []).flatMap(stage => (Array.isArray(stage?.tasks) ? stage.tasks : [])).filter(task => planWord(task?.agent) === id).map(task => ({ name: trimmed(task.name) || 'Step', line: trimmed(task.line), status: STEP_STATUSES.has(task.status) ? task.status : 'pending', outputs: Array.isArray(task.outputs) ? task.outputs : [], startedAt: trimmed(task.startedAt), doneAt: trimmed(task.doneAt) }));
    const decision = pendingGate ? needItems.find(item => item.kind === 'decision' && item.gate === pendingGate) : null;
    let side;
    // On a phone the Inbox stacks under every stage, so the same "What you need to do" block also sits under the job header;
    // CSS shows only one of the two, and both buttons are the same jump.
    let needTop = '';
    if (chatAgent) {
      markRepliesSeen(chatAgent);
      const director = isDirectorAgent(chatAgent);
      const steps = tasksOf(chatAgent.id);
      const todo = steps.find(step => step.status !== 'done') || steps.at(-1);
      const needs = director ? inboxAside({ ...inboxView, items: needItems }, { project, bare: true }) : '';
      // One voice: the decision card is the Director's. The agent that wrote the work behind the gate shows a plain "handed over" line.
      const waiting = chatDecisionCard(chatAgent, decision, pendingGate);
      const handed = agentHandedLine(chatAgent);
      side = agentChat(chatAgent, {
        now, tasks: steps, chipContext, needs, openKeys, jobId: project.jobId,
        status: director ? handoffStatusLine(project) : handed,
        stuck: director ? agentStuckBanner(agentBox?.director?.stuck, boxUi.retry, signalInfo(), project) : '',
        item: waiting ? { gate: pendingGate, jobId: project.jobId, title: GATE_TITLES[pendingGate] || humanize(pendingGate), line: trimmed(decision.summary) } : null,
        compose: agentBox ? agentComposer(chatAgent, { about: director ? 'the job' : todo?.name || 'its work', ui: boxUi, signal: signalInfo() }) : '',
      });
    } else {
      const top = needItems[0] || null;
      const need = inboxNeed(railParts, project.jobId, top, boxUi.handoff);
      if (need && !need.includes('class="in-need is-idle"')) needTop = `<div class="need-top">${need}</div>`;
      side = agentInbox(box.all, { now, need, needText: railParts && top ? railParts.need : '', questions: openNeeds.filter(item => item.kind === 'question').length, waitingOnYou: openNeeds.length });
    }
    return `${railParts?.need === nextLine ? headOf('') : head}${needTop}${brandDriftNotice(project)}<div class="studio${chatAgent ? ' open' : ''}${needTop ? ' has-need-top' : ''}"><div class="studio-main">${intakePanel}${referencesBox}${flow.html}${standalone}<div class="studio-more">${documentPanels(doc, openKeys)}${filesPanel}${usagePanel}${aboutPanel}</div></div><div class="studio-side">${side}</div></div>`;
  }
  function metricoolFor(brand) {
    return { brands: data.metricoolBrands || [], open: metricoolUi.open.has(brand.slug), busy: metricoolUi.busy.has(brand.slug), selected: metricoolUi.picks.get(brand.slug) || '', error: metricoolUi.errors.get(brand.slug) || '' };
  }
  async function submitMetricoolBrand(slug) {
    const brand = (data.brands || []).find(item => item.slug === slug);
    const blogId = metricoolUi.picks.get(slug) || brand?.publishing?.blogId || '';
    const chosen = (data.metricoolBrands || []).find(item => item.id === blogId);
    if (!transport || !brand || !chosen || metricoolUi.busy.has(slug)) return;
    metricoolUi.busy.add(slug);
    metricoolUi.errors.delete(slug);
    render();
    try {
      const result = await transport.call('choose_metricool_brand', { requestId: randomId(globalThis), brand: slug, blogId, brandName: brand.name, label: chosen.label });
      metricoolUi.open.delete(slug);
      metricoolUi.picks.delete(slug);
      notify(result?.message || 'Request saved. Claude will validate it and update this board.');
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
    if (!brands.length) return '';
    return `<section class="brand-strip"><div class="section-head"><div><span class="eyebrow">Brand context</span><h2>Your brands</h2></div><span class="count">${brands.length}</span></div><div class="brand-list">${brands.map(brand=>brandChip(brand, metricoolFor(brand))).join('')}</div></section>`;
  }
  function overview() {
    // The setup step itself; the top bar's Connectors link is drawn by render over any page.
    if (data.setupStep === 'connectors' && !connectorsContinued && Array.isArray(data.connectors) && data.connectors.length) return connectorsPanel(true);
    const projects = data.projects || [];
    const firstRun = readyBrands().length === 0 && projects.length === 0;
    const onboarding = inlineStart();
    const newJob = Boolean(inline && inline.kind === 'new');
    const stageTitle = newJob ? 'Jobs' : firstRun || (inline && inline.kind === 'onboard') ? 'Brand onboarding' : 'Jobs';
    const brandButton = '<button data-action="brand">Brand onboarding</button>';
    const newButton = '<button class="primary" data-action="new">+ New job</button>';
    const tools = !firstRun ? brandButton + newButton : newJob ? brandButton : newButton;
    const head = `<div class="slate-head"><h1>${esc(stageTitle)}</h1><div class="toolbar">${tools}</div></div>`;
    const strip = brandStrip();
    // On the Brand onboarding page the agent cards say who is working, so they stand in for the "research has started" note.
    const onboardBrand = inline?.kind === 'onboard' && inline.brand ? (data.brands || []).find(item => item.slug === inline.brand) : null;
    const agentsPanel = onboardAgentsPanel(onboardBrand, inline, Date.now(), onboardChat);
    if (!agentsPanel) onboardChat = null;
    const workspaceItems = workspaceInbox(data, { drafts: [inline, ...inlineDrafts.values()].filter(Boolean) });
    const inbox = agentsPanel ? { ...workspaceItems, items: workspaceItems.items.filter(item => !(item.kind === 'onboarding' && item.state === 'running' && item.brand === onboardBrand.slug)) } : workspaceItems;
    const waitingJobs = jobsWaitingOn(workspaceItems.items);
    const jobsHtml = () => firstRun ? '' : `<section class="jobs-section"><div class="section-head"><h2>In flight</h2><span class="count">${projects.length}</span></div>${projects.length ? `<div class="project-grid">${projects.map(project => projectCard(project, cardWaiting(project, waitingJobs))).join('')}</div>` : `<p class="muted empty-jobs">${readyBrands().length ? 'No jobs yet. Describe what you want below.' : 'No jobs yet. Complete brand onboarding, then describe the first campaign.'}</p>`}</section>`;
    const side = aside => (agentsPanel ? `<div class="onboard-side">${agentsPanel}${aside}</div>` : aside);
    if (firstRun) {
      syncInboxDocuments();
      if (!inbox.items.length && !agentsPanel) return `${head}${onboarding}${strip}`;
      return `${head}<div class="layout"><div>${onboarding}${strip}</div>${side(inbox.items.length ? inboxAside(inbox, { workspace: true }) : '')}</div>`;
    }
    const doors = pipelineDoors(projects, inbox.items);
    const doorRow = doors.length && inline?.kind !== 'onboard' ? `<section class="doors" aria-label="Kinds of job">${doors.map(door => doorHtml(door)).join('')}</section>` : '';
    if (inline?.kind === 'onboard') {
      syncInboxDocuments(inbox.items.filter(answeredInPlace).map(item => item.jobId));
      return `${head}${doorRow}<div class="layout"><div>${overviewColumn({ strip, jobs: jobsHtml(), onboarding, onboardFirst: true })}</div>${side(inboxAside(inbox, { workspace: true }))}</div>`;
    }
    // Home and the new-job page: every job that waits on the person is marked on its own card, so the only items left for
    // a strip are the ones that belong to no job on the board (a brand's onboarding, a connection, a question with no job).
    const marked = new Set(projects.filter(project => cardWaiting(project, waitingJobs)).map(project => project.jobId));
    const loose = inbox.items.filter(item => !item.jobId || item.kind === 'onboarding' || !marked.has(item.jobId));
    syncInboxDocuments(loose.filter(answeredInPlace).map(item => item.jobId));
    const needs = loose.length ? inboxAside({ items: loose }, { workspace: true, strip: true }) : '';
    return `${head}${doorRow}<div class="overview-main">${needs}${overviewColumn({ strip, jobs: jobsHtml(), onboarding })}</div>`;
  }
  // One pipeline group's page: its own door as the header, the jobs in it, then the composer to start another.
  function pipelinePage(group) {
    const pipelineItems = workspaceInbox(data).items;
    const waitingJobs = jobsWaitingOn(pipelineItems);
    const door = pipelineDoors(data.projects || [], pipelineItems).find(item => item.group === group);
    if (!door) return '<div class="slate-head"><h1>Nothing here</h1></div><p class="muted">This kind of job is not on the board. <a href="#/">Back to all jobs</a></p>';
    const jobs = door.jobs.length
      ? `<section class="jobs-section"><div class="section-head"><h2>In flight</h2><span class="count">${door.jobs.length}</span></div><div class="project-grid">${door.jobs.map(project => projectCard(project, cardWaiting(project, waitingJobs))).join('')}</div></section>`
      : '<p class="muted empty-jobs">No jobs of this kind yet. Start one below.</p>';
    const composer = inline ? inlineStart() : `<section class="panel">${composerForm({ values: starterValues, refs: starterRefs }, { brands: data.brands || [], variant: 'inbox' })}</section>`;
    return `<div class="slate-head"><h1>${esc(door.title)}</h1></div>${doorHtml(door, { hero: true })}${jobs}<div class="pipeline-composer" id="pipeline-composer">${composer}</div>`;
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
      if (file) return `${mediaTile({ kind: 'video', title: outputLabel(a, doc).title, poster: file.poster, durationSeconds: file.durationSeconds })}<p class="muted drawer-note">The video stays on your computer until Claude adds a copy to the board.</p>`;
    }
    if (/audio/.test(type) && preview) return `<audio controls src="${esc(preview)}"></audio>`;
    if (preview && !/image|video|audio/.test(type)) return `<a href="${esc(preview)}" target="_blank" rel="noopener noreferrer">Open output</a>`;
    // An internal .json file (a concept, storyboard, generation manifest...) is
    // structured data for Claude, not something to dump raw on the board: the
    // storyboard and other review panels already show its readable fields.
    if (/\.json$/i.test(a.path || '')) return '<p class="muted">Internal data file. Its readable fields show in the review above; open it from your computer for the raw file.</p>';
    const text = file?.text ?? a.content;
    if (text != null) return `${/\.md$/i.test(a.path || '') ? `<div class="md">${renderMarkdown(text)}</div>` : `<pre>${esc(text)}</pre>`}${file?.truncated ? '<p class="muted drawer-note">Shortened for the board. The full file is on your computer.</p>' : ''}`;
    if (file?.omitted) return '<p class="muted">Too large for the board. Open it from your computer.</p>';
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
  function render() {
    const project = current();
    captureStarter();
    const jobFocus = captureJobFocus();
    const jumped = Object.values(JUMP_TARGETS).find(selector => document.activeElement?.matches?.(`${selector}[tabindex="-1"]`)) || null;
    const stripScroll = [...app.querySelectorAll('.sb-strip')].map(strip => strip.scrollLeft);
    const paneScroll = capturePaneScroll();
    app.innerHTML=topbar(project)+'<main class="wrap">'+(error?`<div class="notice error" role="alert">${esc(error)}</div>`:'')+(connectorsView && Array.isArray(data.connectors) && data.connectors.length ? connectorsPanel(false) : project?details(project):routeOf(location.hash).page === 'pipeline' ? pipelinePage(routeOf(location.hash).group) : overview())+(project ? '' : usageFooter({brands: data.brands || [], projects: data.projects || []}))+'</main>'+ (drawer?renderDrawer():'') + (viewer?renderViewer():'');
    const inlineForm = app.querySelector('#inline-form');
    restoreForm(inlineForm, inline?.values);
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
    const box = app.querySelector(`.inbox-item[data-inbox-key="${CSS.escape(`question-${questionId}`)}"] textarea`);
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
      if (text !== null) focusQuietly(`.inbox-item[data-inbox-key="${CSS.escape(`question-${questionId}`)}"] textarea`);
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
        notify(result?.message || 'Claude has your answer.');
        await refresh();
      }
    } catch (e) {
      Object.assign(state, { busy: false, requestId: null, error: e.message });
      render();
    }
  }
  async function approveFromInbox(jobId) {
    const item = inboxDecisions.get(jobId);
    const project = viewOf(jobId);
    if (!item || !project || !transport) return;
    const state = uiFor(project).review;
    if (state.busy || state.submitted || state.needsReconciliation) return;
    const requestId = state.requestId || randomId(globalThis);
    const { args, error } = inboxDecisionArgs(item, { brand: project.brand, requestId });
    if (error) { state.error = error; render(); return; }
    Object.assign(state, { requestId, busy: true, verdict: 'approve', error: '', declined: false, operation: 'submit_decision', args });
    render();
    try {
      const result = await transport.call('submit_decision', args);
      Object.assign(state, { busy: false, submitted: true, submittedAt: state.submittedAt || Date.now(), message: result?.message || '', signal: result?.signal || null });
      scheduleReminderWake(state);
      if (artifactMode()) { rememberSentDecision(project.jobId, state.requestId); watchJobRequest(project.jobId, 'review', state); }
      render();
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
    if (!allowed.includes(file.type)) { kit.logo = { error: 'Use a PNG, JPG, WebP or SVG file.' }; inline.kitFocus = kitFocusSelector('replace-logo'); render(); return; }
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
      kit.logo = { error: 'Use a PNG, JPG, WebP or SVG file.' };
    }
    captureInlineValues();
    inline.kitFocus = kitFocusSelector('replace-logo');
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
    if (!PHOTO_ACCEPT.includes(file.type)) return { error: 'Use a PNG, JPG or WebP file.' };
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
      return { error: 'Use a PNG, JPG or WebP file.' };
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
    if (!payload) { state.photo = { error: 'Use a PNG, JPG or WebP file.' }; render(); return; }
    const requestId = randomId(globalThis);
    state.photo = { ...photo, requestId, busy: true, error: null, message: '' };
    render();
    const character = Boolean(project.intake?.fields?.some(field => field?.key === 'subjectPhoto'));
    const args = { requestId, brand: project.brand, jobId: project.jobId, expectedRevision: project.revision, photo: payload, ...(character ? { subject: 'character' } : {}), ...(project.title ? { title: project.title } : {}) };
    try {
      const result = await transport.call('attach_product_photo', args);
      if (result?.status === 'requested') {
        Object.assign(state.photo, { busy: false, message: result.message || 'Saving. Claude will confirm shortly.' });
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
    ui.refs ||= { type: 'picture', file: null, fileName: '', text: '', note: '', busy: false, error: '', message: '' };
    return ui.refs;
  }
  function currentRefProject() {
    const id = selectedId();
    return (data.projects || []).find(item => item.jobId === id) || null;
  }
  function captureRefInputs(state) {
    const note = app.querySelector('[name="ref_note"]');
    const text = app.querySelector('[name="ref_text"]');
    if (note) state.note = note.value;
    if (text) state.text = text.value;
  }
  function onRefChange(field) {
    const project = currentRefProject();
    if (!project) return;
    const state = refStateFor(project);
    captureRefInputs(state);
    if (field.name === 'ref_type') {
      state.type = field.value;
      state.file = null; state.fileName = ''; state.error = ''; state.message = '';
    } else if (field.name === 'ref_file') {
      const file = field.files?.[0] || null;
      const problem = referenceProblem(state.type, file);
      state.file = problem ? null : file;
      state.fileName = problem || !file ? '' : file.name;
      state.error = problem;
      state.message = '';
    }
    render();
  }
  async function submitReference(project) {
    if (!transport) return;
    const state = refStateFor(project);
    captureRefInputs(state);
    if (state.busy) return;
    if (!state.file && !(state.type === 'caption' && state.text.trim())) {
      state.error = state.type === 'caption' ? 'Type some text, or choose a text file.' : 'Choose a file first.';
      render();
      return;
    }
    state.busy = true; state.error = ''; state.message = '';
    render();
    try {
      let assets = null;
      if (artifactMode() && globalThis.claude?.use) {
        try { assets = await globalThis.claude.use('assets'); } catch { assets = null; }
      }
      const reference = await encodeReferenceUpload(assets, { type: state.type, file: state.file, text: state.text, note: state.note });
      const requestId = randomId(globalThis);
      const result = await transport.call('add_reference', { requestId, brand: project.brand, jobId: project.jobId, expectedRevision: project.revision, reference, ...(project.title ? { title: project.title } : {}) });
      Object.assign(state, { busy: false, file: null, fileName: '', text: '', note: '', message: result?.message || 'Saving. Claude will confirm shortly.' });
      notify(result?.status === 'requested' ? 'Reference sent. Claude will save it to this job.' : (result?.message || 'Reference saved.'));
      render();
      await refresh();
    } catch (e) {
      Object.assign(state, { busy: false, error: e.message || 'Could not add that reference.' });
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
  function onNewRefChange(field) {
    const state = newRefsOf();
    captureNewRefInputs(state);
    if (field.name === 'nref_type') {
      Object.assign(state, { type: field.value, file: null, fileName: '', error: '' });
    } else if (field.name === 'nref_file') {
      const file = field.files?.[0] || null;
      const problem = referenceProblem(state.type, file);
      Object.assign(state, { file: problem ? null : file, fileName: problem || !file ? '' : file.name, error: problem });
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
    Object.assign(state, { file: null, fileName: '', text: '', note: '', error: '' });
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
      item.encoded ||= await encodeReferenceUpload(assets, { type: item.type, file: item.file, text: item.text, note: item.note });
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
  function onUploadFieldChange(prefix, field) {
    const state = uploadStateFor(prefix, field);
    if (!state) return;
    const scope = field.closest('[data-qref],[data-aref]') || app;
    const note = scope.querySelector(`[name="${prefix}_note"]`);
    const text = scope.querySelector(`[name="${prefix}_text"]`);
    if (note) state.note = note.value;
    if (text) state.text = text.value;
    if (field.name === `${prefix}_type`) {
      Object.assign(state, { type: field.value, file: null, fileName: '', error: '', typeTouched: true });
    } else {
      const file = field.files?.[0] || null;
      if (file && !state.typeTouched) state.type = referenceTypeFor(state.type, file);
      const problem = referenceProblem(state.type, file);
      Object.assign(state, { file: problem ? null : file, fileName: problem || !file ? '' : file.name, error: problem });
    }
    state.message = '';
    render();
  }
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
      const reference = await encodeReferenceUpload(assets, { type: state.type, file: state.file, text: state.text, note: state.note });
      const requestId = randomId(globalThis);
      const args = { requestId, brand: ownerJob.brand, jobId: ownerJob.jobId, expectedRevision: ownerJob.revision, reference, ...(ownerJob.title ? { title: ownerJob.title } : {}), ...(prefix === 'aref' ? { to: agentBoxState(ownerJob).chat || agentBoxState(ownerJob).to || 'producer' } : {}), ...(questionId ? { questionId } : {}) };
      const result = await transport.call('add_reference', args);
      Object.assign(state, { busy: false, file: null, fileName: '', text: '', note: '', typeTouched: false, open: false, message: result?.message || 'Sent. Claude will save it to this job.' });
      if (questionId) state.type = item?.wantsUpload?.type || 'picture';
      notify(result?.status === 'requested' ? 'File sent. Claude will save it to this job.' : (result?.message || 'File saved.'));
      render();
      await refresh();
    } catch (e) {
      Object.assign(state, { busy: false, error: e.message || 'Could not send that file.' });
      render();
    }
  }
  app.addEventListener('toggle', event => {
    if (event.target?.matches?.('details.new-refs')) newRefsOf().open = event.target.open;
  }, true);
  app.addEventListener('input', event => {
    const name = event.target?.name;
    if (name === 'nref_note' || name === 'nref_text') { captureNewRefInputs(newRefsOf()); return; }
    if (name === 'aref_note' || name === 'aref_text' || name === 'qref_note' || name === 'qref_text') {
      const state = uploadStateFor(name.startsWith('aref') ? 'aref' : 'qref', event.target);
      if (state) state[name.endsWith('note') ? 'note' : 'text'] = event.target.value;
      return;
    }
    if (name !== 'ref_note' && name !== 'ref_text') return;
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
    const target=event.target.closest('button,[data-action],[data-onboard],[data-project],[data-artifact],[data-tab],[data-review-action],[data-mr-action],[data-kit-action],[data-photo-action],[data-recipe-save],[data-ref-action],[data-nref-action],[data-nref-remove],[data-aref-action],[data-qref-send]');if(!target)return;
    if(target.dataset.arefAction==='toggle'){const shown=current();if(shown){const state=agentBoxState(shown).attach||=freshNewJobRefs();state.open=!state.open;state.error='';render();}return;}
    if(target.dataset.arefAction==='send'){void sendUploadedReference('aref',target);return;}
    if(target.dataset.qrefSend!==undefined){void sendUploadedReference('qref',target);return;}
    if(target.dataset.nrefAction==='add'){const state=newRefsOf();state.open=true;queueNewRef(state);render();return;}
    if(target.dataset.nrefRemove!==undefined){const state=newRefsOf();state.items=(state.items||[]).filter((_,index)=>String(index)!==target.dataset.nrefRemove);state.error='';render();return;}
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
    if(target.dataset.unlock){
      captureInlineValues();
      if(!inline)return;
      const name=target.dataset.unlock;
      inline.unlocked={...(inline.unlocked || {}), [name]:true};
      const value=String(inline.values?.[name] ?? '');
      inline.focusName=name;
      inline.selectionStart=value.length;
      inline.selectionEnd=value.length;
      render();
      return;
    }
    if(target.dataset.inboxAnswer!==undefined){void answerQuestion(target.dataset.inboxAnswer,{choice:Number(target.dataset.choice)});return;}
    if(target.dataset.inboxType!==undefined){openAnswerBox(target.dataset.inboxType);return;}
    if(target.dataset.inboxCancel!==undefined){closeAnswerBox(target.dataset.inboxCancel);return;}
    if(target.dataset.inboxApprove!==undefined){approveFromInbox(target.dataset.inboxApprove);return;}
    if(target.dataset.abOpen!==undefined){openChat(target.dataset.abOpen);return;}
    if(target.dataset.abBack!==undefined){closeChat();return;}
    if(target.dataset.abGate!==undefined){leaveChatForJump();jumpToGate(target.dataset.abGate);return;}
    if(target.dataset.inboxJump!==undefined){leaveChatForJump();jumpFromInbox(target.dataset.inboxJump, target.dataset.inboxTarget);return;}
    if(target.dataset.metricoolChange!==undefined){metricoolUi.open.add(target.dataset.metricoolChange);metricoolUi.errors.delete(target.dataset.metricoolChange);render();app.querySelector(`[data-metricool-brand="${CSS.escape(target.dataset.metricoolChange)}"]`)?.focus();return;}
    if(target.dataset.metricoolCancel!==undefined){metricoolUi.open.delete(target.dataset.metricoolCancel);metricoolUi.picks.delete(target.dataset.metricoolCancel);metricoolUi.errors.delete(target.dataset.metricoolCancel);render();return;}
    if(target.dataset.metricoolSave!==undefined){void submitMetricoolBrand(target.dataset.metricoolSave);return;}
    if(target.dataset.connect){void submitConnectorAction('connect_provider', target.dataset.connect);return;}
    if(target.dataset.skip){void submitConnectorAction('skip_provider', target.dataset.skip);return;}
    if(target.dataset.project){location.hash='#/project/'+encodeURIComponent(target.dataset.project);return;}
    if(target.dataset.nav){location.hash=target.dataset.nav;return;}
    if(target.dataset.abRetry!==undefined){const shown=current();if(shown)void submitRetryStep(shown);return;}
    if(target.dataset.handoff&&target.dataset.handoffJob){void submitHandoff(target.dataset.handoffJob,target.dataset.handoff);return;}
    if(target.dataset.artifact!==undefined){returnFocus=target;returnSelector=`[data-artifact="${CSS.escape(target.dataset.artifact)}"]`;drawer=current()?.artifacts?.[Number(target.dataset.artifact)];drawerTab='output';render();app.querySelector('.drawer button')?.focus();return;}
    if(target.dataset.tab){drawerTab=target.dataset.tab;render();app.querySelector(`[data-tab="${drawerTab}"]`)?.focus();return;}
    if(target.dataset.viewMedia){const src=safePreviewUrl(target.dataset.viewMedia);if(!src)return;captureInlineValues();returnFocus=target;returnSelector=`[data-view-media="${CSS.escape(target.dataset.viewMedia)}"]`;viewer={src,alt:target.dataset.viewAlt || ''};render();app.querySelector('.viewer-close')?.focus();return;}
    if(target.dataset.sbPanel!==undefined){panelAction('select', target.dataset.sbPanel);return;}
    if(target.dataset.sbAction){panelAction(target.dataset.sbAction);return;}
    if(target.dataset.mrAction){mediaPanelAction(target.dataset.mrAction, target.dataset.mrKey);return;}
    if(target.dataset.flagAccept||target.dataset.flagUndo){flagAction(target.dataset.flagAccept || target.dataset.flagUndo, Boolean(target.dataset.flagAccept));return;}
    if(target.dataset.reviewAction){void reviewAction(target.dataset.reviewAction, target.dataset.ref);return;}
    if(target.dataset.recipeSave){const project=current();if(project)void submitRecipe(project, target.dataset.recipeSave);return;}
    if(target.dataset.workspaceAction){workspaceAction(target.dataset.workspaceAction);return;}
    if(target.dataset.reportDownload){void saveReport(target.dataset.reportDownload);return;}
    switch(target.dataset.action){
      case'refresh':await refresh();break;
      case'close':close();break;
      case'new':openInline(newJobDraft());break;
      case'brand':{const brand=(data.brands || []).find(item=>!brandReady(item));openInline(onboardDraft(brand || null));break;}
      case'compose':{const box=app.querySelector('#starter-text,#new-text')||app.querySelector('#pipeline-composer');const still=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;if(box){box.scrollIntoView({behavior:still?'auto':'smooth',block:'center'});box.focus({preventScroll:true});}break;}
      case'connectors':connectorsView=true;render();globalThis.scrollTo?.(0,0);break;
      case'connectors-close':connectorsView=false;render();break;
      case'connectors-continue':await continueConnectors();break;
      case'signal':try{const result=await transport?.signal?.('Notify Claude');notify(result?.message || 'The board could not notify Claude.');render();}catch(e){notify(e.message);}break;
      case'not-right':{const shown=current();if(!shown)break;try{const result=await transport?.signal?.(notRightMessage(shown));if(result?.status==='sent'){planNotes.set(shown.jobId,{key:`${shown.kind}|${shown.kindReason}`,sent:true});try{await transport?.markPlanNote?.(shown);}catch{/* The note still shows for this visit. */}}notify(result?.status==='sent'?'Claude has been told. Watch the Inbox for its question.':(result?.message || 'The board could not notify Claude.'));render();}catch(e){notify(e.message);}break;}
      case'remind':await remindRequest(target.dataset.requestId);break;
      case'source':
        { const p=current(); const jobLabel=p?.title || 'this job'; const brandLabel=p?.brandName || 'the selected brand'; try { const result=await transport?.signal?.(`Please select the local source files for ${jobLabel} for ${brandLabel} in Claude. The board does not accept local paths.`); notify(result?.message || 'Ask Claude in chat to select the local source files for this job.'); render(); } catch(e) { notify(e.message); } }
        break;
    }
  });
  // Patch one field's live error state directly in the DOM (no full render,
  // so focus and scroll position are undisturbed) and keep inline.fieldErrors
  // in sync so a later render() does not resurrect a message the person
  // already fixed.
  function fieldErrorId(name) { return name === 'name' ? 'field-name-error' : `channel-${name}-error`; }
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
      updateFieldErrorUI('name', String(field.value || '').trim() ? null : 'Enter a brand name.');
      return;
    }
    if (!CHANNEL_NAMES.includes(field.name)) return;
    const normalized = normalizeChannelInput(field.name, field.value);
    if (normalized !== field.value) field.value = normalized;
    updateFieldErrorUI(field.name, channelFieldError(field.name, field.value, field.disabled));
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
          // The kickoff save (channels and whatever was already known): keep this
          // same card open through research instead of closing it, so its button
          // and notice can move through Researching... to Save and continue.
          // Capture the brand's slug (a brand-new draft had none yet) so the
          // eventual finishing save updates this same brand, and clear this
          // request's own bookkeeping so the pending notice steps aside for the
          // research-phase one.
          active.brand = result.brand?.slug || active.brand;
          active.researchRequested = true;
          active.edited = {};
          active.unlocked = {};
          active.submitted = false;
          active.needsReconciliation = false;
          active.requestId = null;
          active.message = '';
          active.submittedAt = null;
          active.lastReminderAt = null;
          active.reminding = false;
          active.operation = null;
          active.args = null;
          notify(acknowledgement.message || receipt.message || result.message || 'Saved. Claude is researching this brand.');
          void refresh();
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
        active.message = acknowledgement.message || receipt.message || 'Declined in chat. Nothing was changed.';
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
        active.error = acknowledgement.message || receipt.message || receipt.error || result.message || 'Claude could not reconcile this request. Review the form and try again.';
        active.message = active.needsReconciliation ? 'Claude needs to check this request before it can be retried.' : '';
        active.submittedAt = null;
        active.lastReminderAt = null;
        active.reminding = false;
        if (isCurrent) render();
      } else {
        active.submitted = true;
        active.submittedAt ||= Date.now();
        scheduleReminderWake(active);
        active.message = acknowledgement.message || receipt.message || result.message || 'Request saved. Claude will validate it and update this board.';
        if (isCurrent) render();
      }
    }, error => {
      const isCurrent = inline === active;
      if (!isCurrent && inlineDrafts.get(draftKey(active)) !== active) return;
      active.busy = false;
      active.submitted = true;
      active.submittedAt ||= Date.now();
      scheduleReminderWake(active);
      active.message = 'Request saved. Receipt updates are unavailable until Claude reconnects.';
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
  async function submitInline(event) {
    event.preventDefault();
    const active = inline;
    const values = Object.fromEntries(new FormData(event.target));
    event.target.querySelectorAll('input[type="checkbox"]').forEach(field => { values[field.name] = field.checked; });
    if (active?.kind === 'onboard') {
      for (const name of CHANNEL_NAMES) values[name] = normalizeChannelInput(name, values[name]);
    }
    if (!active || active.busy) return;
    if (active.needsReconciliation) { active.error = 'Claude needs to check this request before another save is allowed.'; render(); return; }
    const currentBrand = active.kind === 'onboard' && active.brand ? (data.brands || []).find(item => item.slug === active.brand) : null;
    const researchPhase = active.kind === 'onboard' ? brandResearchPhase(currentBrand, active) : null;
    if (researchPhase === 'running') { active.error = 'Claude is still researching this brand.'; render(); return; }
    if (active.kind === 'onboard') {
      const fieldErrors = validateProfile(values, active.prefilled, active.unlocked);
      if (Object.keys(fieldErrors).length) { active.values = values; active.fieldErrors = fieldErrors; active.error = 'Fix the highlighted fields before saving.'; render(); return; }
      active.fieldErrors = null;
      // A submit while the phase is already complete or failed is the finishing
      // save (see watchRequest's applied branch): once that one is applied, the
      // card closes and the board moves on, rather than staying open for a
      // research pass that already ran its course.
      active.finalizingOnboarding = researchPhase === 'complete' || researchPhase === 'failed';
      const kitErrors = validateKit(active.kit || {});
      if (Object.keys(kitErrors).length) { active.values = values; active.kitErrors = kitErrors; active.error = 'Fix the highlighted fields before saving.'; render(); return; }
      active.kitErrors = null;
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
    const operation = active.kind === 'onboard' ? 'onboard_brand' : 'create_job';
    const kitArgs = active.kind === 'onboard'
      ? (active.finalizingOnboarding ? { kit: kitPayload(currentBrand, active.kit || {}) } : { start: true, ...kitKickoffArgs(active.kit || {}) })
      : {};
    const args = active.kind === 'onboard'
      ? {requestId, name:String(values.name).trim(), ...(active.brand ? {brand:active.brand} : {}), profile:buildProfile(values, active.prefilled, active.unlocked), ...kitArgs}
      : newJobArgs(values, { brands: data.brands || [], requestId }).args;
    active.operation = operation; active.args = args;
    active.values = values; active.pendingName = values.name; active.busy = true; active.error = ''; active.declined = false; render();
    try {
      if (active.kind !== 'onboard' && active.refs?.items?.length) args.references = await encodeNewRefs(active.refs);
      const result = await transport.call(operation, args);
      active.busy = false;
      if (result?.status && result.status !== 'applied' && !result.brand && !result.jobId) {
        active.submitted = result.status === 'requested';
        active.signal = result.signal || null;
        if (active.submitted) { active.submittedAt ||= Date.now(); scheduleReminderWake(active); }
        active.message = result.message || (result.status === 'requested'
          ? 'Request saved. Claude will validate it and update this board.'
          : result.status === 'declined'
            ? 'Declined in chat. Nothing was changed.'
            : 'Claude needs attention before this request can be applied.');
        if (result.status === 'requested') watchRequest(active);
        else if (result.status === 'declined') {
          // Final, non-error state: leave the form open with a clean slate
          // (fresh request id on the next submit) instead of an error state.
          active.needsReconciliation = false;
          active.error = '';
          active.declined = true;
          active.requestId = null;
        } else { active.needsReconciliation = true; active.error = 'Claude needs to check this request before another save is allowed.'; }
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
      state.error = errors.form ? '' : 'Fix the highlighted answers before saving.';
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
  async function submitDecision(project, verdict) {
    const state = uiFor(project).review;
    if (!transport || state.busy || state.submitted || state.needsReconciliation) return;
    const comment = app.querySelector('#review-comment')?.value ?? state.comment ?? '';
    state.comment = comment;
    const requestId = state.requestId || randomId(globalThis);
    const { args, error } = decisionArgs({ project, doc: docFor(project), verdict, choice: state.choice, comment, requestId, recipeState: uiFor(project).recipe, panels: state.panels || {}, accepted: state.accepted || {} });
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
      Object.assign(state, { busy: false, requestId: null, error: e.message });
      render();
    }
  }
  async function submitRecipe(project, deliverableId) {
    const ui = uiFor(project);
    const status = (ui.recipeStatus[deliverableId] ||= {});
    if (!transport || status.busy || status.submitted) return;
    if (!recipeReady(ui.recipe, deliverableId)) { status.error = 'Choose the content pillar, angle, hook, call to action and hashtags before saving.'; render(); return; }
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
    if (route === plan.route || (plan.routes || []).some(item => item.id === route && item.available === false)) { render(); return; }
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
  let onboardChat = null;
  const narrowScreen = () => Boolean(globalThis.matchMedia?.('(max-width: 960px)')?.matches);
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
  function openChat(id) {
    const project = current();
    if (!project) { onboardChat = id; render(); focusQuietly('#ab-chat-title'); return; }
    const box = agentBoxState(project);
    if (box.chat) box.drafts[box.chat] = box.draft;
    Object.assign(box, { chat: id, to: id, draft: box.drafts[id] || '', error: '' });
    render();
    focusQuietly('#ab-chat-title');
  }
  function closeChat({ focus = true } = {}) {
    const project = current();
    let was = null;
    if (project) {
      const box = agentBoxState(project);
      was = box.chat;
      if (was) box.drafts[was] = box.draft;
      Object.assign(box, { chat: null, draft: '', error: '' });
    } else { was = onboardChat; onboardChat = null; }
    render();
    if (focus && was) focusQuietly(`[data-ab-open="${CSS.escape(was)}"]`);
  }
  // On a narrow screen the open chat covers the whole page, so it closes before a jump to something in the centre.
  function leaveChatForJump() {
    const project = current();
    if (project && agentBoxState(project).chat && narrowScreen()) closeChat({ focus: false });
  }
  // Request change and Open details both go to the step's decision section, unfolded.
  function jumpToGate(gate) {
    const selector = `[data-gate="${CSS.escape(String(gate))}"]`;
    const section = app.querySelector(selector);
    if (!section) { jumpTo(JUMP_TARGETS.review); return; }
    const fold = section.querySelector('details.gate');
    if (fold && !fold.open) { fold.open = true; if (fold.dataset.openKey) openKeys.add(fold.dataset.openKey); }
    jumpTo(selector);
  }
  const AGENT_SEND_FAILED = 'Your message was not saved. Try again.';
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
    const args = agentMessageArgs({ project, agent: agent.id, text: box.draft, requestId });
    Object.assign(state, { requestId, sentRequestId: requestId, busy: true, submitted: false, needsReconciliation: false, declined: false, error: '', message: 'Saved. Claude picks this up and passes it on.', operation: 'agent_message', args });
    render();
    focusQuietly('#ab-text');
    try {
      const result = await transport.call('agent_message', args);
      if (state.requestId !== requestId) return;
      box.draft = '';
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
    Object.assign(state, { requestId, sentRequestId: requestId, busy: true, submitted: false, needsReconciliation: false, declined: false, applied: false, sinceSeen: stuck.since, error: '', message: 'Saved. Claude will try that step again.', operation: 'retry_step', args });
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
      Object.assign(state, { busy: false, requestId: null, operation: null, args: null, error: 'Could not ask Claude to try again. Try once more.' });
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
      if (!note) { state.panelError = 'Say what should change in this panel.'; render(); focusQuietly('#sb-note'); return; }
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
      if (!note) { state.mediaError = 'Say what should change.'; render(); focusQuietly('#mr-note'); return; }
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
    if (intakeEdit(field)) return;
    if (inline?.kind === 'onboard' && field.closest?.('#inline-form')) {
      markContextEdited(inline, field.name);
      const limit = CONTEXT_LIMITS.text[field.name];
      const counter = limit ? document.getElementById(`context-${field.name}-count`) : null;
      if (counter) {
        const length = contextTextLength(field.value);
        counter.textContent = `${length} / ${limit}`;
        counter.classList.toggle('over', length > limit);
      }
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
    if (field.id === 'review-comment') { uiFor(project).review.comment = field.value; return; }
    if (field.id === 'sb-note') { uiFor(project).review.panelDraft = field.value; return; }
    if (field.id === 'mr-note') { uiFor(project).review.mediaDraft = field.value; return; }
    const recipeName = recipeFieldFromName(field.name);
    if (recipeName?.own) recipeFieldState(uiFor(project).recipe, recipeName.deliverableId, recipeName.field).own[recipeName.subkey] = field.value;
  });
  app.addEventListener('keydown', event => {
    const field = event.target;
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
      updateFieldErrorUI(name, channelFieldError(name, field.value, false));
    }
  });
  app.addEventListener('change', event => {
    const field = event.target;
    const name = field.name || '';
    if (name === 'kit_logo_file') { void handleLogoFile(field.files?.[0] || null); return; }
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
    if(event.key==='Escape'&&(drawer||viewer)){close();return;}
    if(event.key==='Tab'&&(drawer||viewer)){const box=app.querySelector(viewer?'.viewer':'.drawer');const controls=[...box.querySelectorAll('button:not(:disabled),input,select,textarea,a[href],video[controls]')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  app.addEventListener('toggle', event => {
    const key = event.target?.dataset?.openKey;
    if (!key) return;
    if (event.target.open) openKeys.add(key); else openKeys.delete(key);
  }, true);
  addEventListener('hashchange',()=>{drawer=null;viewer=null;connectorsView=false;render();});
  void refresh();
}
