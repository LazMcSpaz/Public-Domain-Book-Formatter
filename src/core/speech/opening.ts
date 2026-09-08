/**
 * Music under a chapter opening, and when it gets out of the way.
 *
 * A bed under the chapter number and title is the one piece of production that
 * makes a reading sound like a published audiobook rather than a file. What
 * makes it sound like an amateur one is timing: music that runs on under the
 * first paragraph, or that stops dead the instant the title ends.
 *
 * So the shape is planned from the length of the heading rather than fixed. The
 * voice comes in once the music has established itself, the music drops under
 * the voice, and it begins to leave a beat after the title — not at the same
 * moment, which sounds like a mistake, and not half a minute later, which is
 * what a bed of a fixed length does to a short title.
 *
 * Pure: arithmetic over seconds. Nothing here touches a sample.
 */

/** The shape of an opening, in seconds from the first sound. */
export interface Opening {
  /** Music alone before the voice comes in. */
  lead: number
  /** When the voice starts, and when its heading ends. */
  voiceAt: number
  headingEndsAt: number
  /** When the music starts leaving, and when it is gone. */
  fadeAt: number
  goneAt: number
  /** How far the music drops while the voice speaks, as a gain. */
  duck: number
  /** How long the drop takes, so it is a move rather than a step. */
  duckFor: number
  /** True when the music was too short to do all of this. Reported, not hidden. */
  short: boolean
}

export interface OpeningOptions {
  /** How much music there is to work with. */
  musicSeconds: number
  /** How long the chapter number and title take to say, silences included. */
  headingSeconds: number
  /** Music alone before the voice. */
  lead?: number
  /** A beat between the end of the title and the music starting to leave. */
  tail?: number
  /** How long the music takes to go. */
  fadeFor?: number
  /** How far under the voice the music sits. */
  duck?: number
  duckFor?: number
}

/**
 * When everything happens, given how long the title takes to say.
 *
 * A bed of a fixed length cannot do this: a chapter called "The Astral Colors
 * (Continued)" takes half as long again to say as "Thought Forms", and the
 * music has to leave after the title in both cases rather than at a time chosen
 * once for the first chapter anybody tried.
 */
export function planOpening(options: OpeningOptions): Opening {
  const {
    musicSeconds,
    headingSeconds,
    lead = 3,
    tail = 1.2,
    fadeFor = 3.5,
    duck = 0.3,
    duckFor = 0.6
  } = options

  const voiceAt = lead
  const headingEndsAt = voiceAt + headingSeconds
  const wantedFadeAt = headingEndsAt + tail

  // The music cannot go on longer than there is music. When it is too short the
  // fade is pulled earlier rather than the file being looped or stretched:
  // either of those is audible, and running out mid-note is the one failure a
  // listener reads as a fault in the recording rather than in the plan.
  const latestFadeAt = Math.max(0, musicSeconds - fadeFor)
  const fadeAt = Math.min(wantedFadeAt, latestFadeAt)

  return {
    lead,
    voiceAt,
    headingEndsAt,
    fadeAt,
    goneAt: fadeAt + fadeFor,
    duck,
    duckFor,
    short: wantedFadeAt > latestFadeAt
  }
}

/**
 * The gain the music is at, at one moment.
 *
 * The file's own fade-in is left alone — it was recorded that way and is part
 * of the material. What is applied here is only what depends on the words: the
 * drop under the voice, and the leaving.
 */
export function musicGainAt(seconds: number, plan: Opening): number {
  if (seconds >= plan.goneAt) return 0

  // Leaving. Linear in amplitude, which over three seconds is heard as a fade
  // rather than as a shape.
  if (seconds >= plan.fadeAt) {
    const through = (seconds - plan.fadeAt) / Math.max(plan.goneAt - plan.fadeAt, 1e-9)
    return ducked(plan) * (1 - through)
  }

  // Dropping under the voice, starting before it so the move is finished by the
  // time the first word lands.
  const dropFrom = plan.voiceAt - plan.duckFor
  if (seconds >= dropFrom) {
    const through = Math.min(1, (seconds - dropFrom) / Math.max(plan.duckFor, 1e-9))
    return 1 - through * (1 - plan.duck)
  }

  return 1
}

/** The level the music sits at once it is under the voice. */
function ducked(plan: Opening): number {
  return plan.duck
}
