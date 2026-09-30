/**
 * Social Campaign home: the three actions plus a quiet connection strip.
 *
 * The strip shows capability names in user words - Image & Video, Voice & Audio,
 * Publishing - never provider internals, and it never blocks the three cards.
 */

import { armTileGroup, el, hero, tile } from './dom.js';

const STATE_TEXT = {
  ready: 'Connected',
  degraded: 'Partly connected',
  not_connected: 'Not connected',
  unavailable: 'Unavailable',
  not_needed: 'Not needed',
};

/** The icon on each home card, by the action it starts. */
const ACTION_ICON = {
  start_job: 'plus',
  onboard_brand: 'sparkle',
  build_library: 'library',
};

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = el('div', { class: 'screen' }, [
    hero(String(data.title ?? 'What would you like to do?'), data.intro ? String(data.intro) : undefined, { plain: true }),
  ]);

  const tiles = el('div', { class: 'tiles' });
  const cards = Array.isArray(data.cards) ? data.cards : [];
  for (const entry of cards) {
    tiles.append(
      tile({
        title: String(entry.title ?? ''),
        body: String(entry.body ?? ''),
        icon: ACTION_ICON[String(entry.action)] ?? 'chevron',
        onClick: () => act(String(entry.action)),
      }),
    );
  }
  armTileGroup(tiles);
  root.append(tiles);

  // Each connector is an option chip: what it is on top, whether it is connected
  // underneath, with the dot saying the same thing in colour.
  const connections = Array.isArray(data.connections) ? data.connections : [];
  if (connections.length > 0) {
    const strip = el('div', { class: 'strip' });
    for (const connection of connections) {
      const state = String(connection.state ?? 'not_connected');
      strip.append(
        el('span', { class: 'option-chip', 'data-state': state, title: String(connection.provider ?? '') }, [
          el('span', { class: 'option-chip-label' }, [
            el('span', { class: 'dot' }),
            String(connection.label ?? ''),
            // Read as one sentence, "Image & Video: Not connected", as it always was.
            el('span', { class: 'sr-only' }, [':']),
          ]),
          el('span', { class: 'option-chip-value' }, [STATE_TEXT[state] ?? state]),
        ]),
      );
    }
    // One quiet link at the end of the strip, so the whole Connectors screen is
    // one click from home rather than something only setup ever showed.
    if (data.connectionsLink) {
      strip.append(
        el('button', { type: 'button', class: 'link', 'data-action': 'open_connections' }, [String(data.connectionsLink)]),
      );
      strip.lastElementChild.addEventListener('click', () => act('open_connections'));
    }
    root.append(strip);
  }

  if (data.researchNote) {
    const note = el('p', { class: 'hint' }, [String(data.researchNote)]);
    // Only a failed install gets the button: nothing to fix while one is still
    // installing, and nothing to fix once it is either installed or was never
    // attempted, which is why data.researchNote is null in both those cases.
    if (data.researchNoteFailed) {
      const fixButton = el('button', { type: 'button', class: 'link' }, ['Ask chat to fix it']);
      fixButton.addEventListener('click', () =>
        act('fix_in_chat', { item: 'research_helper', reason: String(data.researchNote) }),
      );
      note.append(' ', fixButton);
    }
    root.append(note);
  }


  return root;
}
