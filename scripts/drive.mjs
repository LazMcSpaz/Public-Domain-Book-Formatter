/**
 * Driving the app in a real browser, one command at a time.
 *
 * `screenshot-flow.mjs` proves a change works by running the whole book from
 * intake to export and exiting. That is the right shape for a regression check
 * and the wrong one for working *on* something: it cannot be stopped at the
 * design gate and asked a question. This keeps the browser open and takes
 * commands, so a gate can be looked at, answered, and looked at again.
 *
 * It speaks the same verbs as the repository bridge and goes through the same
 * surface — `window.__pdbfAgent`, published by `useAgentSurface` in dev builds
 * only. That is deliberate: a driver that clicked buttons while the bridge set
 * state would be two implementations of the flow, and they would disagree
 * exactly where it mattered.
 *
 * Usage:
 *   node scripts/drive.mjs serve &        # holds the browser open
 *   node scripts/drive.mjs open           # load the test fixture
 *   node scripts/drive.mjs wait gate-identity
 *   node scripts/drive.mjs state
 *   node scripts/drive.mjs answer orthography preserve
 *   node scripts/drive.mjs advance
 *   node scripts/drive.mjs evidence 'terms#0' word.png
 *   node scripts/drive.mjs shot design
 *   node scripts/drive.mjs quit
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const PORT = Number(process.env.DRIVE_PORT ?? 7788)
const URL_BASE = process.env.APP_URL ?? 'http://localhost:5173'
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const OUT = process.env.DRIVE_OUT ?? 'screenshots'
const REPO = resolve(import.meta.dirname, '..')
/** Where the browser keeps its storage between runs. See `launchPersistentContext`. */
const PROFILE = process.env.DRIVE_PROFILE ?? resolve(REPO, '.drive-profile')

const [verb, ...rest] = process.argv.slice(2)

if (!verb || verb === 'serve') await serve()
else await send(verb, rest)

