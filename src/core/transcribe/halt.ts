/**
 * Telling "this piece of the book went wrong" from "everything is going wrong".
 *
 * Both paid runners are built to survive a bad chunk: a page that will not
 * transcribe, a reply that will not parse. They record the failure and carry on,
 * because refusing to read the other three hundred pages over chunk nine is the
 * wrong trade.
 *
 * That is exactly the wrong behaviour when the failure is not about the chunk.
 * An account out of credit answers *every* request with the same 400, so a book
 * that runs dry halfway through fires one doomed request per remaining chunk and
 * then reports "thirty-eight stretches could not be read" — which describes the
 * book as damaged when what happened is that the billing ran out. Measured on a
 * real book: the pass ended with a single line about a credit balance and no
 * notes at all on the screen.
 *
 * The rule here is structural rather than a string match. Anthropic's wording
 * for a spent balance is not something this app should hard-code, and the same
 * shape covers a rejected key, a revoked permission and anything else that is
 * about the account: **the same unretryable failure, several chunks running, is
 * not about the chunks.** So the run stops, keeps everything it has, and says
 * why — and because a stopped run is a checkpoint, topping up and carrying on
 * reads only what is left.
 *
 * Pure: messages in, a verdict out.
 */

/**
 * How many chunks in a row must fail identically before the run gives up.
 *
 * Not one: a single unretryable failure really can be about one chunk — a reply
 * that would not parse, a stretch of table the schema refused. Not ten: those
 * are ten pointless requests and ten minutes of someone watching a progress bar
 * fill up with nothing behind it.
 */
export const REPEATS_BEFORE_HALT = 3

/** Watches consecutive failures for the shape that means "stop asking". */
export interface HaltWatch {
  /**
   * Report a chunk's outcome — its error message, or null when it succeeded.
   *
   * Returns true when the run should stop. A success resets the count, so a
   * book that fails intermittently never trips it.
   */
  note(message: string | null): boolean
  /** The message that stopped the run, once one has. */
  reason(): string | null
}

export function haltWatch(limit: number = REPEATS_BEFORE_HALT): HaltWatch {
  let last: string | null = null
  let runLength = 0
  let stoppedBy: string | null = null

  return {
    note(message) {
      if (message === null) {
        last = null
        runLength = 0
        return false
      }
      runLength = message === last ? runLength + 1 : 1
      last = message
      if (runLength >= limit) {
        stoppedBy = message
        return true
      }
      return false
    },
    reason: () => stoppedBy
  }
}
