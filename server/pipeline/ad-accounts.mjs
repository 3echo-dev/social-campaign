/**
 * The Meta ads and TikTok ads connections (read-only) and which ad account each plugin brand uses.
 *
 * What the connector told us lives in integrations.json under providers.meta_ads / providers.tiktok_ads
 * (state, namespace and last_probe come from integration_probe; accounts from pipeline_ad_accounts_save).
 * The choice per plugin brand lives in that brand's profile as `adAccounts[provider]`, written without a
 * revision bump, like `publishing` in metricool.mjs. Nothing here calls Meta or TikTok: the running Claude
 * session reads the account list with the connector's read-only tool and hands the result in.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { InvalidInputError } from '../lib/errors.mjs';
import { integrationsPath } from '../lib/paths.mjs';
import { readJsonFile, updateJsonFile } from '../lib/json.mjs';
import { plainLabel, resolveBrand } from './metricool.mjs';
import { askQuestion, listQuestions, withdrawQuestion, QUESTION_OPTION_LIMIT, OPTION_TEXT_LIMIT, plainWordsProblem } from './questions.mjs';
import * as runtime from './runtime.mjs';
import { renameReplacing } from '../lib/rename.mjs';

const require = createRequire(import.meta.url);
const brandProfile = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-brand-profile.js'));
const durable = require(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-durable.js'));

export const AD_PROVIDERS = Object.freeze(['meta_ads', 'tiktok_ads']);
export const AD_ACCOUNT_LIMIT = 50;
/** Every Inbox question this module asks starts with one of these, which is how its answer is found again. */
export const AD_QUESTION_PREFIX = Object.freeze({
  meta_ads: 'Which Meta ad account belongs to',
  tiktok_ads: 'Which TikTok ad account belongs to',
});
const PROVIDER_NAME = Object.freeze({ meta_ads: 'Meta', tiktok_ads: 'TikTok' });

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const NAME_LIMIT = 120;

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function text(value, limit) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

function checkProvider(provider) {
  if (!AD_PROVIDERS.includes(provider)) throw new Error(`Use one of ${AD_PROVIDERS.join(', ')}.`);
  return provider;
}

/** What a person is told when a connector result has no usable accounts. */
const ACCOUNT_SHAPES_FIX =
  'Pass the connector result as it came back. Meta ads (ads_get_ad_accounts) entries carry ad_account_id, ad_account_name, currency and business_name; TikTok ads (auth_advertiser_get) entries carry advertiser_id and advertiser_name.';

/**
 * The id as text, or null. A number is only trusted while it is an exact integer: TikTok advertiser ids have 19
 * digits, which a JSON number cannot hold, so a rounded one must never be saved as if it were the real id.
 */
function idText(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : null;
  return text(value, 40);
}

/** Meta spells its account ids "act_123" in some results and "123" in others; one spelling is stored so both match. */
function canonicalId(provider, id) {
  if (provider !== 'meta_ads') return id;
  const digits = /^(?:act_)?(\d{1,38})$/i.exec(id);
  return digits ? `act_${digits[1]}` : id;
}

/** A name that is only a number ("act_123456", "Ad account act_123456", the id itself) tells a person nothing. */
function bareName(name, id) {
  if (!name) return true;
  const compact = name.replace(/\s+/g, ' ').trim().toLowerCase();
  return compact === id.toLowerCase() || /^(?:ad account )?(?:act_)?\d+$/.test(compact);
}

/** What an account with no real name is called: its business when the connector gave one, and the end of its number. */
function readableName(id, business) {
  const digits = id.replace(/\D/g, '');
  const tail = (digits || id).slice(-4);
  return (business ? business + ' ad account' : 'Ad account') + ' ending ' + tail;
}

/**
 * One account as Meta's connector (ad_account_id "act_123", ad_account_name, currency, business_name, timezone_name),
 * TikTok's (advertiser_id, advertiser_name), the older Meta shape (id, name) or this module returned it.
 * An account the connector gave no name, or only its number as a name, is called "<business> ad account ending 1913".
 */
