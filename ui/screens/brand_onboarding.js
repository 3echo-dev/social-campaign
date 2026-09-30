/**
 * Brand onboarding: a brief, a progress view, and the four brand pillars, all under
 * one screen type so a tool can move a person through onboarding without switching
 * screens.
 *
 * data.mode is "brief", "progress" or "pillars".
 *
 *   brief    phase one: brand name, one free text brief, a references dropzone and
 *            a source media folder. This is shown for a brand that does not exist
 *            yet.
 *   progress research and creative inspection running in the background.
 *   pillars  phase two: the four editable pillars, brand voice, audience,
 *            positioning and platform playbook, prefilled from research. This is
 *            also the edit screen for a brand that already exists: opening
 *            onboarding again for it goes straight here.
 *
 * Styling matches home.js and setup.js: cards, the shared button and checklist
 * classes, no bespoke CSS beyond the dropzone and attachment tiles this module
 * needs, which live in styles.css next to the review gate rules.
 */

import { button, card, el, icon } from './dom.js';
import { folderPicker } from './folder_picker.js';

const STEP_TEXT = { pending: 'Waiting', active: 'Working', done: 'Done' };

/** Extensions the dropzone accepts, mirrored by the server side allowlist. */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];
const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];
const ACCEPTED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...FONT_EXTENSIONS];

/**
 * @param {string} name
 * @returns {string}
 */
function extensionOf(name) {
  const at = name.lastIndexOf('.');
  return at >= 0 ? name.slice(at).toLowerCase() : '';
}

/**
 * A references dropzone: click to choose or drag files onto it, a tile per
 * attachment with a thumbnail, its name and a remove control, and a cap with a
 * friendly message when it is hit.
 * @param {{target: string, max: number}} options
 * @returns {{element: HTMLElement, paths: () => string[]}}
 */
