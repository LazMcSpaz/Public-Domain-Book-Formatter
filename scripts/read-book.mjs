#!/usr/bin/env node
/**
 * A chapter of a book, read aloud.
 *
 * The thing the sample renders were for. It takes a `book.json` off the shelf —
 * transcription plus every correction, note and written division the editor has
 * made — assembles it exactly as the app does, and hands one chapter to the
 * voice with its chapter number written out and this shelf's respellings
 * applied.
 *
 *   node scripts/read-book.mjs books/human-aura/book.json --chapter 1 --script
 *   node scripts/read-book.mjs books/human-aura/book.json --chapter 1 --out audio/
 *
 * `--script` is the door that costs nothing: it prints what would be read,
 * every block accounted for, and the length to expect — so a chapter can be
 * checked against the book before a processor is asked for anything. The
 * expensive question should never be used to answer the cheap one.
 *
 * ## What it refuses
 *
 * A stretch of audio whose levels are outside the range sound is made of is not
 * written, and stops the run. A chapter that comes back far shorter than its
 * words predict is reported. Both are the footnote rule applied to audio: a gap
 * in a printed page is visible, and a gap in six hours of listening is not.
 *
 * ## What it does not do yet
 *
 * One chapter at a time, deliberately. Rendering a whole book is a few hours of
 * processor and a hundred megabytes on the shelf, and neither should be spent
 * before somebody has listened to a chapter of it.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  argOf,
  clipName,
  core,
  dialectOf,
  hasFlag,
  join,
  layMusicUnder,
  listFile,
  loadVoice,
  readWav,
  refuse,
  silence,
  speak,
  wav
} from './voice-lib.mjs'

const bookPath = process.argv[2]
if (!bookPath || bookPath.startsWith('--')) {
  console.error('usage: node scripts/read-book.mjs <book.json> --chapter <n> [--script|--out dir]')
  process.exit(2)
}

const chapterNumber = Number(argOf('chapter', '1'))
const voice = argOf('voice', 'bm_george')
const out = resolve(argOf('out', 'audio'))
// A bed under the chapter opening. Already mono at the reading's own rate:
// resampling it here would be a routine written in an afternoon standing in
// for one ffmpeg already does properly, and the difference is a bed that
// sounds slightly wrong for reasons nobody can find.
const musicPath = argOf('music')
// How much to read. The whole chapter unless asked otherwise, because a
// preview is for hearing a decision and a book is for listening to.
const paragraphLimit = Number(argOf('paragraphs', '0'))

const { project, assemble, edits, speech, close } = await core(
  'project',
  'assemble',
  'edits',
  'speech'
)

const file = project.parseBookFile(await readFile(resolve(bookPath), 'utf8'))
// Exactly what the app opens: the transcription assembled, then every edit
// re-applied over it. Reading the raw transcription instead would speak a book
// without its corrections, which is the one difference nobody listening could
// detect.
const doc = edits.applyEdits(assemble.assembleBook(file.run.transcriptions), file.run.edits ?? [])

if (chapterNumber < 1 || chapterNumber > doc.chapters.length) {
  // The list, not just the refusal: in a combined volume the entries are not
  // the chapters — "BOOK ONE. THE HUMAN AURA" is a divider, and chapter one of
  // that book is the second entry.
  console.error(`This book has ${doc.chapters.length} chapters; asked for ${chapterNumber}.`)
  doc.chapters.forEach((c, i) => console.error(`  ${i + 1}. ${c.label ?? ''} ${c.title}`.trim()))
  await close()
  // `exit` rather than a code: esbuild's service is still waiting on this
  // process and prints a fatal-looking deadlock under the chapter list if it
  // is left to unwind. A scary error after a successful listing is the kind of
  // noise that stops people reading the useful half.
  process.exit(2)
}

const list = (await listFile('pronunciations')).filter((p) => p.dialect === dialectOf(voice))
const script = speech.readChapter(doc, chapterNumber - 1, list)

// A preview: the opening and the first paragraphs of it. The heading is kept
// whole — it is the thing the music sits under — and the count is of
// paragraphs, since that is what a person asks for.
if (paragraphLimit > 0) {
  const kept = []
  let paragraphs = 0
  for (const piece of script.pieces) {
    if (piece.kind === 'paragraph') {
      if (paragraphs >= paragraphLimit) break
      paragraphs += 1
    }
    if (piece.kind === 'note' || piece.kind === 'note-intro') break
    kept.push(piece)
  }
  // A pause at the end is the gap before a paragraph that is not coming.
  while (kept.length > 0 && kept.at(-1).kind === 'pause') kept.pop()
  script.pieces = kept
  script.words = kept
    .filter((p) => p.text !== undefined)
    .reduce((n, p) => n + p.text.split(/\s+/u).filter(Boolean).length, 0)
}

// After any trimming, so a preview is not measured against the whole chapter.
const expected = speech.expectedSeconds(script)

const label = [script.label, script.title].filter(Boolean).join(' — ')
console.log(`${basename(bookPath)} · chapter ${chapterNumber}: ${label}`)
console.log(
  `${script.words} words, ${script.pieces.filter((p) => p.text).length} pieces, ` +
    `about ${Math.round(expected / 60)} minutes.`
)
if (script.unread.length > 0) {
  // Named, never a count. A count is a number nobody can act on.
  console.log(`\n${script.unread.length} blocks will not be read:`)
  for (const block of script.unread) console.log(`  ${block.id} (${block.kind}) — ${block.why}`)
}

if (hasFlag('script') || !hasFlag('out')) {
  console.log('\n--- what would be read ---')
  for (const piece of script.pieces) {
    if (piece.kind === 'pause') console.log(`  [${piece.seconds}s]`)
    else console.log(`  ${piece.kind}: ${piece.text}`)
  }
  await close()
  process.exit(0)
}

// --- the expensive half -------------------------------------------------

await mkdir(out, { recursive: true })
console.log('\nLoading Kokoro…')
const model = await loadVoice()
console.log(`Loaded in ${model.seconds.toFixed(1)}s.`)

const parts = []
const spoken = []
const truncated = []
// Where the voice stops saying the title, in samples — which is what the music
// is timed from. Not the pause after it: that beat is breathing room, and
// counting it would start the fade a second and a bit late on every chapter.
let headingSamples = 0
let rate = 24000
const started = Date.now()

for (const [index, piece] of script.pieces.entries()) {
  if (piece.kind === 'pause') {
    parts.push(silence(piece.seconds ?? 0, rate))
    continue
  }
  const before = parts.reduce((n, p) => n + p.length, 0)
  const result = await speak({ ...model, speech }, piece.text, voice)
  const why = refuse(result.sound)
  if (why !== null) {
    // Stops rather than skipping. A chapter with one paragraph missing sounds
    // exactly like a chapter, and nothing downstream can tell.
    throw new Error(`piece ${index} (${piece.kind}, ${piece.id ?? '—'}): ${why}`)
  }
  // The tokenizer truncates at the model's limit with no error, so a sentence
  // that cannot fit even alone loses its tail into a book nobody will re-read.
  // Named here rather than counted, because a count is not something anyone can
  // act on.
  for (const long of result.tooLong ?? []) {
    truncated.push({ id: piece.id, phonemes: long.cost, text: long.text })
  }
  rate = result.rate
  parts.push(result.samples)
  if (piece.kind === 'heading') headingSamples = before + result.samples.length
  spoken.push({
    kind: piece.kind,
    id: piece.id,
    text: piece.text,
    phonemes: result.phonemes,
    seconds: result.seconds
  })
  process.stdout.write(`\r  ${spoken.length}/${script.pieces.filter((p) => p.text).length} read`)
}

let voiced = join(parts)
const seconds = voiced.length / rate
const headingEnds = headingSamples / rate
const took = (Date.now() - started) / 1000
console.log(
  `\nRead ${seconds.toFixed(0)}s of audio in ${took.toFixed(0)}s (x${(took / seconds).toFixed(2)}).`
)

if (truncated.length > 0) {
  console.log(`\n${truncated.length} sentences are longer than the model reads in one pass:`)
  for (const long of truncated) {
    console.log(`  ${long.id ?? '—'} (${long.phonemes} phonemes): ${long.text.slice(0, 90)}…`)
  }
  console.log('  Their tails will be missing. Split them in the book, or shorten them.')
}

// Measured against what the words predicted. A chapter that comes back at half
// its expected length has lost something, and without this the only way to find
// out is to listen to all of it.
const drift = Math.abs(seconds - expected) / expected
if (drift > 0.25) {
  console.log(
    `\nWARNING: expected about ${expected.toFixed(0)}s from ${script.words} words and got ` +
      `${seconds.toFixed(0)}s — ${(drift * 100).toFixed(0)}% out. Something may be missing.`
  )
}

// The bed, laid under and timed from the words rather than from a constant.
let opening = null
if (musicPath !== null) {
  const music = readWav(await readFile(resolve(musicPath)), rate)
  opening = speech.planOpening({
    musicSeconds: music.samples.length / rate,
    headingSeconds: headingEnds
  })
  console.log(
    `Music: ${(music.samples.length / rate).toFixed(1)}s under a ${headingEnds.toFixed(1)}s ` +
      `opening — voice at ${opening.voiceAt}s, fading from ${opening.fadeAt.toFixed(1)}s, ` +
      `gone by ${opening.goneAt.toFixed(1)}s.`
  )
  // Said rather than left to be noticed: a bed that ran out mid-note is heard
  // as a fault in the recording rather than in the timing.
  if (opening.short) {
    console.log('  ! There was not enough music to leave after the title; the fade was pulled in.')
  }
  voiced = layMusicUnder(voiced, music.samples, opening, speech.musicGainAt, rate)
}

const stem = clipName(
  `chapter-${String(chapterNumber).padStart(2, '0')}`,
  script.pieces.map((p) => p.text ?? `[${p.seconds}]`).join('\n'),
  voice
)
await writeFile(resolve(out, `${stem}.wav`), wav(voiced, rate))
await writeFile(
  resolve(out, `${stem}.json`),
  `${JSON.stringify(
    {
      book: basename(bookPath),
      chapter: chapterNumber,
      title: script.title,
      label: script.label,
      voice,
      seconds,
      expectedSeconds: expected,
      words: script.words,
      opening,
      unread: script.unread,
      truncated,
      pieces: spoken
    },
    null,
    1
  )}\n`
)
console.log(`Written to ${resolve(out, `${stem}.wav`)}`)
await close()
