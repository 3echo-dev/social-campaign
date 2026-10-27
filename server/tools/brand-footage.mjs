/**
 * The brand footage tools: brand_footage_import, brand_footage_status, brand_footage_search, brand_footage_analysis_save,
 * brand_footage_mark, brand_footage_folder, brand_footage_digest, brand_footage_adopt.
 *
 * A brand's archive of past videos, pictures and audio lives in its library (see server/pipeline/brand-footage.mjs for the files).
 * Importing a folder and searching are free and local. Looking inside the footage (the analysis) is model work done by the agent
 * that watches the files; these tools only keep what it saw, in two stages, and tell the agent what a full pass costs.
 */

import { defineTool } from '../mcp/registry.mjs';
import * as runtime from '../pipeline/runtime.mjs';
import { InvalidInputError } from '../lib/errors.mjs';
import {
  FOOTAGE_KINDS, RIGHTS, RIGHTS_WORDS, changeFolder, footageStatus, markForFull, saveAnalysis, searchFootage,
} from '../pipeline/brand-footage.mjs';
import { adoptFromFootage, feedBank, footageDigest, importAndDigest, reconcileBank } from '../pipeline/brand-footage-digest.mjs';
import { log } from '../lib/log.mjs';

const string = { type: 'string' };

/** A folder this small is usually indexed before the answer goes back; a big one is left running. */
const WAIT_MS = 2500;

function local(workspace) {
  if (!workspace.root) throw new Error('Choose your local working folder through setup first.');
  runtime.initializeWorkspace({ root: workspace.root });
  return workspace.root;
}

function knownBrand(root, brand) {
  const slug = typeof brand === 'string' ? brand.trim() : '';
  if (!runtime.listBrands({ root }).some(item => item.slug === slug)) throw new InvalidInputError('That brand could not be found.', { fix: 'Use the brand slug from pipeline_status.' });
  return slug;
}

const brandProperty = { ...string, description: 'The brand slug.' };

async function waitFor(promise, ms) {
  let timer;
  try { await Promise.race([promise, new Promise(done => { timer = setTimeout(done, ms); timer.unref?.(); })]); } finally { clearTimeout(timer); }
}

const folderLine = folder => ({ id: folder.id, label: folder.label ?? null, path: folder.path, rights: folder.rights, rightsMeans: RIGHTS_WORDS[folder.rights] });

