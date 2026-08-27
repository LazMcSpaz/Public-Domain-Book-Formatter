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
 *   node scripts/voice.mjs harvest                  # bank the shelf's own accepted work
 *   node scripts/voice.mjs prose                    # what front matter is banked
 *   node scripts/voice.mjs prose --file piece.md    # bank one passage by hand
 *   node scripts/voice.mjs compile                  # the card as .claude/agents/etsu.md
 *   node scripts/voice.mjs brief <book-dir>         # the dossier, and ask for a shape
 *   node scripts/voice.mjs brief <book-dir> --stage write --outline o.md
 *   node scripts/voice.mjs audit book.json          # the bias pass, after the writing
 *   node scripts/voice.mjs check notes.json body.json
 *
 * `harvest` → `compile` is the loop that makes the editor better: the shelf's
 * approved work becomes the card, and the card becomes the writer.
 *
 * The shelf is $SHELF_DIR, or --shelf <dir>. The editor is --name <pen name>,
 * defaulting to whoever the file already names.
 */
import { createServer } from 'vite'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

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
  // `brief` assembles the book here rather than in the browser. Both modules
  // are pure by the rule that governs `src/core`, so a briefing needs no
  // Chromium — which matters, because a writer waiting on a render is a writer
  // being asked to hurry.
  const assemble = await server.ssrLoadModule('@core/assemble')
  const edits = await server.ssrLoadModule('@core/edits')
  return { annotate, sync, assemble, edits, close: () => server.close() }
}

/** Every book directory on the shelf, in a stable order. */
async function shelfBooks() {
  const root = resolve(SHELF, 'books')
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => resolve(root, e.name))
      .sort()
  } catch {
    return []
  }
}

/**
 * The card as a subagent definition.
 *
 * The framing here is the compiler's and the substance is the card's. What the
 * compiler owns is the craft that is the same for any editor: that the writer
 * is the man rather than someone impersonating him, that the briefing is the
 * only source of fact, and the notation the prose comes back in. What the card
 * owns is who he is, how he writes, what he refuses and how he sounds.
 */
function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
}

