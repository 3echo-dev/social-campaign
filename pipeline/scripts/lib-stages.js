// Which of the ten stages a person sees a state as.
//
// `docs/STAGES.md` is the mapping in prose, for a model to read. This is the same mapping as
// data, so `set-state.js` can post progress for every state change without the producer
// remembering a second call, and so a test can check the two agree.
//
// A state that does not move the stepper maps to null: "start over" and "stuck" are told in
// words in the chat, and moving the stage backwards for them would misreport the run.
const STAGE_OF = {
  INTAKE_PENDING: { stage: 'getting-your-brief', substep: 'Reading the request', status: 'waiting' },
  NEEDS_CLARIFICATION: { stage: 'getting-your-brief', substep: 'A few questions', status: 'waiting' },
  UNSUPPORTED: { stage: 'getting-your-brief', status: 'waiting' },
  ROUTED: { stage: 'getting-your-brief', substep: 'Reading the request', status: 'running' },
  PLANNED: { stage: 'getting-your-brief', status: 'done' },

  RESEARCH_RUNNING: { stage: 'researching', substep: 'Looking at the audience and competitors', status: 'running' },
  RESEARCH_COMPLETE: { stage: 'researching', substep: 'Pulling it together', status: 'done' },

  BRIEF_READY: { stage: 'shaping-the-idea', substep: 'Strategy', status: 'running' },
  CONCEPTS_DRAFTED: { stage: 'shaping-the-idea', substep: 'Concepts', status: 'running' },
  AWAITING_CONCEPT_APPROVAL: { stage: 'your-approval-of-the-idea', status: 'waiting' },
  CONCEPT_APPROVED: { stage: 'shaping-the-idea', substep: 'Storyboard', status: 'running' },
  AWAITING_STORYBOARD_APPROVAL: { stage: 'your-approval-of-the-idea', status: 'waiting' },
  STORYBOARD_APPROVED: { stage: 'your-approval-of-the-idea', status: 'done' },

  MEDIA_GENERATING: { stage: 'making-the-images-and-video', substep: 'Images', status: 'running' },
  MEDIA_READY: { stage: 'making-the-images-and-video', substep: 'Checking them', status: 'done' },

  DRAFTS_READY: { stage: 'writing-the-posts', substep: 'Captions', status: 'running' },
  VALIDATED: { stage: 'writing-the-posts', substep: 'Checks', status: 'done' },
  AWAITING_CONTENT_APPROVAL: { stage: 'your-final-approval', status: 'waiting' },
  CONTENT_APPROVED: { stage: 'your-final-approval', status: 'done' },

  AWAITING_PUBLISH_APPROVAL: { stage: 'your-final-approval', status: 'waiting' },
  PUBLISH_APPROVED: { stage: 'your-final-approval', status: 'done' },

  PROPOSAL_DRAFTED: { stage: 'writing-the-posts', substep: 'Ad copy', status: 'running' },
  AWAITING_PROPOSAL_APPROVAL: { stage: 'your-final-approval', status: 'waiting' },
  PROPOSAL_APPROVED: { stage: 'your-final-approval', status: 'done' },
  AWAITING_ACTIVATION_APPROVAL: { stage: 'your-final-approval', status: 'waiting' },
  ACTIVATION_APPROVED: { stage: 'your-final-approval', status: 'done' },

  HANDOFF_READY: { stage: 'ready-to-post', status: 'done' },
  HANDED_OFF: { stage: 'ready-to-post', status: 'done' },
  // These rows are retained so an old status can still render, but they never represent
  // current work.  Keeping them done prevents a resumed historical job from starting a
  // processing clock or presenting a retired report gate.
  METRICS_PENDING: { stage: 'ready-to-post', status: 'done' },
  REPORT_DRAFTED: { stage: 'ready-to-post', status: 'done' },
  AWAITING_REPORT_APPROVAL: { stage: 'ready-to-post', status: 'done' },

  CHANGES_REQUESTED: null,
  BLOCKED: null,
  ESCALATED: null,
  COMPLETE: { stage: 'ready-to-post', status: 'done' },
  CANCELLED: null,
};

