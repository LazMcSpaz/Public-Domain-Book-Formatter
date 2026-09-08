/**
 * The probe's own reading of a stretch of samples, checked against the runs a
 * real phone produced.
 *
 * The functions are lifted out of `public/tts-probe.html` rather than copied
 * here, because a copy would have passed this the whole time the shipped page
 * was giving the wrong answer. The page is a standalone static file with no
 * build step — that is why it can be served to a phone as-is — so extraction
 * between two markers is what "one implementation" costs here.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Sound {
  peak: number
  rms: number
  broken: number
  ratio: number
  quiet: number
}

function fromProbe(): {
  levels: (samples: ArrayLike<number>) => Sound
  verdictOf: (sound: Sound) => string
} {
  const html = readFileSync(resolve(__dirname, '../public/tts-probe.html'), 'utf8')
  const from = html.indexOf('/* extract:levels')
  const to = html.indexOf('/* end extract:levels */')
  if (from < 0 || to < 0) throw new Error('the probe has lost its extract:levels markers')
  const source = html.slice(from, to)
  return new Function(`${source}; return { levels, verdictOf }`)() as ReturnType<typeof fromProbe>
}

const { levels, verdictOf } = fromProbe()

/** A syllabic envelope with pauses — the shape speech has, without being any. */
function speechLike(seconds: number, rate = 24000): Float32Array {
  const out = new Float32Array(seconds * rate)
  for (let i = 0; i < out.length; i += 1) {
    const t = i / rate
    if (t % 4 > 3) continue
    const syllable = (t * 4) % 1
    const envelope = syllable < 0.55 ? Math.exp(-syllable * 4) * (1 - Math.exp(-syllable * 60)) : 0
    out[i] =
      (Math.sin(2 * Math.PI * 140 * t) * 0.6 + Math.sin(2 * Math.PI * 700 * t) * 0.3) * envelope
  }
  return out
}

describe('levels', () => {
  it('separates speech from noise by loudness against peak', () => {
    const noise = Float32Array.from({ length: 24000 * 4 }, () => Math.random() * 2 - 1)
    const speech = levels(speechLike(4))
    const hiss = levels(noise)
    expect(hiss.ratio).toBeGreaterThan(0.45)
    expect(hiss.quiet).toBeLessThan(0.05)
    expect(speech.ratio).toBeLessThan(0.3)
    expect(speech.quiet).toBeGreaterThan(0.2)
  })

  it('counts samples that are not numbers rather than folding them into the peak', () => {
    const sound = levels(new Float32Array([0.5, NaN, -0.25, Infinity]))
    expect(sound.broken).toBe(2)
    expect(sound.peak).toBe(0.5)
  })

  it('says nothing about an empty stretch rather than dividing by zero', () => {
    const sound = levels(new Float32Array(0))
    expect(sound).toMatchObject({ peak: 0, rms: 0, ratio: 0, quiet: 0, broken: 0 })
  })
})

describe('verdictOf', () => {
  // Both of these are what the phone actually printed, to the digit. The second
  // is the one this exists for: the check called it speech, and it screeched.
  it('calls the measured processor run speech', () => {
    const measured = { peak: 0.66, rms: 0.071, ratio: 0.11, quiet: 0.39, broken: 0 }
    expect(verdictOf(measured)).toMatch(/look like speech/u)
  })

  it('calls the measured graphics-chip run a backend that blew up', () => {
    const measured = {
      peak: 1162480256,
      rms: 4472213.956,
      ratio: 4472213.956 / 1162480256,
      quiet: 1,
      broken: 0
    }
    expect(verdictOf(measured)).toMatch(/blew up/u)
  })

  it('rules out the impossible before the plausible', () => {
    expect(verdictOf({ peak: 0.9, rms: 0.1, ratio: 0.11, quiet: 0.3, broken: 4 })).toMatch(
      /not numbers/u
    )
    expect(verdictOf({ peak: 0, rms: 0, ratio: 0, quiet: 0, broken: 0 })).toMatch(/silent/u)
    expect(verdictOf({ peak: 0.8, rms: 0.01, ratio: 0.01, quiet: 0.99, broken: 0 })).toMatch(
      /nothing was really said/u
    )
    expect(verdictOf({ peak: 1, rms: 0.58, ratio: 0.58, quiet: 0.01, broken: 0 })).toMatch(
      /noise rather than speech/u
    )
  })
})
