/**
 * Folding the waiting changes into a book, without losing what the app cannot read.
 *
 * A flush reads the book file off the shelf, folds the queue into its two
 * lists (the edits and the rulings) and writes the file back. It used to write
 * back **the app's own reading** of the file, and the app reads only the fields
 * it knows. Everything else went: measured on the shelf, a ruling sent from the
 * tablet to _Collected Manuscript Lectures_ would have taken the `why` and the
 * `finding` off 404 corrections the tools had written, and five reasons off
 * another book. Nothing said so; the commit message would have read "1 query
 * ruled on".
 *
 * So the file is patched rather than rewritten. The shelf's own JSON is kept as
 * it was, laid out as it was (its indent, its line endings, its last newline),
 * and only the two lists change. In those, every item the merge left alone is
 * written back as the shelf held it, extra fields and all; an item the queue
 * added or replaced is the queue's. What the app knows is still decided by the
 * app (`mergeOutbox`), so the patch can never mean something different from the
 * merge: the result is read back and held to it.
 *
 * **A fold that cannot keep everything writes nothing.** It used to fall back
 * to the app's own copy of the list and write that, which is the loss this file
 * exists to prevent, with nothing said. Now it says so (`keptEverything` false,
 * no text to write), and the flush keeps the changes queued and tells the
 * editor. Records are compared as the app reads them, whatever order their keys
 * were written in (`same.ts`): comparing texts is what made a comment from the
 * reading view look like a change nobody made, on every book on the shelf.
 *
 * Pure: text in, text out.
 */
import {
  BOOK_FILE_VERSION,
  CURRENT_SCHEMA_VERSION,
  parseBookFile,
  type BookFile
} from '@core/project'
import { mergeOutbox, type MergeResult, type OutboxEntry } from './outbox'
import { canonicalJson, readEdit, readRuling } from './same'

