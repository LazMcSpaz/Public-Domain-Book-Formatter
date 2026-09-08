#!/usr/bin/env node
/**
 * Render passages aloud with Kokoro, off the device.
 *
 * The first slice of the plan the measurements forced. A phone reads this model
 * 5.8 times slower than listening, and the graphics chip on the one phone that
 * matters returns numbers nine orders of magnitude outside the range sound is
 * made of — so nothing is synthesised on the device. It is rendered once,
 * somewhere with a real processor, and the device plays a file. That is the same
 * bargain the scan and the transcription already strike: do the expensive thing
 * once, keep it on the shelf, let the device be a cache.
 *
 * Three doors, and two of them cost nothing:
 *
 *   node scripts/say.mjs --phonemes "acarshick"   # what a spelling will do
 *   node scripts/say.mjs --check                  # has any respelling drifted?
 *   node scripts/say.mjs --out samples/           # render, which needs the model
 *
 * The first two need only the phonemizer, so a respelling can be hunted down in
 * seconds instead of by waiting on a render and listening to it. That is the
 * whole reason they exist: the phonemes say what a spelling *will* do, and only
 * the ear says whether that is right, so the cheap question should never be
 * answered by the expensive one.
 *
 * `kokoro-js` is deliberately not in package.json: it drags onnxruntime-node
 * behind it, which is a couple of hundred megabytes, and every `npm ci` in CI
 * would pay for it to run a test suite that never speaks. The workflow installs
 * it when it needs it.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const REPO = resolve(import.meta.dirname, '..')

/**
 * The real modules, transformed by vite so `@core` means what it means.
 *
 * The same door `scripts/voice.mjs` uses, and for the same reason: a second copy
 * of the chapter-number rule here would be a book that said "lesson roman eight"
 * depending on which script rendered it.
 */
