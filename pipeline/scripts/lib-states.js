// The state table as data, so it can be validated and translated instead of retyped.
//
// Two problems this solves. States lived only as prose in the producer, so nothing could
// check a transition; status.md was edited by hand and list-jobs.js regex-scraped the result.
// And the raw ids reached the person: a marketer reading AWAITING_STORYBOARD_APPROVAL has to
// translate before they can decide. Every id here carries the sentence to show instead.
//
// `next` lists the states a job may move to. `rollback` is where a "start over" verdict at a
// gate sends it: a string when there is only one answer, or a list when the answer depends on
// which gates the route kept, in which case rollbackFor() picks the first one the route has.
// An empty `next` means terminal.
const STATES = [
  // Intake and routing
  { id: 'INTAKE_PENDING',   label: 'Waiting for a few details from you', next: ['NEEDS_CLARIFICATION', 'ROUTED', 'UNSUPPORTED', 'BLOCKED', 'CANCELLED'] },
  { id: 'NEEDS_CLARIFICATION', label: 'Waiting on your answers',        next: ['INTAKE_PENDING', 'ROUTED', 'UNSUPPORTED', 'BLOCKED', 'CANCELLED'] },
  { id: 'UNSUPPORTED',      label: "This job needs something I can't do yet", next: ['INTAKE_PENDING', 'CANCELLED'] },
  { id: 'ROUTED',           label: 'Working out the plan',              next: ['PLANNED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  // Historical metric/report states stay in this table so existing status files and receipts
  // remain readable. They are never valid destinations for a current production plan.
  // DRAFTS_READY straight from the plan is the publish-only walk (publish_post): the person supplied
  // the pictures or video, so there is no research, brief or media step before the posts.
  { id: 'PLANNED',          label: 'Plan ready, starting work',         next: ['RESEARCH_RUNNING', 'BRIEF_READY', 'DRAFTS_READY', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  // Research and brief
  { id: 'RESEARCH_RUNNING', label: 'Looking into your audience and competitors', next: ['RESEARCH_COMPLETE', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'RESEARCH_COMPLETE', label: 'Research done, writing the brief',  next: ['BRIEF_READY', 'RESEARCH_RUNNING', 'REPORT_DRAFTING', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  // AWAITING_STORYBOARD_APPROVAL: routes with no concept gate reach the board straight from the
  // brief. Static media is organic-post row 6b; a repurpose cut plan is repurpose-video row 7.
  { id: 'BRIEF_READY',      label: 'Brief ready, working on ideas',      next: ['CONCEPTS_DRAFTED', 'AWAITING_STORYBOARD_APPROVAL', 'DRAFTS_READY', 'PROPOSAL_DRAFTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  { id: 'REPORT_DRAFTING',  label: 'Writing the report',                 next: ['AWAITING_REPORT_REVIEW', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'AWAITING_REPORT_REVIEW', label: 'Waiting for your review of the report', gate: 'findings', rollback: 'REPORT_DRAFTING',
    next: ['COMPLETE', 'REPORT_DRAFTING', 'CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  // Concept gate
  { id: 'CONCEPTS_DRAFTED', label: 'Ideas ready to show you',            next: ['AWAITING_CONCEPT_APPROVAL', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'AWAITING_CONCEPT_APPROVAL', label: 'Pick a concept', gate: 'concept', rollback: 'BRIEF_READY',
    next: ['CONCEPT_APPROVED', 'CONCEPTS_DRAFTED', 'BRIEF_READY', 'CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'CONCEPT_APPROVED', label: 'Concept picked, writing the script', next: ['AWAITING_STORYBOARD_APPROVAL', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  // Storyboard gate
  { id: 'AWAITING_STORYBOARD_APPROVAL', label: 'Approve the storyboard', gate: 'storyboard', rollback: ['AWAITING_CONCEPT_APPROVAL', 'BRIEF_READY'],
    next: ['STORYBOARD_APPROVED', 'CONCEPT_APPROVED', 'AWAITING_CONCEPT_APPROVAL', 'BRIEF_READY', 'CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'STORYBOARD_APPROVED', label: 'Storyboard approved, ready to make the pictures', next: ['MEDIA_GENERATING', 'DRAFTS_READY', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  // Media
  { id: 'MEDIA_GENERATING', label: 'Making the pictures and video',      next: ['MEDIA_READY', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'MEDIA_READY',      label: 'Video is made, being checked',       next: ['DRAFTS_READY', 'MEDIA_GENERATING', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  // Content gate
  { id: 'DRAFTS_READY',     label: 'Writing the captions',               next: ['VALIDATED', 'DRAFTS_READY', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'VALIDATED',        label: 'Checked, ready to show you',         next: ['AWAITING_CONTENT_APPROVAL', 'DRAFTS_READY', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'AWAITING_CONTENT_APPROVAL', label: 'Approve the final post', gate: 'content', rollback: 'DRAFTS_READY',
    next: ['CONTENT_APPROVED', 'DRAFTS_READY', 'CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'CONTENT_APPROVED', label: 'Approved, packaging it up',          next: ['AWAITING_PUBLISH_APPROVAL', 'HANDOFF_READY', 'PROPOSAL_DRAFTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  // Publish gate
  { id: 'AWAITING_PUBLISH_APPROVAL', label: 'Confirm where and when to post', gate: 'publish', rollback: 'AWAITING_CONTENT_APPROVAL',
    next: ['PUBLISH_APPROVED', 'AWAITING_CONTENT_APPROVAL', 'CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  // AWAITING_PUBLISH_APPROVAL again is the way back when an approved plan is reopened while nothing has been sent
  // (server/pipeline/board.mjs reopenPublishPlan checks that; the table only makes the one step legal).
  { id: 'PUBLISH_APPROVED', label: 'Posting',                          next: ['HANDOFF_READY', 'AWAITING_PUBLISH_APPROVAL', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  // Paid
  { id: 'PROPOSAL_DRAFTED', label: 'Campaign plan ready to show you',    next: ['AWAITING_PROPOSAL_APPROVAL', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'AWAITING_PROPOSAL_APPROVAL', label: 'Approve the campaign plan', gate: 'campaign_proposal', rollback: 'CONTENT_APPROVED',
    next: ['PROPOSAL_APPROVED', 'PROPOSAL_DRAFTED', 'CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'PROPOSAL_APPROVED', label: 'Plan approved, writing the setup steps', next: ['AWAITING_ACTIVATION_APPROVAL', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'AWAITING_ACTIVATION_APPROVAL', label: 'Approve going live', gate: 'campaign_activation', rollback: 'AWAITING_PROPOSAL_APPROVAL',
    next: ['ACTIVATION_APPROVED', 'AWAITING_PROPOSAL_APPROVAL', 'CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'ACTIVATION_APPROVED', label: 'Approved to go live, packaging it up', next: ['HANDOFF_READY', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  // Hand-off and after
  // Completion is a guarded producer transition. It records that the approved package was
  // delivered and says nothing about external publication or platform results.
  { id: 'HANDOFF_READY',    label: 'Delivered',                          next: ['COMPLETE', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  // These rows are retained as historical-only states for old jobs. Compatibility migration
  // may close them after validating the original handoff evidence and delivery reference.
  { id: 'HANDED_OFF',       label: 'Posted, waiting on the numbers', historicalOnly: true, retired: true,
    next: ['METRICS_PENDING', 'COMPLETE', 'BLOCKED', 'CANCELLED'] },
  { id: 'METRICS_PENDING',  label: 'Waiting on the numbers', historicalOnly: true, retired: true,
    next: ['REPORT_DRAFTED', 'COMPLETE', 'BLOCKED', 'CANCELLED'] },
  { id: 'REPORT_DRAFTED',   label: 'Report ready to show you', historicalOnly: true, retired: true,
    next: ['AWAITING_REPORT_APPROVAL', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'AWAITING_REPORT_APPROVAL', label: 'Approve the report', gate: 'report', rollback: 'METRICS_PENDING', historicalOnly: true, retired: true,
    next: ['COMPLETE', 'REPORT_DRAFTED', 'CHANGES_REQUESTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },

  // Anywhere
  { id: 'CHANGES_REQUESTED', label: 'Making the changes you asked for',
    next: ['CONCEPTS_DRAFTED', 'BRIEF_READY', 'CONCEPT_APPROVED', 'AWAITING_STORYBOARD_APPROVAL', 'DRAFTS_READY',
           'MEDIA_GENERATING', 'PROPOSAL_DRAFTED', 'REPORT_DRAFTING', 'REPORT_DRAFTED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] },
  { id: 'BLOCKED',          label: 'Waiting on something before I can carry on',
    next: ['INTAKE_PENDING', 'ROUTED', 'PLANNED', 'RESEARCH_RUNNING', 'BRIEF_READY', 'CONCEPT_APPROVED',
           'STORYBOARD_APPROVED', 'MEDIA_GENERATING', 'DRAFTS_READY', 'REPORT_DRAFTING', 'ESCALATED', 'CANCELLED'] },
  { id: 'ESCALATED',        label: 'Stuck, needs you',
    next: ['INTAKE_PENDING', 'BRIEF_READY', 'CONCEPTS_DRAFTED', 'DRAFTS_READY', 'REPORT_DRAFTING', 'CHANGES_REQUESTED', 'BLOCKED', 'CANCELLED'] },
  { id: 'COMPLETE',         label: 'Done',                                next: [] },
  { id: 'CANCELLED',        label: 'Stopped',                             next: [] },
];

const BY_ID = Object.fromEntries(STATES.map(s => [s.id, s]));

const get = id => BY_ID[id] || null;
const exists = id => Boolean(BY_ID[id]);
const label = id => (BY_ID[id] ? BY_ID[id].label : id);
const isGate = id => Boolean(BY_ID[id] && BY_ID[id].gate);
const gateOf = id => (BY_ID[id] ? BY_ID[id].gate || null : null);
// The first candidate, ignoring the route: what callers that have no route in hand still get.
const rollbackOf = id => {
  const raw = BY_ID[id] ? BY_ID[id].rollback : null;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] : raw;
};
const ids = () => STATES.map(s => s.id);

// A job may always stop or get stuck, and re-entering the same state is a no-op rather than
// an error: a retried script should not fail because the state is already correct.
function canMove(from, to, options = {}) {
  if (!exists(from) || !exists(to)) return false;
  if (from === to) return true;
  if (!options.allowRetired && (isRetired(from) || isRetired(to))) return false;
  return (BY_ID[from].next || []).includes(to);
}

const isRetired = id => Boolean(BY_ID[id] && (BY_ID[id].retired || BY_ID[id].historicalOnly));
const isHistoricalOnly = isRetired;
const isTerminal = id => Boolean(BY_ID[id] && !(BY_ID[id].next || []).length);
const DELIVERY_BOUNDARY_STATES = Object.freeze([
  'HANDOFF_READY', 'HANDED_OFF', 'METRICS_PENDING', 'REPORT_DRAFTED',
  'AWAITING_REPORT_APPROVAL', 'COMPLETE',
]);
const isDeliveryBoundary = id => DELIVERY_BOUNDARY_STATES.includes(id);
const isPostDelivery = id => ['HANDED_OFF', 'METRICS_PENDING', 'REPORT_DRAFTED', 'AWAITING_REPORT_APPROVAL'].includes(id);

// Where "start over" at a gate sends a job on this particular route. A rollback candidate that
// is itself a gate is only usable when the route kept that gate: a static post that never had a
// concept gate must roll back to the brief, not to a concept approval it never had. Falls back
// to the last candidate so this always answers something.
function rollbackFor(id, routeGates) {
  const raw = BY_ID[id] ? BY_ID[id].rollback : null;
  if (!raw) return null;
  const candidates = Array.isArray(raw) ? raw : [raw];
  const gates = Array.isArray(routeGates) ? routeGates : [];
  for (const c of candidates) {
    const gate = gateOf(c);
    if (!gate || gates.includes(gate)) return c;
  }
  return candidates[candidates.length - 1];
}

// The state a gate's approval moves the job into.
const APPROVED_STATE = {
  concept: 'CONCEPT_APPROVED',
  storyboard: 'STORYBOARD_APPROVED',
  content: 'CONTENT_APPROVED',
  publish: 'PUBLISH_APPROVED',
  campaign_proposal: 'PROPOSAL_APPROVED',
  campaign_activation: 'ACTIVATION_APPROVED',
  report: 'COMPLETE',
  findings: 'COMPLETE',
};

const AWAITING_STATE = Object.fromEntries(
  STATES.filter(s => s.gate).map(s => [s.gate, s.id])
);

const GATE_IDS = STATES.filter(s => s.gate && !s.retired && !s.historicalOnly).map(s => s.gate);

module.exports = {
  STATES, get, exists, label, isGate, gateOf, rollbackOf, rollbackFor, ids, canMove,
  isRetired, isHistoricalOnly, isTerminal, DELIVERY_BOUNDARY_STATES, isDeliveryBoundary,
  isPostDelivery, APPROVED_STATE, AWAITING_STATE, GATE_IDS,
};
