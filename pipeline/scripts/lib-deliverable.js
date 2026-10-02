// What kind of thing this job promised, and what kind of thing is actually on disk.
//
// A real run was asked for a TikTok video. The clip quote came back over the brand's ceiling,
// the person chose the still frames, and the run then wrote the deliverable up as a five-image
// photo carousel and carried it all the way to the final gate. Nobody decided that; the run
// did it on its own, and the record made it look like the plan.
//
// The deliverable kind belongs to job.json. A run may fail to make it, and that is a gate.
// A run may never quietly make something else instead, so the comparison lives here and every
// script that verifies what is on disk asks it the same question.

const fs = require('fs');
const path = require('path');
const kinds = require('./lib-kinds.js');

// job.json's own vocabulary already carries the answer, so nothing new has to be stored.
const KIND_OF_DISCIPLINE = {
  ugc: 'video',
  brand_video: 'video',
  motion_graphic: 'video',
  static_image: 'image',
  carousel: 'carousel',
  text_only: 'text',
};

// The words a person reads. No file names, no ids: docs/SHARED-RULES.md.
const WORDS = {
  video: 'a video',
  carousel: 'a set of pictures to swipe through',
  image: 'a single picture',
  text: 'words with no picture',
};

// The 3echo video tool's own limits, from its schema. A beat longer than this splits into two
// clips at a hard cut; it never turns the deliverable into stills. Nothing in this plugin
// treats a short total runtime as too short to be a video: the floor is whatever the job asked
// for in `durationSeconds.min`, and 15 seconds is a perfectly good TikTok.
const CLIP_SECONDS = { min: 4, max: 15 };

const VIDEO_FILE = /\.(mp4|mov|webm|m4v)$/i;
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;

const words = kind => WORDS[kind] || 'something else';
const disciplines = () => Object.keys(KIND_OF_DISCIPLINE);

// The words a run reaches for when it wants to stop paying for video and build something
// from the pictures instead. Seen verbatim on a real job: "build it from the stills, 0
// credits" offered as the recommendation, with slow push-ins, after one clip came back with a
// forearm in it. That is a change of deliverable, and only the person can make it, through
// change-deliverable.js in their own words, never through an option in a question.
const STILLS_OFFER = /\b(from (the )?stills|stills?[- ]based|stills? (instead|only|version)|slide-?show|push-?ins?|ken burns|pan[- ]and[- ]zoom|zero credits|0 credits|no credits|without (spending|generating) (any )?(more )?(credits|video|clips))\b/i;

// The phrase in a question or an option that offers to turn a video into pictures, or null.
function stillsOffer(text) {
  const m = STILLS_OFFER.exec(String(text || ''));
  return m ? m[0] : null;
}

// Whether any deliverable in the job was planned as a video.
function plansVideo(jobSpec) {
  const list = (jobSpec && Array.isArray(jobSpec.deliverables)) ? jobSpec.deliverables : [];
  return list.some(d => d && KIND_OF_DISCIPLINE[d.creativeDiscipline] === 'video');
}

// The kind the job promised for one deliverable, or null when the job never said.
function plannedKind(jobSpec, deliverableId) {
  const list = (jobSpec && Array.isArray(jobSpec.deliverables)) ? jobSpec.deliverables : [];
  const d = list.find(x => x && x.id === deliverableId);
  if (!d) return null;
  return KIND_OF_DISCIPLINE[d.creativeDiscipline] || null;
}

// The shortest runtime the job asked for, in seconds, or null. A video may be short: the
// deliverable says how short, and nothing else gets to decide that a 15 second cut is too
// little to be worth making.
function plannedMinSeconds(jobSpec, deliverableId) {
  const list = (jobSpec && Array.isArray(jobSpec.deliverables)) ? jobSpec.deliverables : [];
  const d = list.find(x => x && x.id === deliverableId);
  const min = d && d.durationSeconds ? Number(d.durationSeconds.min) : NaN;
  return Number.isFinite(min) ? min : null;
}

// The kind that is actually there, read off the draft's own media list.
function actualKind(mediaList) {
  const media = (Array.isArray(mediaList) ? mediaList : (mediaList ? [mediaList] : []))
    .map(String).filter(Boolean);
  if (media.some(f => VIDEO_FILE.test(f))) return 'video';
  const pictures = media.filter(f => IMAGE_FILE.test(f));
  if (pictures.length > 1) return 'carousel';
  if (pictures.length === 1) return 'image';
  return media.length ? 'image' : 'text';
}

