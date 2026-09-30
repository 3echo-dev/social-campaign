/**
 * Creative library.
 *
 * Three states in one screen: pick a folder and start, watch the indexing run,
 * then look over what was found. Starting the run is the authorization, so there is
 * no second confirmation. Thumbnails come from the pane's own /thumbs/ route.
 *
 * Analysis happens in background agents that never call a tool that re-shows this
 * screen, so the pane polls GET /api/live on its own (see liveUpdate/hasPendingWork
 * below and ui/app.js) and patches the parts that reflect progress: the per tile
 * analyzed status, the counts, and the two progress bars. The folder picker and the
 * actions row are never touched by a live patch, so a click in flight is never lost.
 */

import { button, card, el } from './dom.js';
import { folderPicker } from './folder_picker.js';

const KIND_LABEL = {
  video: 'Video',
  image: 'Image',
  audio: 'Audio',
  document: 'Document',
  script: 'Script',
  other: 'File',
};

const PHASE_LABEL = {
  inventory: 'Finding files',
  hashing: 'Reading files',
  probing: 'Reading details',
  thumbnails: 'Making thumbnails',
  done: 'Finished',
};

/**
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}

/**
 * @param {any} job
 * @returns {boolean}
 */
function isRunning(job) {
  return Boolean(job && (job.status === 'running' || job.status === 'queued'));
}

/**
 * @param {any} job
 * @returns {number} 0 to 1
 */
function progressOf(job) {
  if (!job) return 0;
  if (job.status === 'completed') return 1;
  if (!job.files_found) return 0;
  // Only files the pipeline is completely finished with count, so the bar never
  // reads 100% while thumbnails are still being made.
  const done = (job.registered ?? 0) + (job.duplicates ?? 0) + (job.skipped ?? 0) + (job.failed ?? 0);
  return Math.min(1, done / job.files_found);
}

/**
 * @param {any} job
 * @returns {string}
 */
function progressTitle(job) {
  if (isRunning(job)) return 'Indexing your folder';
  return job && job.status === 'failed' ? 'Indexing stopped' : 'Indexed';
}

/**
 * @param {string} label
 * @param {number} value
 * @returns {HTMLElement}
 */
function stat(label, value) {
  // The option chip grammar: what it counts on top, the number underneath.
  return el('div', { class: 'lib-stat' }, [
    el('span', { class: 'lib-stat-label' }, [label]),
    el('span', { class: 'lib-stat-value' }, [String(value)]),
  ]);
}

/**
 * The part of the ingest progress card that changes while a job runs: the bar,
 * the phase row, the per stage counts and any duplicate/skip/failure note.
 * @param {any} job
 * @param {any} summary
 * @returns {Node[]}
 */
function buildProgressLive(job, summary) {
  const nodes = [];
  const fraction = progressOf(job);
  const bar = el('div', { class: 'lib-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' });
  bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  const fill = el('div', { class: 'lib-bar-fill' });
  fill.style.width = `${Math.round(fraction * 100)}%`;
  bar.append(fill);
  nodes.push(bar);
  const phaseText = job.status === 'failed' ? String(job.error ?? 'Something went wrong.') : PHASE_LABEL[job.phase] ?? '';
  nodes.push(
    el('div', { class: 'lib-progress-row' }, [
      el('span', { class: 'muted' }, [phaseText]),
      el('span', { class: 'muted' }, [`${Math.round(fraction * 100)}%`]),
    ]),
  );
  nodes.push(
    el('div', { class: 'lib-stats' }, [
      stat('Files found', job.files_found ?? 0),
      stat('Hashed', job.hashed ?? 0),
      stat('Probed', job.probed ?? 0),
      stat('Thumbnails', job.thumbnails ?? 0),
      stat('Analyzed', summary ? summary.analyzed ?? 0 : 0),
    ]),
  );
  if (job.duplicates || job.skipped || job.failed) {
    const notes = [];
    if (job.duplicates) notes.push(`${job.duplicates} duplicate${job.duplicates === 1 ? '' : 's'} skipped`);
    if (job.skipped) notes.push(`${job.skipped} already in the library`);
    if (job.failed) notes.push(`${job.failed} could not be read`);
    nodes.push(el('p', { class: 'hint' }, [notes.join(', ') + '.']));
  }
  return nodes;
}

/**
 * The part of the "your library" card that changes as analysis and indexing
 * proceed: the summary line, the grid (each tile's analyzed status), and the
 * "Analyzing... N%" bar. Never includes the actions row, so a click the person
 * is about to make is never touched by a live patch.
 * @param {any} data
 * @returns {Node[]}
 */
