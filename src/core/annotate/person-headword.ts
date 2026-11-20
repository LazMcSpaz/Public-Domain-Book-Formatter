/**
 * Which glossary headwords name people, and the surname each is looked for by.
 *
 * Split from `marks.ts` so the check, the placer and the stray-circle sweep
 * share one rule: people are matched as names, by surname
 * (docs/process/glossary.md, G7).
 */

/**
 * A headword that names a person, `Surname, Given Names (dates)`: the comma
 * there inverts a name, it does not list alternatives. Read as alternatives,
 * `Balfour, Arthur James (1848-1930)` looked for "Arthur James" on its own.
 */
const PERSON = /^\s*([^,()]+?),\s*[^()]+?\s*\([^)]*\d[^)]*\)\s*\.?\s*$/

/**
 * A person with no dates in the headword: `Berry, Franklin L.`,
 * `Panchadasi, Swami`, `Gordon, Mrs Alice`. Told by what the given part
 * carries, an initial or a title, because the shape alone cannot tell a
 * person from two alternatives: measured over every glossary on the shelf,
 * `Freemasonry, Masonry`, `Yoga, Yogi` and `Theosophy, Theosophical Society`
 * are "Capitalised, Capitalised" too, and not one of them carries either.
 * A dateless person with neither (`Gray, Elisha`) reads as alternatives, as
 * it did before; the house style gives a person dates.
 */
const UNDATED_PERSON =
  /^\s*(\p{Lu}[\p{L}'\u2019-]+),\s*((?:\p{Lu}[\p{L}'\u2019-]*\.?\s*){1,5})\.?\s*$/u
const INITIAL_OR_TITLE =
  /(?:^|\s)(?:\p{Lu}\.|Mrs\.?|Mr\.?|Miss|Madame|Mme\.?|Dr\.?|Sir|Lord|Lady|Colonel|Col\.|Captain|Capt\.|General|Professor|Prof\.|Rev\.?|Swami|Count|Countess|Baron)(?=\.?(?:\s|$))/u

/**
 * A family, `Creery family`, `Fox sisters`: circled where the book first
 * names one of them, on the surname ("Rev. A. M. Creery°"), as the glossary
 * process says people are matched (docs/process/glossary.md, G7). Looked for
 * as the whole two words, the entry was reported unmarked by `finish`.
 */
const FAMILY = /^\s*(?:the\s+)?(\p{Lu}[\p{L}'’-]+)\s+(?:family|sisters|brothers)\s*\.?\s*$/iu

export function personSurname(headword: string): string | null {
  const dated = PERSON.exec(headword)
  if (dated) return dated[1]!.trim()
  const family = FAMILY.exec(headword)
  if (family && /^\p{Lu}/u.test(family[1]!)) return family[1]!
  const undated = UNDATED_PERSON.exec(headword)
  if (undated && INITIAL_OR_TITLE.test(` ${undated[2]!.trim()}`)) return undated[1]!.trim()
  return null
}

export function isPersonHeadword(headword: string): boolean {
  return personSurname(headword) !== null
}