// The person's own change, if they made one. Written only by change-deliverable.js, and only
// with their answer in their words, so the record can say who changed it.
function changeRecord(jobSpec, deliverableId) {
  const changes = (jobSpec && Array.isArray(jobSpec.deliverableChanges)) ? jobSpec.deliverableChanges : [];
  return changes.filter(c => c && c.deliverable === deliverableId).pop() || null;
}

// { ok, planned, actual, reason }. `reason` is a sentence a person can read, and it names
// what was asked for and what is there, in that order.
function check(jobSpec, deliverableId, mediaList) {
  const planned = plannedKind(jobSpec, deliverableId);
  const actual = actualKind(mediaList);
  if (!planned) {
    return { ok: true, planned: null, actual, reason: null,
      note: 'the job does not say what kind of post this deliverable is, so nothing could be checked against it' };
  }
  if (planned === actual) return { ok: true, planned, actual, reason: null };
  return {
    ok: false,
    planned,
    actual,
    reason: 'You asked for ' + words(planned) + ', and what is here is ' + words(actual) + '. ' +
      'Only you can change what this job delivers, so this cannot go to a gate until you have said so.',
  };
}

// ---- Post type (placement) -------------------------------------------------------------
//
// Each deliverable carries one fixed post type, chosen at the start of the job: an Instagram
// Reel, a TikTok video. Publishing never offers another type, so the type is decided here,
// once, from the brief. The router, the board and the read path all ask the same questions.

// Which post types each platform has. Anything else is not a post type of that platform.
const PLACEMENTS = Object.freeze({
  instagram: Object.freeze(['post', 'reel', 'story', 'carousel']),
  facebook: Object.freeze(['post', 'reel', 'story']),
  tiktok: Object.freeze(['video', 'photo']),
});

const PLATFORM_NAMES = Object.freeze({ instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' });

// The noun a person uses after the platform: "Instagram Reel", "Instagram post", "TikTok photo post".
const PLACEMENT_NOUNS = Object.freeze({
  post: 'post', reel: 'Reel', story: 'Story', carousel: 'carousel', video: 'video', photo: 'photo post',
});

// The platforms whose deliverables carry a post type.
const placementPlatforms = () => Object.keys(PLACEMENTS);

// Post types that are filmed, so the deliverable has to be a video.
const VIDEO_DISCIPLINES = Object.freeze(['ugc', 'brand_video', 'motion_graphic']);
// Disciplines that make a picture or a clip a story can show.
const STORY_DISCIPLINES = Object.freeze(['static_image', 'ugc', 'brand_video', 'motion_graphic']);
// Disciplines a TikTok photo post is made from.
const PHOTO_DISCIPLINES = Object.freeze(['static_image', 'carousel']);
// Post types that fill a phone screen, so they are 9:16 and nothing else.
const VERTICAL_ONLY = new Set(['reel', 'story', 'video']);

// A carousel is a set of slides, one picture each. The platforms take more than ten on TikTok, but a plan
// stays at ten: three to ten slides on every platform.
const SLIDES = Object.freeze({ min: 3, max: 10 });
const PLATFORM_SLIDE_MAX = Object.freeze({ instagram: 10, facebook: 10, tiktok: 35 });
const slideRange = platform => ({ min: SLIDES.min, max: Math.min(SLIDES.max, PLATFORM_SLIDE_MAX[platform] || SLIDES.max) });

// The order a person hears them in: Reel before post.
const DISPLAY_ORDER = ['reel', 'post', 'story', 'carousel', 'video', 'photo'];
const placementsFor = platform => (Object.hasOwn(PLACEMENTS, platform) ? PLACEMENTS[platform] : []);
const placementBelongs = (platform, placement) => placementsFor(platform).includes(placement);
const allPlacements = () => [...new Set(Object.values(PLACEMENTS).flat())];
const isVerticalOnly = (platform, placement) => placementBelongs(platform, placement) && VERTICAL_ONLY.has(placement);

// A post type is offered to the person only while the discipline it needs can be made, so a
// carousel is offered only while the registry says the agent for it is active.
function offeredIn(registry, platform) {
  const map = (registry && registry.disciplineForCreativeDiscipline) || {};
  const agents = (registry && Array.isArray(registry.agents)) ? registry.agents : [];
  const makeable = discipline => {
    const agent = agents.find(a => a.discipline === map[discipline]);
    return Boolean(agent && agent.status === 'active');
  };
  return placementsFor(platform).filter(placement => placement !== 'carousel' || makeable('carousel'))
    .sort((a, b) => DISPLAY_ORDER.indexOf(a) - DISPLAY_ORDER.indexOf(b));
}
function registrySnapshot() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'registry', 'agents.json'), 'utf8')); }
  catch { return null; }
}
const offeredPlacementsFor = platform => offeredIn(registrySnapshot(), platform);

