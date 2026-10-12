// Short replies for the tools the Director calls most. The Director keeps one chat for a whole job, so a tool result
// that repeats itself fills that chat for nothing. These helpers drop only what is already said elsewhere in the same
// reply (the stage list and file lists inside `project`, the plan's markdown that its rows repeat), the files inside each saved reference folder, the token usage events, and the long wording of each task and the task lists of stages that are not under way (the plan's rows list every task).
// Pass `verbose: true` to the tool for the whole snapshot.

const EVENTS_KEPT = 20;
const TASK_KEYS = ['number', 'label', 'agent', 'stateAfter', 'gate', 'artifact', 'status'];

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Every task is already a row of the plan, so only the stage that is under way keeps its tasks.
const TASKS_KEPT_FOR = new Set(['complete', 'pending', 'skipped']);

function leanStages(stages) {
  if (!Array.isArray(stages)) return stages;
  return stages.map(stage => {
    if (!plain(stage)) return stage;
    const { tasks, ...rest } = stage;
    if (!Array.isArray(tasks)) return stage;
    if (TASKS_KEPT_FOR.has(stage.status)) return { ...rest, taskCount: tasks.length };
    return { ...rest, tasks: tasks.map(task => (plain(task) ? Object.fromEntries(TASK_KEYS.filter(key => task[key] !== undefined).map(key => [key, task[key]])) : task)) };
  });
}

export function leanPlan(plan) {
  if (!plain(plan) || plan.markdown === undefined) return plan;
  const { markdown: _markdown, ...rest } = plan;
  return rest;
}

const REFERENCES_FOLDER = 'inputs/references/';

/** One entry per saved reference folder (path, file count, total bytes) instead of every frame inside it. */
export function leanArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) return artifacts;
  const folders = new Map();
  const kept = [];
  for (const item of artifacts) {
    const parts = plain(item) && typeof item.path === 'string' && item.path.startsWith(REFERENCES_FOLDER) ? item.path.split('/') : [];
    if (parts.length < 5) {
      kept.push(item);
      continue;
    }
    const key = parts.slice(0, 4).join('/');
    let folder = folders.get(key);
    if (!folder) {
      folder = { path: key, files: 0, bytes: 0 };
      folders.set(key, folder);
      kept.push(folder);
    }
    folder.files += 1;
    folder.bytes += Number(item.bytes) || 0;
  }
  return kept;
}

function isTokenEvent(event) {
  return plain(event) && [event.name, event.event, event.eventName].includes('tokens.observed');
}

/** The job snapshot without its repeated parts. The caller's `verbose` flag skips this. */
export function leanSnapshot(snapshot) {
  if (!plain(snapshot)) return snapshot;
  const lean = { ...snapshot };
  if (plain(lean.project)) {
    const { stages: _stages, ...project } = lean.project;
    // The snapshot spreads the project's lists to its top level: say each list once.
    const repeated = ['artifacts', 'decisions', 'metrics'].filter(key => project[key] !== undefined && project[key] === snapshot[key]);
    for (const key of repeated) delete project[key];
    if (repeated.length) project.sameAsSnapshot = repeated;
    lean.project = project;
  }
  if (Array.isArray(lean.artifacts)) lean.artifacts = leanArtifacts(lean.artifacts);
  if (plain(lean.metrics) && Array.isArray(lean.metrics.events)) {
    const { events, ...metrics } = lean.metrics;
    lean.metrics = { ...metrics, tokenEventCount: events.length };
  }
  if (Array.isArray(lean.stages)) lean.stages = leanStages(lean.stages);
  if (plain(lean.plan)) lean.plan = leanPlan(lean.plan);
  if (Array.isArray(lean.events)) {
    const tokenEvents = lean.events.filter(isTokenEvent).length;
    if (tokenEvents) {
      lean.events = lean.events.filter(event => !isTokenEvent(event));
      lean.tokenEventCount = tokenEvents;
    }
    if (lean.events.length > EVENTS_KEPT) {
      lean.events = lean.events.slice(-EVENTS_KEPT);
      lean.eventsShown = EVENTS_KEPT;
    }
  }
  return lean;
}

/** A result that carries a snapshot (job create, intake update), shortened the same way. */
export function leanResult(result) {
  if (!plain(result)) return result;
  const lean = { ...result };
  if (plain(lean.plan)) lean.plan = leanPlan(lean.plan);
  if (plain(lean.snapshot)) {
    const snapshot = leanSnapshot(lean.snapshot);
    // The reply already carries the route, the plan and the job beside the snapshot: say each once.
    const repeated = [];
    for (const key of ['route', 'plan', 'job']) {
      if (snapshot[key] !== undefined && lean[key] !== undefined && JSON.stringify(snapshot[key]) === JSON.stringify(lean[key])) {
        delete snapshot[key];
        repeated.push(key);
      }
    }
    if (repeated.length) snapshot.sameAsReply = repeated;
    lean.snapshot = snapshot;
  }
  return lean;
}
