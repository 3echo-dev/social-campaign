/**
 * Switch workspace.
 *
 * Lists every workspace this computer has ever set up: name, path, last used, and
 * which one is active right now. A person can pick one, remove a stale entry (never
 * deletes files, only forgets it), or create a new one, which reuses the folder
 * picker from setup. Reached from a small link on the home screen.
 */

import { button, el, hero } from './dom.js';
import { folderPicker } from './folder_picker.js';

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const screen = el('div', { class: 'screen' }, [
    hero(String(data.title ?? 'Switch workspace'), String(data.intro ?? 'Pick which workspace Social Campaign should use.')),
  ]);

  const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  const activeRoot = data.activeRoot ? String(data.activeRoot) : null;

  if (workspaces.length === 0) {
    screen.append(el('section', { class: 'card' }, [el('p', { class: 'muted' }, ['No other workspaces on this computer yet.'])]));
  } else {
    for (const entry of workspaces) {
      const root = String(entry.root ?? '');
      const isActive = root === activeRoot;
      const row = el('section', { class: 'card' }, [
        el('div', {}, [
          String(entry.name ?? root),
          isActive ? el('span', { class: 'option-chip', 'data-state': 'ready' }, ['Active']) : '',
        ]),
        el('p', { class: 'path' }, [root]),
        entry.lastUsed ? el('p', { class: 'muted' }, [`Last used ${String(entry.lastUsed)}`]) : '',
      ]);

      if (!isActive) {
        row.append(
          el('div', { class: 'actions' }, [
            button('Use this workspace', () => act('activate', { root }), { primary: true }),
            button('Remove from list', () => act('forget', { root })),
          ]),
        );
      }
      screen.append(row);
    }
  }

  const createCard = el('section', { class: 'card' }, [
    el('h3', {}, ['Set up a new workspace']),
  ]);
  const picker = folderPicker({
    value: String(data.defaultRoot ?? ''),
    allowCreate: true,
    selectionLabel: 'New workspace will use:',
    idPrefix: 'switch-new',
  });
  createCard.append(picker.element);
  createCard.append(
    el('div', { class: 'actions' }, [
      button('Create workspace here', () => {
        const chosen = picker.value();
        if (chosen.length === 0) {
          picker.focus();
          return;
        }
        act('create_new', { root: chosen });
      }),
    ]),
  );
  screen.append(createCard);

  screen.append(el('div', { class: 'actions' }, [button('Back', () => act('back'))]));

  return screen;
}
