/**
 * A person's sign-off on a readiness check, written as one line in the book's
 * `ledger.md`:
 *
 *   Signed off: R1 <sha256 of the file> 2026-11-19 the owner read the spelling sheet
 *
 * The check's id, the full SHA-256 fingerprint of the file the check was about
 * (more than one when the check covers several, such as both covers), the day
 * the reading was done, and who did it and what was decided. A list dash in
 * front is allowed. The fingerprint ties the sign-off to that exact file: a new
 * export, or a new save of the book, has a new fingerprint and needs a new line.
 *
 * A line that starts "Signed off:" and does not read is reported, never
 * skipped; so is a sign-off that names another file or a day still to come.
 * Only a NEEDS A PERSON result can be signed off: a failure or a check that
 * did not run cannot be signed away.
 */
import { readinessCheck, type CheckResult, type SignOff } from './readiness'

export const SIGN_OFF_FORM =
  'Signed off: <check> <sha256> [<sha256> …] <YYYY-MM-DD> <who, and what>'

const START = /^\s*(?:[-*]\s+)?signed off:\s*/iu
const SHA = /^[0-9a-f]{64}$/u
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u

export interface SignOffReading {
  signOffs: SignOff[]
  /** Lines that start like a sign-off and are not one, with why. */
  problems: string[]
}

function realDay(day: string): boolean {
  const m = DAY.exec(day)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === day
}

/** Every sign-off line in a ledger, and every line that tried to be one. */
export function parseSignOffs(ledger: string): SignOffReading {
  const signOffs: SignOff[] = []
  const problems: string[] = []
  ledger.split(/\r?\n/u).forEach((text, i) => {
    const line = i + 1
    const start = START.exec(text)
    if (!start) return
    const words = text
      .slice(start[0].length)
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean)
    const id = (words.shift() ?? '').toUpperCase()
    const fingerprints: string[] = []
    while (words.length > 0 && SHA.test(words[0]!.toLowerCase())) {
      fingerprints.push(words.shift()!.toLowerCase())
    }
    const date = words.shift() ?? ''
    const note = words.join(' ')
    const why = !readinessCheck(id)
      ? `"${id}" is not a check in the readiness list`
      : fingerprints.length === 0
        ? 'it names no full 64-character fingerprint'
        : !realDay(date)
          ? `"${date}" is not a date written YYYY-MM-DD`
          : note.length === 0 || note.startsWith('<')
            ? 'it does not say who did the reading and what was decided'
            : null
    if (why) problems.push(`ledger.md line ${line}: not counted, because ${why} (${SIGN_OFF_FORM})`)
    else signOffs.push({ id, fingerprints, date, note, line })
  })
  return { signOffs, problems }
}

/**
 * The results with their sign-offs applied, and what was said about the
 * sign-off lines that did not count. A NEEDS A PERSON result is signed off
 * when the ledger's lines for its check, dated no later than `today`, between
 * them name every one of its `subjects`.
 */
export function applySignOffs(
  results: readonly CheckResult[],
  signOffs: readonly SignOff[],
  today: string
): { results: CheckResult[]; notes: string[] } {
  const notes: string[] = []
  const used = new Set<SignOff>()
  const out = results.map((res) => {
    const mine = signOffs.filter((s) => s.id === res.id)
    if (mine.length === 0) return res
    if (res.outcome !== 'NEEDS A PERSON') {
      for (const s of mine) {
        used.add(s)
        notes.push(
          `ledger.md line ${s.line}: ${s.id} is ${res.outcome}, not a check waiting on a person, so its sign-off does not count`
        )
      }
      return res
    }
    const dated = mine.filter((s) => {
      if (s.date <= today) return true
      used.add(s)
      notes.push(`ledger.md line ${s.line}: dated ${s.date}, after today (${today}); not counted`)
      return false
    })
    const subjects = res.subjects ?? []
    const named = new Set(dated.flatMap((s) => s.fingerprints))
    const covering = dated.filter((s) => s.fingerprints.some((f) => subjects.includes(f)))
    for (const s of dated) used.add(s)
    if (subjects.length > 0 && subjects.every((f) => named.has(f))) {
      const latest = [...covering].sort((a, b) => b.date.localeCompare(a.date) || b.line - a.line)
      return { ...res, signedOff: latest[0]! }
    }
    for (const s of dated.filter((d) => !covering.includes(d))) {
      notes.push(
        `ledger.md line ${s.line}: signs ${s.id} off for ${s.fingerprints.map((f) => f.slice(0, 12)).join(', ')}…, ` +
          'which is not the file checked here; not counted'
      )
    }
    const missing = subjects.filter((f) => !named.has(f))
    if (covering.length > 0 && missing.length > 0) {
      notes.push(
        `${res.id}: signed off for some of its files but not ${missing.map((f) => f.slice(0, 12)).join(', ')}…`
      )
    }
    return res
  })
  for (const s of signOffs) {
    if (!used.has(s) && !results.some((res) => res.id === s.id)) {
      notes.push(`ledger.md line ${s.line}: ${s.id} has no result in this report; not counted`)
    }
  }
  return { results: out, notes }
}

/** The line a person adds to `ledger.md` to sign a result off, ready to copy. */
export function signOffLine(res: CheckResult, today: string): string | null {
  if (res.outcome !== 'NEEDS A PERSON' || !res.subjects || res.subjects.length === 0) return null
  return `Signed off: ${res.id} ${res.subjects.join(' ')} ${today} <who did it, and what was decided>`
}