export const brandFootageTools = [
  defineTool({
    name: 'brand_footage_import',
    description: [
      'Bring a folder of past videos, pictures, audio and fonts into a brand\'s footage library, or carry on with one that is already imported. Use this for a brand\'s archive. A board request to add a folder (brand_folder_add) does the same when it is applied.',
      'Indexing is local and free (no model usage): it lists the files, skips copies of the same content, reads each file\'s length and size, makes a small thumbnail and reads a font file\'s family name from the file itself. The originals are never copied, moved or changed. When the brand kit has no fonts yet, the fonts found go into it (the person still confirms the kit as usual); brand_footage_digest says what else the folders offer.',
      'rights is required and is the person\'s answer about whose footage it is: ours (free to use), client_ask (ask the person before posting anything from it) or never (never use it). Ask the person; never guess. A folder already imported keeps its rights (change them with brand_footage_folder).',
      'A big folder is indexed in batches in the background and the answer says how far it got; the work survives a stop and carries on when you call this again with the same folder, which also picks up files added since.',
      'Returns the folder, how indexing is going (total, processed, added, copies, failed), the footage counts and what is still waiting to be described. Describing the footage is a separate step that uses model usage: do a small first pass only, and ask the person before a full breakdown.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: brandProperty,
        folder: { ...string, description: 'The full path of the folder on this computer.' },
        rights: { type: 'string', enum: RIGHTS, description: 'ours (free to use), client_ask (ask the person before posting) or never (never use). The person\'s answer.' },
        label: { ...string, description: 'A short name for the folder, in the person\'s words, for example "Summer shoot 2024".' },
      },
      required: ['brand', 'folder', 'rights'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const { folder, created, revived, done, outcome } = importAndDigest({ root, brand, folder: args.folder, rights: args.rights, label: args.label ?? null });
      await waitFor(done, WAIT_MS);
      const status = footageStatus({ root, brand });
      const row = status.folders.find(item => item.id === folder.id);
      const state = row?.indexing?.state;
      const going = state === 'running' || state === 'queued';
      const messages = [
        going
          ? `Indexing ${row.indexing.total ? `${row.indexing.total.toLocaleString('en-US')} files` : 'the folder'} in the background. It is local and free, and nothing is copied or changed. Follow it with brand_footage_status, or call this again with the same folder if it stops.`
          : state === 'done' ? `Indexed. ${row.indexing.added.toLocaleString('en-US')} new, ${row.indexing.copies.toLocaleString('en-US')} copies of files already in the library, ${row.indexing.unchanged.toLocaleString('en-US')} already known${row.indexing.failed ? `, ${row.indexing.failed} could not be read` : ''}.`
            : state === 'failed' ? (row.indexing.reason || 'Indexing could not run.')
              : status.message,
      ];
      if (outcome.fonts.added.length) messages.push(`Added ${outcome.fonts.added.join(', ')} to the brand kit's fonts (the person confirms the kit as usual).`);
      if (status.pending.quick) messages.push(`${status.pending.quick.toLocaleString('en-US')} files are not described yet. Describing uses model usage: start with a small first pass (a few files), and ask the person before describing the rest.`);
      return {
        brand, folder: folderLine(folder), created, revived, resumed: !created,
        indexing: row?.indexing ?? null, counts: status.counts, pending: status.pending, fontsAdded: outcome.fonts.added,
        message: messages.join(' '),
      };
    },
  }),
  defineTool({
    name: 'brand_footage_status',
    description: [
      'Read a brand\'s footage library: every imported folder with its rights, how many files it holds, whether indexing is running, stopped or done, and whether the folder is still where it was.',
      'Returns counts (files by kind, described quick and described in full, missing, by rights), pending (files not described yet, and files marked for a full breakdown with their total video length) and a plain message.',
      'A folder that moved shows its files as missing: ask the person for the new place and use brand_footage_folder with action relink. Changes nothing, and costs no model usage.',
    ].join(' '),
    inputSchema: { type: 'object', properties: { brand: brandProperty }, required: ['brand'], additionalProperties: false },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return footageStatus({ root, brand: knownBrand(root, args.brand) });
    },
  }),
  defineTool({
    name: 'brand_footage_search',
    description: [
      'Search a brand\'s footage library, for example to find clips to repurpose: words are matched over file names, folder labels and what was written about each file (product, scene, shot type, mood, what is said and shown). Leave query out to list files, newest analysis first.',
      'Every result carries its rights and a plain note: ours (free to use), client_ask (ask the person before posting it) or never. Files from folders marked never are left out unless rights asks for never or all. Files that cannot be found in their folder are left out and counted: the folder may have moved.',
      'A result gives fileId, name, kind, path (to open the file), length, size, thumbnail, folder, rights, how far it is described (none, quick or full), a short summary and, for a full breakdown, its usable moments with start and end seconds.',
      'Filters: kind (video, image, audio or font; a font result carries its family), rights (ours, client_ask, never or all), analysed (none for files not described yet, quick, full or any), fileId (one file with its whole analysis), limit (20 by default, 100 at most). Free: no model usage.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: brandProperty,
        query: { ...string, description: 'Words to look for, for example "pouring coffee close up".' },
        kind: { type: 'string', enum: FOOTAGE_KINDS },
        rights: { type: 'string', enum: [...RIGHTS, 'all'], description: 'Leave out to get the files that can be used (ours and client_ask). never asks for the never-use files on purpose.' },
        analysed: { type: ['string', 'boolean'], description: 'none (not described yet), quick, full or any. true means any, false means none.' },
        fileId: { ...string, description: 'One file, with its whole analysis.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['brand'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return searchFootage({
        root, brand: knownBrand(root, args.brand), query: args.query ?? null, kind: args.kind ?? null, rights: args.rights ?? null,
        analysed: args.analysed ?? null, fileId: args.fileId ?? null, limit: Number.isInteger(args.limit) ? args.limit : 20,
      });
    },
  }),
  defineTool({
    name: 'brand_footage_analysis_save',
    description: [
      'Keep what you saw in one footage file, after watching it with the video tools (media_extract_frames, media_transcribe, pipeline_video_teardown). Two stages. Saving the same stage again replaces it.',
      'stage quick (the cheap first pass): analysis is { opening (what the first seconds show; for a picture, what is in it), spoken (the first spoken words, if any and if a transcript is available without cost), hook?, style?, products?, mood?, shotTypes?, scenes?, logoVisible? (true when a logo shows), isLogo? (true when the picture is itself a logo) }.',
      'stage full (the whole breakdown, only for files the person marked): analysis is { summary, hook?, style?, scenes: [{ start, end, description, shotType? }], shotTypes?, products?, mood?, onScreenText?, spoken?, usableMoments: [{ start, end, what, why? }], logoVisible?, isLogo? } with start and end in seconds (12.5, or "0:12").',
      'A video\'s full breakdown needs scenes or usable moments with times. A file in a folder marked never is not analysed, and neither is a font file. Returns whether anything changed, how far the file is described now and how many files still wait for a first look.',
      'The hook, style, shot types and on-screen text of a described video (and the style of a picture) also go into the brand\'s bank as the brand\'s own proven items, with the file as their evidence; the answer says which in bank.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: brandProperty,
        fileId: { ...string, description: 'The fileId from brand_footage_search.' },
        stage: { type: 'string', enum: ['quick', 'full'] },
        analysis: { type: 'object', description: 'What you saw, in the shape for the stage.' },
      },
      required: ['brand', 'fileId', 'stage', 'analysis'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const saved = saveAnalysis({ root, brand, fileId: args.fileId, stage: args.stage, analysis: args.analysis });
      // Learning the file's hook, style and so on never fails the save: the analysis is kept either way.
      let bank = { added: [], already: 0 };
      try { bank = feedBank({ root, brand, fileId: args.fileId }); } catch (error) { log.warn('footage analysis could not be fed to the bank', { fileId: args.fileId, error: String(error) }); }
      return { brand: args.brand, ...saved, bank: { added: bank.added, already: bank.already } };
    },
  }),
  defineTool({
    name: 'brand_footage_mark',
    description: [
      'Mark footage files for a full breakdown, because the person picked them (or take the mark off with wantFull false). Marking costs nothing; the breakdown itself uses model usage on every file.',
      'The answer says how many files are marked and waiting and about how long their video runs: tell the person that number and that a full pass uses model usage, and ask before you start. Files from a folder marked never are not marked.',
      'Returns marked, alreadyMarked, unmarked, unknown (ids that are not in the library), skipped, pendingFull and a message.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: brandProperty,
        fileIds: { type: 'array', items: string, minItems: 1, maxItems: 500, description: 'The fileIds from brand_footage_search.' },
        wantFull: { type: 'boolean', description: 'true (the default) marks them for a full breakdown; false takes the mark off.' },
      },
      required: ['brand', 'fileIds'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return { brand: args.brand, ...markForFull({ root, brand: knownBrand(root, args.brand), fileIds: args.fileIds, wantFull: args.wantFull !== false }) };
    },
  }),
  defineTool({
    name: 'brand_footage_folder',
    description: [
      'Change an imported footage folder. action relink: the folder moved, so give its new full path (path); the files are looked for there under the same names, and nothing changes if none of them is found. action rights: change whose footage it is (rights: ours, client_ask or never), only on the person\'s word.',
      'action remove: take the folder out of the footage list (its files on disk are not touched, and what was learned about them returns if it is imported again). Get folderId from brand_footage_status.',
      'Returns the folder and, for relink, how many files were found in the new place.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: brandProperty,
        folderId: { ...string, description: 'The folder id from brand_footage_status.' },
        action: { type: 'string', enum: ['relink', 'rights', 'remove'] },
        path: { ...string, description: 'relink only: the folder\'s new full path.' },
        rights: { type: 'string', enum: RIGHTS, description: 'rights only: the new rights.' },
      },
      required: ['brand', 'folderId', 'action'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const out = changeFolder({ root, brand, folderId: args.folderId, action: args.action, path: args.path ?? null, rights: args.rights ?? null });
      // Footage that can no longer be used takes the bank items learned from it along.
      const bank = out.changed && (args.action === 'rights' || args.action === 'remove') ? reconcileBank({ root, brand }) : { removed: 0 };
      return { brand, action: args.action, ...out, folder: folderLine(out.folder), counts: footageStatus({ root, brand }).counts, ...(bank.removed ? { bankItemsRemoved: bank.removed } : {}) };
    },
  }),
  defineTool({
    name: 'brand_footage_digest',
    description: [
      'Say what a brand\'s imported folders hold and what could go into the brand from them, in plain words: summary (for example "12 videos, 40 photos, 2 fonts: Montserrat, Playfair"), counts, and the offers. Changes nothing, costs no model usage.',
      'fonts: found (every family read from the font files), inKit, added (put into the kit by themselves because it had no fonts) and offer (families the kit does not have, to ask the person about). logos.offer: pictures whose name says logo, or that were seen to be one, for the logo slot (empty when the kit already has a logo). photos.offer: looked-at pictures that are not logos, for "Photos of your world", with room (free places out of 5) and saved (already chosen by the person).',
      'Ask the person before adding any offer, then call brand_footage_adopt. Files in a folder marked never are never offered.',
    ].join(' '),
    inputSchema: { type: 'object', properties: { brand: brandProperty }, required: ['brand'], additionalProperties: false },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      return footageDigest({ root, brand: knownBrand(root, args.brand) });
    },
  }),
  defineTool({
    name: 'brand_footage_adopt',
    description: [
      'Do what the person said yes to from brand_footage_digest, and note what they passed on so it is not offered again. Use it only on their answer.',
      'fonts: family names from the digest, added to the kit\'s fonts (4 at most, none replaced). logoFileId: a picture from logos.offer for the logo slot; refused when the kit has a logo unless replaceLogo is true, which needs the person\'s explicit yes; a big file is made smaller on this computer. photoFileIds: pictures from photos.offer, added to Photos of your world up to the brand\'s 5; the photos the person chose are never replaced.',
      'pass: { fonts?: [family], files?: [fileId] } for what the person said no to. Returns what was added or skipped and a plain message. A file in a folder marked never is refused.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brand: brandProperty,
        fonts: { type: 'array', items: string, maxItems: 8, description: 'Family names to add to the kit\'s fonts.' },
        logoFileId: { ...string, description: 'The fileId of the picture to use as the logo.' },
        replaceLogo: { type: 'boolean', description: 'true only when the person said to replace the logo the kit already has.' },
        photoFileIds: { type: 'array', items: string, maxItems: 5, description: 'The fileIds of pictures to add to Photos of your world.' },
        pass: { type: 'object', description: 'What the person said no to: { fonts?: [family], files?: [fileId] }.' },
      },
      required: ['brand'],
      additionalProperties: false,
    },
    handler: async (args, { workspace }) => {
      const root = local(workspace);
      const brand = knownBrand(root, args.brand);
      const out = await adoptFromFootage({ root, brand, fonts: args.fonts ?? null, logoFileId: args.logoFileId ?? null, replaceLogo: args.replaceLogo === true, photoFileIds: args.photoFileIds ?? null, pass: args.pass ?? null });
      return { brand, ...out };
    },
  }),
];
