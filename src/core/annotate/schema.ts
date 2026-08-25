/**
 * What the annotation pass returns, and how it is checked before anyone sees it.
 *
 * Two problems have to be solved here, and neither is solved by trusting the
 * reply:
 *
 * 1. **Where the note goes.** The note machinery locates a note by a character
 *    offset into a block. A model cannot count characters reliably, so it is
 *    never asked to: it quotes the words the note hangs on, and the offset is
 *    *found* here. A quotation that cannot be found in the block is reported as
 *    unplaced rather than attached at a guessed position, because a note
 *    pointing at the wrong sentence is worse than one the user has to place.
 *
 * 2. **Whether the note is true.** A note goes out over the editor's name and
 *    makes claims the book itself does not make. Nothing here can verify a fact
 *    — but it can say precisely *which* words are facts the book never supplied,
 *    which turns "check the notes" into a short list of dates, names and figures
 *    to check. That is a deterministic comparison against the source text, not
 *    the model's opinion of its own work, which is the only kind of flag SPEC §4
 *    allows to mean anything.
 *
 * Pure: text in, proposals and findings out.
 */
import { FACT_ITEM_SCHEMA } from '@core/harvest'
import { parseInlineMarkup } from '@core/transcribe'
import { ANNOTATION_KINDS, type AnnotationKind } from './voice'

/** One note the pass suggests, before anybody has approved it. */
export interface AnnotationProposal {
  /** The block this note belongs in, named by the id assembly gave it. */
  blockId: string
  /**
   * The exact words from the block that the note hangs on.
   *
   * Quoted rather than located by index, because the quote can be checked and
   * an index cannot. This is also what the review screen shows the user, so it
   * doubles as the evidence for the note.
   */
  anchorText: string
  kind: AnnotationKind
  /** The note itself, in the editor's voice. */
  text: string
  /** Why this earned a note, for the review screen. One short clause. */
  reason: string
}

/** A proposal that has been located in the book, and checked. */
export interface CheckedProposal extends AnnotationProposal {
  /**
   * Character offset into the block's text where the mark goes, or null when
   * the quoted words were not found there.
   */
  at: number | null
  /**
   * Words in the note asserting something the book never says — dates, figures,
   * and names the source passage does not contain.
   *
   * Not a claim that any of them is wrong. It is the list of things only a
   * human can confirm, so the review screen can point at them instead of asking
   * the user to re-read every note in full.
   */
  outsideClaims: string[]
}

export const ANNOTATION_SCHEMA = {
  type: 'object',
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          blockId: { type: 'string' },
          anchorText: { type: 'string' },
          kind: { type: 'string', enum: [...ANNOTATION_KINDS] },
          text: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['blockId', 'anchorText', 'kind', 'text', 'reason'],
        additionalProperties: false
      }
    },
    // The harvest rides this reply when it is wanted. One request produces the
    // notes for the page and the entries for the bank, so the reading — the
    // expensive half — is paid for once.
    facts: { type: 'array', items: FACT_ITEM_SCHEMA }
  },
  required: ['notes'],
  additionalProperties: false
} as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validate a reply.
 *
 * Unlike a page transcription, a malformed *note* is not worth failing a run
 * over: the transcription is the book, and half of one is a book with holes,
 * whereas a note that arrives unusable is one suggestion missing from a list of
 * suggestions the user is about to go through anyway. So bad entries are
 * dropped and the good ones kept, and only a reply with no notes array at all
 * is an error.
 */
export function parseAnnotations(
  raw: unknown,
  knownBlockIds: ReadonlySet<string>
): {
  proposals: AnnotationProposal[]
  discarded: number
} {
  if (!isRecord(raw) || !Array.isArray(raw['notes'])) {
    throw new Error('The reply did not contain a list of notes')
  }

  const proposals: AnnotationProposal[] = []
  let discarded = 0

  for (const entry of raw['notes']) {
    if (!isRecord(entry)) {
      discarded += 1
      continue
    }
    const blockId = typeof entry['blockId'] === 'string' ? entry['blockId'] : ''
    const anchorText = typeof entry['anchorText'] === 'string' ? entry['anchorText'].trim() : ''
    const text = typeof entry['text'] === 'string' ? entry['text'].trim() : ''
    const kind = entry['kind']

    // A note naming a block that is not in this chunk cannot be placed and is
    // usually a sign the model has invented an id rather than quoted one.
    if (!blockId || !knownBlockIds.has(blockId) || !anchorText || !text) {
      discarded += 1
      continue
    }

    proposals.push({
      blockId,
      anchorText,
      kind: ANNOTATION_KINDS.includes(kind as AnnotationKind)
        ? (kind as AnnotationKind)
        : 'context',
      text,
      reason: typeof entry['reason'] === 'string' ? entry['reason'].trim() : ''
    })
  }

  return { proposals, discarded }
}

