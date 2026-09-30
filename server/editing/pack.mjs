/**
 * The packed transcript: every source's words grouped into phrases, one line per
 * phrase with its time range and a stable id, as one compact text an agent plans
 * an edit from.
 *
 * A phrase breaks at any silence of half a second or more between words, or at a
 * change of speaker. Phrase ids are `<source id>.<n>`, numbered from 1 in time
 * order within the source, and sources are numbered S1, S2 and so on in the order
 * the assets were asked for, so the same transcripts always pack to the same text
 * and an id cited in an edit decision list keeps meaning the same words.
 *
 * Sources are library assets rather than a folder of Scribe files, segment level
 * transcripts are packed one phrase per segment when no word timings exist, and
 * every phrase carries an id.
 */

import { spokenWords } from './transcripts.mjs';

/** Silence, in seconds, that ends a phrase. */
export const PHRASE_SILENCE_S = 0.5;

/**
 * @typedef {object} Phrase
 * @property {string} id for example S1.3
 * @property {string} source_id
 * @property {number} start_s
 * @property {number} end_s
 * @property {string} text
 * @property {string|null} speaker
 */

/**
 * @typedef {object} PackSource
 * @property {string} source_id
 * @property {string|null} asset_id
 * @property {string} filename
 * @property {number|null} duration_s
 * @property {import('./transcripts.mjs').Transcript|null} transcript
 */

/**
 * Two decimals, which is word boundary precision for an edit.
 * @param {number} seconds
 * @returns {string}
 */
export function formatSeconds(seconds) {
  return (Math.round(Number(seconds) * 100) / 100).toFixed(2);
}

/**
 * Join word texts the way they were spoken: a space between words, none before
 * punctuation, and audio events in brackets.
 * @param {import('./transcripts.mjs').Word[]} words
 * @returns {string}
 */
function joinWords(words) {
  return words
    .map((word) => (word.type === 'audio_event' && !word.text.startsWith('(') ? `(${word.text})` : word.text))
    .join(' ')
    .replace(/\s+([,.?!;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Group words into phrases, breaking on a silence of at least `threshold` seconds
 * or a change of speaker. Spacing entries only ever end a phrase.
 * @param {import('./transcripts.mjs').Word[]} words
 * @param {number} [threshold]
 * @returns {Array<{start_s: number, end_s: number, text: string, speaker: string|null}>}
 */
export function groupIntoPhrases(words, threshold = PHRASE_SILENCE_S) {
  /** @type {Array<{start_s: number, end_s: number, text: string, speaker: string|null}>} */
  const phrases = [];
  /** @type {import('./transcripts.mjs').Word[]} */
  let current = [];
  /** @type {number|null} */
  let previousEnd = null;

  const flush = () => {
    const text = joinWords(current);
    if (text) {
      phrases.push({
        start_s: current[0].start_s,
        end_s: current[current.length - 1].end_s,
        text,
        speaker: current[0].speaker,
      });
    }
    current = [];
  };

  for (const word of words) {
    if (word.type === 'spacing') {
      if (word.end_s - word.start_s >= threshold) flush();
      continue;
    }
    const speakerChanged =
      current.length > 0 && current[0].speaker !== null && word.speaker !== null && word.speaker !== current[0].speaker;
    const longGap = previousEnd !== null && word.start_s - previousEnd >= threshold;
    if (speakerChanged || longGap) flush();
    current.push(word);
    previousEnd = word.end_s;
  }
  flush();
  return phrases;
}

/**
 * The phrases of one source, from word timings when there are any and from the
 * transcript segments otherwise.
 * @param {string} sourceId
 * @param {import('./transcripts.mjs').Transcript|null} transcript
 * @param {number} [threshold]
 * @returns {Phrase[]}
 */
export function phrasesFor(sourceId, transcript, threshold = PHRASE_SILENCE_S) {
  if (!transcript) return [];
  const words = spokenWords(transcript);
  const grouped =
    words.length > 0
      ? groupIntoPhrases(transcript.words, threshold)
      : transcript.segments.map((segment) => ({
          start_s: segment.start_s,
          end_s: segment.end_s,
          text: segment.text.replace(/\s+/g, ' ').trim(),
          speaker: segment.speaker,
        }));
  return grouped.map((phrase, index) => ({
    id: `${sourceId}.${index + 1}`,
    source_id: sourceId,
    start_s: Math.round(phrase.start_s * 1000) / 1000,
    end_s: Math.round(phrase.end_s * 1000) / 1000,
    text: phrase.text,
    speaker: phrase.speaker,
  }));
}

/**
 * A speaker label that reads well: Scribe's `speaker_0` becomes `speaker 0`.
 * @param {string} speaker
 * @returns {string}
 */
function speakerLabel(speaker) {
  return speaker.replace(/^speaker_/, 'speaker ');
}

/**
 * Pack several sources into one text.
 * @param {PackSource[]} sources in the order they should appear
 * @param {{threshold?: number}} [options]
 * @returns {{text: string, phrases: Phrase[]}}
 */
export function packTranscripts(sources, options = {}) {
  const threshold = Number(options.threshold) > 0 ? Number(options.threshold) : PHRASE_SILENCE_S;
  /** @type {Phrase[]} */
  const all = [];
  const lines = [
    '# Packed transcript',
    '',
    `Phrases break at a silence of ${threshold.toFixed(1)} seconds or more, or a change of speaker.`,
    'Cite a phrase by its id, for example S1.3, and cut with the times in brackets.',
    '',
  ];
  for (const source of sources) {
    const phrases = phrasesFor(source.source_id, source.transcript, threshold);
    all.push(...phrases);
    const facts = [
      source.duration_s == null ? null : `${formatSeconds(source.duration_s)} s`,
      source.transcript ? `${phrases.length} phrase${phrases.length === 1 ? '' : 's'}` : 'no transcript saved',
      source.transcript && spokenWords(source.transcript).length === 0 ? 'segment timings only' : null,
      source.asset_id ? `asset ${source.asset_id}` : null,
    ].filter(Boolean);
    lines.push(`## ${source.source_id} ${source.filename} (${facts.join(', ')})`);
    if (source.transcript && phrases.length === 0) lines.push('no speech in the transcript');
    for (const phrase of phrases) {
      const speaker = phrase.speaker ? `${speakerLabel(phrase.speaker)}: ` : '';
      lines.push(`${phrase.id} [${formatSeconds(phrase.start_s)}-${formatSeconds(phrase.end_s)}] ${speaker}${phrase.text}`);
    }
    lines.push('');
  }
  return { text: `${lines.join('\n').trimEnd()}\n`, phrases: all };
}
