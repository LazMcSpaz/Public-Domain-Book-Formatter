/**
 * The editor's voice, from outside the tab.
 *
 * The voice card was built to be filled in at a gate and rendered into a
 * prompt. Now that the books are made in a conversation (see **How the work is
 * actually done** in CLAUDE.md), the writing happens where there is no gate to
 * fill in and no prompt to render — and the part of the design that made the
 * voice *improve*, exemplars accreting from notes the editor accepted, had no
 * way to happen at all. A note approved in chat taught nothing.
 *
 * So this reads and writes the voice file on the shelf, and banks accepted
 * notes through the same `withExemplar` the app uses. Two rules shape it:
 *
 * **One implementation.** Nothing here reimplements `withExemplar`,
 * `normalizeVoice` or `voiceBlock`. The real modules are loaded through vite's
 * `ssrLoadModule`, which resolves `@core` from the same config the app builds
 * with, so this cannot drift from what the app does — a second copy of the
 * exemplar cap would be a voice that behaved differently depending on which
 * door it came through.
 *
 * **No browser and no token.** The voice is a small JSON file in a git
 * repository the user already has cloned; render, OCR and layout need Chromium
 * and this does not. It edits the working tree and leaves committing and
 * pushing to git, which is also what makes every change to the editor show up
 * in a diff before it is published.
 *
 * Usage:
 *   node scripts/voice.mjs show                     # the voice as stored
 *   node scripts/voice.mjs card                     # what the model is actually told
 *   node scripts/voice.mjs set about "..."          # penName|about|guidance|density|maxWords
 *   node scripts/voice.mjs set about --file about.txt   # for anything with paragraphs in it
 *   node scripts/voice.mjs avoid "Never do X" ...   # append refusals (--clear to empty)
 *   node scripts/voice.mjs learn --passage "..." --note "..."
 *   node scripts/voice.mjs learn-file accepted.json # [{ passage, note }, ...]
 *   node scripts/voice.mjs check notes.json body.json
 *
 * The shelf is $SHELF_DIR, or --shelf <dir>. The editor is --name <pen name>,
 * defaulting to whoever the file already names.
 */
import { createServer } from 'vite'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const argv = process.argv.slice(2)
const verb = argv[0]

/** `--flag value` anywhere in the arguments; the rest are positional. */
function flags(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a?.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else {
        out[key] = next
        i++
      }
    } else out._.push(a)
  }
  return out
}

const opts = flags(argv.slice(1))
const SHELF = resolve(opts.shelf ?? process.env.SHELF_DIR ?? '.')

/** The real modules, transformed by vite so `@core` means what it means. */
async function core() {
  const server = await createServer({
    root: resolve(import.meta.dirname, '..'),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
  })
  const annotate = await server.ssrLoadModule('@core/annotate')
  const sync = await server.ssrLoadModule('@core/sync')
  return { annotate, sync, close: () => server.close() }
}

/**
 * Which file holds the editor.
 *
 * With a name given, the name decides — that is how a second editor is started.
 * With none, the single voice already on the shelf is it, because asking a
 * person to retype their own pen name to read it back is the kind of friction
 * this whole app exists to remove. Two on the shelf and no name given is
 * genuinely ambiguous and says so.
 */
async function voiceFile(sync, name) {
  if (name) return resolve(SHELF, sync.voicePath(name))
  const dir = resolve(SHELF, sync.VOICE_ROOT)
  let entries = []
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    /* no voice directory yet */
  }
  if (entries.length === 1) return resolve(dir, entries[0])
  if (entries.length === 0) return resolve(SHELF, sync.voicePath(''))
  throw new Error(
    `${entries.length} editors on this shelf (${entries.join(', ')}). Say which with --name.`
  )
}

