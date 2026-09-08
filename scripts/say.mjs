#!/usr/bin/env node
/**
 * Render passages aloud with Kokoro, off the device.
 *
 * The first slice of the plan the measurements forced. A phone reads this model
 * at 5.8 times slower than listening, and the graphics chip on the one phone
 * that matters returns numbers nine orders of magnitude outside the range sound
 * is made of — so nothing is synthesised on the device. It is rendered once,
 * somewhere with a real processor, and the device plays a file.
 *
 * That is the same bargain the scan and the transcription already strike: do
 * the expensive thing once, keep it on the shelf, let the device be a cache.
 *
 * This is the renderer at its smallest — text in, WAV out, with the phonemes
 * reported beside each piece, because the phonemes are the only place a
 * mispronounced word shows up as something readable rather than as a noise. It
 * is what the sample set is built with, and it is what the book renderer will
 * be built on.
 *
 *   npm i --no-save kokoro-js
 *   node scripts/say.mjs --out samples/            # the prepared passages
 *   node scripts/say.mjs --text "Akashic." --out . # anything
 *
 * `kokoro-js` is deliberately not in package.json: it drags onnxruntime-node
 * behind it, which is a couple of hundred megabytes, and every `npm ci` in CI
 * would pay for it to run a test suite that never speaks. The workflow installs
 * it when it needs it.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * The passages, which are this shelf's own rather than invented ones.
 *
 * The vocabulary is drawn from the 126 headwords of the glossary already
 * printed in *Clairvoyance*; the chapter opening is set out exactly as the book
 * sets it, because a Roman numeral standing alone is both the thing an English
 * phonemizer is least likely to get right and the thing every chapter on this
 * shelf opens with. The last one is the same hard words respelt beside
 * themselves, so a respelling can be judged against the default by ear.
 */
export const PASSAGES = {
  ordinary: {
    title: 'Ordinary prose',
    text:
      'There are faculties in a person that reach past the five senses. They work by picking ' +
      'up vibrations, exactly as the eye picks up light, and the only real difference is ' +
      'which instruments we have learned to trust.'
  },
  vocabulary: {
    title: "This book's vocabulary",
    text:
      'The Akashic Records, the astral tube, and the etheric double are not the same thing. ' +
      'Prana flows through the plexi; the medulla oblongata is not the pineal gland. ' +
      'Clairaudience, psychometry, telekinesis and thought-transference are four different ' +
      'faculties, and the Siddhis are not a fifth.'
  },
  chapter: {
    title: 'A chapter opening, as the book sets it',
    text:
      'LESSON VIII\nCLAIRVOYANT REVERIE\nThe higher forms of Clairvoyance, and how they may ' +
      'be cultivated and acquired. Trance conditions are not essential to the highest ' +
      'Clairvoyance, although often connected therewith.'
  },
  names: {
    title: 'Names and dates',
    text:
      'Madame Blavatsky founded the Theosophical Society in 1875. Heinrich Zschokke, Felix ' +
      "Vicq d'Azyr, Jacques Cazotte and Johann Heinrich Jung-Stilling are all cited by " +
      'Panchadasi; so are Sir William Crookes, Wilhelm Conrad Roentgen, 1845 to 1923, and ' +
      'the S.P.R.'
  },
  respelt: {
    title: 'The same words, respelt',
    text:
      'Akashic. Ah-KASH-ick. Prana. PRAH-na. Siddhis. SID-eez. Zschokke. SHOCK-uh. ' +
      "Vicq d'Azyr. Veek dah-ZEER. Blavatsky. Bla-VAT-skee. Panchadasi. Pan-cha-DAH-see."
  }
}

/** Float samples to a 16-bit mono WAV. The one audio format nothing argues with. */
export function wav(samples, rate) {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write('WAVEfmt ', 8, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), 44 + i * 2)
  }
  return buffer
}

/**
 * Peak, loudness and anything that is not a number.
 *
 * The same reading the probe takes, and here for the same reason: a stretch
 * that comes back outside the range sound is made of must be reported, never
 * written into a book's audio and discovered by the listener. Silence is the
 * failure mode.
 */
export function levels(samples) {
  let peak = 0
  let sum = 0
  let broken = 0
  for (const v of samples) {
    if (!Number.isFinite(v)) {
      broken += 1
      continue
    }
    const size = Math.abs(v)
    if (size > peak) peak = size
    sum += v * v
  }
  return {
    peak,
    rms: samples.length > 0 ? Math.sqrt(sum / samples.length) : 0,
    broken
  }
}

/** One passage, spoken in pieces, joined, with what each piece was read as. */
export async function say(tts, TextSplitterStream, text, voice) {
  const splitter = new TextSplitterStream()
  splitter.push(text)
  splitter.close()
  const pieces = []
  const phonemes = []
  let rate = 24000
  for await (const piece of tts.stream(splitter, { voice })) {
    pieces.push(piece.audio.audio)
    phonemes.push({ text: piece.text.trim(), phonemes: piece.phonemes.trim() })
    rate = piece.audio.sampling_rate
  }
  const total = pieces.reduce((n, p) => n + p.length, 0)
  const samples = new Float32Array(total)
  let at = 0
  for (const piece of pieces) {
    samples.set(piece, at)
    at += piece.length
  }
  return { samples, rate, phonemes, seconds: total / rate, sound: levels(samples) }
}

function argOf(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}

const out = resolve(argOf('out', 'samples'))
const voices = argOf('voices', 'af_heart,af_bella,bm_george').split(',')
const only = argOf('text')

const { KokoroTTS, TextSplitterStream } = await import('kokoro-js')
console.log('Loading Kokoro…')
const t0 = Date.now()
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'fp32',
  device: 'cpu'
})
console.log(`Loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s.`)

await mkdir(out, { recursive: true })
const passages = only ? { typed: { title: 'Typed', text: only } } : PASSAGES
const rendered = []

for (const voice of voices) {
  for (const [key, passage] of Object.entries(passages)) {
    const name = `${key}-${voice}`
    const started = Date.now()
    const result = await say(tts, TextSplitterStream, passage.text, voice)
    const took = (Date.now() - started) / 1000
    // Never written out without being looked at. A blown-up stretch played to a
    // listener is the one failure nothing downstream can catch.
    if (result.sound.broken > 0 || result.sound.peak > 1.5 || result.sound.peak < 0.01) {
      throw new Error(
        `${name} came back outside the range sound is made of ` +
          `(peak ${result.sound.peak}, ${result.sound.broken} broken) — refusing to write it`
      )
    }
    await writeFile(resolve(out, `${name}.wav`), wav(result.samples, result.rate))
    rendered.push({
      key,
      voice,
      title: passage.title,
      text: passage.text,
      phonemes: result.phonemes,
      seconds: result.seconds,
      factor: took / result.seconds
    })
    console.log(
      `${name}: ${result.seconds.toFixed(1)}s of sound in ${took.toFixed(1)}s ` +
        `(x${(took / result.seconds).toFixed(2)}), peak ${result.sound.peak.toFixed(2)}`
    )
  }
}

await writeFile(resolve(out, 'manifest.json'), `${JSON.stringify(rendered, null, 1)}\n`)
console.log(`\n${rendered.length} passages written to ${out}.`)
