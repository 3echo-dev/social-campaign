/**
 * Concept review gate: ranked UGC or ad concepts, plus copy if there is a
 * CopyPackage attached. Approve, request changes, or reject.
 */

import { button, card, el, phaseStrip, textarea } from './dom.js';

/** Platform names written the way the platforms write them. */
const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Review the concepts');
  if (data.phase) root.prepend(phaseStrip(String(data.phase), { phases: data.phases }));
  const concepts = Array.isArray(data.concepts) ? data.concepts : [];

  const stack = el('div', { class: 'stack' });
  concepts.forEach((concept, index) => {
    const node = el('div', { class: 'option' }, [
      el('span', { class: 'tag' }, [`Concept ${index + 1}`]),
      el('h3', {}, [String(concept.title ?? concept.name ?? `Concept ${index + 1}`)]),
    ]);
    if (concept.persona) node.append(el('p', { class: 'muted' }, [`Persona: ${concept.persona}`]));
    if (concept.hook) node.append(el('p', {}, [String(concept.hook)]));
    if (concept.cta) node.append(el('p', { class: 'muted' }, [`CTA: ${concept.cta}`]));
    stack.append(node);
  });
  root.append(stack);

  const copyPackage = data.copy_package;
  if (copyPackage && Array.isArray(copyPackage.variants) && copyPackage.variants.length > 0) {
    root.append(el('h3', { class: 'section-title' }, ['Copy']));
    const copyStack = el('div', { class: 'stack' });
    for (const variant of copyPackage.variants) {
      copyStack.append(
        el('div', { class: 'option' }, [
          el('span', { class: 'tag' }, [PLATFORM_LABEL[variant.platform] ?? String(variant.platform ?? '')]),
          el('p', {}, [String(variant.caption ?? '')]),
          el('p', { class: 'muted' }, [String(variant.cta ?? '')]),
        ]),
      );
    }
    root.append(copyStack);
  }

  const { wrap: notesWrap, field: notesField } = textarea('concept-notes', 'Notes', {
    placeholder: 'What should change, or why this does not work.',
  });
  root.append(notesWrap);

  root.append(
    el('div', { class: 'actions' }, [
      button('Approve', () => act('approve', {}), { primary: true }),
      button('Request changes', () => act('request_changes', { notes: notesField.value.trim() })),
      button('Reject', () => act('reject', { notes: notesField.value.trim() })),
    ]),
  );

  return root;
}
