#!/usr/bin/env node
// One sentence per state, in the words a person reads.
//
// The state ids are for the files: status.md records them, lib-states.js checks the moves
// between them, and events carry them. None of that should ever reach the person. A marketer
// who is shown AWAITING_STORYBOARD_APPROVAL has to translate it before they can decide, and
// NEEDS_APPROVAL in a chat line reads as a system fault rather than as a question for them.
//
// lib-states.js already carries a short label for the stepper. This file carries the full
// sentence to say: what is true now, and what happens next. Every script that prints for a
// person uses it, so the wording is fixed in one place instead of being reinvented per script.
const states = require('./lib-states.js');
const stages = require('./lib-stages.js');

const SENTENCES = {
  INTAKE_PENDING: 'Waiting for a few details from you before the work can start.',
  NEEDS_CLARIFICATION: 'Waiting on your answers to a couple of questions.',
  UNSUPPORTED: "This job needs something I can't do yet, so nothing has started.",
  ROUTED: 'Working out the plan.',
  PLANNED: 'The plan is ready and the work has started.',

  RESEARCH_RUNNING: 'Looking into your audience and competitors.',
  RESEARCH_COMPLETE: 'The research is done and the brief is being written.',
  BRIEF_READY: 'The brief is ready and the ideas are being worked on.',

  REPORT_DRAFTING: 'Writing the report.',
  AWAITING_REPORT_REVIEW: 'The report is ready for your review.',

  CONCEPTS_DRAFTED: 'The ideas are written and about to be sent to you.',
  AWAITING_CONCEPT_APPROVAL: 'Pick a concept, or say what to change. Nothing is spent until you do.',
  CONCEPT_APPROVED: 'You picked a concept, so the script is being written.',

  AWAITING_STORYBOARD_APPROVAL: 'Approve the storyboard, or name a panel to change. Nothing is spent until you do.',
  STORYBOARD_APPROVED: 'The storyboard is approved and the pictures can be made.',

  MEDIA_GENERATING: 'Making the pictures and video.',
  MEDIA_READY: 'The video is made and is being checked.',

  DRAFTS_READY: 'Writing the captions.',
  VALIDATED: 'Everything is checked and ready to show you.',
  AWAITING_CONTENT_APPROVAL: 'Approve the final post, or say what to change.',
  CONTENT_APPROVED: 'Approved, and everything is being put together for you.',

  AWAITING_PUBLISH_APPROVAL: 'Confirm where and when to post.',
  PUBLISH_APPROVED: 'Confirmed, and everything is being put together for you.',

  PROPOSAL_DRAFTED: 'The campaign plan is written and about to be sent to you.',
  AWAITING_PROPOSAL_APPROVAL: 'Approve the campaign plan, or say what to change.',
  PROPOSAL_APPROVED: 'The plan is approved and the setup steps are being written.',
  AWAITING_ACTIVATION_APPROVAL: 'Approve going live, or say what to change.',
  ACTIVATION_APPROVED: 'Approved to go live, and everything is being put together for you.',

  HANDOFF_READY: 'Claude is closing this job.',
  // These sentences are retained for historical records. They must not invite a new
  // performance-review action when an old status is shown in a list or history view.
  HANDED_OFF: 'An old job, kept for your records.',
  METRICS_PENDING: 'An old job, kept for your records.',
  REPORT_DRAFTED: 'An old job, kept for your records.',
  AWAITING_REPORT_APPROVAL: 'An old job, kept for your records.',

  CHANGES_REQUESTED: 'Making the changes you asked for.',
  BLOCKED: 'Waiting on something before I can carry on.',
  ESCALATED: 'Stuck, and it needs you.',
  COMPLETE: 'All done. See where each post stands on the board.',
  CANCELLED: 'Stopped.',
};

const REPORT_COMPLETE = 'Your report is ready.';

// The sentence for a state. An unknown id is a bug in the caller, not something to print, so
// it comes back as a neutral sentence rather than leaking the id into the chat.
const sentence = (id, workflowId) => {
  if (id === 'COMPLETE' && stages.isReportWorkflow(workflowId)) return REPORT_COMPLETE;
  return SENTENCES[id] || 'Working on it.';
};
const has = id => Object.prototype.hasOwnProperty.call(SENTENCES, id);
const OLD_JOB = 'An old job, kept for your records.';
const historical = () => OLD_JOB;

