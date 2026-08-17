import { describe, it, expect } from 'vitest'
import {
  STEPS,
  activeStep,
  initialState,
  stepById,
  progress,
  defaultAnswers,
  missingRequired,
  frontMatterPages,
  type WizardState,
  type StepId
} from '@core/wizard'
import { dispositionFor, partitionByDisposition, strippedFurniture } from '@core/pages'
import type { LexiconEntry } from '@core/lexicon'
import { assembleBook } from '@core/assemble'
import type { TranscribedBlock } from '@core/transcribe'
import type { PageRole } from '@core/pages'
import { BODY_FONTS, profileFromAnswers } from '@core/design'
import { editionFromAnswers } from '@core/export'

function entry(term: string, count: number, extra: Partial<LexiconEntry> = {}): LexiconEntry {
  return {
    term,
    count,
    meanConfidence: 90,
    pages: [1, 2],
    variants: [],
    signals: ['frequent-unknown'],
    impact: count,
    sampleTokenId: `${term}-0`,
    ...extra
  }
}

/** A state that has finished recon on a small book. */
function reconDone(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...initialState(),
    fileName: 'alchemist.pdf',
    pageCount: 12,
    pagesProcessed: 12,
    metadata: {
      title: 'The Alchemist His Practise',
      subtitle: null,
      author: 'Anonymous',
      originalYear: '1662',
      originalPublisher: 'J. Smith',
      originalPlace: 'London',
      contributors: []
    },
    classifications: [
      { pageIndex: 0, role: 'title-page', selfReportedConfidence: 0.95 },
      { pageIndex: 1, role: 'copyright', selfReportedConfidence: 0.9 },
      { pageIndex: 2, role: 'table-of-contents', selfReportedConfidence: 0.9 },
      { pageIndex: 3, role: 'chapter-opening', selfReportedConfidence: 0.9 },
      {
        pageIndex: 4,
        role: 'body',
        selfReportedConfidence: 0.95,
        furniture: { runningHead: 'THE ALCHEMIST HIS PRACTISE', folio: '37' }
      }
    ],
    lexicon: [entry('chirurgeon', 43), entry('alembick', 17)],
    ...overrides
  }
}

describe('step ordering', () => {
  it('starts at intake with an empty state', () => {
    expect(activeStep(initialState()).id).toBe('intake')
  })

  it('moves to recon once a file is loaded', () => {
    const s = {
      ...initialState(),
      fileName: 'book.pdf',
      pageCount: 100,
      completed: ['intake' as const]
    }
    expect(activeStep(s).id).toBe('recon')
  })

  it('reaches the identity gate once pages are processed', () => {
    const s = { ...reconDone(), completed: ['intake' as const, 'recon' as const] }
    expect(activeStep(s).id).toBe('gate-identity')
  })

  it('will not enter transcription before the identity gate is done', () => {
    const s = reconDone()
    expect(stepById('transcribe').canEnter(s)).toBe(false)
    s.completed = ['intake', 'recon', 'gate-identity']
    expect(stepById('transcribe').canEnter(s)).toBe(true)
  })

  it('reports progress across the flow', () => {
    const p = progress({ ...reconDone(), completed: ['intake', 'recon'] })
    expect(p.total).toBe(STEPS.length)
    expect(p.done).toBe(2)
    expect(p.pct).toBeGreaterThan(0)
  })
})

describe('gate 1 questions', () => {
  // Gate 1 runs before anything has *read* the title page, so asking for the
  // title here would be asking the user to go and open the PDF themselves.
  // Those three questions live at the export gate now, prefilled.
  it('does not ask for facts it cannot yet prefill', () => {
    const ids = stepById('gate-identity')
      .questions(reconDone())
      .map((q) => q.id)
    expect(ids).not.toContain('title')
    expect(ids).not.toContain('author')
    expect(ids).not.toContain('originalYear')
  })

  it('defaults orthography to preserve (a reprint, not an edit)', () => {
    const qs = stepById('gate-identity').questions(reconDone())
    const q = qs.find((x) => x.id === 'orthography')!
    expect(q.type).toBe('choice')
    expect((q as { defaultValue: string }).defaultValue).toBe('preserve')
  })

  it('asks about long-s ONLY when the book actually uses it', () => {
    const without = stepById('gate-identity').questions(reconDone())
    expect(without.find((q) => q.id === 'longS')).toBeUndefined()

    const withLongS = stepById('gate-identity').questions(
      reconDone({ lexicon: [entry('chirurgeon', 5), entry('ſhew', 9)] })
    )
    expect(withLongS.find((q) => q.id === 'longS')).toBeDefined()
  })

  it('builds one batched term grid rather than a question per term', () => {
    const qs = stepById('gate-identity').questions(reconDone())
    const grid = qs.filter((q) => q.type === 'term-grid')
    expect(grid).toHaveLength(1)
    expect((grid[0] as { rows: unknown[] }).rows).toHaveLength(2)
  })

  it('wires each term row to its word-crop image', () => {
    const state = reconDone({ cropFor: (id) => `blob:crop/${id}` })
    const qs = stepById('gate-identity').questions(state)
    const grid = qs.find((q) => q.type === 'term-grid')! as { rows: { cropSrc?: string }[] }
    expect(grid.rows[0]!.cropSrc).toBe('blob:crop/chirurgeon-0')
  })

  it('omits the grid when nothing unusual was harvested', () => {
    const qs = stepById('gate-identity').questions(reconDone({ lexicon: [] }))
    expect(qs.find((q) => q.type === 'term-grid')).toBeUndefined()
  })
})

