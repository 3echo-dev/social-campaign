/**
 * The capability registry.
 *
 * Agents depend on capability names, never on vendor names. This file is the single
 * list of capabilities from registry section 3 together with how each one is
 * resolved. Swapping a provider means editing the provider field here and nothing
 * else.
 *
 * Every capability resolves to one of the five states in registry section 4:
 *   ready, not_connected, unavailable, degraded, not_needed.
 */

/**
 * @typedef {'ready'|'not_connected'|'unavailable'|'degraded'|'not_needed'} CapabilityState
 */

/**
 * @typedef {object} CapabilityDefinition
 * @property {string} name
 * @property {string} purpose
 * @property {string} provider the MVP implementation, in user facing words.
 * @property {'core'|'ffmpeg'|'ffprobe'|'ytdlp'|'claude'|'threeecho'|'elevenlabs'|'social'} resolver
 * @property {'none'|'low'|'medium'|'high'|'external'} risk
 */

/** @type {CapabilityDefinition[]} */
export const CAPABILITIES = [
  { name: 'workspace.status', purpose: 'Check workspace health', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'workspace.read', purpose: 'Read workspace and indexes', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'workspace.write', purpose: 'Write structured artifacts', provider: 'Social Campaign', resolver: 'core', risk: 'none' },

  { name: 'memory.brand.read', purpose: 'Retrieve brand identity and profile', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'memory.brand.propose', purpose: 'Propose brand memory updates', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'memory.creative.read', purpose: 'Search creative intelligence', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'memory.creative.propose', purpose: 'Propose creative memory updates', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'memory.preference.read', purpose: 'Retrieve preference evidence', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'memory.preference.record', purpose: 'Record preference evidence', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'memory.competitor.read', purpose: 'Retrieve competitor intelligence', provider: 'Social Campaign', resolver: 'core', risk: 'none' },

  { name: 'web.search', purpose: 'Search the public web', provider: 'Claude web search', resolver: 'claude', risk: 'low' },
  { name: 'web.fetch', purpose: 'Read sites and pages', provider: 'Claude web fetch and the built in page reader', resolver: 'social', risk: 'low' },

  { name: 'social.inspect_post', purpose: 'Inspect a public post, ad or reference', provider: 'Public pages and yt-dlp, with web evidence plans', resolver: 'social', risk: 'medium' },
  { name: 'social.inspect_account', purpose: 'Inspect a public social account', provider: 'Public pages and yt-dlp, with web evidence plans', resolver: 'social', risk: 'medium' },
  { name: 'social.search_content', purpose: 'Discover relevant social content', provider: 'Public pages and yt-dlp, with web evidence plans', resolver: 'social', risk: 'medium' },
  { name: 'ads.research', purpose: 'Inspect paid creative and ad libraries', provider: 'Public ad libraries, with web evidence plans', resolver: 'social', risk: 'medium' },
  { name: 'research.browser', purpose: 'Render JavaScript pages for research the other backends could not read', provider: 'A local Python worker over crawl4ai and Playwright Chromium', resolver: 'research_browser', risk: 'medium' },

  { name: 'media.probe', purpose: 'Duration, codec, resolution, fps, audio', provider: 'FFprobe', resolver: 'ffprobe', risk: 'none' },
  { name: 'media.extract_frames', purpose: 'Key and representative frames', provider: 'FFmpeg', resolver: 'ffmpeg', risk: 'none' },
  { name: 'media.extract_audio', purpose: 'Extract the audio track', provider: 'FFmpeg', resolver: 'ffmpeg', risk: 'none' },
  { name: 'media.transcribe', purpose: 'Transcript and timestamps', provider: 'Saved transcripts and platform captions', resolver: 'ytdlp', risk: 'low' },
  { name: 'media.image_analyze', purpose: 'Analyze image creative', provider: 'Claude vision', resolver: 'claude', risk: 'low' },
  { name: 'media.video_analyze', purpose: 'Analyze metadata, frames and transcript', provider: 'Video watch over FFmpeg', resolver: 'ffmpeg', risk: 'low' },
  { name: 'media.edit', purpose: 'Pack transcripts, view timelines, cut, render and verify edits', provider: 'FFmpeg and FFprobe', resolver: 'ffmpeg', risk: 'none' },

  { name: 'creative.asset_search', purpose: 'Search indexed creative assets', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'creative.reference_get', purpose: 'Retrieve the priority reference', provider: 'Social Campaign', resolver: 'core', risk: 'none' },

  { name: 'generation.image', purpose: 'Generate image creative', provider: '3echo Studio', resolver: 'threeecho', risk: 'high' },
  { name: 'generation.video', purpose: 'Generate video creative', provider: '3echo Studio', resolver: 'threeecho', risk: 'high' },
  { name: 'generation.voice', purpose: 'Voiceover and text to speech', provider: 'ElevenLabs', resolver: 'elevenlabs', risk: 'high' },
  { name: 'generation.audio', purpose: 'Sound effects and music', provider: 'ElevenLabs', resolver: 'elevenlabs', risk: 'high' },
  { name: 'generation.subtitle', purpose: 'Subtitle timing and files', provider: 'Transcripts or the approved script, plus the local subtitle writer', resolver: 'ffmpeg', risk: 'medium' },
  { name: 'generation.remotion', purpose: 'Final edit and composition', provider: 'Local renderer', resolver: 'ffmpeg', risk: 'medium' },

  { name: 'review.strategy', purpose: 'Human strategy approval', provider: 'Social Campaign board', resolver: 'core', risk: 'none' },
  { name: 'review.concept', purpose: 'Human concept and copy approval', provider: 'Social Campaign board', resolver: 'core', risk: 'none' },
  { name: 'review.cost', purpose: 'Human spend approval', provider: 'Social Campaign board', resolver: 'core', risk: 'none' },
  { name: 'review.media', purpose: 'Human media approval', provider: 'Social Campaign board', resolver: 'core', risk: 'none' },
  { name: 'review.final', purpose: 'Final approval before publish or export', provider: 'Social Campaign board', resolver: 'core', risk: 'none' },

  { name: 'workflow.plan', purpose: 'Build the execution plan', provider: 'Job Planner', resolver: 'core', risk: 'none' },
  { name: 'workflow.state', purpose: 'Store and advance job state', provider: 'Social Campaign', resolver: 'core', risk: 'none' },
  { name: 'workflow.method', purpose: 'Load a methodology skill', provider: 'Claude skills', resolver: 'claude', risk: 'none' },
];

/**
 * The provider key each resolver reads out of integrations.json.
 * @type {Record<string, string|null>}
 */
export const RESOLVER_PROVIDER_KEY = {
  core: null,
  ffmpeg: null,
  ffprobe: null,
  ytdlp: null,
  claude: null,
  threeecho: 'threeecho_studio',
  elevenlabs: 'elevenlabs',
  social: null,
};

/**
 * The connection rows the doctor shows, in user facing language.
 * @type {Array<{key: string, label: string, provider: string, capabilities: string[]}>}
 */
export const CONNECTION_ROWS = [
  {
    key: 'threeecho_studio',
    label: 'Image & Video',
    provider: '3echo Studio',
    capabilities: ['generation.image', 'generation.video'],
  },
  {
    key: 'elevenlabs',
    label: 'Voice & Audio',
    provider: 'ElevenLabs',
    capabilities: ['generation.voice', 'generation.audio'],
  },
];
