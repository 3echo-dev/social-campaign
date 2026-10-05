'use strict';
// The pipeline catalogue: what each kind of job is, who works on it, what it asks for, where
// it stops for the person and what it costs, in words a business owner reads.
//
// Almost everything is derived, so the catalogue cannot drift from what the plugin does:
//   inputs.required   kinds.json (requiredFields, requiredSources, brandRequired, productPhoto)
//   stages, journey   the workflow table rows and lib-stages.walkedStages
//   gates             workflows.json gates with short labels (GATE_LABELS); price and sample are added
//                     when a row uses a skill that costs credits
//   agents            the Agent column plus the kinds.json owner, with agents.json model
//   cost.credits      a row that uses a skill with cost "credits", with its condition in words
//   posts             a `publish` gate
// The rest is authored once in registry/pipelines.json, keyed by kind: name, purpose, examples,
// notFor, optional inputs, outputs words, cost words and the starter group. Anything that does
// not line up throws a CatalogueDriftError that names what to fix.
//
// The MCP tool adds the posting routes later, from publish-preflight.mjs; they are not here.
const fs = require('fs');
const path = require('path');
const kinds = require('./lib-kinds.js');
const states = require('./lib-states.js');
const stagesLib = require('./lib-stages.js');
const { parseStageTable } = require('./lib-workflow-table.js');

const ROOT = path.join(__dirname, '..');
const CONNECTORS = Object.freeze({ studio: '3echo', publishing: 'metricool' });
const FORMS = Object.freeze(['post', 'report', 'publish']);
const NOT_AGENTS = Object.freeze(['scripts', 'human']);

// What a condition tag means to a person, for the `if:` and the `unless:` spelling. Every tag
// a workflow table or workflows.json uses needs an entry; a missing one throws.
const TAG_WORDS = Object.freeze({
  research: { if: 'when the brief needs research', unless: 'when no research is needed' },
  research_lite: { if: 'when a light research pass is enough', unless: 'when a full research pass is needed' },
  strategy: { if: 'when a full strategy is needed', unless: 'when a simple brief is enough' },
  ugc: { if: 'when it is a creator-style video', unless: 'when it is not a creator-style video' },
  media: { if: 'when pictures or video are made', unless: 'when no pictures or video are made' },
  video_qa: { if: 'when a video is made', unless: 'when no video is made' },
  merged_publish: { if: 'when posting is approved together with the final post', unless: 'when posting has its own approval' },
  sources: { if: 'when you give links or files', unless: 'when you give no links or files' },
  reference_video: { if: 'when you give a reference video', unless: 'when you give no reference video' },
  social_post: { if: 'when Claude writes the caption', unless: 'when you give the caption' },
  carousel: { if: 'when the post is a carousel', unless: 'when the post is not a carousel' },
});

// What each field a kind requires means to a person.
const INPUT_WORDS = Object.freeze({
  brand: 'The brand it is for',
  objective: 'What it is meant to achieve',
  distribution: 'Whether it runs as organic posts, paid ads or both',
  platforms: 'Which platforms it is for',
  deliverables: 'Which posts you need: the platform, the post type and how many',
});
const SOURCE_WORDS = Object.freeze({
  link_or_file: 'At least one link or file to look at',
  video: 'A video to break down, as a link or a file',
  supplied_media: 'The pictures or video to post (one video, or up to 35 pictures), given to Claude in chat',
});
const PHOTO_WORDS = 'A photo of the product, when pictures or video are made';
const BRAND_OPTIONAL_WORDS = 'A brand, if one applies';

// The gates a credits skill adds, which workflows.json does not list because they belong to
// the media step rather than to a workflow stage.
const CREDIT_GATES = Object.freeze([{ id: 'price' }, { id: 'sample' }]);

// The short approval-style name of every gate, as the board asks it. Every gate id a workflow
// lists, and price and sample, needs one; a missing label throws.
const GATE_LABELS = Object.freeze({
  concept: 'Pick a concept',
  storyboard: 'Approve the storyboard',
  price: 'Approve the price',
  sample: 'Check the sample',
  content: 'Approve the final post',
  publish: 'Confirm where and when to post',
  campaign_proposal: 'Approve the campaign plan',
  campaign_activation: 'Approve going live',
  findings: 'Review the report',
});

