/**
 * Methodology loader: method_get and method_ref_get.
 *
 * Methodology skills live in skills/<name>/ with `user-invocable: false` and
 * `metadata.kind: methodology`. The primary way an agent loads one is the Skill tool,
 * which a real session proved works from a plugin subagent (docs/ARCHITECTURE.md,
 * "Methodology skills"). These two tools are the tested fallback for a runtime where
 * the Skill tool is missing: they return the same text from disk, read only, confined
 * to the skill's own folder.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineTool } from '../mcp/registry.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import { isInside } from '../lib/paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the plugin's skills live. */
export const SKILLS_DIR = join(HERE, '..', '..', 'skills');

/** Reference files an agent may read. Anything else in a skill folder is not served. */
const REFERENCE_EXTENSIONS = /\.(md|txt|json|ya?ml)$/i;

/** A methodology file is prose, so anything this large is a mistake, not a method. */
const MAX_BYTES = 512 * 1024;

/**
 * Split a SKILL.md into its frontmatter block and its body.
 * @param {string} text
 * @returns {{frontmatter: string, body: string}}
 */
export function splitFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { frontmatter: '', body: normalized };
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: '', body: normalized };
  const afterFence = normalized.indexOf('\n', end + 4);
  return {
    frontmatter: normalized.slice(4, end),
    body: afterFence < 0 ? '' : normalized.slice(afterFence + 1),
  };
}

/**
 * Read the few frontmatter facts the loader needs. Descriptions may be folded over
 * several indented lines, so continuation lines are joined back on.
 * @param {string} frontmatter
 * @returns {{name: string|null, description: string, methodology: boolean, userInvocable: boolean}}
 */
export function readFrontmatter(frontmatter) {
  const lines = frontmatter.split('\n');
  const top = (key) => lines.findIndex((line) => line.startsWith(`${key}:`));

  const nameLine = lines[top('name')] ?? '';
  const name = nameLine.slice('name:'.length).trim() || null;

  let description = '';
  const descriptionIndex = top('description');
  if (descriptionIndex >= 0) {
    const inline = lines[descriptionIndex].slice('description:'.length).trim();
    const parts = /^[>|][-+]?$/.test(inline) ? [] : [inline];
    for (let index = descriptionIndex + 1; index < lines.length && /^\s+\S/.test(lines[index]); index += 1) {
      parts.push(lines[index].trim());
    }
    description = parts.join(' ').trim();
  }

  const invocableLine = lines[top('user-invocable')] ?? '';
  const userInvocable = invocableLine.slice('user-invocable:'.length).trim() !== 'false';

  let methodology = false;
  const metadataIndex = top('metadata');
  if (metadataIndex >= 0) {
    for (let index = metadataIndex + 1; index < lines.length && /^\s+/.test(lines[index]); index += 1) {
      if (/^\s+kind:\s*methodology\s*$/.test(lines[index])) methodology = true;
    }
  }

  return { name, description, methodology, userInvocable };
}

/**
 * Every file in a skill folder an agent may read, relative, with forward slashes.
 * @param {string} skillDir
 * @returns {string[]}
 */
function listReferences(skillDir) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && REFERENCE_EXTENSIONS.test(entry.name) && entry.name !== 'SKILL.md') {
        files.push(relative(skillDir, absolute).split(sep).join('/'));
      }
    }
  };
  walk(skillDir);
  return files.sort();
}

/**
 * Find a methodology skill by name, or explain why not.
 * @param {string} skillsDir
 * @param {string} rawName `hook-analysis` or `social-campaign:hook-analysis`.
 * @returns {{name: string, dir: string, description: string, body: string}}
 */
