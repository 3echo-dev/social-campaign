/**
 * A plain message. Used for progress notes and for anything that needs no decision.
 */

import { button, card, el } from './dom.js';

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Social Campaign');
  const tone = String(data.tone ?? 'neutral');
  if (data.body) {
    const body = el('p', {}, [String(data.body)]);
    if (tone !== 'neutral') {
      body.className = 'banner';
      body.setAttribute('data-tone', tone);
    }
    root.append(body);
  }
  if (data.dismissible) {
    root.append(el('div', { class: 'actions' }, [button('OK', () => act('ok'), { primary: true })]));
  }
  return root;
}