const ENTRY_FIELDS = Object.freeze(['name', 'purpose', 'examples', 'notFor', 'inputs', 'outputs', 'cost', 'starter']);
const INPUT_KEYS = Object.freeze(['field', 'words']);
const GROUP_FIELDS = Object.freeze(['value', 'label', 'order', 'form', 'links', 'placeholders', 'filesHint', 'kindLabel', 'jobWord']);

// Artifacts a person is given, as opposed to the working files behind them.
const WORKING_ARTIFACT = /^(job\.json|route\.json|plan\.md|status\.md|brief\.md|concepts\.md)$|^(validation|research|revisions|approvals|brand)\/|^drafts\/D\*\/(script\.md|storyboard\.md|generation-manifest\.json)$|^campaign\/requirements\.md$/;

class CatalogueDriftError extends Error {
  constructor(message) {
    super('pipeline catalogue: ' + message);
    this.name = 'CatalogueDriftError';
  }
}

const drift = message => { throw new CatalogueDriftError(message); };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isTextList = value => Array.isArray(value) && value.length > 0 && value.every(isText);
const unique = list => [...new Set(list)];

/** The files the catalogue is built from, loaded fresh so a test can change a copy. */
function loadSources() {
  const registry = path.join(ROOT, 'registry');
  const workflows = readJson(path.join(registry, 'workflows.json')).workflows;
  const tables = {};
  for (const workflow of workflows) {
    if (workflow.file) tables[workflow.file] = fs.readFileSync(path.join(ROOT, workflow.file), 'utf8');
  }
  return {
    authored: readJson(path.join(registry, 'pipelines.json')),
    kinds: readJson(path.join(registry, 'kinds.json')).kinds,
    workflows,
    agents: readJson(path.join(registry, 'agents.json')).agents,
    skills: readJson(path.join(registry, 'skills.json')).skills,
    schemaFields: Object.keys(readJson(path.join(ROOT, 'schemas', 'job.schema.json')).properties),
    tables,
  };
}

/** One condition ("always", "if:tag", "unless:tag", several joined by spaces) in words. */
function conditionWords(condition) {
  const parts = String(condition || 'always').trim().split(/\s+/).filter(Boolean);
  const words = [];
  for (const part of parts) {
    if (part === 'always') continue;
    const match = /^(if|unless):(.+)$/.exec(part);
    if (!match) drift(`condition "${part}" is not always, if:tag or unless:tag`);
    const entry = Object.prototype.hasOwnProperty.call(TAG_WORDS, match[2]) ? TAG_WORDS[match[2]] : null;
    if (!entry || !isText(entry[match[1]])) {
      drift(`condition tag "${part}" has no words; add it to TAG_WORDS in lib-catalogue.js`);
    }
    words.push(entry[match[1]]);
  }
  if (!words.length) return 'always';
  return 'when ' + words.map(w => w.replace(/^when /, '')).join(' and ');
}

/** Several conditions, any of which may apply, in words. "always" wins. */
function anyConditionWords(conditions) {
  const words = unique(conditions.map(conditionWords));
  if (!words.length) return 'always';
  if (words.includes('always')) return 'always';
  return words.join(', or ');
}

function checkKeys(object, allowed, where) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) drift(`${where} has an unknown field "${key}"`);
  }
}

function checkGroup(id, group) {
  const where = `starter group "${id}"`;
  if (!group || typeof group !== 'object' || Array.isArray(group)) drift(`${where} is not an object`);
  checkKeys(group, GROUP_FIELDS, where);
  if (!isText(group.value)) drift(`${where} needs a value`);
  if (!isText(group.label)) drift(`${where} needs a label`);
  if (!Number.isFinite(group.order)) drift(`${where} needs a number order`);
  if (!FORMS.includes(group.form)) drift(`${where} form must be one of ${FORMS.join(', ')}`);
  if (group.links !== null && !isText(group.links)) drift(`${where} links must be text or null`);
  if (group.filesHint !== null && !isText(group.filesHint)) drift(`${where} filesHint must be text or null`);
  if (group.kindLabel !== undefined && !isText(group.kindLabel)) drift(`${where} kindLabel must be text`);
  if (group.jobWord !== undefined && group.jobWord !== null && !isText(group.jobWord)) drift(`${where} jobWord must be text or null`);
  if (!Array.isArray(group.placeholders) || group.placeholders.length !== 2 || !group.placeholders.every(isText)) {
    drift(`${where} placeholders must be two texts: the title and the brief`);
  }
}

