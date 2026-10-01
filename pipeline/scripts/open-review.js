#!/usr/bin/env node
// Open a gate in the pane from the artifacts that are on disk right now.
//   node open-review.js <brand> <job-id> <gate>
//   node open-review.js --brand <slug>
//
// The items are built here, from the files, rather than typed out by the model. A review
// carried forward by hand goes stale: a deliverable cut from the job is still offered for
// approval, and a click on it approves something that no longer exists. Reading the folder
// each time makes that impossible.
//
// It also prints the plain chat summary, because the chat and the pane are one place and the
// person may decide in either.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const gate = require('./lib-gate.js');
const frontmatter = require('./lib-frontmatter.js');
const postOf = require('./lib-post.js');
const execution = require('./lib-execution-availability.js');
const states = require('./lib-states.js');

const argv = process.argv.slice(2);
const OFFLINE = 'The pane is not connected in this folder. Run set-gate-app.js once.';
const BRAND_FILES = ['brand-voice.md', 'audience.md', 'positioning.md', 'platform-playbook.md'];
const GATES = states.GATE_IDS;

const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const listDir = p => { try { return fs.readdirSync(p).sort(); } catch { return []; } };
const field = (text, name) => {
  const m = String(text || '').match(new RegExp('\\*\\*' + name + ':\\*\\*\\s*`?([^`\\n]*)`?'));
  return m ? m[1].trim() : '';
};

// The four brand files, as one review of the brand page.
function brandReview(slug) {
  const root = ws.wsDir(slug, argv);
  // The scaffolder and every other script keep these under `brand/`. Looking beside them
  // instead found nothing, and the gate opened with no cards in it. The old flat layout is
  // still read, so a workspace made before the move is not left behind.
  const dirs = [path.join(root, 'brand'), root];
  const items = [];
  for (const name of BRAND_FILES) {
    let text = null;
    for (const dir of dirs) {
      text = read(path.join(dir, name));
      if (text !== null) break;
    }
    if (text === null) continue;
    // The front matter is the file's own bookkeeping: which version, captured when, from
    // where. A client reading "--- brand: sk-ii file: brand-voice version: 2" is reading the
    // machinery rather than the brand.
    const said = frontmatter.parse(text).body.trim();
    items.push({ id: name.replace(/\.md$/, ''), label: name, text: said || text.trim() });
  }
  let display = slug;
  try {
    const cfg = JSON.parse(read(path.join(root, 'workspace.json')) || '{}');
    display = cfg.displayName || cfg.name || slug;
  } catch { /* the slug is a fine title */ }
  return { key: 'brand:' + slug, gate: 'brand', mode: 'review_all', title: display + ', brand setup', items };
}

// One text item per `## Concept X` section, so the person picks a concept rather than a file.
//
// The body stops at the next heading of any kind. Without that the last concept swallowed
// everything after it, and a reviewer was shown the paid-only table, the hook register and
// the provenance notes as though they were part of the idea.
function conceptBody(rest) {
  const end = rest.search(/^#{1,3}\s+/m);
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

// The line a person needs to tell three ideas apart: what is said on camera, and how long it
// runs. The rest is the record, and belongs behind the summary rather than in front of it.
function conceptCaption(body) {
  const spoken = body.match(/[“"']([^“”"']{8,90})[”"']/);
  const seconds = body.match(/duration[^0-9]{0,12}(\d{1,3})\s*s/i);
  const parts = [];
  if (spoken) parts.push('"' + spoken[1].trim() + '"');
  if (seconds) parts.push(seconds[1] + ' seconds');
  if (parts.length) return parts.join(' · ');
  const first = body.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).find(l => l.length > 20);
  return first ? first.slice(0, 120) : '';
}

function conceptItems(dir) {
  const text = read(path.join(dir, 'concepts.md'));
  if (!text) return [];
  const items = [];
  const parts = text.split(/^##\s+(Concept\s+[^\n]+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim();
    const id = (heading.match(/Concept\s+([A-Za-z0-9]+)/) || [, String((i + 1) / 2)])[1];
    const body = conceptBody(parts[i + 1] || '');
    items.push({ id: 'concept-' + id, label: heading, caption: conceptCaption(body), text: body });
  }
  return items;
}

// A board panel is an image once its frame exists on disk, and the text row until then.
function panelItems(dir) {
  const items = [];
  for (const d of listDir(path.join(dir, 'drafts')).filter(n => /^D\d+$/.test(n))) {
    const board = read(path.join(dir, 'drafts', d, 'storyboard.md'));
    if (!board) continue;
    for (const line of board.split('\n')) {
      const cells = line.split('|').map(c => c.trim());
      // A panel row is | # | ID | ... with a real panel id in the second cell.
      if (cells.length < 4 || !/^P\d+$/.test(cells[2] || '')) continue;
      const panel = cells[2];
      const rel = 'media/' + d + '/' + panel + '.png';
      const label = d + ' ' + panel;
      const summary = cells.slice(3).filter(Boolean).join(' - ');
      // `file` is where the frame sits on this machine. It is uploaded below and never
      // sent: a local path in the payload is what made the pane show an empty card.
      items.push(fs.existsSync(path.join(dir, rel))
        ? { id: d + '-' + panel, label, file: path.join(dir, rel), as: 'imageUrl', caption: summary, instead: summary }
        : { id: d + '-' + panel, label, text: summary });
    }
  }
  return items;
}

// Any clip that is not already part of a post. A finished video deliverable is previewed as
// the post it will be; showing the same file again on its own card underneath asks the person
// to approve one thing twice.
function clipItems(dir, alreadyShown) {
  const shown = alreadyShown || new Set();
  const items = [];
  for (const d of listDir(path.join(dir, 'media')).filter(n => /^D\d+$/.test(n))) {
    for (const f of listDir(path.join(dir, 'media', d)).filter(n => !n.startsWith('.') && /\.(mp4|mov|webm)$/i.test(n))) {
      const file = path.join(dir, 'media', d, f);
      if (shown.has(path.resolve(file))) continue;
      items.push({
        id: d + '-' + f.replace(/\.[^.]+$/, ''),
        label: d + ' ' + f,
        file,
        as: 'videoUrl',
        instead: 'The clip is finished. It could not be loaded here, so watch it in the chat.',
      });
    }
  }
  return items;
}

const PLATFORM_NAMES = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };

