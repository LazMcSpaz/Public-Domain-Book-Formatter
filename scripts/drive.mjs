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
      return { opened: full.split('/').pop(), bytes: meta.size }
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
          await runStore.deleteRun(key)
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
          await runStore.deleteRun(key)
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
            savedAt: book.savedAt
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

      const out = { ...loaded, scanStored: true }
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
          const keys = await runStore.listRuns()
          const newest = keys.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
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
    leaf: async ([n, name, dpi = '150', crop = '']) => {
      const pageIndex = Number(n)
      const resolution = Number(dpi)
      // `x,y,w,h` as fractions of the leaf, for cutting a plate out of a scan:
      // a cover with a later owner's label pasted across the foot, a page with
      // a digitiser's watermark along the bottom. Fractions rather than pixels
      // so the same crop survives a change of resolution.
      const box = crop
        .split(',')
        .map(Number)
        .filter((v) => Number.isFinite(v))
      const url = await page.evaluate(
        async ([repo, index, atDpi, window]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const pdf = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
          const runs = await runStore.listRuns()
          const newest = runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
          if (!newest) throw new Error('No book open on this device.')
          const file = await runStore.loadSourceFile(newest.key)
          if (!file) throw new Error('The scan is not stored on this device.')
          if (window.length !== 4) return pdf.renderPageToObjectUrl(file, index, atDpi)
          const doc = await pdf.openPdf(file)
          const rendered = await pdf.renderPage(doc, index, atDpi)
          const [fx, fy, fw, fh] = window
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
        [REPO, pageIndex, resolution, box]
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

          const runs = await runStore.listRuns()
          const newest = runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
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
    consistency: async ([out = 'consistency.json']) => {
      const found = await page.evaluate(
        async ([repo]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const assemble = await import(`/@fs${repo}/src/core/assemble/index.ts`)
          const editsMod = await import(`/@fs${repo}/src/core/edits/index.ts`)
          const coherence = await import(`/@fs${repo}/src/core/coherence/index.ts`)
          const quotes = await import(`/@fs${repo}/src/core/layout/index.ts`)
          const runs = await runStore.listRuns()
          const newest = runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
          if (!newest) throw new Error('No book open on this device.')
          const run = await runStore.loadRun(newest.key)
          const doc = editsMod.applyEdits(
            assemble.assembleBook(run.transcriptions),
            run.edits ?? []
          )
          // Through the quote pass first, because the unclosed-quote check
          // counts printer's marks: a straight mark opens and closes with the
          // same character and cannot be counted at all.
          return coherence.checkConsistency(quotes.withTypographicQuotes(doc))
        },
        [REPO]
      )
      const { writeFile } = await import('node:fs/promises')
      await writeFile(out, JSON.stringify(found, null, 1))
      const byKind = {}
      for (const f of found) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1
      return { wrote: out, findings: found.length, byKind }
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
          const runs = await runStore.listRuns()
          const newest = runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
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
              level: c.level
            })),
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
      const pages = ns.map(Number)
      return page.evaluate(
        async ([repo, list]) => {
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const cacheMod = await import(`/@fs${repo}/src/platform/browser/recon-cache.ts`)
          const ocrMod = await import(`/@fs${repo}/src/platform/browser/ocr.ts`)
          const pdfMod = await import(`/@fs${repo}/src/platform/browser/pdf.ts`)
          const recon = await import(`/@fs${repo}/src/platform/browser/recon.ts`)
          const runs = await runStore.listRuns()
          const newest = runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
          if (!newest) throw new Error('No book open on this device.')
          const file = await runStore.loadSourceFile(newest.key)
          if (!file) throw new Error('The scan is not stored on this device.')
          const cached = await cacheMod.loadReconCache(newest.key, {
            dpi: recon.RECON_DPI,
            maxPages: null
          })
          const out = {}
          const say = (words) => words.map((w) => w.text).join(' ')
          if (cached) {
            for (const n of list) out[n] = say(cached.words.filter((w) => w.pageIndex === n))
            return out
          }
          const engine = new ocrMod.OcrEngine()
          const doc = await pdfMod.openPdf(file)
          try {
            for (const n of list) {
              const rendered = await pdfMod.renderPage(doc, n, recon.RECON_DPI)
              const result = await engine.recognize(rendered.canvas, n)
              out[n] = say(result.words)
              rendered.canvas.width = 0
              rendered.canvas.height = 0
            }
          } finally {
            await engine.dispose()
          }
          return out
        },
        [REPO, pages]
      )
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

          const runs = await runStore.listRuns()
          const newest = runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
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

          const plain = (t) => t.toLowerCase().replace(/[^a-z]/g, '')
          const byPage = new Map()
          for (const item of list) {
            const want = plain(item.word)
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
          const runs = await runStore.listRuns()
          const newest = runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
          const whole = newest
            ? await cacheMod.loadReconCache(newest.key, { dpi: recon.RECON_DPI, maxPages: null })
            : null
          const part = newest ? await cacheMod.loadReconCheckpoint(newest.key) : null
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
                error: `No such verb “${verb}”. Try: ${Object.keys(handlers).join(', ')}`
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
