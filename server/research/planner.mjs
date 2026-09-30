/**
 * The Research Planner, as a pure function (spec section 12).
 *
 * planResearch answers three questions before any specialist is spawned:
 *
 *   what do we know?      known
 *   what is stale?        stale, per record, against a per family time to live
 *   what is missing?      missing
 *
 * and turns the answers into an ordered list of specialists to run, each with the
 * questions it must answer and the platforms in scope, plus the specialists it
 * decided not to run and why. It never touches a clock it was not handed, a database
 * or the network, so the same inputs always give the same plan.
 */

/** Days a record stays fresh, per family (spec sections 12 and 19). */
export const STALENESS_DAYS = Object.freeze({
  brand: 90,
  competitor: 30,
  trends: 7,
  audience: 60,
});

/** The specialists this planner can schedule, in the order they run. */
export const RESEARCH_AGENTS = ['brand-researcher', 'competitor-researcher', 'trend-scout', 'audience-researcher', 'platform-analyst'];

const PLATFORMS = ['facebook', 'instagram', 'tiktok'];

/** Brand field paths that belong to the audience family rather than the brand family. */
const AUDIENCE_FIELD = /^audience\./;

/**
 * Fields the user typed into the onboarding form. They are seeds for research, not
 * the result of it, so they never make the brand family count as known.
 */
const SEED_FIELD = /^(identity\.website|identity\.files|social\.)/;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {unknown} value
 * @returns {number|null} epoch ms, or null when unparseable.
 */
