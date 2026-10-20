/**
 * The "Ready check" on a review card: a short list of checks, each { label, ok, level }.
 * level 'required': a red one holds the Approve button. level 'warning': shown in amber, never holds anything.
 *
 * Nothing here decides a rule of its own. Each line is computed from the function that enforces it
 * (facts.mediaBlocker, facts.pricePending, facts.mediaSetApproved, facts.FINAL_MIN_HEIGHT, the storyboard gaps that
 * registerBoardReview refuses on, the posting plan's own destination and readiness) so the card and the server agree.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as facts from './facts.mjs';

const line = (label, ok, level = 'required') => ({ label, ok: Boolean(ok), level });

const BLOCKER_WORDS = Object.freeze({
  pictures: 'Storyboard pictures approved',
  clips: 'Video clips approved',
  cut: 'Rough cut approved',
  finish: 'Finished video approved',
  finishing: 'Sound for the video chosen',
});

function hasVideo(job) {
  return facts.reviewSet(job, 'cut').panels.length > 0 || facts.mediaSet(job, 'video').panels.length > 0 || facts.mediaReviewRequired(job, 'finish');
}

// The post text and the posting plan wait for the video: the same answer mediaBlocker gives the approval.
function videoApproved(job) {
  if (!hasVideo(job)) return [];
  const blocker = facts.mediaBlocker(job);
  return [line(blocker ? BLOCKER_WORDS[blocker] || 'Finished video approved' : 'Finished video approved', !blocker)];
}

function sampleApproved(job) {
  let decision = null;
  try { decision = JSON.parse(readFileSync(join(job.dir, 'approvals', 'sample.json'), 'utf8')); } catch { return []; }
  return [line('Sample approved', decision?.decision === 'approve')];
}

function priceApproved(job) {
  const quote = facts.readQuote(job);
  if (!quote || !quote.quote.items.some(item => item && !facts.isTranscriptionItem(item))) return [];
  return [line('Price approved', !facts.pricePending(job).media)];
}

// A final clip is made at 720p or better (facts.FINAL_MIN_HEIGHT); one below it is there only when the person chose it.
function clipResolution(job) {
  const items = (facts.readQuote(job)?.quote?.items || []).filter(item => item?.kind === 'video' && item.sample !== true && facts.resolutionHeight(item.resolution) !== null);
  if (!items.length) return [];
  const low = items.filter(item => facts.resolutionHeight(item.resolution) < facts.FINAL_MIN_HEIGHT);
  if (!low.length) return [line('Clips at 720p or higher', true)];
  const unchosen = low.some(item => item.lowResolutionAccepted !== true);
  return [unchosen ? line('Clips at 720p or higher', false) : line('Some clips are below 720p, as you chose', false, 'warning')];
}

function priced(job) {
  const items = facts.readQuote(job)?.quote?.items;
  return Array.isArray(items) && items.length ? [line('Every item has a price', items.every(item => Number.isFinite(Number(item?.credits))))] : [];
}

const POSTING_LABEL = 'Posting plan ready';

function publishLines(publish) {
  if (!publish || typeof publish !== 'object') return [line(POSTING_LABEL, false)];
  const out = [line(POSTING_LABEL, publish.ready === true && !publish.outdated && !publish.changed)];
  const seen = new Set();
  for (const post of Array.isArray(publish.posts) ? publish.posts : []) {
    const dest = post?.destination;
    if (!dest || typeof dest.text !== 'string' || !dest.text || seen.has(dest.text)) continue;
    seen.add(dest.text);
    if (dest.ok === false) out.push(line(dest.text, false));
    else {
      out.push(line(`Posting to ${dest.text}`, true));
      // The handle does not match the brand's own: amber, and the post may still go (0.16.11).
      if (dest.warn && typeof dest.warning === 'string' && dest.warning) out.push(line(dest.warning, false, 'warning'));
    }
  }
  return out;
}

/**
 * @param {object} args
 * @param {string} args.gate     the review's gate
 * @param {object} args.job      facts.jobAt(...)
 * @param {object} [args.review] the projected card (document.review)
 * @param {object} [args.gaps]   the storyboard gaps ({ asked, panels, unanswered, lacking }) for the storyboard gate
 */
export function readyChecks({ gate, job, review = null, gaps = null }) {
  if (!job) return [];
  switch (gate) {
    case 'storyboard': {
      const out = [];
      if (gaps?.asked) out.push(line('Voice-over answered', !gaps.unanswered.length));
      // The price on the card follows the answer to the sound plan question, so an open one holds the Approve button.
      if (gaps?.soundOpen?.length) out.push(line('Sound plan answered', false));
      if (gaps?.panels) out.push(line('Every panel has a picture', !gaps.lacking.length));
      return out;
    }
    case 'price':
      return [...priced(job), ...clipResolution(job)];
    case 'sample':
      return [line('Sample made', true)];
    case 'pictures':
      return [...sampleApproved(job), ...priceApproved(job)];
    case 'clips':
      return [...sampleApproved(job), ...priceApproved(job), ...(facts.mediaReviewRequired(job, 'pictures') ? [line('Storyboard pictures approved', facts.mediaSetApproved(job, 'pictures'))] : []), ...clipResolution(job)];
    case 'cut':
      return [...(facts.mediaReviewRequired(job, 'clips') ? [line('Video clips approved', facts.mediaSetApproved(job, 'clips'))] : [])];
    case 'finish':
      return [line('Rough cut approved', facts.mediaSetApproved(job, 'cut')), line('Sound for the video chosen', Boolean(facts.finishingRecord(job)))];
    case 'content': {
      const out = [...videoApproved(job)];
      if (review?.checks) out.push(line('Every post passes its checks', review.checks.ready === true));
      else if (review?.labelCheck) out.push(line('Labels and logos checked', !['missing', 'stale'].includes(review.labelCheck.state)));
      return out;
    }
    case 'publish':
      return [...videoApproved(job), ...publishLines(review?.publish)];
    default:
      return [];
  }
}