function referencesDropzone(options) {
  const root = el('div', { class: 'field' }, [el('label', {}, ['References'])]);
  root.append(
    el('p', { class: 'hint' }, [
      'Images, videos or font files. Drag them in, or click to choose. Up to ' + String(options.max) + '.',
    ]),
  );

  const notice = el('div', { class: 'banner picker-notice', hidden: 'hidden' });
  notice.hidden = true;
  root.append(notice);

  const zone = el('div', { class: 'dropzone', tabindex: '0', role: 'button' }, [
    icon('plus'),
    el('span', {}, ['Drop files here, or click to choose']),
  ]);
  const input = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'file',
      multiple: 'multiple',
      accept: ACCEPTED_EXTENSIONS.join(','),
      hidden: 'hidden',
    })
  );
  input.hidden = true;
  root.append(zone, input);

  const tiles = el('ul', { class: 'reference-tiles' });
  root.append(tiles);

  /** @type {Array<{path: string, filename: string, thumbnail_url: string|null, mime: string|null}>} */
  const attachments = [];

  /** @param {string} text @param {string} [tone] */
  function say(text, tone = 'error') {
    notice.textContent = text;
    notice.dataset.tone = tone;
    notice.hidden = text.length === 0;
  }

  /**
   * @param {{filename: string, thumbnail_url: string|null, mime: string|null, path: string}} attachment
   */
  function addTile(attachment) {
    const isFont = FONT_EXTENSIONS.includes(extensionOf(attachment.filename));
    const preview = el('span', { class: 'reference-tile-preview' });
    if (attachment.thumbnail_url) {
      appendThumbnail(preview, attachment);
    } else if (isFont) {
      preview.append(fontSample(attachment));
    } else {
      // No thumbnail yet (or it never showed up): a placeholder icon, never the
      // browser's own broken-image glyph.
      preview.classList.add('reference-tile-preview-pending');
      preview.append(icon('link'));
    }
    const tile = el('li', { class: 'reference-tile' }, [
      preview,
      el('span', { class: 'reference-tile-name' }, [attachment.filename]),
    ]);
    const openButton = button(
      'Preview',
      () => void openPreview(attachment),
      {},
    );
    openButton.classList.add('reference-tile-open');
    const remove = button('Remove', () => {
      const index = attachments.indexOf(attachment);
      if (index >= 0) attachments.splice(index, 1);
      tile.remove();
    });
    remove.classList.add('reference-tile-remove');
    tile.append(el('span', { class: 'reference-tile-actions' }, [openButton, remove]));
    tiles.append(tile);
  }

  /**
   * Load a thumbnail into a tile's preview slot without ever leaving the
   * browser's broken-image icon on screen: a placeholder shows until the image
   * actually loads, and a load failure (thumbnail not generated yet, or the
   * generation step failed) falls back to the placeholder rather than a broken
   * icon. One retry a moment later covers the thumbnail still being written to
   * disk when the tile first renders.
   * @param {HTMLElement} preview
   * @param {{filename: string, thumbnail_url: string|null}} attachment
   * @param {number} [attempt]
   */
  function appendThumbnail(preview, attachment, attempt = 0) {
    preview.replaceChildren();
    preview.classList.add('reference-tile-preview-pending');
    const img = /** @type {HTMLImageElement} */ (el('img', { alt: '' }));
    img.addEventListener('load', () => preview.classList.remove('reference-tile-preview-pending'));
    img.addEventListener('error', () => {
      if (attempt < 3) {
        setTimeout(() => appendThumbnail(preview, attachment, attempt + 1), 800);
        return;
      }
      preview.replaceChildren(icon('link'));
    });
    // Cache-bust the retry so a browser that already cached the 404 actually
    // re-requests the now-real file instead of replaying the failure.
    img.src = attempt === 0 ? String(attachment.thumbnail_url) : `${attachment.thumbnail_url}?retry=${attempt}`;
    preview.append(img);
  }

  /** A larger preview in a plain overlay, torn down on any click. @param {any} attachment */
  function openPreview(attachment) {
    const overlay = el('div', { class: 'reference-preview-overlay' });
    let content;
    const isFont = FONT_EXTENSIONS.includes(extensionOf(attachment.filename));
    if (isFont) {
      content = fontSample(attachment, true);
    } else if (attachment.mime && attachment.mime.startsWith('video/')) {
      content = /** @type {HTMLVideoElement} */ (
        el('video', { src: attachment.thumbnail_url ?? '', controls: 'controls' })
      );
    } else if (attachment.thumbnail_url) {
      content = el('img', { src: attachment.thumbnail_url, alt: attachment.filename });
    } else {
      content = el('p', {}, [attachment.filename]);
    }
    overlay.append(el('div', { class: 'reference-preview' }, [content]));
    overlay.addEventListener('click', () => overlay.remove());
    document.body.append(overlay);
  }

  /**
   * A font attachment previewed by loading the workspace copy into an in-page
   * @font-face and rendering sample text with it. Falls back to a plain card
   * naming the file when the browser cannot load it as a font.
   * @param {any} attachment @param {boolean} [large]
   */
  function fontSample(attachment, large = false) {
    const holder = el('span', { class: large ? 'font-card font-card-large' : 'font-card' });
    const family = `ref-font-${Math.random().toString(36).slice(2)}`;
    const label = attachment.filename.replace(/\.[^.]+$/, '');
    const sampleText = el('span', { style: `font-family: '${family}', inherit;` }, ['Aa Bb Cc']);
    holder.append(sampleText, el('span', { class: 'font-card-name' }, [label]));
    if (attachment.font_url) {
      const face = new FontFace(family, `url("${String(attachment.font_url).replace(/"/g, '%22')}")`);
      face
        .load()
        .then((loaded) => {
          document.fonts.add(loaded);
          sampleText.style.fontFamily = `'${family}', inherit`;
        })
        .catch(() => {
          holder.classList.add('font-card-plain');
        });
    } else {
      holder.classList.add('font-card-plain');
    }
    return holder;
  }

  async function uploadOne(file) {
    if (attachments.length >= options.max) {
      say(`Social Campaign keeps up to ${options.max} references. Remove one before adding another.`);
      return;
    }
    const extension = extensionOf(file.name);
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      say(`"${file.name}" is not an image, a video or a font file, so it was not attached.`);
      return;
    }
    say('');
    try {
      const response = await fetch(
        `/api/brand-references/upload?target=${encodeURIComponent(options.target)}&filename=${encodeURIComponent(
          file.name,
        )}`,
        { method: 'POST', body: file },
      );
      const body = await response.json();
      if (!response.ok) {
        say(String(body.error ?? `"${file.name}" could not be attached.`));
        return;
      }
      const asset = body.asset ?? {};
      const filename = String(asset.filename ?? file.name);
      const isFont = FONT_EXTENSIONS.includes(extension);
      const attachment = {
        path: String(asset.path ?? ''),
        filename,
        thumbnail_url: asset.thumbnail_url ?? null,
        mime: asset.mime ?? file.type ?? null,
        font_url: isFont
          ? `/api/brand-references/font/${encodeURIComponent(options.target)}/${encodeURIComponent(filename)}`
          : null,
      };
      attachments.push(attachment);
      addTile(attachment);
    } catch {
      say(`"${file.name}" could not be attached just now. Try again.`);
    }
  }

  /** @param {FileList|File[]} files */
  async function uploadAll(files) {
    for (const file of Array.from(files)) {
      // eslint-disable-next-line no-await-in-loop -- one at a time keeps the cap check honest
      await uploadOne(file);
    }
  }

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    if (input.files) void uploadAll(input.files);
    input.value = '';
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dropzone-hover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dropzone-hover'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dropzone-hover');
    if (event.dataTransfer?.files) void uploadAll(event.dataTransfer.files);
  });

  return {
    element: root,
    paths: () => attachments.map((attachment) => attachment.path),
  };
}

