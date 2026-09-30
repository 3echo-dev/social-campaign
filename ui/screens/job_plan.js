/**
 * The plan: five phases the job runs through, what is in the way, and the stage
 * level detail behind a collapsed control for anyone who wants it.
 *
 * Only real blockers appear (spec section 28). A capability nobody needs is never
 * mentioned, and the plan is readable without knowing a single internal name - the
 * five phases are the whole story; the dozen or so internal stages behind them are
 * an implementation detail, shown only when asked for.
 */

import { button, card, el, formatDurationShort } from './dom.js';

const STATUS_LABEL = {
  required: 'To do',
  waiting: 'Waiting',
  completed: 'Done',
  skipped: 'Skipped',
  not_applicable: 'Not needed',
};

const PHASE_STATUS_LABEL = {
  to_do: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  waiting: 'Waiting',
  skipped: 'Not needed',
};

/**
 * @param {any} data
 * @param {(action: string, payload?: any) => void} act
 * @returns {HTMLElement}
 */
export function render(data, act) {
  const root = card(data.title ?? 'Your plan');

  if (data.summary) root.append(el('p', { class: 'lede' }, [String(data.summary)]));

  const platforms = Array.isArray(data.platforms) ? data.platforms : [];
  if (platforms.length > 0) {
    const strip = el('div', { class: 'plan-platforms' });
    for (const platform of platforms) {
      strip.append(el('span', { class: 'chip', 'data-state': 'ready' }, [label(String(platform))]));
    }
    root.append(strip);
  }

  const blockers = Array.isArray(data.blockers) ? data.blockers : [];
  for (const blocker of blockers) {
    const line = el('div', { class: 'banner', 'data-tone': 'warning' }, [String(blocker.message ?? '')]);
    if (blocker.provider) {
      line.append(
        button('Connect', () => act('connect', { provider: String(blocker.provider), capability: String(blocker.capability) }), {
          primary: true,
        }),
      );
    }
    root.append(line);
  }

  // The five phases, always in order, always all five markers, whether or not this
  // job needs every one of them.
  const phases = Array.isArray(data.phases) ? data.phases : [];
  if (phases.length > 0) root.append(phaseStepperList(phases));

  // Degraded capabilities are not rendered on this screen (spec 36 warnings still
  // travel in the payload for other consumers; the plan screen simply does not show
  // them).

  // The internal stage list, collapsed by default, for anyone who wants the detail
  // behind a phase.
  const stages = Array.isArray(data.stages) ? data.stages : [];
  if (stages.length > 0) root.append(stageDetails(stages));

  const approve = button('Start the job', () => act('approve_plan', { campaign_id: data.campaign_id ?? null }), {
    primary: true,
  });
  root.append(
    el('div', { class: 'actions' }, [
      approve,
      button('Change something', () => act('edit_plan', {})),
      button('Cancel', () => act('cancel')),
    ]),
  );

  // Keyboard focus lands on the main action without scrolling past the summary, the
  // connections it needs and the notes, which a person should read before starting.
  setTimeout(() => approve.focus({ preventScroll: true }), 0);
  return root;
}

/**
 * The five phase stepper: a numbered marker, the phase name, its one sentence, and a
 * status pill. A phase this job does not need is still shown, greyed, saying "Not
 * needed" rather than being removed, so the five are always visible.
 * @param {Array<{phase: string, name: string, description: string, status: string, has_decision: boolean, elapsed_ms: number|null}>} phases
 * @returns {HTMLElement}
 */
function phaseStepperList(phases) {
  const list = el('ol', { class: 'phase-stepper' });
  phases.forEach((phase, index) => {
    const status = String(phase.status ?? 'to_do');
    const item = el('li', { class: 'phase-step', 'data-status': status }, [
      el('span', { class: 'phase-step-marker', 'aria-hidden': 'true' }, [String(index + 1)]),
      el('div', { class: 'phase-step-body' }, [
        el('div', { class: 'phase-step-head' }, [
          el('span', { class: 'phase-step-name' }, [String(phase.name ?? '')]),
          el('span', { class: 'phase-step-status', 'data-status': status }, [PHASE_STATUS_LABEL[status] ?? status]),
        ]),
        el('p', { class: 'phase-step-desc' }, [String(phase.description ?? '')]),
      ]),
    ]);
    if (status === 'done' && Number.isFinite(phase.elapsed_ms) && phase.elapsed_ms > 0) {
      item.querySelector('.phase-step-body')?.append(
        el('span', { class: 'phase-step-elapsed muted' }, [formatDurationShort(phase.elapsed_ms)]),
      );
    }
    list.append(item);
  });
  return list;
}

/**
 * The internal stage list, behind one collapsed "Show the detailed steps" control,
 * closed by default so a person reads the five phases first.
 * @param {Array<any>} stages
 * @returns {HTMLElement}
 */
function stageDetails(stages) {
  const list = el('ol', { class: 'stages' });
  for (const stage of stages) {
    const status = String(stage.status ?? 'required');
    const item = el('li', { class: 'stage', 'data-status': status }, [
      el('span', { class: 'stage-name' }, [String(stage.label || label(String(stage.stage ?? '')))]),
      el('span', { class: 'stage-status', 'data-status': status }, [STATUS_LABEL[status] ?? status]),
    ]);
    if (stage.gate) item.append(el('span', { class: 'stage-gate' }, ['Your approval']));
    if (status === 'completed' && Number.isFinite(stage.duration_ms)) {
      item.append(el('span', { class: 'stage-elapsed muted' }, [formatDurationShort(stage.duration_ms)]));
    }
    if (stage.reason) item.append(el('p', { class: 'hint' }, [String(stage.reason)]));
    list.append(item);
  }
  return el('details', { class: 'plan-stage-details' }, [el('summary', {}, ['Show the detailed steps']), list]);
}

/**
 * @param {string} value
 * @returns {string}
 */
function label(value) {
  const known = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
  if (known[value]) return known[value];
  return value
    .split('_')
    .map((word) => (word.length <= 2 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}