describe('answers', () => {
  it('provides a complete "just continue" default set', () => {
    const qs = stepById('gate-identity').questions(reconDone())
    const a = defaultAnswers(qs)
    expect(a['orthography']).toBe('preserve')
    // Every term defaults to accepted; the user overrides the wrong ones.
    expect(a['terms']).toMatchObject({ chirurgeon: { action: 'accept' } })
  })

  it('reports required questions left blank', () => {
    const state = {
      ...reconDone(),
      metadata: { ...reconDone().metadata, title: null, author: null },
      completed: [
        'intake',
        'recon',
        'gate-identity',
        'transcribe',
        'gate-uncertainties',
        'gate-structure',
        'proof',
        'design'
      ] as StepId[]
    }
    const qs = stepById('export').questions(state)
    const missing = missingRequired(qs, defaultAnswers(qs))
    expect(missing).toContain('title')
    expect(missing).toContain('author')
  })
})

describe('page roles', () => {
  it('mines front matter for metadata instead of transcribing it', () => {
    expect(dispositionFor('title-page')).toBe('extract-metadata')
    expect(dispositionFor('copyright')).toBe('extract-metadata')
  })

  it('discards the scanned TOC and index (their page numbers are the OLD edition’s)', () => {
    expect(dispositionFor('table-of-contents')).toBe('discard')
    expect(dispositionFor('index')).toBe('discard')
  })

  it('transcribes real body content', () => {
    expect(dispositionFor('body')).toBe('transcribe')
    expect(dispositionFor('chapter-opening')).toBe('transcribe')
  })

  it('partitions pages by what happens to them', () => {
    const parts = partitionByDisposition(reconDone().classifications)
    expect(parts['extract-metadata']).toEqual([0, 1])
    expect(parts.discard).toEqual([2])
    expect(parts.transcribe).toEqual([3, 4])
  })

  it('lists front-matter pages for the gate', () => {
    expect(frontMatterPages(reconDone()).map((c) => c.pageIndex)).toEqual([0, 1, 2])
  })

  it('reports stripped running heads and folios so nothing vanishes silently', () => {
    const f = strippedFurniture(reconDone().classifications)
    expect(f.runningHeads).toEqual(['THE ALCHEMIST HIS PRACTISE'])
    expect(f.folioCount).toBe(1)
  })
})

describe('transcribe step questions', () => {
  const ready = (overrides: Partial<WizardState> = {}): WizardState => ({
    ...reconDone(),
    completed: ['intake', 'recon', 'gate-identity'],
    ...overrides
  })

  const savedRun = {
    key: 'alchemist.pdf 1024 99',
    fileName: 'alchemist.pdf',
    savedAt: new Date().toISOString(),
    pageCount: 312,
    failedPages: 0,
    complete: true,
    modelId: 'claude-opus-5',
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 }
  }

  it('asks for an API key only when one is not already stored', () => {
    const without = stepById('transcribe').questions(ready({ hasApiKey: false }))
    expect(without.find((q) => q.id === 'apiKey')).toBeDefined()

    const withKey = stepById('transcribe').questions(ready({ hasApiKey: true }))
    expect(withKey.find((q) => q.id === 'apiKey')).toBeUndefined()
  })

  it('says plainly where the key is stored', () => {
    const q = stepById('transcribe')
      .questions(ready())
      .find((x) => x.id === 'apiKey')!
    expect(q.help).toMatch(/only in this browser/i)
    expect(q.help).toMatch(/never/i)
  })

  it('offers a model choice and defaults to the highest quality', () => {
    const q = stepById('transcribe')
      .questions(ready())
      .find((x) => x.id === 'model')!
    expect(q.type).toBe('choice')
    expect((q as { defaultValue: string }).defaultValue).toBe('claude-opus-5')
    expect((q as { options: unknown[] }).options).toHaveLength(3)
  })

  it('offers a transcription this file was already paid for', () => {
    const q = stepById('transcribe')
      .questions(ready({ savedRun }))
      .find((x) => x.id === 'useSavedRun')!
    expect(q).toBeDefined()
    expect((q as { defaultValue: string }).defaultValue).toBe('use')
    // The evidence for the recommendation: how much, how old, and by what.
    expect(q.help).toContain('312')
    expect(q.help).toMatch(/claude-opus-5/)
  })

  it('asks nothing about spending when the saved run is being used', () => {
    // Every other question at this gate exists to approve a charge. With
    // nothing to charge for, asking them would be asking for no reason.
    const qs = stepById('transcribe').questions(
      ready({ savedRun, hasApiKey: false, answers: { transcribe: { useSavedRun: 'use' } } })
    )
    expect(qs.map((q) => q.id)).toEqual(['useSavedRun'])
  })

  it('asks the spending questions again when the user chooses to re-read', () => {
    const qs = stepById('transcribe').questions(
      ready({ savedRun, hasApiKey: false, answers: { transcribe: { useSavedRun: 'again' } } })
    )
    expect(qs.map((q) => q.id)).toEqual([
      'useSavedRun',
      'apiKey',
      'model',
      'bookContext',
      'keepScans'
    ])
  })

  it('says how many pages went unread, rather than implying a clean run', () => {
    const q = stepById('transcribe')
      .questions(ready({ savedRun: { ...savedRun, failedPages: 4 } }))
      .find((x) => x.id === 'useSavedRun')!
    expect(q.help).toMatch(/4 page\(s\) failed/)
  })

  it('asks nothing about a saved run when there is none', () => {
    const qs = stepById('transcribe').questions(ready())
    expect(qs.find((q) => q.id === 'useSavedRun')).toBeUndefined()
  })

  it('invites book context, which measurably helps unusual vocabulary', () => {
    const q = stepById('transcribe')
      .questions(ready())
      .find((x) => x.id === 'bookContext')
    expect(q).toBeDefined()
    expect(q!.required).toBeFalsy()
    // Asked for in a box with room to write it. The flag was declared here and
    // ignored by the renderer, which answered "tell me about this book" with a
    // single line that scrolls sideways.
    expect((q as { multiline?: boolean }).multiline).toBe(true)
  })

  it('is not enterable until the identity gate is done', () => {
    expect(stepById('transcribe').canEnter(reconDone())).toBe(false)
    expect(stepById('transcribe').canEnter(ready())).toBe(true)
  })
})

