import { createRequire } from 'node:module';
import { join } from 'node:path';
import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { boardSnapshot } from '../pipeline/board.mjs';
import { writeBoardDocuments } from '../pipeline/artifact.mjs';
import { ANSWER_TEXT_LIMIT, OPTION_TEXT_LIMIT, QUESTION_OPTION_LIMIT, QUESTION_STATUSES, QUESTION_TEXT_LIMIT, answerQuestion, askQuestion, listQuestions, withdrawQuestion } from '../pipeline/questions.mjs';

const openQuestionLines = createRequire(import.meta.url)(join(runtime.runtimeConstants.pipelineRoot, 'scripts', 'lib-open-questions.js'));

const string = { type: 'string' };
const questionId = { ...string, description: 'The question id returned by pipeline_board_ask, such as q-1a2b3c4d5e6f.' };

function tool(name, description, properties, required, handler) {
  return defineTool({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, handler });
}

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

// Keep the job's Next action and Blocked on lines true: waiting on the answer while a question is open, back to normal when none is.
function syncStatusLines(root, question) {
  if (!question.jobId) return;
  try {
    const job = runtime.listJobs({ root }).find(item => item.jobId === question.jobId);
    if (job) openQuestionLines.refreshStatusLines(job.path, root, question.jobId);
  } catch { /* the lines are a courtesy; the question itself is saved */ }
}

function documentsFor(root, question) {
  syncStatusLines(root, question);
  return writeBoardDocuments({ root, snapshot: boardSnapshot({ root }), jobIds: question.jobId ? [question.jobId] : [] }).documents;
}

