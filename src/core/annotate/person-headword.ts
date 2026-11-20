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
 * A family, `Smithers family`, `Fox sisters`: circled where the book first
 * names one of them, on the surname ("Rev. J. Smithers°"), as the glossary
 * process says people are matched (docs/process/glossary.md, G7). The shape
 * alone cannot tell a family from a term (`Elder Brothers`, `Rose family`),
 * so a family is looked for by its whole phrase, as any term is, and by its
 * surname as a name (`isNameTerm`); a circle on either is the entry's.
 */
const FAMILY = /^\s*(?:the\s+)?(\p{Lu}[\p{L}'\u2019-]+)\s+(?:family|sisters|brothers)\s*\.?\s*$/iu

/** A person's surname: looked for alone, as a name. */
export function personSurname(headword: string): string | null {
  const dated = PERSON.exec(headword)
  if (dated) return dated[1]!.trim()
  const undated = UNDATED_PERSON.exec(headword)
  if (undated && INITIAL_OR_TITLE.test(` ${undated[2]!.trim()}`)) return undated[1]!.trim()
  return null
}

/** A family's surname: looked for as a name, beside the whole phrase. */
export function familySurname(headword: string): string | null {
  const family = FAMILY.exec(headword)
  return family && /^\p{Lu}/u.test(family[1]!) ? family[1]! : null
}

export function isPersonHeadword(headword: string): boolean {
  return personSurname(headword) !== null || familySurname(headword) !== null
}

/**
 * Whether a term of an entry is matched as a name (capitalised, not followed
 * by another capitalised word). Only the surname is: a family's whole phrase
 * is matched as any term is, as it was before families were read by surname.
 */
export function isNameTerm(headword: string, term: string): boolean {
  return term === (personSurname(headword) ?? familySurname(headword))
}
