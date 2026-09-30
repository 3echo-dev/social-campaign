/**
 * The folder picker.
 *
 * Three screens ask a person for a folder: setup, the creative library and brand
 * onboarding. All three used to ask for a full path typed or pasted, which is the one
 * thing a nontechnical person genuinely cannot do. This module is the shared answer.
 *
 * What it offers, in the order a person reaches for them:
 *
 *   1. Browse, which opens the folder window their operating system already shows
 *      them. That is what most people expect and it is the fastest route.
 *   2. Shortcuts and a list they can click through, for when the native window is not
 *      available or they would rather stay in the pane.
 *   3. A typed path, kept but folded away, because it is now the fallback rather than
 *      the main event.
 *
 * The host screen owns its own Continue button and reads `value()` when it is
 * pressed. The picker owns everything above that.
 */

import { button, el, icon } from './dom.js';

/**
 * @typedef {object} PickerOptions
 * @property {string} [value] the folder to start selected, if there is one.
 * @property {boolean} [allowCreate] show "New folder". Off where the person is picking
 *   an existing folder to read from.
 * @property {string} [selectionLabel] the sentence in front of the chosen path.
 * @property {string} [typedLabel] the label on the folded away typed path field.
 * @property {string} [idPrefix] so two pickers on one screen keep distinct ids.
 * @property {(path: string) => void} [onChange]
 * @property {boolean} [selectionRequired] when true, browsing the list only moves the
 *   displayed folder: nothing is selected until the person explicitly clicks a
 *   folder's "Use this folder" control, uses the native Browse dialog, or types a
 *   path and confirms it. Used by the brand brief and the creative library chooser,
 *   which must never submit wherever browsing happened to land.
 */

/**
 * @param {PickerOptions} [options]
 * @returns {{element: HTMLElement, value: () => string, focus: () => void}}
 */
