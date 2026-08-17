/**
 * What the second reading is asked.
 *
 * The wording carries the whole design, so it is worth being explicit about
 * what it deliberately does *not* say.
 *
 * It never says "you transcribed this page" and never asks whether the earlier
 * reading was right. A model asked to grade its own output agrees with itself,
 * and under SPEC §4 that opinion would be worth nothing anyway. It is asked to
 * **read a place on an image** — a question about pixels, which it can be
 * checked against and can be wrong about in a way the user can see.
 *
 * It never offers the option of writing what the text "should" say. Every
 * answer is either a transcription of what is visibly there or an admission
 * that nothing is. That is the difference between recovering a book and
 * inventing one, and it is enforced by the schema as well as by the words.
 *
 * And it is told what OCR thought *and* what the transcription has, because
 * withholding either would be asking it to find the disagreement rather than
 * settle it — which is slower, costs more, and is the one part of this job
 * already done reliably by something deterministic.
 */
import type { LeafToCheck, SpotToCheck } from './schema'

export function buildAdjudicationSystemPrompt(): string {
  return [
    'You are checking a scanned page of an old book against a transcription of it.',
    '',
    'Two readings of this page disagree in a few places. One is machine OCR,',
    'which is fast and rough: it invents words that are not there, splits words',
    'in two, and reads specks of dirt as letters. The other is a careful',
    'transcription that sometimes skips a line or a clause.',
    '',
    'For each place listed, look at the image and say what is actually printed',
    'there. You are not being asked which reading you prefer or whether either',
    'was reasonable — only what the page shows.',
    '',
    'Rules:',
    '- Answer only from the image. If the image does not settle it, say `unsure`.',
    '- Never write what the text ought to say, or repair spelling, or modernise',
    '  anything. This is a facsimile reprint; the original spelling stands.',
    '- Running heads, page numbers, catchwords and signature marks are page',
    '  furniture. They are set separately and are not part of the text, so if a',
    '  spot is one of those, the answer is `not-there`.',
    '- A caption under a picture belongs to the picture, not to the paragraph',
    '  before it.',
    '- Keep `reading` to the words at that spot. Do not transcribe the page.',
    '- Copy each `id` back exactly as given.'
  ].join('\n')
}

/** One spot, as the prompt states it. */
function describeSpot(spot: SpotToCheck): string {
  const where = spot.after
    ? `after “…${spot.after}”`
    : spot.before
      ? `before “${spot.before}…”`
      : 'somewhere on this page'
  return [
    `[${spot.id}] ${where}`,
    `  OCR read here: “${spot.ocrReading}”`,
    `  The transcription has nothing between those words.`
  ].join('\n')
}

export function buildAdjudicationPrompt(leaf: LeafToCheck): string {
  const parts: string[] = [
    `Page ${leaf.pageIndex + 1} of the scan is attached.`,
    '',
    'The transcription of this page reads:',
    '"""',
    leaf.transcription.trim() || '(nothing was transcribed from this page)',
    '"""',
    '',
    `${leaf.spots.length} place${leaf.spots.length === 1 ? '' : 's'} to check:`,
    ''
  ]
  for (const spot of leaf.spots) parts.push(describeSpot(spot), '')
  parts.push('For each one, say what the page shows there.', 'Answer every id, once each.')
  return parts.join('\n')
}
