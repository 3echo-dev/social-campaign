/**
 * Placeholder for a screen type that is not built yet.
 *
 * Every screen type from spec section 22 is registered in ui/app.js so a tool can
 * show it without crashing the pane. Replacing a stub means writing
 * ui/screens/<type>.js with the same render(data, act) shape and pointing the
 * SCREENS map at it. The accepted actions for the screen are already declared in
 * SCREEN_ACTIONS in server/ui/server.mjs.
 */

import { card, el } from './dom.js';

/**
 * @param {string} label
 * @returns {(data: any, act: (action: string, payload?: any) => void) => HTMLElement}
 */
export function stub(label) {
  return (data) => {
    const root = card(data.title ?? label);
    root.className = 'card stub';
    root.append(el('p', { class: 'muted' }, [`The ${label} screen is not built yet.`]));
    root.append(
      el('p', { class: 'hint' }, ['Claude will keep working in the chat while this screen is being built.']),
    );
    return root;
  };
}