function buildLibraryLive(data) {
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const summary = data.summary ?? null;
  const nodes = [];

  const subtitleText =
    summary && summary.total > 0
      ? `${summary.total} file${summary.total === 1 ? '' : 's'}, ${summary.analyzed ?? 0} analyzed.`
      : 'Nothing indexed yet.';
  nodes.push(el('p', { class: 'muted', id: 'lib-summary-line' }, [subtitleText]));

  if (assets.length > 0) {
    const grid = el('div', { class: 'lib-grid' });
    for (const asset of assets) {
      const tile = el('div', { class: 'lib-tile', 'data-asset-id': String(asset.id ?? ''), title: String(asset.filename ?? '') });
      const thumb = el('div', { class: 'lib-thumb', 'data-kind': String(asset.kind ?? 'other') });
      if (asset.thumbnail_url) {
        thumb.append(el('img', { src: String(asset.thumbnail_url), alt: '', loading: 'lazy' }));
      } else {
        const extension = String(asset.filename ?? '').split('.').pop();
        thumb.append(el('span', { class: 'lib-thumb-placeholder' }, [extension && extension !== asset.filename ? `.${extension}` : '']));
      }
      thumb.append(el('span', { class: 'lib-badge' }, [KIND_LABEL[asset.kind] ?? 'File']));
      const duration = formatDuration(asset.duration);
      if (duration) thumb.append(el('span', { class: 'lib-duration' }, [duration]));
      tile.append(thumb);
      tile.append(el('div', { class: 'lib-name' }, [String(asset.filename ?? '')]));
      tile.append(
        el('div', { class: 'lib-status', 'data-analyzed': asset.analyzed ? 'yes' : 'no' }, [
          el('span', { class: 'dot' }),
          asset.analyzed ? 'Analyzed' : 'Not analyzed',
        ]),
      );
      grid.append(tile);
    }
    nodes.push(grid);
    if (summary && summary.total > assets.length) {
      nodes.push(el('p', { class: 'hint' }, [`Showing ${assets.length} of ${summary.total}.`]));
    }
  }

  const total = summary ? summary.total ?? 0 : 0;
  const analyzed = summary ? summary.analyzed ?? 0 : 0;
  const pending = summary ? summary.pending_analysis ?? 0 : 0;
  const running = isRunning(data.job ?? null);
  // Analysis starts on its own once indexing finishes, so there is nothing to
  // click here: just a progress bar in the same style as the indexing bar
  // above, plus the underlying counts.
  if (!running && total > 0) {
    if (pending > 0) {
      const analyzingFraction = total > 0 ? Math.min(1, analyzed / total) : 0;
      const analyzingPct = Math.round(analyzingFraction * 100);
      const analyzingBar = el('div', {
        class: 'lib-bar',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(analyzingPct),
      });
      analyzingBar.append(el('div', { class: 'lib-bar-fill', style: `width: ${analyzingPct}%` }));
      nodes.push(analyzingBar);
      nodes.push(
        el('div', { class: 'lib-progress-row' }, [
          el('span', { class: 'muted' }, [`Analyzing... ${analyzingPct}%`]),
          el('span', { class: 'muted' }, [`${analyzed} of ${total} analyzed`]),
        ]),
      );
    } else {
      nodes.push(el('p', { class: 'hint', 'data-analyzing': 'no' }, [`${total} of ${total} analyzed.`]));
    }
  }
  return nodes;
}

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = el('div', { class: 'lib' });
  const job = data.job ?? null;
  const running = isRunning(job);
  const summary = data.summary ?? null;
  // Once a run has been started, the chooser is no longer the thing to look at:
  // progress and the grid move above it, and the chooser drops to the bottom so
  // the person can start another folder once they are done with this one.
  const started = Boolean(job);

  // Folder picker
  const picker = card(started ? 'Index another folder' : data.title ?? 'Build Creative Library');
  if (data.error) picker.append(el('div', { class: 'banner', 'data-tone': 'error' }, [String(data.error)]));
  picker.append(
    el('p', {}, [
      'Point Social Campaign at a folder of past videos, images, audio and scripts. ' +
        'Files are read in place and never changed.',
    ]),
  );
  // The same picker setup uses, minus "New folder": this one points at footage that
  // already exists, so making an empty folder here would only ever be a mistake.
  const startButton = button(
    running ? 'Indexing' : 'Start',
    () => {
      const folder = folders.value();
      if (!folder) {
        folders.focus();
        return;
      }
      startButton.disabled = true;
      startButton.textContent = 'Starting';
      act('start', { folder });
    },
    { primary: true },
  );
  const startReason = el('p', { class: 'hint', hidden: 'hidden' }, ['Choose a folder to index first.']);
  const folders = folderPicker({
    value: data.folder ?? '',
    allowCreate: false,
    selectionLabel: 'Social Campaign will read:',
    idPrefix: 'library',
    selectionRequired: true,
    onChange: (value) => {
      const hasChoice = value.trim().length > 0;
      startButton.disabled = running || !hasChoice;
      startReason.hidden = running || hasChoice;
    },
  });
  picker.append(folders.element);
  picker.append(el('p', { class: 'hint' }, ['Starting counts as permission to look through this folder.']));
  startButton.disabled = running || !(data.folder ?? '');
  startReason.hidden = running || Boolean(data.folder);
  picker.append(el('div', { class: 'actions' }, [startButton]));
  picker.append(startReason);

  // Progress. Everything inside #lib-progress-live is patched in place by a live
  // poll rather than rebuilt from scratch, so a screen refresh cannot reset scroll.
  let progress = null;
  if (job) {
    progress = card(progressTitle(job));
    progress.id = 'lib-progress-card';
    const title = progress.querySelector('h2');
    if (title) title.id = 'lib-progress-title';
    progress.append(el('p', { class: 'path' }, [String(job.source_folder ?? '')]));
    const live = el('div', { id: 'lib-progress-live' });
    live.append(...buildProgressLive(job, summary));
    progress.append(live);
  }

  // Grid. Everything inside #lib-live-region is patched in place the same way.
  const library = card('Your library');
  library.id = 'lib-library-card';
  const liveRegion = el('div', { id: 'lib-live-region' });
  liveRegion.append(...buildLibraryLive(data));
  library.append(liveRegion);

  const pending = summary ? summary.pending_analysis ?? 0 : 0;
  const analyzing = !running && pending > 0;
  const primaryButton = analyzing
    ? button(
        'Leave running',
        () => {
          primaryButton.disabled = true;
          act('leave', {});
        },
        { primary: true },
      )
    : button('Close', () => act('done', {}), { primary: true });
  const actionsRow = [primaryButton];
  if (analyzing) {
    const stopButton = button('Stop analyzing', () => {
      stopButton.disabled = true;
      act('stop_analysis', { brand_id: data.brand_id ?? null });
    });
    actionsRow.push(stopButton);
  }
  const startJobButton = button('Start a new job', () => {
    startJobButton.disabled = true;
    act('start_job', {});
  });
  actionsRow.push(startJobButton);
  library.append(el('div', { class: 'actions' }, actionsRow));
  if (analyzing) {
    library.append(
      el('p', { class: 'hint' }, [
        'Leave running keeps analyzing in the background. Stop analyzing ends it now and keeps what is already analyzed. Both Close and Start a new job let analysis keep running.',
      ]),
    );
  }

  // Order depends on whether a run has been started: before that, the chooser
  // is the only thing to do, so it stays on top. Once indexing has begun, the
  // progress panel and the grid move above it so nobody has to scroll past an
  // empty folder field to see what is happening.
  if (started) {
    if (progress) root.append(progress);
    root.append(library);
    root.append(picker);
  } else {
    root.append(picker);
    root.append(library);
  }

  if (!running && !data.folder) setTimeout(() => folders.focus(), 0);
  return root;
}