// "Instagram Reel": the words a person uses for one deliverable. Null when the post type is
// missing or is not one this platform has, so a caller falls back to the platform alone.
function placementWords(platform, placement) {
  if (!placementBelongs(platform, placement)) return null;
  return PLATFORM_NAMES[platform] + ' ' + PLACEMENT_NOUNS[placement];
}

// "Reel, post or Story": the choices for one platform, as a person says them.
function placementChoices(platform, list = offeredPlacementsFor(platform)) {
  return list.map(placement => PLACEMENT_NOUNS[placement]).join(', ').replace(/, ([^,]*)$/, ' or $1');
}

const MEDIA_WORDS = { video: 'video', image: 'image', carousel: 'carousel', text: 'text post' };
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

// How a person points at one deliverable: "the Instagram Reel", or "the second Instagram Reel" when
// the job has several alike. Never an id, and it works for a deliverable that has none.
function describe(jobSpec, d) {
  const list = (jobSpec && Array.isArray(jobSpec.deliverables)) ? jobSpec.deliverables : [];
  // With no post type yet, a deliverable is the platform and what it is made of: "the Instagram video".
  const nameOf = x => placementWords(x.platform, x.placement) || (PLATFORM_NAMES[x.platform] || x.platform || 'this') + ' ' + (MEDIA_WORDS[KIND_OF_DISCIPLINE[x.creativeDiscipline]] || 'post');
  const base = nameOf(d || {});
  const same = list.filter(x => x && typeof x === 'object' && nameOf(x) === base);
  const at = same.indexOf(d);
  if (same.length < 2 || at < 0) return 'the ' + base;
  return 'the ' + (ORDINALS[at] || 'number ' + (at + 1)) + ' ' + base;
}

const isVideoDiscipline = discipline => VIDEO_DISCIPLINES.includes(discipline);
const ratiosOf = d => (d && Array.isArray(d.aspectRatios) ? d.aspectRatios : []);
// A deliverable that never named a ratio takes the one its post type needs, so only a ratio the
// brief did name can disagree with it.
const statesOtherRatio = d => ratiosOf(d).some(ratio => ratio !== '9:16');

// Whether this deliverable ends up as a post on a platform that has post types, and so has to
// say which. A research brief or a report makes no post, a platform this plugin does not publish
// to has no post type to choose, and paid work has its own placements, so only organic and
// organic-and-paid jobs ask.
function asksForPlacement(jobSpec) {
  if (!kinds.makesContent(jobSpec && jobSpec.kind)) return false;
  return !(jobSpec && (jobSpec.kind === 'paid_campaign' || jobSpec.distribution === 'paid'));
}
function publishable(jobSpec, d) {
  if (!d || typeof d !== 'object' || !Object.hasOwn(PLACEMENTS, d.platform)) return false;
  return asksForPlacement(jobSpec);
}

const aOrAn = text => (/^[aeiou]/i.test(text) ? 'an ' : 'a ');

// What the discipline is, for a sentence. An unknown one is "this format", never a guess.
const formatWords = discipline => (Object.hasOwn(KIND_OF_DISCIPLINE, discipline) ? words(KIND_OF_DISCIPLINE[discipline]) : 'this format');

