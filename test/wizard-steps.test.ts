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
  type WizardState
} from '@core/wizard'
import { dispositionFor, partitionByDisposition, strippedFurniture } from '@core/pages'
import type { LexiconEntry } from '@core/lexicon'

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
  it('pre-fills identity from what was read off the title page', () => {
    const qs = stepById('gate-identity').questions(reconDone())
    const title = qs.find((q) => q.id === 'title')
    expect(title?.type).toBe('text')
    expect((title as { defaultValue: string }).defaultValue).toBe('The Alchemist His Practise')
    expect(qs.find((q) => q.id === 'author')).toBeDefined()
    expect(qs.find((q) => q.id === 'originalYear')).toBeDefined()
  })

  it('attaches the title-page image as evidence', () => {
    const qs = stepById('gate-identity').questions(reconDone())
    const title = qs.find((q) => q.id === 'title')!
    expect(title.evidence?.[0]).toMatchObject({ kind: 'image', src: 'page:0' })
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
    expect(a['title']).toBe('The Alchemist His Practise')
    // Every term defaults to accepted; the user overrides the wrong ones.
    expect(a['terms']).toMatchObject({ chirurgeon: { action: 'accept' } })
  })

  it('reports required questions left blank', () => {
    const qs = stepById('gate-identity').questions(
      reconDone({ metadata: { ...reconDone().metadata, title: null, author: null } })
    )
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

  it('invites book context, which measurably helps unusual vocabulary', () => {
    const q = stepById('transcribe')
      .questions(ready())
      .find((x) => x.id === 'bookContext')
    expect(q).toBeDefined()
    expect(q!.required).toBeFalsy()
  })

  it('is not enterable until the identity gate is done', () => {
    expect(stepById('transcribe').canEnter(reconDone())).toBe(false)
    expect(stepById('transcribe').canEnter(ready())).toBe(true)
  })
})
