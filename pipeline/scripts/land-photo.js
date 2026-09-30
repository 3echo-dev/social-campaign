#!/usr/bin/env node
// Fetch the photo of the product a person sent, put it with the brand's files, and record
// where it came from.
//
//   node land-photo.js <brand> --url <address> [--job <job.json>]
//                      [--source uploaded|found-online|made] [--name <file name>]
//
// The page takes the file and stores it, so what comes back with the answer is an address.
// This is the other half: the bytes land under <root>/inputs/{brand}/, beside workspaces/
// rather than inside it, which is where every skill looks for them.
//
// Who owns the picture is not a detail. An uploaded photo is the person's own. One found
// online is not, and is recorded as not owned so the router's licence rules still bite:
// rule 6b flags licensed_media off a source the brand does not own, and nothing here is
// allowed to soften that to make the flow smoother.
//
// Exit codes: 0 landed · 1 could not fetch or store it · 2 usage.
const fs = require('fs');
const path = require('path');
const ws = require('./lib-workspace.js');
const execution = require('./lib-execution-availability.js');

const argv = process.argv.slice(2);
const pos = ws.positionals(argv);
const brand = pos[0];
const at = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const url = at('--url') || pos[1];
const jobFile = at('--job');
const source = at('--source') || 'uploaded';
const givenName = at('--name');

if (!brand || !url) {
  console.error('usage: land-photo.js <brand> --url <address> [--job <job.json>] ' +
                '[--source uploaded|found-online|made] [--name <file name>]');
  process.exit(2);
}
if (!/^https?:\/\//i.test(url)) {
  console.error('That is not an address I can fetch. The page hands back a web address, not a path.');
  process.exit(2);
}
if (jobFile) {
  const jobDir = path.dirname(path.resolve(jobFile));
  const availability = execution.checkJobDirectory(jobDir, { requireJob: true });
  if (!availability.available) {
    console.error('UNSUPPORTED: ' + availability.message);
    process.exit(4);
  }
}

// Where a picture came from decides who owns it, and there are only three ways it can get
// here. Anything else is a caller that has invented a fourth, which must not quietly
// become "the brand owns this".
const SOURCES = {
  uploaded: {
    ownedByBrand: true,
    licence: 'supplied by the brand',
    said: 'I have saved the photo you sent with this brand\'s files, and I will work from it.',
  },
  'found-online': {
    ownedByBrand: false,
    licence: 'found online, rights not confirmed',
    said: 'I have saved the picture I found. It is not the brand\'s own, so the job carries that ' +
          'and the rights have to be cleared before anything goes out.',
  },
  made: {
    ownedByBrand: true,
    licence: 'generated for this brand',
    said: 'I have saved the product shot I made, and I will work from it.',
  },
};
const origin = SOURCES[source];
if (!origin) {
  console.error('Say where this came from: uploaded, found-online or made.');
  process.exit(2);
}

const MAX_BYTES = 12 * 1024 * 1024;
const FROM_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
};

/** A name with nothing in it that could climb out of the folder it is going into. */
const safe = name => (String(name).split(/[\\/]/).pop() || '')
  .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');

/** A stamp, so a second photo for the same brand never lands on the first one. */
function stamped(extension) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return 'product-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
         '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.' + extension;
}

(async () => {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  } catch (e) {
    console.error('I could not fetch that picture: ' + (e && e.name === 'TimeoutError'
      ? 'it did not answer in a minute' : e.message));
    process.exit(1);
  }
  if (!response.ok) {
    console.error('I could not fetch that picture: the address answered ' + response.status + '.');
    process.exit(1);
  }

  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) {
    console.error('That picture arrived empty.');
    process.exit(1);
  }
  if (bytes.length > MAX_BYTES) {
    console.error('That picture is over 12 MB, which is more than this pipeline carries around.');
    process.exit(1);
  }

  const fromUrl = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  const extension = FROM_TYPE[contentType] ||
    (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(fromUrl) ? (fromUrl === 'jpeg' ? 'jpg' : fromUrl) : null);
  if (!extension) {
    console.error('That is not a picture I can use. It needs to be a PNG, JPG, WEBP, GIF or AVIF.');
    process.exit(1);
  }

  const filename = (givenName && safe(givenName)) || stamped(extension);
  const folder = ws.inputsDir(brand, process.argv);
  fs.mkdirSync(folder, { recursive: true });
  const landed = path.join(folder, filename);
  fs.writeFileSync(landed, bytes);

  // Relative to the workspace root, which is what the router resolves productAsset against
  // and what every skill reads. An absolute path here would be a path on one machine.
  const relative = 'inputs/' + brand + '/' + filename;

  if (jobFile) {
    let job;
    try { job = JSON.parse(fs.readFileSync(jobFile, 'utf8')); }
    catch (e) {
      console.error('The picture landed, but the job could not be read: ' + e.message);
      process.exit(1);
    }
    job.productAsset = {
      path: relative,
      ownedByBrand: origin.ownedByBrand,
      licence: origin.licence,
    };
    // A picture the brand does not own is a source the brand does not own, and the router
    // reads that list, not this field, when it decides whether to flag licensed_media.
    if (!origin.ownedByBrand) {
      const refs = Array.isArray(job.sourceRefs) ? job.sourceRefs : [];
      if (!refs.some(r => r && r.uri === url)) {
        refs.push({ uri: url, mediaType: 'image', ownedByBrand: false, suppliedBy: 'research',
          title: 'the product picture found online' });
      }
      job.sourceRefs = refs;
    }
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2) + '\n');
  }

  console.log(origin.said);
})().catch(e => {
  console.error('That picture could not be saved: ' + e.message);
  process.exit(1);
});
