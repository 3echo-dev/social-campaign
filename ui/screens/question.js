/**
 * A question asked in the pane instead of in chat: the question, its options as
 * selectable cards, an optional free text answer, and a Submit button. This is what
 * `question_ask` opens, so decisions a person would otherwise be asked in chat stay
 * where every other decision in this product happens: a click in the pane.
 */

import { button, card, el, textarea } from './dom.js';

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'A question', data.question ?? '');
  if (data.context) root.append(el('p', { class: 'muted' }, [String(data.context)]));

  const options = Array.isArray(data.options) ? data.options : [];
  let selectedId = null;

  const stack = el('div', { class: 'stack' });
  /** @type {Map<string, HTMLElement>} */
  const optionNodes = new Map();

  for (const option of options) {
    const id = String(option.id ?? '');
    const optionEl = el('button', { type: 'button', class: 'option question-option', 'data-selected': 'false' }, [
      el('h3', {}, [String(option.label ?? id)]),
    ]);
    if (option.description) optionEl.append(el('p', { class: 'muted' }, [String(option.description)]));
    optionEl.addEventListener('click', () => {
      selectedId = id;
      for (const [otherId, node] of optionNodes) node.setAttribute('data-selected', String(otherId === id));
    });
    optionNodes.set(id, optionEl);
    stack.append(optionEl);
  }
  root.append(stack);

  let otherField = null;
  if (data.allow_other) {
    const { wrap, field } = textarea('question-other', 'Or write your own answer', {
      placeholder: 'Type an answer of your own.',
      rows: 2,
    });
    otherField = field;
    root.append(wrap);
  }

  root.append(
    el('div', { class: 'actions' }, [
      button(
        'Submit',
        () => {
          const text = otherField ? otherField.value.trim() : '';
          if (!selectedId && text.length === 0) return;
          act('submit', { option_id: selectedId, text });
        },
        { primary: true },
      ),
    ]),
  );

  return root;
}
