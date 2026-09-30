/**
 * Degraded mode publishing: export a hand-postable package to
 * <workspace>/outputs/<campaign_id>/ when no publisher provider is connected.
 *
 * Always succeeds as long as the campaign has a CopyPackage artifact (spec sections
 * 32/36); media and a schedule are included when present but are not required.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, basename } from 'node:path';

import { nowIso } from '../lib/ids.mjs';
import { resolveWorkspacePath as resolveReleasePath } from '../release/package.mjs';
import { writeJsonFile } from '../lib/json.mjs';
import { UserFacingError } from '../lib/errors.mjs';
import { currentArtifact } from '../artifacts/refs.mjs';

const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

/**
 * @param {string} root workspace root.
 * @param {string} path a path as stored on an artifact, absolute or workspace-relative.
 * @returns {string}
 */
function resolveWorkspacePath(root, path) {
  return isAbsolute(path) ? path : join(root, path);
}

/**
 * Build the caption block for one platform's post file.
 * @param {any} variant CopyPackage variant.
 * @param {string[]} mediaFiles filenames already copied for this platform.
 * @param {string|null} scheduleNote
 * @returns {string}
 */
function postMarkdown(variant, mediaFiles, scheduleNote) {
  const hashtags = Array.isArray(variant.hashtags) ? variant.hashtags.join(' ') : '';
  const lines = [
    `# ${PLATFORM_LABEL[variant.platform] ?? variant.platform}`,
    '',
    '## Caption',
    '',
    variant.caption ?? '',
    '',
  ];
  if (hashtags) lines.push('## Hashtags', '', hashtags, '');
  if (variant.first_comment) lines.push('## First comment', '', variant.first_comment, '');
  lines.push('## Suggested schedule', '', scheduleNote ?? 'Not scheduled; post when ready.', '');
  if (mediaFiles.length > 0) {
    lines.push('## Media files', '', ...mediaFiles.map((name) => `- ${name}`), '');
  } else {
    lines.push('## Media files', '', '(none)', '');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {object} args
 * @param {string} args.campaign_id
 * @param {import('../workspace/index.mjs').Workspace} args.workspace
 * @param {Array<any>} [args.posts] the approved release's posts. When given, this is
 *   exactly what is written out: one file per post with that post's own caption and
 *   its one approved asset, rather than every asset offered to every platform.
 * @returns {{export_path: string, platforms: string[], files: string[]}}
 */
export function exportPackage({ campaign_id, workspace, posts }) {
  const db = workspace.requireDb();
  const root = workspace.requireRoot();

  if (Array.isArray(posts) && posts.length > 0) {
    return exportReleasePosts({ campaign_id, root, posts });
  }

  const copyPackage = currentArtifact(db, campaign_id, 'CopyPackage')?.json ?? null;
  if (!copyPackage) {
    throw new UserFacingError('This campaign has no copy to export yet.', {
      fix: 'Write and approve the copy for this campaign before exporting.',
    });
  }

  const mediaPackage = currentArtifact(db, campaign_id, 'GeneratedMediaPackage')?.json ?? null;
  const assetsByPlatform = new Map();
  if (mediaPackage && Array.isArray(mediaPackage.assets)) {
    for (const asset of mediaPackage.assets) {
      // No per-asset platform in the schema, so every asset is offered to every
      // platform's post file; a user picks which ones apply when posting by hand.
      for (const platform of ['facebook', 'instagram', 'tiktok']) {
        if (!assetsByPlatform.has(platform)) assetsByPlatform.set(platform, []);
        assetsByPlatform.get(platform).push(asset);
      }
    }
  }

  const finalRow = db
    .prepare("SELECT payload FROM reviews WHERE campaign_id = ? AND kind = 'final' AND status = 'resolved' ORDER BY resolved_at DESC LIMIT 1")
    .get(campaign_id);
  const finalPayload = finalRow ? JSON.parse(String(finalRow.payload ?? '{}')) : null;

  const outDir = join(root, 'outputs', campaign_id);
  const postsDir = join(outDir, 'posts');
  const mediaDir = join(outDir, 'media');
  mkdirSync(postsDir, { recursive: true });
  mkdirSync(mediaDir, { recursive: true });

  const variants = Array.isArray(copyPackage.variants) ? copyPackage.variants : [];
  const platforms = [];
  const files = [];
  const readmeSections = [];

  for (const variant of variants) {
    const platform = variant.platform;
    if (!platform) continue;
    platforms.push(platform);

    const assets = assetsByPlatform.get(platform) ?? [];
    const mediaFiles = [];
    for (const asset of assets) {
      if (!asset.path) continue;
      const sourcePath = resolveWorkspacePath(root, asset.path);
      if (!existsSync(sourcePath)) continue;
      const destName = `${platform}-${basename(sourcePath)}`;
      copyFileSync(sourcePath, join(mediaDir, destName));
      mediaFiles.push(destName);
      files.push(join('media', destName));
    }

    const scheduleNote = finalPayload && finalPayload.payload && finalPayload.payload.schedule
      ? String(finalPayload.payload.schedule)
      : null;
    const postFile = join(postsDir, `${platform}.md`);
    writeMarkdown(postFile, postMarkdown(variant, mediaFiles, scheduleNote));
    files.push(join('posts', `${platform}.md`));

    readmeSections.push(readmeSection(platform, mediaFiles));
  }

  writeMarkdown(join(outDir, 'README.md'), readmeDocument(readmeSections));
  files.push('README.md');

  const manifest = {
    campaign_id,
    generated_at: nowIso(),
    platforms,
    files,
  };
  writeJsonFile(join(outDir, 'manifest.json'), manifest);
  files.push('manifest.json');

  return { export_path: outDir, platforms, files };
}

/**
 * @param {string} path
 * @param {string} content
 */
function writeMarkdown(path, content) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/**
 * The README section that walks someone through posting one platform by hand.
 * @param {string} platform
 * @param {string[]} mediaFiles
 * @returns {string}
 */
function readmeSection(platform, mediaFiles) {
  const label = PLATFORM_LABEL[platform] ?? platform;
  const lines = [
    `### ${label}`,
    '',
    `1. Open \`posts/${platform}.md\` for the caption, hashtags and schedule time.`,
    `2. Open the app for ${label} and start a new post.`,
    mediaFiles.length > 0
      ? `3. Attach the media file(s) in \`media/\`: ${mediaFiles.join(', ')}.`
      : '3. This post has no media to attach.',
    '4. Paste the caption and hashtags, then post or schedule it.',
    '',
  ];
  return lines.join('\n');
}

/**
 * @param {string[]} sections
 * @returns {string}
 */
function readmeDocument(sections) {
  return [
    '# Publishing package',
    '',
    'This folder has everything needed to post this campaign by hand, one platform at a time.',
    '',
    ...sections,
    `Generated ${nowIso()}.`,
    '',
  ].join('\n');
}

/**
 * Write out an approved release: one post file per release post, with that post's own
 * caption, hashtags, first comment, schedule and its single approved file.
 * @param {object} args
 * @param {string} args.campaign_id
 * @param {string} args.root
 * @param {Array<any>} args.posts
 * @returns {{export_path: string, platforms: string[], files: string[]}}
 */
function exportReleasePosts({ campaign_id, root, posts }) {
  const outDir = join(root, 'outputs', campaign_id);
  const postsDir = join(outDir, 'posts');
  const mediaDir = join(outDir, 'media');
  mkdirSync(postsDir, { recursive: true });
  mkdirSync(mediaDir, { recursive: true });

  const platforms = [];
  const files = [];
  const readmeSections = [];

  for (const post of posts) {
    const platform = String(post.platform);
    platforms.push(platform);
    const mediaFiles = [];
    if (post.asset_path) {
      const sourcePath = resolveReleasePath(root, String(post.asset_path));
      if (existsSync(sourcePath)) {
        const destName = `${platform}-${basename(sourcePath)}`;
        copyFileSync(sourcePath, join(mediaDir, destName));
        mediaFiles.push(destName);
        files.push(join('media', destName));
      }
    }
    const postFile = join(postsDir, `${platform}.md`);
    writeMarkdown(
      postFile,
      postMarkdown(
        { platform, caption: post.caption, hashtags: post.hashtags, first_comment: post.first_comment },
        mediaFiles,
        post.scheduled_at ? String(post.scheduled_at) : null,
      ),
    );
    files.push(join('posts', `${platform}.md`));

    readmeSections.push(readmeSection(platform, mediaFiles));
  }

  writeMarkdown(join(outDir, 'README.md'), readmeDocument(readmeSections));
  files.push('README.md');

  writeJsonFile(join(outDir, 'manifest.json'), { campaign_id, generated_at: nowIso(), platforms, files });
  files.push('manifest.json');

  return { export_path: outDir, platforms, files };
}
