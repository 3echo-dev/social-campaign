// The one card that asks for a photo of the product, and the words on it.
//
// A job that makes any media cannot be planned without one: the storyboard never draws the
// product from a description, and finding that out at the storyboard stage wastes a whole
// run. The router refuses without it (rule 6c).
//
// Until now the only way to satisfy that was to find a folder on your own machine and drop
// a file in it, and the run printed a Windows path at somebody sitting in front of a web
// page. This is the same ask somewhere they can act on it: an area to drop a photo onto,
// and the two named ways on for anybody who has no photo to hand.
//
// The wording lives here rather than in a skill so that every route asks in the same words,
// and so the thing that spends money says what it costs on the card itself.

/** The question id, and so the key the answer and the picture's address come back under. */
const QUESTION_ID = 'product-photo';

/** What the person answered when they attached a picture rather than picking a way out. */
const UPLOADED = 'uploaded';

/** Where the address of the attached picture arrives, beside the answer itself. */
const fileKey = id => id + ' file';

/** Where they may say the thing the options got wrong: "the 230ml bottle, not the 75ml". */
const noteKey = id => id + ' note';

/**
 * The batch, ready for ask.js. One question: everything else can wait until there is
 * something to draw.
 */
function question(productName) {
  const thing = productName ? String(productName).trim() : '';
  return {
    id: QUESTION_ID,
    // Not "drag a photo in" here: the area underneath says that in its own words, and a
    // card that says the same thing twice a hundred pixels apart reads as a mistake.
    text: thing
      ? 'Can I see ' + thing + '?'
      : 'Can I see the product?',
    kind: 'upload',
    options: [
      {
        id: 'find-online',
        label: 'Find one online',
        hint: 'I look for an official picture of it and show you what I found before I use it. ' +
              'It stays somebody else\'s picture, and it is recorded that way.',
      },
      {
        id: 'make-one',
        label: 'Make one',
        hint: 'I generate a product shot. That costs credits: I will tell you the number and ' +
              'wait for your yes before anything is spent.',
      },
    ],
    // Options are a guess. "It is the 230ml bottle, not the 75ml" has no pill to click.
    note: true,
  };
}

const questions = productName => [question(productName)];

const TITLE = 'A photo of the product';

/**
 * What an answer to that card means, in one shape the run can act on.
 *
 * `kind` is what to do next: `landed` fetch the picture at `url` and record it as the
 * brand's own, `find-online` go and look, `make-one` quote and wait for a yes.
 * `note` is whatever they said in their own words, and is read before anything else.
 */
function readAnswer(answers) {
  const map = answers && typeof answers === 'object' ? answers : {};
  const chosen = map[QUESTION_ID];
  const note = typeof map[noteKey(QUESTION_ID)] === 'string' ? map[noteKey(QUESTION_ID)] : null;
  if (chosen === UPLOADED) {
    const url = map[fileKey(QUESTION_ID)];
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return { kind: 'landed', url, note };
    // The card cannot send this, but an answer typed in the chat can, and a run acting on
    // "uploaded" with nothing to fetch would record a product photo that does not exist.
    return { kind: 'none', note, reason: 'the picture did not come with an address' };
  }
  if (chosen === 'find-online' || chosen === 'make-one') return { kind: chosen, note };
  return { kind: 'none', note };
}

module.exports = { QUESTION_ID, UPLOADED, TITLE, fileKey, noteKey, question, questions, readAnswer };
