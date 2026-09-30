/**
 * Intake: the last few answers before the job can be planned.
 *
 * Only the fields this particular job needs are shown. A reference job asks for the
 * reference, a finished creative job asks where the files are, and neither asks the
 * other's question.
 */

import { button, card, el } from './dom.js';

const REFERENCE_KINDS = [
  { value: 'post', label: 'A post' },
  { value: 'ad', label: 'An ad' },
  { value: 'video', label: 'A video' },
  { value: 'image', label: 'An image' },
  { value: 'campaign', label: 'A whole campaign' },
];

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const values = data.values ?? {};
  const root = card(data.title ?? 'About this job');
  if (data.intro) root.append(el('p', {}, [String(data.intro)]));

  const form = el('form', { class: 'form', novalidate: 'novalidate' });
  root.append(form);

  const problem = el('div', { class: 'banner', 'data-tone': 'error', hidden: 'hidden' });
  form.append(problem);

  // Job name
  const titleInput = textField(form, 'job-title', 'Job name', String(values.title ?? ''), 'Spring launch teaser');

  // Brand
  /** @type {HTMLSelectElement|null} */
  let brandSelect = null;
  const brands = Array.isArray(data.brands) ? data.brands : [];
  if (brands.length > 0) {
    form.append(el('label', { for: 'job-brand' }, ['Brand']));
    brandSelect = /** @type {HTMLSelectElement} */ (el('select', { id: 'job-brand' }));
    brandSelect.append(new Option('No brand yet', ''));
    for (const brand of brands) brandSelect.append(new Option(String(brand.name), String(brand.id)));
    brandSelect.value = String(values.brand_id ?? '');
    form.append(brandSelect);
  }

  // Platforms
  form.append(el('p', { class: 'field-label', id: 'platform-label' }, ['Platforms']));
  const group = el('div', { class: 'checks', role: 'group', 'aria-labelledby': 'platform-label' });
  /** @type {HTMLInputElement[]} */
  const platformInputs = [];
  for (const platform of Array.isArray(data.platforms) ? data.platforms : []) {
    const input = /** @type {HTMLInputElement} */ (
      el('input', { type: 'checkbox', id: `platform-${platform.value}`, value: String(platform.value) })
    );
    input.checked = Boolean(platform.checked);
    platformInputs.push(input);
    group.append(el('label', { class: 'check', for: `platform-${platform.value}` }, [input, String(platform.label)]));
  }
  form.append(group);

  // Goal and notes
  const goalInput = textField(form, 'job-goal', 'What is this for?', String(values.goal ?? ''), 'Drive signups for the new plan');
  form.append(el('label', { for: 'job-notes' }, ['Anything else Social Campaign should respect']));
  const notes = /** @type {HTMLTextAreaElement} */ (el('textarea', { id: 'job-notes', rows: '3' }));
  notes.value = String(values.notes ?? '');
  form.append(notes);

  // Reference, only for a reference job
  /** @type {HTMLInputElement|null} */
  let referenceInput = null;
  /** @type {HTMLSelectElement|null} */
  let referenceKind = null;
  if (data.needsReference) {
    form.append(el('label', { for: 'reference-kind' }, ['What is the reference?']));
    referenceKind = /** @type {HTMLSelectElement} */ (el('select', { id: 'reference-kind' }));
    for (const kind of REFERENCE_KINDS) referenceKind.append(new Option(kind.label, kind.value));
    referenceKind.value = String(values.reference_kind ?? 'post');
    form.append(referenceKind);
    referenceInput = textField(
      form,
      'reference-url',
      'Link to it, or the path to the file',
      String(values.reference_url ?? ''),
      'https://...',
    );
    form.append(el('p', { class: 'hint' }, ['A competitor post, ad, video, image or campaign works.']));
  }

  // Finished creative, only for an existing creative job
  /** @type {HTMLTextAreaElement|null} */
  let assets = null;
  if (data.needsAssets) {
    form.append(el('label', { for: 'asset-paths' }, ['Where is the creative?']));
    assets = /** @type {HTMLTextAreaElement} */ (
      el('textarea', { id: 'asset-paths', rows: '3', spellcheck: 'false', placeholder: 'One file path per line' })
    );
    assets.value = String(values.asset_paths ?? '');
    form.append(assets);
    form.append(
      el('p', { class: 'hint' }, [
        'Paste the full path to each file, one per line. Social Campaign reads them where they are and never ' +
          'changes them.',
      ]),
    );
  }

  const submit = button(
    'Plan this job',
    () => {
      const platforms = platformInputs.filter((input) => input.checked).map((input) => input.value);
      if (platforms.length === 0) {
        fail('Choose at least one of Facebook, Instagram or TikTok.');
        platformInputs[0]?.focus();
        return;
      }
      if (referenceInput && referenceInput.value.trim().length === 0) {
        fail('Add the link or the file path for your reference.');
        referenceInput.focus();
        return;
      }
      const assetPaths = assets
        ? assets.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
        : [];
      if (assets && assetPaths.length === 0) {
        fail('Add at least one file path for the creative you already have.');
        assets.focus();
        return;
      }
      problem.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Planning';
      act('submit', {
        campaign_id: data.campaign_id ?? null,
        job_type: data.job_type ?? null,
        starting_point: data.starting_point ?? null,
        title: titleInput.value.trim(),
        brand_id: brandSelect ? brandSelect.value : '',
        platforms,
        goal: goalInput.value.trim(),
        notes: notes.value.trim(),
        reference: referenceInput
          ? { kind: referenceKind ? referenceKind.value : 'post', url: referenceInput.value.trim() }
          : null,
        existing_assets: assetPaths,
      });
    },
    { primary: true },
  );

  form.append(el('div', { class: 'actions' }, [submit, button('Cancel', () => act('cancel'))]));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.click();
  });

  /** @param {string} text */
  function fail(text) {
    problem.textContent = text;
    problem.hidden = false;
  }

  setTimeout(() => titleInput.focus(), 0);
  return root;
}

/**
 * @param {HTMLElement} form
 * @param {string} id
 * @param {string} label
 * @param {string} value
 * @param {string} placeholder
 * @returns {HTMLInputElement}
 */
function textField(form, id, label, value, placeholder) {
  form.append(el('label', { for: id }, [label]));
  const input = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', id, autocomplete: 'off', spellcheck: 'false', placeholder })
  );
  input.value = value;
  form.append(input);
  return input;
}