function cleanAccount(entry, provider = null) {
  if (!plain(entry)) return null;
  const raw = idText(entry.id ?? entry.ad_account_id ?? entry.account_id ?? entry.advertiser_id);
  if (!raw || !ACCOUNT_ID.test(raw)) return null;
  const id = canonicalId(provider, raw);
  const business = text(entry.business_name ?? entry.business, NAME_LIMIT);
  const given = text(entry.name ?? entry.ad_account_name ?? entry.advertiser_name ?? entry.account_name, NAME_LIMIT);
  const account = {
    id,
    name: bareName(given, id) ? readableName(id, business) : given,
    currency: text(entry.currency ?? entry.account_currency, 10),
    timezone: text(entry.timezone ?? entry.timezone_name ?? entry.timezone_display, 60),
  };
  if (business) account.business = business;
  return account;
}

const LIST_KEYS = ['data', 'ad_accounts', 'adAccounts', 'accounts', 'list', 'advertisers', 'items', 'result', 'results'];

function listOf(input, depth = 0) {
  if (Array.isArray(input)) return input;
  if (!plain(input) || depth > 3) return null;
  for (const key of LIST_KEYS) {
    const value = input[key];
    if (Array.isArray(value)) return value;
    // TikTok: { data: { list: [...] } }.
    if (plain(value)) { const inner = listOf(value, depth + 1); if (inner) return inner; }
  }
  return null;
}

/**
 * The accounts list the way it is stored: `[{id, name, currency, timezone}]`. Accepts the connector's result whole
 * (`{data:[...]}`, `{ad_accounts:[...]}`, `{data:{list:[...]}}`, or the same as JSON text), the list, or an already
 * normalised list, with the connector's own field names. An entry without a usable id is dropped; a repeated id keeps
 * its first entry. A result that cannot be used throws an `invalid_input` error that says which shapes are accepted.
 * @param {unknown} input
 * @param {string|null} [provider] meta_ads or tiktok_ads; Meta ids are stored as act_<digits>.
 */
export function normalizeAdAccounts(input, provider = null) {
  let value = input;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  const list = listOf(value);
  if (!list) throw new InvalidInputError('This is not a list of ad accounts.', { fix: ACCOUNT_SHAPES_FIX });
  if (list.length > AD_ACCOUNT_LIMIT) {
    throw new InvalidInputError(`The connector returned more than ${AD_ACCOUNT_LIMIT} ad accounts, which is more than this can hold.`, { fix: 'Save at most 50 accounts.' });
  }
  const seen = new Set();
  const accounts = [];
  for (const entry of list) {
    const account = cleanAccount(entry, provider);
    if (!account || seen.has(account.id)) continue;
    seen.add(account.id);
    accounts.push(account);
  }
  if (list.length && !accounts.length) {
    throw new InvalidInputError('None of these accounts has an id, so none could be saved.', { fix: ACCOUNT_SHAPES_FIX });
  }
  return accounts;
}

function providersOf(file) {
  return plain(file) && plain(file.providers) ? file.providers : {};
}

export function readAdRecord(root, provider) {
  const record = providersOf(readJsonFile(integrationsPath(root), {}))[checkProvider(provider)];
  return plain(record) ? record : null;
}

export function readAdAccounts(root, provider) {
  const record = readAdRecord(root, provider);
  if (!record || !Array.isArray(record.accounts)) return [];
  return record.accounts.map(entry => cleanAccount(entry, provider)).filter(Boolean);
}

export function adConnected(root, provider) {
  return readAdRecord(root, provider)?.state === 'connected';
}

/** Store the accounts under providers.<provider>, keeping the rest of the record (state, namespace, last_probe) as it is. */
export function saveAdAccounts(root, provider, input) {
  checkProvider(provider);
  const accounts = normalizeAdAccounts(input, provider);
  updateJsonFile(
    integrationsPath(root),
    (current) => {
      const base = plain(current) ? current : {};
      const providers = { ...providersOf(base) };
      const previous = plain(providers[provider]) ? providers[provider] : {};
      providers[provider] = { ...previous, accounts, accounts_updated_at: new Date().toISOString() };
      return { ...base, providers };
    },
    { providers: {} },
  );
  return accounts;
}

// ---------------------------------------------------------------------------
// The choice per plugin brand
// ---------------------------------------------------------------------------

function profileFile(brandDir) {
  return join(brandDir, 'brand', 'profile.json');
}

const NOT_READY = 'Finish this brand\'s profile before choosing its ad account.';

