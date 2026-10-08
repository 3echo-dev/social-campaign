import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as runtime from './runtime.mjs';
import { REFERENCE_TYPES } from './references.mjs';

export const QUESTION_ID = /^q-[0-9a-f]{12}$/;
export const QUESTION_TEXT_LIMIT = 300;
export const QUESTION_OPTION_LIMIT = 6;
export const OPTION_TEXT_LIMIT = 80;
export const ANSWER_TEXT_LIMIT = 1000;
export const QUESTION_STATUSES = Object.freeze(['open', 'answered', 'withdrawn']);

const NOT_FOUND = 'This question could not be found.';
const CHAT_ONLY = 'This one is answered in the chat, not on the board.';
const WITHDRAWN = 'This question was taken back, so it no longer needs an answer.';
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;
const FILE_NAME = /(?<![\w@#])[\w-]+\.(?:md|json|jsonl|js|mjs|cjs|ts|html?|css|png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|ogg|csv|txt|pdf|ya?ml|log|zip)\b/i;
const FOLDER_PATH = /[a-z]:\\|\\[\w.-]+\\|(?:^|[\s(])(?:\.{1,2}|~)\/|\b(?:drafts|media|research|pricing|approvals|handoff|validation|report|workspaces|jobs|brand|inputs|pipeline|scripts)\/[\w.-]/i;
const STATE_ID = /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b/;
const ID_LIKE = /\bjob-\d{6,}|\bq-[0-9a-f]{6,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-|(?<![\w#])(?=[a-z]*\d)(?=\d*[a-z])[0-9a-f]{10,}\b|\b(?:D|P|VO)\d{1,3}\b/i;
const CODE_WORD = /(?<![\w#@])[a-z]{2,}[A-Z][A-Za-z0-9]*\b|(?<![\w#@])[a-z0-9]+_[a-z0-9_]+\b|[`{}]|<\/|=>|==|&&|\|\||\b\w+\(\)/;

const PLAIN_REASONS = Object.freeze({
  file: 'Ask in plain words, without file names or folder paths.',
  id: 'Ask in plain words, without ids or codes. Say "the first post" or "panel 3" instead.',
  code: 'Ask in plain words, without code, field names or state names.',
});

export function plainWordsProblem(value) {
  const text = String(value ?? '').replace(URL_PATTERN, ' ');
  if (FILE_NAME.test(text) || FOLDER_PATH.test(text)) return PLAIN_REASONS.file;
  if (STATE_ID.test(text)) return PLAIN_REASONS.code;
  if (ID_LIKE.test(text)) return PLAIN_REASONS.id;
  if (CODE_WORD.test(text)) return PLAIN_REASONS.code;
  return null;
}

function questionsDirectory(root, { create = true } = {}) {
  const dir = join(root, '.social-pipeline', 'board', 'questions');
  if (!create && !existsSync(dir)) return null;
  mkdirSync(dir, { recursive: true });
  const rel = relative(realpathSync(root), realpathSync(dir));
  if (rel.startsWith('..') || /^[a-z]:/i.test(rel)) throw new Error('Question storage is outside the workspace.');
  return dir;
}

function questionFile(root, questionId) {
  if (typeof questionId !== 'string' || !QUESTION_ID.test(questionId)) throw new Error(NOT_FOUND);
  return join(questionsDirectory(root), `${questionId}.json`);
}

function writeAtomic(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2));
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

function newQuestionId(root) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const questionId = `q-${randomBytes(6).toString('hex')}`;
    if (!existsSync(join(questionsDirectory(root), `${questionId}.json`))) return questionId;
  }
  throw new Error('A new question could not be saved. Try again.');
}

export function readQuestion({ root, questionId }) {
  const file = questionFile(root, questionId);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error(NOT_FOUND); }
}

export function listQuestions({ root, jobId = null, status = null, readOnly = false } = {}) {
  if (status !== null && status !== undefined && !QUESTION_STATUSES.includes(status)) throw new Error('Status must be open, answered or withdrawn.');
  const dir = questionsDirectory(root, { create: !readOnly });
  if (!dir) return [];
  const questions = [];
  for (const name of readdirSync(dir)) {
    if (!/^q-[0-9a-f]{12}\.json$/.test(name)) continue;
    let record;
    try { record = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { continue; }
    if (!record || typeof record !== 'object' || !QUESTION_ID.test(record.questionId || '')) continue;
    if (jobId && record.jobId !== jobId) continue;
    if (status && record.status !== status) continue;
    questions.push(record);
  }
  return questions.sort((a, b) => String(b.askedAt || '').localeCompare(String(a.askedAt || '')) || a.questionId.localeCompare(b.questionId));
}

function plainLine(value, { label, limit }) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} cannot be empty.`);
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length > limit) throw new TypeError(`${label} must be at most ${limit} characters.`);
  const problem = plainWordsProblem(text);
  if (problem) throw new TypeError(problem);
  return text;
}

function questionOptions(options) {
  if (options === undefined || options === null) return [];
  if (!Array.isArray(options) || options.length > QUESTION_OPTION_LIMIT) throw new TypeError(`Give at most ${QUESTION_OPTION_LIMIT} options.`);
  const list = options.map(option => plainLine(option, { label: 'Each option', limit: OPTION_TEXT_LIMIT }));
  if (new Set(list.map(option => option.toLowerCase())).size !== list.length) throw new TypeError('Each option must be different.');
  return list;
}

function questionPlace(root, { brand, jobId }) {
  const wantedBrand = typeof brand === 'string' && brand.trim() ? brand.trim() : null;
  if (jobId !== undefined && jobId !== null && jobId !== '') {
    if (typeof jobId !== 'string') throw new TypeError('Name the job by its id.');
    const job = runtime.listJobs({ root }).find(entry => entry.jobId === jobId);
    if (!job) throw new Error('Job not found in this workspace.');
    if (wantedBrand && wantedBrand !== job.brand) throw new Error('That job belongs to another brand.');
    return { jobId: job.jobId, brand: job.brand };
  }
  if (!wantedBrand) return { jobId: null, brand: null };
  if (!runtime.listBrands({ root, includeGeneral: true }).some(entry => entry.slug === wantedBrand)) throw new Error('Brand not found in this workspace.');
  return { jobId: null, brand: wantedBrand };
}

// A question that asks for a file: the board shows the upload control in the card, and the file is saved as a reference of this type.
function uploadWish(wantsUpload, jobId) {
  if (wantsUpload === undefined || wantsUpload === null || wantsUpload === false) return null;
  if (!wantsUpload || typeof wantsUpload !== 'object' || Array.isArray(wantsUpload)) throw new TypeError('wantsUpload must say which kind of file to ask for.');
  const type = wantsUpload.type === undefined ? 'picture' : wantsUpload.type;
  if (typeof type !== 'string' || !Object.hasOwn(REFERENCE_TYPES, type)) throw new TypeError(`wantsUpload.type must be one of: ${Object.keys(REFERENCE_TYPES).join(', ')}.`);
  if (!jobId) throw new TypeError('A question that asks for a file must be about one job (pass jobId).');
  return { type };
}

export function askQuestion({ root, brand = null, jobId = null, text, options, allowText, inChat = false, wantsUpload = null }) {
  const place = questionPlace(root, { brand, jobId });
  const question = plainLine(text, { label: 'The question', limit: QUESTION_TEXT_LIMIT });
  const choices = questionOptions(options);
  if (allowText !== undefined && allowText !== null && typeof allowText !== 'boolean') throw new TypeError('allowText must be true or false.');
  if (inChat !== undefined && inChat !== null && typeof inChat !== 'boolean') throw new TypeError('inChat must be true or false.');
  const wish = inChat ? null : uploadWish(wantsUpload, place.jobId);
  const typed = inChat ? false : typeof allowText === 'boolean' ? allowText : true;
  if (!inChat && !choices.length && !typed) throw new TypeError('Give at least one option, or allow a typed answer.');
  const record = {
    questionId: newQuestionId(root),
    jobId: place.jobId,
    brand: place.brand,
    text: question,
    options: choices,
    allowText: typed,
    ...(inChat ? { inChat: true } : {}),
    ...(wish ? { wantsUpload: wish } : {}),
    askedAt: new Date().toISOString(),
    status: 'open',
    answer: null,
    answeredVia: null,
    answeredAt: null,
    requestId: null,
  };
  writeAtomic(questionFile(root, record.questionId), record);
  return record;
}

function answerFor(question, { choice, text, via }) {
  if (question.inChat && via === 'board') throw new TypeError(CHAT_ONLY);
  const answer = {};
  if (choice !== undefined && choice !== null) {
    if (typeof choice !== 'string' || !question.options.includes(choice)) throw new TypeError('Choose one of the options given.');
    answer.choice = choice;
  }
  if (text !== undefined && text !== null) {
    if (typeof text !== 'string') throw new TypeError('A typed answer must be text.');
    const typed = text.trim();
    if (typed) {
      if (typed.length > ANSWER_TEXT_LIMIT) throw new TypeError(`A typed answer must be at most ${ANSWER_TEXT_LIMIT} characters.`);
      if (via === 'board' && !question.allowText) throw new TypeError('This question takes one of its options, not a typed answer.');
      answer.text = typed;
    }
  }
  if (!Object.keys(answer).length) throw new TypeError(question.options.length ? 'Choose one of the options, or type an answer.' : 'Type an answer.');
  return answer;
}

export function validateAnswer({ root, questionId, choice, text, via = 'board' }) {
  const question = readQuestion({ root, questionId });
  if (question.status === 'answered') return question;
  if (question.status !== 'open') throw new Error(WITHDRAWN);
  answerFor(question, { choice, text, via });
  return question;
}

export function answerQuestion({ root, questionId, choice, text, via, requestId = null }) {
  if (via !== 'board' && via !== 'chat') throw new Error('Say whether this answer came from the board or the chat.');
  const question = readQuestion({ root, questionId });
  if (question.status === 'answered') return question;
  if (question.status !== 'open') throw new Error(WITHDRAWN);
  const answer = answerFor(question, { choice, text, via });
  const next = { ...question, status: 'answered', answer, answeredVia: via, answeredAt: new Date().toISOString(), requestId: typeof requestId === 'string' && requestId ? requestId : null };
  writeAtomic(questionFile(root, questionId), next);
  return next;
}

/** The person sent the file a question asked for: it is answered, with what was added as the answer. */
export function closeUploadQuestion({ root, questionId, jobId, summary }) {
  const question = readQuestion({ root, questionId });
  if (question.status !== 'open' || !question.wantsUpload || question.jobId !== jobId) return question;
  const next = { ...question, status: 'answered', answer: { text: String(summary || 'Added the file.').slice(0, ANSWER_TEXT_LIMIT) }, answeredVia: 'board', answeredAt: new Date().toISOString() };
  writeAtomic(questionFile(root, questionId), next);
  return next;
}

export function withdrawQuestion({ root, questionId }) {
  const question = readQuestion({ root, questionId });
  if (question.status !== 'open') return question;
  const next = { ...question, status: 'withdrawn' };
  writeAtomic(questionFile(root, questionId), next);
  return next;
}

/** Take back the questions Claude put on the board for the chat once the send they were about happens. */
export function clearChatQuestions({ root, jobId }) {
  for (const question of listQuestions({ root, jobId, status: 'open', readOnly: true })) if (question.inChat) withdrawQuestion({ root, questionId: question.questionId });
}