/**
 * @param {any} data
 * @returns {HTMLElement}
 */
function renderBrief(data) {
  const root = card(data.title ?? 'Onboard a Brand');
  root.append(
    el('p', { class: 'muted' }, [
      'Tell Social Campaign about the brand and it will research the rest.',
    ]),
  );

  const nameField = el('div', { class: 'field' }, [el('label', { for: 'brand-name' }, ['Brand name'])]);
  const nameInput = /** @type {HTMLInputElement} */ (
    el('input', { id: 'brand-name', type: 'text', spellcheck: 'false', autocomplete: 'off' })
  );
  nameInput.value = data.values?.name ?? '';
  nameField.append(nameInput);

  const briefField = el('div', { class: 'field' }, [
    el('label', { for: 'brand-brief' }, ['Tell us about the brand']),
    el('p', { class: 'hint' }, [
      'Its website, its social accounts, what it sells, and anything else worth knowing. Social Campaign ' +
        'reads this and pulls out the links itself.',
    ]),
  ]);
  const briefInput = /** @type {HTMLTextAreaElement} */ (
    el('textarea', {
      id: 'brand-brief',
      rows: '8',
      spellcheck: 'true',
      placeholder:
        'For example: We are Acme Goods, acmegoods.com. We sell reusable water bottles. Instagram is ' +
        '@acmegoods, TikTok is @acmegoodsofficial. We are playful and a little irreverent, aimed at people ' +
        'who hike and commute by bike.',
    })
  );
  briefInput.value = data.values?.brief ?? '';
  briefField.append(briefInput);

  const draftId = String(data.draft_id ?? '');
  const references = referencesDropzone({ target: draftId, max: Number(data.max_references) || 50 });

  const mediaFolder = folderPicker({
    value: data.values?.source_media_folder ?? '',
    allowCreate: false,
    selectionLabel: 'Social Campaign will read:',
    idPrefix: 'brand-media',
    selectionRequired: true,
  });
  const mediaField = el('div', { class: 'field' }, [
    el('label', {}, ['Source media folder']),
    el('p', { class: 'hint' }, ['The brand\'s existing footage. The creative library indexes this later.']),
    mediaFolder.element,
  ]);

  root.append(nameField, briefField, references.element, mediaField);

  const startButton = button(
    'Start',
    () => {
      if (nameInput.value.trim().length === 0) {
        nameInput.focus();
        return;
      }
      startButton.disabled = true;
      startButton.textContent = 'Starting';
      const chosenFolder = mediaFolder.value();
      const payload = {
        name: nameInput.value.trim(),
        brief: briefInput.value.trim(),
        creative_references: references.paths(),
        draft_id: draftId,
        campaign_id: data.campaign_id ?? null,
      };
      // Only ever send source_media_folder when someone explicitly chose one: the
      // picker's browsing position is not a selection, and omitting the key (rather
      // than sending "" or null) is how the server tells indexing was never asked for.
      if (chosenFolder.length > 0) payload.source_media_folder = chosenFolder;
      data.act('submit_brief', payload);
    },
    { primary: true },
  );
  root.append(el('div', { class: 'actions' }, [startButton, button('Cancel', () => data.act('cancel'))]));
  return root;
}