const GATE_ASKS = Object.freeze({
  concept: 'Pick a concept, or say what to change.',
  storyboard: 'Approve the storyboard, or name a panel to change.',
  price: 'Approve the price before anything is made.',
  sample: 'Check the sample before the rest is made.',
  cut: 'Watch the joined video, then approve it and pick what to add, or say what to change.',
  finish: 'Watch the finished video, then approve it or say what to change.',
  content: 'Approve the final post, or say what to change.',
  publish: 'Confirm where and when to post.',
  campaign_proposal: 'Approve the campaign plan, or say what to change.',
  campaign_activation: 'Approve going live, or say what to change.',
  pictures: 'Look at every picture, then approve them all or say what to change on single ones.',
  clips: 'Watch every clip, then approve them all or say what to change on single ones.',
  findings: 'Read the report, then approve it or say what to change.',
});
const gateAsk = gate => GATE_ASKS[gate] || 'Claude needs your decision.';

const BRIEF_QUESTIONS = Object.freeze({
  request: 'What should Claude make?',
  kind: 'What type of content is this?',
  links: 'Which links should Claude look at?',
  objective: 'What is the main goal?',
  distribution: 'Should this run as organic posts, paid ads, or both?',
  platforms: 'Which social platforms is this for?',
  deliverables: 'Which posts do you need: the platform, the post type (Reel, post, Story or carousel, or a TikTok video or photo post), and how many?',
  audience: 'Who is this for?',
  budget: 'What is the most you want to spend?',
  landingPageUrl: 'Which web page should people go to?',
  productPhoto: 'Can you add a photo of the product?',
  subjectPhoto: 'Can you add a picture of the character?',
});
const SOURCE_QUESTIONS = Object.freeze({
  link_or_file: 'Which posts or campaign should Claude look at?',
  video: 'Which video should Claude break down?',
});
const FINISH_BRIEF = 'Finish the brief so Claude can start.';
const QUESTION_WAITING = 'Claude has a question for you.';
const QUESTION_NEXT_ACTION = 'Waiting for your answer to a question before the next step starts.';
const QUESTION_BLOCKED_ON = 'Your answer to a question';
const NEEDS_YOU_IN_CHAT = 'Claude needs something from you. Check the chat.';
const briefQuestion = (key, need) => (need && SOURCE_QUESTIONS[need]) || BRIEF_QUESTIONS[key] || FINISH_BRIEF;

const BLOCKED_NOTHING = /^(nothing|none|n\/?a|-|tbd|you)$/i;
const BLOCKED_SELF = /^(waiting|blocked|needs|awaiting|claude)\b/i;
const BLOCKED_LIMIT = 160;
const YOU_MUST = /^you\s+(?:(?:will\s+)?(?:need|needs)\s+to|(?:will\s+)?have\s+to|must|should)\s+(?=\S)/i;
const YOU_TO = /^to\s+(?=\S)/i;
const NOUN_PHRASE = /^(?:a|an|the|your|their|this|that|these|those|some|any|more|another|one|two|three|\d+)\s+\S/i;
const upperFirst = text => text[0].toUpperCase() + text.slice(1);