describe('gate 2 — uncertain spots', () => {
  const transcribed = (overrides: Partial<WizardState> = {}): WizardState => ({
    ...reconDone(),
    completed: ['intake', 'recon', 'gate-identity', 'transcribe'],
    ...overrides
  })

  it('shows nothing when every page passed both checks', () => {
    expect(stepById('gate-uncertainties').questions(transcribed())).toHaveLength(0)
  })

  it('surfaces a page flagged by deterministic evidence', () => {
    const qs = stepById('gate-uncertainties').questions(
      transcribed({
        findings: [
          { code: 'text-dropped', severity: 'high', pageIndex: 4, message: '30% shorter than OCR.' }
        ]
      })
    )
    expect(qs).toHaveLength(1)
    expect(qs[0]!.prompt).toBe('Page 5')
    expect(qs[0]!.help).toContain('30% shorter')
  })

  it('attaches the page scan as evidence so nothing is judged blind', () => {
    const qs = stepById('gate-uncertainties').questions(
      transcribed({
        findings: [{ code: 'empty-page', severity: 'high', pageIndex: 2, message: 'Nothing read.' }]
      })
    )
    expect(qs[0]!.evidence?.[0]).toMatchObject({ kind: 'image', src: 'page:2' })
  })

  it('ignores low-severity findings — reviewing noise defeats the point', () => {
    const qs = stepById('gate-uncertainties').questions(
      transcribed({
        findings: [
          { code: 'orphan-footnote', severity: 'low', pageIndex: 1, message: 'No marker.' }
        ]
      })
    )
    expect(qs).toHaveLength(0)
  })

  it('includes the model’s own reported uncertainties with alternatives', () => {
    const qs = stepById('gate-uncertainties').questions(
      transcribed({
        uncertainties: [
          { pageIndex: 3, text: 'chirurgeon', alternatives: ['chirurgeen'], reason: 'faint ink' }
        ]
      })
    )
    expect(qs[0]!.help).toContain('chirurgeon')
    expect(qs[0]!.help).toContain('chirurgeen')
    expect(qs[0]!.help).toContain('faint ink')
  })

  it('merges both signals for the same page into one question', () => {
    const qs = stepById('gate-uncertainties').questions(
      transcribed({
        findings: [
          { code: 'text-dropped', severity: 'medium', pageIndex: 6, message: 'Shorter than OCR.' }
        ],
        uncertainties: [{ pageIndex: 6, text: 'x', alternatives: [], reason: 'blur' }]
      })
    )
    expect(qs).toHaveLength(1)
    expect(qs[0]!.help).toContain('Shorter than OCR')
    expect(qs[0]!.help).toContain('blur')
  })

  it('requires an explicit decision about pages that failed outright', () => {
    const qs = stepById('gate-uncertainties').questions(transcribed({ failedPages: [7, 8] }))
    const failed = qs.find((q) => q.id === 'failedPages')!
    expect(failed.required).toBe(true)
    expect(failed.help).toContain('8, 9') // 1-based in the UI
  })

  it('offers accept / fix-it-myself / re-read / omit for each flagged page', () => {
    const qs = stepById('gate-uncertainties').questions(
      transcribed({
        findings: [{ code: 'text-added', severity: 'medium', pageIndex: 0, message: 'Longer.' }]
      })
    )
    const opts = (qs[0] as { options: { value: string }[] }).options.map((o) => o.value)
    expect(opts).toEqual(['accept', 'later', 'redo', 'skip'])
  })

  describe('fixing a leaf without paying to have it read again', () => {
    const flagged = (overrides: Partial<WizardState> = {}) =>
      stepById('gate-uncertainties').questions(
        transcribed({
          findings: [
            { code: 'text-dropped', severity: 'high', pageIndex: 0, message: '30% shorter.' }
          ],
          document: assembleBook([
            {
              pageIndex: 0,
              role: 'body',
              uncertain: [],
              furniture: {},
              blocks: [
                { kind: 'heading', text: 'CHAP. I.' },
                { kind: 'paragraph', text: 'The alembick being set upon a gentle fire.' }
              ]
            }
          ]),
          ...overrides
        })
      )

    it('offers the leaf’s own passages, in order, with what each one is', () => {
      const fix = flagged().find((q) => q.id === 'page-0-fix')!
      expect(fix.type).toBe('page-edit')
      const rows = (fix as { rows: { text: string; kind: string }[] }).rows
      expect(rows.map((r) => r.kind)).toEqual(['heading', 'paragraph'])
      expect(rows[1]!.text).toContain('alembick')
    })

    it('starts empty — an untouched leaf must correct nothing', () => {
      // Seeding the answer with the current text would write an edit over every
      // block on every flagged page and claim the whole book was corrected.
      const fix = flagged().find((q) => q.id === 'page-0-fix')!
      expect(defaultAnswers([fix])['page-0-fix']).toEqual({})
    })

    it('drops the read-only copy, so the text is not shown twice', () => {
      const q = flagged().find((x) => x.id === 'page-0')!
      expect(q.evidence?.filter((e) => e.kind === 'text')).toHaveLength(0)
      expect(q.evidence?.[0]).toMatchObject({ kind: 'image' })
    })

    it('still shows the text read-only when there is no document to edit', () => {
      const q = flagged({ document: null, pageText: { 0: 'The alembick.' } }).find(
        (x) => x.id === 'page-0'
      )!
      expect(q.evidence?.find((e) => e.kind === 'text')).toMatchObject({ text: 'The alembick.' })
      expect(flagged({ document: null }).find((x) => x.id === 'page-0-fix')).toBeUndefined()
    })

    it('puts a joined paragraph on the leaf it began, and says where it runs on', () => {
      // Otherwise the same correction is offered under two leaves and the second
      // shows the first one's text as though it had never been made.
      const qs = flagged({
        findings: [
          { code: 'text-dropped', severity: 'high', pageIndex: 0, message: 'a' },
          { code: 'text-dropped', severity: 'high', pageIndex: 1, message: 'b' }
        ],
        document: assembleBook([
          {
            pageIndex: 0,
            role: 'body',
            uncertain: [],
            furniture: {},
            blocks: [{ kind: 'paragraph', text: 'The alembick being set', continuesNext: true }]
          },
          {
            pageIndex: 1,
            role: 'body',
            uncertain: [],
            furniture: {},
            blocks: [{ kind: 'paragraph', text: 'upon a gentle fire.', continuesPrevious: true }]
          }
        ])
      })
      const rows = (
        qs.find((q) => q.id === 'page-0-fix') as { rows: { alsoFromPages: number[] }[] }
      ).rows
      expect(rows[0]!.alsoFromPages).toEqual([1])
      expect(qs.find((q) => q.id === 'page-1-fix')).toBeUndefined()
    })
  })

  it('separates “it’s fine” from “I can see what’s wrong”', () => {
    // Someone who can read the mistake off the scan is not saying the page is
    // good; they are saying they will fix it. Without this answer they had to
    // claim it was fine, which silenced the note at the proof step.
    const qs = stepById('gate-uncertainties').questions(
      transcribed({
        findings: [{ code: 'text-added', severity: 'medium', pageIndex: 0, message: 'Longer.' }]
      })
    )
    const opts = (qs[0] as { options: { value: string; description?: string }[] }).options
    expect(opts.find((o) => o.value === 'accept')!.description).toContain('stop flagging')
    expect(opts.find((o) => o.value === 'later')!.description).toContain('proof step')
  })
})