/**
 * One card per deliverable, carrying the post itself rather than the file it is written in.
 *
 * The card used to be handed `post.md` verbatim, so a person came to approve a TikTok
 * carousel and read front matter, provenance bullets and a publish-plan table instead. The
 * post goes in front of them and the record goes behind a fold, and the pictures travel as
 * addresses so the pane can draw them.
 */
function postItems(dir) {
  const drafts = listDir(path.join(dir, 'drafts')).filter(n => /^D\d+$/.test(n));
  const items = [];
  const used = new Set();
  const counts = {};
  for (const d of drafts) {
    const post = postOf.readPost(dir, d);
    if (!post) continue;
    const platform = PLATFORM_NAMES[post.platform] || '';
    counts[platform] = (counts[platform] || 0) + 1;
    const one = drafts.length === 1;
    const named = platform ? platform + ' post' : 'Post';
    items.push({
      id: d + '-post',
      label: one ? 'The ' + named : named + ' ' + counts[platform],
      post: {
        platform: post.platform,
        caption: post.caption,
        hashtags: post.hashtags,
        ...(post.cta ? { cta: post.cta } : {}),
      },
      mediaFiles: post.media.map(m => ({ ...m, name: d + '-' + path.basename(m.path) })),
      details: post.details,
    });
    for (const m of post.media) used.add(path.resolve(m.path));
  }
  return { items, used };
}

function fileItem(dir, rel, label) {
  const text = read(path.join(dir, rel));
  return text ? [{ id: rel.replace(/[^a-zA-Z0-9]+/g, '-'), label, text: text.trim() }] : [];
}

function jobReview(brand, jobId, gateName) {
  const dir = ws.jobDir(brand, jobId, argv);
  if (!fs.existsSync(dir)) {
    console.error('No job at ' + ws.fwd(dir) + '.');
    process.exit(3);
  }
  const availability = gateName === 'report'
    ? execution.checkExecutionAvailability({ workflowId: 'performance-review' })
    : execution.checkJobDirectory(dir, { requireJob: true });
  if (!availability.available) {
    console.error('UNSUPPORTED: ' + availability.message);
    process.exit(4);
  }
  const title = field(read(path.join(dir, 'status.md')), 'Title') || (brand + ', ' + jobId);
  let items = [];
  if (gateName === 'concept') items = conceptItems(dir);
  else if (gateName === 'storyboard') items = panelItems(dir);
  else if (gateName === 'content' || gateName === 'publish') {
    const posts = postItems(dir);
    items = posts.items.concat(clipItems(dir, posts.used));
  }
  else if (gateName === 'campaign_proposal') items = fileItem(dir, 'campaign/proposal.md', 'Campaign plan');
  else if (gateName === 'campaign_activation') items = fileItem(dir, 'campaign/activation-checklist.md', 'Going live');
  else if (gateName === 'findings') items = fileItem(dir, 'report/report.md', 'Report');
  else if (gateName === 'report') items = fileItem(dir, 'report.md', 'Report');
  // Only alternatives are a pick; everything else is a sequence the person accepts as a whole.
  const mode = gateName === 'concept' ? 'pick_one' : 'review_all';
  return { key: jobId, gate: gateName, mode, title, items };
}

