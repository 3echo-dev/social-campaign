// Cuts board/src/board.js and board/src/board.css into the several files the board is published as.
//
// Why: the host's Artifact tool makes the agent read, in full, every file it publishes that it did not write. One
// 600 KB file costs the whole read again on every release; several stable files of 20 to 50 KB cost only the ones whose
// text changed (pipeline_board_source returns just those, see server/pipeline/artifact.mjs), and each one is small
// enough for a single Read.
//
// How: the author keeps writing one board.js. A line comment `// @module <name>` at column 0, placed before a top-level
// statement, starts a module; the text up to the next marker belongs to it. The last module is `app`, the browser part
// (the `if (typeof document ...)` block): it is the entry point the page loads. No marker changes what the code does,
// and the file still runs as one module in Node for the tests. The same goes for board.css with
// `/* @file <name> */`, whose pieces are linked in order (the cascade keeps its order).
//
// Each module is the minified text of its section plus the import lines it needs and an `export{...}` line for the names
// other modules use. An import line is written for a name only when the module uses a word that another module declares
// at the top level (a word used as a property name after a dot is not counted), so an import list can be longer than
// strictly needed and never shorter. A module's text depends only on its own section, so an edit leaves the other
// modules byte for byte as they were. The page maps `board/<name>` to each file (with a version) in an import map, so a
// module never carries another module's version.
import { createHash } from 'node:crypto';
import { minifyCss, minifyJs } from './minify-board.mjs';

export const ENTRY_MODULE = 'app';
export const LOGO_MODULE = 'logo';
// The most characters of one file a single Read should have to show: well under the Read tool's 25,000 token cap even
// for dense minified code (about 2.5 characters a token), so a Read of a whole file never fails.
export const READ_CHAR_BUDGET = 48000;

const JS_MARKER = /^\/\/ @module ([a-z][a-z0-9]*(?:-[a-z0-9]+)*)[ \t]*$/;
const CSS_MARKER = /^\/\* @file ([a-z][a-z0-9]*(?:-[a-z0-9]+)*) \*\/[ \t]*$/;
const IMPORT_LINE_LIMIT = 1200;

export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
export const scriptPath = name => (name === ENTRY_MODULE ? 'board.js' : `board-${name}.js`);
export const stylePath = (name, index) => (index === 0 ? 'board.css' : `board-${name}.css`);
export const moduleSpecifier = name => `board/${name}`;

export function splitSections(src, marker, label) {
  const sections = [];
  let current = null;
  for (const line of String(src).split(/\r?\n/)) {
    const found = marker.exec(line);
    if (found) {
      if (sections.some(section => section.name === found[1])) throw new Error(`The ${label} "${found[1]}" is marked twice. Each marker starts one section.`);
      current = { name: found[1], lines: [] };
      sections.push(current);
    } else if (current) current.lines.push(line);
    else if (line.trim()) throw new Error(`Text comes before the first ${label} marker: "${line.slice(0, 60)}".`);
  }
  if (!sections.length) throw new Error(`The source has no ${label} marker.`);
  return sections.map(section => ({ name: section.name, text: section.lines.join('\n') }));
}

function chunked(names, build) {
  const lines = [];
  let batch = [];
  let length = 0;
  for (const name of names) {
    if (batch.length && length + name.length + 1 > IMPORT_LINE_LIMIT) { lines.push(build(batch)); batch = []; length = 0; }
    batch.push(name);
    length += name.length + 1;
  }
  if (batch.length) lines.push(build(batch));
  return lines;
}

// The script modules of the board: a list of { name, path, text, imports, declarations, ... } in load order, the entry last.
// `logo` is the page's logo as a data URI; it rides in its own module (set before the entry runs) because it never changes.
export function buildScriptModules(source, logo) {
  const sections = splitSections(source, JS_MARKER, 'module');
  if (sections.at(-1).name !== ENTRY_MODULE) throw new Error(`The last module of board.js must be "${ENTRY_MODULE}", the browser part.`);
  const modules = sections.map(section => {
    const identifiers = new Set();
    const declarations = [];
    const body = minifyJs(section.text, { identifiers, declarations });
    return { name: section.name, body, identifiers, declarations };
  });
  const owner = new Map();
  for (const module of modules) {
    for (const declaration of module.declarations) {
      if (owner.has(declaration.name)) throw new Error(`"${declaration.name}" is declared in both "${owner.get(declaration.name).module}" and "${module.name}".`);
      owner.set(declaration.name, { module: module.name, ...declaration });
    }
  }
  const needed = new Map(modules.map(module => [module.name, new Set()]));
  for (const module of modules) {
    module.imports = new Map();
    for (const word of module.identifiers) {
      const home = owner.get(word);
      if (!home || home.module === module.name) continue;
      if (!module.imports.has(home.module)) module.imports.set(home.module, new Set());
      module.imports.get(home.module).add(word);
      if (!home.exported) needed.get(home.module).add(word);
    }
  }
  for (const module of modules) {
    const lines = [];
    if (module.name === ENTRY_MODULE) lines.push(`import'${moduleSpecifier(LOGO_MODULE)}';`);
    for (const [from, names] of [...module.imports].sort(([a], [b]) => (a < b ? -1 : 1))) {
      lines.push(...chunked([...names].sort(), batch => `import{${batch.join(',')}}from'${moduleSpecifier(from)}';`));
    }
    const exported = [...needed.get(module.name)].sort();
    module.text = lines.map(line => `${line}\n`).join('') + module.body + chunked(exported, batch => `export{${batch.join(',')}};`).map(line => `${line}\n`).join('');
    module.path = scriptPath(module.name);
    module.kind = 'js';
  }
  const logoText = minifyJs(`globalThis.__boardLogo=${JSON.stringify(logo)};\n`);
  return [
    { name: LOGO_MODULE, path: scriptPath(LOGO_MODULE), kind: 'js', text: logoText, imports: new Map(), declarations: [], identifiers: new Set() },
    ...modules,
  ];
}

export function buildStyleFiles(css) {
  return splitSections(css, CSS_MARKER, 'file').map((section, index) => ({ name: section.name, path: stylePath(section.name, index), kind: 'css', text: minifyCss(section.text) }));
}

// Problems the author must fix in board.js, as sentences; empty when the split is sound. The build does not throw on these
// (a page that cannot be built is worse than one that is checked before release): a test runs this over the source.
export function boardModuleProblems(modules) {
  const problems = [];
  const letKinds = new Map();
  for (const module of modules) for (const declaration of module.declarations) if (declaration.kind === 'let' || declaration.kind === 'var') letKinds.set(declaration.name, module.name);
  for (const module of modules) {
    for (const [from, names] of module.imports) {
      for (const name of names) {
        if (letKinds.get(name) !== from) continue;
        const escaped = name.replace(/\$/g, '\\$');
        const assigned = new RegExp(`(?<![\\w$.])${escaped}(?:[-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?![=>])|(?<![\\w$.])${escaped}(?:\\+\\+|--)|(?:\\+\\+|--)${escaped}(?![\\w$])`);
        if (assigned.test(module.body)) problems.push(`"${module.name}" assigns "${name}", which "${from}" declares with let: an imported name cannot be assigned. Keep the assignment in "${from}" or move the declaration.`);
      }
    }
  }
  return problems;
}