describe('gate 3 — reviewing the illustrations', () => {
  const candidate = (id: string, pageIndex: number, ink = 0.4) => ({
    id,
    pageIndex,
    bbox: { x0: 100, y0: 200, x1: 748, y1: 811 },
    previewUrl: `blob:crop/${id}`,
    ink
  })

  const withCandidates = (candidates: ReturnType<typeof candidate>[]): WizardState => ({
    ...reconDone(),
    completed: ['intake', 'recon', 'gate-identity', 'transcribe', 'gate-uncertainties'],
    document: assembleBook([
      {
        pageIndex: 0,
        role: 'body',
        uncertain: [],
        furniture: {},
        blocks: [{ kind: 'paragraph', text: 'The alembick being set upon a gentle fire.' }]
      }
    ]),
    illustrationCandidates: candidates
  })

  const question = (state: WizardState) =>
    stepById('gate-structure')
      .questions(state)
      .find((q) => q.id === 'illustrations')

  it('asks about every candidate in one batch, not one prompt per figure', () => {
    const q = question(withCandidates([candidate('a', 3), candidate('b', 8)]))!
    expect(q.type).toBe('multi-choice')
    expect((q as { options: unknown[] }).options).toHaveLength(2)
  })

  it('shows the pixels of each one — the gate is unanswerable without them', () => {
    const q = question(withCandidates([candidate('a', 3)]))!
    const option = (q as { options: { evidence?: { kind: string; src: string }[] }[] }).options[0]!
    expect(option.evidence?.[0]).toMatchObject({ kind: 'image', src: 'blob:crop/a' })
  })

  it('starts with everything kept, so the recommended answer is an answer', () => {
    const q = question(withCandidates([candidate('a', 3), candidate('b', 8)]))!
    expect((q as { defaultValue: string[] }).defaultValue).toEqual(['a', 'b'])
  })

  it('orders them by page, so the list reads like the book', () => {
    const q = question(withCandidates([candidate('z', 9), candidate('a', 2)]))!
    expect((q as { defaultValue: string[] }).defaultValue).toEqual(['a', 'z'])
  })

  it('says how big each will be and how strong the guess is', () => {
    const q = question(withCandidates([candidate('a', 3, 0.38)]))!
    const option = (q as { options: { label: string; description?: string }[] }).options[0]!
    expect(option.label).toBe('Page 4')
    expect(option.description).toContain('648×611')
    expect(option.description).toContain('38%')
  })

  it('asks nothing when the scan had no pictures in it', () => {
    expect(question(withCandidates([]))).toBeUndefined()
  })
})

