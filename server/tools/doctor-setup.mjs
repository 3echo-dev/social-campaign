/**
 * The setup self-test checks the doctor adds: is each brand's publishing linked, is its Instagram a
 * professional account, are there Studio credits. Only what the plugin has already saved is read.
 * Nothing here calls a provider. A fact that was never saved reads as "unchecked", not as a problem.
 */

import { join } from 'node:path';

import { readJsonFile } from '../lib/json.mjs';
import { listBrands } from '../pipeline/runtime.mjs';
import { METRICOOL_NETWORKS, brandPublishingInfo, metricoolConnected, readBrandOptedOut, readMetricoolBrands } from '../pipeline/metricool.mjs';
import { readStudioWorkspaceList } from '../pipeline/studio-workspace.mjs';

const NETWORK_LABELS = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
const RANK = { ok: 0, unchecked: 1, warn: 2 };

const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

/** Metricool in plain words for one brand's channels: linked handle, or what is wrong. */
function channelLine(network, state, info) {
  const label = NETWORK_LABELS[network];
  const handle = info.linkedAs?.[network] || info.own?.[network];
  if (state === 'linked') return { status: 'ok', text: `${label} ${handle || 'linked'}` };
  if (state === 'different_handle') return { status: 'warn', text: `${label} posts as ${info.linkedAs?.[network] || 'another account'}, not ${info.own?.[network] || 'the one on the brand card'}` };
  if (state === 'not_linked') return { status: 'warn', text: `${label} is not linked in Metricool` };
  if (state === 'only_in_metricool') return { status: 'ok', text: `${label} ${handle || 'linked'} (not on the brand card)` };
  return { status: 'unchecked', text: `${label} not checked` };
}

function metricoolCheck(brand, info, connected) {
  const base = { id: `metricool_link_${brand.slug}`, name: `Publishing link for ${brand.name}`, repairable: false };
  if (readBrandOptedOut(brand.path)) {
    return { ...base, status: 'ok', detail: 'Posts are made by hand, not through Metricool.', fix: null };
  }
  if (!info || info.optedOut) {
    return {
      ...base,
      status: connected ? 'warn' : 'unchecked',
      detail: connected ? 'No Metricool brand is chosen for this brand yet.' : 'Metricool is not connected, so the link was not checked.',
      fix: connected
        ? `Ask Claude to pick the Metricool brand for ${brand.name}. It asks you once.`
        : 'Connect Metricool first. Then ask Claude to pick the Metricool brand for this brand.',
    };
  }
  if (info.unreadable) {
    return { ...base, status: 'unchecked', detail: 'The saved link could not be read.', fix: `Ask Claude to pick the Metricool brand for ${brand.name} again.` };
  }
  if (connected && !info.found) {
    return {
      ...base,
      status: 'warn',
      detail: `The Metricool brand "${info.label}" is not in your Metricool account any more.`,
      fix: `Ask Claude to pick the Metricool brand for ${brand.name} again.`,
    };
  }
  const lines = [];
  for (const network of METRICOOL_NETWORKS) {
    const state = info.coverage?.[network];
    if (state) lines.push(channelLine(network, state, info));
    else if (info.linkedAs?.[network]) lines.push({ status: 'ok', text: `${NETWORK_LABELS[network]} ${info.linkedAs[network]}` });
  }
  if (!lines.length) {
    return { ...base, status: 'unchecked', detail: `Linked to "${info.label}". The channels were not checked.`, fix: 'Connect Metricool, then run this check again.' };
  }
  const status = lines.reduce((acc, line) => worst(acc, line.status), 'ok');
  return {
    ...base,
    status,
    detail: `Linked to "${info.label}". ${lines.map(line => line.text).join('. ')}.`,
    fix: status === 'ok' ? null : `In Metricool, connect the missing or different account for ${brand.name}. Then ask Claude to pick the Metricool brand again.`,
  };
}

const PROFESSIONAL = new Set(['business', 'creator']);

function instagramCheck(brand, info, metricoolBrand) {
  const base = { id: `instagram_account_${brand.slug}`, name: `Instagram account type for ${brand.name}`, repairable: false };
  const type = metricoolBrand?.instagramAccountType || null;
  if (PROFESSIONAL.has(type)) return { ...base, status: 'ok', detail: `The Instagram account is a ${type} account.`, fix: null };
  if (type) {
    return {
      ...base,
      status: 'warn',
      detail: 'The Instagram account is a personal account, so Metricool cannot post to it.',
      fix: 'In the Instagram app, switch the account to a Business or Creator account. Then reconnect it in Metricool.',
    };
  }
  return {
    ...base,
    status: 'unchecked',
    detail: 'Metricool did not say what kind of Instagram account this is.',
    fix: 'In the Instagram app, open Settings and check the account is a Business or Creator account.',
  };
}

function creditsCheck(root) {
  const base = { id: 'studio_credits', name: 'Studio credits (3echo)', repairable: false };
  const known = readStudioWorkspaceList(root);
  if (!known.length) {
    return {
      ...base,
      status: 'unchecked',
      detail: 'Social Campaign has not read your 3echo workspaces yet.',
      fix: 'Connect 3echo Studio, then ask Claude to check your 3echo workspaces.',
    };
  }
  const counted = known.filter(item => item.creditAvailable !== null);
  if (!counted.length) {
    return { ...base, status: 'unchecked', detail: '3echo did not report any credits.', fix: 'Open 3echo and look at the credits on your workspace.' };
  }
  const detail = counted.map(item => `${item.name}: ${item.creditAvailable} credit${item.creditAvailable === 1 ? '' : 's'}`).join('. ');
  if (counted.some(item => item.creditAvailable > 0)) return { ...base, status: 'ok', detail: `${detail}.`, fix: null };
  return { ...base, status: 'warn', detail: `${detail}. No credits are left.`, fix: 'Add credits in 3echo before a job needs pictures or video.' };
}

/**
 * The extra checks, for a workspace root that exists.
 * @param {string} root
 * @returns {object[]} doctor checks (status ok, warn or unchecked)
 */
export function setupChecks(root) {
  const checks = [];
  let connected = false;
  let metricoolBrands = [];
  let brands = [];
  try {
    connected = metricoolConnected(root);
    metricoolBrands = readMetricoolBrands(root);
    brands = listBrands({ root }).filter(brand => brand.onboardingStatus === 'complete');
  } catch { /* Nothing saved yet: the checks below report what was not checked. */ }
  for (const brand of brands) {
    const profile = readJsonFile(join(brand.path, 'brand', 'profile.json'), null);
    const info = brandPublishingInfo({ brandDir: brand.path, channels: profile?.channels, brands: metricoolBrands, connected });
    checks.push(metricoolCheck(brand, info, connected));
    const instagramLinked = info && !info.optedOut && !info.unreadable && (info.linkedAs?.instagram || info.coverage?.instagram);
    if (instagramLinked) checks.push(instagramCheck(brand, info, metricoolBrands.find(item => item.id === info.blogId)));
  }
  checks.push(creditsCheck(root));
  return checks;
}
