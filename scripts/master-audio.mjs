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
import { mkdir, readdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Audible's band, and the middle of it. */
export const TARGET = { I: -19, TP: -3, LRA: 7 }

/**
 * What ffmpeg makes of a file's loudness.
 *
 * `loudnorm` prints its JSON to stderr among everything else it has to say, so
 * the object is cut out by its braces rather than by hoping it is alone.
 */
export async function measure(file) {
  const filter = `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}:print_format=json`
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

/** The second pass: one fixed correction, from what the first pass measured. */
export function correctionFrom(measured) {
  return [
    `loudnorm=I=${TARGET.I}`,
    `TP=${TARGET.TP}`,
    `LRA=${TARGET.LRA}`,
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
    target
  ])

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