// What is wrong between a deliverable and the post type it names, as sentences a person can
// read, or [] when the two agree. A missing post type is not a problem here: that is a
// question for intake, see missingPlacementLabel. `jobSpec` is only for naming the deliverable.
function placementProblems(d, jobSpec = null) {
  if (!d || typeof d !== 'object' || d.placement === undefined || d.placement === null) return [];
  const options = offeredPlacementsFor(d.platform);
  if (!placementsFor(d.platform).length) return [];
  if (!placementBelongs(d.platform, d.placement)) {
    const name = PLATFORM_NAMES[d.platform] || d.platform;
    return [aOrAn(name) + name + ' post cannot be ' + aOrAn(String(d.placement)) + d.placement + '; choose ' + placementChoices(d.platform, options)];
  }
  const who = jobSpec ? describe(jobSpec, d) : 'the ' + placementWords(d.platform, d.placement);
  const is = ', and it is ' + formatWords(d.creativeDiscipline);
  const problems = [];
  const discipline = d.creativeDiscipline;
  if ((d.placement === 'reel' || (d.platform === 'tiktok' && d.placement === 'video')) && !isVideoDiscipline(discipline)) {
    problems.push(who + ' needs a video' + is);
  }
  if (d.placement === 'story' && !STORY_DISCIPLINES.includes(discipline)) {
    problems.push(who + ' needs a picture or a video' + is);
  }
  if (d.platform === 'tiktok' && d.placement === 'photo' && !PHOTO_DISCIPLINES.includes(discipline)) {
    problems.push(who + ' needs a picture or a set of pictures' + is);
  }
  if (d.platform === 'instagram' && d.placement === 'post' && discipline === 'text_only') {
    problems.push(who + ' needs a picture or a video' + is);
  }
  if (d.placement === 'carousel' && discipline !== 'carousel') {
    problems.push(who + ' needs a set of pictures to swipe through' + is);
  }
  if (VERTICAL_ONLY.has(d.placement) && statesOtherRatio(d)) {
    problems.push(who + ' is 9:16, and it asks for ' + ratiosOf(d).join(' and '));
  }
  return problems;
}

// The router's missingFields entries for post types name the deliverable by its id, or by its
// position when it has none. The path part is what the board maps back to its form; the words in
// brackets are the ones a person reads.
const PLACEMENT_ENTRY = /^deliverables(?:\.([^.\s[\]]+)|\[(\d+)\])\.placement\s*\((.+)\)$/;
const pathOf = (jobSpec, d) => {
  const list = (jobSpec && Array.isArray(jobSpec.deliverables)) ? jobSpec.deliverables : [];
  return d && typeof d.id === 'string' && d.id ? '.' + d.id : '[' + Math.max(0, list.indexOf(d)) + ']';
};
// The words of a router entry, or null when it is not one about a post type.
function placementEntryWords(entry) {
  const hit = PLACEMENT_ENTRY.exec(String(entry || '').trim());
  return hit ? hit[3][0].toUpperCase() + hit[3].slice(1) : null;
}
// Which deliverable an entry is about, as the board names it: its id, or "[index]".
function placementEntryRef(entry) {
  const hit = PLACEMENT_ENTRY.exec(String(entry || '').trim());
  return hit ? (hit[1] || '[' + hit[2] + ']') : null;
}

// The post types this deliverable could be, as it stands: the ones the platform offers that
// placementProblems has nothing against, in the order a person hears them. Its format and its stated
// ratios decide, so a picture is never offered a Reel.
function validPlacementsFor(d) {
  if (!d || typeof d !== 'object') return [];
  const bare = { ...d };
  delete bare.placement;
  return offeredPlacementsFor(d.platform).filter(placement => placementProblems({ ...bare, placement }).length === 0);
}

// What a platform's post types, taken together, are made from.
const PLATFORM_NEEDS = { instagram: 'a picture or a video', tiktok: 'a video, a picture or a set of pictures', facebook: 'a picture, a video or words' };

// The router's missingFields entry for a deliverable with no post type. Usually a question that offers
// only the post types that can be made from it ("post or Story" for an Instagram image). When none can,
// it says what to change instead.
function missingPlacementLabel(d, jobSpec = null) {
  const platformName = PLATFORM_NAMES[d && d.platform] || (d && d.platform) || 'the';
  const who = jobSpec ? describe(jobSpec, d) : 'the ' + platformName + ' one';
  const path = 'deliverables' + pathOf(jobSpec, d) + '.placement';
  const valid = validPlacementsFor(d);
  if (valid.length) return path + ' (which post type is ' + who + ': ' + placementChoices(d && d.platform, valid) + '?)';
  const stated = ratiosOf(d);
  if (stated.length && validPlacementsFor({ ...d, aspectRatios: undefined }).length) {
    return path + ' (' + who + ' is set to ' + stated.join(' and ') + ', which no ' + platformName + ' post type of its kind uses; change the ratio)';
  }
  return path + ' (' + who + ' needs ' + (PLATFORM_NEEDS[d && d.platform] || 'a different format') + '; change the format)';
}

