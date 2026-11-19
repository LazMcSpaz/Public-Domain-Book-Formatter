/**
 * Many status notes read at once, as the Workroom and `work.mjs list` read
 * them: each file parsed strictly, its name checked against the note inside
 * it, and run ids checked to be unique. A note that fails is reported with
 * its reasons and left out, so one bad file never hides the rest and is never
 * shown as if it were sound.
 *
 * The name check matters because the name is where a note is looked for: a
 * note copied or renamed by hand would otherwise be found under one book or
 * role while it says another.
 *
 * Pure: the caller reads the files and hands in each path from the shelf's
 * top with its text.
 */
import { statusNotePath } from '../sync/work-paths'
import { parseStatusNote } from './note'
import type { StatusNote } from './vocab'

export interface NoteFile {
  /** From the shelf's top, as `work/runs/2026-11/…json`. */
  path: string
  text: string
}

export interface UnreadableNote {
  path: string
  problems: string[]
}

export interface ReadNotes {
  notes: StatusNote[]
  unreadable: UnreadableNote[]
}

export function readNotes(files: readonly NoteFile[]): ReadNotes {
  const notes: StatusNote[] = []
  const unreadable: UnreadableNote[] = []
  const seen = new Map<string, string>()
  const sorted = files
    .map((f) => ({ path: f.path.replace(/\\/gu, '/'), text: f.text }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const { path, text } of sorted) {
    const parsed = parseStatusNote(text)
    if (!parsed.ok) {
      unreadable.push({ path, problems: parsed.problems })
      continue
    }
    const note = parsed.note
    const home = statusNotePath(note)
    if (path !== home) {
      unreadable.push({
        path,
        problems: [
          `The note inside belongs at ${home} (its start, book, role and id say so); this file was copied or renamed by hand. Move it back to that name.`
        ]
      })
      continue
    }
    const other = seen.get(note.id)
    if (other) {
      unreadable.push({
        path,
        problems: [`Run ${note.id} is also in ${other}; two notes cannot share a run id.`]
      })
      continue
    }
    seen.set(note.id, path)
    notes.push(note)
  }
  return { notes, unreadable }
}
