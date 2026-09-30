/**
 * Starting point: scratch, a reference, or creative the user already has.
 *
 * This is the answer that decides how much of the pipeline the job actually needs,
 * so it gets its own screen rather than being buried in the intake form.
 */

import { armTileGroup, button, el, hero, tile } from './dom.js';

/** The icon on each starting point card. */
const START_ICON = {
  scratch: 'pencil',
  reference: 'link',
  existing_creative: 'folder',
};

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = el('div', { class: 'screen' }, [
    hero(String(data.title ?? 'What are you starting with?'), data.intro ? String(data.intro) : undefined),
  ]);

  const tiles = el('div', { class: 'tiles' });
  const cards = Array.isArray(data.cards) ? data.cards : [];
  for (const entry of cards) {
    tiles.append(
      tile({
        title: String(entry.title ?? ''),
        body: String(entry.body ?? ''),
        icon: START_ICON[String(entry.starting_point)] ?? 'chevron',
        onClick: () =>
          act('select_starting_point', {
            starting_point: String(entry.starting_point),
            job_type: data.job_type ?? null,
            campaign_id: data.campaign_id ?? null,
          }),
      }),
    );
  }
  armTileGroup(tiles);
  root.append(tiles);

  root.append(el('div', { class: 'actions' }, [button('Back', () => act('back'))]));

  setTimeout(() => {
    const first = root.querySelector('.tile');
    if (first instanceof HTMLElement) first.focus();
  }, 0);

  return root;
}