function checkAuthored(kind, authored, source) {
  const where = `the entry for "${kind}"`;
  if (!authored || typeof authored !== 'object' || Array.isArray(authored)) drift(`${where} is not an object`);
  checkKeys(authored, ENTRY_FIELDS, where);
  for (const field of ['name', 'purpose', 'outputs', 'cost']) {
    if (!isText(authored[field])) drift(`${where} needs ${field} in words`);
  }
  for (const field of ['examples', 'notFor']) {
    if (!isTextList(authored[field])) drift(`${where} needs at least one line in ${field}`);
  }
  if (!authored.starter || !isText(authored.starter.group)) drift(`${where} needs a starter group`);
  checkKeys(authored.starter, ['group'], `${where} starter`);
  if (authored.inputs !== undefined && !Array.isArray(authored.inputs)) drift(`${where} inputs must be a list`);
  for (const input of authored.inputs || []) {
    if (!input || typeof input !== 'object') drift(`${where} has an input that is not an object`);
    checkKeys(input, INPUT_KEYS, `${where} input`);
    if (!source.schemaFields.includes(input.field)) {
      drift(`${where} has an unknown field "${input.field}": it is not a job.schema.json property`);
    }
    if (!isText(input.words)) drift(`${where} input "${input.field}" needs words`);
  }
}

function requiredInputs(record) {
  const out = [];
  if (record.brandRequired !== false) out.push({ field: 'brand', words: INPUT_WORDS.brand });
  for (const field of record.requiredFields || []) {
    if (!isText(INPUT_WORDS[field])) drift(`required field "${field}" has no words; add it to INPUT_WORDS in lib-catalogue.js`);
    out.push({ field, words: INPUT_WORDS[field] });
  }
  const need = record.requiredSources;
  if (need && need !== 'none') {
    if (!isText(SOURCE_WORDS[need])) drift(`required sources "${need}" have no words; add them to SOURCE_WORDS in lib-catalogue.js`);
    out.push({ field: need === 'supplied_media' ? 'suppliedMedia' : 'sourceRefs', words: SOURCE_WORDS[need] });
  }
  if (record.productPhoto === 'when_media') out.push({ field: 'productPhoto', words: PHOTO_WORDS });
  return out;
}

function publicArtifacts(rows) {
  const out = [];
  for (const row of rows) {
    for (const raw of String(row.Artifact || '').split(',')) {
      const item = raw.trim();
      if (!item || item === '-' || WORKING_ARTIFACT.test(item)) continue;
      out.push(item.startsWith('handoff/') ? 'handoff/' : item);
    }
  }
  return unique(out);
}

function agentsOf(kind, record, rows, source) {
  const byId = Object.fromEntries(source.agents.map(a => [a.agentId, a]));
  const whenByAgent = new Map();
  for (const row of rows) {
    const id = row.Agent;
    if (!id || NOT_AGENTS.includes(id)) continue;
    if (!whenByAgent.has(id)) whenByAgent.set(id, []);
    whenByAgent.get(id).push(row.Condition);
  }
  const ids = unique([record.owner, ...whenByAgent.keys()].filter(Boolean));
  if (!record.owner) drift(`kind "${kind}" has no owner agent`);
  ids.sort((a, b) => (b === record.owner) - (a === record.owner));
  return ids.map(id => {
    const agent = byId[id];
    if (!agent) drift(`kind "${kind}" uses an agent "${id}" that is not in agents.json`);
    if (agent.status !== 'active') drift(`kind "${kind}" uses the inactive agent "${id}" (${agent.status})`);
    const conditions = whenByAgent.get(id);
    return {
      id,
      model: agent.model,
      description: agent.description,
      owner: id === record.owner,
      when: conditions ? anyConditionWords(conditions) : 'always',
    };
  });
}