// The router's missingFields entry for a post type that cannot be what the deliverable is.
function placementProblemLabel(d, reason, jobSpec = null) {
  return 'deliverables' + pathOf(jobSpec, d) + '.placement (' + reason + ')';
}

// A deliverable that names a vertical-only post type and no ratio gets the 9:16 that type is.
// Written when the job is made or edited so every later step reads the same thing. A ratio that
// was stated is never replaced here: a conflicting one is the router's question.
function withImpliedRatios(deliverables) {
  if (!Array.isArray(deliverables)) return deliverables;
  let changed = false;
  const next = deliverables.map(d => {
    if (!d || typeof d !== 'object' || !isVerticalOnly(d.platform, d.placement)) return d;
    if (Array.isArray(d.aspectRatios) && d.aspectRatios.length) return d;
    changed = true;
    return { ...d, aspectRatios: ['9:16'] };
  });
  return changed ? next : deliverables;
}

// The post type a deliverable can only be, or null when it could be more than one (or none). It is
// worked out from the rules themselves: of the post types the platform offers, the ones
// placementProblems has nothing against. Exactly one left means nobody needs to be asked: a TikTok
// picture is a photo post, a Facebook text post is a post, a TikTok clip is a video. Two or more
// (an Instagram image is a post or a Story) stay a question, and so does none. One owner decision
// sits on top: an Instagram video that is 9:16 and nothing else is a Reel, though a post or a Story
// would pass the rules too.
function derivePlacement(d) {
  if (!d || typeof d !== 'object') return null;
  if (placementBelongs(d.platform, d.placement)) return d.placement;
  if (d.placement !== undefined && d.placement !== null) return null;
  const ratios = ratiosOf(d);
  // A set of pictures on Instagram is a carousel, though a post would pass the rules too.
  if (d.platform === 'instagram' && d.creativeDiscipline === 'carousel') return 'carousel';
  if (d.platform === 'instagram' && isVideoDiscipline(d.creativeDiscipline) && ratios.length > 0 && ratios.every(ratio => ratio === '9:16')) return 'reel';
  const open = validPlacementsFor(d);
  return open.length === 1 ? open[0] : null;
}

// A copy of the job with each unambiguous missing post type filled in, and the job itself when
// nothing needed filling. Read-side only: the job file on disk is never rewritten by this.
function withDerivedPlacements(jobSpec) {
  const list = jobSpec && Array.isArray(jobSpec.deliverables) ? jobSpec.deliverables : null;
  if (!list) return jobSpec;
  let changed = false;
  const deliverables = list.map(d => {
    if (!d || typeof d !== 'object' || (d.placement !== undefined && d.placement !== null)) return d;
    const derived = derivePlacement(d);
    if (!derived) return d;
    changed = true;
    return { ...d, placement: derived };
  });
  return changed ? { ...jobSpec, deliverables } : jobSpec;
}

module.exports = {
  KIND_OF_DISCIPLINE, WORDS, CLIP_SECONDS, words, disciplines,
  plannedKind, plannedMinSeconds, actualKind, changeRecord, check, stillsOffer, plansVideo,
  SLIDES, slideRange, PLACEMENTS, PLACEMENT_NOUNS, PLATFORM_NAMES, VIDEO_DISCIPLINES, STORY_DISCIPLINES, PHOTO_DISCIPLINES, PLACEMENT_ENTRY,
  placementPlatforms, placementsFor, offeredPlacementsFor, offeredIn, placementBelongs, allPlacements, isVerticalOnly,
  placementWords, placementChoices, describe, publishable, placementProblems, missingPlacementLabel,
  placementProblemLabel, validPlacementsFor, asksForPlacement, placementEntryWords, placementEntryRef, withImpliedRatios, derivePlacement, withDerivedPlacements,
};
