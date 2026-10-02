import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { boardSnapshot, choosePostTime, choosePostType, choosePublishRouteOnBoard, closePublishedJob, reopenPublishPlan } from '../pipeline/board.mjs';
import { PUBLISH_ROUTES, hostedAssetsFor, readPublishIntent } from '../pipeline/publish-intent.mjs';
import { deliveryReference, handOverPost, lookupNeeded, projectPublishStatus, reconcilePosts, sentPosts } from '../pipeline/publish-attempts.mjs';
import { writeBoardDocuments } from '../pipeline/artifact.mjs';

const string = { type: 'string' };
const POST_TYPES = ['post', 'reel', 'story', 'carousel', 'video', 'photo'];

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

export const publishTools = [
  defineTool({
    name: 'pipeline_publish_route_choose',
    description: [
      'Save how a job\'s posts go out and rebuild its posting plan, for example when the person answers in chat instead of on the board.',
      'route is metricool_schedule (schedule each post in Metricool), metricool_draft (save each as a draft in Metricool), metricool_now (post within a few minutes of the approval) or self (the person posts it themselves).',
      'The Metricool routes need Metricool connected and the brand\'s Metricool brand chosen; otherwise it says so in plain words and changes nothing.',
      'When the job is waiting on the posting decision, the decision is registered again with the new plan, so tell the person the plan changed and that they approve it as it now is.',
      'An approval given for the earlier plan no longer applies to the new one.',
      'The route can only change while nothing is approved or sent: it is refused, in plain words, once the posting plan was approved, once anything was sent to Metricool, and once the job is past the posting decision.',
      'Returns the route, how many posts the plan has, whether every check passed (ready), and documents to write to the board.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand the job belongs to.' },
        jobId: string,
        route: { type: 'string', enum: [...PUBLISH_ROUTES] },
      },
      required: ['brand', 'jobId', 'route'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const result = choosePublishRouteOnBoard({ root, brand: args.brand, jobId: args.jobId, route: args.route });
      const projection = writeBoardDocuments({ root, snapshot: boardSnapshot({ root }), jobIds: [result.jobId] });
      return { ...result, projectionFile: projection.projectionFile, documents: projection.documents };
    },
  }),
  defineTool({
    name: 'pipeline_post_type_choose',
    description: [
      'Save what kind of post one deliverable is (for example a Facebook Story) when it never had one, and rebuild the posting plan, for example when the person answers in chat instead of choosing on the board.',
      'This is for a job planned before post types existed: its posting decision says "Choose what kind of ... post this is" and nothing else lets the person choose.',
      'placement is the kind: instagram post, reel, story or carousel; facebook post, reel or story; tiktok video or photo. It must be one the deliverable can be made into (a picture is never a Reel); otherwise it says which kinds fit and changes nothing.',
      'It is refused, in plain words, unless the job is waiting on the posting decision with nothing approved or sent, and it never replaces a kind the deliverable already has.',
      'When the decision is open it is registered again with the new plan, so tell the person the plan changed and that they approve it as it now is.',
      'Returns the deliverable, the placement, how many posts the plan has, whether the decision was presented again, and documents to write to the board.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand the job belongs to.' },
        jobId: string,
        deliverable: { ...string, description: 'The deliverable id, for example D1.' },
        placement: { type: 'string', enum: POST_TYPES },
      },
      required: ['brand', 'jobId', 'deliverable', 'placement'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const result = choosePostType({ root, brand: args.brand, jobId: args.jobId, deliverable: args.deliverable, placement: args.placement });
      const projection = writeBoardDocuments({ root, snapshot: boardSnapshot({ root }), jobIds: [result.jobId] });
      return { ...result, projectionFile: projection.projectionFile, documents: projection.documents };
    },
  }),
  defineTool({
    name: 'pipeline_post_time_choose',
    description: [
      'Save the posting time of one deliverable, or of every post at once when deliverable is left out (the card\'s "same time for every post"), and rebuild the posting plan once, for example when the person tells you in chat when a post should go out instead of choosing it on the board.',
      'dateTime is a plain local time as `YYYY-MM-DDTHH:MM` (no seconds, no offset), read in the time zone of the plan (the job\'s schedule zone, else the brand\'s, else the Metricool brand\'s), which it names in the answer. It must be a real time at least 5 minutes ahead there; otherwise it says why and changes nothing.',
      'The plan then sends this time for that post: it is read before the post\'s own publish plan and before the job schedule. A time chosen earlier is replaced.',
      'It is refused, in plain words, unless the job is waiting on the posting decision with nothing approved or sent.',
      'When the decision is open it is registered again with the new plan, so tell the person the plan changed and that they approve it as it now is.',
      'Returns the deliverable, the time and its zone, how many posts the plan has, whether the decision was presented again, and documents to write to the board.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand the job belongs to.' },
        jobId: string,
        deliverable: { ...string, description: 'The deliverable id, for example D1. Leave it out to set the same time for every post of the job in one step.' },
        dateTime: { ...string, description: 'The local time in the plan\'s zone, as YYYY-MM-DDTHH:MM, for example 2026-10-03T09:00.' },
      },
      required: ['brand', 'jobId', 'dateTime'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const result = choosePostTime({ root, brand: args.brand, jobId: args.jobId, deliverable: args.deliverable, dateTime: args.dateTime });
      const projection = writeBoardDocuments({ root, snapshot: boardSnapshot({ root }), jobIds: [result.jobId] });
      return { ...result, projectionFile: projection.projectionFile, documents: projection.documents };
    },
  }),
  defineTool({
    name: 'pipeline_publish_reconcile',
    description: [
      "Settle what Metricool holds for a job's posts, from what Metricool's getScheduledPosts really returned.",
      'It takes only brand and jobId: the plugin keeps every getScheduledPosts reply by itself, with the brand it was asked for, and this reads only those, never anything passed in.',
      'So first call it to see lookup: whether Metricool has to be read for this job, which posts, the brandId, the timezone and the span (from and to) to ask getScheduledPosts for. Then call getScheduledPosts (read-only, with extendedRange) with that brandId, timezone, fromDate (from) and toDate (to), and call this again.',
      'A post sent with no known result (an error, a timeout, an unreadable reply, or a send still without an answer after ten minutes) is recorded as sent only when exactly one listed post is on the same network within ten minutes of its time with its text.',
      'Every other answer for it is ambiguous, an empty listing included: it stays blocked, and the person has to check in Metricool and say whether it is there.',
      'This never records that a post is safe to send again, and no call here may send it again; only the person can say it is not in Metricool.',
      'With no listing captured yet the answer is no_listing, and the span above is what to ask for; still_sending means the call is minutes old and may still finish.',
      'A post already sent has its status read back by its uuid (posted with its public link, failed with the reason, still pending), and one that a listing captured after its time no longer shows is recorded as missing, which the board shows as check in Metricool.',
      'Returns results per post, allSent, the deliveryReference to finish the job with once every post is sent, sent (each post with the uuid and id Metricool gave it), the status of each post, and documents to write to the board.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: { ...string, description: 'The brand the job belongs to.' },
        jobId: string,
      },
      required: ['brand', 'jobId'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = local(workspace);
      const job = runtime.listJobs({ root, brand: args.brand }).find(item => item.jobId === String(args.jobId || '').trim());
      if (!job) throw new Error('This job could not be found.');
      const intent = readPublishIntent(job.path);
      if (!intent) throw new Error('This job has no posting plan, so there is nothing to settle.');
      const reconciled = reconcilePosts({ jobDir: job.path, intent });
      const projection = writeBoardDocuments({ root, snapshot: boardSnapshot({ root }), jobIds: [job.jobId] });
      const status = projectPublishStatus({ jobDir: job.path, intent });
      return {
        ok: true,
        brand: args.brand,
        jobId: job.jobId,
        lookup: lookupNeeded({ jobDir: job.path, intent }),
        results: reconciled.results,
        changed: reconciled.changed,
        allSent: Boolean(status?.allSent),
        deliveryReference: deliveryReference({ jobDir: job.path, intent }),
        sent: sentPosts({ jobDir: job.path, intent }),
        status: status?.posts ?? [],
        projectionFile: projection.projectionFile,
        documents: projection.documents,
      };
    },
  }),
  defineTool({
    name: 'pipeline_publish_hand_over',
    description: [
      'Give one post of a Metricool plan to the person to post themselves: it then appears in their posting kit on the board, and the plugin never sends it again.',
      'Do this only for a post you cannot send: a refusal you cannot fix, a "Post now" approval that expired, or the person asking you to. Say so to the person in one plain line when you do. Never hand a post over just because a send failed or has no known result.',
      'It is refused, in plain words, while anything for the post is open or settled: a send still waiting for an answer or with no known result, a post that may already be in Metricool (ambiguous), or a post that was sent (the person changes it in Metricool).',
      'Handing a post over twice is harmless. Returns ok, already when it was handed over before, and documents to write to the board.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { brand: { ...string, description: 'The brand the job belongs to.' }, jobId: string, postId: { ...string, description: 'The id of the post in the posting plan, for example D1-instagram.' } },
      required: ['brand', 'jobId', 'postId'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = local(workspace);
      const result = handOverPost({ root, brand: args.brand, jobId: args.jobId, postId: String(args.postId || '').trim() });
      const projection = writeBoardDocuments({ root, snapshot: boardSnapshot({ root }), jobIds: [String(args.jobId).trim()] });
      return { ...result, projectionFile: projection.projectionFile, documents: projection.documents };
    },
  }),
  defineTool({
    name: 'pipeline_publish_close',
    description: [
      'Close a job once every post of its approved plan is out: each sent through Metricool, or marked as posted by the person from the posting kit.',
      'This is the one way to finish a posting job, so use it instead of building the hand-off or running complete-job.js yourself.',
      'It is safe to call again at any time, including after a failure part-way through: under the job\'s send lock it builds the hand-off package when it is missing or no longer matches, moves the job to the ready step, writes the delivery record with the Metricool references and the person\'s marks, and completes the job.',
      'It never closes a job while a post is neither sent nor marked, and says which; a post that failed or was never sent either is sent (only if nothing was sent for it that could be live) or is posted by the person from the kit.',
      'Returns closed, settled (every post is out), total, state, the reference it completed with, a plain reason when it did not close, and documents to write to the board.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { brand: { ...string, description: 'The brand the job belongs to.' }, jobId: string },
      required: ['brand', 'jobId'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = local(workspace);
      const result = closePublishedJob({ root, brand: args.brand, jobId: args.jobId });
      const projection = writeBoardDocuments({ root, snapshot: boardSnapshot({ root }), jobIds: [String(args.jobId).trim()] });
      return { ...result, projectionFile: projection.projectionFile, documents: projection.documents };
    },
  }),
  defineTool({
    name: 'pipeline_publish_reopen',
    description: [
      'Take an approved posting plan back to the posting decision so it can change, for example when the person asks to change what was approved, or a Post now approval has gone stale after a day.',
      'Only while nothing was sent: the job must be at the confirmed step and nothing recorded as sent to Metricool, in the job or its copy. Otherwise it refuses in plain words, because once any post went out the plan is frozen: the unsent posts go to the posting kit and the person changes the sent ones in Metricool.',
      'The old approval stays on record but no longer counts, so nothing is uploaded or sent on it. The plan is rebuilt and the posting decision is presented again; tell the person it changed and wait for their new answer.',
      'Returns reopened, presented, and documents to write to the board.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { brand: { ...string, description: 'The brand the job belongs to.' }, jobId: string },
      required: ['brand', 'jobId'],
      additionalProperties: false,
    },
    handler: (args, { workspace }) => {
      const root = local(workspace);
      const result = reopenPublishPlan({ root, brand: args.brand, jobId: args.jobId });
      const projection = writeBoardDocuments({ root, snapshot: boardSnapshot({ root }), jobIds: [result.jobId] });
      return { ...result, projectionFile: projection.projectionFile, documents: projection.documents };
    },
  }),
];
