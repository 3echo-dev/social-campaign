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

module.exports = {
  KIND_OF_DISCIPLINE, WORDS, CLIP_SECONDS, words, disciplines,
  plannedKind, plannedMinSeconds, actualKind, changeRecord, check, stillsOffer, plansVideo,
};