function epoch(value) {
  if (!value) return null;
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * @param {unknown} timestamp
 * @param {number} ttlDays
 * @param {number} nowMs
 * @returns {boolean}
 */
function older(timestamp, ttlDays, nowMs) {
  const time = epoch(timestamp);
  if (time === null) return true;
  return nowMs - time > ttlDays * DAY_MS;
}

/**
 * Summarise one family of records as known / stale / missing.
 * @param {Array<{verified_at: unknown}>} records
 * @param {number} ttlDays
 * @param {number} nowMs
 * @returns {{state: 'missing'|'stale'|'fresh', count: number, stale_count: number, newest: string|null}}
 */
function familyState(records, ttlDays, nowMs) {
  if (records.length === 0) return { state: 'missing', count: 0, stale_count: 0, newest: null };
  const staleCount = records.filter((record) => older(record.verified_at, ttlDays, nowMs)).length;
  const newest = records
    .map((record) => epoch(record.verified_at))
    .filter((time) => time !== null)
    .sort((a, b) => b - a)[0];
  return {
    state: staleCount === records.length ? 'stale' : 'fresh',
    count: records.length,
    stale_count: staleCount,
    newest: newest === undefined ? null : new Date(newest).toISOString(),
  };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizePlatforms(value) {
  const list = (Array.isArray(value) ? value : []).map((entry) => String(entry).toLowerCase());
  const kept = PLATFORMS.filter((platform) => list.includes(platform));
  return kept.length > 0 ? kept : PLATFORMS.slice();
}

/**
 * Was this specialist explicitly asked for, whatever the memory says?
 * @param {string} agent
 * @param {Record<string, unknown>} preferences
 * @returns {boolean}
 */
function requested(agent, preferences) {
  if (preferences.request_research === true) return true;
  const list = Array.isArray(preferences.requested_agents) ? preferences.requested_agents.map(String) : [];
  return list.includes(agent);
}

/**
 * @param {string} agent
 * @param {Record<string, unknown>} preferences
 * @returns {boolean}
 */
function declined(agent, preferences) {
  const list = Array.isArray(preferences.skip_agents) ? preferences.skip_agents.map(String) : [];
  return list.includes(agent);
}

/**
 * The questions each specialist has to answer for this job.
 * @param {string} agent
 * @param {{jobType: string, startingPoint: string, platforms: string[], reference: any}} context
 * @returns {string[]}
 */
function questionsFor(agent, context) {
  const { jobType, startingPoint, platforms, reference } = context;
  const isAd = jobType === 'ad_campaign';
  const where = platforms.join(', ');
  switch (agent) {
    case 'brand-researcher':
      return [
        'What does the brand sell, to whom, and how does it position itself?',
        'How does the brand sound: tone, vocabulary, recurring phrases?',
        'What does the brand look like: palette, typography, imagery style?',
        'What is the brand not allowed to say or show, and which claims need qualification?',
        `Which official social profiles exist on ${where}, and what do they say about the brand?`,
      ];
    case 'competitor-researcher': {
      const questions = [
        `Who are the two to five competitors that matter for this brand on ${where}?`,
        'What formats, hooks and messaging does each competitor rely on organically, separated by platform?',
        'Which openings is nobody in the set taking?',
      ];
      if (startingPoint === 'reference' && reference) {
        questions.unshift(
          `Resolve the supplied reference${reference.url ? ` (${reference.url})` : ''}: who made it, what it does, and why it works.`,
        );
      }
      if (isAd) {
        questions.push(
          'What paid creative is each competitor running: formats, hooks and messaging?',
          'What offers and CTA language do their ads use?',
          'What funnel stage and landing page positioning do the ads point at?',
        );
      }
      return questions;
    }
    case 'trend-scout':
      return [
        `Which creative patterns are working right now on ${where}: formats, hooks, editing styles, audio?`,
        'For each pattern, what is the mechanism that makes it work, and how long is it likely to last?',
        'Which of these can this brand credibly use, and which are a poor fit?',
      ];
    case 'audience-researcher': {
      const questions = [
        'Who is the audience, in segments, and what problems and motivations drive each one?',
        'What objections do they raise, and what language do they actually use?',
        `What content do they respond to on ${where}?`,
      ];
      if (isAd) questions.push('What funnel stage is each segment at, and how should the problem be framed for it?');
      return questions;
    }
    case 'platform-analyst':
      return [
        `For each of ${where}: which native format, aspect ratio and duration fit this job?`,
        'What hook window, caption length and hashtag count does each platform expect?',
        'What has to differ per platform so nothing is just resized?',
      ];
    default:
      return [];
  }
}

/**
 * Plan the research for a job.
 *
 * @param {object} input
 * @param {string} input.job_type social_post, ad_campaign, ugc or analyze_existing.
 * @param {string} input.starting_point scratch, reference or existing_creative.
 * @param {string[]} [input.platforms] facebook, instagram, tiktok.
 * @param {{fields?: Array<{field_path: string, last_verified_at?: string|null, observed_at?: string|null}>, creative_profile?: unknown}|null} [input.brand_context]
 *   what brand memory holds today. Fields under `audience.` count towards the audience family.
 * @param {Array<{name?: string, analyses?: Array<{created_at?: string, verified_at?: string}>, last_verified_at?: string}>} [input.competitor_records]
 * @param {Array<{observed_at?: string, last_verified_at?: string}>} [input.trend_records]
 * @param {Record<string, unknown>} [input.preferences] `request_research`, `requested_agents[]`, `skip_agents[]`.
 * @param {Partial<typeof STALENESS_DAYS>} [input.staleness_days] overrides for the time to live per family.
 * @param {{kind?: string, url?: string|null}|null} [input.reference]
 * @param {string|Date} [input.now] the moment to measure staleness from. Defaults to the epoch of the call.
 * @returns {object} a ResearchPlan
 */
export function planResearch(input) {
  const jobType = String(input.job_type ?? 'social_post');
  const startingPoint = String(input.starting_point ?? 'scratch');
  const platforms = normalizePlatforms(input.platforms);
  const preferences = input.preferences && typeof input.preferences === 'object' ? input.preferences : {};
  const ttl = { ...STALENESS_DAYS, ...(input.staleness_days ?? {}) };
  const nowMs = input.now ? new Date(input.now).getTime() : Date.now();
  const reference = input.reference && typeof input.reference === 'object' ? input.reference : null;

  const brandFields = Array.isArray(input.brand_context?.fields) ? input.brand_context.fields : [];
  const brandRecords = brandFields
    .filter((field) => {
      const path = String(field.field_path ?? '');
      return !AUDIENCE_FIELD.test(path) && !SEED_FIELD.test(path);
    })
    .map((field) => ({ verified_at: field.last_verified_at ?? field.observed_at ?? null }));
  const audienceRecords = brandFields
    .filter((field) => AUDIENCE_FIELD.test(String(field.field_path ?? '')))
    .map((field) => ({ verified_at: field.last_verified_at ?? field.observed_at ?? null }));
  const competitorRecords = (Array.isArray(input.competitor_records) ? input.competitor_records : []).map((record) => {
    const analyses = Array.isArray(record.analyses) ? record.analyses : [];
    const newest = analyses
      .map((analysis) => epoch(analysis.verified_at ?? analysis.created_at))
      .filter((time) => time !== null)
      .sort((a, b) => b - a)[0];
    return { verified_at: record.last_verified_at ?? (newest === undefined ? null : new Date(newest).toISOString()) };
  });
  const trendRecords = (Array.isArray(input.trend_records) ? input.trend_records : []).map((record) => ({
    verified_at: record.last_verified_at ?? record.observed_at ?? null,
  }));

  const families = {
    brand: familyState(brandRecords, ttl.brand, nowMs),
    competitor: familyState(competitorRecords, ttl.competitor, nowMs),
    trends: familyState(trendRecords, ttl.trends, nowMs),
    audience: familyState(audienceRecords, ttl.audience, nowMs),
  };

  const isAd = jobType === 'ad_campaign';
  const finishedCreative = startingPoint === 'existing_creative';
  const analyzeOnly = jobType === 'analyze_existing';
  const context = { jobType, startingPoint, platforms, reference };

  /** @type {Array<{agent: string, family: string|null, reason: string, questions: string[], platforms: string[], because: 'missing'|'stale'|'required'|'requested'}>} */
  const specialists = [];
  /** @type {Array<{agent: string, reason: string}>} */
  const skipped = [];

  /**
   * @param {string} agent
   * @param {string|null} family
   * @param {{always?: string|null, skipWhen?: string|null}} rule
   */
  const decide = (agent, family, rule) => {
    if (declined(agent, preferences)) {
      skipped.push({ agent, reason: 'You asked to leave this out.' });
      return;
    }
    if (requested(agent, preferences)) {
      specialists.push({ agent, family, reason: 'You asked for this research.', questions: questionsFor(agent, context), platforms, because: 'requested' });
      return;
    }
    if (finishedCreative || analyzeOnly) {
      skipped.push({
        agent,
        reason: analyzeOnly
          ? 'This job only analyzes existing content.'
          : 'You already have the finished creative, so this was not needed.',
      });
      return;
    }
    if (rule.skipWhen) {
      skipped.push({ agent, reason: rule.skipWhen });
      return;
    }
    if (rule.always) {
      specialists.push({ agent, family, reason: rule.always, questions: questionsFor(agent, context), platforms, because: 'required' });
      return;
    }
    const state = family ? families[family] : null;
    if (!state || state.state === 'missing') {
      specialists.push({
        agent,
        family,
        reason: family ? `Nothing is known about the ${familyLabel(family)} yet.` : 'Nothing is known yet.',
        questions: questionsFor(agent, context),
        platforms,
        because: 'missing',
      });
      return;
    }
    if (state.state === 'stale') {
      specialists.push({
        agent,
        family,
        reason: `What is known about the ${familyLabel(family)} is older than ${ttl[family]} days.`,
        questions: questionsFor(agent, context),
        platforms,
        because: 'stale',
      });
      return;
    }
    skipped.push({
      agent,
      reason: `The ${familyLabel(family)} was checked within the last ${ttl[family]} days${state.stale_count > 0 ? ', apart from a few older details' : ''}.`,
    });
  };

  decide('brand-researcher', 'brand', {});
  decide('competitor-researcher', 'competitor', {
    always: isAd
      ? 'An ad campaign always looks at competitor paid creative, offers, CTAs and funnel.'
      : startingPoint === 'reference'
        ? 'The supplied reference has to be resolved and placed among its competitors.'
        : null,
  });
  decide('trend-scout', 'trends', {
    skipWhen: isAd && startingPoint !== 'reference' ? 'An ad campaign is grounded in paid creative and audience research rather than organic trends.' : null,
  });
  decide('audience-researcher', 'audience', {
    always: isAd ? 'An ad campaign always needs audience, problem framing and funnel stage.' : null,
  });
  decide('platform-analyst', null, {
    skipWhen: 'Platform execution is planned after the strategy is approved, in the creative step.',
  });

  return {
    schema_version: 1,
    campaign_id: null,
    job_type: jobType,
    starting_point: startingPoint,
    platforms,
    known: Object.fromEntries(Object.entries(families).map(([family, state]) => [family, state.state !== 'missing'])),
    stale: Object.fromEntries(Object.entries(families).map(([family, state]) => [family, state.state === 'stale'])),
    missing: Object.entries(families)
      .filter(([, state]) => state.state === 'missing')
      .map(([family]) => family),
    families,
    staleness_days: ttl,
    specialists,
    skipped,
    summary: summarize(specialists, skipped),
  };
}

/**
 * @param {string} family
 * @returns {string}
 */
function familyLabel(family) {
  return { brand: 'brand', competitor: 'competitors', trends: 'current trends', audience: 'audience' }[family] ?? family;
}

/**
 * @param {Array<{agent: string}>} specialists
 * @param {Array<{agent: string}>} skipped
 * @returns {string}
 */
function summarize(specialists, skipped) {
  const labels = {
    'brand-researcher': 'the brand',
    'competitor-researcher': 'competitors',
    'trend-scout': 'current trends',
    'audience-researcher': 'the audience',
    'platform-analyst': 'platform execution',
  };
  if (specialists.length === 0) return 'Nothing needs researching for this job.';
  const names = specialists.map((entry) => labels[entry.agent] ?? entry.agent);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const rest = skipped.length > 0 ? ` ${skipped.length} other area${skipped.length === 1 ? ' is' : 's are'} already covered or not needed.` : '';
  return `Social Campaign will look at ${list}.${rest}`;
}
