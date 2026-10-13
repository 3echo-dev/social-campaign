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

/** One account as Meta (id "act_123", name, currency, timezone_name), TikTok (advertiser_id, advertiser_name) or this module returned it. */
function cleanAccount(entry) {
  if (!plain(entry)) return null;
  const id = text(entry.id ?? entry.account_id ?? entry.advertiser_id, 40);
  if (!id || !ACCOUNT_ID.test(id)) return null;
  return {
    id,
    name: text(entry.name ?? entry.advertiser_name ?? entry.account_name, NAME_LIMIT) || `Ad account ${id}`,
    currency: text(entry.currency, 10),
    timezone: text(entry.timezone ?? entry.timezone_name ?? entry.timezone_display, 60),
  };
}

function listOf(input) {
  if (Array.isArray(input)) return input;
  if (!plain(input)) return null;
  for (const key of ['data', 'accounts', 'list', 'advertisers']) {
    const value = input[key];
    if (Array.isArray(value)) return value;
    // TikTok: { data: { list: [...] } }.
    if (plain(value)) { const inner = listOf(value); if (inner) return inner; }
  }
  return null;
}

/**
 * The accounts list the way it is stored: `[{id, name, currency, timezone}]`. Accepts the connector's result whole
 * (`{data:[...]}`, `{data:{list:[...]}}`), the list, or an already normalised list. An entry without a usable id is
 * dropped; a repeated id keeps its first entry.
 */
export function normalizeAdAccounts(input) {
  const list = listOf(input);
  if (!list) throw new Error('Pass the accounts exactly as the connector returned them.');
  if (list.length > AD_ACCOUNT_LIMIT) throw new Error(`The connector returned more than ${AD_ACCOUNT_LIMIT} ad accounts, which is more than this can hold.`);
  const seen = new Set();
  const accounts = [];
  for (const entry of list) {
    const account = cleanAccount(entry);
    if (!account || seen.has(account.id)) continue;
    seen.add(account.id);
    accounts.push(account);
  }
  if (list.length && !accounts.length) throw new Error('None of these accounts has an id, so none could be saved.');
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
  return record.accounts.map(cleanAccount).filter(Boolean);
}

export function adConnected(root, provider) {
  return readAdRecord(root, provider)?.state === 'connected';
}

