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
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })

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
      const buffer = await (await import('node:fs/promises')).readFile(resolve(REPO, path))
      const name = path.split('/').pop()
      await page.setInputFiles('input[type=file]', {
        name,
        mimeType: name.endsWith('.epub') ? 'application/epub+zip' : 'application/pdf',
        buffer
      })
      return { opened: name, bytes: buffer.length }
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
     */
    load: async ([bookPath, scanPath]) => {
      const { readFile, stat } = await import('node:fs/promises')
      const json = await readFile(resolve(REPO, bookPath), 'utf8')
      const scan = resolve(REPO, scanPath)
      const meta = await stat(scan)
      const name = scanPath.split('/').pop()
      const loaded = await page.evaluate(
        async ([repo, text, file]) => {
          const project = await import(`/@fs${repo}/src/core/project/index.ts`)
          const runStore = await import(`/@fs${repo}/src/platform/browser/run-store.ts`)
          const book = project.parseBookFile(text)
          const key = project.fileKey(file)
          const run = { ...book.run, key, fileName: file.name }
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
            complete: run.complete,
            savedAt: book.savedAt
          }
        },
        [REPO, json, { name, size: meta.size, lastModified: Math.floor(meta.mtimeMs) }]
      )
      return loaded
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