// The ten job stage ids, in the order the pane draws them.
const STAGE_IDS = [
  'getting-your-brief', 'researching', 'shaping-the-idea', 'your-approval-of-the-idea',
  'pricing-the-media', 'your-approval-of-the-price', 'making-the-images-and-video',
  'writing-the-posts', 'your-final-approval', 'ready-to-post',
];

const REPORT_STAGE_IDS = [
  'getting-your-brief', 'gathering', 'writing-the-report', 'your-review-of-the-report', 'report-ready',
];

const GATHERING_SUBSTEP = {
  research_report: 'Researching',
  creative_analysis: 'Reading the posts',
  video_breakdown: 'Watching the video',
};

const REPORT_WORKFLOW_IDS = new Set(Object.keys(GATHERING_SUBSTEP));

const normalizeWorkflowId = id => String(id || '').trim().toLowerCase().replace(/-/g, '_');
const isReportWorkflow = id => REPORT_WORKFLOW_IDS.has(normalizeWorkflowId(id));

function reportStageOf(id, workflowId) {
  const gathering = GATHERING_SUBSTEP[normalizeWorkflowId(workflowId)] || 'Gathering';
  const map = {
    INTAKE_PENDING: { stage: 'getting-your-brief', substep: 'Reading the request', status: 'waiting' },
    NEEDS_CLARIFICATION: { stage: 'getting-your-brief', substep: 'A few questions', status: 'waiting' },
    UNSUPPORTED: { stage: 'getting-your-brief', status: 'waiting' },
    ROUTED: { stage: 'getting-your-brief', substep: 'Reading the request', status: 'running' },
    PLANNED: { stage: 'getting-your-brief', status: 'done' },

    RESEARCH_RUNNING: { stage: 'gathering', substep: gathering, status: 'running' },
    RESEARCH_COMPLETE: { stage: 'gathering', status: 'done' },

    REPORT_DRAFTING: { stage: 'writing-the-report', status: 'running' },
    AWAITING_REPORT_REVIEW: { stage: 'your-review-of-the-report', status: 'waiting' },

    COMPLETE: { stage: 'report-ready', status: 'done' },

    CHANGES_REQUESTED: null,
    BLOCKED: null,
    ESCALATED: null,
    CANCELLED: null,
  };
  return map[id] || null;
}

const forState = (id, workflowId) => (isReportWorkflow(workflowId) ? reportStageOf(id, workflowId) : STAGE_OF[id] || null);

// The gate app takes either spelling of a stage id: the words a person reads
// (`getting-your-brief`, what docs/STAGES.md lists) or its own short id (`brief`). A run may
// be pointed at an older server, so the check here has to accept both and refuse anything
// else before the post goes out.
const SHORT_OF = {
  'getting-your-brief': 'brief',
  'researching': 'research',
  'shaping-the-idea': 'idea',
  'your-approval-of-the-idea': 'idea_approval',
  'pricing-the-media': 'pricing',
  'your-approval-of-the-price': 'price_approval',
  'making-the-images-and-video': 'media',
  'writing-the-posts': 'posts',
  'your-final-approval': 'final_approval',
  'ready-to-post': 'ready',
  'reading-your-site-and-files': 'brand_read',
  'a-few-questions': 'brand_questions',
  'writing-the-brand-files': 'brand_write',
  'your-approval': 'brand_approval',
  'done': 'brand_done',
  'gathering': 'gathering',
  'writing-the-report': 'report_writing',
  'your-review-of-the-report': 'report_review',
  'report-ready': 'report_done',
};

// The brand page's own five stages, in the order the pane draws them.
const BRAND_STAGE_IDS = [
  'reading-your-site-and-files', 'a-few-questions', 'writing-the-brand-files',
  'your-approval', 'done',
];

const SHORT_IDS = Object.values(SHORT_OF).concat(['home']);

// Both spellings, for a refusal message that names what would have worked.
const ACCEPTED_STAGE_IDS = Object.keys(SHORT_OF).concat(SHORT_IDS);

// The id as given, when it is one the app knows; null when it is neither spelling.
function resolveStage(id) {
  const said = String(id || '').trim();
  if (!said) return null;
  if (SHORT_OF[said]) return said;
  return SHORT_IDS.includes(said) ? said : null;
}