describe('gate 3 — structure', () => {
  const withDoc = (blocks: Parameters<typeof assembleBook>[0]): WizardState => ({
    ...reconDone(),
    completed: ['intake', 'recon', 'gate-identity', 'transcribe', 'gate-uncertainties'],
    document: assembleBook(blocks)
  })

  const bodyPage = (pageIndex: number, blocks: TranscribedBlock[], role: PageRole = 'body') => ({
    pageIndex,
    role,
    blocks,
    uncertain: [],
    furniture: {}
  })

  it('asks nothing until the book has been assembled', () => {
    const s = {
      ...reconDone(),
      completed: [
        'intake',
        'recon',
        'gate-identity',
        'transcribe',
        'gate-uncertainties'
      ] as StepId[]
    }
    expect(stepById('gate-structure').questions(s)).toHaveLength(0)
  })

  it('summarizes the shape so an obviously-wrong assembly is visible', () => {
    const qs = stepById('gate-structure').questions(
      withDoc([
        bodyPage(0, [
          { kind: 'heading', text: 'Chapter IV', level: 1 },
          { kind: 'paragraph', text: 'one two three four five' }
        ])
      ])
    )
    const summary = qs.find((q) => q.id === 'structureOk')!
    expect(summary.help).toContain('1 chapter')
    // Headings are part of the book, so they count too: 'Chapter IV' + 5 body words.
    expect(summary.help).toContain('7 words')
  })

  it('lists the chapters that will become the table of contents', () => {
    const qs = stepById('gate-structure').questions(
      withDoc([
        bodyPage(0, [
          { kind: 'heading', text: 'Chapter IV', level: 1 },
          { kind: 'heading', text: 'Of Simples', level: 2 }
        ])
      ])
    )
    const ev = qs.find((q) => q.id === 'structureOk')!.evidence![0]!
    expect(ev.kind).toBe('text')
    expect((ev as { text: string }).text).toContain('Chapter IV')
    expect((ev as { text: string }).text).toContain('Of Simples')
  })

  it('says plainly when no chapters were found', () => {
    const qs = stepById('gate-structure').questions(
      withDoc([bodyPage(0, [{ kind: 'paragraph', text: 'Just prose.' }])])
    )
    const ev = qs.find((q) => q.id === 'structureOk')!.evidence![0]!
    expect((ev as { text: string }).text).toMatch(/none found/i)
  })

  it('asks what to do with footnotes that could not be placed', () => {
    const qs = stepById('gate-structure').questions(
      withDoc([
        bodyPage(0, [
          { kind: 'paragraph', text: 'No marker here.' },
          { kind: 'footnote', text: 'A stranded note.', marker: '9' }
        ])
      ])
    )
    const q = qs.find((x) => x.id === 'orphanNotes')!
    expect(q).toBeDefined()
    expect((q as { defaultValue: string }).defaultValue).toBe('endnotes')
  })

  it('does not raise footnote placement when every note was linked', () => {
    const qs = stepById('gate-structure').questions(
      withDoc([
        bodyPage(0, [
          { kind: 'paragraph', text: 'Referenced here.1' },
          { kind: 'footnote', text: 'A note.', marker: '1' }
        ])
      ])
    )
    expect(qs.find((x) => x.id === 'orphanNotes')).toBeUndefined()
  })

  it('shows which pages were deliberately left out, so nothing vanishes quietly', () => {
    const qs = stepById('gate-structure').questions(
      withDoc([
        bodyPage(0, [{ kind: 'paragraph', text: 'THE ALCHEMIST' }], 'title-page'),
        bodyPage(1, [{ kind: 'paragraph', text: 'Body.' }])
      ])
    )
    const q = qs.find((x) => x.id === 'skippedOk')!
    expect(q).toBeDefined()
    expect(q.help).toContain('title-page')
  })
})

describe('the proof step', () => {
  const afterStructure = (document: WizardState['document']): WizardState => ({
    ...initialState(),
    completed: [
      'intake',
      'recon',
      'gate-identity',
      'transcribe',
      'gate-uncertainties',
      'gate-structure'
    ],
    document
  })

  const doc = () =>
    assembleBook([
      {
        pageIndex: 0,
        role: 'body',
        uncertain: [],
        furniture: {},
        blocks: [{ kind: 'paragraph', text: 'The chirurgeon examined the specimen.' }]
      }
    ])

  it('is where the flow lands once the structure is confirmed', () => {
    expect(activeStep(afterStructure(doc())).id).toBe('proof')
  })

  it('asks nothing — proofreading is a workbench, not a question', () => {
    // Every other stop has a recommendation to offer. A misreading does not:
    // the cross-checks that could flag one have already been over the book at
    // Gate 2, and what is left is what they cannot see.
    expect(stepById('proof').questions(afterStructure(doc()))).toEqual([])
  })

  it('does not open before there is a book to read', () => {
    expect(stepById('proof').canEnter(afterStructure(null))).toBe(false)
    expect(stepById('proof').canEnter(afterStructure(doc()))).toBe(true)
  })

  it('comes before the design gate, so the text is right before it is dressed', () => {
    const ids = STEPS.map((s) => s.id)
    expect(ids.indexOf('proof')).toBeGreaterThan(ids.indexOf('gate-structure'))
    expect(ids.indexOf('proof')).toBeLessThan(ids.indexOf('design'))
  })
})

