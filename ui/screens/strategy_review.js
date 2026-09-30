/**
 * Strategy review gate: exactly three campaign directions, each with its name,
 * summary, rationale, evidence and platform notes. The user approves one, asks for
 * changes, combines directions, or rejects the whole set.
 */

import { button, card, el, phaseStrip, textarea } from './dom.js';

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Review the strategy', data.summary ?? '');
  if (data.phase) root.prepend(phaseStrip(String(data.phase), { phases: data.phases }));
  if (data.coverage_note) {
    root.append(el('p', { class: 'muted' }, [String(data.coverage_note)]));
  }
  const directions = Array.isArray(data.directions) ? data.directions : [];

  let selectedKey = null;
  /** @type {Set<string>} */
  const combineKeys = new Set();

  const stack = el('div', { class: 'stack' });
  const optionNodes = new Map();
  /** @type {Map<string, HTMLButtonElement>} */
  const chooseButtons = new Map();

  for (const direction of directions) {
    const key = String(direction.key ?? direction.title ?? '');
    const title = String(direction.title ?? key);
    const modeLabel = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const children = [];
    // Only show the mode label chip when it says something the title does not already
    // say, so a direction titled exactly "Brand Native" does not read as "Brand Native /
    // Brand Native".
    if (modeLabel.toLowerCase() !== title.trim().toLowerCase()) {
      children.push(el('span', { class: 'tag' }, [modeLabel]));
    }
    children.push(
      el('h3', {}, [title]),
      el('p', {}, [String(direction.angle ?? '')]),
      el('p', { class: 'muted' }, [String(direction.rationale ?? '')]),
    );
    const optionEl = el('div', { class: 'option', 'data-selected': 'false' }, children);

    const evidence = Array.isArray(direction.evidence) ? direction.evidence : [];
    if (evidence.length > 0) {
      optionEl.append(
        el(
          'ul',
          {},
          evidence.map((entry) => el('li', {}, [String(entry.claim ?? '')])),
        ),
      );
    }

    const platformNotes = Array.isArray(direction.platform_notes) ? direction.platform_notes : [];
    if (platformNotes.length > 0) {
      optionEl.append(el('p', { class: 'muted' }, [`Platform notes: ${platformNotes.join(', ')}`]));
    }

    // Both are toggles: aria-pressed says which direction is chosen and which are in
    // the combine set, and draws them gold.
    const chooseButton = button(
      'Choose this direction',
      () => {
        selectedKey = key;
        for (const [otherKey, node] of optionNodes) {
          node.setAttribute('data-selected', String(otherKey === key));
          chooseButtons.get(otherKey)?.setAttribute('aria-pressed', String(otherKey === key));
        }
      },
      { pressed: false },
    );
    chooseButtons.set(key, chooseButton);
    const combineButton = button(
      combineKeys.has(key) ? 'Remove from combine' : 'Add to combine',
      () => {
        if (combineKeys.has(key)) combineKeys.delete(key);
        else combineKeys.add(key);
        combineButton.textContent = combineKeys.has(key) ? 'Remove from combine' : 'Add to combine';
        combineButton.setAttribute('aria-pressed', String(combineKeys.has(key)));
      },
      { variant: 'add', pressed: combineKeys.has(key) },
    );
    const rowActions = el('div', { class: 'row-actions' }, [chooseButton, combineButton]);
    optionEl.append(rowActions);

    optionNodes.set(key, optionEl);
    stack.append(optionEl);
  }
  root.append(stack);

  const { wrap: notesWrap, field: notesField } = textarea(
    'strategy-notes',
    'Notes (for request changes, combine, or reject)',
    { placeholder: 'What should change, or why this does not work yet.' },
  );
  root.append(notesWrap);

  root.append(
    el('div', { class: 'actions' }, [
      button(
        'Approve selected',
        () => {
          if (!selectedKey) return;
          act('approve', { direction: selectedKey });
        },
        { primary: true },
      ),
      button('Combine directions', () => {
        if (combineKeys.size < 2) return;
        act('combine', { directions: [...combineKeys], notes: notesField.value.trim() });
      }),
      button('Request changes', () => act('request_changes', { notes: notesField.value.trim() })),
      button('Reject', () => act('reject', { notes: notesField.value.trim() })),
    ]),
  );

  return root;
}