const blockedAskOf = said => {
  const plain = said.replace(/^you(?:'|\u2019)ll\b/i, 'you will');
  const must = YOU_MUST.exec(plain);
  if (must) return `Claude is waiting for you to ${plain.slice(must[0].length)}.`;
  const rest = plain.replace(/^you\b[\s,:-]*/i, '');
  if (YOU_TO.test(rest)) return `Claude is waiting for you ${rest}.`;
  return NOUN_PHRASE.test(rest) ? `Claude is waiting on you for ${rest}.` : null;
};

const blockedReason = raw => {
  const said = String(raw ?? '').split('\n')[0].trim().replace(/[.\s]+$/, '');
  if (!said || BLOCKED_NOTHING.test(said)) return null;
  const ask = /^you\b/i.test(said) ? blockedAskOf(said) : undefined;
  if (ask === null) return null;
  const line = ask || (BLOCKED_SELF.test(said) ? `${upperFirst(said)}.` : `Claude is held up: ${said}.`);
  return line.length > BLOCKED_LIMIT ? `${line.slice(0, BLOCKED_LIMIT - 1).trimEnd()}.` : line;
};

const CALM = 'Nothing needed from you yet.';
const TOGETHER = 'Claude is putting everything together.';
const ANNOUNCEMENTS = Object.freeze({
  INTAKE_PENDING: `Claude is reading your brief. ${CALM}`,
  NEEDS_CLARIFICATION: `Claude is reading your brief. ${CALM}`,
  UNSUPPORTED: "Claude can't do this job yet, so nothing has started.",
  ROUTED: `Claude is planning the work. ${CALM}`,
  PLANNED: `Claude is starting the work. ${CALM}`,
  RESEARCH_RUNNING: `Claude is researching. ${CALM}`,
  RESEARCH_COMPLETE: `Claude is writing the brief. ${CALM}`,
  BRIEF_READY: `Claude is coming up with ideas. ${CALM}`,
  REPORT_DRAFTING: 'Claude is writing the report.',
  AWAITING_REPORT_REVIEW: 'Your report is ready to read.',
  CONCEPTS_DRAFTED: 'Claude is getting the ideas ready to show you.',
  AWAITING_CONCEPT_APPROVAL: 'The ideas are ready for you to pick from.',
  CONCEPT_APPROVED: 'Claude is writing the storyboard.',
  AWAITING_STORYBOARD_APPROVAL: 'The storyboard is ready for you to check.',
  STORYBOARD_APPROVED: 'Claude is working out the price.',
  MEDIA_GENERATING: 'Claude is making the pictures and video.',
  MEDIA_READY: 'Claude is checking the pictures and video.',
  DRAFTS_READY: 'Claude is writing the captions.',
  VALIDATED: 'Claude is getting the final post ready to show you.',
  AWAITING_CONTENT_APPROVAL: 'The final post is ready for you to check.',
  CONTENT_APPROVED: TOGETHER,
  AWAITING_PUBLISH_APPROVAL: 'The posting plan is ready for you to check.',
  PUBLISH_APPROVED: TOGETHER,
  PROPOSAL_DRAFTED: 'Claude is getting the campaign plan ready to show you.',
  AWAITING_PROPOSAL_APPROVAL: 'The campaign plan is ready for you to check.',
  PROPOSAL_APPROVED: 'Claude is writing the steps to set up the campaign.',
  AWAITING_ACTIVATION_APPROVAL: 'The campaign is ready for you to send live.',
  ACTIVATION_APPROVED: TOGETHER,
  HANDOFF_READY: 'Claude is closing this job.',
  HANDED_OFF: OLD_JOB,
  METRICS_PENDING: OLD_JOB,
  REPORT_DRAFTED: OLD_JOB,
  AWAITING_REPORT_APPROVAL: OLD_JOB,
  CHANGES_REQUESTED: 'Claude is making the changes you asked for.',
  BLOCKED: 'Claude is held up. Check the chat to see what it needs.',
  ESCALATED: 'Claude is stuck and needs your help in chat.',
  COMPLETE: 'All done. See where each post stands on the board.',
  CANCELLED: 'This job was stopped.',
});
const GATHERING = Object.freeze({
  research_report: `Claude is researching. ${CALM}`,
  creative_analysis: `Claude is reading the posts. ${CALM}`,
  video_breakdown: `Claude is watching the video. ${CALM}`,
});
const REPORT_ANNOUNCEMENTS = Object.freeze({
  RESEARCH_COMPLETE: 'Claude is writing the report.',
  COMPLETE: 'All done. Your report is ready.',
});
const PRICE_APPROVED = 'Claude is about to make the pictures and video.';

const announcement = (id, { workflowId = null, priceApproved = false } = {}) => {
  if (stages.isReportWorkflow(workflowId)) {
    const flow = String(workflowId).trim().toLowerCase().replace(/-/g, '_');
    if (id === 'RESEARCH_RUNNING' && GATHERING[flow]) return GATHERING[flow];
    if (REPORT_ANNOUNCEMENTS[id]) return REPORT_ANNOUNCEMENTS[id];
  }
  if (id === 'STORYBOARD_APPROVED' && priceApproved) return PRICE_APPROVED;
  return ANNOUNCEMENTS[id] || 'Claude is working on it.';
};

// Every state the table knows must have one. The test asserts this; the helper is here so a
// caller that builds its own summary can check before it prints.
const missing = () => states.ids().filter(id => !has(id));

// A last guard for anything assembled by hand: does this line still carry a state id?
const STATE_ID = /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b/;
const carriesStateId = text => STATE_ID.test(String(text));

module.exports = {
  SENTENCES, sentence, historical, has, missing, carriesStateId, REPORT_COMPLETE,
  GATE_ASKS, gateAsk, BRIEF_QUESTIONS, SOURCE_QUESTIONS, briefQuestion, FINISH_BRIEF, QUESTION_WAITING, QUESTION_NEXT_ACTION, QUESTION_BLOCKED_ON, NEEDS_YOU_IN_CHAT,
  ANNOUNCEMENTS, announcement, blockedReason,
};