async function load(annotate, path) {
  try {
    return annotate.normalizeVoice(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return annotate.defaultVoice()
  }
}

async function save(path, voice) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(voice, null, 2)}\n`)
  return path
}

const { annotate, sync, close } = await core()
try {
  const path = await voiceFile(sync, typeof opts.name === 'string' ? opts.name : '')
  const voice = await load(annotate, path)

  if (!verb || verb === 'show') {
    console.log(JSON.stringify(voice, null, 2))
  } else if (verb === 'card') {
    // What the model is actually told, as against what the file says. These
    // differ in ways worth seeing: an empty `about` contributes no line at all,
    // and only the last MAX_EXEMPLARS make the trip.
    console.log(annotate.voiceBlock(voice))
  } else if (verb === 'set') {
    const [field, ...rest] = opts._
    // `--file` because `about` and `guidance` are paragraphs, and a paragraph
    // typed at a shell loses its line breaks and fights the quoting. The whole
    // point of these two fields is that they are prose.
    const value =
      typeof opts.file === 'string'
        ? (await readFile(resolve(opts.file), 'utf8')).trim()
        : rest.join(' ')
    if (!annotate.VOICE_KEYS.includes(field)) {
      throw new Error(`No such field: ${field}. One of ${annotate.VOICE_KEYS.join(', ')}.`)
    }
    if (field === 'avoid' || field === 'exemplars' || field === 'kinds') {
      throw new Error(`${field} is a list — use the \`${field}\` verb.`)
    }
    const next = annotate.normalizeVoice({
      ...voice,
      [field]: field === 'maxWords' ? Number(value) : value
    })
    console.log(`${field}: ${JSON.stringify(next[field])}\n→ ${await save(path, next)}`)
  } else if (verb === 'avoid') {
    const lines = opts._.filter(Boolean)
    const next = annotate.normalizeVoice({
      ...voice,
      avoid: opts.clear ? [] : [...voice.avoid, ...lines]
    })
    console.log(`${next.avoid.length} refusal(s)\n→ ${await save(path, next)}`)
  } else if (verb === 'learn') {
    const passage = typeof opts.passage === 'string' ? opts.passage : ''
    const note = typeof opts.note === 'string' ? opts.note : opts._.join(' ')
    if (!note.trim()) throw new Error('Nothing to learn: pass --note.')
    // The note *as accepted*, which is the whole point — a note the editor
    // rewrote teaches the rewrite, and a rejected one teaches nothing.
    const next = annotate.withExemplar(voice, { passage, note })
    console.log(`${next.exemplars.length} exemplar(s)\n→ ${await save(path, next)}`)
  } else if (verb === 'learn-file') {
    const accepted = JSON.parse(await readFile(resolve(opts._[0]), 'utf8'))
    const next = accepted.reduce(
      (v, e) => annotate.withExemplar(v, { passage: e.passage ?? '', note: e.note ?? '' }),
      voice
    )
    console.log(`${next.exemplars.length} exemplar(s)\n→ ${await save(path, next)}`)
  } else if (verb === 'check') {
    // The deterministic half, and the reason notes written in a conversation
    // are held to the same standard as notes bought from the API: every date,
    // figure and name a note asserts that the book itself never states comes
    // back as the list to check. It does not care who wrote the note.
    const proposals = JSON.parse(await readFile(resolve(opts._[0]), 'utf8'))
    const body = JSON.parse(await readFile(resolve(opts._[1]), 'utf8'))
    const blocks = new Map((body.edited ?? body).map((b) => [b.id, b.text]))
    const bookText = [...blocks.values()].join('\n')
    const checked = annotate.checkProposals(proposals, blocks, bookText)
    for (const c of checked) {
      const placed = c.at === null ? 'ANCHOR NOT FOUND' : `at ${c.at}`
      const claims = c.outsideClaims.length ? ` — check: ${c.outsideClaims.join(', ')}` : ''
      console.log(`${c.blockId} ${placed}${claims}`)
    }
    const lost = checked.filter((c) => c.at === null).length
    const flagged = checked.filter((c) => c.outsideClaims.length > 0).length
    console.log(`\n${checked.length} note(s): ${lost} unplaced, ${flagged} with claims to check.`)
  } else {
    throw new Error(`Unknown verb: ${verb}`)
  }
} finally {
  await close()
}
