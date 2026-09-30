/**
 * Cost review gate: the itemized credit estimate before any paid generation runs.
 * Approve, reduce (send a smaller plan back), or cancel.
 */

import { button, card, el, phaseStrip, textarea } from './dom.js';

/** Providers are named the way the user knows them, never by their internal key. */
const PROVIDER_LABEL = {
  '3echo_studio': '3echo Studio',
  threeecho_studio: '3echo Studio',
  elevenlabs: 'ElevenLabs',
  local: 'On this computer',
};

/**
 * @param {unknown} provider
 * @returns {string}
 */
function providerLabel(provider) {
  const key = String(provider ?? '');
  return PROVIDER_LABEL[key] ?? key.replace(/_/g, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function credits(value) {
  const number = Number(value);
  const amount = Number.isFinite(number) ? number : 0;
  return `${amount} ${amount === 1 ? 'credit' : 'credits'}`;
}

/**
 * Where the money stands for this job, in the words a person would use: the most
 * this approval lets the job spend, what is already spent, what is set aside for
 * work in progress, and what would still be left.
 * @param {{approved?: number, reserved?: number, spent?: number, available?: number}} ledger
 * @returns {HTMLElement}
 */
function ledgerBlock(ledger) {
  const rows = [
    ['Most this job can spend once you approve', ledger.approved],
    ['Already spent', ledger.spent],
    ['Set aside for work in progress', ledger.reserved],
    ['Still available', ledger.available],
  ];
  const list = el('dl', { class: 'ledger' });
  for (const [term, value] of rows) {
    list.append(el('div', { class: 'ledger-row' }, [el('dt', {}, [String(term)]), el('dd', {}, [credits(value)])]));
  }
  return el('section', { class: 'ledger-block', 'aria-label': 'Spending for this job' }, [
    el('h3', {}, ['Spending for this job']),
    list,
    el('p', { class: 'hint' }, [
      Number(ledger.spent) > 0 || Number(ledger.reserved) > 0
        ? 'Nothing more is spent until you approve, and never more than this amount in total.'
        : 'Nothing is spent until you approve, and never more than this amount.',
    ]),
  ]);
}

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Review the cost');
  if (data.phase) root.prepend(phaseStrip(String(data.phase), { phases: data.phases }));
  const items = Array.isArray(data.items) ? data.items : [];

  const table = el('table', { class: 'cost-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Item']),
        el('th', {}, ['Provider']),
        el('th', { class: 'num' }, ['Units']),
        el('th', { class: 'num' }, ['Credits']),
      ]),
    ]),
  ]);
  const tbody = el('tbody');
  for (const item of items) {
    tbody.append(
      el('tr', {}, [
        el('td', {}, [String(item.label ?? '')]),
        el('td', {}, [providerLabel(item.provider)]),
        el('td', { class: 'num' }, [String(item.units ?? '')]),
        el('td', { class: 'num' }, [String(item.credits ?? '')]),
      ]),
    );
  }
  table.append(tbody);
  root.append(table);

  root.append(
    el('div', { class: 'cost-total' }, [
      el('span', {}, ['Total']),
      el('span', {}, [`${data.total_credits ?? 0} credits`]),
    ]),
  );
  if (data.currency_note) root.append(el('p', { class: 'hint' }, [String(data.currency_note)]));

  const ledger = data.ledger && typeof data.ledger === 'object' ? data.ledger : null;
  if (ledger) root.append(ledgerBlock(ledger));

  const { wrap: notesWrap, field: notesField } = textarea('cost-notes', 'Notes', {
    placeholder: 'What should be cut to bring the cost down.',
  });
  root.append(notesWrap);

  root.append(
    el('div', { class: 'actions' }, [
      // The total rides on the button as its badge, so the price is in view at the click.
      button('Approve', () => act('approve', {}), {
        primary: true,
        badge: `${Number(data.total_credits ?? 0)} cr`,
        badgeLabel: credits(data.total_credits),
      }),
      button('Make it smaller', () => act('reduce', { notes: notesField.value.trim() })),
      button('Cancel', () => act('cancel', {})),
    ]),
  );

  return root;
}
