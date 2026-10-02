/**
 * The pipeline catalogue as a tool: pipelines_list.
 *
 * Claude reads a person's own words against this list to decide which pipeline fits, so the
 * answer is built from the registries and one authored file (pipeline/registry/pipelines.json)
 * by pipeline/scripts/lib-catalogue.js, never typed out here. It is read only and needs no
 * workspace: it works before setup, and it never touches a job.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { PUBLISH_ROUTES, ROUTE_LABELS } from '../pipeline/publish-preflight.mjs';
import { PLUGIN_VERSION } from '../workspace/version.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const catalogueLib = require(join(HERE, '..', '..', 'pipeline', 'scripts', 'lib-catalogue.js'));

export const CATALOGUE_FORMATS = Object.freeze(['json', 'markdown']);

const list = items => (items.length ? items.map(item => `- ${item}`).join('\n') : '- None');

/** One pipeline as a short Markdown section, in the words a person reads. */
function sectionOf(entry) {
  const lines = [
    `## ${entry.name} (${entry.kind})`,
    '',
    entry.purpose,
    '',
    'Examples:',
    list(entry.examples),
    '',
    'Not for:',
    list(entry.notFor),
    '',
    'Needs:',
    list(entry.inputs.required.map(input => input.words)),
    '',
    `Needs a brand: ${entry.inputs.required.some(input => input.field === 'brand') ? 'yes' : 'no'}`,
  ];
  if (entry.inputs.optional.length) lines.push('', 'Helps if you give:', list(entry.inputs.optional.map(input => input.words)));
  lines.push(
    '',
    `Where it stops for you: ${entry.gates.map(gate => gate.label).join(', ') || 'nowhere'}`,
    `You get: ${entry.outputs.words}`,
    `Cost: ${entry.cost.words}`,
  );
  if (entry.posts.posts) lines.push(`Posting: ${entry.posts.routes.map(id => ROUTE_LABELS[id]).join('; ')}`);
  return lines.join('\n');
}

/** The catalogue entries with the posting routes added to every pipeline that posts. */
export function pipelinesFor({ id } = {}) {
  const entries = catalogueLib.catalogue().map(entry => (entry.posts.posts ? { ...entry, posts: { ...entry.posts, routes: [...PUBLISH_ROUTES] } } : entry));
  if (id === undefined) return entries;
  const wanted = String(id).trim();
  const found = entries.filter(entry => entry.id === wanted || entry.kind === wanted);
  if (!found.length) {
    throw new InvalidInputError(`There is no pipeline "${wanted}". Ask for the list without an id to see them all.`, {
      fix: `Use one of: ${entries.map(entry => entry.id).join(', ')}.`,
    });
  }
  return found;
}

export function renderPipelinesMarkdown(entries) {
  return ['# Pipelines', '', ...entries.flatMap(entry => [sectionOf(entry), ''])].join('\n').trimEnd() + '\n';
}

export const catalogueTools = [
  defineTool({
    name: 'pipelines_list',
    description:
      'List the pipelines this plugin can run, so a person\'s own words can be matched to the one that fits. Each pipeline has an id (social.<kind>) and its kind, the name, what it is for, examples, what it is not for, what it needs and what helps, the stages in order, the approvals it stops for, who works on it, what the person gets, its cost in words, whether it posts and by which routes, and the connectors it can use. Read the person\'s text against the examples and the "not for" lines, pick one kind, and pass it as job.kind when you create the job. Read only: it needs no workspace and changes nothing. Pass id (an id such as social.research, or the kind) for one pipeline, and format markdown for a short readable version. Also returns pluginVersion.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'One pipeline, by id (social.organic_post) or kind (organic_post). Leave out for all of them.' },
        format: { type: 'string', enum: [...CATALOGUE_FORMATS], description: 'json (the default) or markdown.' },
      },
      additionalProperties: false,
    },
    handler: args => {
      const format = args.format ?? 'json';
      if (!CATALOGUE_FORMATS.includes(format)) throw new InvalidInputError('format must be json or markdown.');
      const pipelines = pipelinesFor({ id: args.id });
      return format === 'markdown'
        ? { pluginVersion: PLUGIN_VERSION, format, markdown: renderPipelinesMarkdown(pipelines) }
        : { pluginVersion: PLUGIN_VERSION, format, count: pipelines.length, pipelines };
    },
  }),
];
