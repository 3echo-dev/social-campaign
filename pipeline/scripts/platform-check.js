#!/usr/bin/env node
// Mechanical platform checks on every drafts/D*/post.md, against the ```json block at the top of
// platform-rules/<platform>.md. Reports R-LIMIT, R-HOOK, R-POLICY findings; never edits a draft.
//
//   node platform-check.js <brand> <job-id> [--out validation/platform-check.json]
// Exit 0 all pass · 1 any fail · 2 usage
const fs = require('fs');
const path = require('path');
const { parseFile, jsonBlock } = require('./lib-frontmatter.js');
const { validate } = require('./validate-schema.js');
const ws = require('./lib-workspace.js');
const del = require('./lib-deliverable.js');
const execution = require('./lib-execution-availability.js');
const recipes = require('./lib-recipe.js');
const kinds = require('./lib-kinds.js');

const ROOT = path.join(__dirname, '..');
const POST_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'post.schema.json'), 'utf8'));
// A post made from files the person supplied has no hook, recipe or alt text to write: the plugin wrote its front matter
// and the person's caption is theirs, so only what a supplied post carries is required.
const SUPPLIED_SCHEMA = { ...POST_SCHEMA, required: ['job', 'deliverable', 'platform', 'version', 'status', 'char_count', 'media', 'created'] };
const argv = process.argv.slice(2);
const { brand, jobId: job, dir } = ws.resolveJobArgs(argv, argv);
if (!brand || !job) { console.error('usage: platform-check.js <brand> <job-id> [--out <file>]'); process.exit(2); }
const oi = argv.indexOf('--out');
const jobDir = dir;
const outPath = oi >= 0 ? argv[oi + 1] : path.join(jobDir, 'validation', 'platform-check.json');
const availability = execution.checkJobDirectory(jobDir, { requireJob: true });
if (!availability.available) {
  console.error('UNSUPPORTED: ' + availability.message);
  process.exit(4);
}

let route = {}; try { route = JSON.parse(fs.readFileSync(path.join(jobDir, 'route.json'), 'utf8')); } catch {}
const flaggedSynthetic = [...(route.riskFlags || []), ...(route.modelAddedRiskFlags || [])].includes('synthetic_person');
const families = recipes.hookFamilies(path.join(ROOT, 'playbooks', 'hooks.md'));

// Width and height of a PNG (what 3echo lands), or null for any other file.
function pngSize(file) {
  try {
    const head = Buffer.alloc(24);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, head, 0, 24, 0); } finally { fs.closeSync(fd); }
    return head.readUInt32BE(0) === 0x89504e47 ? { w: head.readUInt32BE(16), h: head.readUInt32BE(20) } : null;
  } catch { return null; }
}

const draftsDir = path.join(jobDir, 'drafts');
const dels = fs.existsSync(draftsDir) ? fs.readdirSync(draftsDir).filter(d => /^D\d+$/.test(d)).sort() : [];
const report = { jobId: job, checkedAt: new Date().toISOString(), drafts: [], pass: true };

if (!dels.length) {
  report.pass = false;
  report.error = 'No draft posts found. Every routed deliverable needs drafts/D{n}/post.md before validation.';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.error('FAIL no draft posts found -> ' + outPath.split(path.sep).join('/'));
  process.exit(1);
}

let jobSpec = null;
try {
  jobSpec = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
} catch {}
// Files the person said were made with AI need the platform's label as much as a generated person does.
const synthetic = flaggedSynthetic || Boolean(jobSpec && (jobSpec.aiMade === true || (Array.isArray(jobSpec.suppliedMedia) && jobSpec.suppliedMedia.some(file => file && file.aiMade === true))));
const suppliesMedia = Boolean(jobSpec) && kinds.suppliesMedia(jobSpec.kind);
if (jobSpec && Array.isArray(jobSpec.deliverables)) {
  const expected = jobSpec.deliverables.map(d => d.id).filter(Boolean);
  report.missingDeliverables = expected.filter(id => !dels.includes(id));
  if (report.missingDeliverables.length) report.pass = false;
}

