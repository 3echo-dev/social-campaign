/** One Connections page. Status updates preserve each card and its form. */
import { button, el, hero, armButtonGroup, resetButtonGroups } from './dom.js';

const PUBLISHER_PLATFORMS = ['facebook', 'instagram', 'tiktok'];
const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
const FIX_IN_CHAT_ITEM = { threeecho_studio: 'threeecho', elevenlabs: 'elevenlabs', publisher: 'publisher' };
const DOT_STATE = { connected: 'ready', connected_own: 'ready', problem: 'degraded', not_connected: 'not_connected' };
const views = new WeakMap();

/** @param {any} data @param {(action: string, payload?: any) => void} act */
export function render(data, act) {
  const header = hero(String(data.title ?? 'Connect your tools'));
  const root = el('div', { class: 'screen connections-screen' }, [header]);
  const cards = new Map();
  for (const card of data.cards ?? []) {
    const view = connectionCard(card, data, act);
    cards.set(card.key, view);
    root.append(view.element);
  }
  const done = button(String(data.continueLabel ?? 'Continue'), () => act('continue_home'), { primary: true });
  root.append(el('div', { class: 'actions' }, [done]));
  views.set(root, { cards, done, title: data.title });
  return root;
}

/** Patch the current page without replacing cards, inputs or expanded details.
 * A different layout is a navigation and must be rendered by the caller.
 * @param {HTMLElement} root @param {any} data @returns {boolean}
 */
export function update(root, data) {
  const view = views.get(root);
  if (!view || view.title !== data.title) return false;
  if (JSON.stringify([...view.cards.keys()]) !== JSON.stringify((data.cards ?? []).map((card) => card.key))) return false;
  for (const card of data.cards) view.cards.get(card.key).update(card, data);
  if (view.done.textContent !== String(data.continueLabel ?? 'Continue')) view.done.textContent = String(data.continueLabel ?? 'Continue');
  return true;
}

function setText(node, value) {
  const text = String(value ?? '');
  if (node.textContent !== text) node.textContent = text;
}

/** Keep mutable card data outside button closures so checks use the latest result. */
function connectionCard(initial, initialData, act) {
  let card = initial;
  const key = String(card.key);
  const element = el('section', { class: 'card conn-card', id: `conn-card-${key}` });
  const title = el('h2');
  const purpose = el('p', { class: 'muted' });
  const statusText = el('span');
  const status = el('p', { class: 'conn-status', role: 'status' }, [el('span', { class: 'dot', 'aria-hidden': 'true' }), statusText]);
  const reason = el('p', { class: 'banner', 'data-tone': 'info' });
  const note = el('p', { class: 'hint' });
  const detailText = el('p');
  const details = el('details', { class: 'hint' }, [el('summary', {}, ['Connection details']), detailText]);
  const row = el('div', { class: 'actions' });
  const form = card.provider === 'publisher' ? publisherForm(initialData) : null;
  let actionSignature = '';
  let editingPublisher = false;
  let wasConnected = false;
  let connectionVersion;
  element.append(title, purpose, status, reason);
  if (form) element.append(form.element);
  element.append(row, note, details);

  function patch(next, data) {
    card = next;
    const connected = card.state === 'connected' || card.state === 'connected_own';
    element.dataset.focus = String(data.focus === key);
    setText(title, card.title);
    setText(purpose, card.purpose);
    purpose.hidden = !card.purpose;
    setText(statusText, card.stateText);
    status.dataset.state = DOT_STATE[card.state] ?? 'not_connected';
    setText(reason, card.reason);
    reason.hidden = !card.reason;
    setText(note, card.note);
    note.hidden = !card.note;
    setText(detailText, card.connectionDetail);
    details.hidden = !card.connectionDetail;
    if (form) {
      form.update(data);
      const saved = connected && (!wasConnected || connectionVersion !== card.connectionVersion);
      if (saved) editingPublisher = false;
      form.element.hidden = connected && !editingPublisher;
      // A successful connection removes the secret from the visible page's DOM.
      if (saved) form.saved(data);
    }
    wasConnected = connected;
    connectionVersion = card.connectionVersion;
    const actions = card.actions ?? [];
    const signature = JSON.stringify([connected, actions, editingPublisher]);
    if (signature === actionSignature) return;
    actionSignature = signature;
    resetButtonGroups(element);
    const buttons = [];
    if (actions.includes('connect') && form) {
      buttons.push(button(connected ? 'Change connection' : 'Connect', () => {
        if (connected) {
          resetButtonGroups(element);
          editingPublisher = true;
          actionSignature = JSON.stringify([connected, actions, editingPublisher]);
          form.element.hidden = false;
          // Editing a saved connection is local until the user submits the form.
          const save = button('Save connection', () => submitPublisher(), { primary: true });
          row.replaceChildren(save);
          armButtonGroup(row);
          form.focus();
          return;
        }
        submitPublisher();
      }, { primary: true }));
    }
    if (actions.includes('check_again')) buttons.push(button('Check again', () => act('check_again', { key, provider: card.provider })));
    if (!connected && !form) buttons.push(button('Ask chat to connect it', () => act('fix_in_chat', {
      key, provider: card.provider, item: FIX_IN_CHAT_ITEM[card.provider] ?? card.provider,
      reason: String(card.connectionDetail || card.stateText || ''),
    }), { primary: true }));
    if (!connected && actions.includes('skip')) buttons.push(button('Skip for now', () => act('skip', { key, provider: card.provider })));
    row.replaceChildren(...buttons);
    armButtonGroup(row);
  }
  function submitPublisher() {
    const values = form.value();
    if (values) act('connect', { key, provider: values.provider, ...values.rest });
    else resetButtonGroups(element);
  }
  patch(initial, initialData);
  return { element, update: patch };
}

