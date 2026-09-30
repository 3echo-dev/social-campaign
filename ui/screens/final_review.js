/**
 * Final review gate: a per-platform post preview - caption, hashtags, media,
 * schedule - as a light mock of an FB/IG/TikTok post card. Below it, a "what this
 * job cost" card and the job time/tokens line. Approve (with an optional schedule
 * datetime), request changes, or reject.
 */

import { button, card, costCard, el, jobStatsBlock, phaseStrip, postCard, textarea } from './dom.js';

/**
 * A final-review post card: the shared deliverable card, plus the schedule line
 * this screen alone shows.
 * @param {any} post
 * @param {string} brandName
 * @returns {HTMLElement}
 */
function finalPostCard(post, brandName, intent) {
  const frozen = Array.isArray(intent?.posts)
    ? intent.posts.find((entry) => Number(entry?.post_index) === Number(post?.post_index))
    : null;
  const utcSchedule = frozen?.scheduled_at ?? post.scheduled_for ?? null;
  const originalTimezone = intent?.original_timezone ?? intent?.timezone ?? null;
  const localSchedule = post.scheduled_for && post.scheduled_for !== utcSchedule
    ? ` (${originalTimezone ? `${originalTimezone}: ` : ''}${post.scheduled_for})`
    : '';
  return postCard(post, brandName, [
    el('p', { class: 'post-card-destination' }, [
      post.account_id ? `Account ${post.account_id}` : 'No account selected',
    ]),
    el('p', { class: 'post-card-schedule' }, [
      utcSchedule ? `Scheduled for ${utcSchedule} UTC${localSchedule}` : 'No schedule set yet',
    ]),
  ]);
}

/**
 * Show the destination and action that the approval covers, next to the exact
 * deliverables.  An incomplete legacy release is called out so it cannot look
 * like a provider-bound approval by accident.
 * @param {any} intent
 * @returns {HTMLElement}
 */
function intentBlock(intent) {
  if (!intent || typeof intent !== 'object') {
    return el('div', { class: 'banner', 'data-tone': 'warning' }, [
      'No publishing destination or action has been frozen for this release yet. External publishing needs a new intent-bearing review.',
    ]);
  }
  const provider = intent.provider ? String(intent.provider) : 'No provider selected';
  const mode = intent.mode === 'schedule' ? 'Schedule' : intent.mode === 'publish' ? 'Publish now' : 'Action not selected';
  const timezone = intent.timezone ? String(intent.timezone) : 'No timezone selected';
  const original = intent.original_timezone && String(intent.original_timezone) !== timezone ? ` (entered as ${intent.original_timezone})` : '';
  const complete = Boolean(intent.provider && intent.mode && intent.timezone);
  return el('div', { class: complete ? 'release-intent' : 'release-intent release-intent-warning' }, [
    el('h3', { class: 'release-intent-title' }, ['Publishing decision']),
    el('p', { class: 'release-intent-line' }, [`Provider: ${provider}`]),
    el('p', { class: 'release-intent-line' }, [`Action: ${mode}`]),
    el('p', { class: 'release-intent-line' }, [`Schedule timezone: ${timezone}${original}`]),
    complete
      ? null
      : el('p', { class: 'hint' }, ['Choose the missing destination, action, or timezone before external publishing.']),
  ].filter(Boolean));
}

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Review before publishing', data.summary ?? '');
  if (data.phase) root.prepend(phaseStrip(String(data.phase), { phases: data.phases }));
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const brandName = typeof data.brand_name === 'string' && data.brand_name.trim() ? data.brand_name.trim() : 'Your brand';

  // An approval is given to one exact version of this work, so the screen says which
  // version it is and that approving covers that version only. If the release has
  // moved on since it was approved, the banner says approval is needed again rather
  // than leaving the person to assume the old yes still stands.
  if (data.release_version) {
    root.append(
      el('p', { class: 'muted' }, [
        `Version ${data.release_version} of this campaign. Approving is for this exact version: the captions and the files shown here.`,
      ]),
    );
  }
  if (data.needs_reapproval) {
    root.append(
      el('p', { class: 'banner', 'data-tone': 'warning' }, [
        'Something changed after this was approved, so it needs approving again before anything goes out.',
      ]),
    );
  }

  root.append(intentBlock(data.intent));

  const grid = el('div', { class: 'asset-grid' });
  for (const post of posts) grid.append(finalPostCard(post, brandName, data.intent));
  root.append(grid);

  // The cost card and the job time/tokens line sit together as the job's secondary
  // stats, below the deliverables and above the approve/reject actions, so cost is
  // never separated from what it paid for.
  const secondary = el('div', { class: 'job-secondary-stats' });
  const cost = costCard(data.cost ?? null);
  if (cost) secondary.append(cost);
  const stats = jobStatsBlock(data.stats ?? null);
  if (stats) secondary.append(stats);
  if (cost || stats) root.append(secondary);

  // A legacy release can still use the picker for a manual export decision. Once a
  // provider intent exists, timing is already frozen and the person sees that exact
  // UTC value on each post rather than editing a second, unbound schedule field.
  let scheduleField = null;
  if (!data.intent || typeof data.intent !== 'object') {
    scheduleField = /** @type {HTMLInputElement} */ (el('input', { type: 'datetime-local', id: 'final-schedule' }));
    root.append(
      el('div', { class: 'field schedule-field' }, [
        el('label', { for: 'final-schedule' }, ['Schedule for (optional)']),
        scheduleField,
        el('p', { class: 'hint' }, ['Leave this empty to publish as soon as you approve.']),
      ]),
    );
  } else {
    root.append(el('p', { class: 'hint release-intent-frozen' }, [
      data.intent.mode === 'schedule'
        ? 'The approved UTC schedule is fixed on each post above.'
        : 'The approved action is publish now.',
    ]));
  }

  const { wrap: notesWrap, field: notesField } = textarea('final-notes', 'Notes', {
    placeholder: 'What should change, or why this does not work.',
  });
  root.append(notesWrap);

  root.append(
    el('div', { class: 'actions' }, [
      button(
        'Approve',
        () => act('approve', { schedule: scheduleField ? scheduleField.value.trim() || null : null }),
        { primary: true },
      ),
      button('Request changes', () => act('request_changes', { notes: notesField.value.trim() })),
      button('Reject', () => act('reject', { notes: notesField.value.trim() })),
    ]),
  );

  return root;
}