/** The two answers to the question that are not an account. */
export const AD_NONE_OPTION = Object.freeze({ meta_ads: 'No Meta ad account yet', tiktok_ads: 'No TikTok ad account yet' });
export const AD_LATER_OPTION = 'Not sure, decide later';
/** The Inbox offers at most QUESTION_OPTION_LIMIT buttons; two of them are the answers above. */
export const AD_ACCOUNT_BUTTON_LIMIT = QUESTION_OPTION_LIMIT - 2;

function savedEntry(brandDir, provider) {
  const profile = readJsonFile(profileFile(brandDir), null);
  const saved = plain(profile) && plain(profile.adAccounts) ? profile.adAccounts[provider] : null;
  return plain(saved) ? saved : null;
}

/** The account saved for this brand, or null (also null when the brand answered "none yet" or "decide later"). */
export function readBrandAdAccount(brandDir, provider) {
  checkProvider(provider);
  const saved = savedEntry(brandDir, provider);
  if (!saved || saved.none === true || saved.later === true) return null;
  const rawId = text(saved.id, 40);
  if (!rawId) return null;
  const id = canonicalId(provider, rawId);
  const name = text(saved.name, NAME_LIMIT);
  return { provider, id, name: bareName(name, id) ? readableName(id, null) : name, currency: text(saved.currency, 10), chosenAt: text(saved.chosenAt, 40) };
}

/**
 * What this brand has saved for the provider: {kind: 'account', ...}, {kind: 'none', knownIds} (the person said there is
 * no ad account yet; knownIds are the accounts the connector listed then), {kind: 'later'} (the person is not sure yet), or null.
 */
export function readBrandAdChoice(brandDir, provider) {
  checkProvider(provider);
  const saved = savedEntry(brandDir, provider);
  if (!saved) return null;
  if (saved.none === true) {
    const knownIds = Array.isArray(saved.knownIds) ? saved.knownIds.map(value => text(value, 40)).filter(Boolean) : [];
    return { kind: 'none', provider, chosenAt: text(saved.chosenAt, 40), knownIds };
  }
  if (saved.later === true) return { kind: 'later', provider, deferredAt: text(saved.deferredAt, 40) };
  const account = readBrandAdAccount(brandDir, provider);
  return account ? { kind: 'account', ...account } : null;
}

/**
 * Write adAccounts[provider] into the brand profile without touching anything else and without a revision bump.
 * make(existing) returns the new entry, null to remove the entry, or undefined to leave it as it is.
 */
function writeBrandAdEntry(brandDir, provider, make) {
  const file = profileFile(brandDir);
  let record = null;
  durable.update(file, (raw) => {
    let current = null;
    try { current = JSON.parse(raw); } catch { current = null; }
    if (!brandProfile.validRecord(current)) throw new Error(NOT_READY);
    const existing = plain(current.adAccounts) ? current.adAccounts : {};
    const saved = plain(existing[provider]) ? existing[provider] : null;
    const made = make(saved);
    if (made === undefined) { record = saved; return raw; }
    const rest = { ...existing };
    if (made === null) delete rest[provider];
    else rest[provider] = made;
    record = made;
    const next = JSON.stringify({ ...current, adAccounts: rest }, null, 2) + '\n';
    if (Buffer.byteLength(next, 'utf8') > brandProfile.MAX_PROFILE_BYTES) throw new Error('Keep the brand profile under 40 KB.');
    return next;
  });
  return record;
}

function saveBrandAdAccount(brandDir, provider, account) {
  return writeBrandAdEntry(brandDir, provider, (saved) => {
    if (saved && saved.id === account.id && saved.name === account.name && (saved.currency ?? null) === (account.currency ?? null)) return undefined;
    return { id: account.id, name: account.name, currency: account.currency ?? null, chosenAt: new Date().toISOString() };
  });
}

/** The person said there is no ad account yet: remembered with the accounts the connector listed, so only a new one asks again. */
function saveBrandNoAdAccount(brandDir, provider, knownIds) {
  const ids = [...new Set(knownIds)].slice(0, AD_ACCOUNT_LIMIT);
  return writeBrandAdEntry(brandDir, provider, (saved) => {
    if (saved?.none === true && JSON.stringify(saved.knownIds ?? []) === JSON.stringify(ids)) return undefined;
    return { none: true, knownIds: ids, chosenAt: new Date().toISOString() };
  });
}

/** The person is not sure: nothing is asked again until a step that needs the account asks for it. */
function saveBrandLaterAdAccount(brandDir, provider) {
  return writeBrandAdEntry(brandDir, provider, (saved) => (saved?.later === true ? undefined : { later: true, deferredAt: new Date().toISOString() }));
}

