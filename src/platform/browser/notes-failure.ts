/**
 * A failed read of the status notes, in the owner's words, twice over: the few
 * words beside the Workroom's live light, and the sentence in the band under
 * it. Both say the same reason. A token GitHub rejected is never called "could
 * not reach the shelf": the shelf answered, and what it said is the news.
 *
 * Browser-only.
 */
import { ShelfError } from './shelf'

export interface NotesFailure {
  /** Beside the live light: a few words. */
  light: string
  /** The band under the counts: the whole reason. */
  band: string
}

export function notesFailure(err: unknown): NotesFailure {
  const said = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'NoAnswer') {
    return {
      light: 'could not reach the shelf',
      band: `Could not reach the shelf: the browser got no answer (it said “${said}”).`
    }
  }
  return { light: lightWords(err), band: `Could not read the shelf: ${said}` }
}

function lightWords(err: unknown): string {
  if (err instanceof Error && err.name === 'NoSuchBranch') return 'no such branch on the shelf'
  const status = err instanceof ShelfError ? err.status : null
  if (status === 401) return 'the shelf refused the token'
  // 403 is a token without the right access as often as a limit; the band says which.
  if (status === 403) return 'GitHub refused the read'
  if (status === 429) return 'GitHub is limiting requests for a while'
  if (status === 404) return 'the shelf was not found'
  return 'could not read the shelf'
}