function findMethod(skillsDir, rawName) {
  const name = String(rawName ?? '')
    .trim()
    .replace(/^social-campaign:/, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new InvalidInputError('A method name is lower case words joined by dashes, like "hook-analysis".');
  }
  const dir = join(skillsDir, name);
  let text;
  try {
    text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  } catch {
    throw new InvalidInputError(`There is no method called "${name}".`, {
      details: { available: listMethods(skillsDir).map((method) => method.name) },
    });
  }
  const { frontmatter, body } = splitFrontmatter(text);
  const facts = readFrontmatter(frontmatter);
  if (!facts.methodology) {
    throw new InvalidInputError(`"${name}" is a workflow, not a method, so it is not served here.`, {
      details: { available: listMethods(skillsDir).map((method) => method.name) },
    });
  }
  return { name, dir, description: facts.description, body };
}

/**
 * Every methodology skill, by name and description.
 * @param {string} [skillsDir]
 * @returns {Array<{name: string, description: string}>}
 */
export function listMethods(skillsDir = SKILLS_DIR) {
  /** @type {Array<{name: string, description: string}>} */
  const methods = [];
  let entries = [];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return methods;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const { frontmatter } = splitFrontmatter(readFileSync(join(skillsDir, entry.name, 'SKILL.md'), 'utf8'));
      const facts = readFrontmatter(frontmatter);
      if (facts.methodology) methods.push({ name: entry.name, description: facts.description });
    } catch {
      // a folder without a SKILL.md is not a method
    }
  }
  return methods.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The text of one methodology skill plus the reference files beside it.
 * @param {string} name
 * @param {string} [skillsDir]
 * @returns {{name: string, skill: string, description: string, content: string, base_dir: string, references: string[]}}
 */
export function getMethod(name, skillsDir = SKILLS_DIR) {
  const method = findMethod(skillsDir, name);
  return {
    name: method.name,
    skill: `social-campaign:${method.name}`,
    description: method.description,
    content: method.body,
    base_dir: resolve(method.dir),
    references: listReferences(method.dir),
  };
}

/**
 * One reference file from inside a methodology skill's folder.
 * @param {string} name
 * @param {string} file relative path as listed by getMethod.
 * @param {string} [skillsDir]
 * @returns {{name: string, file: string, content: string}}
 */
export function getMethodReference(name, file, skillsDir = SKILLS_DIR) {
  const method = findMethod(skillsDir, name);
  const wanted = String(file ?? '').trim().replace(/\\/g, '/');
  const absolute = resolve(method.dir, wanted);
  if (!wanted || !isInside(method.dir, absolute) || absolute === resolve(method.dir)) {
    throw new InvalidInputError('That file is not part of this method.');
  }
  if (!listReferences(method.dir).includes(wanted)) {
    throw new InvalidInputError(`"${wanted}" is not one of this method's reference files.`, {
      details: { references: listReferences(method.dir) },
    });
  }
  if (statSync(absolute).size > MAX_BYTES) {
    throw new InvalidInputError(`"${wanted}" is too large to be a reference file.`);
  }
  return { name: method.name, file: wanted, content: readFileSync(absolute, 'utf8') };
}

/** @type {import('../mcp/registry.mjs').ToolDefinition[]} */
export const methodTools = [
  defineTool({
    name: 'method_get',
    description:
      'Read one Social Campaign methodology (for example "hook-analysis") when the Skill tool is not available. ' +
      'Returns the method text and the names of its reference files. With no name, lists every method.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The method name, like "hook-analysis". Leave empty to list methods.' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      if (args.name === undefined || String(args.name).trim() === '') return { methods: listMethods() };
      return getMethod(String(args.name));
    },
  }),
  defineTool({
    name: 'method_ref_get',
    description:
      'Read one reference file that belongs to a Social Campaign methodology, using a file name that method_get listed.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The method name, like "hook-analysis".' },
        file: { type: 'string', description: 'A reference file name exactly as method_get listed it.' },
      },
      required: ['name', 'file'],
      additionalProperties: false,
    },
    handler: (args) => getMethodReference(String(args.name), String(args.file)),
  }),
];