describe('design step', () => {
  const readyForDesign = (answers: Record<string, Record<string, unknown>> = {}): WizardState => ({
    ...initialState(),
    completed: [
      'intake',
      'recon',
      'gate-identity',
      'transcribe',
      'gate-uncertainties',
      'gate-structure',
      'proof'
    ],
    answers: answers as WizardState['answers']
  })

  it('is where the flow lands once the text has been read through', () => {
    expect(activeStep(readyForDesign()).id).toBe('design')
  })

  it('asks about the book, not about typography settings', () => {
    const ids = stepById('design')
      .questions(readyForDesign())
      .map((q) => q.id)
    // `saveAs` is the one exception, and it is not a typography setting either:
    // it offers to bank the answers so book two need not give them again.
    expect(ids).toEqual(['kind', 'period', 'font', 'chapterOpener', 'runningHeads', 'saveAs'])
  })

  it('every question offers a usable default, so nothing is required of the user', () => {
    const qs = stepById('design').questions(readyForDesign())
    expect(missingRequired(qs, defaultAnswers(qs))).toEqual([])
  })

  it('pre-selects the typeface that matches the chosen period', () => {
    const qs = stepById('design').questions(readyForDesign({ design: { period: 'victorian' } }))
    const font = qs.find((q) => q.id === 'font')!
    expect((font as { defaultValue: string }).defaultValue).toBe('libre-baskerville')
    expect(font.help).toContain('Libre Baskerville')
  })

  it('offers every catalogued typeface, not just the suggestion', () => {
    const qs = stepById('design').questions(readyForDesign())
    const font = qs.find((q) => q.id === 'font') as { options: { value: string }[] }
    expect(font.options.map((o) => o.value)).toEqual(BODY_FONTS.map((f) => f.id))
  })

  it('tells the user which page size their answer implies', () => {
    const qs = stepById('design').questions(readyForDesign({ design: { kind: 'poetry' } }))
    expect(qs.find((q) => q.id === 'kind')!.help).toContain('5.5x8.5')
  })

  it('turns its own default answers into a complete, coherent profile', () => {
    const qs = stepById('design').questions(readyForDesign())
    const a = defaultAnswers(qs)
    const profile = profileFromAnswers(
      {
        kind: a['kind'] as never,
        period: a['period'] as never,
        chapterOpener: a['chapterOpener'] as never,
        runningHeads: a['runningHeads'] as never
      },
      a['font'] as string
    )
    expect(profile.bodyFont).toBe('IM FELL English')
    expect(profile.trimSize).toBe('6x9')
  })

  it('does not open before the structure gate is done', () => {
    const state = { ...initialState(), completed: ['intake', 'recon'] as StepId[] }
    expect(stepById('design').canEnter(state)).toBe(false)
  })
})

describe('export step', () => {
  const readyForExport = (overrides: Partial<WizardState> = {}): WizardState => ({
    ...initialState(),
    pageCount: 240,
    // What the vision pass read off the original front matter. The export gate
    // offers this back for correction rather than asking for it cold.
    metadata: {
      ...initialState().metadata,
      title: 'The Alchemist',
      author: 'Anonymous',
      originalYear: '1662'
    },
    classifications: [{ pageIndex: 0, role: 'title-page', selfReportedConfidence: 0.95 }],
    completed: [
      'intake',
      'recon',
      'gate-identity',
      'transcribe',
      'gate-uncertainties',
      'gate-structure',
      'proof',
      'design'
    ],
    ...overrides
  })

  it('is where the flow lands once the design is chosen', () => {
    expect(activeStep(readyForExport()).id).toBe('export')
  })

  it('asks for the book’s identity and this edition’s details, in that order', () => {
    const ids = stepById('export')
      .questions(readyForExport())
      .map((q) => q.id)
    expect(ids).toEqual([
      'title',
      'author',
      'originalYear',
      'imprint',
      'copyrightHolder',
      'editionDate',
      'editionStatement',
      'isbn',
      'publicDomainNotice'
    ])
  })

  it('pre-fills identity from what the pass read off the title page', () => {
    const qs = stepById('export').questions(readyForExport())
    const byId = (id: string) => qs.find((q) => q.id === id) as { defaultValue: string }
    expect(byId('title').defaultValue).toBe('The Alchemist')
    expect(byId('author').defaultValue).toBe('Anonymous')
    expect(byId('originalYear').defaultValue).toBe('1662')
  })

  it('shows the scan of the title page beside the title it read there', () => {
    const qs = stepById('export').questions(readyForExport())
    const title = qs.find((q) => q.id === 'title')!
    expect(title.evidence?.[0]).toMatchObject({ kind: 'image', src: 'page:0' })
  })

  it('asks for the title with no evidence rather than not at all', () => {
    // A book whose title page was never classified still needs a title; the
    // question just arrives without a picture to check it against.
    const qs = stepById('export').questions(readyForExport({ classifications: [] }))
    const title = qs.find((q) => q.id === 'title')!
    expect(title.evidence).toBeUndefined()
  })

  it('requires only the two facts a book cannot be published without', () => {
    const qs = stepById('export').questions(readyForExport())
    // Prefilled, so answering is a glance — but a book with no title is not
    // publishable, and an empty reading has to be caught here.
    expect(missingRequired(qs, defaultAnswers(qs))).toEqual([])
    expect(missingRequired(qs, { ...defaultAnswers(qs), title: '', author: '' })).toEqual([
      'title',
      'author'
    ])
  })

  it('defaults the edition statement from the original year it already knows', () => {
    const q = stepById('export')
      .questions(readyForExport())
      .find((x) => x.id === 'editionStatement')!
    expect((q as { defaultValue: string }).defaultValue).toContain('1662')
  })

  it('follows a year the user corrects on this very screen', () => {
    const state = readyForExport({ answers: { export: { originalYear: '1651' } } })
    const q = stepById('export')
      .questions(state)
      .find((x) => x.id === 'editionStatement')!
    expect((q as { defaultValue: string }).defaultValue).toContain('1651')
  })

  it('leaves the edition statement blank when the original year is unknown', () => {
    const state = readyForExport({
      metadata: { ...initialState().metadata, title: 'Untitled' }
    })
    const q = stepById('export')
      .questions(state)
      .find((x) => x.id === 'editionStatement')!
    expect((q as { defaultValue: string }).defaultValue).toBe('')
  })

  it('offers the public-domain statement, on by default', () => {
    const q = stepById('export')
      .questions(readyForExport())
      .find((x) => x.id === 'publicDomainNotice')!
    expect((q as { defaultValue: boolean }).defaultValue).toBe(true)
  })

  it('turns its own defaults into a buildable edition', () => {
    const qs = stepById('export').questions(readyForExport())
    const edition = editionFromAnswers(defaultAnswers(qs))
    expect(edition.title).toBe('The Alchemist')
    expect(edition.author).toBe('Anonymous')
    expect(edition.notices[0]).toContain('1662')
    expect(edition.editionDate).toBe(String(new Date().getFullYear()))
  })

  it('does not open before the design is chosen', () => {
    const state = { ...initialState(), completed: ['intake', 'recon'] as StepId[] }
    expect(stepById('export').canEnter(state)).toBe(false)
  })
})