async function core() {
  const server = await createServer({
    root: REPO,
    configFile: resolve(REPO, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
  })
  const speech = await server.ssrLoadModule('@core/speech')
  return { speech, close: () => server.close() }
}

/**
 * The passages, which are this shelf's own rather than invented ones.
 *
 * The vocabulary is drawn from the 126 headwords of the glossary already printed
 * in *Clairvoyance*. The chapter opening carries its lines marked as headings
 * rather than guessed at from their capitals — a stand-in for the block kinds the
 * book renderer will have, and explicit here because a heuristic that the real
 * thing will not use is a sample that does not represent it.
 */
export const PASSAGES = {
  ordinary: {
    title: 'Ordinary prose',
    lines: [
      {
        text:
          'There are faculties in a person that reach past the five senses. They work by ' +
          'picking up vibrations, exactly as the eye picks up light, and the only real ' +
          'difference is which instruments we have learned to trust.'
      }
    ]
  },
  vocabulary: {
    title: "This book's vocabulary",
    lines: [
      {
        text:
          'The Akashic Records, the astral tube, and the etheric double are not the same ' +
          'thing. Prana flows through the plexi; the medulla oblongata is not the pineal ' +
          'gland. Clairaudience, psychometry, telekinesis and thought-transference are four ' +
          'different faculties, and the Siddhis are not a fifth.'
      }
    ]
  },
  chapter: {
    title: 'A chapter opening, as the book sets it',
    lines: [
      { heading: true, text: 'LESSON VIII' },
      { heading: true, text: 'CLAIRVOYANT REVERIE' },
      {
        text:
          'The higher forms of Clairvoyance, and how they may be cultivated and acquired. ' +
          'Trance conditions are not essential to the highest Clairvoyance, although often ' +
          'connected therewith.'
      }
    ]
  },
  names: {
    title: 'Names and dates',
    lines: [
      {
        text:
          'Madame Blavatsky founded the Theosophical Society in 1875. Heinrich Zschokke, ' +
          "Felix Vicq d'Azyr, Jacques Cazotte and Johann Heinrich Jung-Stilling are all " +
          'cited by Panchadasi; so are Sir William Crookes, Wilhelm Conrad Roentgen, 1845 ' +
          'to 1923, and the S.P.R.'
      }
    ]
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
 * The same reading the probe takes, and here for the same reason: a stretch that
 * comes back outside the range sound is made of must be reported, never written
 * into a book's audio and discovered by the listener. Silence is the failure
 * mode.
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
  return { peak, rms: samples.length > 0 ? Math.sqrt(sum / samples.length) : 0, broken }
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

/**
 * An argument, treating an empty one as absent.
 *
 * Deliberate rather than incidental: a workflow input that was not filled in
 * arrives as `--voices ''`, and the sensible reading of that is "you did not
 * choose", not "render no voices at all".
 */
function argOf(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

/** Kokoro's own rule: an `a` voice is American, a `b` voice British. */
const dialectOf = (voice) => (voice.startsWith('b') ? 'en' : 'en-us')

async function pronunciations() {
  try {
    return JSON.parse(await readFile(resolve(REPO, 'voice/pronunciations.json'), 'utf8'))
  } catch {
    return []
  }
}

// --- the two doors that cost nothing ------------------------------------

const asked = argOf('phonemes')
if (asked !== null) {
  const { phonemize } = await import('phonemizer')
  for (const dialect of ['en', 'en-us']) {
    console.log(`${dialect.padEnd(6)} ${(await phonemize(asked, dialect)).join(' ')}`)
  }
  process.exit(0)
}

if (hasFlag('check')) {
  const { phonemize } = await import('phonemizer')
  const { speech, close } = await core()
  const list = await pronunciations()
  const drifted = await speech.checkPronunciations(list, async (text, dialect) =>
    (await phonemize(text, dialect)).join(' ')
  )
  await close()
  if (drifted.length === 0) {
    console.log(`${list.length} respellings still say what they were approved for.`)
    process.exit(0)
  }
  // Never a warning to scroll past. A respelling that has stopped meaning what
  // it meant is a word mispronounced through a whole book, and the person who
  // approved it by ear is the only one who can approve the replacement.
  for (const entry of drifted) {
    console.error(
      `${entry.word}: "${entry.say}" now says ${entry.actual}, not ${entry.expected} as approved.`
    )
  }
  process.exit(1)
}

// --- rendering ----------------------------------------------------------

const out = resolve(argOf('out', 'samples'))
// George, chosen by ear. The other voices stay one flag away rather than in the
// default: a re-render is for hearing a change, and rendering two voices nobody
// picked triples it.
const voices = argOf('voices', 'bm_george').split(',')
const only = argOf('text')

const { speech, close } = await core()
const list = await pronunciations()

/**
 * A passage as it should be spoken: chapter numbers in words, listed words
 * respelt.
 *
 * The numbers rule runs on headings only, because `I` is also the commonest
 * pronoun in English and an occult shelf is exactly where a chapter called
 * "I AM THAT I AM" turns up.
 */
function speakable(lines, dialect) {
  const usable = list.filter((entry) => entry.dialect === dialect)
  return lines
    .map((line) => {
      const said = line.heading ? speech.speakHeadingNumbers(line.text) : line.text
      return speech.applyPronunciations(said, usable)
    })
    .join('\n')
}

const { KokoroTTS, TextSplitterStream } = await import('kokoro-js')
console.log('Loading Kokoro…')
const t0 = Date.now()
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'fp32',
  device: 'cpu'
})
console.log(`Loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s.`)

await mkdir(out, { recursive: true })
const rendered = []

/** Render one stretch, refusing to write anything that is not sound. */
async function render(name, text, voice, record) {
  const started = Date.now()
  const result = await say(tts, TextSplitterStream, text, voice)
  const took = (Date.now() - started) / 1000
  if (result.sound.broken > 0 || result.sound.peak > 1.5 || result.sound.peak < 0.01) {
    throw new Error(
      `${name} came back outside the range sound is made of ` +
        `(peak ${result.sound.peak}, ${result.sound.broken} broken) — refusing to write it`
    )
  }
  await writeFile(resolve(out, `${name}.wav`), wav(result.samples, result.rate))
  rendered.push({
    ...record,
    name,
    voice,
    phonemes: result.phonemes,
    seconds: result.seconds,
    factor: took / result.seconds
  })
  console.log(
    `${name}: ${result.seconds.toFixed(1)}s of sound in ${took.toFixed(1)}s ` +
      `(x${(took / result.seconds).toFixed(2)}), peak ${result.sound.peak.toFixed(2)}`
  )
}

const passages = only ? { typed: { title: 'Typed', lines: [{ text: only }] } } : PASSAGES

for (const voice of voices) {
  const dialect = dialectOf(voice)
  for (const [key, passage] of Object.entries(passages)) {
    const text = speakable(passage.lines, dialect)
    await render(`${key}-${voice}`, text, voice, {
      kind: 'passage',
      key,
      title: passage.title,
      text
    })
  }
}

// Every listed word, twice: as the book prints it and as the list respells it.
// The decision this exists for is the editor's — some of these do not need
// correcting — and it cannot be made from phonemes, only from hearing the two
// beside each other.
if (!only) {
  const voice = voices.find((v) => dialectOf(v) === 'en') ?? voices[0]
  for (const entry of list.filter((e) => e.dialect === dialectOf(voice))) {
    const slug = entry.word.toLowerCase().replace(/[^a-z0-9]+/gu, '-')
    await render(`word-${slug}-before`, entry.word, voice, {
      kind: 'pronunciation',
      key: slug,
      title: entry.word,
      text: entry.word,
      side: 'before',
      sounds: entry.sounds
    })
    await render(`word-${slug}-after`, entry.say, voice, {
      kind: 'pronunciation',
      key: slug,
      title: entry.word,
      text: entry.say,
      side: 'after',
      sounds: entry.sounds
    })
  }
}

await writeFile(resolve(out, 'manifest.json'), `${JSON.stringify(rendered, null, 1)}\n`)
console.log(`\n${rendered.length} clips written to ${out}.`)
await close()
