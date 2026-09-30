/**
 * New job: the four kinds of job, spec section 6.
 *
 * Same tile grammar as home, so moving from the home screen into a job does not
 * feel like moving into a different application.
 */

import { armTileGroup, button, el, hero, tile } from './dom.js';

/** The icon on each job type card. */
const JOB_ICON = {
  social_post: 'post',
  ad_campaign: 'megaphone',
  ugc: 'person',
  analyze_existing: 'search',
};

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = el('div', { class: 'screen' }, [
    hero(String(data.title ?? 'Start a new job'), data.intro ? String(data.intro) : undefined),
  ]);

  const tiles = el('div', { class: 'tiles' });
  const cards = Array.isArray(data.cards) ? data.cards : [];
  for (const entry of cards) {
    tiles.append(
      tile({
        title: String(entry.title ?? ''),
        body: String(entry.body ?? ''),
        icon: JOB_ICON[String(entry.job_type)] ?? 'chevron',
        onClick: () => act('select_job_type', { job_type: String(entry.job_type) }),
      }),
    );
  }
  armTileGroup(tiles);
  root.append(tiles);

  root.append(el('div', { class: 'actions' }, [button('Cancel', () => act('cancel'))]));

  setTimeout(() => {
    const first = root.querySelector('.tile');
    if (first instanceof HTMLElement) first.focus();
  }, 0);

  return root;
}
