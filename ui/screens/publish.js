/**
 * Publish status: scheduled, published or exported, with links. Shown after the
 * final gate is resolved and the Publisher has done its work.
 *
 * An exported package lives in a folder named after the job's internal id, so the
 * screen says where it is in words and offers the folder address to copy, rather
 * than printing a path with an id in it.
 */

import { button, card, costCard, el, jobStatsBlock, phaseStrip, PLATFORM_LABEL, postCard } from './dom.js';

/** What happened to a post, in the words a person would use. */
const STATUS_LABEL = {
  scheduled: 'Scheduled',
  published: 'Published',
  exported: 'Ready to upload by hand',
  failed: 'Did not go out',
};

/**
 * The durable per post attempt state, in plain words. This is what the screen says
 * where there is one, because the aggregate outcome cannot tell "we do not know"
 * apart from "it failed", and only one of those is safe to send again.
 */
const ATTEMPT_LABEL = {
  pending: 'Sent',
  accepted: 'Sent',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Did not go out',
  unknown: 'Unclear',
};

/** One line of what each attempt state means for the person. */
const ATTEMPT_NOTE = {
  unknown: 'We could not tell whether this one went out. Check with your publishing service before sending it again.',
  failed: 'This one did not go out. You can try it again on its own.',
  pending: 'This one was sent and the service has not confirmed it yet.',
};

/** One line for the whole result. */
const OUTCOME_LINE = {
  scheduled: 'Your posts are scheduled.',
  published: 'Your posts are live.',
  exported: 'You will find the package in the outputs folder of your Social Campaign workspace.',
  failed: 'Some posts did not go out; each one says why below.',
};

/**
 * Copy text, with the clipboard API first and the older copy command second, because
 * an embedded pane may allow one and not the other.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const scratch = /** @type {HTMLTextAreaElement} */ (el('textarea', { 'aria-hidden': 'true', class: 'offscreen' }));
    scratch.value = text;
    document.body.append(scratch);
    scratch.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    scratch.remove();
    return copied;
  }
}

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Publishing', data.summary ?? '');
  if (data.phase) root.prepend(phaseStrip(String(data.phase), { phases: data.phases }));
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const brandName = typeof data.brand_name === 'string' && data.brand_name.trim() ? data.brand_name.trim() : 'Your brand';

  // The finished deliverable per platform sits at the top, in the same preview
  // treatment as final review, so the person never lands here with only a status
  // list and nothing to look at.
  const hasDeliverable = posts.some((post) => post && (post.caption || post.media));
  if (hasDeliverable) {
    const grid = el('div', { class: 'asset-grid' });
    for (const post of posts) grid.append(postCard(post, brandName));
    root.append(grid);
  }

  if (data.outcome && OUTCOME_LINE[data.outcome]) {
    root.append(el('p', { class: 'publish-outcome' }, [OUTCOME_LINE[data.outcome]]));
  }

  const stack = el('div', { class: 'stack' });
  for (const post of posts) {
    const platform = String(post.platform ?? '');
    const node = el('div', { class: 'option publish-post' }, [
      el('div', { class: 'publish-post-head' }, [
        el('span', { class: 'publish-platform' }, [PLATFORM_LABEL[platform] ?? platform]),
        el('span', { class: 'publish-status', 'data-status': String(post.attempt_state ?? post.status ?? '') }, [
          ATTEMPT_LABEL[post.attempt_state] ?? STATUS_LABEL[post.status] ?? String(post.status ?? ''),
        ]),
      ]),
    ]);
    if (post.attempt_state && ATTEMPT_NOTE[post.attempt_state]) {
      node.append(el('p', { class: 'muted' }, [ATTEMPT_NOTE[post.attempt_state]]));
    }
    if (post.scheduled_for) node.append(el('p', { class: 'muted' }, [`Scheduled for ${post.scheduled_for}`]));
    if (post.published_at) node.append(el('p', { class: 'muted' }, [`Published at ${post.published_at}`]));
    if (post.post_url) {
      const link = /** @type {HTMLAnchorElement} */ (
        el('a', { href: post.post_url, target: '_blank', rel: 'noreferrer noopener' }, ['View post'])
      );
      node.append(link);
    }
    if (post.error) node.append(el('p', { class: 'banner', 'data-tone': 'error' }, [String(post.error)]));
    stack.append(node);
  }
  root.append(stack);

  // The same cost card final review shows, so the person sees what publishing did
  // not add to the bill.
  const secondary = el('div', { class: 'job-secondary-stats' });
  const cost = costCard(data.cost ?? null);
  if (cost) secondary.append(cost);
  const stats = jobStatsBlock(data.stats ?? null);
  if (stats) secondary.append(stats);
  if (cost || stats) root.append(secondary);

  const actions = el('div', { class: 'actions' }, [button('Done', () => act('cancel', {}), { primary: true })]);
  if (data.can_retry_failed) {
    actions.append(button('Retry the failed ones', () => act('retry_failed', { release_id: data.release_id ?? null })));
  }
  if (data.needs_check_with_provider) {
    actions.append(button('Check with the provider', () => act('check_with_provider', { release_id: data.release_id ?? null })));
  }
  if (data.export_path) {
    const folder = String(data.export_path);
    const copy = button('Copy the folder address', async () => {
      if (await copyText(folder)) {
        copy.textContent = 'Copied. Paste it into File Explorer or Finder.';
        return;
      }
      // Some panes do not allow copying at all: show the address, selected, so it
      // can be copied by hand.
      const field = /** @type {HTMLInputElement} */ (el('input', { type: 'text', readonly: 'true', class: 'publish-folder', 'aria-label': 'Folder address' }));
      field.value = folder;
      copy.replaceWith(field);
      field.focus();
      field.select();
    });
    actions.append(copy);
  }
  root.append(actions);

  return root;
}
