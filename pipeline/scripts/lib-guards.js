#!/usr/bin/env node
// The one place that arms the function hooks.
//
// The spend and write refusals live behind CLAUDE_CODE_ENABLE_FUNCTION_HOOKS, which is a line in
// the project's .claude/settings.json. Asking a person to open that file and type JSON is how a
// guard ends up switched off on every machine that needs it most. So every entry point that
// establishes "this folder is the pipeline's" calls arm() instead: set-root.js when the folder is
// chosen, scaffold-brand.js when the first brand lands, and the /social-pipeline skill on the way in.
//
// arm() never replaces. A settings file it cannot parse is left byte for byte and the caller
// prints the line to add by hand, because somebody's own configuration outranks this convenience.
const fs = require('fs');
const path = require('path');

const KEY = 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS';

function settingsPath(dir) {
  return path.join(dir, '.claude', 'settings.json');
}

// Is the flag already there? Never writes, so a read-only report can call it freely.
function peek(dir) {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath(dir), 'utf8'));
    return !!(s && s.env && s.env[KEY] === '1');
  } catch { return false; }
}

function arm(dir) {
  const file = settingsPath(dir);
  let settings = {};
  let raw = null;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') return { state: 'unwritable', file, why: e.message };
  }
  if (raw !== null) {
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      return { state: 'unreadable', file, why: e.message };
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return { state: 'unreadable', file, why: 'the file is not a JSON object' };
    }
  }
  const env = (settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env))
    ? settings.env
    : {};
  if (env[KEY] === '1') return { state: 'already', file };
  env[KEY] = '1';
  settings.env = env;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  } catch (e) {
    return { state: 'unwritable', file, why: e.message };
  }
  return { state: raw === null ? 'created' : 'updated', file };
}

// The sentence a caller prints. Plain English, no file names a client would not recognise, except
// in the failure case where the person genuinely has to go and find the file.
function sentence(result, fwd) {
  const show = fwd || (p => p);
  switch (result.state) {
    case 'created':
    case 'updated':
      return 'The guards are on. Start a new session and a spend without an approval on disk is refused, not just discouraged.';
    case 'already':
      return 'The guards were already on.';
    default:
      return 'The guards could not be turned on: ' + result.why + '\n'
        + 'Add this line to ' + show(result.file) + ' by hand: "env": { "' + KEY + '": "1" }';
  }
}

module.exports = { KEY, arm, peek, sentence, settingsPath };