describe('gate 1 — never ask about a word without showing it', () => {
  const lex = (n: number): LexiconEntry[] =>
    Array.from({ length: n }, (_, i) => entry(`term${i}word`, 100 - i))

  const stateWith = (n: number, cropFor?: (id: string) => string | undefined): WizardState => ({
    ...initialState(),
    pagesProcessed: 3,
    lexicon: lex(n),
    ...(cropFor ? { cropFor } : {}),
    completed: ['intake', 'recon'] as StepId[]
  })

  const grid = (state: WizardState) =>
    stepById('gate-identity')
      .questions(state)
      .find((q) => q.id === 'terms') as
      { rows: { cropSrc?: string }[]; prompt: string; help?: string } | undefined

  it('lists only the terms whose crop was actually rendered', () => {
    // Crops are capped, so a big book has terms with no evidence. Those rows
    // used to render as "no crop" — a question with nothing to answer it by.
    const cropped = new Set(['term0word-0', 'term1word-0', 'term2word-0'])
    const g = grid(stateWith(10, (id) => (cropped.has(id) ? `blob:${id}` : undefined)))!
    expect(g.rows).toHaveLength(3)
    expect(g.rows.every((r) => r.cropSrc)).toBe(true)
  })

  it('says the list is a subset instead of implying the book had only those', () => {
    const g = grid(stateWith(10, (id) => (id === 'term0word-0' ? 'blob:x' : undefined)))!
    expect(g.prompt).toContain('of 10')
    // "scored lower", not "appear less often": the grid ranks by how odd a word
    // is, not by how often it turns up.
    expect(g.help).toContain('The other 9 scored lower')
  })

  it('does not claim a subset when every term has its pixels', () => {
    const g = grid(stateWith(3, (id) => `blob:${id}`))!
    expect(g.prompt).toBe('Check the 3 unusual words I found')
    expect(g.help).not.toContain('appear less often')
  })

  it('drops the grid entirely rather than showing evidence-free rows', () => {
    expect(grid(stateWith(5, () => undefined))).toBeUndefined()
  })

  it('still lists everything when no crop resolver exists at all (headless)', () => {
    expect(grid(stateWith(4))!.rows).toHaveLength(4)
  })
})

describe('the transcribe gate — a run that stopped partway', () => {
  /**
   * Before checkpointing there was no such thing: a run was written only once
   * it had finished, so a tab that died mid-book left nothing. Now a partial
   * run is the ordinary intermediate state, and telling it from a finished one
   * is the difference between paying for the pages that are left and paying
   * for the whole book twice.
   */
  const base = (): WizardState => ({
    ...reconDone(),
    pageCount: 312,
    hasApiKey: true,
    completed: ['intake', 'recon', 'gate-identity']
  })

  const partial = {
    key: 'k',
    fileName: 'alchemist.pdf',
    savedAt: new Date().toISOString(),
    pageCount: 200,
    failedPages: 0,
    complete: false,
    modelId: 'claude-opus-5',
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 }
  }

  const ask = (state: WizardState) => stepById('transcribe').questions(state)

  it('offers to carry on rather than to reuse', () => {
    const q = ask({ ...base(), savedRun: partial }).find((x) => x.id === 'useSavedRun')!
    expect((q as { defaultValue: string }).defaultValue).toBe('resume')
    expect(q.prompt).toContain('stopped partway')
  })

  it('says how much is already bought and how much is left', () => {
    const q = ask({ ...base(), savedRun: partial }).find((x) => x.id === 'useSavedRun')!
    expect(q.help).toContain('200 of 312')
    const options = (q as { options: { label: string; description: string }[] }).options
    expect(options[0]!.label).toContain('page 201')
    expect(options[0]!.description).toContain('112')
  })

  it('still asks the spending questions, because carrying on costs money', () => {
    // The finished-run path returns early here; the partial one must not, or
    // the user resumes without ever approving a charge.
    const ids = ask({ ...base(), savedRun: partial }).map((q) => q.id)
    expect(ids).toEqual(['useSavedRun', 'model', 'bookContext', 'keepScans'])
  })

  it('leaves a finished run alone', () => {
    const done = { ...partial, complete: true, pageCount: 312 }
    const q = ask({ ...base(), savedRun: done }).find((x) => x.id === 'useSavedRun')!
    expect((q as { defaultValue: string }).defaultValue).toBe('use')
    expect(q.prompt).toContain('already had this book read')
  })
})

