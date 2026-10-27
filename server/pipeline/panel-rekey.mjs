import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InvalidInputError } from '../lib/errors.mjs';
import * as facts from './facts.mjs';
import { noteOnJob } from './session-claims.mjs';

/**
 * Fixing a mistyped panel key (PP4 where P4 was meant) while no money has been spent on it.
 *
 * The key lives in the saved price, in the deliverable's generation manifest and, if one was put there by hand, in a draft or
 * media file name. Once a create, an attempt or a landing exists for the key the picture is a paid fact and keeps its name.
 */

const events = createRequire(import.meta.url)(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'scripts', 'lib-events.js'));

function refuse(message, fix) {
  throw new InvalidInputError(message, fix ? { fix } : {});
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const readJson = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const slotOf = value => {
  const parsed = facts.parseJobKey(value);
  return parsed ? `${parsed.deliverable}|${parsed.item}` : null;
};

/** Files named for a slot in the deliverable's draft and media folders: `<item>.<ext>` or `<item>-v<n>[-<m>].<ext>`. */
function slotFiles(job, deliverable, item) {
  const pattern = new RegExp(`^${escapeRegExp(item)}((?:-v\\d+(?:-\\d+)?)?)\\.([A-Za-z0-9]+)$`, 'i');
  const found = [];
  for (const folder of ['drafts', 'media']) {
    let names = [];
    try {
      names = readdirSync(join(job.dir, folder, deliverable));
    } catch {
      continue;
    }
    for (const name of names) {
      const hit = pattern.exec(name);
      if (hit) found.push({ folder: `${folder}/${deliverable}`, name, rest: hit[1], extension: hit[2] });
    }
  }
  return found;
}

const stemOf = file => String(file ?? '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

function kindWords(kind) {
  return kind === 'video' ? 'Clip' : kind === 'image' ? 'Picture' : 'Item';
}

/** Everything that holds the key, found before anything is changed. */
function inventory(job, deliverable, item) {
  const slot = `${deliverable}|${item}`;
  const quote = facts.readQuote(job)?.quote?.items || [];
  const priced = quote.filter(entry => entry && slotOf(entry.key) === slot && facts.parseJobKey(entry.key)?.jobId === job.jobId);
  const manifestFile = join(job.dir, 'drafts', deliverable, 'generation-manifest.json');
  const manifest = readJson(manifestFile);
  const manifestItems = (Array.isArray(manifest?.items) ? manifest.items : []).filter(entry => entry && facts.canonicalItem(entry.panel) === item);
  const stitched = (Array.isArray(manifest?.stitch?.order) ? manifest.stitch.order : []).some(id => String(id).toLowerCase() === item.toLowerCase());
  const records = facts.readRecords(job).filter(record => slotOf(record.key) === slot);
  const landed = facts.readLanded(job).filter(entry => slotOf(entry.key) === slot || (entry.deliverable === deliverable && facts.canonicalItem(entry.panel) === item));
  return { priced, manifest, manifestFile, manifestItems, stitched, records, landed, files: slotFiles(job, deliverable, item) };
}

const isEmpty = found => !found.priced.length && !found.manifestItems.length && !found.stitched && !found.files.length;

export function rekeyPanel({ root, brand, jobId, deliverable, from, to } = {}) {
  const job = facts.jobAt(root, brand, jobId);
  if (!job) refuse('Job not found in this workspace.');
  if (facts.isFinishedState(job.state)) refuse(facts.SPEND_DENY.jobFinished);
  const d = facts.canonicalDeliverable(deliverable);
  if (!d) refuse('Say which post it is, such as D1.');
  const oldItem = facts.canonicalItem(from);
  const newItem = facts.canonicalItem(to);
  if (!oldItem || !newItem) refuse('Name the mistyped panel and the one it should be, such as PP4 and P4.');
  if (oldItem === newItem) refuse(`${oldItem} and ${newItem} are already the same.`);
  if ([oldItem, newItem].some(item => facts.isReferenceItem(item) || facts.isTranscriptionItem(item))) {
    refuse('Reference pictures and transcriptions keep their keys, so they cannot be renamed.');
  }

  const old = inventory(job, d, oldItem);
  if (isEmpty(old) && !old.records.length && !old.landed.length) refuse(`Nothing in ${d} is keyed ${oldItem}.`);
  if (old.records.length || old.landed.length) {
    refuse(`Money was already spent on ${d} ${oldItem}, so it cannot be renamed.`, 'A picture that was started or saved keeps its name. If it is wrong, ask the person whether to make the right one as its own item.');
  }
  const panels = facts.storyboardPanelKeys(job, d);
  if (panels?.has(oldItem)) refuse(`${oldItem} is a picture in the storyboard for ${d}, so it is not a mistyped key.`);
  const unknown = facts.unknownPanelRefusal(job, d, newItem);
  if (unknown) refuse(unknown);

  const fresh = inventory(job, d, newItem);
  // Only a price that holds both keys is a clash. When just the manifest or the files carry the wrong key, the price already has the right one and stays as it is.
  if (old.priced.length && fresh.priced.length) refuse(`${d} ${newItem} is already in the price. Take ${oldItem} out of the price with pipeline_quote_save and its drop list instead of renaming it.`);
  // The new key in the join order is the old key's own slot when the manifest names the old key as well.
  const ownSlot = old.manifestItems.length > 0 || old.stitched;
  const clash = fresh.manifestItems.length > 0 || fresh.files.length > 0 || (fresh.stitched && !ownSlot);
  if (clash || fresh.records.length || fresh.landed.length) refuse(`${d} ${newItem} already has a picture or a file of its own, so ${oldItem} cannot take its name.`);

  // Every file move is planned and checked before anything changes.
  const moves = old.files.map(file => {
    const name = `${newItem}${file.rest}.${file.extension}`;
    const target = join(job.dir, ...file.folder.split('/'), name);
    if (existsSync(target)) refuse(`${file.folder}/${name} already exists, so nothing was renamed.`);
    return { from: join(job.dir, ...file.folder.split('/'), file.name), to: target };
  });

  const quoteFile = join(job.dir, ...facts.FACT_FILES.quote.split('/'));
  const quoteBefore = old.priced.length ? readFileSync(quoteFile, 'utf8') : null;
  const manifestBefore = old.manifestItems.length || old.stitched ? readFileSync(old.manifestFile, 'utf8') : null;
  const approvalBefore = old.priced.length ? facts.currentPriceApproval(job) : null;
  const done = [];
  let approvalFile = null;
  try {
    if (manifestBefore !== null) {
      const manifest = JSON.parse(manifestBefore);
      for (const entry of manifest.items || []) {
        if (!entry || facts.canonicalItem(entry.panel) !== oldItem) continue;
        entry.panel = newItem;
        if (typeof entry.file === 'string' && stemOf(entry.file).toLowerCase() === oldItem.toLowerCase()) {
          entry.file = entry.file.replace(new RegExp(`${escapeRegExp(stemOf(entry.file))}(\\.[^./\\\\]+)$`), `${newItem}$1`);
        }
      }
      if (Array.isArray(manifest.stitch?.order)) {
        const seen = new Set();
        manifest.stitch.order = manifest.stitch.order
          .map(id => (String(id).toLowerCase() === oldItem.toLowerCase() ? newItem : id))
          .filter(id => (seen.has(String(id).toLowerCase()) ? false : (seen.add(String(id).toLowerCase()), true)));
      }
      writeFileSync(old.manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    }
    for (const move of moves) {
      renameSync(move.from, move.to);
      done.push(move);
    }
    if (old.priced.length) {
      const renamed = old.priced.map(entry => {
        const parsed = facts.parseJobKey(entry.key);
        const next = { key: facts.formatJobKey({ jobId: job.jobId, deliverable: d, item: newItem, version: parsed.version }), provider: entry.provider, kind: entry.kind, deliverable: d, panel: newItem, credits: entry.credits };
        for (const field of ['estimateId', 'generationsCount', 'sample', 'lowResolutionAccepted', 'count']) if (entry[field] !== undefined) next[field] = entry[field];
        return next;
      });
      facts.saveQuote(job, renamed, { drop: old.priced.map(entry => facts.canonicalJobKey(entry.key)) });
      if (approvalBefore) {
        const current = facts.readQuote(job);
        const media = list => list.filter(entry => entry && !facts.isTranscriptionItem(entry));
        const totals = facts.quoteTotals(media(current.quote.items));
        if (!facts.sameTotals(totals, approvalBefore.approval.totals)) throw new InvalidInputError(`${oldItem} cannot be renamed under the same price.`);
        const oldKeys = old.priced.map(entry => facts.canonicalJobKey(entry.key));
        const written = facts.writePriceApproval(job, {
          quoteSha: current.sha256,
          decision: 'approved',
          totals,
          approvedAt: approvalBefore.approval.approvedAt ?? null,
          by: approvalBefore.approval.by ?? null,
          confirmedBy: approvalBefore.approval.confirmedBy ?? approvalBefore.approval.by ?? null,
          decidedAt: new Date().toISOString(),
          rekeyOf: oldKeys.length === 1 ? oldKeys[0] : oldKeys,
          carriedFrom: approvalBefore.n,
        });
        approvalFile = join(job.dir, ...written.file.split('/'));
        if (facts.currentPriceApproval(job)?.approval.rekeyOf === undefined) throw new InvalidInputError(`${oldItem} could not be renamed. Try once more.`);
      }
    }
  } catch (error) {
    if (approvalFile) rmSync(approvalFile, { force: true });
    if (quoteBefore !== null) writeFileSync(quoteFile, quoteBefore, 'utf8');
    if (manifestBefore !== null) writeFileSync(old.manifestFile, manifestBefore, 'utf8');
    for (const move of done.reverse()) renameSync(move.to, move.from);
    throw error;
  }

  const kind = old.priced[0]?.kind || old.manifestItems[0]?.kind || 'image';
  const words = `${kindWords(kind)} ${oldItem} is now ${newItem} in ${d}. Nothing had been spent on it.`;
  const at = new Date().toISOString();
  try {
    appendFileSync(join(job.dir, 'events.jsonl'), `${JSON.stringify(events.makeEvent(job.jobId, 'operation.completed', at, { type: 'panel', id: `${d}-${newItem}` }, { operationType: 'panel_rekey', status: 'completed', deliverable: d, from: oldItem, to: newItem }, { jobId: job.jobId, source: 'local' }))}\n`, 'utf8');
  } catch { /* the rename stands without its event line */ }
  // A renamed price that was not yet approved is a different card now: the one the person may have seen still shows the old name.
  const reshow = old.priced.length > 0 && !approvalBefore;
  noteOnJob(job.dir, 'panel_rekey', words);
  return {
    renamed: true,
    jobId: job.jobId,
    deliverable: d,
    from: oldItem,
    to: newItem,
    price: old.priced.length > 0,
    approvalKept: Boolean(approvalBefore),
    manifest: manifestBefore !== null,
    files: moves.map(move => move.to.slice(job.dir.length + 1).split('\\').join('/')),
    message: reshow ? `${words} The price card changed, so show the price again (pipeline_review_present) before the person taps.` : words,
    ...(reshow ? { showPriceAgain: true } : {}),
  };
}