function clearBrandAdEntry(brandDir, provider) {
  return writeBrandAdEntry(brandDir, provider, () => null);
}

// ---------------------------------------------------------------------------
// The Inbox question
// ---------------------------------------------------------------------------

/**
 * The answers as Inbox buttons: {text, id} for an account and {text, kind} for "none yet" and "decide later".
 * An account shows its real name, never a bare number: a name more than one account shares gets its currency, else its
 * business, else its time zone, else the end of its number.
 */
export function adQuestionOptions(accounts, provider = 'meta_ads') {
  const base = accounts.map(account => plainLabel(account.name).slice(0, OPTION_TEXT_LIMIT - 30));
  const counts = new Map();
  for (const line of base) counts.set(line.toLowerCase(), (counts.get(line.toLowerCase()) || 0) + 1);
  const used = new Set();
  const list = accounts.map((account, index) => {
    let line = base[index];
    if (counts.get(line.toLowerCase()) > 1) {
      const code = account.currency ? plainLabel(account.currency) : '';
      const business = account.business ? plainLabel(account.business) : '';
      const zone = account.timezone ? plainLabel(account.timezone).split('/').pop() : '';
      const tail = 'ending ' + (account.id.replace(/\D/g, '') || account.id).slice(-4);
      const detail = /^\p{L}{2,5}$/u.test(code) ? code : business || zone || tail;
      line = (line + ' (' + detail + ')').slice(0, OPTION_TEXT_LIMIT);
    }
    let candidate = line;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = line.slice(0, OPTION_TEXT_LIMIT - 5) + ' (' + n + ')';
    used.add(candidate.toLowerCase());
    return { text: candidate, id: account.id };
  });
  return [...list, { text: AD_NONE_OPTION[provider] ?? AD_NONE_OPTION.meta_ads, kind: 'none' }, { text: AD_LATER_OPTION, kind: 'later' }];
}

function questionText(provider, name) {
  const prefix = AD_QUESTION_PREFIX[provider];
  const named = prefix + ' ' + name + '?';
  return plainWordsProblem(named) || named.length > 300 ? prefix + ' this brand?' : named;
}

export function isAdAccountQuestion(question, provider = null) {
  if (!question || typeof question.text !== 'string') return false;
  const prefixes = provider ? [AD_QUESTION_PREFIX[provider]] : Object.values(AD_QUESTION_PREFIX);
  return prefixes.some(prefix => prefix && question.text.startsWith(prefix));
}

function questionFile(root, questionId) {
  return join(root, '.social-pipeline', 'board', 'questions', questionId + '.json');
}

function storedOptions(question) {
  const list = plain(question?.adAccount) && Array.isArray(question.adAccount.options) ? question.adAccount.options : [];
  return list.filter(item => plain(item) && typeof item.text === 'string' && (typeof item.id === 'string' || item.kind === 'none' || item.kind === 'later'));
}

function sameOptions(question, provider, options) {
  return question.adAccount?.provider === provider && JSON.stringify(storedOptions(question)) === JSON.stringify(options);
}

