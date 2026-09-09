/**
 * The pieces both readers need: the model, the WAV, and the check on what came
 * back.
 *
 * `say.mjs` reads sample passages and `read-book.mjs` reads a book, and they
 * must produce the same sound from the same words — so the loading, the
 * chunking, the naming and the refusal all live here rather than in each of
 * them. A second copy of the levels check would be the one that got skipped.
 *
 * Node only: this is the half that cannot run in a browser, which is the whole
 * reason the audio is made off the device.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'

export const REPO = resolve(import.meta.dirname, '..')

/**
 * The real modules, transformed by vite so `@core` means what it means.
 *
 * The same door `scripts/voice.mjs` uses, and for the same reason: a second
 * copy of the chapter-number rule here would be a book that said "lesson roman
 * eight" depending on which script rendered it.
 */
export async function core(...names) {
  const server = await createServer({
    root: REPO,
    configFile: resolve(REPO, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
  })
  const loaded = {}
  for (const name of names) loaded[name] = await server.ssrLoadModule(`@core/${name}`)
  return { ...loaded, close: () => server.close() }
}

/** Kokoro's own rule: an `a` voice is American, a `b` voice British. */
export const dialectOf = (voice) => (voice.startsWith('b') ? 'en' : 'en-us')

/** A list from `voice/`, or nothing if it is not there. */
export async function listFile(name) {
  try {
    return JSON.parse(await readFile(resolve(REPO, `voice/${name}.json`), 'utf8'))
  } catch {
    return []
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
 * A stretch that comes back outside the range sound is made of must be
 * reported, never written into a book's audio and discovered by the listener.
 * Measured on a real phone: WebGPU returned a peak of 1,162,480,256, which
 * plays as a screech and looks like nothing at all in a log.
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

/** Why a stretch of samples is not fit to write out, or null if it is. */
export function refuse(sound) {
  if (sound.broken > 0) return `${sound.broken} samples are not numbers`
  if (sound.peak > 1.5) return `peak ${sound.peak} is outside the range sound is made of`
  if (sound.peak < 0.01) return 'it came back silent'
  return null
}

/**
 * A file name carrying a digest of exactly what was said.
 *
 * Not decoration. These files are served from the same origin as the app, whose
 * service worker caches same-origin assets cache-first and keeps them — so a
 * name that means one thing today and another tomorrow is a device playing last
 * week's audio under this week's label, with nothing on screen to say so.
 */
export function clipName(base, text, voice) {
  const digest = createHash('sha256').update(`${voice}${text}`).digest('hex')
  return `${base}-${digest.slice(0, 8)}`
}

/**
 * A 16-bit PCM WAV read back as samples.
 *
 * Deliberately narrow: it refuses anything but mono 16-bit PCM at the rate
 * asked for, rather than resampling or downmixing quietly. A bed silently
 * resampled by a routine written in an afternoon is a bed that sounds slightly
 * wrong for reasons nobody can find, and `ffmpeg` is already in the workflow
 * and does it properly.
 */
export function readWav(buffer, expectRate) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file')
  }
  let at = 12
  let format = null
  while (at + 8 <= buffer.length) {
    const id = buffer.toString('ascii', at, at + 4)
    const size = buffer.readUInt32LE(at + 4)
    const body = at + 8
    if (id === 'fmt ') {
      format = {
        encoding: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        rate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14)
      }
    } else if (id === 'data') {
      if (format === null) throw new Error('the WAV has audio before it says what shape it is')
      const { encoding, channels, rate, bits } = format
      if (encoding !== 1 || bits !== 16)
        throw new Error(`only 16-bit PCM, not ${bits}-bit (${encoding})`)
      if (channels !== 1) throw new Error(`only mono, not ${channels} channels`)
      if (expectRate !== undefined && rate !== expectRate) {
        throw new Error(`this is ${rate} samples a second and the reading is ${expectRate}`)
      }
      const count = Math.floor(Math.min(size, buffer.length - body) / 2)
      const samples = new Float32Array(count)
      for (let i = 0; i < count; i += 1) samples[i] = buffer.readInt16LE(body + i * 2) / 32768
      return { samples, rate }
    }
    at = body + size + (size % 2)
  }
  throw new Error('the WAV has no audio in it')
}

/**
 * Music laid under the start of a reading, leaving when the title does.
 *
 * The gain curve is decided in `@core/speech` and only applied here: the shape
 * of an opening is arithmetic over seconds and belongs where it can be tested
 * without a sound card, and this is the twenty lines that cannot be.
 */