function gatesOf(kind, workflow, rows, creditRows) {
  const label = id => {
    if (!states.AWAITING_STATE[id] && !CREDIT_GATES.some(g => g.id === id)) {
      drift(`workflow "${workflow.workflowId}" lists the gate "${id}", which lib-states.js does not know`);
    }
    if (!isText(GATE_LABELS[id])) drift(`gate "${id}" has no label; add it to GATE_LABELS in lib-catalogue.js`);
    return GATE_LABELS[id];
  };
  const listed = workflow.gates || [];
  const order = [];
  const conditions = new Map();
  const note = (id, condition) => {
    if (!conditions.has(id)) { conditions.set(id, []); order.push(id); }
    conditions.get(id).push(condition);
  };
  let creditsDone = false;
  for (const row of rows) {
    if (row.Gate) {
      if (!listed.includes(row.Gate)) {
        drift(`workflow "${workflow.workflowId}" has a stage with the gate "${row.Gate}" that workflows.json does not list`);
      }
      note(row.Gate, row.Condition);
    }
    if (!creditsDone && creditRows.includes(row)) {
      creditsDone = true;
      for (const gate of CREDIT_GATES) for (const credit of creditRows) note(gate.id, credit.Condition);
    }
  }
  for (const id of listed) {
    if (!conditions.has(id)) drift(`workflows.json lists the gate "${id}" for "${workflow.workflowId}" but no stage has it`);
  }
  return order.map(id => {
    return { id, label: label(id), when: anyConditionWords(conditions.get(id)) };
  });
}

function entryFor(kind, source, authoredGroups) {
  const record = source.kinds[kind];
  const authored = source.authored.pipelines[kind];
  checkAuthored(kind, authored, source);
  if (!authoredGroups[authored.starter.group]) {
    drift(`the entry for "${kind}" names the starter group "${authored.starter.group}", which is not defined`);
  }

  const workflow = source.workflows.find(w => w.workflowId === record.workflowId);
  if (!workflow || !workflow.file) drift(`kind "${kind}" names the workflow "${record.workflowId}", which workflows.json does not list`);
  if (workflow.status !== 'active') drift(`kind "${kind}" uses the workflow "${workflow.workflowId}", which is ${workflow.status}`);
  if (!(workflow.kinds || []).includes(kind)) drift(`workflow "${workflow.workflowId}" does not list the kind "${kind}"`);
  const table = parseStageTable(source.tables[workflow.file]);
  if (!table.header) drift(`workflow "${workflow.workflowId}" has no stage table with a Condition column`);
  const rows = table.rows;

  const creditSkills = new Set(source.skills.filter(s => s.cost === 'credits').map(s => s.skillId));
  const usesCredits = row => String(row.Skills || '').split(',').some(s => creditSkills.has(s.trim()));
  const creditRows = rows.filter(usesCredits);
  const credits = creditRows.length > 0;
  if (credits && /^no credits/i.test(authored.cost)) drift(`the cost words for "${kind}" say no credits, but a stage uses a skill that costs credits`);
  if (!credits && !/^no credits/i.test(authored.cost)) drift(`the cost words for "${kind}" must start with "No credits": no stage uses a skill that costs credits`);

  const required = requiredInputs(record);
  const optional = [];
  if (record.brandRequired === false) optional.push({ field: 'brand', words: BRAND_OPTIONAL_WORDS });
  for (const input of authored.inputs || []) {
    if (required.some(r => r.field === input.field) || optional.some(o => o.field === input.field)) {
      drift(`the entry for "${kind}" lists the input "${input.field}" twice`);
    }
    optional.push({ field: input.field, words: input.words });
  }

  const gates = gatesOf(kind, workflow, rows, creditRows);
  const posts = gates.some(g => g.id === 'publish');
  const group = authoredGroups[authored.starter.group];

  return {
    id: 'social.' + kind,
    kind,
    workflow: { id: workflow.workflowId, version: workflow.version },
    name: authored.name,
    purpose: authored.purpose,
    examples: authored.examples.slice(),
    notFor: authored.notFor.slice(),
    start: { skill: 'social-campaign', kind },
    inputs: { required, optional },
    journey: stagesLib.walkedStages(rows.map(r => r['State after']), workflow.workflowId) || [],
    stages: rows.map(r => ({
      n: r['#'],
      name: r.Stage,
      agent: r.Agent,
      when: conditionWords(r.Condition),
      gate: r.Gate || null,
    })),
    gates,
    agents: agentsOf(kind, record, rows, source),
    outputs: { words: authored.outputs, artifacts: publicArtifacts(rows) },
    cost: credits
      ? { credits, words: authored.cost, when: anyConditionWords(creditRows.map(r => r.Condition)) }
      : { credits, words: authored.cost },
    connectors: {
      required: [],
      optional: [credits ? CONNECTORS.studio : null, posts ? CONNECTORS.publishing : null].filter(Boolean),
    },
    posts: { posts },
    starter: { group: authored.starter.group, label: group.label, order: group.order, form: group.form },
  };
}

