// One `drafts/D{n}/post.md`, read as the post a person is being asked to approve.
//
// The card used to carry the whole file: front matter, provenance bullets, the publish-plan
// table, the notes for the editor. A person opening it saw a wall of record and could not
// tell what the post itself said, let alone what it would look like.
//
// So the file is split in two. What goes in front of them is the post: the platform, the
// caption in the order they will read it, the hashtags, and the pictures or the clip. The
// rest is the record, returned as one block of plain sentences for the card to keep folded
// away underneath.
//
// Nothing here throws on a file that is missing a piece. A post with no hashtags simply has
// none; a post with no media is still a post. A half-parsed dump would be worse than an
// absent section, because the person would not know which half they were reading.
const fs = require('fs');
const path = require('path');
const frontmatter = require('./lib-frontmatter.js');

const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;
const VIDEO = /\.(mp4|mov|webm|m4v)$/i;
const PLATFORMS = ['tiktok', 'instagram', 'facebook'];

/** A section body ends where its first sub-heading starts: `## Details` is not the caption. */
function untilSubheading(text) {
  const body = String(text == null ? '' : text);
  const cut = body.search(/^##\s+/m);
  return (cut >= 0 ? body.slice(0, cut) : body).trim();
}

/** The words before the first `# Heading`, which is where a post states what it is. */
function preamble(body) {
  const at = body.search(/^#\s+/m);
  return (at >= 0 ? body.slice(0, at) : body).trim();
}

/** Every `# Heading` in the file, in order, so the record keeps the order it was written in. */
function headings(body) {
  const found = [];
  for (const line of body.split('\n')) {
    const h = line.match(/^#\s+(.+?)\s*$/);
    if (h) found.push(h[1]);
  }
  return found;
}

/**
 * A markdown table, said out loud. Words on a card runs the rows of a table together into
 * one line, so a publish plan read as a single unbroken sentence. One bullet per cell says
 * the same thing and survives being read.
 */
function flattenTables(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let block = [];
  const flush = () => {
    if (!block.length) return;
    const rows = frontmatter.table(block.join('\n'));
    for (const row of rows) {
      for (const [head, cell] of Object.entries(row)) {
        if (cell) out.push('- ' + head + ': ' + cell);
      }
      out.push('');
    }
    block = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith('|')) { block.push(line); continue; }
    flush();
    out.push(line);
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * A heading inside the record reads as a bold line on its own, since the card has one real
 * heading already. The blank line after it matters: without it the heading and the sentence
 * under it run together into one paragraph. A horizontal rule is a printer's mark with
 * nothing to say, so it goes.
 */
const sayHeadings = (text) =>
  String(text || '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/^#{1,6}\s*(.+?)\s*$/gm, '**$1**\n');

/** What each part of the record is called, in words a client reads without asking. */
const RECORD_HEADINGS = {
  media: 'About the pictures',
  provenance: 'Where each line comes from',
  disclosure: 'What has to be said out loud',
  'publish plan': 'Where and when it would go out',
  'notes for the editor': 'Notes',
  cta: 'The call to action',
  'call to action': 'The call to action',
  details: 'The rest of the record',
};

const listOf = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]);

/** The hashtags, from the front matter if it lists them, else from the section that shows them. */
function hashtagsOf(data, sections) {
  const listed = listOf(data.hashtags).map(String).map(t => t.trim()).filter(Boolean);
  const tags = listed.length ? listed : (untilSubheading(sections.Hashtags).match(/#[\wÀ-ɏ]+/g) || []);
  const seen = new Set();
  return tags
    .map(t => (t.startsWith('#') ? t : '#' + t))
    .filter(t => (seen.has(t.toLowerCase()) ? false : seen.add(t.toLowerCase())));
}

/** The media the post is made of, in the order it is posted, each one a picture or a clip. */
function mediaOf(data, jobDir) {
  const out = [];
  for (const entry of listOf(data.media)) {
    const rel = String(entry).trim().replace(/^["'`]|["'`]$/g, '');
    if (!rel) continue;
    const kind = VIDEO.test(rel) ? 'video' : IMAGE.test(rel) ? 'image' : null;
    if (!kind) continue;
    out.push({ kind, rel, path: path.resolve(jobDir, rel) });
  }
  return out;
}

/**
 * Everything that is not the post: what it is, where the claims come from, what has to be
 * disclosed, where it would go out, and the notes. One block, in the file's own order.
 */
function detailsOf({ body, sections, data, usedSections }) {
  const parts = [];
  const first = preamble(body);
  if (first) parts.push(sayHeadings(first));

  for (const name of headings(body)) {
    if (usedSections.has(name)) continue;
    const said = RECORD_HEADINGS[name.trim().toLowerCase()] || name.trim();
    const text = sayHeadings(flattenTables(sections[name] || ''));
    if (text) parts.push('**' + said + '**\n\n' + text);
  }

  const facts = [];
  if (data.char_count) facts.push('- The caption runs ' + data.char_count + ' characters.');
  if (data.accessibility_text) facts.push('- What someone who cannot see the pictures is told: ' + data.accessibility_text);
  const alternates = listOf(data.hook_alternates).filter(Boolean);
  if (alternates.length) {
    facts.push('- Other openings that were written and not used:');
    for (const alternate of alternates) facts.push('  - ' + alternate);
  }
  if (facts.length) parts.push('**Facts about this draft**\n\n' + facts.join('\n'));

  return parts.join('\n\n').trim();
}

/**
 * parse(text, jobDir) -> { platform, caption, lead, hashtags, cta, media, details }
 *
 * `lead` is the caption's first line on its own, because the first line is the only part
 * every platform shows before somebody taps for more.
 */
function parse(text, jobDir) {
  const source = String(text || '');
  let parsed;
  try { parsed = frontmatter.parse(source); }
  catch { parsed = { data: {}, body: source, sections: {} }; }
  const { data, body, sections } = parsed;

  const said = String(data.platform || '').trim().toLowerCase();
  const platform = PLATFORMS.includes(said) ? said : '';

  const caption = untilSubheading(sections.Caption);
  const lead = caption.split('\n').map(l => l.trim()).find(Boolean) || '';

  const ctaText = untilSubheading(sections.CTA || sections['Call to action']);
  // A call to action already inside the caption is not a second thing to read.
  const cta = ctaText && !caption.includes(ctaText) ? ctaText : '';

  const usedSections = new Set(['Caption', 'Hashtags']);
  if (cta) { usedSections.add('CTA'); usedSections.add('Call to action'); }

  return {
    platform,
    caption,
    lead,
    hashtags: hashtagsOf(data, sections),
    cta,
    media: mediaOf(data, jobDir || '.'),
    details: detailsOf({ body, sections, data, usedSections }),
  };
}

/** The same, read off disk. Null when there is no post for that deliverable. */
function readPost(jobDir, deliverable) {
  const file = path.join(jobDir, 'drafts', deliverable, 'post.md');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { return null; }
  return parse(text, jobDir);
}

module.exports = { parse, readPost, flattenTables };