export const questionTools = [
  tool('pipeline_board_ask', `Every question the Director puts to the person goes through this tool, never only in chat: it posts one card that shows the same way in Needs you, on the job page and in the Director's chat, and closes in all three when it is answered anywhere. Post a question to the board's Needs you list, with up to ${QUESTION_OPTION_LIMIT} option buttons and, unless allowText is false, a typed answer. Ask the same question in chat too: whichever answer comes first counts, and the other place stops asking. Write the question and options in plain words a client understands, with no ids, file names, state names or code; those are refused with the reason. When you have a recommendation, make it the first option and end its label with "(recommended)": the person taps it as their answer, and nothing is chosen for them. Pass inChat true when you are asking the person in the chat to confirm something public or costly (posting, sending, spending): the board shows the same question with no buttons and tells the person to answer in the chat, because only a chat answer counts. Record that answer with pipeline_board_answer, which clears the notice, and it also clears itself when the send happens. Pass jobId for a question about one job, brand for a brand-wide one, or neither for the whole workspace. When the question is about a file in the job (the storyboard, the ideas, the script), also pass about with that file and the revision the person is looking at, so the card says which version it asks about. Returns the questionId and documents: the board documents to write, the same shape as pipeline_status. A board answer arrives as an answer_question board request; a chat answer is recorded with pipeline_board_answer.`, {
    brand: { ...string, description: 'Optional brand slug for a brand-wide question.' },
    jobId: { ...string, description: 'Optional job the question is about.' },
    text: { ...string, maxLength: QUESTION_TEXT_LIMIT, description: `The question in plain words, at most ${QUESTION_TEXT_LIMIT} characters.` },
    options: { type: 'array', maxItems: QUESTION_OPTION_LIMIT, items: { ...string, maxLength: OPTION_TEXT_LIMIT }, description: `Up to ${QUESTION_OPTION_LIMIT} short answer buttons, each at most ${OPTION_TEXT_LIMIT} characters.` },
    allowText: { type: 'boolean', description: 'Whether the board also offers a typed answer. Defaults to true.' },
    wantsUpload: { type: 'object', properties: { type: { type: 'string', enum: ['picture', 'video', 'audio', 'caption', 'addon'], description: 'What to ask for: picture, video, audio, caption (text) or addon (any other file). Defaults to picture.' } }, additionalProperties: false, description: 'Pass this when the question asks the person for a photo, clip, audio or other file (needs jobId): the card then shows an upload control, the file is saved as a reference on the job, and the question is answered. Keep any options you also give, such as reusing an earlier file.' },
    stills: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: { label: { ...string, maxLength: OPTION_TEXT_LIMIT }, file: { ...string, description: 'A picture inside the job folder, relative to it (png, jpg or webp).' } }, required: ['label', 'file'], additionalProperties: false }, description: 'Needs jobId. The pictures the question is about, shown on the card: for anything on the video itself (captions, on-screen text, a moment), frames of the finished video at those moments, with the captions burned in, made with media_extract_frames into the job folder. Run pipeline_review_copies_prepare after asking so the board can show them.' },
    takes: { type: 'array', minItems: 2, maxItems: QUESTION_OPTION_LIMIT, items: { type: 'object', properties: { label: { ...string, maxLength: OPTION_TEXT_LIMIT }, file: { ...string, description: 'The take\'s audio file, relative to the job folder.' } }, required: ['label', 'file'], additionalProperties: false }, description: 'Needs jobId. Versions of a voice-over or music track to pick between: the board plays them side by side on the card, and each label is also an answer button (they replace options). Normally posted by pipeline_combine_takes, not by hand.' },
    about: { type: 'object', properties: { path: { ...string, maxLength: 200, description: 'The file in the job folder, relative to it, such as drafts/D1/storyboard.md.' }, revision: { type: 'integer', minimum: 0, description: 'The revision of the job the person is looking at.' } }, required: ['path', 'revision'], additionalProperties: false, description: 'Needs jobId. What the question is about: a file in the job and the revision of it, for example drafts/D1/storyboard.md at revision 3. Leave it out for a question that is not about one file, such as a brand-wide one.' },
    inChat: { type: 'boolean', description: 'True for a confirmation the person must give in the chat: shown with no buttons. Defaults to false.' },
    blocking: { type: 'boolean', description: 'Needs jobId. True when the answer can change the stage or the ideas that come next (a fact the ideas rest on, such as real screens or an invented example, which helpers to show, whether a promise is real). The ideas are not written, and no Creative Director, Scriptwriter or Copywriter is started, until every blocking question on the job is answered; nothing carries on with an option by itself. Leave it out for a question that only matters for the script or the pictures: hold those until the idea is picked. Defaults to false.' },
  }, ['text'], (args, { workspace }) => {
    const root = local(workspace);
    const question = askQuestion({ root, brand: args.brand, jobId: args.jobId, text: args.text, options: args.options, allowText: args.allowText, inChat: args.inChat, wantsUpload: args.wantsUpload, takes: args.takes, stills: args.stills, blocking: args.blocking, about: args.about });
    return { questionId: question.questionId, documents: documentsFor(root, question) };
  }),
  tool('pipeline_board_answer', `Record the answer the person gave in chat to a question posted with pipeline_board_ask, so the board stops asking it. Pass choice when they picked one of its options, text for anything else they said (at most ${ANSWER_TEXT_LIMIT} characters). The first answer wins, on the board or in chat. A question already answered is not changed: it returns the saved answer with alreadyAnswered true and a message such as "Answered on the board at 3:42 pm", never an error. Act on the saved answer and tell the person that line in one short sentence. Returns the question and documents, the board documents to write.`, {
    questionId,
    choice: { ...string, description: 'One of the question\'s options, word for word.' },
    text: { ...string, maxLength: ANSWER_TEXT_LIMIT, description: 'What the person said, in their words.' },
  }, ['questionId'], (args, { workspace }) => {
    const root = local(workspace);
    const { alreadyAnswered, message, ...question } = answerQuestion({ root, questionId: args.questionId, choice: args.choice, text: args.text, via: 'chat' });
    return { question, ...(alreadyAnswered ? { alreadyAnswered: true, message } : {}), documents: documentsFor(root, question) };
  }),
  tool('pipeline_board_questions', 'List the questions posted to the board, newest first, with their status (open, answered or withdrawn), answer, and whether it came from the board or the chat. Filter by jobId or status.', {
    jobId: { ...string, description: 'Only this job\'s questions.' },
    status: { type: 'string', enum: [...QUESTION_STATUSES] },
  }, [], (args, { workspace }) => ({ questions: listQuestions({ root: local(workspace), jobId: args.jobId || null, status: args.status || null }) })),
  tool('pipeline_board_withdraw', 'Take a question off the board when it is no longer needed. An answered question keeps its answer. Returns the question and documents, the board documents to write.', {
    questionId,
  }, ['questionId'], (args, { workspace }) => {
    const root = local(workspace);
    const question = withdrawQuestion({ root, questionId: args.questionId });
    return { question, documents: documentsFor(root, question) };
  }),
];
