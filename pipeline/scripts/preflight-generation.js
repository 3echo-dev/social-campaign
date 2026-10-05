#!/usr/bin/env node
// The pre-spend gate. Proves the PLAN is safe to generate, before a single credit moves.
// Its sibling preflight-media.js proves the PIPE (that a generated file can reach disk).
// Run both before the first create_image_job or create_video_job.
//
//   node preflight-generation.js <brand> <job-id> [deliverable] [--json]
//
// Checks, in order:
//   1. the storyboard gate is approved and still covers this deliverable's board
//   2. brief.md front matter is valid (the prompts must trace to it)
//   3. generation-manifest.json is valid against schemas/ugc-package.schema.json
//   4. every panel on the board's Sequence has an item, and no item names a panel not on it
//   5. the 3echo tool limits hold: duration 4 to 15, trim within duration, reference caps
//   6. stitch.order names real video items
//   7. the quote against the figure they last agreed to, said, never refused
//   8. the prompts stand on their own: none points at another, none carries a note about a
//      file, none asks for the product's own label to be hidden
//
// Exit 0 safe to generate · 1 problems found · 3 no storyboard approval · 2 usage
const fs = require('fs');
const path = require('path');
const { validate } = require('./validate-schema.js');
const { parseFile } = require('./lib-frontmatter.js');
const { hashFile } = require('./hash-artifact.js');
const ws = require('./lib-workspace.js');
const del = require('./lib-deliverable.js');
const execution = require('./lib-execution-availability.js');

