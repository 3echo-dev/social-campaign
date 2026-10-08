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
  tool('pipeline_board_ask', `Post a question to the board's Needs you list, with up to ${QUESTION_OPTION_LIMIT} option buttons and, unless allowText is false, a typed answer. Ask the same question in chat too: whichever answer comes first counts, and the other place stops asking. Write the question and options in plain words a client understands, with no ids, file names, state names or code; those are refused with the reason. Pass inChat true when you are asking the person in the chat to confirm something public or costly (posting, sending, spending): the board shows the same question with no buttons and tells the person to answer in the chat, because only a chat answer counts. Record that answer with pipeline_board_answer, which clears the notice, and it also clears itself when the send happens. Pass jobId for a question about one job, brand for a brand-wide one, or neither for the whole workspace. Returns the questionId and documents: the board documents to write, the same shape as pipeline_status. A board answer arrives as an answer_question board request; a chat answer is recorded with pipeline_board_answer.`, {
    brand: { ...string, description: 'Optional brand slug for a brand-wide question.' },
    jobId: { ...string, description: 'Optional job the question is about.' },
    text: { ...string, maxLength: QUESTION_TEXT_LIMIT, description: `The question in plain words, at most ${QUESTION_TEXT_LIMIT} characters.` },
    options: { type: 'array', maxItems: QUESTION_OPTION_LIMIT, items: { ...string, maxLength: OPTION_TEXT_LIMIT }, description: `Up to ${QUESTION_OPTION_LIMIT} short answer buttons, each at most ${OPTION_TEXT_LIMIT} characters.` },
    allowText: { type: 'boolean', description: 'Whether the board also offers a typed answer. Defaults to true.' },
    wantsUpload: { type: 'object', properties: { type: { type: 'string', enum: ['picture', 'video', 'audio', 'caption', 'addon'], description: 'What to ask for: picture, video, audio, caption (text) or addon (any other file). Defaults to picture.' } }, additionalProperties: false, description: 'Pass this when the question asks the person for a photo, clip, audio or other file (needs jobId): the card then shows an upload control, the file is saved as a reference on the job, and the question is answered. Keep any options you also give, such as reusing an earlier file.' },
    inChat: { type: 'boolean', description: 'True for a confirmation the person must give in the chat: shown with no buttons. Defaults to false.' },
  }, ['text'], (args, { workspace }) => {
    const root = local(workspace);
    const question = askQuestion({ root, brand: args.brand, jobId: args.jobId, text: args.text, options: args.options, allowText: args.allowText, inChat: args.inChat, wantsUpload: args.wantsUpload });
    return { questionId: question.questionId, documents: documentsFor(root, question) };
  }),
  tool('pipeline_board_answer', `Record the answer the person gave in chat to a question posted with pipeline_board_ask, so the board stops asking it. Pass choice when they picked one of its options, text for anything else they said (at most ${ANSWER_TEXT_LIMIT} characters). A question already answered on the board returns that saved answer instead, never an error: act on the saved answer. Returns the question and documents, the board documents to write.`, {
    questionId,
    choice: { ...string, description: 'One of the question\'s options, word for word.' },
    text: { ...string, maxLength: ANSWER_TEXT_LIMIT, description: 'What the person said, in their words.' },
  }, ['questionId'], (args, { workspace }) => {
    const root = local(workspace);
    const question = answerQuestion({ root, questionId: args.questionId, choice: args.choice, text: args.text, via: 'chat' });
    return { question, documents: documentsFor(root, question) };
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
