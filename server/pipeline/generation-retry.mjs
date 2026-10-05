import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InvalidInputError } from '../lib/errors.mjs';
import * as facts from './facts.mjs';

/**
 * Trying a failed picture or clip again under the price the person already approved.
 *
 * 3Echo answers a repeated idempotencyKey with the same (failed) job, so a retry needs a new version key. The spend guard only
 * lets an item through that is in the approved price, so the new key takes the failed key's place in the price with the same
 * credits, and the earlier approval is carried forward to the new price. Nothing costs more: the failed create was released.
 */

const SHORT_ITEM = /^\s*(D\d+)[\s/_-]+([A-Za-z][A-Za-z0-9_]*?)(?:[\s/_-]+v(\d+))?\s*$/i;
const VERSIONED = /(?:^|[-/])v\d+\s*$/i;
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);

function refuse(message) {
  throw new InvalidInputError(message);
}

/** Clip 4, Picture 2: the words the person sees for a quote item. */
function wordsFor(item) {
  const number = /(\d+)\s*$/.exec(String(item.panel || ''))?.[1];
  if (!number) return facts.itemLabel(item);
  const reference = facts.isReferenceItem(item);
  const what = item.kind === 'video' ? 'Clip' : item.kind === 'image' ? (reference ? 'Reference picture' : 'Picture') : 'Voice line';
  return `${what} ${Number(number)}`;
}

/** The slot (deliverable and panel) the person means and, when they named one, the exact version. */
function slotFrom(job, raw) {
  const given = text(raw);
  if (!given) refuse('Say which picture or clip to make again.');
  const short = SHORT_ITEM.exec(given);
  if (short) {
    const deliverable = facts.canonicalDeliverable(short[1]);
    const panel = facts.canonicalItem(short[2]);
    if (deliverable && panel) return { deliverable, panel, version: short[3] ? Number(short[3]) : null };
  }
  const parsed = facts.parseJobKey(given);
  if (!parsed) refuse(`I could not tell which item "${given}" is. Name it by its job key, or by its deliverable and panel, such as D1 S4.`);
  if (parsed.jobId !== job.jobId) refuse('That item belongs to another job.');
  return { deliverable: parsed.deliverable, panel: parsed.item, version: VERSIONED.test(given) ? parsed.version : null };
}

const sameSlot = (slot, keyOrItem) => {
  const parsed = facts.parseJobKey(typeof keyOrItem === 'string' ? keyOrItem : keyOrItem?.key);
  return Boolean(parsed) && parsed.deliverable === slot.deliverable && parsed.item === slot.panel;
};

function highestVersion(job, slot, quoteItems) {
  let top = 0;
  const see = key => {
    const parsed = facts.parseJobKey(key);
    if (parsed && parsed.jobId === job.jobId && sameSlot(slot, parsed.key)) top = Math.max(top, parsed.version);
  };
  quoteItems.forEach(item => see(item?.key));
  facts.readRecords(job).filter(record => record.type === 'create').forEach(record => see(record.key));
  facts.readLanded(job).filter(entry => entry.type === 'landed').forEach(entry => see(entry.key));
  return top;
}

/**
 * Make the failed item's key give way to a new version of it in the approved price, and approve that price on the strength of the
 * earlier approval. Refuses in plain words unless the item is in the current approved price and every 3Echo create on it ended
 * failed or cancelled with nothing made or saved.
 */