function checkedGroups(source) {
  const groups = source.authored.groups;
  if (!groups || typeof groups !== 'object') drift('pipelines.json has no starter groups');
  const values = new Set();
  for (const [id, group] of Object.entries(groups)) {
    checkGroup(id, group);
    if (values.has(group.value)) drift(`starter group "${id}" repeats the value "${group.value}"`);
    values.add(group.value);
  }
  return groups;
}

function activeIds(source) {
  return Object.keys(source.kinds).filter(id => source.kinds[id].status === 'active');
}

function checkCoverage(source) {
  const active = activeIds(source);
  const entries = source.authored.pipelines;
  if (!entries || typeof entries !== 'object') drift('pipelines.json has no pipelines');
  for (const kind of active) {
    if (!entries[kind]) drift(`the active kind "${kind}" has no entry in pipelines.json`);
  }
  for (const kind of Object.keys(entries)) {
    if (!active.includes(kind)) drift(`pipelines.json has an entry for "${kind}", which is not an active kind`);
  }
  return active;
}

/** The catalogue from a set of sources. Tests pass an edited copy of loadSources(). */
function buildCatalogue(source) {
  const active = checkCoverage(source);
  const groups = checkedGroups(source);
  const entries = active.map(kind => entryFor(kind, source, groups));
  for (const id of Object.keys(groups)) {
    if (!entries.some(entry => entry.starter.group === id)) drift(`starter group "${id}" has no pipeline`);
  }
  return entries;
}

/** The starter choices for the board, one per group, in order. */
function buildStarterGroups(source) {
  const active = checkCoverage(source);
  const groups = checkedGroups(source);
  const out = Object.entries(groups).map(([id, group]) => {
    const members = active.filter(kind => source.authored.pipelines[kind].starter.group === id);
    if (!members.length) drift(`starter group "${id}" has no pipeline`);
    return {
      order: group.order,
      choice: {
        value: group.value,
        label: group.label,
        kind: members.length === 1 ? members[0] : null,
        kinds: members,
        form: group.form,
        brandRequired: members.every(kind => source.kinds[kind].brandRequired !== false),
        links: group.links,
        placeholders: group.placeholders.slice(),
        filesHint: group.filesHint,
        kindLabel: group.kindLabel || group.label,
        jobWord: group.jobWord || null,
      },
    };
  });
  for (const kind of active) {
    if (!groups[source.authored.pipelines[kind].starter.group]) {
      drift(`the entry for "${kind}" names the starter group "${source.authored.pipelines[kind].starter.group}", which is not defined`);
    }
  }
  return out.sort((a, b) => a.order - b.order).map(item => item.choice);
}

/**
 * The words the board shows for each active kind, from the same files: the pipeline's own name
 * (name), the short word on a job card (label), the word in a "new job" line (jobWord, null for a
 * plain job) and whether the job is a report (report: the kind makes no content). A kind with no
 * entry, or an entry in no group, throws like the catalogue does.
 */
function buildKindIndex(source) {
  const active = checkCoverage(source);
  const groups = checkedGroups(source);
  const out = {};
  for (const kind of active) {
    const authored = source.authored.pipelines[kind];
    checkAuthored(kind, authored, source);
    const group = groups[authored.starter.group];
    if (!group) drift(`the entry for "${kind}" names the starter group "${authored.starter.group}", which is not defined`);
    out[kind] = {
      name: authored.name,
      label: group.kindLabel || group.label,
      jobWord: group.jobWord || null,
      group: group.value,
      report: source.kinds[kind].makesContent === false,
    };
  }
  return out;
}

/** What the board page is built with: the per-kind words. The starter groups are checked for drift here but are not sent, since the board reads only the kinds. */
function buildBoardConfig(source) {
  buildStarterGroups(source);
  return { kinds: buildKindIndex(source) };
}

const catalogue = () => buildCatalogue(loadSources());
const starterGroups = () => buildStarterGroups(loadSources());
const kindIndex = () => buildKindIndex(loadSources());
const boardConfig = () => buildBoardConfig(loadSources());

module.exports = {
  catalogue,
  starterGroups,
  kindIndex,
  boardConfig,
  buildCatalogue,
  buildStarterGroups,
  buildKindIndex,
  buildBoardConfig,
  loadSources,
  conditionWords,
  CatalogueDriftError,
  TAG_WORDS,
  INPUT_WORDS,
  CREDIT_GATES,
  GATE_LABELS,
  activeKindIds: kinds.activeKindIds,
};