const brandAt = argv.indexOf('--brand');
let review;
if (brandAt >= 0) {
  const slug = argv[brandAt + 1];
  if (!slug) { console.error('usage: open-review.js --brand <slug>'); process.exit(2); }
  review = brandReview(slug);
} else {
  const { brand, jobId, rest } = ws.resolveJobArgs(argv);
  const gateName = rest[0];
  if (gateName === 'report') {
    console.error('UNSUPPORTED: ' + execution.PERFORMANCE_UNSUPPORTED);
    process.exit(4);
  }
  if (!brand || !jobId || !GATES.includes(gateName)) {
    console.error('usage: open-review.js <brand> <job-id> <' + GATES.join('|') + ">   or   open-review.js --brand <slug>");
    process.exit(2);
  }
  review = jobReview(brand, jobId, gateName);
}

if (!review.items.length) {
  console.error('There is nothing on disk for the ' + review.gate + ' gate yet, so there is nothing to review.');
  process.exit(1);
}

// The pane is read by the client, not by whoever built the pipeline. File names, anchors and
// state ids are removed here, once, so no card can carry them however it was written.
const plainly = require('./lib-plain.js');
const FILE_LABELS = {
  'brand-voice': 'How the brand sounds',
  audience: 'Who it is for',
  positioning: 'What it stands for',
  'platform-playbook': 'How it shows up on each platform',
};
const readableLabel = (label) => {
  const stem = String(label).replace(/\.[^.]+$/, '');
  if (FILE_LABELS[stem]) return FILE_LABELS[stem];
  const said = plainly.plain(label);
  return said || stem.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
};
review.title = plainly.plain(review.title) || review.title;
review.items = review.items.map((item) => ({
  ...item,
  label: readableLabel(item.label),
  ...(item.caption ? { caption: plainly.plain(item.caption) } : {}),
  ...(item.text ? { text: plainly.plain(item.text) } : {}),
  // The caption is the post's own words and is never rewritten. The record behind it is
  // written by the pipeline for the pipeline, so it goes through the cleaner like the rest.
  ...(item.details ? { details: plainly.plain(item.details) } : {}),
}));

/**
 * Every picture and clip goes to the gate app first, and the card carries the address that
 * came back. A local path is never sent: the browser cannot open one, which is exactly how
 * a person came to see the hero frame in the chat and an empty card in the pane.
 *
 * An upload that fails is not allowed to block the gate. The card falls back to the words
 * that describe the shot, which is what it showed before the frame existed anyway.
 *
 * A post carries several files rather than one, and they keep their order: a carousel read
 * out of order is a different post. Whatever does arrive is shown; a picture that did not
 * make it leaves the caption and the rest of the post standing.
 */
async function withUploads(items, key) {
  const out = [];
  const failed = [];
  for (const item of items) {
    const { file, as, instead, mediaFiles, ...card } = item;
    if (mediaFiles) {
      const shown = [];
      for (const one of mediaFiles) {
        const sent = await gate.upload(one.path, { key, argv, name: one.name });
        if (sent.url) shown.push({ url: sent.url, kind: one.kind });
      }
      if (shown.length < mediaFiles.length) failed.push(card.label);
      out.push({ ...card, post: { ...card.post, media: shown } });
      continue;
    }
    if (!file) { out.push(card); continue; }
    const sent = await gate.upload(file, { key, argv });
    if (sent.url) out.push({ ...card, [as]: sent.url });
    else {
      failed.push(card.label);
      out.push({ ...card, text: card.text || card.caption || instead });
    }
  }
  return { items: out, failed };
}

(async () => {
  const prepared = await withUploads(review.items, review.key);
  review.items = prepared.items;

  const res = await gate.call('review', {
    key: review.key, gate: review.gate, title: review.title, mode: review.mode, items: review.items,
  }, { argv });
  if (res.offline) console.log(OFFLINE);
  else if (prepared.failed.length) {
    console.log('Could not load ' + prepared.failed.length + ' of these into the pane, so they read as words there. They are still in the chat.');
  }

  console.log(review.title);
  for (const item of review.items) {
    const pictures = item.post ? item.post.media.length : 0;
    const kind = item.post
      ? (pictures > 1 ? pictures + ' pictures' : pictures === 1 ? '1 picture' : 'no pictures yet')
      : item.imageUrl ? 'image' : item.videoUrl ? 'video' : 'text';
    const first = String((item.post && item.post.caption) || item.text || item.caption || '')
      .split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    console.log('- ' + item.label + ' (' + kind + ')' + (first ? ': ' + first.slice(0, 140) : ''));
  }
  console.log('Approve, or say what to change, here or in the pane.');
})();