export function layMusicUnder(voice, music, plan, gainAt, rate) {
  const offset = Math.round(plan.voiceAt * rate)
  const total = Math.max(voice.length + offset, music.length)
  const out = new Float32Array(total)
  for (let i = 0; i < music.length; i += 1) {
    const gain = gainAt(i / rate, plan)
    if (gain <= 0) break
    out[i] = music[i] * gain
  }
  for (let i = 0; i < voice.length; i += 1) out[offset + i] += voice[i]
  // The sum of two things that each peaked near the ceiling can clip, and a
  // clipped opening is the first thing anybody hears. Scaled back as a whole
  // rather than clamped per sample, which is distortion by another name.
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  if (peak > 0.99) for (let i = 0; i < out.length; i += 1) out[i] *= 0.99 / peak
  return out
}

/** Silence, as samples. Pauses are part of the text, not an absence of it. */
export function silence(seconds, rate = 24000) {
  return new Float32Array(Math.max(0, Math.round(seconds * rate)))
}

/** Several stretches end to end. */
export function join(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Float32Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Load the model once. `fp32` on a real processor, which is what CI has. */
export async function loadVoice() {
  const { KokoroTTS, TextSplitterStream } = await import('kokoro-js')
  const started = Date.now()
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'fp32',
    device: 'cpu'
  })
  return { tts, TextSplitterStream, seconds: (Date.now() - started) / 1000 }
}

/**
 * One stretch of text, spoken in as few passes as the model's limit allows.
 *
 * The model reads what it is handed and nothing else, so every break between
 * passes is a standing start and the joins are where a reading stops sounding
 * like a person. It used to be handed one sentence at a time — 55 of them in
 * chapter one of *The Human Aura*, 55 fresh starts in thirteen minutes. Now
 * sentences are packed up to a phoneme budget, which roughly halves that and
 * lets six of those sixteen paragraphs be read whole, with the pauses inside
 * them chosen by the model rather than by a constant in a file.
 *
 * The splitter is fed and closed by hand rather than handing `stream` a string:
 * given a string it builds a splitter, pushes the text and never closes it, so
 * the loop drains what has been split and then waits for a sentence nobody will
 * ever add. Read in the library, not guessed — and a hang there would have
 * looked exactly like a machine too slow to do this at all. It is used here for
 * its sentence splitting only, which knows about "Mr." and "e.g." and is not
 * worth writing again.
 *
 * A sentence too long to fit even alone comes back in `tooLong`, because the
 * tokenizer truncates at the limit with no error and a lost tail is exactly the
 * kind of gap nobody listening can hear.
 */
export async function speak({ tts, TextSplitterStream, speech }, text, voice, speed = 1) {
  const { phonemize } = await import('phonemizer')
  const dialect = dialectOf(voice)

  const splitter = new TextSplitterStream()
  splitter.push(text)
  splitter.close()
  const sentences = []
  for (const sentence of splitter) {
    const said = (await phonemize(sentence, dialect)).join(' ')
    sentences.push({ text: sentence, cost: said.length })
  }

  const { chunks, tooLong } = speech.packSentences(sentences)
  const parts = []
  const phonemes = []
  let rate = 24000
  for (const chunk of chunks) {
    const audio = await tts.generate(chunk, { voice, speed })
    parts.push(audio.audio)
    rate = audio.sampling_rate
    // The words, and deliberately not the punctuation. Kokoro splits on its own
    // punctuation set — `;:,.!?¡¿—…"«»“”(){}[]` — passes those marks through
    // untouched and phonemizes only what is between them, so the string the
    // model is given keeps every dash and ellipsis. A direct call to the
    // phonemizer, which is what this is, strips them.
    //
    // Read in the library rather than measured through it, and worth writing
    // down because measuring through it says the opposite: every one of a
    // comma, a semicolon, a colon and an em dash comes back as the same
    // phonemes, which reads as "the mark is lost" when the mark is simply not
    // this function's business.
    phonemes.push({
      words: chunk.trim(),
      phonemes: (await phonemize(chunk, dialect)).join(' ')
    })
  }
  const samples = join(parts)
  return {
    samples,
    rate,
    phonemes,
    tooLong,
    seconds: samples.length / rate,
    sound: levels(samples)
  }
}

/**
 * An argument, treating an empty one as absent.
 *
 * Deliberate rather than incidental: a workflow input that was not filled in
 * arrives as `--voices ''`, and the sensible reading of that is "you did not
 * choose", not "render nothing at all".
 */
export function argOf(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}

export const hasFlag = (name) => process.argv.includes(`--${name}`)