/**
 * @param {any} data
 * @returns {HTMLElement}
 */
function renderProgress(data) {
  const root = card(data.title ?? 'Building the brand profile');
  root.append(el('p', { class: 'muted' }, ['Social Campaign is working through your brand.']));

  const steps = Array.isArray(data.steps) ? data.steps : [];
  const list = el('ul', { class: 'steps' });
  for (const step of steps) {
    const status = String(step.status ?? 'pending');
    list.append(
      el('li', { 'data-status': status }, [
        el('span', { class: 'step-dot' }),
        `${step.label}: ${STEP_TEXT[status] ?? status}`,
      ]),
    );
  }
  root.append(list);
  root.append(el('div', { class: 'actions' }, [button('Cancel', () => data.act('cancel'))]));
  return root;
}

const PILLAR_LABELS = {
  brand_voice: 'Brand Voice',
  audience: 'Audience',
  positioning: 'Positioning',
  platform_playbook: 'Platform Playbook',
};

/**
 * @param {any} data
 * @returns {HTMLElement}
 */
function renderPillars(data) {
  const root = card(data.title ?? `${data.brand_name ?? 'Brand'}: Brand Pillars`);
  root.append(
    el('p', { class: 'muted' }, [
      'Edit any of these. What you save always outranks what research found.',
    ]),
  );

  const pillars = data.pillars ?? {};
  const help = data.pillar_help ?? {};
  const gaps = Array.isArray(data.gaps) ? data.gaps : [];
  if (gaps.length > 0) {
    root.append(
      el('p', { class: 'banner', 'data-tone': 'warning' }, [
        `Research could not fill in: ${gaps.map((key) => PILLAR_LABELS[key] ?? key).join(', ')}.`,
      ]),
    );
  }

  /** @type {Record<string, HTMLTextAreaElement>} */
  const inputs = {};
  const keys = ['brand_voice', 'audience', 'positioning', 'platform_playbook'];
  for (const key of keys) {
    const id = `pillar-${key}`;
    const field = el('div', { class: 'field' }, [
      el('label', { for: id }, [PILLAR_LABELS[key] ?? key]),
      el('p', { class: 'hint' }, [String(help[key] ?? '')]),
    ]);
    const textarea = /** @type {HTMLTextAreaElement} */ (el('textarea', { id, rows: '5', spellcheck: 'true' }));
    textarea.value = String(pillars[key]?.value ?? '');
    inputs[key] = textarea;
    field.append(textarea);
    root.append(field);
  }

  const saveButton = button(
    'Save',
    () => {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving';
      data.act('save_pillars', {
        brand_id: data.brand_id,
        pillars: Object.fromEntries(keys.map((key) => [key, inputs[key].value.trim()])),
      });
    },
    { primary: true },
  );

  const actions = [saveButton];
  if (gaps.length > 0) {
    actions.push(
      button('Retry research for what\'s missing', () => data.act('retry_research', { brand_id: data.brand_id, parts: gaps })),
    );
  }
  actions.push(button('Back to Home', () => data.act('back_home')));
  actions.push(
    button('Start a Job', () => data.act('start_job', { brand_id: data.brand_id, campaign_id: data.campaign_id ?? null })),
  );
  root.append(el('div', { class: 'actions' }, actions));
  return root;
}

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const withAct = { ...data, act };
  if (data.mode === 'progress') return renderProgress(withAct);
  if (data.mode === 'pillars') return renderPillars(withAct);
  return renderBrief(withAct);
}
