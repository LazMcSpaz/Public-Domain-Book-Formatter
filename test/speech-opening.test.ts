/**
 * Music under a chapter opening, and when it gets out of the way.
 *
 * The bed supplied is 20 seconds: a fade-in to about 3.5s, a body to 13.5s, and
 * its own fade-out over the last 5.5. Everything here is timed from how long
 * the title takes to say, because a bed of a fixed length runs on under the
 * first paragraph of a short chapter and stops dead in the middle of a long one.
 */
import { describe, expect, it } from 'vitest'
import { musicGainAt, planOpening } from '@core/speech'

const PLAN = planOpening({ musicSeconds: 20, headingSeconds: 5 })

describe('planOpening', () => {
  it('brings the voice in after the music has established itself', () => {
    expect(PLAN.voiceAt).toBe(3)
    expect(PLAN.headingEndsAt).toBe(8)
  })

  it('starts leaving a beat after the title, not on top of it', () => {
    // On the same moment it reads as a mistake; much later it reads as music
    // nobody remembered to stop.
    expect(PLAN.fadeAt).toBeGreaterThan(PLAN.headingEndsAt)
    expect(PLAN.fadeAt).toBeLessThan(PLAN.headingEndsAt + 2)
    expect(PLAN.goneAt).toBeLessThanOrEqual(20)
  })

  it('follows the title rather than a number chosen once', () => {
    const short = planOpening({ musicSeconds: 20, headingSeconds: 3 })
    const long = planOpening({ musicSeconds: 20, headingSeconds: 7 })
    expect(long.fadeAt - short.fadeAt).toBeCloseTo(4, 5)
  })

  it('pulls the fade earlier rather than running out of music, and says so', () => {
    // Running out mid-note is the one failure a listener hears as a fault in
    // the recording rather than in the plan.
    const plan = planOpening({ musicSeconds: 8, headingSeconds: 9 })
    expect(plan.goneAt).toBeLessThanOrEqual(8)
    expect(plan.short).toBe(true)
    expect(PLAN.short).toBe(false)
  })
})

describe('musicGainAt', () => {
  it('leaves the file own fade-in alone', () => {
    // It was recorded that way and is part of the material; only what depends
    // on the words is applied here.
    expect(musicGainAt(0, PLAN)).toBe(1)
    expect(musicGainAt(2, PLAN)).toBe(1)
  })

  it('has finished dropping by the time the first word lands', () => {
    expect(musicGainAt(PLAN.voiceAt, PLAN)).toBeCloseTo(PLAN.duck, 5)
    // And is on its way down before it, so the move is heard as a move.
    const midway = musicGainAt(PLAN.voiceAt - PLAN.duckFor / 2, PLAN)
    expect(midway).toBeLessThan(1)
    expect(midway).toBeGreaterThan(PLAN.duck)
  })

  it('stays under the voice through the title', () => {
    expect(musicGainAt(5, PLAN)).toBeCloseTo(PLAN.duck, 5)
    expect(musicGainAt(PLAN.headingEndsAt, PLAN)).toBeCloseTo(PLAN.duck, 5)
  })

  it('goes, and stays gone', () => {
    expect(musicGainAt(PLAN.fadeAt, PLAN)).toBeCloseTo(PLAN.duck, 5)
    expect(musicGainAt((PLAN.fadeAt + PLAN.goneAt) / 2, PLAN)).toBeCloseTo(PLAN.duck / 2, 2)
    expect(musicGainAt(PLAN.goneAt, PLAN)).toBe(0)
    expect(musicGainAt(PLAN.goneAt + 30, PLAN)).toBe(0)
  })

  it('never rises again once it has started to leave', () => {
    let last = Infinity
    for (let t = PLAN.fadeAt; t <= PLAN.goneAt; t += 0.05) {
      const gain = musicGainAt(t, PLAN)
      expect(gain).toBeLessThanOrEqual(last + 1e-9)
      last = gain
    }
  })

  it('is never louder than the material and never below silence', () => {
    for (let t = 0; t < 25; t += 0.05) {
      const gain = musicGainAt(t, PLAN)
      expect(gain).toBeGreaterThanOrEqual(0)
      expect(gain).toBeLessThanOrEqual(1)
    }
  })
})