describe('the storage question — asked once, against measured numbers', () => {
  /**
   * The user's own framing: "if I'm doing it from the desktop, I can click yes
   * and not worry about memory. But if I'm doing it from the phone, then I
   * would click no because I would wanna conserve memory."
   *
   * So the app asks rather than deciding — and shows what it is asking about,
   * because the two devices differ by an order of magnitude and nobody can
   * guess either figure.
   */
  const MB = 1024 * 1024
  const at = (over: Partial<WizardState> = {}): WizardState => ({
    ...reconDone(),
    pageCount: 300,
    hasApiKey: true,
    completed: ['intake', 'recon', 'gate-identity'],
    ...over
  })
  const ask = (state: WizardState) => stepById('transcribe').questions(state)
  const find = (state: WizardState) => ask(state).find((q) => q.id === 'keepScans')

  it('recommends keeping when the scan is a small share of the free space', () => {
    const q = find(at({ storage: { scanBytes: 40 * MB, quota: 2000 * MB, usage: 100 * MB } }))!
    expect((q as { defaultValue: string }).defaultValue).toBe('keep')
    expect(q.help).toContain('40 MB')
  })

  it('recommends against it when the scan would take a real bite', () => {
    // The phone case: 180 MB of scan against 400 MB free.
    const q = find(at({ storage: { scanBytes: 180 * MB, quota: 500 * MB, usage: 100 * MB } }))!
    expect((q as { defaultValue: string }).defaultValue).toBe('discard')
  })

  it('asks without figures rather than with invented ones', () => {
    // Some browsers decline to report a quota. Guessing one would be worse
    // than asking plainly.
    const q = find(at({ storage: { scanBytes: 40 * MB, quota: null, usage: null } }))!
    expect(q.help).not.toMatch(/free for the app/)
    expect((q as { defaultValue: string }).defaultValue).toBe('keep')
  })

  it('promises the transcription is kept either way', () => {
    // The carve-out this whole design rests on: the paid work is never what is
    // being traded away, and the question has to say so where it is asked.
    const q = find(at({ storage: { scanBytes: 40 * MB, quota: 2000 * MB, usage: 0 } }))!
    expect(q.help).toContain('transcription is saved either way')
  })

  it('is asked once, not per book', () => {
    expect(find(at({ keepScans: true }))).toBeUndefined()
    expect(find(at({ keepScans: false }))).toBeUndefined()
    expect(find(at({ keepScans: null }))).toBeDefined()
  })

  it('does not interrupt someone reusing a finished run', () => {
    // That path returns before the spending questions, and space is not being
    // spent either — the scan is already on the device or it is not.
    const savedRun = {
      key: 'k',
      fileName: 'alchemist.pdf',
      savedAt: new Date().toISOString(),
      pageCount: 300,
      failedPages: 0,
      complete: true,
      modelId: 'claude-opus-5',
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 }
    }
    const ids = ask(at({ savedRun, answers: { transcribe: { useSavedRun: 'use' } } })).map(
      (q) => q.id
    )
    expect(ids).toEqual(['useSavedRun'])
  })
})

/**
 * The gate asks whether a transcription is good enough to keep, and showed only
 * a thumbnail of the scan. A thumbnail of a page of dense type answers nothing:
 * the question is whether the *text* is right, which means both have to be on
 * the same screen or the user is being asked to trust a number.
 */
describe('the uncertainty gate shows the scan and what was read off it', () => {
  const readied = (): WizardState => ({
    ...initialState(),
    completed: ['intake', 'recon', 'gate-identity', 'transcribe'],
    findings: [
      {
        code: 'text-dropped',
        severity: 'medium',
        pageIndex: 345,
        message: '19 words OCR read clearly are absent from the transcription.'
      }
    ],
    pageText: { 345: 'INDEX\n\nPeibles, Dr., 219\nWill, what is it, 154, 55' }
  })

  const pageQuestion = (state: WizardState) =>
    stepById('gate-uncertainties')
      .questions(state)
      .find((q) => q.id === 'page-345')

  it('puts the text beside the scan', () => {
    const q = pageQuestion(readied())
    const kinds = q?.evidence?.map((e) => e.kind)
    expect(kinds).toContain('image')
    expect(kinds).toContain('text')
  })

  it('shows what was actually read, not a summary of it', () => {
    const q = pageQuestion(readied())
    const text = q?.evidence?.find((e) => e.kind === 'text')
    expect(text && 'text' in text ? text.text : '').toContain('Peibles, Dr., 219')
  })

  it('shows the scan alone when there is no text for that page', () => {
    // A page that failed every attempt has a finding and no transcription. An
    // empty text panel beside it would read as "the model returned nothing"
    // rather than "nothing was returned".
    const q = pageQuestion({ ...readied(), pageText: {} })
    expect(q?.evidence?.map((e) => e.kind)).toEqual(['image'])
  })
})