function compileAgent(voice, annotate) {
  const name = voice.penName.trim() || 'the editor'
  const lines = [
    '---',
    'name: etsu',
    `description: Writes front matter and notes as ${name}, the editor of the Libri Vetus occult reprints. Use for an introduction, a glossary preamble, a footnote, or any prose the editor signs rather than transcribes. Give it the book's facts; it supplies the voice.`,
    'model: opus',
    'tools: Read, Write, Bash, Grep, Glob',
    '---',
    '',
    'DO NOT EDIT. Generated from the voice card by `node scripts/voice.mjs compile`.',
    'Change the card on the shelf and compile again; an edit here is lost on the',
    'next compile and, until then, is a voice nobody approved.',
    '',
    `You are **${name}**. You are not an assistant writing in a persona. You are`,
    'the editor, and this is your book. Write as yourself.',
    ''
  ]
  if (voice.about.trim()) lines.push('# Who you are', '', voice.about.trim(), '')
  if (voice.guidance.trim()) lines.push('# How you write', '', voice.guidance.trim(), '')
  const avoid = voice.avoid.map((a) => a.trim()).filter(Boolean)
  if (avoid.length > 0) {
    lines.push('# What you never do', '', ...avoid.map((a) => `- ${a}`), '')
  }
  const samples = voice.proseSamples.slice(-annotate.MAX_PROSE_SAMPLES)
  if (samples.length > 0) {
    lines.push(
      '# Your own prose, as a model of the register',
      '',
      'These passages are yours, from books already in print. They are the',
      'calibration for everything you write. Match their pace, their plainness,',
      'and their willingness to raise an uncomfortable fact and then leave it',
      'alone. Do not match their subject and do not reuse their sentences.',
      ''
    )
    for (const sample of samples) lines.push('```', sample.trim(), '```', '')
  }
  const exemplars = voice.exemplars.slice(-annotate.MAX_EXEMPLARS)
  if (exemplars.length > 0) {
    lines.push(
      '# Notes you have already approved',
      '',
      'The same voice at note length, which is a different job from front',
      'matter: forty words, hung on a phrase, read by somebody who has just',
      'opened the book.',
      ''
    )
    for (const ex of exemplars) {
      if (ex.passage.trim()) lines.push(`> ${ex.passage.trim()}`, '')
      lines.push(ex.note.trim(), '')
    }
  }
  lines.push(
    '# The job',
    '',
    "You will be given a briefing with the book's verified facts and, often, an",
    'earlier draft you are replacing. Work **only** from what you are given. You',
    'may reuse any fact in the briefing. You may not invent a date, a figure, a',
    'name, a title or an incident that is not there. If you want a fact the',
    'briefing does not carry, say so in a line at the end under `QUERIES:`',
    'rather than reaching for something plausible.',
    '',
    'The briefing arrives at one of two stages and says which.',
    '',
    '**The shape comes first.** An outline briefing asks for the shape of the',
    'piece and not the piece. Give it as notes, never as paragraphs and never',
    'with a sample of the prose in it: an outline that sounds good is approved',
    'for its sound, and a phrase you have already written is a phrase you will',
    'write to instead of writing to the book. A finished introduction is very',
    'hard to argue with, which is the reason for the stage — the objection that',
    'a paragraph is the contents page set as prose costs a line here and a',
    'rewrite later.',
    '',
    '**Then the writing.** A writing briefing carries the shape the editor',
    'approved, which may not be the one you proposed. It is approved: do not',
    'redesign it. If a movement turns out not to be carried by the material,',
    'write the rest and say so under `QUERIES:` rather than quietly filling it',
    'or quietly dropping it.',
    '',
    'Where you are given findings on an earlier draft, they are places to look',
    'and not sentences to paste. Rewrite the passage; never patch it. A patched',
    "sentence is in the patcher's voice, and the whole point of your existing is",
    'that the prose is in yours.',
    '',
    'Notation: the prose is plain text. Paragraphs are separated by a single',
    'newline. Use `<i>` and `</i>` for italic, `<b>` and `</b>` for bold, and',
    'nothing else. Book titles take italic. Do not use bold at all in short',
    'front matter.',
    '',
    'Write the piece and nothing else. No preamble, no summary of what you did,',
    'no offer to revise. The prose is the deliverable.',
    '',
    '# How this file is used',
    '',
    'Claude Code loads `.claude/agents/*.md` at session start, so a session that',
    'has just compiled this cannot invoke `etsu` as an agent type. Point a',
    'general-purpose agent at this path and tell it to read the file and adopt',
    'it; from the next session on, `etsu` is available by name.',
    '',
    `The voice itself lives on the shelf, at \`voice/${slug(name)}.json\`, which is`,
    "what the app's own annotation pass reads. This file is that card compiled",
    'into a system prompt.',
    ''
  )
  return lines.join('\n')
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

/** A refusal meant for a person: printed as its message, never as a stack. */
class Refusal extends Error {}

const { annotate, sync, assemble, edits, close } = await core()
try {
  const path = await voiceFile(sync, typeof opts.name === 'string' ? opts.name : '')
  const voice = await load(annotate, path)

  if (!verb || verb === 'show') {
    console.log(JSON.stringify(voice, null, 2))
  } else if (verb === 'card') {
    // What the model is actually told, as against what the file says. These
    // differ in ways worth seeing: an empty `about` contributes no line at all,
    // and only the last MAX_EXEMPLARS make the trip.
    //
    // Both halves, because the whole point of this verb is that it shows what
    // reaches a model and there are two prompts. The prose samples go only to
    // the introduction and the exemplars go to both; a `card` that printed one
    // block would be the same quiet omission that kept `proseSamples` out of
    // every prompt for as long as the field existed.
    console.log(annotate.voiceBlock(voice))
    const prose = annotate.proseBlock(voice)
    console.log(
      prose
        ? `\n--- and, when the editor is writing front matter rather than notes ---\n\n${prose}`
        : '\n(No front matter banked, so nothing extra reaches the introduction. Run `harvest`.)'
    )
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
  } else if (verb === 'audit') {
    // The pass that runs *after* the writing, because the writer cannot be
    // asked. Takes a book file (auditing every section and note the editor has
    // added to it) or any file of prose.
    const target = resolve(opts._[0] ?? '.')
    const raw = await readFile(target, 'utf8')
    let prose = raw
    let what = target
    if (target.endsWith('.json')) {
      const book = JSON.parse(raw)
      const edits = book.run?.edits ?? book.edits ?? []
      const written = edits.filter((e) => e.kind === 'section' || e.kind === 'note')
      prose = written.map((e) => e.text).join('\n\n')
      what = `${written.length} section(s) and note(s) in ${target}`
    }
    const audit = annotate.auditProse(prose)
    // The first person is asked of the editor's front matter only. A glossary
    // is impersonal on purpose, and the whole file concatenated together would
    // pass on one "I" in a footnote.
    let frontAudit = null
    if (target.endsWith('.json')) {
      const book = JSON.parse(raw)
      const front = (book.run?.edits ?? book.edits ?? []).find(
        (e) => e.kind === 'section' && e.placement === 'front'
      )
      if (front)
        frontAudit = {
          title: front.title,
          ...annotate.auditProse(front.text, { firstPerson: true })
        }
    }
    const { tradition, science } = audit.sentences
    console.log(what)
    console.log(
      `  ${audit.sentences.total} sentences — ${tradition} on the tradition, ${science} on the science`
    )
    console.log(`  hedged: ${audit.hedges.tradition} vs ${audit.hedges.science}`)
    if (audit.ratio === null) {
      console.log(
        `  ratio: not enough of one side to say (needs ${annotate.MIN_SENTENCES} sentences each)`
      )
    } else {
      const verdict = audit.ratio > annotate.HEDGE_RATIO_LIMIT ? 'LEANING' : 'even'
      console.log(
        `  ratio: ${audit.ratio.toFixed(2)} (${verdict}; limit ${annotate.HEDGE_RATIO_LIMIT})`
      )
    }
    const { tradition: ot, science: os } = audit.openings
    console.log(`  openings: ${ot} on the tradition, ${os} on the science`)
    console.log(
      `  hedged openings: ${audit.openingHedges.tradition} vs ${audit.openingHedges.science}`
    )
    if (audit.openingRatio === null) {
      console.log('  opening ratio: not enough openings of one kind to say')
    } else {
      const v = audit.openingRatio > annotate.HEDGE_RATIO_LIMIT ? 'LEANING' : 'even'
      const shown = audit.openingRatio > 999 ? '∞' : audit.openingRatio.toFixed(2)
      console.log(`  opening ratio: ${shown} (${v}) — where a definition is made`)
    }
    const r = audit.reading
    console.log(
      `  reading: grade ${r.grade.toFixed(1)}, ${r.wordsPerSentence.toFixed(1)} words/sentence`
    )
    const c = audit.concreteness
    console.log(
      `  concreteness: ${c.perThousand.toFixed(0)} names and figures per 1000 words ` +
        `(${c.properNouns} names, ${c.numerals} numerals; the editor's own runs about 67)`
    )
    const ph = audit.placeholders
    if (ph.findings.length > 0) {
      const verdict = ph.overLimit ? 'OVER' : 'within'
      console.log(
        `  placeholder openers: ${ph.findings.length} (${(ph.rate * 100).toFixed(0)}%, ${verdict}; ` +
          `the editor's own runs ${(annotate.PLACEHOLDER_OPENER_BASELINE * 100).toFixed(0)}%, ` +
          `limit ${(annotate.PLACEHOLDER_OPENER_LIMIT * 100).toFixed(0)}%)`
      )
      // Listed only when over, because below the limit the construction is
      // doing its job and a list of eleven good sentences trains a person to
      // stop reading the report.
      if (ph.overLimit) {
        for (const f of ph.findings) console.log(`    “${f.match}” — ${f.sentence.slice(0, 100)}`)
      }
    }
    const dashes = audit.findings.filter((f) => f.kind === 'dash')
    if (dashes.length > 0)
      console.log(`  DASHES: ${dashes.length} — none belong in this editor's prose`)
    // Every kind the audit can raise. A finding the report does not print is a
    // check that says NEEDS A LOOK and will not say at what.
    for (const kind of ['dismissal', 'banned', 'direction']) {
      for (const f of audit.findings.filter((x) => x.kind === kind)) {
        console.log(`  ${kind.toUpperCase()} “${f.match}” — ${f.sentence.slice(0, 110)}`)
      }
    }
    // Shown by default, because each one is a decision only a person can make:
    // an established teaching stated plainly, or a contested claim reported as
    // one. No word list can tell them apart.
    if (audit.hedgedTeaching.length > 0) {
      console.log(`\n  ${audit.hedgedTeaching.length} hedge(s) on the tradition — read each:`)
      for (const f of audit.hedgedTeaching) {
        console.log(`    “${f.match}” in: ${f.sentence.slice(0, 120)}`)
      }
    }
    if (opts.hedges) {
      for (const f of audit.findings.filter((x) => x.kind === 'hedge' && !x.tradition)) {
        console.log(`  hedge (science) “${f.match}” — ${f.sentence.slice(0, 110)}`)
      }
    }
    if (audit.flatStretches.length > 0) {
      console.log(
        `\n  ${audit.flatStretches.length} flat stretch(es), three or more sentences in one length band.`
      )
      console.log('  Reported, not enforced: the voice’s own model passage breaks this rule.')
      for (const f of audit.flatStretches.slice(0, 5)) {
        console.log(`    ${f.match}: ${f.sentence.slice(0, 100)}`)
      }
    }
    if (frontAudit) {
      const lost = frontAudit.findings.filter((f) => f.kind === 'person')
      console.log(
        lost.length > 0
          ? `\n  “${frontAudit.title}” is not in the first person. One man is meant to be speaking.`
          : `\n  “${frontAudit.title}” speaks in the first person.`
      )
      if (lost.length > 0) process.exitCode = 1
    }
    console.log(audit.clean ? '\n  CLEAN' : '\n  NEEDS A LOOK')
    // The exit code is the point: this belongs in a checklist, not in a habit.
    if (!audit.clean) process.exitCode = 1
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
  } else if (verb === 'harvest') {
    // The corpus the shelf has been accumulating and nothing has ever read.
    //
    // `exemplars` was designed to accrete from accepted notes and `proseSamples`
    // from accepted front matter, and both accrete only where there is a gate to
    // accept at. The books are made in a conversation now, so nothing ever
    // called `withExemplar`: four published books, fifty-seven approved notes and
    // four introductions sat on the shelf while the card carried an empty list
    // and one passage. This is the missing hand.
    //
    // It reads `book.json` and never the readable files. `introduction.md` is a
    // *view* of the book and drifts from it; banking a view would teach the
    // editor a version of his own prose that is not the one in print.
    //
    // **The books have to be named.** The first version of this verb took the
    // whole shelf, and that quietly asserted the thing this file most needed to
    // get right: that a book going out is the editor approving its prose. It is
    // not. Of the four introductions on this shelf the editor stands behind one
    // and has the other three down for rewriting, and a card built from all four
    // teaches the writer to produce more of what is being rewritten — while
    // looking, from the outside, exactly like a voice improving. There is no
    // measurement that catches that. Only the editor knows, so only the editor
    // says.
    const dirs = opts._.map((d) => resolve(d))
    if (dirs.length === 0) {
      const available = await shelfBooks()
      console.error('Name the books whose prose you approve. Shipping one is not approving it.\n')
      for (const d of available) console.error(`  ${basename(d)}`)
      console.error(
        `\n  node scripts/voice.mjs harvest <book-dir> [<book-dir>...] [--notes]\n` +
          `  --notes also banks that book's notes. Front matter and notes are\n` +
          `  approved separately, because an introduction you would sign and a\n` +
          `  note you would sign are two different judgements.`
      )
      throw new Refusal('')
    }

    let next = voice
    const banked = []
    const offeredProse = []
    for (const dir of dirs) {
      let book
      try {
        book = JSON.parse(await readFile(resolve(dir, 'book.json'), 'utf8'))
      } catch {
        console.log(`  ${basename(dir)}: no book.json, skipped`)
        continue
      }
      const edits = book.run?.edits ?? book.edits ?? []
      const front = edits.filter((e) => e.kind === 'section' && e.placement === 'front')
      const notes = edits.filter((e) => e.kind === 'note' && (e.text ?? '').trim())
      for (const f of front) offeredProse.push((f.text ?? '').trim())
      if (!opts.notes) notes.length = 0
      // Banked without the passage. A note's anchor is a character offset into
      // an *assembled* block, and a leaf's text is not a block's text, so the
      // words it hangs on cannot be recovered from the book file alone. The
      // register is what an exemplar teaches, and the register is in the note.
      for (const n of notes) next = annotate.withExemplar(next, { passage: '', note: n.text })
      banked.push({ dir: basename(dir), front: front.length, notes: notes.length })
    }

    // A passage already banked that no book on the shelf contains was put there
    // by hand, and a hand-banked passage is the editor telling the writer how to
    // sound rather than a by-product of a book going out. It outranks anything
    // harvested and is fed last so the cap cannot reach it.
    //
    // This is not hypothetical. The first run of this verb dropped the only
    // sample of the editor's own unpublished hand — three published
    // introductions pushed it out — and said `3 of 4 kept` while doing it. The
    // cap was right and the report was true; what was missing was any way to
    // tell one kind of passage from the other.
    const handBanked = voice.proseSamples.filter((s) => !offeredProse.includes(s.trim()))
    for (const text of [...offeredProse, ...handBanked]) {
      next = annotate.withProseSample(next, text)
    }
    const crowdedOut =
      handBanked.length - next.proseSamples.filter((s) => handBanked.includes(s)).length

    for (const b of banked) {
      console.log(`  ${b.dir}: ${b.front} front, ${b.notes} note(s)`)
    }
    // What the caps dropped, said out loud. A guard that silently keeps three
    // of eleven is a guard that reads as "everything was taken".
    const offeredNotes = banked.reduce((n, b) => n + b.notes, 0)
    console.log(
      `\n${next.proseSamples.length} of ${offeredProse.length + handBanked.length} passage(s) kept ` +
        `(cap ${annotate.MAX_PROSE_SAMPLES}; ${handBanked.length} banked by hand and kept first), ` +
        `${next.exemplars.length} of ${offeredNotes} note(s) kept (cap ${annotate.MAX_EXEMPLARS}).`
    )
    console.log('Otherwise kept are the newest offered, which is the order the books were read in.')
    // What a cap dropped, by its opening words, because a passage that fell off
    // the end is a decision and reads exactly like nothing having happened.
    for (const text of offeredProse) {
      if (!next.proseSamples.includes(text)) {
        console.log(`  dropped: ${text.slice(0, 70).replace(/\s+/gu, ' ')}…`)
      }
    }
    if (crowdedOut > 0) {
      console.error(
        `\n${crowdedOut} hand-banked passage(s) no longer fit. Raise the cap or drop one on purpose.`
      )
      process.exitCode = 1
    }
    if (opts.dry) console.log('\n--dry: nothing written.')
    else console.log(`→ ${await save(path, next)}`)
  } else if (verb === 'prose') {
    // One passage, by hand, for prose accepted in a conversation rather than
    // landed in a book — a glossary preamble, a piece the editor rewrote.
    if (opts.clear) {
      const next = annotate.normalizeVoice({ ...voice, proseSamples: [] })
      console.log(`0 passage(s)\n→ ${await save(path, next)}`)
    } else if (typeof opts.file === 'string') {
      const text = (await readFile(resolve(opts.file), 'utf8')).trim()
      const next = annotate.withProseSample(voice, text)
      console.log(`${next.proseSamples.length} passage(s)\n→ ${await save(path, next)}`)
    } else {
      if (voice.proseSamples.length === 0) console.log('No prose banked. Run `harvest`.')
      for (const [i, s] of voice.proseSamples.entries()) {
        const words = s.split(/\s+/u).filter(Boolean).length
        console.log(`${i + 1}. ${words} words — ${s.slice(0, 90).replace(/\s+/gu, ' ')}…`)
      }
    }
  } else if (verb === 'brief') {
    // The dossier a writer is handed, rendered by the module the API path uses.
    //
    // This is the whole of it. There is no second briefing builder here and
    // there must not be: `buildIntroductionPrompt` already decides what a
    // writer may see — the book's shape, evenly spaced extracts so no chapter
    // dominates, the rulings the editor marked `mention` — and a hand-typed
    // briefing is a second implementation of that judgement that will be
    // thinner every time somebody is in a hurry.
    //
    // The voice is deliberately *not* in it. The compiled agent is the card;
    // sending the card again would put two copies in one context, and two
    // copies are two things that can disagree.
    const dir = resolve(opts._[0] ?? '.')
    const book = JSON.parse(await readFile(resolve(dir, 'book.json'), 'utf8'))
    const run = book.run ?? book
    const doc = edits.applyEdits(assemble.assembleBook(run.transcriptions ?? []), run.edits ?? [])
    // Where the title lives depends on how far through the flow the book got.
    // Of the five books on this shelf, two carry it in `identityAnswers`, two
    // in the export answers and one nowhere at all — so all of them are read,
    // and what is still missing is *said*. A briefing that quietly omits the
    // year is a briefing that invites the writer to supply one.
    const id = run.identityAnswers ?? {}
    const exported = book.answers?.export ?? {}
    const facts = {
      title: exported.title || id.title || '',
      author: exported.author || id.author || '',
      originalYear: exported.originalYear || id.year || '',
      context: typeof opts.context === 'string' ? opts.context : ''
    }
    const missing = ['title', 'author', 'originalYear'].filter((k) => !facts[k].trim())
    const length = typeof opts.length === 'string' ? opts.length : 'standard'
    const { user } = annotate.buildIntroductionPrompt(doc, {
      voice,
      facts,
      length,
      brief: typeof opts.want === 'string' ? opts.want : '',
      rulings: run.rulings ?? []
    })

    // Outline first, and it is the default rather than the option, because a
    // flow that has to be remembered is a flow that skips — which is how this
    // shelf ended up with a book carrying no glossary marks and nothing
    // anywhere saying so.
    const stage = typeof opts.stage === 'string' ? opts.stage : 'outline'
    if (stage !== 'outline' && stage !== 'write') {
      throw new Refusal(`--stage is outline or write, not ${stage}.`)
    }
    let approved = ''
    if (stage === 'write') {
      if (typeof opts.outline !== 'string') {
        throw new Refusal(
          'Writing needs an approved outline: --outline <file>.\n' +
            'Run the outline stage first and let the editor change it. If a piece\n' +
            'is genuinely small enough not to want one, say so with --outline none.'
        )
      }
      approved =
        opts.outline === 'none' ? '' : (await readFile(resolve(opts.outline), 'utf8')).trim()
    }

    const task =
      stage === 'outline'
        ? annotate.introductionOutlineTask(length)
        : annotate.introductionTask(length, approved)

    const out = [
      `# Briefing: ${facts.title || basename(dir)}${stage === 'outline' ? ' (outline stage)' : ''}`,
      ``,
      `Everything you may use is below. Every fact in it is verified against the`,
      `book. Nothing outside it is. If you want something that is not here, ask`,
      `for it under QUERIES rather than reaching for something plausible.`,
      ...(missing.length > 0
        ? [
            ``,
            `NOT RECORDED IN THIS BOOK FILE: ${missing.join(', ')}.`,
            `Do not supply any of them from what you know of the work. Ask for`,
            `each under QUERIES; somebody will read it off the title page.`
          ]
        : []),
      ``,
      task,
      ``,
      `---`,
      ``,
      user
    ].join('\n')

    if (typeof opts.out === 'string') {
      await writeFile(resolve(opts.out), `${out}\n`)
      console.log(`${out.split(/\s+/u).length} words → ${resolve(opts.out)}`)
    } else console.log(out)
    if (missing.length > 0) {
      console.error(`\nNOT IN THE BOOK FILE: ${missing.join(', ')}. Read them off the title page.`)
      process.exitCode = 1
    }
  } else if (verb === 'compile') {
    // The card, as a system prompt.
    //
    // `.claude/agents/etsu.md` said in its own last paragraph that the two
    // would drift and that a session would then write in a voice nobody
    // approved. Nothing stopped it, so this does: the agent is generated, the
    // card is the source, and every exemplar the shelf has banked since the
    // last compile arrives with it.
    const target = resolve(typeof opts.out === 'string' ? opts.out : '.claude/agents/etsu.md')
    const text = compileAgent(voice, annotate)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text)
    console.log(
      `${voice.penName || 'the editor'}: ${voice.avoid.length} refusal(s), ` +
        `${voice.proseSamples.length} passage(s), ${Math.min(voice.exemplars.length, annotate.MAX_EXEMPLARS)} note(s)`
    )
    console.log(`→ ${target}`)
    console.log(
      'Claude Code loads agents at session start. A session that just compiled this cannot use it.'
    )
  } else {
    throw new Error(`Unknown verb: ${verb}`)
  }
} catch (err) {
  if (!(err instanceof Refusal)) throw err
  if (err.message) console.error(err.message)
  process.exitCode = 2
} finally {
  await close()
}
