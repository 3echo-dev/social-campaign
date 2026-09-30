/**
 * Research in progress: a plain list of steps and their status. Not a gate, no
 * decision is required, but a Cancel action exists if the user wants to stop.
 */

import { button, card, el, phaseStrip } from './dom.js';

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Researching');
  if (data.phase) root.prepend(phaseStrip(String(data.phase), { phases: data.phases }));
  const steps = Array.isArray(data.steps) ? data.steps : [];

  const list = el(
    'ul',
    { class: 'steps' },
    steps.map((step) =>
      el('li', { 'data-status': String(step.status ?? 'pending') }, [
        el('span', { class: 'step-dot' }),
        String(step.name ?? ''),
      ]),
    ),
  );
  root.append(list);

  root.append(el('div', { class: 'actions' }, [button('Cancel', () => act('cancel', {}))]));

  return root;
}
