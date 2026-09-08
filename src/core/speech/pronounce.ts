/**
 * Words this shelf uses that an English phonemizer gets wrong.
 *
 * ## Why the correction is a respelling and not a phoneme
 *
 * The obvious design is a dictionary in IPA, spliced into the phoneme string
 * before synthesis: exact, unambiguous, and immune to whatever the phonemizer
 * makes of a spelling. It was tried first and it does not work here. espeak has
 * no phoneme-passthrough this library can reach — `[[ʃˈɒkə]]` comes back as
 * *"esh stress turned-alpha kay schwa"*, the names of the characters — and
 * `phonemize` is not exported, so there is no string to splice into.
 *
 * So the correction is a **respelling**, which is what the editor would write
 * anyway. Two rules came out of measuring rather than reasoning, and both cost a
 * round of samples to learn:
 *
 * **No capitals.** A capitalised syllable is sometimes spelled out as letters,
 * and unpredictably: `Bla-VAT-skee` came back as *"blah-vee-ay-tee-skee"* and
 * `Pan-cha-DAH-see` as *"pan-cha-dee-ay-aitch-see"*, while `SID-eez` and
 * `SHOCK-uh` were fine. It is not a rule anyone can learn, so the convention
 * everybody knows — capitals for the stressed syllable — is the one thing a
 * respelling here must not use.
 *
 * **A hyphen forces a stress.** `clairawdience` is read as one word and gets it
 * wrong; `clair-awdience` puts the stress where it belongs. Hyphens are the
 * only stress control available, and they are safe in lower case.
 *
 * ## Why every entry carries the phonemes it was chosen for
 *
 * A respelling is chosen because it *measured* right, and nothing about
 * `acarshick` says on its face that it means "uh-KAH-shik". A new phonemizer
 * version, a different dialect, or a typo in the list would each change what it
 * produces, silently, into a book somebody then listens to for six hours.
 * `expect` is what it produced when it was approved, so `checkPronunciations`
 * can say that it no longer does. Nothing here verifies itself; the check is a
 * separate pass over the same file.
 *
 * Pure.
 */

/** One word the voice gets wrong, and what to give it instead. */
export interface Pronunciation {
  /** As the book prints it. Matched whole-word, without regard to case. */
  word: string
  /** A lower-case respelling. Hyphens force stress; capitals are never used. */
  say: string
  /** The phonemes `say` produced when this was approved by ear. */
  expect: string
  /** The espeak dialect it was measured in: `en` British, `en-us` American. */
  dialect: string
  /** What it is supposed to sound like, for a person reading the list. */
  sounds: string
}

/**
 * The text with every listed word replaced by its respelling.
 *
 * Longest first, so `Vicq d'Azyr` is matched before any entry for `Azyr` would
 * be, and a phrase can never be half-replaced. Case is ignored on the way in
 * and irrelevant on the way out: what comes back is a respelling, and a
 * respelling has no capitals by construction.
 */
export function applyPronunciations(text: string, list: readonly Pronunciation[]): string {
  const ordered = [...list].sort((a, b) => b.word.length - a.word.length)
  let out = text
  for (const entry of ordered) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}'’-])(${escapeRegExp(entry.word)})(?![\\p{L}\\p{N}'’])`,
      'giu'
    )
    out = out.replace(pattern, (_match, before: string) => `${before}${entry.say}`)
  }
  return out
}

/** Which listed words a stretch of text actually contains. */
export function pronunciationsIn(
  text: string,
  list: readonly Pronunciation[]
): readonly Pronunciation[] {
  return list.filter((entry) =>
    new RegExp(`(^|[^\\p{L}\\p{N}'’-])${escapeRegExp(entry.word)}(?![\\p{L}\\p{N}'’])`, 'iu').test(
      text
    )
  )
}

/** One entry whose respelling no longer produces what it was approved for. */
export interface PronunciationDrift {
  word: string
  say: string
  expected: string
  actual: string
}

/**
 * Which entries have drifted, given a phonemizer.
 *
 * The phonemizer is passed in rather than imported: this module is pure, and
 * the only thing that can answer the question lives in a package with a
 * WebAssembly build of espeak inside it.
 */
export async function checkPronunciations(
  list: readonly Pronunciation[],
  phonemize: (text: string, dialect: string) => Promise<string>
): Promise<readonly PronunciationDrift[]> {
  const drifted: PronunciationDrift[] = []
  for (const entry of list) {
    const actual = (await phonemize(entry.say, entry.dialect)).trim()
    if (actual !== entry.expect.trim()) {
      drifted.push({ word: entry.word, say: entry.say, expected: entry.expect, actual })
    }
  }
  return drifted
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
