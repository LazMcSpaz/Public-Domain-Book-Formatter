/**
 * A compact list of the most frequent modern English words.
 *
 * Used only as a *negative* filter when harvesting a book's vocabulary: a token
 * that appears here is ordinary and uninteresting, so it never becomes a
 * candidate term for review. Everything else is judged on frequency and
 * orthography (see `build-lexicon.ts`).
 *
 * Deliberately small — this is not a spell-checker. Over-inclusion would hide
 * genuine archaic vocabulary, which is exactly what we want to surface.
 */
const WORDS = `
a about above after again against all am an and any are as at be because been
before being below between both but by came can cannot come could day did do
does doing done down during each even every few first for from further get give
go good great had has have having he her here hers herself him himself his how
i if in into is it its itself just know large last let life like little long
made make man many may me men might more most much must my myself never new no
nor not now of off old on once one only or other ought our ours ourselves out
over own part people place put said same saw say see seem shall she should since
so some still such take than that the their theirs them themselves then there
these they thing think this those though three through thus time to too two
under until up upon us use used very was way we well went were what when where
whether which while who whom whose why will with within without work world would
year you your yours yourself yourselves
also among another back because become before began begin behind believe best
better between beyond both bring called case certain change children course
different does done early end enough face fact far feel found four full gave
general give given goes going got half hand head hear heard held help high home
hope hour house however important interest keep kept kind knew known land later
least leave left less light live long look looked looking lose lost love making
mean means mind moment money morning mother move name near need never next night
nothing number often open order others part passed past perhaps person point
possible power present probably problem public question quite rather reached
read ready real reason received rest result return right room round run said
sat school second seemed seen sense sent set several side since small social
something sometimes soon sound south speak special stand start state stay stood
stop story strong sure system table taken tell terms things thought today
together told took toward true try turn turned understand until using usually
various view voice wait walk want war water week whole whose why wide wife
window wish woman women word words write written wrong year years yes yet young
`
  .trim()
  .split(/\s+/)

/** Lower-cased set of ordinary English words. */
export const COMMON_WORDS: ReadonlySet<string> = new Set(WORDS)

/** True when the token is an ordinary modern English word. */
export function isCommonWord(token: string): boolean {
  return COMMON_WORDS.has(token.toLowerCase())
}