export function retryFailedItem({ root, brand, jobId, item, confirmedBy } = {}) {
  const job = facts.jobAt(root, brand, jobId);
  if (!job) refuse('Job not found in this workspace.');
  const by = text(confirmedBy);
  if (!by) refuse('Say who agreed to try again.');
  if (facts.isFinishedState(job.state)) refuse(facts.SPEND_DENY.jobFinished);
  const price = facts.currentPriceApproval(job);
  if (!price) refuse("There is no approved price for this job, so there is nothing to make again under it. Show the price and wait for approval first.");

  const slot = slotFrom(job, item);
  const inSlot = price.quote.items.filter(entry => entry && sameSlot(slot, entry));
  if (!inSlot.length) refuse(facts.SPEND_DENY.notInQuote);
  const newest = inSlot.reduce((best, entry) => (facts.parseJobKey(entry.key).version > facts.parseJobKey(best.key).version ? entry : best));
  const failedKey = facts.canonicalJobKey(newest.key);
  if (slot.version !== null && slot.version !== facts.parseJobKey(failedKey).version) {
    refuse(`${wordsFor(newest)} already has a newer try in the approved price (${facts.itemLabel(failedKey)}).`);
  }

  const label = wordsFor(newest);
  if (newest.provider !== facts.THREE_ECHO || !['image', 'video'].includes(newest.kind) || facts.isTranscriptionItem(newest)) {
    refuse(`${label} is not a picture or clip made on 3Echo, so it cannot be made again this way.`);
  }
  const creates = facts.readRecords(job).filter(record => record.type === 'create' && record.provider === facts.THREE_ECHO && facts.canonicalJobKey(record.key) === failedKey);
  if (!creates.length) refuse(`${label} has not been started yet, so there is nothing to make again. Make it under its own approved item.`);
  const earlier = facts.earlierCreateState(job, failedKey);
  if (earlier === 'making') refuse(facts.SPEND_DENY.stillMaking);
  if (earlier === 'made') refuse(`${label} was already made, so it does not need to be made again. A redo the person asked for needs its own price.`);

  const parsed = facts.parseJobKey(failedKey);
  const retryKey = facts.formatJobKey({ jobId: job.jobId, deliverable: parsed.deliverable, item: parsed.item, version: highestVersion(job, slot, price.quote.items) + 1 });
  if (!retryKey) refuse(`${label} cannot be made again right now.`);

  const retryItem = { key: retryKey, provider: newest.provider, kind: newest.kind, deliverable: parsed.deliverable, panel: parsed.item, credits: newest.credits };
  // The sample is the item marked as one or, when none is marked, the first one made (the spend guard reads it that way). The retry takes that
  // place, or the rest of the batch would wait for a sample that can no longer be approved.
  const marked = price.quote.items.some(entry => entry && entry.provider === facts.THREE_ECHO && entry.sample === true && !facts.isReferenceItem(entry));
  const firstMade = facts.readRecords(job).find(record => record.type === 'create' && record.provider === facts.THREE_ECHO && !facts.isReferenceItem(record.key));
  if (newest.sample === true || (!marked && firstMade && facts.canonicalJobKey(firstMade.key) === failedKey)) retryItem.sample = true;
  if (newest.estimateId) retryItem.estimateId = newest.estimateId;
  if (newest.generationsCount !== undefined) retryItem.generationsCount = newest.generationsCount;

  const quoteFile = join(job.dir, ...facts.FACT_FILES.quote.split('/'));
  const before = readFileSync(quoteFile, 'utf8');
  const restore = () => writeFileSync(quoteFile, before, 'utf8');
  const media = list => list.filter(entry => entry && !facts.isTranscriptionItem(entry));
  const oldTotals = facts.quoteTotals(media(price.quote.items));

  facts.saveQuote(job, [retryItem], { drop: [failedKey] });
  try {
    const current = facts.readQuote(job);
    const totals = facts.quoteTotals(media(current.quote.items));
    if (!facts.sameTotals(totals, oldTotals)) throw new InvalidInputError(`${label} cannot be made again under the same price.`);
    const at = new Date().toISOString();
    facts.writePriceApproval(job, {
      quoteSha: current.sha256,
      decision: 'approved',
      totals,
      approvedAt: at,
      by,
      confirmedBy: by,
      decidedAt: at,
      retryOf: failedKey,
      retryKey,
      carriedFrom: price.n,
    });
    if (facts.currentPriceApproval(job)?.approval.retryKey !== retryKey) throw new InvalidInputError(`${label} could not be made again. Try once more.`);
  } catch (error) {
    restore();
    throw error;
  }
  return { retryKey, failedKey, credits: retryItem.credits, message: `${label} will be made again under the price you already approved.` };
}