// Stages a person is asked to act on. The run never says one of these has started; the gate
// script does, when the question is actually on screen.
const APPROVAL_STAGE_IDS = [
  'your-approval-of-the-idea', 'your-approval-of-the-price', 'your-final-approval',
  'your-review-of-the-report',
];

/**
 * The stage that has plainly started, given a state that just finished one.
 *
 * A state change reports the stage it ends, and the next stage is reported by whichever
 * workflow row picks the work up. When that row forgets, the pane reads as finished while
 * the chat is visibly still working: the person watched "Making the images and video,
 * Complete" for six minutes while the posts were being written.
 *
 * This is only allowed to say what the state machine already knows. Every state the job may
 * legally move to has to land on the same stage, that stage has to be the very next one in
 * the list, and it must not be a stage where a person is asked something. Anything less
 * certain returns null and the pane waits to be told.
 */
function nextRunning(stateId, nextStateIds, walked, workflowId) {
  const here = forState(stateId, workflowId);
  if (!here || here.status !== 'done') return null;

  // Read against this route's own journey where we have it. A planned job may research or
  // go straight to the brief, which is two answers and so no answer at all, until you know
  // the route skips research. Then it is one, and the person sees the next stage light up
  // instead of watching a finished one with nothing under it.
  const defaultOrder = isReportWorkflow(workflowId) ? REPORT_STAGE_IDS : STAGE_IDS;
  const order = (walked && walked.length ? walked : defaultOrder);
  const at = order.indexOf(here.stage);
  if (at < 0 || at + 1 >= order.length) return null;

  // A state may legally go back the way it came: media ready can return to media generating
  // for a redo. Going back is a decision somebody makes, not something to announce, so only
  // the states that move the job on are read here, and only into stages this route walks.
  const candidates = (nextStateIds || []).map(id => forState(id, workflowId)).filter(Boolean)
    .filter(c => order.indexOf(c.stage) > at);
  if (!candidates.length) return null;

  // The very next stage of this route, and only if the job can legally get there from here.
  // A candidate further down the list is not a reason to stay silent: the job cannot skip
  // the stage in between, so the one after this is where the work goes next.
  //
  // Without a route in hand there is no "this route", and the ten stages are only what a job
  // might walk. Then every candidate has to agree before anything is said, because guessing
  // research on a job that skips it is the very thing this is here to stop.
  const knowsRoute = Boolean(walked && walked.length);
  const stage = order[at + 1];
  if (!candidates.some(c => c.stage === stage)) return null;
  if (!knowsRoute && !candidates.every(c => c.stage === stage)) return null;
  if (APPROVAL_STAGE_IDS.includes(stage)) return null;
  return { stage, status: 'running' };
}


/**
 * The stages this run will actually walk, from the states its plan will pass through.
 *
 * A route that skips research still drew "Researching" in the pane, greyed, for the whole
 * job. It never lights up, so the journey reads as though it stalled before it started.
 * The page hides what it is not given, so give it the truth.
 *
 * Pricing is not a state, it is two stages the media skills report around a quote, so they
 * come along whenever anything is being made.
 */
function walkedStages(stateIds, workflowId) {
  const report = isReportWorkflow(workflowId);
  const ids = report ? REPORT_STAGE_IDS : STAGE_IDS;
  const seen = new Set();
  for (const id of stateIds || []) {
    const step = forState(id, workflowId);
    if (step) seen.add(step.stage);
  }
  if (!seen.size) return null;
  if (!report && seen.has('making-the-images-and-video')) {
    seen.add('pricing-the-media');
    seen.add('your-approval-of-the-price');
  }
  // Every job is asked for and every job ends, whatever its plan says in between.
  seen.add(ids[0]);
  seen.add(ids[ids.length - 1]);
  return ids.filter(id => seen.has(id));
}

module.exports = {
  STAGE_OF, STAGE_IDS, REPORT_STAGE_IDS, APPROVAL_STAGE_IDS, nextRunning, walkedStages,
  BRAND_STAGE_IDS, SHORT_OF, ACCEPTED_STAGE_IDS, forState, resolveStage, isReportWorkflow,
};