/** Client mode: hand the command to the browser that is already open. */
async function send(verb, args) {
  let res
  try {
    res = await fetch(`http://127.0.0.1:${PORT}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verb, args })
    })
  } catch {
    console.error(
      `Nothing is listening on ${PORT}. Start the browser first:\n` +
        '  node scripts/drive.mjs serve &'
    )
    process.exit(1)
  }
  const text = await res.text()
  console.log(text)
  process.exit(res.ok ? 0 : 1)
}

async function serve() {
  await mkdir(OUT, { recursive: true })
  // A *persistent* profile, so IndexedDB outlives the driver process.
  //
  // Everything the app keeps — the loaded run, the scan, and the recon
  // checkpoint written every twenty leaves — lives in the browser's storage.
  // With the throwaway profile `chromium.launch()` gives you, restarting the
  // driver for any reason threw all of it away, which on a real book means
  // re-running hours of OCR to get back to where you were. The checkpoint
  // exists precisely so a stopped reading can be carried on; it can only do
  // that if the storage holding it survives.
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: EXECUTABLE,
    args: ['--no-sandbox'],
    viewport: { width: 1360, height: 900 }
  })
  const browser = context
  const page = context.pages()[0] ?? (await context.newPage())

  /**
   * Which book a verb means, decided in one place.
   *
   * Before this, three different answers were in use at once. `open` handed a
   * scan to the app; `leaf`, `draft`, `ocr` and `sheet` rendered from the
   * *stored* scan of whatever run was saved most recently; `transcribe` keyed
   * off the path on the command line. So a session could open one book, read a
   * second book's pixels, and file the result under a third — and it did, for
   * an afternoon, with nothing in any report saying so, because no verb named
   * the book its pixels came from.
   *
   * `window.__pdbfBook` is the current book's key, set by `open`, `load` and
   * `use`. When it is set, every verb uses it. When it is not, a single stored
   * book is taken as obvious and **anything more is refused by name** rather
   * than guessed at: picking the newest is what caused the fault, and a driver
   * that cannot tell which book it means should say so.
   *
   * Installed with `addInitScript` so it survives navigation, which the bridge
   * tests do routinely.
   */
  await page.addInitScript(() => {
    // Kept in `localStorage`, not only on `window`. A page global is forgotten
    // by every reload and every restart of the browser this driver holds, and
    // the symptom is not an error a session recognises: the next verb says
    // "more than one book is stored here and none is current", which reads as
    // a book that was never chosen rather than one that was and got lost.
    const KEY = 'pdbf.drive.book'
    Object.defineProperty(window, '__pdbfBook', {
      configurable: true,
      get() {
        try {
          return localStorage.getItem(KEY)
        } catch {
          return null
        }
      },
      set(value) {
        try {
          if (value) localStorage.setItem(KEY, value)
          else localStorage.removeItem(KEY)
        } catch {
          /* a driver that cannot remember still works, one verb at a time */
        }
      }
    })

    window.__pdbfPickBook = async (runStore) => {
      const wanted = window.__pdbfBook ?? null
      if (wanted) {
        const summary = await runStore.loadRunSummary(wanted)
        return summary ?? { key: wanted, fileName: wanted.split('\u0000')[0] }
      }
      const runs = await runStore.listRuns()
      if (runs.length > 1) {
        throw new Error(
          'More than one book is stored here and none is current, so this verb ' +
            'cannot tell which you mean. Run `use <scan.pdf>` first.\n' +
            runs.map((r) => `  ${r.fileName}`).join('\n')
        )
      }
      return runs[0]
    }
  })

  /** Kept rather than printed: a controller asks for them when something looks wrong. */
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const url = m.location()?.url ?? ''
    // The same two expected refusals `screenshot-flow` ignores: the batch
    // endpoints declining a browser origin, and GitHub's 404-as-"not there
    // yet". Both are the app asking a question it is allowed to be told no to.
    if (url.includes('api.anthropic.com')) return
    if (url.includes('api.github.com') && /404/.test(m.text())) return
    errors.push(m.text())
  })

  /**
   * A repository in memory, for driving the other bridge.
   *
   * The repository transport is the one a person actually uses — an assistant
   * writing commands into a git repo the user owns. Proving it works needs a
   * repository, and pointing the harness at a real one would put test traffic
   * in somebody's history. So the contents API is answered from a Map, the
   * same way `screenshot-flow` answers it for the shelf.
   */
  const repoFiles = new Map()
  await page.route('https://api.github.com/**', (route) => {
    const url = route.request().url()
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ full_name: 'local/control', default_branch: 'main', private: true })
      })
    }
    const path = decodeURIComponent(/\/contents\/([^?]+)/.exec(url)?.[1] ?? '')
    if (route.request().method() === 'PUT') {
      repoFiles.set(path, JSON.parse(route.request().postData() ?? '{}').content)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: { sha: `sha-${repoFiles.size}` } })
      })
    }
    const stored = repoFiles.get(path)
    if (stored === undefined) return route.fulfill({ status: 404, body: '{}' })
    if ((route.request().headers()['accept'] ?? '').includes('raw')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.from(stored, 'base64')
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sha: 'sha-existing', content: stored, encoding: 'base64' })
    })
  })

  await page.goto(URL_BASE, { waitUntil: 'networkidle' })

  /** The app's own command surface, or a clear reason it is not there. */
  const run = async (command) => {
    const present = await page.evaluate(() => Boolean(window.__pdbfAgent))
    if (!present) {
      throw new Error(
        'window.__pdbfAgent is not published. It is dev-only — check the page is being served ' +
          'by `npm run dev` rather than from a production build.'
      )
    }
    return page.evaluate((c) => window.__pdbfAgent.run(c), command)
  }

  const handlers = {
    /** The gate on screen, as the controller sees it. */
    state: () => run({ op: 'state' }),

    /**
     * Answer by id. The value is read as JSON when it parses and as a plain
     * string when it does not, so `answer trim 6x9` and
     * `answer terms '{"t1":{"action":"accept"}}'` both work.
     */
    answer: ([id, ...value]) => {
      const raw = value.join(' ')
      let parsed = raw
      try {
        parsed = JSON.parse(raw)
      } catch {
        /* a bare word is a string */
      }
      return run({ op: 'answer', id, value: parsed })
    },

    advance: () => run({ op: 'advance' }),

    /** Fetch the pixels behind a ref and write them where they can be looked at. */
    evidence: async ([ref, name]) => {
      const reply = await run({ op: 'evidence', ref })
      if (reply.outcome !== 'done' || !reply.image) return reply
      const file = `${OUT}/${name ?? ref.replace(/[^\w.-]+/g, '_')}`
      await writeFile(file, Buffer.from(reply.image.base64, 'base64'))
      return { outcome: reply.outcome, wrote: file, mediaType: reply.image.mediaType }
    },

    /** A picture of the whole screen — the app's chrome, not the book's pixels. */
    shot: async ([name = 'drive']) => {
      const file = `${OUT}/${name}.png`
      await page.screenshot({ path: file, fullPage: true })
      return { wrote: file }
    },

    /** Load a book. The 8-page fixture unless another path is named. */
    /**
     * Make a book current, and store its scan so the pixel verbs can reach it.
     *
     * Both halves matter. Without the first, verbs guess; without the second,
     * `open` leaves the app holding a scan that nothing else can render from,
     * so `leaf` falls back to some other book's stored file — which is the
     * fault this whole change exists to remove.
     *
     * The scan is sent only when it is not already there: it is tens of
     * megabytes of base64 across the wire, and reopening the same book to
     * answer one more question should not pay for it twice.
     */
    _adopt: async (path) => {
      const full = resolve(REPO, path)
      const { readFile, stat } = await import('node:fs/promises')
      const meta = await stat(full)
      const file = {
        name: full.split('/').pop(),
        size: meta.size,
        lastModified: Math.floor(meta.mtimeMs)
      }
      const key = [file.name, file.size, file.lastModified].join('\u0000')

      const held = await page.evaluate(
        async ([repo, k]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          window.__pdbfBook = k
          return Boolean(await runStore.loadSourceFile(k))
        },
        [REPO, key]
      )
      if (!held) {
        const bytes = await readFile(full)
        await page.evaluate(
          async ([repo, f, base64]) => {
            const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
            const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
            await runStore.saveSourceFile(
              [f.name, f.size, f.lastModified].join('\u0000'),
              new File([raw], f.name, { type: 'application/pdf' })
            )
          },
          [REPO, file, bytes.toString('base64')]
        )
      }
      return { file, key, scanStored: true }
    },

    /**
     * Say which book every later verb means.
     *
     * The escape hatch for a device holding several books, and the thing the
     * resolver names when it refuses to guess.
     */
    use: async ([path]) => {
      if (!path) throw new Error('use <scan.pdf>')
      const adopted = await handlers._adopt(path)
      return { using: adopted.file.name, key: adopted.key }
    },

    /**
     * Which book is current, and what else is stored here.
     *
     * `book clear` forgets the current one, which puts the resolver back to
     * refusing rather than guessing whenever more than one book is stored. Not
     * only for tests: a session moving between books is safer being made to say
     * which than being handed whichever was saved last.
     */
    book: async ([action]) => {
      return page.evaluate(
        async ([repo, arg]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const runs = await runStore.listRuns()
          if (arg === 'clear') window.__pdbfBook = null
          else if (arg) {
            // Naming a book already stored here, which `use` cannot do: `use`
            // adopts a file from disk, and a scan loaded in an earlier session
            // is in the store and nowhere on this filesystem. Without this, a
            // second book on the device makes every verb refuse and there is
            // no way to answer it short of fetching the scan again.
            const matches = runs.filter((r) => r.fileName === arg || r.key === arg)
            if (matches.length === 0) {
              throw new Error(
                `No book here is called \`${arg}\`. Stored: ` +
                  runs.map((r) => r.fileName).join(', ')
              )
            }
            if (matches.length > 1) {
              throw new Error(
                `${matches.length} books here are called \`${arg}\`. Name one by its key instead.`
              )
            }
            window.__pdbfBook = matches[0].key
          }
          const wanted = window.__pdbfBook ?? null
          return {
            current: wanted
              ? (runs.find((r) => r.key === wanted)?.fileName ?? wanted.split('\u0000')[0])
              : null,
            scanStored: wanted ? Boolean(await runStore.loadSourceFile(wanted)) : false,
            stored: runs.map((r) => r.fileName)
          }
        },
        [REPO, action ?? '']
      )
    },

    open: async ([path = 'public/test-book.pdf']) => {
      // The *path*, never a buffer. A run key is name\0size\0modified, and
      // Playwright only preserves the file's real modification time when it is
      // handed a path — given a buffer it stamps one, so the key would differ
      // from the one `load` seeded against the same file and the app would
      // offer nothing back.
      const full = resolve(REPO, path)
      const { stat } = await import('node:fs/promises')
      const meta = await stat(full)
      await page.setInputFiles('input[type=file]', full)
      // Current from here on, and its scan stored, so no later verb has to
      // guess which book it means or fall back to another one's pixels.
      const adopted = await handlers._adopt(path)
      return { opened: adopted.file.name, bytes: meta.size, current: adopted.file.name }
    },

    /**
     * Stand up a paid transcription for free.
     *
     * Everything past the transcribe gate needs a reading of the book, and a
     * reading costs money. So one is written straight into the run store, the
     * same way `screenshot-flow` does it, and the app then offers it back as
     * "you have already paid for this". Deliberately *short* text: the
     * cross-check against OCR flags a page whose transcription has far fewer
     * words than the scan does, which is what puts leaves in front of the
     * uncertainty gate — the one place a controller is not allowed to press
     * the forward button.
     *
     * The key comes from the app's own `fileKey`, never from a copy of its
     * format here: a harness that reimplements the thing it drives passes
     * while the two drift apart.
     */
    seed: async ([path = 'public/test-book.pdf', pages = '9']) => {
      const { stat } = await import('node:fs/promises')
      const full = resolve(REPO, path)
      const meta = await stat(full)
      const name = path.split('/').pop()
      return page.evaluate(
        async ([repo, file, count]) => {
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const key = project.fileKey(file)
          // No `deleteRun` first: `saveRun` does a `put` on a keyed store,
          // which replaces. The delete bought nothing and turned "the save
          // failed, you still have what was there" into "the save failed and
          // there is nothing left".
          const saved = await runStore.saveRun(
            project.createSavedRun({
              key,
              fileName: file.name,
              pageCount: count,
              transcriptions: Array.from({ length: count }, (_, i) => ({
                pageIndex: i,
                role: i === 0 ? 'title-page' : 'body',
                blocks: [{ kind: 'paragraph', text: `Page ${i + 1}.` }],
                uncertain: [],
                furniture: {}
              })),
              failures: [],
              usage: { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 0 },
              modelId: 'claude-opus-5',
              identityAnswers: { orthography: 'preserve' }
            })
          )
          // The scan too, as a real reading leaves it when scans are kept.
          // Without it the harness could only ever exercise the half of the
          // shelf push that has no pixels to send.
          const res = await fetch(`/${file.name}`)
          const blob = await res.blob()
          await runStore.saveSourceFile(key, new File([blob], file.name, { type: blob.type }))
          return { seeded: saved, key, scanStored: true }
        },
        [REPO, { name, size: meta.size, lastModified: Math.floor(meta.mtimeMs) }, Number(pages)]
      )
    },

    /**
     * Load a book saved to the shelf, so its flags can be worked offline.
     *
     * This is the whole point of the offline path. The transcription is the
     * part that costs money and it has already been bought; everything the
     * uncertainty gate needs besides it — the render, the OCR, the word boxes,
     * the cross-check findings — is free and is redone here from the scan.
     *
     * The run is **re-keyed**. A key is `name\0size\0modified`, and the scan
     * on this disk has a different modification time from the one on the
     * machine that read it, so the stored key would name a file this browser is
     * never going to see and the app would offer nothing. Re-keying to what
     * *this* copy of the scan will produce is what makes the saved run findable.
     * Nothing else about the run is touched.
     *
     * The **pictures come with it**. A book file names its plates rather than
     * carrying them (`images/<digest>.png`, written once so a re-save costs
     * kilobytes), and `parseBookFile` hands those names back as `imagePaths`
     * for whoever holds the repository to fetch. The driver holds it — the
     * shelf is a directory on this disk — so it reads them here. Without this
     * every plate lays out as an empty box and `proof` reports it dropped,
     * which is a false alarm indistinguishable from a real one.
     */
    load: async ([bookPath, scanPath]) => {
      const { readFile, stat } = await import('node:fs/promises')
      const { dirname } = await import('node:path')
      const bookFile = resolve(REPO, bookPath)
      const json = await readFile(bookFile, 'utf8')
      const scan = resolve(REPO, scanPath)
      const meta = await stat(scan)
      const name = scanPath.split('/').pop()

      // A picture's path is relative to the shelf root, and a book lives two
      // directories down from it (`books/<slug>/book.json`). Both are tried
      // rather than one assumed, because a book file read from somewhere other
      // than a shelf should still find pictures sitting beside it.
      const book = JSON.parse(json)
      const roots = [resolve(dirname(bookFile), '..', '..'), dirname(bookFile)]
      const pictures = []
      const missing = []
      for (const image of Array.isArray(book.images) ? book.images : []) {
        if (!image?.path || !image?.id) continue
        let bytes = null
        for (const root of roots) {
          try {
            bytes = await readFile(resolve(root, image.path))
            break
          } catch {
            /* try the next root */
          }
        }
        if (bytes) pictures.push({ id: image.id, base64: bytes.toString('base64') })
        else missing.push(image.path)
      }

      // The scan itself, when the browser has not already got it. Everything
      // that looks at pixels — `leaf`, `ocr`, `sheet`, every crop a correction
      // is checked against — reads it back out of the run store, and `load`
      // stored the book without it. The rule the app is built on is that no
      // text is repaired without pixels; a loader that leaves the pixels behind
      // makes following that rule impossible rather than merely inconvenient.
      const scanBytes = await readFile(scan)
      const alreadyStored = await page.evaluate(
        async ([repo, file]) => {
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const held = await runStore.loadSourceFile(project.fileKey(file))
          return held !== null && held.size === file.size
        },
        [REPO, { name, size: meta.size, lastModified: Math.floor(meta.mtimeMs) }]
      )

      const loaded = await page.evaluate(
        async ([repo, text, file, pictures]) => {
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const book = project.parseBookFile(text)
          const key = project.fileKey(file)
          const held = await runStore.loadRun(key)
          const fetched = pictures.map((p) => ({
            id: p.id,
            bytes: Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0))
          }))
          const run = {
            ...book.run,
            key,
            fileName: file.name,
            images: [...book.run.images, ...fetched]
          }
          // What this book is about to displace, counted before it does.
          //
          // `transcribe` never pushes to the shelf — `save` is a separate verb
          // — so a session that lands eight batches and dies before saving has
          // all of them sitting here and nowhere else. Loading the shelf's copy
          // over the top is how that work disappears, and it used to happen in
          // silence: `load` reported only the incoming book.
          //
          // And no `deleteRun` first. `saveRun` puts on a keyed store, which
          // replaces; the delete bought nothing and opened a window in which
          // the old run was gone and the new one had not landed.
          const displaced = held
            ? {
                leaves: held.transcriptions.length,
                edits: held.edits.length,
                images: held.images.length,
                complete: held.complete
              }
            : null
          const saved = await runStore.saveRun(run)
          // The gate answers travel with the book — they are what the user
          // already decided, and re-asking them would be the app forgetting.
          if (book.answers && Object.keys(book.answers).length > 0) {
            localStorage.setItem(`pdbf.review.${key}`, JSON.stringify(book.answers))
          }
          return {
            saved,
            key,
            pages: run.pageCount,
            edits: run.edits.length,
            images: run.images.length,
            complete: run.complete,
            savedAt: book.savedAt,
            // Named, never silent. A session is entitled to know that loading
            // the shelf's copy has just replaced work this device held.
            ...(displaced ? { displaced } : {})
          }
        },
        [REPO, json, { name, size: meta.size, lastModified: Math.floor(meta.mtimeMs) }, pictures]
      )
      // Sent after the run, and only when it is not already there: a scan is
      // tens of megabytes of base64 across the wire, and re-loading the same
      // book to answer one more question should not pay for it twice.
      if (!alreadyStored) {
        await page.evaluate(
          async ([repo, file, base64]) => {
            const project = await import(`/@fs${repo}/src/core/project/index.ts`)
            const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
            await runStore.saveSourceFile(
              project.fileKey(file),
              new File([bytes], file.name, { type: 'application/pdf' })
            )
          },
          [
            REPO,
            { name, size: meta.size, lastModified: Math.floor(meta.mtimeMs) },
            scanBytes.toString('base64')
          ]
        )
      }

      // Current from here on, the way `open` is. Phase 0 gave the driver one
      // notion of the current book and this verb was missed: `load` wrote a run
      // and left `__pdbfBook` pointing at whichever book was current before, so
      // with two books on the device every later verb went on reading the old
      // one. It is the quiet version of the fault Phase 0 was about — no error,
      // no warning, and a report that looks exactly like a real one. Caught by
      // loading a second book and getting the first book's page count back,
      // to the page, twice.
      await page.evaluate(
        ([key]) => {
          window.__pdbfBook = key
        },
        [loaded.key]
      )

      const out = { ...loaded, scanStored: true, current: loaded.key.split('\u0000')[0] }
      return missing.length > 0 ? { ...out, missingImages: missing } : out
    },

    /**
     * Every flagged spot in the book, with its pixels on disk.
     *
     * A gate read one command at a time is forty round trips before anything
     * can be judged. This takes the whole gate in one pass and writes a crop
     * per disagreement, so the words on the paper can actually be looked at —
     * which is the only basis on which any of these should be decided. Text
     * alone is exactly what this app refuses to repair from.
     */
    flags: async ([dir = 'flags']) => {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const out = `${OUT}/${dir}`
      await mkdir(out, { recursive: true })
      const reply = await run({ op: 'state' })
      const view = reply.view
      if (!view || view.step !== 'gate-uncertainties') {
        return { outcome: 'failed', reason: `At “${view?.step}”, not the uncertainty gate.` }
      }

      const leaves = new Map()
      for (const q of view.questions) {
        const m = /^page-(\d+)(?:-(gaps|fix))?$/.exec(q.id)
        if (!m) continue
        const pageIndex = Number(m[1])
        const leaf = leaves.get(pageIndex) ?? { pageIndex, why: [], gaps: [], passages: [] }
        leaves.set(pageIndex, leaf)
        if (!m[2]) {
          // The *reason* the leaf was flagged — the word-count drift, the
          // confidently-read words that are absent. This is what any verdict
          // here has to be made against, so it is the one field that must not
          // be missing.
          leaf.prompt = q.prompt
          leaf.why = q.help ?? ''
          leaf.verdicts = (q.options ?? []).map((o) => o.value)
          // The whole leaf, fetched on demand rather than written now: forty
          // page renders to answer one question is the scan all over again.
          const scan = q.evidence.find((e) => e.kind === 'image')
          if (scan) leaf.scanRef = scan.ref
        } else if (m[2] === 'gaps') {
          for (const row of q.rows ?? []) {
            const crop = row.images?.[0]
            let wrote = null
            if (crop) {
              const got = await run({ op: 'evidence', ref: crop.ref })
              if (got.outcome === 'done' && got.image) {
                wrote = `${out}/p${pageIndex}-${row.id}.png`
                await writeFile(wrote, Buffer.from(got.image.base64, 'base64'))
              }
            }
            leaf.gaps.push({ id: row.id, ocrRead: row.text, context: row.notes, crop: wrote })
          }
        } else {
          leaf.passages = (q.rows ?? []).map((r) => ({ id: r.id, kind: r.kind, text: r.text }))
        }
      }
      return { leaves: [...leaves.values()].sort((a, b) => a.pageIndex - b.pageIndex) }
    },

    /**
     * Write the book back out, corrections and all.
     *
     * Read from the run store rather than rebuilt from what is on screen, the
     * same way the app's own shelf save does it: the file that goes back is
     * then the record the app holds, and the two cannot drift into disagreeing
     * about what the book says.
     *
     * The gate *answers* travel too, and for corrections made at the
     * uncertainty gate they are the whole point. A fix typed there is folded
     * into the edit list when the gate is left, but the edit list is not
     * persisted until the proof step ends — the durable record in between is
     * the answer itself, which the app re-derives the edit from on the way back
     * in. Carrying the answers back means a verdict reached here survives
     * without having to walk the rest of the book to make it stick.
     */
    save: async ([bookPath, out = 'book.out.json']) => {
      const { readFile, writeFile } = await import('node:fs/promises')
      // No original when one is being made for the first time — writing a book
      // file out of a seeded run is how the round trip gets something to test
      // against without a real book having been read.
      const original =
        bookPath && bookPath !== '-'
          ? JSON.parse(await readFile(resolve(REPO, bookPath), 'utf8'))
          : { run: {}, answers: {}, voice: {}, notesCheckpoint: null, scan: null }
      const json = await page.evaluate(
        async ([repo, was]) => {
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          // Through the same resolver every other verb uses. Picking the
          // most recently saved run was the last place left where "the current
          // book" meant something different from what `book` reports — which
          // is how an afternoon's reading once landed against the wrong scan.
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No run in the store to save.')
          const run = await runStore.loadRun(newest.key)
          if (!run) throw new Error('That run could not be read back.')
          // The key and the scan pointer are the shelf's, not this machine's:
          // re-keying was a local necessity and must not travel back, or the
          // book would stop matching the scan it was read from.
          let answers = was.answers ?? {}
          try {
            const stored = localStorage.getItem(`pdbf.review.${newest.key}`)
            if (stored) answers = { ...answers, ...JSON.parse(stored) }
          } catch {
            /* a review record that will not parse is not worth losing the book over */
          }
          return project.serializeBookFile({
            run: {
              ...run,
              key: was.run.key ?? run.key,
              fileName: was.run.fileName ?? run.fileName
            },
            answers,
            voice: was.voice ?? {},
            notesCheckpoint: was.notesCheckpoint ?? null,
            scan: was.scan ?? null
          })
        },
        [REPO, original]
      )
      const path = resolve(REPO, out)
      await writeFile(path, json)
      const parsed = JSON.parse(json)
      const verdicts = parsed.answers?.['gate-uncertainties'] ?? {}
      const fixes = Object.entries(verdicts).filter(
        ([id, v]) => /-fix$/.test(id) && v && Object.keys(v).length > 0
      )
      return {
        wrote: path,
        edits: (parsed.run?.edits ?? []).length,
        leavesJudged: Object.keys(verdicts).filter((id) => /^page-\d+$/.test(id)).length,
        leavesRetyped: fixes.length,
        blocksRetyped: fixes.reduce((n, [, v]) => n + Object.keys(v).length, 0)
      }
    },

    /**
     * Wait for the app to reach a step, or just to stop working.
     *
     * Recon is a real OCR run and the paid steps are real requests, so a
     * controller that fired the next command straight after `open` would be
     * answering the previous gate. `busy` is what the surface reports for
     * exactly this.
     */
    wait: async ([target = 'idle', seconds = '120']) => {
      const until = Date.now() + Number(seconds) * 1000
      let last = null
      while (Date.now() < until) {
        const reply = await run({ op: 'state' })
        last = reply.view
        if (last && !last.busy && (target === 'idle' || last.step === target)) {
          return { step: last.step, title: last.title, waited: true }
        }
        await new Promise((r) => setTimeout(r, 1000))
      }
      return {
        outcome: 'failed',
        reason: `Still at “${last?.step}”${last?.busy ? ` (${last.busy})` : ''} after ${seconds}s.`
      }
    },

    /**
     * Turn the repository bridge on, against the stub above.
     *
     * The same settings a person fills in, written where Settings writes them,
     * so what runs afterwards is the real poll loop and the real transport.
     */
    bridge: async ([session = 'harness']) => {
      await page.evaluate((s) => {
        localStorage.setItem(
          'pdbf.shelf',
          JSON.stringify({ repo: 'local/control', branch: 'main', token: 'github_pat_harness' })
        )
        localStorage.setItem(
          'pdbf.control',
          JSON.stringify({ enabled: true, session: s, repo: '', branch: '', token: '' })
        )
      }, session)
      await page.reload({ waitUntil: 'networkidle' })
      return { bridge: 'on', session }
    },

    /** Write a command into the stubbed inbox, the way a controller would. */
    post: ([session, ...rest]) => {
      const raw = rest.join(' ')
      const commands = JSON.parse(raw)
      const body = JSON.stringify(
        { version: 1, commands: Array.isArray(commands) ? commands : [commands] },
        null,
        2
      )
      repoFiles.set(`control/${session}/inbox.json`, Buffer.from(body).toString('base64'))
      return { wrote: `control/${session}/inbox.json` }
    },

    /** Read back what the app answered. */
    replies: ([session]) => {
      const stored = repoFiles.get(`control/${session}/outbox.json`)
      if (!stored) return { replies: [] }
      return JSON.parse(Buffer.from(stored, 'base64').toString())
    },

    /** A picture of one part of the screen, scrolled into view first. */
    shotOf: async ([selector, name = 'area']) => {
      const target = page.locator(selector).first()
      await target.scrollIntoViewIfNeeded()
      await page.waitForTimeout(200)
      const file = `${OUT}/${name}.png`
      await target.screenshot({ path: file })
      return { wrote: file }
    },

    /** Press a button by its visible text — for UI a command cannot reach. */
    click: async ([...text]) => {
      const label = text.join(' ')
      const button = page.locator('button', { hasText: label }).first()
      await button.click({ timeout: 10000 })
      await page.waitForTimeout(400)
      return { clicked: label }
    },

    /**
     * Render any leaf of the open book, flagged or not.
     *
     * A gate only carries evidence for what it is asking about, which is right
     * on screen and wrong when the job is checking somebody's working: a leaf
     * already accepted has no question, so no `ref`, so no way to look at it.
     * The scan is on the device either way.
     */
    leaf: async ([n, name, dpi = '150', crop = '', ...rest]) => {
      const pageIndex = Number(n)
      const resolution = Number(dpi)
      // `leaf 45 out 300 - whole` renders everything the page draws rather than
      // what its box shows. A scan placed larger than its page box is a leaf
      // this app only half has, and the page-box render gives no sign of it.
      const whole = crop === 'whole' || rest.includes('whole')
      // `x,y,w,h` as fractions of the leaf, for cutting a plate out of a scan:
      // a cover with a later owner's label pasted across the foot, a page with
      // a digitiser's watermark along the bottom. Fractions rather than pixels
      // so the same crop survives a change of resolution.
      const box = (crop === 'whole' ? '' : crop)
        .split(',')
        .map(Number)
        .filter((v) => Number.isFinite(v))
      const url = await page.evaluate(
        // `crop`, never `window`: naming this parameter `window` shadowed the
        // global inside the callback, so the moment every verb started
        // resolving its book through `window.__pdbfPickBook` this one called it
        // on the crop-box array instead and threw for every invocation, cropped
        // or not — taking `crops`, and with it the whole adjudication path,
        // down beside it.
        async ([repo, index, atDpi, crop, wholeImage]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const pdf = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book open on this device.')
          const file = await runStore.loadSourceFile(newest.key)
          if (!file) throw new Error('The scan is not stored on this device.')
          if (crop.length !== 4 && !wholeImage) {
            return pdf.renderPageToObjectUrl(file, index, atDpi)
          }
          const doc = await pdf.openPdf(file)
          const rendered = await pdf.renderPage(doc, index, atDpi, { wholeImage })
          if (crop.length !== 4) {
            const asIs = await new Promise((r) => rendered.canvas.toBlob(r, 'image/png'))
            const url = URL.createObjectURL(asIs)
            rendered.canvas.width = 0
            rendered.canvas.height = 0
            await doc.destroy()
            return url
          }
          const [fx, fy, fw, fh] = crop
          const cut = document.createElement('canvas')
          cut.width = Math.round(rendered.canvas.width * fw)
          cut.height = Math.round(rendered.canvas.height * fh)
          cut
            .getContext('2d')
            .drawImage(
              rendered.canvas,
              Math.round(rendered.canvas.width * fx),
              Math.round(rendered.canvas.height * fy),
              cut.width,
              cut.height,
              0,
              0,
              cut.width,
              cut.height
            )
          rendered.canvas.width = 0
          rendered.canvas.height = 0
          return await new Promise((resolve) =>
            cut.toBlob((b) => resolve(URL.createObjectURL(b)), 'image/png')
          )
        },
        [REPO, pageIndex, resolution, box, whole]
      )
      const bytes = await page.evaluate(async (u) => {
        const res = await fetch(u)
        const buf = new Uint8Array(await (await res.blob()).arrayBuffer())
        URL.revokeObjectURL(u)
        return [...buf]
      }, url)
      const { writeFile } = await import('node:fs/promises')
      const file = `${OUT}/${name ?? `leaf-${String(pageIndex).padStart(3, '0')}`}.png`
      await writeFile(file, Buffer.from(bytes))
      return { wrote: file, pageIndex }
    },

    /**
     * Lay the whole book out and write the PDF, then say what happened.
     *
     * The last thing that was only reachable by clicking through the wizard,
     * and the one that actually decides whether a piece of work is sound. Three
     * things it answers that nothing else can: how many pages the book runs to,
     * whether any footnote or picture could not be placed (`notesDropped` is
     * reported and never silently swallowed, which is the rule the engine is
     * built around), and whether every glyph the text uses has a width in the
     * embedded fonts. That last one is why this exists at all: `renderPdf`
     * raises rather than write a book with holes in it, so a character the
     * faces cannot set is a thrown error here instead of a full em of white
     * space discovered in print.
     *
     * `proof 3 4 120` also writes those pages as PNGs, which is the only
     * honest way to check that a footnote sits where it should.
     *
     * **The look is the book's own.** This used to lay out with
     * `defaultStyleProfile()`, which meant the pages the assistant looked at
     * were set in a typeface, at a size and on a trim the export was never
     * going to use — ornaments off, drop capitals off, running heads from a
     * different pair of answers. A proof of a different book. The design gate's
     * answers travel in the book file, so `appliedLook` rebuilds exactly what
     * the export gate would build from them.
     *
     * An argument with an `=` in it is a **tweak on top**, in the same ids the
     * gate's "anything you'd change?" panel uses: `proof 40 dropCap=true
     * bodyFontSize=10.5`. It changes this proof only. Deciding a look means
     * writing the answer into the book file, where the app will read it too.
     */
    proof: async ([...wanted]) => {
      const shots = wanted
        .filter((a) => !a.includes('='))
        .map(Number)
        .filter(Number.isFinite)
      const tweaks = Object.fromEntries(
        wanted
          .filter((a) => a.includes('='))
          .map((a) => {
            const [k, ...v] = a.split('=')
            const raw = v.join('=')
            return [k, raw === 'true' ? true : raw === 'false' ? false : raw]
          })
      )
      const result = await page.evaluate(
        async ([repo, pageNumbers, tweaks]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const assemble = await import(`/@fs${repo}/src/core/assemble/index.ts`)
          const editsMod = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const wizard = await import(`/@fs${repo}/src/core/wizard/index.ts`)
          const interior = await import(`/@fs${repo}/src/platform/browser/interior.ts`)

          const newest = await window.__pdbfPickBook(runStore)
          const run = await runStore.loadRun(newest.key)
          const doc = editsMod.applyEdits(
            assemble.assembleBook(run.transcriptions),
            run.edits ?? []
          )
          // The whole edition, not just its title. A copyright page is built
          // from the imprint, the copyright holder, the edition statement, the
          // ISBN and the public-domain notice, and `proof` used to hand over
          // none of them — so the leaf came out blank and looked like a bug in
          // the engine rather than an answer nobody had given. Through
          // `editionFromAnswers`, which is what the export gate itself uses.
          const stored = localStorage.getItem(`pdbf.review.${newest.key}`)
          const saved = stored ? JSON.parse(stored) : {}
          const meta = run.transcriptions.flatMap((t) => (t.metadata ? [t.metadata] : []))
          const exportMod = await import(`/@fs${repo}/src/core/export/index.ts`)
          const edition = exportMod.editionFromAnswers({
            title: meta.find((m) => m.title)?.title ?? 'Untitled',
            author: meta.find((m) => m.author)?.author ?? '',
            ...(saved.export ?? {})
          })
          // Through the app's own path rather than a second assembly of the
          // same steps, so this cannot report a book the export would not write.
          // The pixels travel beside the document rather than in it, so they
          // have to be handed over explicitly. Without them a book with plates
          // lays out with the space reserved and every picture reported
          // missing, which is a quieter failure than it sounds: the page count
          // is right, nothing is dropped, and the plate is simply blank.
          const images = new Map((run.images ?? []).map((i) => [i.id, i.bytes]))
          // The same call the design gate and the export make, off the answers
          // the book carries — so a look that proofs here is the look that
          // prints.
          const answers = { ...saved.design, ...tweaks }
          const profile = wizard.appliedLook(
            { ...wizard.initialState(), styleProfiles: [] },
            answers
          ).style
          const built = await interior.renderInterior(doc, profile, {
            edition,
            orphanNotes: 'collect',
            images
          })

          const shots = []
          if (pageNumbers.length > 0) {
            const pdfMod = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
            const file = new File([built.bytes], 'proof.pdf', { type: 'application/pdf' })
            const opened = await pdfMod.openPdf(file)
            for (const n of pageNumbers) {
              const rendered = await pdfMod.renderPage(opened, n - 1, 150)
              shots.push([n, rendered.canvas.toDataURL('image/png')])
              rendered.canvas.width = 0
              rendered.canvas.height = 0
            }
          }
          return {
            title: edition.title,
            look: `${profile.trimSize}in · ${profile.bodyFont} ${profile.bodyFontSize}pt · ${
              profile.dropCap ? 'drop cap' : 'no drop cap'
            } · ${profile.ornaments.chapterOpener ?? 'no chapter ornament'} · heads ${
              profile.runningHeads.verso
            }/${profile.runningHeads.recto}`,
            pages: built.pageCount,
            // Where those pages went. A total on its own cannot say why an
            // edition runs to the length it does; the body is the only part it
            // shares with the book it was set from.
            sections: built.sectionPages,
            // Where each chapter opens, so a leaf can be asked for by name
            // rather than found by bisecting the book. `side` is the check
            // that matters when chapters are set to open recto: a right-hand
            // page is an odd one, and one chapter landing verso is the kind of
            // fault nobody sees until the proof copy arrives.
            chapters: built.chapterPages.map((c) => ({
              title: c.title,
              page: c.pageIndex + 1,
              side: (c.pageIndex + 1) % 2 === 1 ? 'recto' : 'verso'
            })),
            notesPlaced: built.notesPlaced,
            notesCollected: built.notesCollected,
            notesDropped: built.notesDropped,
            imagesPlaced: built.imagesPlaced.map((i) => ({ id: i.id, dpi: Math.round(i.dpi) })),
            imagesDropped: built.imagesDropped,
            warnings: built.warnings.length,
            substitutions: built.substitutions,
            bytes: built.bytes.length,
            shots
          }
        },
        [REPO, shots, tweaks]
      )
      const { writeFile } = await import('node:fs/promises')
      const wrote = []
      for (const [n, dataUrl] of result.shots) {
        const file = `${OUT}/proof-${String(n).padStart(3, '0')}.png`
        await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
        wrote.push(file)
      }
      delete result.shots
      return { ...result, wrote }
    },

    /**
     * Land a transcription that was made in a session, one batch at a time.
     *
     * There is no API any more: the reading happens in a conversation, in
     * batches, by subagents that each see a handful of leaves and die. This is
     * where those batches land, and it is deliberately the only door — a
     * harness that wrote to the store itself would be a second implementation
     * of the one thing that must not have two.
     *
     * Three properties, each of them load-bearing.
     *
     * **Validated through the app's own parser.** Every page goes through
     * `parsePageTranscription`, which is what the API path used and what the
     * schema means. A page that will not parse fails the whole call rather than
     * landing half-read: a partly-understood transcription looks exactly like a
     * whole one and prints with holes in it.
     *
     * **Merged, never replaced.** A batch covering leaves 40 to 47 leaves the
     * other three hundred alone. That is what makes a session that dies or hits
     * a limit cost one batch rather than a book, and it is why `pageIndex` is
     * required on every page instead of being taken from array position — a
     * batch has to be able to say which leaves it is.
     *
     * **Checked against OCR before it is believed.** `verifyPage` compares each
     * page to what Tesseract read off the same leaf. OCR is not a language
     * model, so it has no shared blind spots with whoever wrote the batch, and
     * with the API gone it is the only independent witness left. The findings
     * are reported, not enforced — this is a place to look, not a gate — but a
     * batch that comes back with half its leaves flagged is a batch to re-read.
     */
    transcribe: async ([scanPath, pagesPath, mode = 'merge']) => {
      if (!scanPath || !pagesPath) {
        throw new Error('transcribe <scan.pdf> <pages.json> [merge|replace]')
      }
      const { readFile, stat } = await import('node:fs/promises')
      // `-` means the book this session is working on, resolved the way every
      // other verb resolves it. A scan loaded in an earlier session lives in
      // the store and nowhere on this filesystem, so demanding a path made the
      // one verb that lands work unusable on exactly the books that have any.
      let file = null
      if (scanPath !== '-') {
        const meta = await stat(resolve(REPO, scanPath))
        file = {
          name: scanPath.split('/').pop(),
          size: meta.size,
          lastModified: Math.floor(meta.mtimeMs)
        }
      }
      const raw = JSON.parse(await readFile(resolve(REPO, pagesPath), 'utf8'))
      const pages = Array.isArray(raw) ? raw : (raw.pages ?? [])
      if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error(`${pagesPath}: no pages. Expected an array, or { "pages": [...] }.`)
      }

      return page.evaluate(
        async ([repo, named, pages, replace]) => {
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const schema = await import(`/@fs${repo}/src/core/transcribe/index.ts`)
          const cacheMod = await import(`/@fs${repo}/src/platform/browser/recon-cache.ts`)
          const recon = await import(`/@fs${repo}/src/platform/browser/recon.ts`)
          const pdfMod = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)

          // `findRunForFile` rather than `fileKey`, because the app itself
          // opens books that way and a batch has to land in the run the app
          // will open. The timestamp is the one part of a key that moves for
          // reasons having nothing to do with the book — a re-download, a
          // restore, a sync — and Playwright's `setInputFiles` and Node's
          // `stat` need not agree on it to the millisecond. Keying on the exact
          // triple alone put this batch in a run of its own that nothing would
          // ever open: no error, no book, and a session that believed it had
          // just filed a leaf.
          const current = named ? null : await window.__pdbfPickBook(runStore)
          if (!named && !current) throw new Error('No book on this device to land this batch in.')
          const file = named ?? {
            name: current.fileName,
            size: Number(current.key.split('\u0000')[1] ?? 0),
            lastModified: Number(current.key.split('\u0000')[2] ?? 0)
          }
          // The *whole* run, not the summary `__pdbfPickBook` hands back.
          // `held` is what every field of the held run is carried from, and a
          // summary has no `transcriptions`, no `edits` and no `rulings` — so
          // reading one here made the merge believe it was starting a fresh
          // book and silently threw away twelve leaves, two corrections and
          // three rulings. It reported `landed: 72` while doing it.
          const existing = named
            ? await runStore.findRunForFile(file)
            : { run: await runStore.loadRun(current.key), key: current.key }
          const key = existing?.key ?? project.fileKey(file)
          const foundBy = !existing
            ? 'nothing on this device — this batch starts a new run'
            : !named
              ? 'the book this session is working on'
              : existing.key === project.fileKey(file)
                ? 'name, size and date'
                : 'name and size — the stored date differs'

          // Parsed before anything is *written*, so a bad batch changes
          // nothing. The run lookup above runs first and is deliberately a
          // read: the whole batch has to be understood before a single page of
          // it lands, because a partly-understood transcription looks exactly
          // like a whole one and prints with holes in it. If a write is ever
          // added above this line, that property is gone.
          const parsed = pages.map((entry, i) => {
            const at = entry?.pageIndex
            if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) {
              throw new Error(
                `Page ${i + 1} of this batch has no pageIndex. ` +
                  'A batch must say which leaves it read; position in the array is not that.'
              )
            }
            return {
              ...schema.parsePageTranscription(entry, at),
              pageIndex: at,
              _draftNotes: schema.carriesDraftNotes(entry)
            }
          })

          const held = existing?.run ?? null

          // The guard that would have caught the above, and catches the next
          // one of its shape. A run exists at this key and yet nothing was
          // read back from it: whatever is wrong, merging now writes a book
          // with only this batch in it and calls that a merge.
          if (!held && (await runStore.loadRunSummary(key))) {
            throw new Error(
              `A run is stored at this key and could not be read back, so merging ` +
                `this batch would replace ${
                  (await runStore.loadRunSummary(key))?.pageCount ?? 'every'
                } leaf of it with the ${pages.length} here. Nothing was written.`
            )
          }
          // How long the book is, or 0 when nobody knows — never a floor.
          // A floor stored is a floor read back next time as a known number,
          // which is how `complete: true` came out of a book sixteen leaves
          // into three hundred. `mergeBatchIntoRun` refuses to persist a guess.
          // `leafCount`, never `pageCount`. The wizard writes the *read* count
          // into `pageCount` when it checkpoints a partial reading, and taking
          // that for the book's length reported sixteen leaves of a
          // three-hundred-leaf book as finished.
          let pageCount = held?.leafCount ?? 0
          let countFrom = 'the run already on this device'
          if (!pageCount) {
            const source = await runStore.loadSourceFile(key)
            if (source) {
              pageCount = (await pdfMod.openPdf(source)).numPages
              countFrom = 'the scan'
            } else {
              // The open book, if it is this one. `open` hands the scan to the
              // app without storing it — only `load` stores — so a book being
              // worked on right now routinely has no source file in the store
              // while the app knows perfectly well how many leaves it has.
              //
              // Name *and* size. Name alone is what `keyMatchesFile` forbids in
              // as many words — two scans of the same title share a name
              // constantly — and matching on it here would take an eight-leaf
              // sample's page count for a three-hundred-leaf book.
              const view = window.__pdbfAgent?.run
                ? (await window.__pdbfAgent.run({ op: 'state' }))?.view
                : null
              if (
                view &&
                view.fileName === file.name &&
                view.fileSize === file.size &&
                view.pageCount > 0
              ) {
                pageCount = view.pageCount
                countFrom = 'the book open in the app'
              } else {
                countFrom = 'nothing here knows how long the book is'
              }
            }
          }

          // The merge, the carry-across and every number in the report are a
          // pure function in core — `src/core/project/merge-batch.ts`. They
          // lived here, inside `page.evaluate`, which made them untestable by
          // construction, and three of the four bugs found in them were the
          // same shape: a field claiming a check had happened, or a book was
          // finished, when neither was true. They are unit tests now.
          // The draft's own annotations, stripped before anything is stored: a
          // transcription is not the place for the list of things a draft
          // guessed. Counted first, because a batch still carrying them has
          // very likely not been checked against the render.
          const unchecked = parsed.filter((p) => p._draftNotes).map((p) => p.pageIndex)
          const clean = parsed.map((page) => {
            const stripped = { ...page }
            delete stripped._draftNotes
            return stripped
          })

          const merged = project.mergeBatchIntoRun({
            held,
            parsed: clean,
            key,
            fileName: file.name,
            pageCount,
            replace
          })
          const run = project.createSavedRun(merged.init)
          const saved = await runStore.saveRun(run)

          // The independent witness. Cached OCR only: re-reading the scan here
          // would turn landing a batch into a ten-minute job, and a batch that
          // cannot be checked should say so rather than appear to pass.
          const cached = await cacheMod.loadReconCache(key, {
            dpi: recon.RECON_DPI,
            maxPages: null
          })
          const checked = []
          let compared = 0
          // Distinct leaves, not batch entries: `parsed.length` counted an
          // entry twice when a batch named a leaf twice, so `ocr` claimed three
          // leaves checked where one had landed.
          const seenLeaves = new Set(parsed.map((p) => p.pageIndex)).size
          if (cached) {
            for (const p of parsed) {
              const words = cached.words.filter((w) => w.pageIndex === p.pageIndex)
              // No cached words for this leaf is not a pass. Counted apart, so
              // `ocr` cannot report "checked" over leaves nothing was compared
              // against — a check that claims success on work it skipped is
              // worse than no check, because it stops anyone looking again.
              if (words.length === 0) continue
              compared++
              const findings = schema.verifyPage(p, words)
              if (findings.length > 0) {
                checked.push({
                  pageIndex: p.pageIndex,
                  findings: findings.map((f) => ({ code: f.code, detail: f.detail }))
                })
              }
            }
          }

          return {
            saved,
            // Never "landed" over a failed save. "Landed" means "is in the
            // store", and saying it after `saveRun` returned false is the same
            // untruth as reporting a check that never ran.
            ...(saved
              ? merged.report
              : {
                  landed: 0,
                  why: 'The run could not be written — a full quota, or storage off. Nothing landed.'
                }),
            pageCountFrom: countFrom,
            matchedRunBy: foundBy,
            queriesRaised: clean.reduce((n, p) => n + (p.queries?.length ?? 0), 0),
            // Not a refusal — a reader may have checked a leaf and left the
            // list alone — but a draft landed uncorrected is the one thing this
            // door exists to make hard, so it is never silent.
            ...(unchecked.length > 0
              ? {
                  stillCarriesDraftNotes: unchecked,
                  check:
                    "These leaves arrived with the draft's `structural` list still on them. Was the draft checked against the render?"
                }
              : {}),
            ocr: !cached
              ? 'NOT CHECKED — no cached reading on this device'
              : compared === seenLeaves
                ? `checked against the cached reading, all ${compared} leaf(s)`
                : `NOT CHECKED on ${seenLeaves - compared} of ${seenLeaves} leaf(s) —` +
                  ' the cached reading has no words for them',
            flagged: checked
          }
        },
        [REPO, file, pages, mode === 'replace']
      )
    },

    /**
     * Every way the book disagrees with itself, deterministically.
     *
     * The free half of the coherence work, and the half that runs first: a
     * name spelled two ways, a word or a line set twice, a quotation that never
     * closes, a cross-reference to a chapter the book has not got. No model, no
     * spend, and nothing here proposes a reading — each finding is a place
     * where the book contradicts itself, which is a fact about the text rather
     * than an opinion about it, so it needs somebody to look rather than a
     * second reader to adjudicate.
     *
     * Runs over the *assembled* document, because a doubled line and a name
     * variant both live at page seams and a raw leaf cannot show you a seam.
     */
    consistency: async ([out = 'consistency.json', which = 'edited']) => {
      // `consistency out.json pristine` runs over the transcription before any
      // correction. That is the *normal* occasion for these checks — they exist
      // to find what wants correcting — and running only over the edited text
      // means a check can only ever confirm that work already done was done.
      const found = await page.evaluate(
        async ([repo, which]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const assemble = await import(`/@fs${repo}/src/core/assemble/index.ts`)
          const editsMod = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const coherence = await import(`/@fs${repo}/src/core/coherence/index.ts`)
          const quotes = await import(`/@fs${repo}/src/core/layout/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book open on this device.')
          const run = await runStore.loadRun(newest.key)
          const bare = assemble.assembleBook(run.transcriptions)
          const doc = which === 'pristine' ? bare : editsMod.applyEdits(bare, run.edits ?? [])
          // Through the quote pass first, because the unclosed-quote check
          // counts printer's marks: a straight mark opens and closes with the
          // same character and cannot be counted at all.
          return coherence.checkConsistency(quotes.withTypographicQuotes(doc))
        },
        [REPO, which]
      )
      const { writeFile } = await import('node:fs/promises')
      await writeFile(out, JSON.stringify(found, null, 1))
      const byKind = {}
      for (const f of found) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1
      return { wrote: out, over: which, findings: found.length, byKind }
    },

    /**
     * The book cut into chapters, ready for readers who each see one.
     *
     * A three-hundred-page book will not fit in one context and should not: the
     * failure this pass exists to avoid is a reader who has absorbed an author
     * so thoroughly it can write him. A chapter is the unit because coherence is
     * what is being tested and a chapter is a thing that coheres.
     *
     * The register travels with every chunk — the names and terms the book has
     * already established, drawn from its own text. Without it each reader meets
     * "Panchadasi" and "akasha" cold and files them as incoherent, which is the
     * commonest way a sense pass drowns in findings nobody wants.
     */
    chunks: async ([out = 'chunks.json']) => {
      const built = await page.evaluate(
        async ([repo]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const assemble = await import(`/@fs${repo}/src/core/assemble/index.ts`)
          const editsMod = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const coherence = await import(`/@fs${repo}/src/core/coherence/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book open on this device.')
          const run = await runStore.loadRun(newest.key)
          const doc = editsMod.applyEdits(
            assemble.assembleBook(run.transcriptions),
            run.edits ?? []
          )
          return coherence.chunkForSense(doc)
        },
        [REPO]
      )
      const { writeFile } = await import('node:fs/promises')
      await writeFile(out, JSON.stringify(built, null, 1))
      return {
        wrote: out,
        chunks: built.chunks.length,
        words: built.chunks.reduce((n, c) => n + c.words, 0),
        register: built.register.length,
        chapters: built.chunks.map((c) => ({ title: c.title, blocks: c.blocks.length }))
      }
    },

    /**
     * A crop for every finding, and a manifest that does **not** carry the guess.
     *
     * This is the safeguard, in the one place it can be enforced rather than
     * asked for. Shown a crop and a proposed reading, a model confirms; shown a
     * crop alone, it reads. The difference is invisible in the output and total
     * in what it is worth — so `expected` and `why` are stripped here, and the
     * adjudicator is handed the leaf, the span as the book currently has it, and
     * one question: what does the paper say?
     *
     * A finding whose quote is not in the block it names comes back `unplaced`
     * and gets no crop. That is a paraphrase rather than a quotation, and a
     * paraphrase cannot be cropped, so it cannot be adjudicated, so it must not
     * be acted on.
     */
    crops: async ([path = 'findings.json', dir = 'crops', dpi = '200']) => {
      const { readFile, writeFile, mkdir } = await import('node:fs/promises')
      const raw = JSON.parse(await readFile(resolve(REPO, path), 'utf8'))
      const located = await page.evaluate(
        async ([repo, raw]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const assemble = await import(`/@fs${repo}/src/core/assemble/index.ts`)
          const editsMod = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const coherence = await import(`/@fs${repo}/src/core/coherence/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          const run = await runStore.loadRun(newest.key)
          const doc = editsMod.applyEdits(
            assemble.assembleBook(run.transcriptions),
            run.edits ?? []
          )
          const findings = raw.map((f, i) => coherence.parseSenseFinding(f, i))
          const blocks = new Map(doc.blocks.map((b) => [b.id, b.text]))
          const pages = new Map(doc.blocks.map((b) => [b.id, b.sourcePages]))
          return coherence.locateFindings(findings, blocks).map((f) => ({
            blockId: f.blockId,
            quote: f.quote,
            at: f.at,
            pages: [...(pages.get(f.blockId) ?? [])]
          }))
        },
        [REPO, raw]
      )

      // Crops go beside every other rendered leaf, under the driver's own
      // output directory, so one `.gitignore` line covers all of them.
      const into = `${OUT}/${dir}`
      await mkdir(resolve(REPO, into), { recursive: true })
      const manifest = []
      const unplaced = []
      for (const [i, f] of located.entries()) {
        if (f.at === null || f.pages.length === 0) {
          unplaced.push({ blockId: f.blockId, quote: f.quote })
          continue
        }
        const leaves = []
        for (const n of f.pages) {
          const stem = `${dir}/f${String(i).padStart(3, '0')}-leaf${n}`
          await handlers.leaf([String(n), stem, dpi])
          leaves.push(`${OUT}/${stem}.png`)
        }
        // What the adjudicator is given: the leaves, and the span as the book
        // currently has it. No reason, and above all no hypothesis.
        manifest.push({ blockId: f.blockId, quote: f.quote, leaves })
      }
      const at = `${into}/manifest.json`
      await writeFile(at, JSON.stringify(manifest, null, 1))
      return {
        wrote: at,
        cropped: manifest.length,
        unplaced,
        note: 'The manifest carries no hypothesis. Ask only what the paper says.'
      }
    },

    /**
     * The sheet a person reads before anything reaches the book.
     *
     * The last gate, and the only one that is not a model. Every finding with
     * its crop, what the paper was read to say, what was proposed, and what the
     * two together came to — in one place, so that looking is cheap. The ledger
     * at the foot is what says whether the pass is earning its keep: a hundred
     * findings of which sixty survive is a good check, and a hundred of which
     * fifteen survive is noise wearing a check's clothes.
     */
    review: async ([
      findingsPath = 'findings.json',
      verdictsPath = 'verdicts.json',
      out = 'sense.md'
    ]) => {
      const { readFile, writeFile } = await import('node:fs/promises')
      const rawFindings = JSON.parse(await readFile(resolve(REPO, findingsPath), 'utf8'))
      const rawVerdicts = JSON.parse(await readFile(resolve(REPO, verdictsPath), 'utf8'))
      const built = await page.evaluate(
        async ([repo, rawFindings, rawVerdicts]) => {
          const coherence = await import(`/@fs${repo}/src/core/coherence/index.ts`)
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const assemble = await import(`/@fs${repo}/src/core/assemble/index.ts`)
          const editsMod = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          const run = await runStore.loadRun(newest.key)
          const doc = editsMod.applyEdits(
            assemble.assembleBook(run.transcriptions),
            run.edits ?? []
          )
          const findings = rawFindings.map((f, i) => coherence.parseSenseFinding(f, i))
          const verdicts = rawVerdicts.map((v, i) => coherence.parseVerdict(v, i))
          const blocks = new Map(doc.blocks.map((b) => [b.id, b.text]))
          // Unplaced findings are set aside rather than settled. Their quote is
          // not in the block they name, so no crop was ever cut and nothing
          // adjudicated them — settling them would report a crop that could not
          // be read, which is a different fault wanting different work.
          const located = coherence.locateFindings(findings, blocks)
          const unplaced = located.filter((f) => f.at === null)
          const placed = located.filter((f) => f.at !== null)
          const settled = coherence.settleAll(placed, verdicts)
          return {
            settled,
            unplaced: unplaced.map((f) => ({
              blockId: f.blockId,
              quote: f.quote,
              kind: f.kind,
              why: f.why
            })),
            ledger: coherence.scoreSense(settled, unplaced.length)
          }
        },
        [REPO, rawFindings, rawVerdicts]
      )

      const order = { corrected: 0, unreadable: 1, 'as-printed': 2 }
      const rows = [...built.settled].sort((a, b) => order[a.outcome] - order[b.outcome])
      const lines = ['# The sense pass, for reading', '']
      const l = built.ledger
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
      lines.push(
        `${l.raised} raised · **${plural(l.corrected, 'correction', 'corrections')}** · ` +
          `${l.asPrinted} as printed · ${l.unreadable} unreadable · ${l.unplaced} unplaced`,
        '',
        l.precision === null
          ? 'Nothing adjudicated yet, so no precision to report.'
          : `Precision ${(l.precision * 100).toFixed(0)}% of what was judged. ` +
              `The hypothesis was right ${l.hypothesisAgreed} of ${l.corrected} times.`,
        '',
        '---',
        ''
      )
      for (const row of rows) {
        const f = row.finding
        lines.push(`## ${row.outcome} — \`${f.blockId}\` (${f.kind})`, '')
        lines.push(`**The book has:** ${f.quote}`, '')
        if (row.verdict?.legible) lines.push(`**The paper says:** ${row.verdict.reads}`, '')
        else lines.push('**The paper:** could not be read.', '')
        lines.push(`**Why it was raised:** ${f.why}`, '')
        if (f.expected) {
          lines.push(
            `**Proposed** (a guess, and not what would be applied): ${f.expected}` +
              (row.outcome === 'corrected' && !row.hypothesisAgreed ? ' — and it was wrong.' : ''),
            ''
          )
        }
        if (row.correction) lines.push(`**Would become:** ${row.correction}`, '')
        lines.push('')
      }
      if (built.unplaced.length > 0) {
        lines.push(
          '## Could not be located',
          '',
          'The quoted words are not in the block named, so no crop could be cut and',
          'nothing has adjudicated these. A paraphrase rather than a quotation —',
          'nothing here may be acted on.',
          ''
        )
        for (const f of built.unplaced) {
          lines.push(`- \`${f.blockId}\` (${f.kind}) — “${f.quote}” · ${f.why}`)
        }
        lines.push('')
      }
      await writeFile(out, lines.join('\n'))
      return { wrote: out, ...built.ledger }
    },

    /**
     * The book as it will be set, one block to a record.
     *
     * The gates show a leaf at a time and the export shows a PDF; neither is
     * the thing a proofreader actually needs, which is the running text with
     * the corrections already in it and a handle on every block. The handle is
     * the point: a `text` edit is keyed to an *assembled* block and carries
     * that block's whole text, so a correction typed against a raw page would
     * silently truncate a paragraph the seam had joined. This hands back the
     * ids and the strings an edit must be written in terms of — emphasis
     * included, as the `<i>` tags `applyEdits` reads back — so a list of fixes
     * can be checked before any of it is written.
     */
    body: async ([out = 'body.json']) => {
      const doc = await page.evaluate(
        async ([repo]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const assemble = await import(`/@fs${repo}/src/core/assemble/index.ts`)
          const edits = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const markup = await import(`/@fs${repo}/src/core/transcribe/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book open on this device.')
          const run = await runStore.loadRun(newest.key)
          const bare = assemble.assembleBook(run.transcriptions)
          const applied = edits.applyEdits(bare, run.edits ?? [])
          const say = (blocks) =>
            blocks.map((b) => ({
              id: b.id,
              kind: b.kind,
              pages: b.sourcePages,
              text: markup.withMarkup(b.text, b.emphasis)
            }))
          return {
            edited: say(applied.blocks),
            pristine: say(bare.blocks),
            // What the contents and the running heads will be built from. A
            // chapter opened by a number over a name is one entry here and two
            // heading blocks above, which is worth being able to see rather
            // than infer from a rendered page.
            chapters: applied.chapters.map((c) => ({
              id: c.id,
              label: c.label ?? null,
              title: c.title,
              level: c.level,
              // Whether the original contents' description reached this
              // chapter. Reported because a synopsis that failed to match is
              // silent otherwise: the contents still prints, just plainer, and
              // nothing says the prose was read and then dropped.
              synopsis: c.synopsis ? `${c.synopsis.slice(0, 60)}…` : null
            })),
            // A description read off the original contents that no chapter
            // claimed. Silent otherwise: the contents still prints, only
            // plainer, so nothing looks broken and the prose was read and
            // thrown away.
            synopsesUnmatched: applied.synopsesUnmatched.map((x) => x.title),
            sections: applied.sections.map((s) => ({
              id: s.id,
              placement: s.placement,
              title: s.title,
              blocks: s.blocks.length
            }))
          }
        },
        [REPO]
      )
      const { writeFile } = await import('node:fs/promises')
      await writeFile(out, JSON.stringify(doc, null, 1))
      return { wrote: out, blocks: doc.edited.length }
    },

    /**
     * What OCR reads off a leaf, as plain text.
     *
     * The word crops answer "is this word really printed like that?"; they
     * cannot answer "is this word really *missing*?" A dropped `is`, a doubled
     * phrase or a stray `and` has no box to cut. So this hands back the
     * independent witness's own reading of whole leaves, to be set beside the
     * transcription: where the two agree the page says it, and where they
     * differ the place is worth a picture.
     */
    ocr: async ([...ns]) => {
      // `ocr 37 fresh` re-reads the pixels instead of the cache, which is how
      // to tell a leaf the cache has no words for from a leaf Tesseract cannot
      // read. The two look identical from outside and want opposite work: one
      // is a hole in the cache to refill, the other is a leaf that needs eyes.
      const fresh = ns.includes('fresh')
      const pages = ns.filter((n) => n !== 'fresh').map(Number)
      return page.evaluate(
        async ([repo, list, ignoreCache]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const cacheMod = await import(`/@fs${repo}/src/platform/browser/recon-cache.ts`)
          const ocrMod = await import(`/@fs${repo}/src/platform/browser/ocr.ts`)
          const pdfMod = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
          const recon = await import(`/@fs${repo}/src/platform/browser/recon.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book open on this device.')
          const file = await runStore.loadSourceFile(newest.key)
          if (!file) throw new Error('The scan is not stored on this device.')
          const cached = ignoreCache
            ? null
            : await cacheMod.loadReconCache(newest.key, { dpi: recon.RECON_DPI, maxPages: null })
          const text = {}
          const words = {}
          const say = (found) => found.map((w) => w.text).join(' ')
          // Counted beside the text, because an empty string is the one answer
          // that means two opposite things: a leaf the cache has no words for
          // (a hole to refill) and a leaf the engine could not read (a leaf
          // that needs eyes). Both print as `""` and want different work.
          const note = (n, found) => {
            text[n] = say(found)
            words[n] = found.length
          }
          if (cached) {
            for (const n of list)
              note(
                n,
                cached.words.filter((w) => w.pageIndex === n)
              )
            return { source: 'cache', text, words }
          }
          const engine = new ocrMod.OcrEngine()
          let doc = await pdfMod.openPdf(file)
          const leaves = doc.numPages
          const widened = []

          // pdf.js keeps per-page state on the document, and `page.cleanup()`
          // frees the page's own intermediates without emptying that. Over a
          // few hundred leaves it accumulates until the renderer is killed —
          // which is what took this down mid-sweep on leaf 110 of a 328-leaf
          // book, and again at 280. Read one at a time, every one of those
          // leaves is fine; it was never a bad leaf.
          //
          // So the document is closed and reopened every so often. The file is
          // already in memory, so reopening costs a parse of the cross-reference
          // table and nothing else, and it holds the working set flat the way
          // `renderPage` already holds one page's pixels flat.
          const RECYCLE_AFTER = 40
          let sinceOpen = 0

          try {
            for (const n of list) {
              if (sinceOpen >= RECYCLE_AFTER) {
                await doc.destroy()
                doc = await pdfMod.openPdf(file)
                sinceOpen = 0
              }
              sinceOpen++
              if (n < 0 || n >= leaves) {
                text[n] = ''
                words[n] = null
                continue
              }
              const rendered = await pdfMod.renderPage(doc, n, recon.RECON_DPI)
              const result = await engine.recognize(rendered.canvas, n)

              // Does the frame cut through ink? A leaf printed with margins
              // has bare paper at its edges, so ink hard against the frame
              // means the frame is not the leaf — the capture is placed so
              // that the page box shows only part of it. Leaf 57 of *The
              // Human Aura* loses the right half of every line that way and
              // reads as 113 words of a 202-word page: not empty, which is why
              // "did it read nothing?" is the wrong question, and a check that
              // asked it would have passed this leaf.
              //
              // Measured rather than assumed, and measured on the leaf's own
              // paper tone, which is what `inkProfile` does — old paper is
              // cream, foxed and unevenly lit, and a fixed threshold reads a
              // blank leaf as ink on one book and misses type on the next.
              const w = rendered.canvas.width
              const h = rendered.canvas.height
              const strip = Math.max(2, Math.round(w * 0.006))
              const edges = [
                { x0: w - strip, y0: h * 0.1, x1: w, y1: h * 0.9 },
                { x0: 0, y0: h * 0.1, x1: strip, y1: h * 0.9 }
              ].map((box) => pdfMod.inkProfile(rendered.canvas, box).fraction)
              const cutsInk = Math.max(...edges) > 0.06

              rendered.canvas.width = 0
              rendered.canvas.height = 0
              if (result.words.length > 0 && !cutsInk) {
                note(n, result.words)
                continue
              }

              // Render everything the page draws and keep whichever reading
              // found more. Not the default: it costs a second OCR pass, and
              // the wider frame moves every word box — which is the unit the
              // crops and the illustration cuts are measured in.
              const whole = await pdfMod.renderPage(doc, n, recon.RECON_DPI, { wholeImage: true })
              const second = await engine.recognize(whole.canvas, n)
              whole.canvas.width = 0
              whole.canvas.height = 0
              const better = second.words.length > result.words.length
              note(n, better ? second.words : result.words)
              if (better) widened.push(n)
            }
          } finally {
            await engine.dispose()
            // Never left open. This verb held a document for the life of the
            // page and freed it only when the page died.
            await doc.destroy()
          }
          // Said out loud: these words were read in a different frame from
          // every other leaf's, so their boxes do not line up with the cached
          // reading and a crop taken from one will not land where it should.
          return { source: 'pixels', leaves, text, words, readWhole: widened }
        },
        [REPO, pages, fresh]
      )
    },

    /**
     * What shelf this device is connected to, and putting the book on it.
     *
     * `save` writes a book file to *this filesystem*, and two places in this
     * driver said it pushed to the shelf. It never has, and the difference is
     * the whole point of having a shelf: this container is reclaimed when the
     * session ends, and a book that only ever reached a local file was work
     * done into a machine that is about to be thrown away.
     *
     * `shelf` says what is configured. `shelf push` sends the current book
     * through `pushBookToShelf` — the same call the app makes when a reading
     * finishes, so a book put up by hand is byte-for-byte the one put up
     * automatically.
     *
     * No credential ever crosses this channel in either direction: the token is
     * the app's, read from where the app keeps it, and it is never reported.
     */
    shelf: async ([action, what = 'the reading, from a session']) => {
      return page.evaluate(
        async ([repo, action, what]) => {
          const settings = await import(`/@fs${repo}/src/platform/browser/settings.ts`)
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const shelfSave = await import(`/@fs${repo}/src/platform/browser/shelf-save.ts`)
          const sync = await import(`/@fs${repo}/src/core/sync/index.ts`)

          const config = settings.loadShelf()
          const connected = Boolean(config?.owner && config?.repo && config?.token)
          const where = config?.owner ? `${config.owner}/${config.repo}` : null
          if (action !== 'push') {
            // The token is never in this reply, only whether there is one.
            return { connected, repository: where, branch: config?.branch ?? null }
          }
          if (!connected) {
            throw new Error(
              'No shelf is connected in this browser. Connect one in the app’s Settings ' +
                'panel first — the token is yours and never travels through this driver.'
            )
          }

          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book on this device.')

          // The app's own by-hand path, not a second assembly of the same
          // steps: a book put up from here has to be the same file as one put
          // up from the Settings panel, or opening it later would depend on
          // which button was pressed months earlier.
          const result = await shelfSave.pushStoredBook(config, newest.key, what)
          return {
            repository: where,
            pushed: result.path ?? null,
            note: result.note ?? null,
            queries: sync.queriesPath(newest.key),
            rulings: sync.rulingsPath(newest.key)
          }
        },
        [REPO, action ?? '', what]
      )
    },

    /**
     * Our reading of every leaf set beside somebody else's, and the places
     * the two could not agree.
     *
     * The argument for OCR has always been that it is not a language model, so
     * it shares no blind spots with whatever else read the page. That does not
     * stop at one engine: a book digitised twice — by archive.org's OCR, by a
     * Project Gutenberg volunteer — carries independent readings of the same
     * setting, and where two of them agree word for word that is evidence
     * neither could give alone.
     *
     * `second.json` is `{ "<leaf>": "text" }`. What comes back is, per leaf,
     * how far the two agree and every place they do not, **sorted worst-first
     * by our own engine's confidence** — a real probability (SPEC §4), and the
     * one honest way to say which disagreements are Tesseract stumbling and
     * which are the compositor and the other transcription genuinely differing.
     *
     * This does not skip the pixels and does not adopt anybody's text. It turns
     * "check every word of every leaf against the scan" into "check the places
     * two readers could not agree on", which is an order of magnitude shorter
     * with the hardest cases at the top.
     */
    witness: async ([secondPath, out = 'witness.json', ...ns]) => {
      if (!secondPath) throw new Error('witness <second.json> [out.json] [leaf...] [--ours <f>]')
      const { readFile, writeFile } = await import('node:fs/promises')
      const second = JSON.parse(await readFile(resolve(REPO, secondPath), 'utf8'))
      // `--ours <file>` compares a reading of our own that is not the raw OCR
      // — a draft, with the running head and folio already taken off the top.
      // Without it the commonest disagreement on every single leaf is the page
      // furniture, which the other transcription strips and ours keeps: eighty
      // rows of `"14 the human aura" -> ""` burying the real ones.
      //
      // The cost is honest and reported: a supplied reading carries no word
      // confidences, so nothing can be sorted by which of them our engine was
      // unsure about.
      const oursAt = ns.indexOf('--ours')
      const oursPath = oursAt === -1 ? null : ns[oursAt + 1]
      const ours = oursPath ? JSON.parse(await readFile(resolve(REPO, oursPath), 'utf8')) : null
      const only = ns
        .filter((_, i) => i !== oursAt && i !== oursAt + 1)
        .map(Number)
        .filter(Number.isFinite)
      const report = await page.evaluate(
        async ([repo, second, only, ours]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const cacheMod = await import(`/@fs${repo}/src/platform/browser/recon-cache.ts`)
          const recon = await import(`/@fs${repo}/src/platform/browser/recon.ts`)
          const witnessMod = await import(`/@fs${repo}/src/core/witness/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book on this device.')
          const cached = await cacheMod.loadReconCache(newest.key, {
            dpi: recon.RECON_DPI,
            maxPages: null
          })
          // Only when this needs *our* reading. A supplied one (`--ours`) is
          // already a reading; the cache would add nothing but the per-word
          // confidences, which a supplied reading has none of anyway. Demanding
          // it regardless made the verb refuse every book read before the cache
          // existed — which is exactly the set of books most in need of a
          // second opinion.
          if (!cached && !ours) {
            throw new Error(
              'No cached reading here and no `--ours` given, so there is nothing of ours to ' +
                'compare. Run recon, or supply a reading with `--ours <file>`.'
            )
          }

          const byLeaf = new Map()
          for (const w of cached?.words ?? []) {
            if (!byLeaf.has(w.pageIndex)) byLeaf.set(w.pageIndex, [])
            byLeaf.get(w.pageIndex).push(w)
          }

          const leaves = []
          for (const key of Object.keys(second)) {
            const leaf = Number(key)
            if (!Number.isFinite(leaf)) continue
            if (only.length > 0 && !only.includes(leaf)) continue
            const words = byLeaf.get(leaf) ?? []
            const supplied = ours ? String(ours[key] ?? '') : null
            const report = witnessMod.compareWitnesses(
              supplied ?? words.map((w) => w.text).join(' '),
              String(second[key] ?? ''),
              supplied === null ? { confidence: words.map((w) => w.confidence) } : {}
            )
            leaves.push({
              leaf,
              ourWords: report.words,
              agreement: Number(report.agreement.toFixed(3)),
              needEyes: report.needEyes,
              // Worst first: where two readers differ *and* the one holding the
              // pixels was unsure is the top of any list worth working.
              disagreements: report.disagreements
                .filter((d) => d.kind !== 'joined')
                .sort((a, b) => (a.confidence ?? 101) - (b.confidence ?? 101)),
              joins: witnessMod.joinsSettled(report).length
            })
          }
          leaves.sort((a, b) => a.leaf - b.leaf)
          return {
            leaves,
            // A leaf our engine read nothing on cannot disagree with anybody,
            // so it scores a perfect nothing and would sit quietly at the top
            // of a sorted list. Named separately, because it is the one row
            // here that means "this leaf was never checked".
            unread: leaves.filter((l) => l.ourWords === 0).map((l) => l.leaf),
            agreement: Number(
              (leaves.reduce((n, l) => n + l.agreement, 0) / Math.max(1, leaves.length)).toFixed(3)
            ),
            needEyes: leaves.reduce((n, l) => n + l.needEyes, 0)
          }
        },
        [REPO, second, only, ours]
      )
      await writeFile(resolve(REPO, out), JSON.stringify(report, null, 1), 'utf8')
      return {
        wrote: out,
        ours: oursPath ?? 'the cached OCR, furniture and all',
        leaves: report.leaves.length,
        agreement: report.agreement,
        needEyes: report.needEyes,
        unread: report.unread,
        worst: [...report.leaves]
          .sort((a, b) => a.agreement - b.agreement)
          .slice(0, 8)
          .map((l) => ({ leaf: l.leaf, agreement: l.agreement, needEyes: l.needEyes }))
      }
    },

    /**
     * The free reading, shaped like a page and ready to be corrected.
     *
     * With no API there is nothing that turns a leaf into blocks, and asking a
     * session to type one out from the render is the generative act this whole
     * design exists to avoid — a reader producing text from an image alone has
     * nothing to be wrong against. So the draft comes from the OCR that recon
     * already did and cached: every character is what Tesseract read off the
     * pixels, and what `draftPage` adds is the geometry it measured and threw
     * away — which lines sit together, which are indented, which are centred.
     *
     * The job that remains is therefore *"here is an image and here is a text,
     * where do they differ"*, which is the one shape of reading that cannot
     * confabulate a paragraph. Correct the draft against `leaf <n>`, then land
     * it with `transcribe`.
     *
     * `structural` is the reading order for that check: it lists what was
     * guessed rather than measured, so the correcting starts where the draft is
     * weakest. Nothing here is believed by anything downstream — the draft is
     * not saved, and only `transcribe` writes to the store.
     */
    draft: async ([out, ...ns]) => {
      if (!out || ns.length === 0) throw new Error('draft <out.json> <leaf> [leaf...]')
      const pages = ns.map(Number)
      if (pages.some((n) => !Number.isInteger(n) || n < 0)) {
        throw new Error('Leaves are whole numbers, counted from 0.')
      }
      const drafted = await page.evaluate(
        async ([repo, list]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const cacheMod = await import(`/@fs${repo}/src/platform/browser/recon-cache.ts`)
          const recon = await import(`/@fs${repo}/src/platform/browser/recon.ts`)
          const draftMod = await import(`/@fs${repo}/src/core/draft/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book open on this device.')
          // The cache first, because it is instant and because it is the
          // same reading every crop and word box on this device was built
          // from. Falling back to reading the leaves afresh rather than
          // refusing: the cache is only written once the user has agreed to
          // book data being kept here, and a session that declined that should
          // still be able to draft a page. Same DPI either way — a draft read
          // at a different one would put every box somewhere other than the
          // crops its corrections are checked against.
          const cached = await cacheMod.loadReconCache(newest.key, {
            dpi: recon.RECON_DPI,
            maxPages: null
          })
          const draftOf = (pageIndex, words) => ({
            pageIndex,
            words: words.length,
            ...draftMod.draftPage(words)
          })
          if (cached) {
            return {
              read: 'the cached reading',
              pages: list.map((n) =>
                draftOf(
                  n,
                  cached.words.filter((w) => w.pageIndex === n)
                )
              )
            }
          }
          const file = await runStore.loadSourceFile(newest.key)
          if (!file) throw new Error('No cached reading and no scan on this device.')
          const ocrMod = await import(`/@fs${repo}/src/platform/browser/ocr.ts`)
          const pdfMod = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
          const engine = new ocrMod.OcrEngine()
          const doc = await pdfMod.openPdf(file)
          const out = []
          try {
            for (const n of list) {
              const rendered = await pdfMod.renderPage(doc, n, recon.RECON_DPI)
              const result = await engine.recognize(rendered.canvas, n)
              out.push(draftOf(n, result.words))
              rendered.canvas.width = 0
              rendered.canvas.height = 0
            }
          } finally {
            await engine.dispose()
          }
          return { read: 'the leaves, read again just now', pages: out }
        },
        [REPO, pages]
      )

      const { writeFile } = await import('node:fs/promises')
      // The batch is written as the array `transcribe` takes, with the guesses
      // kept beside each page rather than stripped: a draft handed on without
      // its `structural` list looks exactly like a checked transcription, and
      // that is the one confusion that would put an unread leaf in a book.
      await writeFile(resolve(REPO, out), JSON.stringify(drafted.pages, null, 2) + '\n', 'utf8')
      return {
        wrote: out,
        read: drafted.read,
        leaves: drafted.pages.map((d) => ({
          pageIndex: d.pageIndex,
          role: d.role,
          blocks: d.blocks.length,
          words: d.words,
          uncertain: d.uncertain.length
        })),
        next: `Check each against \`leaf <n>\`, correct the text, then \`transcribe\`.`
      }
    },

    /**
     * A contact sheet of words, cut from the pages they are printed on.
     *
     * The rule is that text is never repaired without pixels, and the honest
     * way to honour it for a list of suspect spellings is to look at every one.
     * Done a page at a time that is two dozen full-page renders to check two
     * dozen words. This crops each word out of its own leaf and stacks them
     * into a single image, with what the transcription says beside it, so the
     * whole list can be read at once and any of them argued with.
     *
     * The boxes come from the reading already in hand — OCR gave every word one
     * — so this is a lookup plus one render per leaf, not a second reading.
     * Matching is on letters only: OCR's own text is what the box is filed
     * under, and it will have its own punctuation.
     *
     * Takes `page:word` pairs, e.g. `sheet typos 28:occulist 227:arrivd`.
     */
    sheet: async ([name = 'sheet', ...pairs]) => {
      const wanted = pairs.map((p) => {
        const [page, ...rest] = p.split(':')
        return { pageIndex: Number(page), word: rest.join(':') }
      })
      const dataUrl = await page.evaluate(
        async ([repo, list]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const cacheMod = await import(`/@fs${repo}/src/platform/browser/recon-cache.ts`)
          const crops = await import(`/@fs${repo}/src/platform/browser/word-crops.ts`)
          const recon = await import(`/@fs${repo}/src/platform/browser/recon.ts`)

          const newest = await window.__pdbfPickBook(runStore)
          const file = await runStore.loadSourceFile(newest.key)
          // `maxPages: null` is "the whole book" — the same shape the app
          // asks with. A record written for a partial reading is deliberately
          // refused, so this has to match rather than be left out.
          const cached = await cacheMod.loadReconCache(newest.key, {
            dpi: recon.RECON_DPI,
            maxPages: null
          })

          // No stored reading is the ordinary case rather than a failure: it is
          // written only as a convenience and only when the device is keeping
          // book data, so it is routinely absent. Reading the handful of leaves
          // actually asked about costs a minute; re-reading the book to get at
          // them would cost hours.
          const pages = [...new Set(list.map((i) => i.pageIndex))]
          let words = cached ? cached.words : []
          if (!cached) {
            const ocrMod = await import(`/@fs${repo}/src/platform/browser/ocr.ts`)
            const pdfMod = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
            const engine = new ocrMod.OcrEngine()
            const doc = await pdfMod.openPdf(file)
            try {
              for (const n of pages) {
                const rendered = await pdfMod.renderPage(doc, n, recon.RECON_DPI)
                const result = await engine.recognize(rendered.canvas, n)
                words = words.concat(result.words)
                rendered.canvas.width = 0
                rendered.canvas.height = 0
              }
            } finally {
              await engine.dispose()
            }
          }

          // Digits kept. Stripping to letters alone made every all-digit word
          // normalise to the empty string, and an empty needle matches the
          // first empty haystack: asking for the `3` on leaf 47 cut out the
          // folio `48` and showed it as evidence. A crop of the wrong word is
          // worse than no crop, because it is looked at and believed.
          const plain = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
          const byPage = new Map()
          for (const item of list) {
            const want = plain(item.word)
            // Nothing to look for is not a licence to show anything.
            if (want === '') continue
            const onPage = words.filter((w) => w.pageIndex === item.pageIndex)
            // Exact first. Failing that, the word is very likely broken at a
            // line end — the printer hyphenated it and OCR filed the halves
            // separately — so take the longest half that is a piece of it.
            // Showing the half that carries the misspelling is what the crop is
            // for; showing nothing because the word wrapped is not.
            const found =
              onPage.find((w) => plain(w.text) === want) ??
              onPage
                .filter((w) => {
                  const t = plain(w.text)
                  return t.length >= 3 && (want.startsWith(t) || want.endsWith(t))
                })
                .sort((a, b) => plain(b.text).length - plain(a.text).length)[0]
            if (!found) continue
            const group = byPage.get(item.pageIndex) ?? []
            // A little air either side, so the word is seen in its own ink
            // rather than shaved to the glyphs.
            group.push({
              id: `${item.pageIndex}:${item.word}`,
              words: [{ id: found.id, bbox: found.bbox }]
            })
            byPage.set(item.pageIndex, group)
          }

          const images = []
          for (const [pageIndex, groups] of byPage) {
            const cut = await crops.cropWordsFromPage(file, pageIndex, groups, {
              dpi: recon.RECON_DPI
            })
            for (const [id, url] of cut) {
              const bmp = await createImageBitmap(await (await fetch(url)).blob())
              URL.revokeObjectURL(url)
              images.push({ id, bmp })
            }
          }
          if (images.length === 0)
            throw new Error('None of those words were found on those leaves.')

          const pad = 10
          const labelW = 260
          const rowH = Math.max(...images.map((i) => i.bmp.height)) + pad
          const canvas = document.createElement('canvas')
          canvas.width = labelW + Math.max(...images.map((i) => i.bmp.width)) + pad * 2
          canvas.height = rowH * images.length + pad
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.fillStyle = '#000'
          ctx.font = '20px monospace'
          images.forEach((img, i) => {
            const y = pad + i * rowH
            ctx.fillText(img.id, pad, y + img.bmp.height / 2 + 7)
            ctx.drawImage(img.bmp, labelW, y)
            img.bmp.close()
          })
          return canvas.toDataURL('image/png')
        },
        [REPO, wanted]
      )
      const { writeFile } = await import('node:fs/promises')
      const file = `${OUT}/${name}.png`
      await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
      return { wrote: file, words: wanted.length }
    },

    /** What this browser is actually holding, when something says it is not. */
    diag: async () => {
      return page.evaluate(
        async ([repo]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const cacheMod = await import(`/@fs${repo}/src/platform/browser/recon-cache.ts`)
          const recon = await import(`/@fs${repo}/src/platform/browser/recon.ts`)
          // `diag` is the one verb that legitimately wants every run rather
          // than the current one — it exists to say what is on the device.
          const runs = await runStore.listRuns()
          const newest = await window.__pdbfPickBook(runStore)
          const whole = newest
            ? await cacheMod.loadReconCache(newest.key, { dpi: recon.RECON_DPI, maxPages: null })
            : null
          // The same `wanted` the whole-reading load uses. Called without it,
          // this threw on every book — a verb whose only job is to say what is
          // on the device, failing to say anything.
          const part = newest
            ? await cacheMod.loadReconCheckpoint(newest.key, {
                dpi: recon.RECON_DPI,
                maxPages: null
              })
            : null
          return {
            runs: runs.map((r) => ({ key: r.key, pages: r.pageCount, savedAt: r.savedAt })),
            wholeReading: whole ? { words: whole.words.length } : null,
            checkpoint: part ? { pagesDone: part.pagesDone ?? null } : null,
            dpi: recon.RECON_DPI
          }
        },
        [REPO]
      )
    },

    /**
     * Forget the verdicts stored for the open book, so the gate shows every
     * flagged leaf again.
     *
     * A leaf that has been answered is settled and drops out of the gate, which
     * is right for working through a book and wrong for checking the working.
     * The verdicts themselves are in the book file on the shelf; this only
     * clears the copy this browser is holding.
     */
    forget: async () => {
      return page.evaluate(() => {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith('pdbf.review.'))
        for (const k of keys) localStorage.removeItem(k)
        return { cleared: keys }
      })
    },

    /**
     * A link that opens this book, on any device, where the decisions are.
     *
     * The whole point of the deployed app: the editor works from a phone, and
     * without this, looking at one flagged word costs opening the app,
     * connecting the shelf, finding the book, waiting for the scan to be
     * fetched and re-read, answering the offer of the saved transcription, and
     * walking gates that were settled days ago — to arrive at a screen that
     * could have been the first one.
     *
     * The link names the book by its shelf slug and the place by its step, and
     * it **answers nothing**: every question still outstanding is still asked
     * when it gets there.
     *
     * `link review`, `link proof`, `link review 42` for one leaf.
     */
    link: async ([at = 'review', leaf]) => {
      const site =
        process.env.PDBF_SITE ?? 'https://lazmcspaz.github.io/Public-Domain-Book-Formatter/'
      return page.evaluate(
        async ([repo, base, where, whichLeaf]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const shelf = await import(`/@fs${repo}/src/core/sync/index.ts`)
          const wizard = await import(`/@fs${repo}/src/core/wizard/index.ts`)
          const queriesMod = await import(`/@fs${repo}/src/core/queries/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book on this device.')
          const run = await runStore.loadRun(newest.key)
          const slug = shelf.shelfSlug(newest.key)
          const raised = run ? queriesMod.collectQueries(run.transcriptions) : []
          return {
            url: wizard.deepLink(base, {
              slug,
              at: where,
              ...(Number.isFinite(Number(whichLeaf)) ? { leaf: Number(whichLeaf) } : {})
            }),
            book: run?.fileName ?? newest.fileName,
            slug,
            queriesWaiting: raised.length,
            // Said out loud because a link to a book the shelf has never seen
            // opens the intake screen and looks broken.
            onTheShelf:
              'This only works once the book has been pushed to the shelf — `shelf push` does ' +
              'that. `save` writes a book file to this filesystem and sends nothing anywhere.'
          }
        },
        [REPO, site, at, leaf ?? '']
      )
    },

    /**
     * The decisions waiting on the editor, as a sheet to read.
     *
     * Written to a file rather than printed, because a query that lives only in
     * a session survives exactly as long as the session does — and the whole
     * reason to raise one is that nobody should have to remember it. The shelf
     * wants it at `books/<slug>/queries.md`; `queriesPath` says so.
     *
     * Nothing here proposes a fix. That is the point of the channel.
     */
    queries: async ([out = 'queries.md']) => {
      const rendered = await page.evaluate(
        async ([repo]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const queriesMod = await import(`/@fs${repo}/src/core/queries/index.ts`)
          const shelf = await import(`/@fs${repo}/src/core/sync/index.ts`)
          const assemble = await import(`/@fs${repo}/src/core/assemble/index.ts`)
          const editsMod = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book on this device.')
          const run = await runStore.loadRun(newest.key)
          if (!run) throw new Error('That book has no reading stored here.')
          const raised = queriesMod.collectQueries(run.transcriptions)
          const rulings = run.rulings ?? []
          // A `corrected` ruling is a decision that has not happened until an
          // edit lands. The gap between the two is where a book quietly keeps
          // the error its editor is certain was fixed, so it is measured
          // against the assembled text rather than assumed.
          const doc = editsMod.applyEdits(
            assemble.assembleBook(run.transcriptions),
            run.edits ?? []
          )
          const notYet = queriesMod.unapplied(rulings, doc.blocks.map((b) => b.text).join('\n'))
          const waiting = queriesMod.outstanding(raised, rulings)
          const title =
            typeof run.identityAnswers?.title === 'string' && run.identityAnswers.title
              ? run.identityAnswers.title
              : run.fileName
          const book = { title, fileName: run.fileName }
          return {
            markdown: queriesMod.queriesMarkdown(book, raised, rulings),
            rulingsMarkdown: queriesMod.rulingsMarkdown(book, rulings),
            raised: raised.length,
            // What is actually left, which is the number a session should act
            // on. `raised` counts the ones already settled too, and a report
            // that only gave the total would send somebody back to decisions
            // the editor has made.
            waiting: waiting.length,
            ruled: rulings.length,
            byKind: queriesMod.countQueries(waiting),
            // Non-empty means the book does not yet read the way the editor
            // decided it should. Named rather than counted: a count here is
            // something to nod at and a list is something to act on.
            decidedButNotPrinted: notYet.map((r) => ({ leaf: r.pageIndex, quote: r.quote })),
            leaves: [...new Set(waiting.map((q) => q.pageIndex))],
            shelfPath: shelf.queriesPath(newest.key),
            rulingsShelfPath: shelf.rulingsPath(newest.key)
          }
        },
        [REPO]
      )
      const { writeFile } = await import('node:fs/promises')
      await writeFile(resolve(REPO, out), rendered.markdown, 'utf8')
      const rulingsOut = out.replace(/queries\.md$/u, 'rulings.md')
      const alongside = rulingsOut === out ? `${out}.rulings.md` : rulingsOut
      await writeFile(resolve(REPO, alongside), rendered.rulingsMarkdown, 'utf8')
      const report = { ...rendered }
      delete report.markdown
      delete report.rulingsMarkdown
      return { wrote: out, wroteRulings: alongside, ...report }
    },

    /**
     * Land a correction on one block, in the words `body` handed back.
     *
     * The one thing the driver could not do. A ruling that says a page should
     * read differently is a decision that has not happened until an edit lands,
     * and the only route to landing one was `save`, hand-editing the JSON, and
     * `load`ing it back — three steps around a file, each of which can go wrong
     * quietly, to change one word.
     *
     * ```
     * correct p10b2 replace.txt          # the block's whole new text, from a file
     * correct p11b2 --was radioative --now radio-active
     * ```
     *
     * The `--was/--now` form is a **substitution within the block**, not a
     * search of the book: it fails rather than guessing when the words appear
     * more than once, because a correction that silently changed two places is
     * indistinguishable from one that changed the right one. A `text` edit
     * replaces a block *entirely*, so the whole string is always what is
     * written — the substitution is a way of composing that string without
     * retyping four hundred words, never a way of editing part of a block.
     */
    correct: async (argv) => {
      const flag = (name) => {
        const i = argv.indexOf(`--${name}`)
        return i === -1 ? null : argv[i + 1]
      }
      const positional = argv.filter(
        (a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')
      )
      const blockId = positional[0]
      const from = positional[1] ?? null
      const was = flag('was')
      const now = flag('now')
      if (!blockId || (!from && was === null)) {
        throw new Error('correct <blockId> <file> | correct <blockId> --was <text> --now <text>')
      }

      let replacement = null
      if (from) {
        const { readFile } = await import('node:fs/promises')
        replacement = (await readFile(resolve(REPO, from), 'utf8')).replace(/\n+$/u, '')
      }

      return page.evaluate(
        async ([repo, blockId, replacement, was, now]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const assemble = await import(`/@fs${repo}/src/core/assemble/index.ts`)
          const editsMod = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const markup = await import(`/@fs${repo}/src/core/transcribe/markup.ts`)
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book on this device.')
          const run = await runStore.loadRun(newest.key)
          if (!run) throw new Error('That book has no reading stored here.')

          // Against the book *as it stands*, edits included — the same text
          // `body` hands back. A correction written against the raw pages
          // would truncate every paragraph a seam had joined, and one written
          // against the pristine text would silently undo an earlier fix.
          const doc = editsMod.applyEdits(
            assemble.assembleBook(run.transcriptions),
            run.edits ?? []
          )
          const block = doc.blocks.find((b) => b.id === blockId)
          if (!block) throw new Error(`No block \`${blockId}\` in this book.`)
          // With the `<i>` and `<b>` tags on, exactly as `body` hands it back
          // and exactly as `applyEdits` reads it in — a correction typed
          // against the bare text would strip every emphasis in the block.
          const before = markup.withMarkup(block.text, block.emphasis, block.strong)

          let text = replacement
          if (text === null) {
            const parts = before.split(was)
            if (parts.length === 1) {
              throw new Error(`\`${was}\` is not in block ${blockId}. Nothing was changed.`)
            }
            if (parts.length > 2) {
              throw new Error(
                `\`${was}\` appears ${parts.length - 1} times in block ${blockId}. ` +
                  'Give the whole block instead, so which one is meant is not a guess.'
              )
            }
            text = parts.join(now ?? '')
          }
          if (text === before) {
            return { blockId, changed: false, why: 'That is what the block already says.' }
          }

          const edits = editsMod.withEdit(run.edits ?? [], { kind: 'text', blockId, text })
          const next = project.createSavedRun({
            ...run,
            images: new Map(run.images.map((i) => [i.id, i.bytes])),
            savedAt: new Date().toISOString(),
            edits
          })
          const stored = await runStore.saveRun(next)
          return {
            blockId,
            changed: true,
            stored: stored === true,
            before,
            after: text,
            edits: edits.length,
            next: '`shelf push` sends it to the shelf; nothing has left this device yet.'
          }
        },
        [REPO, blockId, replacement, was, now]
      )
    },

    /**
     * Raise a query on a leaf that has already been read.
     *
     * Queries were only ever attachable at the moment a leaf was transcribed,
     * which is the one moment they are least likely to be noticed. Most of them
     * turn up later — proofing the set page, or running the consistency checks
     * over the assembled book — and until now there was nowhere to put one
     * except a chat session, which is the one place a decision must not live.
     *
     * ```
     * query 163 "the moment at which he awoke." printers-error "why this needs you"
     * ```
     *
     * The quoted words must be on the leaf, checked here rather than trusted: a
     * query whose quote is not in the book is one nobody can look up, and the
     * sheet it lands on is read months later by someone with only the words.
     *
     * There is deliberately no argument for a proposed fix. A suggestion beside
     * a question is an answer in all but name, and the answer is the editor's.
     */
    query: async ([leaf, quote, kind = 'unclear', why = '']) => {
      const pageIndex = Number(leaf)
      if (!Number.isInteger(pageIndex) || !quote || !why) {
        throw new Error('query <leaf> <quote> <printers-error|inconsistent|unclear> <why>')
      }
      if (!['printers-error', 'inconsistent', 'unclear'].includes(kind)) {
        throw new Error(`\`${kind}\` is not a kind of query.`)
      }
      return page.evaluate(
        async ([repo, pageIndex, quote, kind, why]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const queriesMod = await import(`/@fs${repo}/src/core/queries/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book on this device.')
          const run = await runStore.loadRun(newest.key)
          if (!run) throw new Error('That book has no reading stored here.')

          const leafAt = run.transcriptions.find((t) => t.pageIndex === pageIndex)
          if (!leafAt) throw new Error(`Leaf ${pageIndex} has not been read.`)

          // Against the leaf's own blocks, and against them as stored rather
          // than as assembled: a query names a place on a leaf, and the leaf is
          // what somebody will go and look at.
          const onTheLeaf = leafAt.blocks.map((b) => b.text).join(' ')
          if (!onTheLeaf.includes(quote)) {
            throw new Error(
              `Those words are not on leaf ${pageIndex}. A query nobody can look up is worse ` +
                'than none, so nothing was written.'
            )
          }
          const already = (leafAt.queries ?? []).some((q) => q.quote === quote)
          if (already) {
            return { pageIndex, raised: false, why: 'That query is already on this leaf.' }
          }

          const transcriptions = run.transcriptions.map((t) =>
            t.pageIndex === pageIndex
              ? { ...t, queries: [...(t.queries ?? []), { quote, why, kind }] }
              : t
          )
          const next = project.createSavedRun({
            ...run,
            images: new Map(run.images.map((i) => [i.id, i.bytes])),
            savedAt: new Date().toISOString(),
            transcriptions
          })
          const stored = await runStore.saveRun(next)
          const raised = queriesMod.collectQueries(transcriptions)
          return {
            pageIndex,
            raised: true,
            stored: stored === true,
            queriesOnThisBook: raised.length,
            waiting: queriesMod.outstanding(raised, run.rulings ?? []).length,
            next: 'Run `queries` to rewrite the sheet.'
          }
        },
        [REPO, pageIndex, quote, kind, why]
      )
    },

    /**
     * Amend a section the editor wrote — the introduction, a glossary.
     *
     * `correct` reaches the blocks of the *book*; nothing reached the prose
     * this edition adds to it. That prose lives twice — as a `section` edit
     * inside the book, which is what prints, and as Markdown on the shelf,
     * which is what a person reads — and the two can drift. They did: a
     * correction landed, the shelf's `introduction.md` was updated to say
     * eighty-one, and the book went on printing eighty.
     *
     * ```
     * section introduction --was "Eighty errors" --now "Eighty-one errors"
     * section introduction --from intro.md          # replace it wholesale
     * section                                       # list what there is
     * ```
     *
     * A substitution refuses rather than guesses when the words appear more
     * than once, for the same reason `correct` does.
     */
    section: async (argv) => {
      const flag = (name) => {
        const i = argv.indexOf(`--${name}`)
        return i === -1 ? null : argv[i + 1]
      }
      const sectionId = argv.find(
        (a) =>
          !a.startsWith('--') &&
          argv[argv.indexOf(a) - 1] !== '--was' &&
          argv[argv.indexOf(a) - 1] !== '--now' &&
          argv[argv.indexOf(a) - 1] !== '--from'
      )
      const from = flag('from')
      const was = flag('was')
      const now = flag('now')
      let replacement = null
      if (from) {
        const { readFile } = await import('node:fs/promises')
        replacement = (await readFile(resolve(REPO, from), 'utf8')).replace(/\n+$/u, '')
      }

      return page.evaluate(
        async ([repo, sectionId, replacement, was, now]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const editsMod = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book on this device.')
          const run = await runStore.loadRun(newest.key)
          if (!run) throw new Error('That book has no reading stored here.')

          const sections = (run.edits ?? []).filter((e) => e.kind === 'section')
          if (!sectionId) {
            return {
              sections: sections.map((s) => ({
                sectionId: s.sectionId,
                title: s.title,
                placement: s.placement,
                words: String(s.text ?? '')
                  .split(/\s+/u)
                  .filter(Boolean).length
              }))
            }
          }
          const found = sections.find((s) => s.sectionId === sectionId)
          if (!found) {
            throw new Error(
              `No section \`${sectionId}\`. There is: ${sections.map((s) => s.sectionId).join(', ') || 'none'}`
            )
          }

          let text = replacement
          if (text === null) {
            if (was === null) throw new Error('Give `--from <file>` or `--was ... --now ...`.')
            const parts = String(found.text ?? '').split(was)
            if (parts.length === 1) {
              throw new Error(`\`${was}\` is not in the ${sectionId}. Nothing was changed.`)
            }
            if (parts.length > 2) {
              throw new Error(
                `\`${was}\` appears ${parts.length - 1} times in the ${sectionId}. ` +
                  'Give the whole section with `--from` instead.'
              )
            }
            text = parts.join(now ?? '')
          }
          if (text === found.text) {
            return { sectionId, changed: false, why: 'That is what it already says.' }
          }

          const edits = editsMod.withEdit(run.edits ?? [], { ...found, text })
          const next = project.createSavedRun({
            ...run,
            images: new Map(run.images.map((i) => [i.id, i.bytes])),
            savedAt: new Date().toISOString(),
            edits
          })
          const stored = await runStore.saveRun(next)
          return {
            sectionId,
            title: found.title,
            changed: true,
            stored: stored === true,
            wordsBefore: String(found.text ?? '')
              .split(/\s+/u)
              .filter(Boolean).length,
            wordsAfter: text.split(/\s+/u).filter(Boolean).length,
            next: 'The Markdown on the shelf is a mirror — update it to match.'
          }
        },
        [REPO, sectionId ?? '', replacement, was, now]
      )
    },

    /**
     * Record what the editor decided about a query.
     *
     * The other half of a channel that was, until now, one-way: the question
     * reached a file on the shelf and the answer reached a chat session, which
     * is the one place it must not live. A ruling made in conversation and
     * nowhere else means the next session raises the same question, and the
     * introduction has to be told from memory what the edition decided.
     *
     * ```
     * rule 12 radioative corrected radioactive "A plain compositor's slip." mention
     * rule 8 "the centre" as-printed - "Keep the mixed spelling."
     * rule standing "British/American spelling" noted - "..." covers:centre,colors
     * ```
     *
     * The `correction` argument is `-` for anything but `corrected`, and it is
     * the one field a *query* is forbidden to have — a ruling is the answer, so
     * it may carry one.
     */
    rule: async ([leaf, quote, decision, correction = '-', because = '', ...flags]) => {
      if (!quote || !decision) {
        throw new Error(
          'rule <leaf|standing> <quote> <as-printed|corrected|noted> [correction|-] ' +
            '[why] [mention] [covers:a,b] [kind:inconsistent]'
        )
      }
      const kind = flags.find((f) => f.startsWith('kind:'))?.slice('kind:'.length)
      if (kind && !['printers-error', 'inconsistent', 'unclear'].includes(kind)) {
        throw new Error(`\`${kind}\` is not a kind of query.`)
      }
      const covers = flags
        .filter((f) => f.startsWith('covers:'))
        .flatMap((f) =>
          f
            .slice('covers:'.length)
            .split(',')
            .map((c) => c.trim())
        )
        .filter(Boolean)
      const ruling = {
        pageIndex: leaf === 'standing' ? null : Number(leaf),
        quote,
        decision,
        correction: correction === '-' ? undefined : correction,
        because: because || undefined,
        covers: covers.length > 0 ? covers : undefined,
        kind: kind || undefined,
        mention: flags.includes('mention'),
        decidedOn: new Date().toISOString().slice(0, 10)
      }
      if (ruling.pageIndex !== null && !Number.isInteger(ruling.pageIndex)) {
        throw new Error(`\`${leaf}\` is not a leaf number, and not \`standing\`.`)
      }
      // Checked here rather than left to `parseRulings`, which drops what it
      // does not recognise: a ruling silently discarded on the next reload
      // looks exactly like one that was never made.
      if (!['as-printed', 'corrected', 'noted'].includes(decision)) {
        throw new Error(`\`${decision}\` is not a decision. Use as-printed, corrected or noted.`)
      }
      if (decision === 'corrected' && !ruling.correction) {
        throw new Error('A `corrected` ruling has to say what the page should read.')
      }
      return page.evaluate(
        async ([repo, proposed]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const queriesMod = await import(`/@fs${repo}/src/core/queries/index.ts`)
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const newest = await window.__pdbfPickBook(runStore)
          if (!newest) throw new Error('No book on this device.')
          const run = await runStore.loadRun(newest.key)
          if (!run) throw new Error('That book has no reading stored here.')

          const raised = queriesMod.collectQueries(run.transcriptions)
          // The kind comes off the *question* rather than the command line: a
          // ruling that named a kind of its own could disagree with the query
          // it answers, and a ruling that matches nothing settles nothing
          // while looking exactly like one that does.
          const asked = raised.find(
            (q) =>
              q.pageIndex === proposed.pageIndex &&
              q.quote.trim().toLowerCase() === proposed.quote.trim().toLowerCase()
          )
          // A standing ruling has no one question to take it from, so it takes
          // it from the questions its `covers` actually reach. Refused rather
          // than guessed when they reach none or disagree — a standing ruling
          // filed under a kind nothing asked about is a decision that has been
          // made and will be asked for again.
          const covered =
            proposed.pageIndex !== null
              ? []
              : [
                  ...new Set(
                    raised
                      .filter((q) =>
                        (proposed.covers ?? []).some(
                          (c) => c.trim() && q.quote.toLowerCase().includes(c.toLowerCase())
                        )
                      )
                      .map((q) => q.kind)
                  )
                ]
          const kind = asked?.kind ?? proposed.kind ?? (covered.length === 1 ? covered[0] : null)
          if (!kind) {
            throw new Error(
              proposed.pageIndex === null
                ? `Nothing this covers is a single kind of query (${covered.join(', ') || 'none matched'}). ` +
                    'Say which with `kind:printers-error`, `kind:inconsistent` or `kind:unclear`.'
                : `No query was raised on leaf ${proposed.pageIndex} with those words. ` +
                    'Say which kind this is with `kind:...`, or check the quote against `queries`.'
            )
          }
          const ruling = { ...proposed, kind }
          for (const key of Object.keys(ruling)) {
            if (ruling[key] === undefined) delete ruling[key]
          }

          // Replace rather than append when the same thing is ruled on twice:
          // two rulings on one query is a file that says the edition decided
          // two things, and nothing downstream could pick.
          const kept = (run.rulings ?? []).filter(
            (r) =>
              !(
                r.pageIndex === ruling.pageIndex &&
                r.quote.trim().toLowerCase() === ruling.quote.trim().toLowerCase()
              )
          )
          const rulings = [...kept, ruling]
          const next = project.createSavedRun({
            ...run,
            images: new Map(run.images.map((i) => [i.id, i.bytes])),
            savedAt: new Date().toISOString(),
            rulings
          })
          const saved = await runStore.saveRun(next)
          const waiting = queriesMod.outstanding(raised, rulings)
          return {
            recorded: ruling,
            matchedAQuery: Boolean(asked),
            rulings: rulings.length,
            replaced: kept.length !== (run.rulings ?? []).length,
            waiting: waiting.length,
            stored: saved === true,
            savedAt: next.savedAt,
            next: 'Run `queries` to rewrite both sheets, then `save` to push them.'
          }
        },
        [REPO, ruling]
      )
    },

    /**
     * Every reading on this device, and a way to drop one.
     *
     * `transcribe` can write a run, so something has to be able to unwrite one:
     * a batch landed against a mistyped file, or a run stranded under a key
     * nothing will look up again, otherwise sits in the store forever and — far
     * worse — is what `listRuns()` hands back as "the newest", which is how
     * every other verb here finds the book. A stray run does not sit quietly
     * beside the real one; it *replaces* it for anything sorting by date.
     *
     * Named rather than matched: dropping a reading is the one destructive
     * thing this driver does, and the transcription is the half of the work
     * that costs money.
     */
    runs: async ([action, which]) => {
      return page.evaluate(
        async ([repo, verb, target]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const summaries = (await runStore.listRuns()).sort((a, b) =>
            b.savedAt.localeCompare(a.savedAt)
          )
          // Only what a summary actually carries. It has no count of leaves
          // read — `pageCount` is how long the book is — so there is no
          // "transcribed" here to report, and standing one up out of
          // `pageCount` would have every partial reading on the device
          // announcing itself as finished.
          const shown = summaries.map((r, i) => ({
            at: i,
            key: r.key,
            fileName: r.fileName,
            pageCount: r.pageCount,
            complete: r.complete,
            failedPages: r.failedPages,
            savedAt: r.savedAt
          }))
          if (verb !== 'drop') return { runs: shown, newest: shown[0]?.fileName ?? null }
          const at = Number(target)
          const chosen = shown[at]
          if (!chosen) throw new Error(`No run at ${target}. Run \`runs\` to see them.`)
          await runStore.deleteRun(chosen.key)
          return { dropped: chosen, left: shown.length - 1 }
        },
        [REPO, action ?? 'list', which]
      )
    },

    /** What the stubbed repository holds, so a push can be checked. */
    repo: () => ({
      files: [...repoFiles.keys()].sort(),
      bytes: Object.fromEntries(
        [...repoFiles.entries()].map(([k, v]) => [k, Buffer.from(v, 'base64').length])
      )
    }),

    goto: async ([url = URL_BASE]) => {
      await page.goto(url.startsWith('http') ? url : `${URL_BASE}${url}`, {
        waitUntil: 'networkidle'
      })
      return { at: page.url() }
    },

    /** Whatever the page has complained about since it loaded. */
    errors: () => ({ errors }),

    quit: () => ({ closing: true })
  }

  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      void (async () => {
        try {
          const { verb, args = [] } = JSON.parse(body || '{}')
          const handler = handlers[verb]
          if (!handler) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                error: `No such verb “${verb}”. Try: ${Object.keys(handlers)
                  .filter((v) => !v.startsWith('_'))
                  .join(', ')}`
              })
            )
            return
          }
          const result = await handler(args)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result, null, 2))
          if (verb === 'quit') {
            server.close()
            await browser.close()
            process.exit(0)
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        }
      })()
    })
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`driving ${URL_BASE} — commands on ${PORT}`)
    console.log(`  node scripts/drive.mjs open`)
    console.log(`  node scripts/drive.mjs state`)
  })
}