/**
 * Whether this screen still has work worth polling for: an indexing job in
 * flight, or assets still waiting on analysis. ui/app.js stops polling as soon
 * as this goes false.
 * @param {any} data
 * @returns {boolean}
 */
export function hasPendingWork(data) {
  const job = data.job ?? null;
  const pending = data.summary ? Number(data.summary.pending_analysis ?? 0) : 0;
  return isRunning(job) || pending > 0;
}

/**
 * Patch the screen in place from a GET /api/live response, without touching the
 * folder picker or the actions row. Returns false when the DOM shape no longer
 * matches (a progress card appeared or disappeared since the last real render),
 * in which case the caller should wait for the next full screen push instead of
 * patching.
 * @param {HTMLElement} container the element render() returned, still attached.
 * @param {any} data
 * @returns {boolean}
 */
export function liveUpdate(container, data) {
  const job = data.job ?? null;
  const progressCard = container.querySelector('#lib-progress-card');
  if (Boolean(job) !== Boolean(progressCard)) return false;
  if (job && progressCard) {
    const title = progressCard.querySelector('#lib-progress-title');
    if (title) title.textContent = progressTitle(job);
    const live = progressCard.querySelector('#lib-progress-live');
    if (live) live.replaceChildren(...buildProgressLive(job, data.summary ?? null));
  }
  const liveRegion = container.querySelector('#lib-live-region');
  if (!liveRegion) return false;
  liveRegion.replaceChildren(...buildLibraryLive(data));
  return true;
}