/** What folding the queue into a book file came to. */
export interface FoldedBookText {
  /**
   * The book file to write, or null when nothing may be written.
   *
   * Null with `keptEverything` true is a queue whose every change is already
   * on the shelf (a flush whose answer was lost, sent again): the entries can
   * be cleared and no commit that says nothing is made. Null with
   * `keptEverything` false is a fold that would have lost something: nothing
   * is written and nothing is cleared.
   */
  json: string | null
  merged: MergeResult
  /** The book as the app reads it, from the text that was read. */
  file: BookFile
  /**
   * Whether the file to write keeps every field the app does not read. When
   * false there is no file to write: see `json`.
   */
  keptEverything: boolean
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** How a JSON file is laid out, so a rewrite of it changes only what changed. */
export interface JsonLayout {
  /** What each level is indented by; empty for a file on one line. */
  indent: string
  /** `\r\n` for a file written with Windows line endings, otherwise `\n`. */
  eol: string
  /** Whether the file ends with a line ending. */
  finalEol: boolean
}

/**
 * The layout of a JSON file, read off its text.
 *
 * The tools write most books with two spaces and one with a single space, all
 * with no newline at the end. Writing one space as two rewrites every line of
 * the file in git: a single ruling on _Collected Manuscript Lectures_ showed as
 * some twenty thousand changed lines.
 */
export function layoutOf(text: string): JsonLayout {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const first = /^[{[][ \t]*\r?\n([ \t]+)/.exec(text)
  const indent = first?.[1] ?? (text.includes('\n') ? '  ' : '')
  return { indent, eol, finalEol: text.endsWith('\n') }
}

/** A value written out in a given layout. */
export function writeInLayout(value: unknown, layout: JsonLayout): string {
  let json = JSON.stringify(value, null, layout.indent)
  if (layout.eol !== '\n') json = json.replace(/\n/g, layout.eol)
  return layout.finalEol ? json + layout.eol : json
}

/**
 * The shelf's own list with the merge applied.
 *
 * `parsed` is the app's reading of `stored`, and `merged` is what the merge
 * made of `parsed`: an item it left alone is the same object, which is how an
 * untouched item is told from one the queue added or replaced. Each stored item
 * is paired with the app's reading of it, in order (the parser reads every item
 * on its own, so the readable ones are `parsed`, one for one). Items the app
 * cannot read at all stay where they were, after the item they followed.
 *
 * Null when the two cannot be paired, which a sound parse never produces: the
 * caller then writes nothing.
 */
function keepStored<T>(
  stored: unknown,
  parsed: readonly T[],
  merged: readonly T[],
  read: (raw: unknown) => T | null
): Json[] | null {
  const list: unknown[] = Array.isArray(stored) ? stored : []
  const storedOf = new Map<T, unknown>()
  const readable = new Set<number>()
  let next = 0
  for (let i = 0; i < list.length; i++) {
    const reading = read(list[i])
    if (reading === null) continue
    const item = parsed[next]
    if (item === undefined || canonicalJson(reading) !== canonicalJson(item)) return null
    storedOf.set(item, list[i])
    readable.add(i)
    next += 1
  }
  if (next !== parsed.length) return null

  const out: unknown[] = merged.map((item) => (storedOf.has(item) ? storedOf.get(item) : item))
  // What the app could not read, put back after the item it followed (or the
  // nearest one before it that the merge kept).
  const present = new Set(out)
  const head: unknown[] = []
  const after = new Map<unknown, unknown[]>()
  let anchor: { item: unknown } | null = null
  list.forEach((item, i) => {
    if (readable.has(i)) {
      if (present.has(item)) anchor = { item }
      return
    }
    if (anchor === null) head.push(item)
    else after.set(anchor.item, [...(after.get(anchor.item) ?? []), item])
  })
  return [...head, ...out.flatMap((item) => [item, ...(after.get(item) ?? [])])] as Json[]
}

/** What a list reads as to the app, item by item; null for an item it would not read. */
const readingOf = <T>(list: readonly T[], read: (raw: unknown) => T | null): string =>
  canonicalJson(list.map((item) => read(item)))

/**
 * Fold the queue into a book file as the shelf holds it.
 *
 * Throws only what `parseBookFile` throws: a file that is not a book file is
 * not one to write over.
 */
export function foldIntoBookText(
  text: string,
  queue: readonly OutboxEntry[],
  savedAt: string
): FoldedBookText {
  const file = parseBookFile(text)
  const merged = mergeOutbox({ edits: file.run.edits, rulings: file.run.rulings }, queue)
  const changes =
    readingOf(merged.edits, readEdit) !== readingOf(file.run.edits, readEdit) ||
    readingOf(merged.rulings, readRuling) !== readingOf(file.run.rulings, readRuling)
  if (merged.applied.length === 0 || !changes) {
    return { json: null, merged, file, keptEverything: true }
  }
  const refused: FoldedBookText = { json: null, merged, file, keptEverything: false }

  const raw = JSON.parse(text) as { [key: string]: Json }
  const run = raw['run'] as { [key: string]: Json }
  const edits = keepStored(run['edits'], file.run.edits, merged.edits, readEdit)
  const rulings = keepStored(run['rulings'], file.run.rulings, merged.rulings, readRuling)
  if (edits === null || rulings === null) return refused
  run['edits'] = edits
  run['rulings'] = rulings
  // What the app writes is read as the current shape. Every step between the
  // versions only adds (see `migrateSavedRun`), so an older file saying so is
  // true of it; and an app that predates the newest one refuses the file
  // rather than reading it and dropping what it does not know.
  run['schemaVersion'] = CURRENT_SCHEMA_VERSION
  raw['runSchema'] = CURRENT_SCHEMA_VERSION
  raw['version'] = BOOK_FILE_VERSION
  raw['savedAt'] = savedAt
  const json = writeInLayout(raw, layoutOf(text))

  // Read back as the app reads it, and held to the merge: the patched file must
  // read exactly as the app's own write of the merge would have. A patch that
  // read differently would be a change nobody made.
  const back = parseBookFile(json)
  if (
    canonicalJson(back.run.edits) !== readingOf(merged.edits, readEdit) ||
    canonicalJson(back.run.rulings) !== readingOf(merged.rulings, readRuling)
  ) {
    return refused
  }
  return { json, merged, file, keptEverything: true }
}

/**
 * A book being opened, with what this device has not sent yet folded in.
 *
 * The shelf's copy is what a book opens from, and a mark waiting in the queue
 * is not in it: opening the book again, after a refresh, drew the page without
 * the mark the editor had just watched appear, although it was still waiting
 * to go up. So the queue is folded in exactly as a flush would fold it, and
 * what a flush could not take (a correction made against a passage that has
 * since changed on the shelf) is left out and reported by the flush, as now.
 */
export function withQueued(
  file: BookFile,
  queue: readonly OutboxEntry[]
): { file: BookFile; waiting: number; conflicts: number } {
  if (queue.length === 0) return { file, waiting: 0, conflicts: 0 }
  const merged = mergeOutbox({ edits: file.run.edits, rulings: file.run.rulings }, queue)
  return {
    file: { ...file, run: { ...file.run, edits: merged.edits, rulings: merged.rulings } },
    waiting: queue.length,
    conflicts: merged.conflicts.length
  }
}