/** Store the accounts under providers.<provider>, keeping the rest of the record (state, namespace, last_probe) as it is. */
export function saveAdAccounts(root, provider, input) {
  checkProvider(provider);
  const accounts = normalizeAdAccounts(input);
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

/** The saved choice, or null. */
export function readBrandAdAccount(brandDir, provider) {
  checkProvider(provider);
  const profile = readJsonFile(profileFile(brandDir), null);
  const saved = plain(profile) && plain(profile.adAccounts) ? profile.adAccounts[provider] : null;
  if (!plain(saved)) return null;
  const id = text(saved.id, 40);
  if (!id) return null;
  return { provider, id, name: text(saved.name, NAME_LIMIT) || `Ad account ${id}`, currency: text(saved.currency, 10), chosenAt: text(saved.chosenAt, 40) };
}

/** Write adAccounts[provider] into the brand profile without touching anything else and without a revision bump. */
function saveBrandAdAccount(brandDir, provider, account) {
  const file = profileFile(brandDir);
  let record = null;
  durable.update(file, (raw) => {
    let current = null;
    try { current = JSON.parse(raw); } catch { current = null; }
    if (!brandProfile.validRecord(current)) throw new Error(NOT_READY);
    const existing = plain(current.adAccounts) ? current.adAccounts : {};
    const saved = existing[provider];
    if (plain(saved) && saved.id === account.id && saved.name === account.name && (saved.currency ?? null) === (account.currency ?? null)) { record = saved; return raw; }
    record = { id: account.id, name: account.name, currency: account.currency ?? null, chosenAt: new Date().toISOString() };
    const next = `${JSON.stringify({ ...current, adAccounts: { ...existing, [provider]: record } }, null, 2)}\n`;
    if (Buffer.byteLength(next, 'utf8') > brandProfile.MAX_PROFILE_BYTES) throw new Error('Keep the brand profile under 40 KB.');
    return next;
  });
  return record;
}

// ---------------------------------------------------------------------------
// The Inbox question
// ---------------------------------------------------------------------------

/** The accounts as Inbox answers, `[{text, id}]`: the real name shown plain, the currency added to a name more than one account shares. */
export function adQuestionOptions(accounts) {
  const base = accounts.map(account => plainLabel(account.name).slice(0, OPTION_TEXT_LIMIT - 30));
  const counts = new Map();
  for (const line of base) counts.set(line.toLowerCase(), (counts.get(line.toLowerCase()) || 0) + 1);
  const used = new Set();
  return accounts.map((account, index) => {
    let line = base[index];
    if (counts.get(line.toLowerCase()) > 1 && account.currency) {
      const code = plainLabel(account.currency);
      if (/^\p{L}{2,5}$/u.test(code)) line = `${line} (${code})`.slice(0, OPTION_TEXT_LIMIT);
    }
    let candidate = line;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${line.slice(0, OPTION_TEXT_LIMIT - 5)} (${n})`;
    used.add(candidate.toLowerCase());
    return { text: candidate, id: account.id };
  });
}

function questionText(provider, name) {
  const prefix = AD_QUESTION_PREFIX[provider];
  const named = `${prefix} ${name}?`;
  return plainWordsProblem(named) || named.length > 300 ? `${prefix} this brand?` : named;
}

export function isAdAccountQuestion(question, provider = null) {
  if (!question || typeof question.text !== 'string') return false;
  const prefixes = provider ? [AD_QUESTION_PREFIX[provider]] : Object.values(AD_QUESTION_PREFIX);
  return prefixes.some(prefix => prefix && question.text.startsWith(prefix));
}

function questionFile(root, questionId) {
  return join(root, '.social-pipeline', 'board', 'questions', `${questionId}.json`);
}

function storedOptions(question) {
  const list = plain(question?.adAccount) && Array.isArray(question.adAccount.options) ? question.adAccount.options : [];
  return list.filter(item => plain(item) && typeof item.text === 'string' && typeof item.id === 'string');
}

function sameOptions(question, provider, options) {
  return question.adAccount?.provider === provider && JSON.stringify(storedOptions(question)) === JSON.stringify(options);
}

function saveQuestionMeta(root, questionId, patch) {
  const file = questionFile(root, questionId);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  record.adAccount = { ...(plain(record.adAccount) ? record.adAccount : {}), ...patch };
  const temp = `${file}.${randomUUID()}.tmp`;
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

/** The account the person picked, saved as that plugin brand's own choice for this provider. */
export function chooseAdAccount({ root, brand, provider, accountId }) {
  checkProvider(provider);
  const entry = resolveBrand(root, brand);
  if (!brandProfile.read(entry.path)) throw new Error(NOT_READY);
  const id = String(accountId ?? '').trim();
  const match = readAdAccounts(root, provider).find(item => item.id === id);
  if (!match) throw new Error('This is not one of the saved ad accounts.');
  const saved = saveBrandAdAccount(entry.path, provider, match);
  withdrawOpenQuestions(root, provider, entry.slug);
  markAnswersConsumed(root, provider, entry.slug);
  return { brand: entry.slug, brandName: entry.name || entry.slug, provider, accountId: saved.id, name: saved.name, currency: saved.currency };
}

/** The account an answered question named, read against the options it was asked with. Used or older-than-the-choice answers are ignored. */
function answeredAccount(root, provider, brandSlug, accounts, current) {
  for (const question of adQuestions(root, provider, 'answered')) {
    if (question.brand !== brandSlug || question.adAccount?.consumed) continue;
    if (current?.chosenAt && String(question.answeredAt || '') < current.chosenAt) continue;
    const given = String(question.answer?.choice ?? question.answer?.text ?? '').trim().toLowerCase();
    const picked = given ? storedOptions(question).find(option => option.text.toLowerCase() === given) : null;
    const match = picked ? accounts.find(item => item.id === picked.id) : null;
    if (match) return match;
  }
  return null;
}

/**
 * Give every plugin brand with a finished profile and no working choice for this provider an ad account.
 * A brand that never chose, with exactly one account, gets it at once. A saved choice the connector no longer lists
 * is never replaced silently, even with one account left: it is reported as needsChoice and the Inbox question is
 * asked. Otherwise a saved answer is applied, else the question is asked once, with its options saved on it.
 * More accounts than the Inbox offers as buttons: left waiting (and needsChoice when a choice was lost); use
 * pipeline_ad_account_choose. Open questions that no longer fit are taken back. Safe to repeat.
 */
export function reconcileAdAccountChoices({ root, provider }) {
  checkProvider(provider);
  const accounts = readAdAccounts(root, provider);
  const result = { chosen: [], asked: [], waiting: [], needsChoice: [] };
  const open = adQuestions(root, provider, 'open');
  const keep = new Set();
  const options = adQuestionOptions(accounts);
  for (const entry of accounts.length ? runtime.listBrands({ root }) : []) {
    const profile = brandProfile.read(entry.path);
    if (!profile) continue;
    const current = readBrandAdAccount(entry.path, provider);
    if (current && accounts.some(item => item.id === current.id)) continue;
    let pick = accounts.length === 1 && !current ? { account: accounts[0], how: 'auto' } : null;
    if (!pick) {
      const answer = answeredAccount(root, provider, entry.slug, accounts, current);
      if (answer) pick = { account: answer, how: 'answer' };
    }
    if (pick) {
      saveBrandAdAccount(entry.path, provider, pick.account);
      if (pick.how === 'answer') markAnswersConsumed(root, provider, entry.slug);
      result.chosen.push({ brand: entry.slug, accountId: pick.account.id, name: pick.account.name, how: pick.how });
      continue;
    }
    result.waiting.push(entry.slug);
    if (accounts.length > QUESTION_OPTION_LIMIT) {
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
  return result;
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

/** What the board shows on a brand card: the saved choice per provider, `found` false when the connector no longer lists it. Never throws. */
export function brandAdAccountsInfo({ brandDir, root }) {
  const info = {};
  for (const provider of AD_PROVIDERS) {
    try {
      const saved = readBrandAdAccount(brandDir, provider);
      if (!saved) continue;
      const match = readAdAccounts(root, provider).find(item => item.id === saved.id) || null;
      info[provider] = { provider, id: saved.id, name: match ? match.name : saved.name, currency: saved.currency, found: Boolean(match), connected: adConnected(root, provider) };
    } catch {
      info[provider] = { provider, unreadable: true };
    }
  }
  return Object.keys(info).length ? info : null;
}

export { PROVIDER_NAME as AD_PROVIDER_NAME };
