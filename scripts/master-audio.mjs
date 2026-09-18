#!/usr/bin/env node
/**
 * A rendered chapter, brought to the loudness an audiobook is published at.
 *
 * ## Why this is worth a step of its own
 *
 * Raw model output sits at whatever level the model felt like, and that is a
 * surprising amount of what separates a text-to-speech file from a recording.
 * Audible's own requirement for a submitted audiobook is **-23 to -18 LUFS**
 * integrated with a true peak no higher than **-3 dBFS**; -19 sits in the
 * middle of that band with room either side. Nothing here changes the reading
 * — it changes only how loud it is and how consistently, which is the part a
 * listener notices immediately and cannot name.
 *
 * ## Why two passes
 *
 * `loudnorm` in its one-pass form adjusts as it goes, so on a quiet passage the
 * gain audibly rises underneath the reader. Measuring the whole file first and
 * then applying one fixed correction is the difference between a recording
 * that sounds level and one that sounds like it is being ridden.
 *
 *   node scripts/master-audio.mjs rendered/ audio/
 *
 * Reports what it measured before and after, because a mastering step that
 * silently did nothing looks exactly like one that worked.
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expectedTags, tagsFor } from './audio-tags.mjs'

const run = promisify(execFile)

/** Audible's band, and the middle of it. */
export const TARGET = { I: -19, TP: -3, LRA: 7 }

/**
 * What `loudnorm` is asked for, which is not the target.
 *
 * An MP3 overshoots the true peak of what it was given by up to half a
 * decibel — measured: asked for -3, the encoded file came back at -2.67 and
 * failed the check it had just been mastered to pass. So the ask sits half a
 * decibel under the ceiling and the *check* stays at the ceiling, which is
 * Audible's and not ours to move.
 */
export const ASK = { ...TARGET, TP: TARGET.TP - 0.5 }

/**
 * What ffmpeg makes of a file's loudness.
 *
 * `loudnorm` prints its JSON to stderr among everything else it has to say, so
 * the object is cut out by its braces rather than by hoping it is alone.
 */
export async function measure(file) {
  const filter = `loudnorm=I=${ASK.I}:TP=${ASK.TP}:LRA=${ASK.LRA}:print_format=json`
  const { stderr } = await run('ffmpeg', [
    '-nostdin',
    '-hide_banner',
    '-i',
    file,
    '-af',
    filter,
    '-f',
    'null',
    '-'
  ])
  const from = stderr.lastIndexOf('{')
  const to = stderr.lastIndexOf('}')
  if (from < 0 || to < from) throw new Error(`ffmpeg printed no measurement for ${file}`)
  return JSON.parse(stderr.slice(from, to + 1))
}

/**
 * The tags a file actually carries, read back with ffprobe. What ffmpeg was
 * asked for is not evidence of what it wrote — a container that does not take
 * a tag drops it without a word — so the file is asked.
 */
export async function tagsOn(file) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format_tags',
    '-of',
    'json',
    file
  ])
  const tags = JSON.parse(stdout).format?.tags ?? {}
  // ffprobe reports keys as it finds them, and ID3 round-trips them in a case
  // of its own choosing.
  return Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]))
}

/** The second pass: one fixed correction, from what the first pass measured. */
export function correctionFrom(measured) {
  return [
    `loudnorm=I=${ASK.I}`,
    `TP=${ASK.TP}`,
    `LRA=${ASK.LRA}`,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
    'print_format=summary'
  ].join(':')
}

/** Inside Audible's band, or not — said plainly rather than left to be read. */
export function withinBand(loudness, peak) {
  const reasons = []
  if (!(loudness >= -23 && loudness <= -18)) {
    reasons.push(`${loudness} LUFS is outside the -23 to -18 an audiobook is published at`)
  }
  if (!(peak <= -3)) reasons.push(`a true peak of ${peak} dBFS is above the -3 ceiling`)
  return reasons
}

/** The reader's record beside a rendering, or null where there is none. */
async function recordBeside(wavPath) {
  try {
    return JSON.parse(await readFile(wavPath.replace(/\.wav$/u, '.json'), 'utf8'))
  } catch {
    return null
  }
}

const from = resolve(process.argv[2] ?? 'rendered')
const into = resolve(process.argv[3] ?? 'audio')
const bitrate = process.argv[4] ?? '64k'

await mkdir(into, { recursive: true })
const waves = (await readdir(from)).filter((n) => n.endsWith('.wav'))
if (waves.length === 0) {
  console.error(`Nothing to master in ${from}.`)
  process.exit(1)
}

for (const name of waves) {
  const source = resolve(from, name)
  const target = resolve(into, `${basename(name, '.wav')}.mp3`)

  const before = await measure(source)
  console.log(
    `${name}: ${before.input_i} LUFS, true peak ${before.input_tp} dBFS, range ${before.input_lra}`
  )

  // The record the reader wrote beside the rendering names the book, the
  // author and the chapter; a rendering with no record beside it gets the
  // file's own name as its title, and says so, rather than nothing.
  const record = await recordBeside(source)
  if (!record) console.log(`  ! no record beside ${name}; tagged by its file name only`)
  const tags = tagsFor(record ?? { title: basename(name, '.wav') })

  await run('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    source,
    '-af',
    correctionFrom(before),
    '-codec:a',
    'libmp3lame',
    '-b:a',
    bitrate,
    '-ac',
    '1',
    ...tags,
    target
  ])

  // Read back off the file, not off the arguments. A tag asked for and not
  // written is a chapter that shows up in a player as "chapter-03".
  const written = await tagsOn(target)
  const wanted = expectedTags(record ?? { title: basename(name, '.wav') })
  const missing = Object.entries(wanted).filter(([k, v]) => written[k] !== v)
  if (missing.length > 0) {
    console.error(`  ! ${name}: tags not written: ${missing.map(([k]) => k).join(', ')}`)
    console.error(`    wanted ${JSON.stringify(wanted)}\n    found  ${JSON.stringify(written)}`)
    process.exitCode = 1
  } else {
    console.log(
      `  tagged: ${written.title} · ${written.album ?? '(no album)'} · ${written.artist ?? '(no artist)'} · track ${written.track ?? '?'}`
    )
  }

  // Measured again on the file that will actually be listened to, not on the
  // intermediate: the encode is part of what could put it out of band, and a
  // check that stops before the last step is a check of something else.
  const after = await measure(target)
  const loudness = Number(after.input_i)
  const peak = Number(after.input_tp)
  const problems = withinBand(loudness, peak)
  console.log(
    `  → ${after.input_i} LUFS, true peak ${after.input_tp} dBFS` +
      (problems.length === 0 ? ' — inside the band an audiobook is published at.' : '')
  )
  // Reported, never assumed. A mastering step that silently did nothing looks
  // exactly like one that worked.
  for (const problem of problems) console.log(`  ! ${problem}`)
}
console.log(`\n${waves.length} mastered into ${into}.`)
