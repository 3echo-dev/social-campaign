/**
 * Media review gate: every generated asset with a preview (image or video, served
 * from /generated/ or /thumbs/). Each asset has its own approve, regenerate,
 * edit_prompt and reject actions; approve_all covers the whole batch in one click.
 */

import { button, card, el, phaseStrip, previewSrc, textarea } from './dom.js';

/** What a generated asset is called in front of the user. */
const KIND_LABEL = { image: 'Image', video: 'Video', audio: 'Audio' };

/** A decision already made on an asset, in the words the person used. */
const DECIDED_LABEL = { approved: 'Approved', rejected: 'Rejected', regenerate: 'Being made again' };

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Review the generated media');
  if (data.phase) root.prepend(phaseStrip(String(data.phase), { phases: data.phases }));
  const assets = Array.isArray(data.assets) ? data.assets : [];

  const grid = el('div', { class: 'asset-grid' });
  assets.forEach((asset, index) => {
    const assetId = String(asset.asset_id ?? '');
    // The user gets a plain name for the thing they are looking at. The panel id
    // and the asset id are how Social Campaign talks to itself, not to them.
    const label = `${KIND_LABEL[String(asset.kind)] ?? 'Asset'} ${index + 1}`;
    const previewWrap = el('div', { class: 'asset-preview' });
    let mediaFacts = null;
    if (asset.kind === 'video') {
      const attrs = { controls: 'true', muted: 'true', preload: 'metadata' };
      if (asset.cover_path) attrs.poster = previewSrc(asset.cover_path);
      const video = /** @type {HTMLVideoElement} */ (el('video', attrs));
      video.src = previewSrc(asset.path);
      previewWrap.append(video);
      const facts = [];
      const duration = Number(asset.duration_s);
      if (Number.isFinite(duration) && duration > 0) facts.push(`${Math.round(duration)}s`);
      facts.push(asset.subtitles_burned_in ? 'Subtitles burned in' : 'No subtitles burned in');
      mediaFacts = el('p', { class: 'asset-media-facts muted' }, [facts.join(' · ')]);
    } else if (asset.kind === 'image') {
      const img = /** @type {HTMLImageElement} */ (el('img', { alt: label }));
      img.src = previewSrc(asset.path);
      previewWrap.append(img);
    } else {
      previewWrap.append(el('span', { class: 'muted' }, [String(asset.kind ?? 'asset')]));
    }

    const { wrap: promptWrap, field: promptField } = textarea(`prompt-${assetId}`, 'New prompt', {
      placeholder: 'Describe what you want instead.',
      rows: 2,
    });
    const { wrap: notesWrap, field: notesField } = textarea(`notes-${assetId}`, 'Notes', {
      placeholder: 'What is wrong with this one.',
      rows: 2,
    });

    // What it was made from, so the person judges it against what they asked for.
    const heading = el('div', { class: 'asset-heading' }, [el('span', { class: 'asset-label' }, [label])]);
    const decided = DECIDED_LABEL[String(asset.review_state ?? '')];
    if (decided) heading.append(el('span', { class: 'chip', 'data-state': String(asset.review_state) }, [decided]));
    const body = el('div', { class: 'asset-body' }, mediaFacts ? [heading, mediaFacts] : [heading]);
    if (asset.prompt) body.append(el('p', { class: 'asset-prompt' }, [String(asset.prompt)]));
    if (asset.review_state === 'approved' || asset.review_state === 'rejected') {
      // A settled asset is shown for context only; its decision is not asked again.
      grid.append(el('div', { class: 'asset-card', 'data-state': String(asset.review_state) }, [previewWrap, body]));
      return;
    }
    body.append(
      promptWrap,
      notesWrap,
      el('div', { class: 'asset-actions' }, [
        button('Approve', () => act('approve', { asset_id: assetId }), { primary: true }),
        button('Regenerate', () => act('regenerate', { asset_id: assetId, notes: notesField.value.trim() })),
        button('Edit prompt', () =>
          act('edit_prompt', { asset_id: assetId, prompt: promptField.value.trim() }),
        ),
        button('Reject', () => act('reject', { asset_id: assetId, notes: notesField.value.trim() })),
      ]),
    );

    grid.append(el('div', { class: 'asset-card' }, [previewWrap, body]));
  });
  root.append(grid);

  if (assets.length === 0) root.append(el('p', { class: 'muted' }, ['No assets to review yet.']));

  // The badge counts what "Approve all" would still decide.
  const undecided = assets.filter((asset) => asset.review_state !== 'approved' && asset.review_state !== 'rejected').length;
  root.append(
    el('div', { class: 'actions' }, [
      button('Approve all', () => act('approve_all', {}), {
        primary: true,
        badge: undecided > 0 ? String(undecided) : undefined,
        badgeLabel: undecided > 0 ? `${undecided} to review` : undefined,
      }),
    ]),
  );

  return root;
}
