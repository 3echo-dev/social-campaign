/**
 * Finished research results, shown for context before strategy runs. Leads with what
 * was found, not what failed: a coverage status line, one card per section with its
 * findings and a "so what," and what could not be checked collapsed out of the way
 * unless there is nothing else to show. Continue moves on; request_more sends the
 * researcher back out with notes.
 */

import { button, card, el, textarea } from './dom.js';

const COVERAGE_LABEL = { full: 'Full coverage', partial: 'Partial coverage', thin: 'Thin coverage' };

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Research results');
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const gaps = Array.isArray(data.gaps) ? data.gaps : [];
  const coverage = data.coverage && typeof data.coverage === 'object' ? data.coverage : null;

  // A gap flagged as needing an answer is not a bullet in a list of failures; it
  // becomes a real question asked through question_ask, handled by the skill that
  // shows this screen. This card only ever lists the gaps nobody needs to answer.
  const listedGaps = gaps.filter((gap) => !(gap && gap.needs_answer));

  if (coverage && coverage.level) {
    const status = el('p', { class: 'coverage-status', 'data-level': String(coverage.level) }, [
      COVERAGE_LABEL[coverage.level] ?? 'Coverage',
      coverage.note ? `. ${String(coverage.note)}` : '',
    ]);
    root.append(status);
  }

  if (sections.length === 0) {
    root.append(el('p', { class: 'muted' }, ['No results yet.']));
  }

  const hasAnyFindings = sections.some((section) => Array.isArray(section.findings) && section.findings.length > 0);

  for (const section of sections) {
    const sectionCard = el('section', { class: 'option' }, [el('h3', {}, [String(section.title ?? 'Findings')])]);
    if (section.summary) sectionCard.append(el('p', {}, [String(section.summary)]));

    const findings = Array.isArray(section.findings) ? section.findings : [];
    if (findings.length > 0) {
      const list = el('ul', { class: 'findings' });
      for (const finding of findings) {
        const marker = el('span', {
          class: 'confidence-dot',
          'data-confidence': String(finding.confidence ?? 'low'),
          'aria-hidden': 'true',
        });
        const item = el('li', {}, [marker, String(finding.claim ?? '')]);
        if (finding.source_label) {
          item.append(document.createTextNode(' - '));
          if (finding.source_url) {
            item.append(
              el(
                'a',
                { href: String(finding.source_url), target: '_blank', rel: 'noopener noreferrer', class: 'source-link' },
                [String(finding.source_label)],
              ),
            );
          } else {
            item.append(String(finding.source_label));
          }
        }
        list.append(item);
      }
      sectionCard.append(list);
    }

    if (section.so_what) sectionCard.append(el('p', { class: 'so-what' }, [String(section.so_what)]));
    root.append(sectionCard);
  }

  if (listedGaps.length > 0) {
    const details = /** @type {HTMLDetailsElement} */ (el('details', { class: 'gaps-card' }));
    if (!hasAnyFindings) details.setAttribute('open', '');
    details.append(
      el('summary', {}, [`What could not be checked (${listedGaps.length})`]),
      el(
        'ul',
        {},
        listedGaps.map((gap) => el('li', {}, [String(gap.text ?? '')])),
      ),
    );
    root.append(details);
  }

  const { wrap: notesWrap, field: notesField } = textarea('research-more-notes', 'What to look for', {
    placeholder: 'What should the next pass look at.',
    rows: 2,
  });
  root.append(notesWrap);

  root.append(
    el('div', { class: 'actions' }, [
      button('Continue', () => act('continue', {}), { primary: true }),
      button('Request more research', () => act('request_more', { notes: notesField.value.trim() })),
    ]),
  );

  return root;
}