// 3echo tool limits. These come from the tool schemas, not from any repo. The clip length
// lives in lib-deliverable.js so the quote and this gate cannot drift apart.
const { CLIP_SECONDS } = require('./lib-deliverable.js');
const { headroomProblems } = require('./lib-headroom.js');
const VIDEO_MIN_S = CLIP_SECONDS.min, VIDEO_MAX_S = CLIP_SECONDS.max;
const IMAGE_MAX_REFS = 16;   // create_image_job assetIds
// Check 8. Narrow on purpose: each pattern is one thing seen on a real job, not a style guide.
const POINTS_ELSEWHERE = /\b(same|identical) as (the )?[\w' ]{0,30}(prompt|above|previous|earlier)\b/i;
const NAMES_A_FILE = /(\$\{|\b[\w-]+\/[\w.-]+\.(md|json|js)\b|\b[\w-]+\.(md|json)\b)/i;
const HIDES_THE_LABEL = /\b(label|logo|branding)\b[^.;]{0,60}\b(soft-?focus(ed)?|focus-softened|blurred|hidden|obscured|out of focus|not legible|illegible|unreadable)\b|\bno text (is )?legible\b/i;
const VIDEO_MAX_IMAGE_REFS = 9;  // create_video_job image references

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const json = argv.includes('--json');
const { brand, jobId: job, dir, rest: [only] } = ws.resolveJobArgs(argv, argv);
if (!brand || !job) {
  console.error('usage: preflight-generation.js <brand> <job-id> [deliverable] [--json]');
  process.exit(2);
}
const jobDir = dir;
const availability = execution.checkJobDirectory(jobDir, { requireJob: true });
if (!availability.available) {
  const reason = availability.message;
  if (json) console.log(JSON.stringify({ safe: false, reason }, null, 2));
  else console.error('UNSUPPORTED: ' + reason);
  process.exit(4);
}
const problems = [], notes = [];
const fail = m => problems.push(m);
const note = m => notes.push(m);

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
let wsCfg = {};
try { wsCfg = readJson(path.join(ws.wsDir(brand, argv), 'workspace.json')); } catch {}
let jobSpec = {};
try { jobSpec = readJson(path.join(jobDir, 'job.json')); } catch {}

// 1. Storyboard approval. Generation before this is the one thing that cannot be undone.
const apDir = path.join(jobDir, 'approvals');
let boardApproval = null;
try {
  const recs = fs.readdirSync(apDir)
    .filter(f => f.startsWith('storyboard-') && f.endsWith('.json'))
    .map(f => readJson(path.join(apDir, f)))
    .sort((a, b) => a.round - b.round);
  boardApproval = recs.filter(r => r.decision === 'approved').pop() || null;
} catch {}
if (!boardApproval) {
  const out = { safe: false, reason: 'no approved storyboard record; nothing may be generated yet' };
  if (json) console.log(JSON.stringify(out, null, 2));
  else console.error('BLOCKED: no approved storyboard for ' + job + '. The board gate exists so a credit is never spent on a panel that is about to be cut.');
  process.exit(3);
}
for (const a of boardApproval.artifacts) {
  const p = path.join(jobDir, a.path);
  if (!fs.existsSync(p)) { fail('approved board artifact is gone: ' + a.path); continue; }
  if (hashFile(p).sha256 !== a.sha256) fail('board changed since approval: ' + a.path + '. Re-send it and ask for a new verdict before generating.');
}

// 2. The brief. Every prompt is supposed to trace to it.
const briefPath = path.join(jobDir, 'brief.md');
if (!fs.existsSync(briefPath)) fail('brief.md is missing; the manifest has nothing to trace its prompts to');
else {
  const { data } = parseFile(briefPath);
  const errs = validate(readJson(path.join(ROOT, 'schemas', 'brief.schema.json')), data);
  for (const e of errs) fail('brief.md front matter: ' + e.path + ' ' + e.message);
}

// 3 to 7. Per deliverable.
const draftsDir = path.join(jobDir, 'drafts');
let dels = fs.existsSync(draftsDir) ? fs.readdirSync(draftsDir).filter(d => /^D\d+$/.test(d)).sort() : [];
if (only) dels = dels.filter(d => d === only);
if (!dels.length) fail(only ? 'no deliverable folder ' + only : 'no deliverable folders under drafts/');

let totalCredits = 0;
const perDeliverable = [];
for (const D of dels) {
  const mPath = path.join(draftsDir, D, 'generation-manifest.json');
  const bPath = path.join(draftsDir, D, 'storyboard.md');
  if (!fs.existsSync(mPath)) { fail(D + ': generation-manifest.json is missing'); continue; }
  if (!fs.existsSync(bPath)) { fail(D + ': storyboard.md is missing'); continue; }

  let man;
  try { man = readJson(mPath); } catch (e) { fail(D + ': manifest is not valid JSON: ' + e.message); continue; }

  // 3. Schema.
  for (const e of validate(readJson(path.join(ROOT, 'schemas', 'ugc-package.schema.json')), man))
    fail(D + ': manifest ' + e.path + ' ' + e.message);

  // 4. Panels against the board's Sequence line.
  const boardText = fs.readFileSync(bPath, 'utf8');
  const seqLine = (boardText.match(/^\*\*Sequence:\*\*\s*(.+)$/m) || [])[1] || '';
  const boardPanels = [...seqLine.matchAll(/\bP\d+\b/g)].map(m => m[0]);
  const itemPanels = [...new Set((man.items || []).map(i => i.panel).filter(Boolean))];
  if (!boardPanels.length) note(D + ': the board has no readable Sequence line, so panel coverage was not cross-checked');
  else {
    for (const p of boardPanels) if (!itemPanels.includes(p))
      fail(D + ': board panel ' + p + ' has no manifest item, so it would never be generated');
    for (const p of itemPanels) if (!boardPanels.includes(p))
      fail(D + ': manifest item names panel ' + p + ', which is not in the approved Sequence. A cut panel must not be generated.');
  }

  // 5. Tool limits.
  let imageCount = 0;
  for (const it of man.items || []) {
    const where = D + ' ' + (it.panel || '?') + ' (' + (it.kind || '?') + ')';
    const refs = Array.isArray(it.assetIds) ? it.assetIds.length : 0;
    if (it.kind === 'image') {
      imageCount++;
      if (refs > IMAGE_MAX_REFS) fail(where + ': ' + refs + ' reference assets, the image tool accepts at most ' + IMAGE_MAX_REFS);
      if (it.credits !== 1) fail(where + ': image items cost exactly 1 credit; this says ' + it.credits);
    }
    if (it.kind === 'video') {
      const d = it.durationSeconds;
      if (!Number.isInteger(d) || d < VIDEO_MIN_S || d > VIDEO_MAX_S)
        fail(where + ': durationSeconds must be a whole number from ' + VIDEO_MIN_S + ' to ' + VIDEO_MAX_S + '; this says ' + d);
      const firstClip = String(((man.stitch || {}).order || [])[0] || '');
      const thisClip = it.file ? path.basename(String(it.file)).replace(/\.[^.]+$/, '') : '';
      for (const p of headroomProblems(it, thisClip !== '' && thisClip === firstClip)) fail(where + ': ' + p);
      if (refs > VIDEO_MAX_IMAGE_REFS) fail(where + ': ' + refs + ' image references, the video tool accepts at most ' + VIDEO_MAX_IMAGE_REFS);
      if (it.seedFromPanelImage && !refs) note(where + ': seedFromPanelImage is set but no assetId is listed yet; the panel image must be uploaded and its id recorded before submission');
      if (it.credits == null) note(where + ': credits are null until estimate_video_job returns a quote');
    }
    if (typeof it.credits === 'number') totalCredits += it.credits;
    // BEGIN labelled references (0.14 task 3). A job made before this has no `references`: skip it.
    if (it.references !== undefined) {
      const ids = Array.isArray(it.assetIds) ? it.assetIds : [];
      const labelled = Array.isArray(it.references) ? it.references : [];
      if (labelled.length !== ids.length)
        fail(where + ': it attaches ' + ids.length + ' picture(s) but labels ' + labelled.length + '; give every attached picture a label, in the same order.');
      else {
        labelled.forEach((r, i) => {
          if (!r || !String(r.label || '').trim())
            fail(where + ': attached picture ' + (i + 1) + ' has no label, so the model cannot tell what it shows.');
          else if (String(r.ref) !== String(ids[i]))
            fail(where + ': label ' + (i + 1) + ' ("' + String(r.label).trim() + '") is not on attached picture ' + (i + 1) + '; list the labels in the same order as the attachments.');
        });
      }
    }
    // END labelled references
  }

  // 8. What the prompts say. Each of these was watched happening on a real job: a clip
  // prompt reading "Same as the P1 image prompt above, animated", which the video model
  // renders as those words; a style field carrying a remark about a brand file; and a bottle
  // whose label was asked to be "focus-softened so no text is legible", which came back as a
  // blank white sticker on a bottle nobody could name. All three are cheaper to catch here.
  const fieldsToLint = [['style', man.style], ['continuity', man.continuity], ['negative', man.negative]];
  for (const it of man.items || []) fieldsToLint.push([(it.panel || '?') + ' (' + (it.kind || '?') + ') prompt', it.prompt]);
  for (const [where, text] of fieldsToLint) {
    const t = String(text || '');
    if (/\bprompt\b/.test(where) && !t.trim()) { fail(D + ' ' + where + ' is empty'); continue; }
    if (POINTS_ELSEWHERE.test(t)) fail(D + ' ' + where + ' points at another prompt ("' + t.match(POINTS_ELSEWHERE)[0] + '"). The model reads only this one: write it out in full.');
    if (NAMES_A_FILE.test(t)) fail(D + ' ' + where + ' carries a note about a file ("' + t.match(NAMES_A_FILE)[0] + '"). The model paints what it reads; keep notes out of the prompt.');
    if (HIDES_THE_LABEL.test(t)) fail(D + ' ' + where + ' asks for the product\'s own label to be hidden ("' + t.match(HIDES_THE_LABEL)[0].trim() + '"). The label from the photo is the brand; ban added text only.');
  }

  const spec = (Array.isArray(jobSpec.deliverables) ? jobSpec.deliverables : []).find(x => x && x.id === D);
  if (spec && spec.talkingCharacter === true && ['ugc', 'brand_video'].includes(spec.creativeDiscipline)) {
    const chars = Array.isArray(man.characters) ? man.characters : [];
    const voices = new Map(chars.filter(c => c && c.id && String(c.voice || '').trim()).map(c => [String(c.id), String(c.voice).trim()]));
    const clips = (man.items || []).filter(i => i.kind === 'video');
    if (!voices.size) fail(D + ': this is a talking character deliverable, so the manifest needs characters, each with one voice description');
    if (!clips.some(i => i.dialogue && i.dialogue.line)) fail(D + ': this is a talking character deliverable, but no clip has a dialogue line');
    for (const it of clips) {
      if (!it.dialogue || !it.dialogue.line) continue;
      const where = D + ' ' + (it.panel || '?') + ' (video)';
      const voice = voices.get(String(it.dialogue.character));
      if (!voice) { fail(where + ': dialogue names "' + it.dialogue.character + '", which has no voice description under characters'); continue; }
      if (it.generateAudio === false) fail(where + ': it has a spoken line, so generateAudio must be on; the dialogue is made inside the clip');
      if (!String(it.prompt || '').includes(it.dialogue.line)) fail(where + ': the spoken line is not in the clip prompt, so the model would never say it');
      if (!String(it.prompt || '').includes(voice)) fail(where + ': the character\'s voice description is not pasted verbatim into the clip prompt, so the voice would change from clip to clip');
    }
  }

  const landedFile = path.join(jobDir, 'generation', 'landed.jsonl');
  const latestByPanel = new Map();
  try {
    for (const line of fs.readFileSync(landedFile, 'utf8').split(/\r?\n/)) {
      let rec = null;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec && rec.type === 'landed' && rec.deliverable === D && rec.panel && rec.manifestFile) latestByPanel.set(rec.panel, rec);
    }
  } catch {}
  for (const [panel, rec] of latestByPanel) {
    const came = path.extname(String(rec.promoted || rec.file)).slice(1).toUpperCase();
    note(D + ' ' + panel + ' came back as a ' + came + ' and is saved as ' + (rec.promoted || rec.file) + ', but the manifest names ' + rec.manifestFile + ' (no converter was available). Anything reading the manifest will not find it.');
  }

  // 6. Stitch order.
  const st = man.stitch || {};
  const videoIds = new Set((man.items || []).filter(i => i.kind === 'video' && i.file)
    .map(i => path.basename(String(i.file)).replace(/\.[^.]+$/, '')));
  for (const sid of st.order || []) if (!videoIds.has(sid))
    fail(D + ': stitch.order names "' + sid + '" but no video item has that file name');
  if (videoIds.size && !(st.order || []).length) fail(D + ': there are video items but stitch.order is empty');

  // The plan on disk against the plan in job.json. A video deliverable whose manifest has no
  // clips in it is a deliverable that has quietly become a picture post, and the cheapest
  // place to catch that is before a credit moves.
  const plannedKind = del.plannedKind(jobSpec, D);
  const clipItems = (man.items || []).filter(i => i.kind === 'video').length;
  if (plannedKind === 'video' && !clipItems)
    fail(D + ': you asked for a video and this plan has no moving shots in it. Ask before changing what the job delivers.');

  // The ids, not only the counts. The spend guard in `hooks/hooks.mjs` reads this to decide
  // whether the panel an idempotencyKey names is one the approved board actually covers, and
  // what a clip was planned to cost. It cannot read the manifest itself: a function hook's
  // filesystem stops at the session's working directory, and a job folder is usually above it.
  const videoCredits = {};
  for (const it of (man.items || []).filter(i => i.kind === 'video')) {
    const id = it.file ? path.basename(String(it.file)).replace(/\.[^.]+$/, '') : String(it.panel || '');
    if (id) videoCredits[id] = typeof it.credits === 'number' ? it.credits : null;
  }
  perDeliverable.push({ deliverable: D, panels: itemPanels.length, images: imageCount,
    videos: videoIds.size, panelIds: itemPanels, clipIds: [...videoIds], videoCredits });
}

// 7. What the person last said yes to, beside what this plan costs now.
//
// There is no preset budget on a brand, and the figure on a gate does not bind either. The
// person adds and cuts panels after they approve, so by the time a quote is made the figure
// they put against the idea is a memory, not a limit. Refusing on it turned a 91-credit
// quote into a dead end and refused figures the person had chosen themselves. The quote is
// shown next to what they last agreed, and their yes to that quote, through ask.js and
// wait-answer.js, is the authorisation. Whichever gate they last put a figure against is the
// one quoted back to them.
const GATE_WORDS = {
  concept: 'what you agreed when you approved the idea',
  storyboard: 'what you agreed when you approved the storyboard',
  content: 'what you agreed when you approved the posts',
};
const ceilings = [];
try {
  const said = fs.readdirSync(apDir).filter(f => f.endsWith('.json'))
    .map(f => { try { return readJson(path.join(apDir, f)); } catch { return null; } })
    // A gate that records no figure is not an authorisation of zero, it is a gate that was
    // not about money. `null` reads as 0 through Number(), which would silently bind the
    // whole job to nothing.
    .filter(r => r && r.decision === 'approved' && r.scope &&
      r.scope.maxSpendCredits !== null && r.scope.maxSpendCredits !== undefined &&
      Number.isFinite(Number(r.scope.maxSpendCredits)))
    .sort((a, b) => String(a.decidedAt || '').localeCompare(String(b.decidedAt || '')) ||
      (Number(a.round) || 0) - (Number(b.round) || 0));
  const latest = said[said.length - 1];
  if (latest) {
    const m = Number(latest.scope.maxSpendCredits);
    ceilings.push([GATE_WORDS[latest.gate] || 'what you agreed when you approved this', m]);
  }
} catch {}
for (const [label, limit] of ceilings)
  if (totalCredits > limit) note('this quote is ' + totalCredits + ' credits, more than ' + label + ', which was ' + limit + '. Say so when you put the price to them; their yes decides.');

const result = {
  safe: problems.length === 0, brand, job,
  deliverables: perDeliverable,
  quotedCredits: totalCredits,
  ceilings: Object.fromEntries(ceilings),
  storyboardApproval: boardApproval.approvalId,
  problems, notes,
};
if (json) { console.log(JSON.stringify(result, null, 2)); process.exit(result.safe ? 0 : 1); }

for (const d of perDeliverable)
  console.log('  ' + d.deliverable + ': ' + d.panels + ' panel(s), ' + d.images + ' image(s), ' + d.videos + ' clip(s)');
console.log('  quoted: ' + totalCredits + ' credit(s)' + (ceilings.length ? ', last agreed ' + Math.min(...ceilings.map(c => c[1])) : ', no figure agreed yet'));
for (const n of notes) console.log('  note: ' + n);
if (problems.length) {
  for (const p of problems) console.error('  x ' + p);
  console.error('BLOCKED: do not generate. Fix the manifest or the board, then re-run.');
  process.exit(1);
}
console.log('ok: the plan is safe to generate against board approval ' + boardApproval.approvalId + '. Run preflight-media.js next to prove the download path.');
