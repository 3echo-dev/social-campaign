/**
 * First run setup.
 *
 * The first thing Social Campaign asks for is a folder, and it used to ask by
 * handing over an empty text field and the phrase "full path". This screen now leads
 * with a real picker: Browse opens the folder window the operating system already
 * shows, and failing that the person clicks their way through their own folders.
 * The typed path is still here, folded away, for someone who was sent an exact path.
 */

import { button, el, hero } from './dom.js';
import { folderPicker } from './folder_picker.js';

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  if (data.mode === 'choose') return renderChooser(data, act);

  // A hero with the intro under it, then the folder picker in one composer card.
  const screen = el('div', { class: 'screen' }, [
    hero(String(data.title ?? 'Set up Social Campaign'), String(data.intro ?? 'Choose a local working folder for your brands, projects, and source files.')),
  ]);
  const root = el('section', { class: 'card' });
  screen.append(root);

  if (data.error) {
    root.append(el('div', { class: 'banner', 'data-tone': 'error' }, [String(data.error)]));
  }

  const defaultRoot = String(data.defaultRoot ?? '');
  const picker = folderPicker({
    value: defaultRoot,
    allowCreate: true,
    selectionLabel: 'Social Campaign will use:',
    idPrefix: 'workspace',
  });
  root.append(picker.element);
  root.append(el('p', { class: 'muted' }, ['Your files, jobs, and metrics stay in this folder. Start brand onboarding after setup.']));

  const continueButton = button(
    'Continue',
    () => {
      const chosen = picker.value();
      if (chosen.length === 0) {
        picker.focus();
        return;
      }
      continueButton.disabled = true;
      continueButton.textContent = 'Setting up';
      act('continue', { root: chosen });
    },
    { primary: true },
  );

  root.append(
    el('div', { class: 'actions' }, [
      continueButton,
      button('Use default folder', () => {
        act('use_default_folder', { root: defaultRoot });
      }),
    ]),
  );

  return screen;
}

/**
 * The short chooser shown when this session's folder has no workspace of its own
 * but a workspace already exists on this computer. Three options: set up fresh here
 * (the default), use the usual workspace, or fall back to the full picker.
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
function renderChooser(data, act) {
  const screen = el('div', { class: 'screen' }, [
    hero(
      String(data.title ?? 'Set up Social Campaign'),
      String(data.intro ?? 'This folder does not have a Social Campaign workspace yet.'),
    ),
  ]);
  const root = el('section', { class: 'card' });
  screen.append(root);

  if (data.error) {
    root.append(el('div', { class: 'banner', 'data-tone': 'error' }, [String(data.error)]));
  }

  const hereRoot = String(data.suggestionRoot ?? '');
  const usualRoot = String(data.globalRoot ?? '');

  root.append(
    el('p', {}, ['Set up a new workspace in this folder']),
    el('p', { class: 'path' }, [hereRoot]),
    el('div', { class: 'actions' }, [button('Set up here', () => act('choose_new_here', { root: hereRoot }), { primary: true })]),
  );

  const usualCard = el('section', { class: 'card' }, [
    el('p', {}, ['Use my usual workspace']),
    el('p', { class: 'path' }, [usualRoot]),
    el('div', { class: 'actions' }, [button('Use this one', () => act('choose_usual', { root: usualRoot }))]),
  ]);
  screen.append(usualCard);

  const otherCard = el('section', { class: 'card' }, [
    el('p', {}, ['Pick another folder']),
    el('div', { class: 'actions' }, [button('Pick another', () => act('choose_other'))]),
  ]);
  screen.append(otherCard);

  return screen;
}