for (const D of dels) {
  const p = path.join(draftsDir, D, 'post.md');
  // An empty deliverable folder is a failed stage, not a skipped one. Silently continuing
  // here let a job with no written draft report "all drafts pass".
  if (!fs.existsSync(p)) {
    report.pass = false;
    report.drafts.push({ D, platform: null, result: 'NEEDS REVISION',
      findings: [{ severity: 'fail', code: 'R-SCOPE', msg: 'drafts/' + D + '/post.md does not exist; the deliverable was never written' }] });
    continue;
  }
  const { data, sections } = parseFile(p);
  const platform = String(data.platform || '');
  // Supplied mode needs both: a kind that supplies media and a post that says so. A post of any other kind that claims
  // `source: supplied` is still held to every authoring check, so the flag cannot be used to skip them.
  const supplied = suppliesMedia && data.source === 'supplied';
  const findings = [];
  const fail = (code, msg) => findings.push({ severity: 'fail', code, msg });
  const warn = (code, msg) => findings.push({ severity: 'warn', code, msg });
  const schemaErrors = validate(supplied ? SUPPLIED_SCHEMA : POST_SCHEMA, data);
  const requiredSections = ['Caption', 'Hashtags', 'CTA', 'Provenance', 'Disclosure', 'Publish plan'];
  const missingSections = requiredSections.filter(name => sections[name] === undefined);
  if (schemaErrors.length || missingSections.length) {
    const details = schemaErrors.map(e => e.path + ' ' + e.message)
      .concat(missingSections.map(name => '# ' + name + ' missing'));
    fail('R-SCOPE', 'post contract failed: ' + details.join('; '));
  }
  let rules = null;
  try { rules = jsonBlock(path.join(ROOT, 'platform-rules', platform + '.md')); } catch {}
  if (!rules) { fail('R-LIMIT', 'no platform rules json block for platform "' + platform + '"'); report.drafts.push({ D, platform, findings }); report.pass = false; continue; }

  const caption = (sections['Caption'] || '').trim();
  const tagsText = (sections['Hashtags'] || '').trim();
  const tags = tagsText.toLowerCase() === 'none' ? [] : (tagsText.match(/#[\p{L}\p{N}_]+/gu) || []);
  const full = caption + (tags.length ? '\n\n' + tags.join(' ') : '');
  const chars = [...full].length;
  const firstLine = caption.split('\n')[0] || '';
  const c = rules.caption || {}, h = rules.hashtags || {}, m = rules.media || {}, disc = rules.disclosure || {}, links = rules.links || {};

  if (!caption) fail('R-LIMIT', 'Caption section is empty');
  if (c.max_chars && chars > c.max_chars) fail('R-LIMIT', 'caption+hashtags ' + chars + ' chars, limit ' + c.max_chars);
  if (c.visible_cutoff_chars && [...firstLine].length > c.visible_cutoff_chars) {
    const said = 'first line is ' + [...firstLine].length + ' chars; hook must land inside the visible cutoff of ' + c.visible_cutoff_chars;
    // The person's own first line is theirs to keep, so for a supplied post it is a note, not a failure.
    if (supplied) warn('R-HOOK', said); else fail('R-HOOK', said);
  }
  if (c.ideal_max_chars && chars > c.ideal_max_chars) warn('R-LIMIT', 'caption ' + chars + ' chars, above the ideal ' + c.ideal_min_chars + ' to ' + c.ideal_max_chars + ' for this platform');
  if (h.max != null && tags.length > h.max) fail('R-LIMIT', tags.length + ' hashtags, platform max ' + h.max);
  if (h.recommended_max != null && tags.length > h.recommended_max) warn('R-LIMIT', tags.length + ' hashtags, recommended at most ' + h.recommended_max);
  if (h.recommended_min != null && tags.length < h.recommended_min && h.recommended_min > 0) warn('R-LIMIT', tags.length + ' hashtags, recommended at least ' + h.recommended_min);
  const media = Array.isArray(data.media) ? data.media : (data.media ? [data.media] : []);

  // The kind of post the job promised, against the kind that is on disk. A run once turned a
  // TikTok video into a five-image carousel between the price question and the final gate,
  // and every check downstream was happy because none of them looked at the plan. Changing
  // the deliverable is a decision, and a decision only happens at a gate: change-deliverable.js
  // is the only thing that may move this, and only with the person's own words.
  const kind = del.check(jobSpec, D, media);
  if (!kind.ok) fail('R-SCOPE', kind.reason);
  // The draft also states its own kind in the recipe, and that has to agree with the plan too:
  // in the run that started all this, the recipe read "carousel" while the job still said UGC.
  const saidKind = data.recipe ? del.KIND_OF_DISCIPLINE[data.recipe.format] : null;
  if (kind.planned && saidKind && saidKind !== kind.planned)
    fail('R-SCOPE', 'This is written up as ' + del.words(saidKind) + ', and you asked for ' + del.words(kind.planned) + '.');
  const changed = del.changeRecord(jobSpec, D);
  if (changed && (!changed.decidedBy || !changed.theirWords))
    fail('R-SCOPE', 'what this job delivers was changed with nobody recorded as having decided it');

  // A carousel is one post of several pictures: three to ten, the same kind of file, one shape. The platform's own
  // limit can only lower the ten. The pictures keep the order of the media list, which is the order of the slides.
  // The three is the slide plan Claude makes; the person's own pictures are held to the two the posting check takes.
  if (kind.planned === 'carousel') {
    const room = del.slideRange(platform);
    const most = Math.min(room.max, m.carousel_max_items || room.max);
    const least = supplied ? Math.min(room.min, 2) : room.min;
    if (media.length < least || media.length > most) fail('R-LIMIT', 'A carousel needs ' + least + ' to ' + most + ' pictures on ' + platform + ', and this has ' + media.length);
    if (media.some(f => !/\.(png|jpe?g|webp)$/i.test(String(f)))) fail('R-SCOPE', 'every slide of a carousel must be a picture');
    const shapes = media.map(f => pngSize(path.join(jobDir, String(f)))).filter(Boolean);
    if (shapes.length > 1 && shapes.some(z => Math.abs(z.w / z.h - shapes[0].w / shapes[0].h) > 0.02))
      fail('R-VISUAL', 'the slides are not all the same shape; a carousel needs one picture shape throughout');
  }
  if (m.required && !media.length) fail('R-LIMIT', platform + ' requires media; front matter media is empty');
  if (m.text_only_allowed === false && !media.length) fail('R-LIMIT', 'text-only posts are not allowed on ' + platform);
  for (const f of media) if (!fs.existsSync(path.join(jobDir, String(f)))) fail('R-VISUAL', 'media file missing: ' + f);
  if (links.clickable_in_caption === false && /https?:\/\//i.test(caption)) warn('R-LIMIT', 'URL in caption is not clickable on ' + platform + '; move it to the bio, sticker, or first comment');
  const hasVideo = media.some(f => /\.(mp4|mov|webm)$/i.test(String(f)));
  const disclosureText = (sections['Disclosure'] || '').trim();
  if (hasVideo && synthetic && disc.ai_generated_video_label_required && (!disclosureText || /^none$/i.test(disclosureText)))
    fail('R-POLICY', 'generated video needs an AI-made disclosure on ' + platform + '; Disclosure section is empty');
  // A supplied post has no hook family, recipe or sourced claims: the caption is the person's (or was written from the files)
  // and the person approves it. The limits, the files and the policy checks around this block still apply.
  if (!supplied) {
    if (!data.hook_family) fail('R-HOOK', 'hook_family missing from front matter');
    else if (families.size) {
      for (const problem of recipes.checkHook({ family: data.hook_family, mechanism: data.hook_mechanism, text: firstLine }, families)) fail('R-HOOK', problem);
    }
    const draftDir = path.join(draftsDir, D);
    const recipe = recipes.readRecipe(draftDir);
    if (!recipe && !recipes.readOptions(draftDir)) warn('R-ANGLE', 'This post was written before copy choices were offered, so it has no recipe to check against.');
    else for (const finding of recipes.comparePost({ data, sections }, recipe)) fail(finding.code, finding.msg);
    const alts = Array.isArray(data.hook_alternates) ? data.hook_alternates.filter(a => String(a).trim()) : [];
    if (alts.length < 2) warn('R-HOOK', 'fewer than two hook alternates recorded');
    const prov = (sections['Provenance'] || '').trim();
    const claimy = /\d|%|percent|study|report|customers|users|faster|cheaper|best|only|first|guarantee/i.test(caption);
    if (claimy && (!prov || !/->/.test(prov))) fail('R-FACT', 'caption carries a checkable claim but Provenance maps nothing to a source');
  }
  if (!(sections['Publish plan'] || '').split('\n').some(l => l.trim().startsWith('|') && !/Account|^\|\s*-/.test(l))) warn('R-TIMING', 'Publish plan table has no row');
  if (Number(data.char_count) !== chars) warn('R-LIMIT', 'front matter char_count ' + data.char_count + ' differs from measured ' + chars);

  const failed = findings.some(f => f.severity === 'fail');
  if (failed) report.pass = false;
  report.drafts.push({ D, platform, chars, firstLineChars: [...firstLine].length, hashtags: tags.length, media: media.length, plannedKind: kind.planned, deliveredKind: kind.actual, result: failed ? 'NEEDS REVISION' : 'GO', findings });
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
for (const d of report.drafts) {
  console.log((d.result === 'GO' ? 'GO   ' : 'FAIL ') + d.D + ' ' + d.platform + ' (' + d.chars + ' chars, ' + d.hashtags + ' tags)');
  for (const f of d.findings) console.log('   ' + (f.severity === 'fail' ? 'x' : '!') + ' ' + f.code + ': ' + f.msg);
}
for (const D of report.missingDeliverables || []) {
  console.error('FAIL ' + D + ' has no drafts/' + D + '/post.md');
}
console.log((report.pass ? 'all drafts pass' : 'some drafts need revision') + ' -> ' + outPath.split(path.sep).join('/'));
process.exit(report.pass ? 0 : 1);
