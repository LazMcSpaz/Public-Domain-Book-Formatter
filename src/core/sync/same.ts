/**
 * When two records are one record.
 *
 * Every comparison the outbox makes ("is this already on the shelf?", "is the
 * patched file what the merge meant?", "is this queued change still the one
 * that was sent?") used to compare `JSON.stringify` texts, and that text
 * depends on the order the keys were written in. The reading view builds a
 * comment as `at, to, quote, text`; the parser that reads the shelf's file
 * builds the same comment as `at, text, quote, to`. One record, two texts. So
 * a flush took a comment it had just written for a different one, gave up on
 * keeping the tools' fields, and wrote the app's own copy over them: measured
 * read-only on the shelf, a queued comment did that to every book, and on one
 * it would have rewritten over four hundred corrections without their reasons.
 *
 * So records are compared **as the app reads them** (the parser's own tidying
 * applied: an empty label, quote or note the parser drops is the same as none)
 * and **with their keys in one order**. Pure.
 */
import { parseEdits, parseRulings } from '@core/project'
import type { BookEdit } from '@core/edits'
import type { Ruling } from '@core/queries'
import type { OutboxEntry } from './outbox'

/** JSON with every object's keys sorted, so the order they were written in does not count. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v
    const record = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, record[k]])
    )
  })
}

/**
 * The app's reading of one stored edit, or null when the app would not read it.
 *
 * One item at a time is the same as the whole list: the parser reads every
 * item on its own and keeps or drops it, which is what lets the fold pair each
 * item in the shelf's file with the app's reading of it. A highlight with a tag
 * this build does not know makes the parser throw for the whole book; here it
 * is an item the app cannot read, so a fold keeps it exactly as stored.
 */
export function readEdit(raw: unknown): BookEdit | null {
  try {
    return parseEdits([raw])[0] ?? null
  } catch {
    return null
  }
}

/** The app's reading of one stored ruling, or null when the app would not read it. */
export function readRuling(raw: unknown): Ruling | null {
  return parseRulings([raw])[0] ?? null
}

/** Whether two edits say the same thing, as the app reads them. */
export function equalEdit(a: BookEdit | null, b: BookEdit | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return canonicalJson(readEdit(a) ?? a) === canonicalJson(readEdit(b) ?? b)
}

/** Whether two rulings say the same thing, as the app reads them. */
export function equalRuling(a: Ruling, b: Ruling): boolean {
  if (a === b) return true
  return canonicalJson(readRuling(a) ?? a) === canonicalJson(readRuling(b) ?? b)
}

/**
 * Whether a queued change is still exactly the one a flush sent.
 *
 * A queued change is keyed by what it is about (`ruling:<query>`,
 * `highlight:<id>`), so ruling a query again or typing a note on a mark while
 * a slow write is on its way replaces the entry under the same key. Clearing
 * by key after the write would then delete the new change, unsent. So a flush
 * clears an entry only while it is still the one it sent, `madeAt` included.
 */
export function equalEntry(now: OutboxEntry | undefined, sent: OutboxEntry): boolean {
  return now !== undefined && canonicalJson(now) === canonicalJson(sent)
}