/** Collapse whitespace so a quote spanning a line break still matches. */
function loosen(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * Find where a quoted phrase sits in a block, in the block's own coordinates.
 *
 * The note's mark goes *after* the phrase it refers to, the way a printer sets
 * one, so the offset returned is the end of the match.
 *
 * Matching is done on a whitespace-collapsed copy and mapped back, because the
 * text handed to the model has already been reflowed and a quotation that
 * crossed a line break in the original would otherwise never match. Returns
 * null rather than a guess when the phrase is not there.
 */
export function findAnchor(blockText: string, anchorText: string): number | null {
  const needle = loosen(anchorText)
  if (!needle) return null

  // Walk the source once, building the collapsed form and remembering where
  // each collapsed character came from. One pass, and no arithmetic to get
  // wrong on the way back.
  const map: number[] = []
  let collapsed = ''
  let inSpace = false
  for (let i = 0; i < blockText.length; i++) {
    const ch = blockText[i]!
    if (/\s/u.test(ch)) {
      if (collapsed.length > 0 && !inSpace) {
        collapsed += ' '
        map.push(i)
      }
      inSpace = true
      continue
    }
    inSpace = false
    collapsed += ch
    map.push(i)
  }

  let at = collapsed.indexOf(needle)
  if (at === -1) {
    // A quote the model tidied — case changed, or a long-s normalised. One
    // case-insensitive retry, and no fuzzier than that: a loose match that
    // lands on the wrong sentence is the failure this function exists to avoid.
    at = collapsed.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
    if (at === -1) return null
  }

  const endCollapsed = at + needle.length - 1
  const endSource = map[endCollapsed]
  return endSource === undefined ? null : endSource + 1
}

/**
 * Dates, quantities and proper names — the assertions worth checking.
 *
 * Capitalised words are taken as names, except at the start of a sentence where
 * capitalisation says nothing. Numbers are taken whole, so "1665" and "1,204"
 * each come out as one claim rather than as digits.
 */
function claimsIn(raw: string): string[] {
  // Inline markup is notation, not prose, and it corrupts both halves of this.
  // A title comes out as `Doctrine</i` rather than `Doctrine`, which is junk in
  // the list a person has to read — and worse, the mangled token can never
  // match the book, so a title the book *does* name is reported as an outside
  // claim. `<b>Aerolite.</b>` breaks the sentence splitter for the same reason
  // it broke the audit's: the full stop is followed by `<` and not a space, so
  // the next word is no longer sentence-initial and its capital is read as a
  // name. Stripped through the parser the book is set from, so this sees the
  // words a reader will.
  const text = parseInlineMarkup(raw).text
  const claims: string[] = []

  for (const match of text.matchAll(/\d[\d,.]*/gu)) {
    claims.push(match[0].replace(/[.,]$/u, ''))
  }

  // Sentence-initial capitals say nothing about whether a word is a name, so
  // the first word after a full stop is skipped.
  const sentences = text.split(/(?<=[.!?])\s+/u)
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/u)
    words.forEach((word, i) => {
      const bare = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
      if (i === 0 || bare.length < 2) return
      if (/^\p{Lu}/u.test(bare)) claims.push(bare)
    })
  }

  return [...new Set(claims)]
}

/**
 * Which of a note's assertions the book itself never made.
 *
 * The comparison is against the passage the note annotates *and* the book's own
 * wider text, because a name introduced three chapters earlier is not an
 * outside claim — it is the book's. What is left is what the editor is
 * asserting on their own authority, which is exactly the list to check.
 */
export function outsideClaims(noteText: string, sourceText: string): string[] {
  // Stripped on both sides. The book's own text carries `<i>` around a title
  // exactly as a note does, and a claim taken from clean note text would never
  // find it inside a tag.
  const haystack = loosen(parseInlineMarkup(sourceText).text).toLocaleLowerCase()
  return claimsIn(noteText).filter((claim) => !haystack.includes(claim.toLocaleLowerCase()))
}

/**
 * Locate and check a batch of proposals against the blocks they name.
 *
 * `bookText` is the whole book, used only for the claim check — see
 * `outsideClaims` for why the wider text and not just the passage.
 */
export function checkProposals(
  proposals: readonly AnnotationProposal[],
  blocks: ReadonlyMap<string, string>,
  bookText: string
): CheckedProposal[] {
  return proposals.map((proposal) => {
    const blockText = blocks.get(proposal.blockId) ?? ''
    return {
      ...proposal,
      at: findAnchor(blockText, proposal.anchorText),
      outsideClaims: outsideClaims(proposal.text, bookText)
    }
  })
}