/** The only publishing credential form used by setup and every connect tool. */
function publisherForm(data) {
  const element = el('div', { class: 'conn-form' });
  const providerSelect = /** @type {HTMLSelectElement} */ (el('select', { id: 'publisher-provider' }));
  let providerSignature = null;
  let providerValues = new Set();
  function updateProviders(next) {
    const providers = Array.isArray(next.providers) ? next.providers : [];
    const signature = JSON.stringify(providers);
    if (signature === providerSignature) return;
    const initial = providerSignature === null;
    const selected = providerSelect.value;
    providerSignature = signature;
    providerValues = new Set(providers.map((provider) => String(provider.value)));
    const options = providers.map((provider) => el('option', { value: String(provider.value) }, [String(provider.label)]));
    // Losing a selected service must not redirect a typed key to another service.
    if (!initial && !providerValues.has(selected)) options.unshift(el('option', { value: '', disabled: '' }, ['Choose a provider']));
    providerSelect.replaceChildren(...options);
    const configured = String(next.publisherConnection?.provider ?? '');
    providerSelect.value = initial ? (providerValues.has(configured) ? configured : String(providers[0]?.value ?? ''))
      : providerValues.has(selected) ? selected : '';
  }
  updateProviders(data);
  element.append(el('div', { class: 'field' }, [el('label', { for: 'publisher-provider' }, ['Provider']), providerSelect]));

  const keyInput = /** @type {HTMLInputElement} */ (
    el('input', { id: 'publisher-api-key', type: 'password', autocomplete: 'off', spellcheck: 'false' })
  );
  element.append(el('div', { class: 'field' }, [el('label', { for: 'publisher-api-key' }, ['API key']), keyInput]));

  const baseUrlInput = /** @type {HTMLInputElement} */ (
    el('input', { id: 'publisher-base-url', type: 'text', autocomplete: 'off', spellcheck: 'false' })
  );
  element.append(
    el('div', { class: 'field' }, [
      el('label', { for: 'publisher-base-url' }, ['Base URL (optional, for a self-hosted provider)']),
      baseUrlInput,
    ]),
  );

  element.append(el('p', { class: 'field-label' }, ['Account ids']));
  /** @type {Record<string, HTMLInputElement>} */
  const accountInputs = {};
  for (const platform of PUBLISHER_PLATFORMS) {
    const id = `publisher-account-${platform}`;
    const input = /** @type {HTMLInputElement} */ (el('input', { id, type: 'text', autocomplete: 'off' }));
    element.append(el('div', { class: 'field' }, [el('label', { for: id }, [PLATFORM_LABEL[platform] ?? platform]), input]));
    accountInputs[platform] = input;
  }

  element.append(
    el('p', { class: 'hint' }, ['Your API key is protected on this computer and used only to connect to your posting service.']),
  );

  function loadConnection(next) {
    const connection = next.publisherConnection;
    if (!connection) return;
    if (providerValues.has(connection.provider)) providerSelect.value = connection.provider;
    baseUrlInput.value = String(connection.base_url ?? '');
    for (const platform of PUBLISHER_PLATFORMS) accountInputs[platform].value = String(connection.account_ids?.[platform] ?? '');
  }
  loadConnection(data);
  return {
    element,
    saved: (next) => { keyInput.value = ''; loadConnection(next); },
    focus: () => keyInput.focus(),
    update: updateProviders,
    value: () => {
      if (!providerValues.has(providerSelect.value)) {
        providerSelect.focus();
        return null;
      }
      if (keyInput.value.trim().length === 0) {
        keyInput.focus();
        return null;
      }
      /** @type {Record<string, string>} */
      const accountIds = {};
      for (const platform of PUBLISHER_PLATFORMS) {
        const value = accountInputs[platform].value.trim();
        if (value) accountIds[platform] = value;
      }
      return {
        provider: providerSelect.value,
        rest: {
          api_key: keyInput.value.trim(),
          base_url: baseUrlInput.value.trim() || null,
          account_ids: accountIds,
        },
      };
    },
  };
}