export function folderPicker(options = {}) {
  const idPrefix = options.idPrefix ?? 'folder';
  const selectionLabel = options.selectionLabel ?? 'Social Campaign will use:';
  const selectionRequired = Boolean(options.selectionRequired);
  let selected = String(options.value ?? '');
  /** The folder the list is showing, which is not always the selected one. */
  let browsing = selected;

  const root = el('div', { class: 'picker' });

  const notice = el('div', { class: 'banner picker-notice', hidden: 'hidden' });
  notice.hidden = true;
  root.append(notice);

  const shortcuts = el('div', { class: 'picker-shortcuts' });
  root.append(shortcuts);

  const crumbs = el('nav', { class: 'picker-crumbs', 'aria-label': 'Folder path' });
  root.append(crumbs);

  const list = el('ul', { class: 'picker-list', tabindex: '-1' });
  root.append(list);

  const newFolderRow = el('div', { class: 'picker-new', hidden: 'hidden' });
  newFolderRow.hidden = true;

  const tools = el('div', { class: 'picker-tools' });
  const browseButton = button('Browse', () => void browseNative());
  browseButton.prepend(icon('folder'));
  tools.append(browseButton);
  /** @type {HTMLButtonElement|null} */
  let useCurrentButton = null;
  if (selectionRequired) {
    useCurrentButton = button('Use this folder', () => {
      selected = browsing;
      paint();
    });
    useCurrentButton.classList.add('picker-use-current');
    tools.append(useCurrentButton);
  }
  if (options.allowCreate) {
    const newButton = button(
      'New folder',
      () => {
        newFolderRow.hidden = !newFolderRow.hidden;
        if (!newFolderRow.hidden) nameInput.focus();
      },
      { variant: 'add' },
    );
    tools.append(newButton);
  }
  root.append(tools);

  const nameInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'text',
      id: `${idPrefix}-new-name`,
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'Name for the new folder',
    })
  );
  const createButton = button('Create', () => void create(), { primary: true });
  newFolderRow.append(el('label', { for: `${idPrefix}-new-name` }, ['New folder name']), nameInput, createButton);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') createButton.click();
  });
  root.append(newFolderRow);

  const chosenLine = el('p', { class: 'picker-chosen' });
  root.append(chosenLine);

  // The typed path, demoted to a disclosure. It is still here because a person who
  // was sent an exact path by someone else needs somewhere to put it.
  const typed = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'text',
      id: `${idPrefix}-typed`,
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'C:\\Users\\you\\Documents\\My folder',
    })
  );
  typed.value = selected;
  const typedChildren = [
    el('summary', {}, [options.typedLabel ?? 'or type a path']),
    el('label', { for: `${idPrefix}-typed` }, ['Full folder path']),
    typed,
  ];
  if (selectionRequired) {
    const useTypedButton = button('Use this path', () => {
      selected = typed.value.trim();
      paint();
    });
    useTypedButton.classList.add('picker-use-typed');
    typedChildren.push(useTypedButton);
    typed.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        useTypedButton.click();
      }
    });
  } else {
    typed.addEventListener('input', () => {
      selected = typed.value.trim();
      paint();
    });
  }
  typedChildren.push(el('p', { class: 'hint' }, ['Paste a path someone sent you, or type one you know.']));
  const details = el('details', { class: 'picker-typed' }, typedChildren);
  root.append(details);

  /** Show one plain sentence, or clear it. @param {string} text @param {string} [tone] */
  function say(text, tone = 'error') {
    notice.textContent = text;
    notice.dataset.tone = tone;
    notice.hidden = text.length === 0;
  }

  function paint() {
    const hasSelection = selected.length > 0;
    chosenLine.replaceChildren(
      el('span', { class: 'picker-chosen-label' }, [
        selectionRequired && !hasSelection ? 'Social Campaign will read:' : selectionLabel,
      ]),
      el('span', { class: 'picker-chosen-path' }, [
        hasSelection ? selected : selectionRequired ? 'No folder chosen yet.' : 'nothing yet',
      ]),
    );
    chosenLine.classList.toggle('picker-chosen-empty', selectionRequired && !hasSelection);
    if (typed.value.trim() !== selected) typed.value = selected;
    if (options.onChange) options.onChange(selected);
  }

  /**
   * Load one folder into the list.
   * @param {string} [path] omit to start wherever the server thinks home is.
   * @param {{select?: boolean}} [how]
   * @returns {Promise<boolean>} false when that folder could not be opened.
   */
  async function open(path, how = {}) {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    let body;
    try {
      const response = await fetch(`/api/folders${query}`);
      body = await response.json();
      if (!response.ok) {
        say(String(body.error ?? 'That folder could not be opened.'));
        if (Array.isArray(body.shortcuts)) drawShortcuts(body.shortcuts);
        return false;
      }
    } catch {
      say('Social Campaign lost its connection to the pane. It will come back on its own.');
      return false;
    }
    browsing = String(body.path);
    // In selectionRequired mode, browsing never selects on its own: only an explicit
    // "Use this folder" control, a confirmed typed path, or the native dialog does.
    const shouldSelect = selectionRequired ? how.select === true : how.select !== false;
    if (shouldSelect) {
      selected = browsing;
    }
    paint();
    say(body.notice ? String(body.notice) : '', 'warning');
    drawShortcuts(body.shortcuts ?? []);
    drawCrumbs(body.crumbs ?? []);
    drawList(body);
    return true;
  }

  /** @param {Array<{key: string, label: string, path: string}>} entries */
  function drawShortcuts(entries) {
    shortcuts.replaceChildren(
      ...entries.map((entry) => {
        const chip = button(entry.label, () => void open(entry.path));
        chip.classList.add('picker-chip');
        if (entry.path === browsing) chip.setAttribute('aria-current', 'true');
        return chip;
      }),
    );
  }

  /** @param {Array<{label: string, path: string}>} entries */
  function drawCrumbs(entries) {
    crumbs.replaceChildren(
      ...entries.flatMap((entry, index) => {
        const step = button(entry.label, () => void open(entry.path));
        step.classList.add('picker-crumb');
        if (index === entries.length - 1) step.setAttribute('aria-current', 'page');
        return index === 0 ? [step] : [el('span', { class: 'picker-crumb-sep', 'aria-hidden': 'true' }, ['/']), step];
      }),
    );
  }

  /** @param {any} body */
  function drawList(body) {
    /** @type {HTMLElement[]} */
    const rows = [];
    if (body.parent) {
      const up = button('Back up one folder', () => void open(String(body.parent)));
      up.classList.add('picker-row', 'picker-up');
      rows.push(el('li', {}, [up]));
    }
    for (const folder of body.folders ?? []) {
      const path = String(folder.path);
      const row = button(String(folder.name), () => void open(path));
      row.classList.add('picker-row');
      row.prepend(icon('folder'));
      if (selectionRequired) {
        const li = el('li', { class: 'picker-item' });
        if (path === selected) li.classList.add('picker-item-selected');
        const useButton = button('Use this folder', () => {
          selected = path;
          paint();
        });
        useButton.classList.add('picker-use-row');
        li.append(row, useButton);
        rows.push(li);
      } else {
        rows.push(el('li', {}, [row]));
      }
    }
    if (rows.length === 0) {
      rows.push(el('li', { class: 'picker-empty' }, ['No folders inside this one. You can still choose it.']));
    }
    if (body.truncated) {
      rows.push(el('li', { class: 'picker-empty' }, ['Only the first folders are shown. Open one to go deeper.']));
    }
    list.replaceChildren(...rows);
  }

  async function create() {
    const name = nameInput.value.trim();
    if (name.length === 0) {
      nameInput.focus();
      return;
    }
    createButton.disabled = true;
    try {
      const response = await fetch('/api/folders/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parent: browsing, name }),
      });
      const body = await response.json();
      if (!response.ok) {
        say(String(body.error ?? 'That folder could not be made.'));
        return;
      }
      nameInput.value = '';
      newFolderRow.hidden = true;
      await open(String(body.path));
    } catch {
      say('That folder could not be made just now. Try again.');
    } finally {
      createButton.disabled = false;
    }
  }

  /**
   * Ask the server to open the operating system's own folder window, then poll the
   * ticket. Nothing here blocks: the pane stays usable the whole time the window is
   * up, and a cancel or a missing chooser just leaves the in-pane picker as it was.
   */
  async function browseNative() {
    browseButton.disabled = true;
    say('The folder window is open. Choose a folder there, or carry on below.', 'warning');
    try {
      const started = await fetch('/api/native-folder', { method: 'POST' });
      const { ticket } = await started.json();
      if (!ticket) return;
      for (let attempt = 0; attempt < 130; attempt += 1) {
        await new Promise((settle) => setTimeout(settle, 1000));
        const response = await fetch(`/api/native-folder?ticket=${encodeURIComponent(ticket)}`);
        if (!response.ok) break;
        const body = await response.json();
        if (body.status !== 'done') continue;
        if (body.path) {
          say('');
          await open(String(body.path), { select: true });
        } else {
          // Cancelled, unavailable or timed out all mean the same thing here: the
          // picker below is how this person is going to choose.
          say('');
        }
        return;
      }
      say('');
    } catch {
      say('');
    } finally {
      browseButton.disabled = false;
    }
  }

  /**
   * Where the list starts. A folder that has been suggested but does not exist yet,
   * which is exactly what the default workspace folder is on a first run, must not
   * leave the person looking at an error: fall back to home and keep the suggestion
   * as the selection.
   */
  async function start() {
    if (selected.length > 0 && (await open(selected, { select: false }))) return;
    say('');
    // A folder that has been suggested but does not exist yet must not leave the
    // person looking at an error: fall back to home and, outside selectionRequired
    // mode, keep the suggestion as the selection. In selectionRequired mode the
    // starting browse position is never itself a selection.
    await open(undefined, { select: !selectionRequired && selected.length === 0 });
  }

  paint();
  void start();

  return {
    element: root,
    value: () => selected.trim(),
    focus: () => list.focus(),
  };
}
