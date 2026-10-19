import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InvalidInputError } from '../lib/errors.mjs';
import * as facts from './facts.mjs';
import { noteOnJob } from './session-claims.mjs';

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

function refuse(message, fix) {
  throw new InvalidInputError(message, fix ? { fix } : {});
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
 * The create or landed record a paid picture or clip already has under this key, or null when there is none or the earlier create
 * ended failed or cancelled with nothing made (then the key is a retry's business, not a repeat). A key with a create or a landed
 * record is never made again: this is the record to use instead. {key, label, state: 'making' | 'made', providerJobId,
 * outputAssetIds, landed: {assetId, file} | null, message}. A redo is a new version key with its own price, so it never lands here.
 */
export function existingCreate(job, key) {
  const wanted = facts.canonicalJobKey(key);
  if (!wanted) return null;
  const records = facts.readRecords(job);
  const creates = records.filter(record => record.type === 'create' && record.provider === facts.THREE_ECHO && facts.canonicalJobKey(record.key) === wanted);
  const landed = facts.readLanded(job).filter(entry => entry.type === 'landed' && facts.canonicalJobKey(entry.key) === wanted);
  if (!creates.length && !landed.length) return null;
  const state = creates.length ? facts.earlierCreateState(job, wanted) : 'made';
  if (!state) return null;
  const create = creates.length ? creates[creates.length - 1] : null;
  const last = landed[landed.length - 1];
  const providerJobId = create?.providerJobId ?? last?.providerJobId ?? null;
  const result = providerJobId ? records.filter(record => record.type === 'result' && record.providerJobId === providerJobId).pop() : null;
  const parsed = facts.parseJobKey(wanted);
  const priced = facts.readQuote(job)?.quote?.items?.find(item => item && facts.canonicalJobKey(item.key) === wanted);
  const kind = create?.kind || (create?.tool ? (create.tool === 'create_video_job' ? 'video' : 'image') : priced?.kind) || 'image';
  const label = wordsFor({ key: wanted, panel: parsed.item, kind });
  return {
    key: wanted,
    label,
    state,
    providerJobId,
    outputAssetIds: Array.isArray(result?.outputAssetIds) ? result.outputAssetIds : [],
    landed: last ? { assetId: last.assetId ?? null, file: last.file ?? null } : null,
    message: state === 'making'
      ? `${label} is already being made, so it was not started again and nothing more was charged.`
      : `${label} was already made, so it was not made again and nothing more was charged.`,
  };
}

/**
 * A paid create asked for again under a key that already has a record. When it has one, the existing record comes back
 * ({existing: true, ...record}) and the job's log says so in plain words; the caller must not create again. When it has none
 * the create may go ahead as usual ({existing: false}).
 */
export function answerRepeatedCreate(job, key, { now = Date.now() } = {}) {
  const record = existingCreate(job, key);
  if (!record) return { existing: false };
  noteOnJob(job.dir, 'repeat_create', `${record.label} was asked for again while the first one already existed, so the first one was kept and nothing was paid twice.`, { now });
  return { existing: true, ...record };
}

/** Where to find what was already made, for the Director that asked again. */
function whereIs(record) {
  if (record.state === 'making') return `The first one is still running${record.providerJobId ? ` as 3Echo job ${record.providerJobId}` : ''}. Check on it with wait_for_job and do not make it again.`;
  if (record.landed?.file) return `The first one is saved as ${record.landed.file}. Use it and do not make it again.`;
  const assets = record.outputAssetIds.length ? ` It made ${record.outputAssetIds.join(', ')}: save it with pipeline_generation_land.` : '';
  return `The first one exists${record.providerJobId ? ` as 3Echo job ${record.providerJobId}` : ''}.${assets} Do not make it again.`;
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
  // A key that already has a record is never made again: the refusal carries that record, and the job's log says so.
  const repeat = answerRepeatedCreate(job, failedKey);
  if (repeat.existing && repeat.state === 'making') refuse(facts.SPEND_DENY.stillMaking, whereIs(repeat));
  if (repeat.existing) refuse(`${label} was already made, so it does not need to be made again. A redo the person asked for needs its own price.`, whereIs(repeat));

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