function saveQuestionMeta(root, questionId, patch) {
  const file = questionFile(root, questionId);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  record.adAccount = { ...(plain(record.adAccount) ? record.adAccount : {}), ...patch };
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2));
    renameReplacing(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

function adQuestions(root, provider, status) {
  return listQuestions({ root, status, readOnly: true }).filter(question => isAdAccountQuestion(question, provider));
}

function markAnswersConsumed(root, provider, brandSlug) {
  for (const question of adQuestions(root, provider, 'answered')) {
    if (question.brand === brandSlug && !question.adAccount?.consumed) saveQuestionMeta(root, question.questionId, { provider, consumed: true });
  }
}

function withdrawOpenQuestions(root, provider, brandSlug) {
  for (const question of adQuestions(root, provider, 'open')) {
    if (question.brand === brandSlug) withdrawQuestion({ root, questionId: question.questionId });
  }
}

/** Save "no ad account yet" for a plugin brand, remembering which accounts the connector lists right now. */
function recordNoAccount(root, entry, provider) {
  saveBrandNoAdAccount(entry.path, provider, readAdAccounts(root, provider).map(account => account.id));
}

/**
 * The account the person picked, saved as that plugin brand's own choice for this provider.
 * accountId may also be "none" (there is no ad account yet; not asked again until a new one is listed) or "later"
 * (not sure; asked again only when a step that needs the account asks for it).
 */
export function chooseAdAccount({ root, brand, provider, accountId }) {
  checkProvider(provider);
  const entry = resolveBrand(root, brand);
  if (!brandProfile.read(entry.path)) throw new Error(NOT_READY);
  const given = String(accountId ?? '').trim();
  const base = { brand: entry.slug, brandName: entry.name || entry.slug, provider };
  if (given.toLowerCase() === 'none') {
    recordNoAccount(root, entry, provider);
    withdrawOpenQuestions(root, provider, entry.slug);
    markAnswersConsumed(root, provider, entry.slug);
    return { ...base, accountId: null, none: true };
  }
  if (given.toLowerCase() === 'later') {
    saveBrandLaterAdAccount(entry.path, provider);
    withdrawOpenQuestions(root, provider, entry.slug);
    markAnswersConsumed(root, provider, entry.slug);
    return { ...base, accountId: null, later: true };
  }
  const id = canonicalId(provider, given);
  const match = readAdAccounts(root, provider).find(item => item.id === id);
  if (!match) throw new Error('This is not one of the saved ad accounts.');
  const saved = saveBrandAdAccount(entry.path, provider, match);
  withdrawOpenQuestions(root, provider, entry.slug);
  markAnswersConsumed(root, provider, entry.slug);
  return { ...base, accountId: saved.id, name: saved.name, currency: saved.currency };
}

/**
 * What an answered question picked, read against the options it was asked with: {kind: 'account', account},
 * {kind: 'none'} or {kind: 'later'}. Used answers, and answers older than what the brand has saved since, are ignored.
 */
function answeredPick(root, provider, brandSlug, accounts, saved) {
  const since = saved?.chosenAt || saved?.deferredAt || null;
  for (const question of adQuestions(root, provider, 'answered')) {
    if (question.brand !== brandSlug || question.adAccount?.consumed) continue;
    if (since && String(question.answeredAt || '') < since) continue;
    const given = String(question.answer?.choice ?? question.answer?.text ?? '').trim().toLowerCase();
    const picked = given ? storedOptions(question).find(option => option.text.toLowerCase() === given) : null;
    if (!picked) continue;
    if (picked.kind === 'none' || picked.kind === 'later') return { kind: picked.kind };
    const match = accounts.find(item => item.id === picked.id);
    if (match) return { kind: 'account', account: match };
  }
  return null;
}

/**
 * Give every plugin brand with a finished profile and no working choice for this provider an ad account.
 * A brand that never chose, with exactly one account, gets it at once. A saved choice the connector no longer lists
 * is never replaced silently, even with one account left: it is reported as needsChoice and the Inbox question is
 * asked. Otherwise a saved answer is applied, else the question is asked once, with its options saved on it.
 * The question's last two answers are "no ad account yet" (saved so it is not asked again until the connector lists an
 * account it did not list then) and "not sure, decide later" (saved so it is not asked again until a step that needs the
 * account passes the brand in askDeferred). More accounts than the Inbox offers as buttons: left waiting (and
 * needsChoice when a choice was lost); use pipeline_ad_account_choose. Open questions that no longer fit are taken back.
 * Safe to repeat. noAccount and deferred are only present when a brand answered that way.
 */
export function reconcileAdAccountChoices({ root, provider, askDeferred = [] }) {
  checkProvider(provider);
  const accounts = readAdAccounts(root, provider);
  const result = { chosen: [], asked: [], waiting: [], needsChoice: [] };
  const noAccount = [];
  const deferred = [];
  const open = adQuestions(root, provider, 'open');
  const keep = new Set();
  const options = adQuestionOptions(accounts, provider);
  for (const entry of accounts.length ? runtime.listBrands({ root }) : []) {
    const profile = brandProfile.read(entry.path);
    if (!profile) continue;
    let saved = readBrandAdChoice(entry.path, provider);
    const current = saved?.kind === 'account' ? saved : null;
    if (current && accounts.some(item => item.id === current.id)) continue;
    const answer = answeredPick(root, provider, entry.slug, accounts, saved);
    if (answer?.kind === 'account') {
      saveBrandAdAccount(entry.path, provider, answer.account);
      markAnswersConsumed(root, provider, entry.slug);
      result.chosen.push({ brand: entry.slug, accountId: answer.account.id, name: answer.account.name, how: 'answer' });
      continue;
    }
    if (answer?.kind === 'none') {
      recordNoAccount(root, entry, provider);
      markAnswersConsumed(root, provider, entry.slug);
      noAccount.push(entry.slug);
      continue;
    }
    if (answer?.kind === 'later') {
      saveBrandLaterAdAccount(entry.path, provider);
      markAnswersConsumed(root, provider, entry.slug);
      deferred.push(entry.slug);
      continue;
    }
    if (saved?.kind === 'none') {
      // Said so already: only an account that was not listed then (the person added one) asks again.
      if (!accounts.some(item => !saved.knownIds.includes(item.id))) continue;
    } else if (saved?.kind === 'later') {
      if (!askDeferred.includes(entry.slug)) continue;
      clearBrandAdEntry(entry.path, provider);
      saved = null;
    }
    if (accounts.length === 1 && !saved) {
      saveBrandAdAccount(entry.path, provider, accounts[0]);
      result.chosen.push({ brand: entry.slug, accountId: accounts[0].id, name: accounts[0].name, how: 'auto' });
      continue;
    }
    result.waiting.push(entry.slug);
    if (accounts.length > AD_ACCOUNT_BUTTON_LIMIT) {
      if (current) result.needsChoice.push({ brand: entry.slug, was: current.name });
      continue;
    }
    const existing = open.find(question => question.brand === entry.slug && sameOptions(question, provider, options));
    if (existing) { keep.add(existing.questionId); continue; }
    const question = askQuestion({ root, brand: entry.slug, text: questionText(provider, entry.name || entry.slug), options: options.map(option => option.text), allowText: false });
    saveQuestionMeta(root, question.questionId, { provider, options });
    keep.add(question.questionId);
    result.asked.push({ brand: entry.slug, questionId: question.questionId });
    if (current) result.needsChoice.push({ brand: entry.slug, was: current.name });
  }
  for (const question of open) {
    if (!keep.has(question.questionId)) withdrawQuestion({ root, questionId: question.questionId });
  }
  if (noAccount.length) result.noAccount = noAccount;
  if (deferred.length) result.deferred = deferred;
  return result;
}

/**
 * A step that needs the brand's ad account and finds only "decide later" asks again: the "decide later" is cleared and the
 * Inbox question is asked, so the person answers it where they see their other questions.
 */
export function askAdAccountAgain({ root, brand, provider }) {
  checkProvider(provider);
  const entry = resolveBrand(root, brand);
  return reconcileAdAccountChoices({ root, provider, askDeferred: [entry.slug] });
}

/** The same for every ad provider, for a moment when a failure must not undo what just happened. */
export function reconcileAdAccountChoicesQuietly({ root }) {
  const results = {};
  for (const provider of AD_PROVIDERS) {
    try { results[provider] = reconcileAdAccountChoices({ root, provider }); } catch { results[provider] = null; }
  }
  return results;
}

/** Save what the connector returned, then choose or ask for each brand that needs it. */
export function saveAdAccountsAndChoose({ root, provider, accounts }) {
  const saved = saveAdAccounts(root, provider, accounts);
  return { provider, accounts: saved, ...reconcileAdAccountChoices({ root, provider }) };
}

/**
 * What the board shows on a brand card: the saved choice per provider (found false when the connector no longer lists
 * it), none: true when the person said there is no ad account yet, later: true when they are not sure. Never throws.
 */
export function brandAdAccountsInfo({ brandDir, root }) {
  const info = {};
  for (const provider of AD_PROVIDERS) {
    try {
      const saved = readBrandAdChoice(brandDir, provider);
      if (!saved) continue;
      if (saved.kind === 'none') { info[provider] = { provider, none: true, connected: adConnected(root, provider) }; continue; }
      if (saved.kind === 'later') { info[provider] = { provider, later: true, connected: adConnected(root, provider) }; continue; }
      const match = readAdAccounts(root, provider).find(item => item.id === saved.id) || null;
      info[provider] = { provider, id: saved.id, name: match ? match.name : saved.name, currency: saved.currency, found: Boolean(match), connected: adConnected(root, provider) };
    } catch {
      info[provider] = { provider, unreadable: true };
    }
  }
  return Object.keys(info).length ? info : null;
}

export { PROVIDER_NAME as AD_PROVIDER_NAME };
