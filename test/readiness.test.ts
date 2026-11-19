import { describe, expect, it } from 'vitest'
import {
  READINESS_CHECKS,
  applySignOffs,
  combineResults,
  coverCountsDisagree,
  countMarkup,
  decideReadiness,
  emphasisSurvival,
  parseSignOffs,
  readinessReport,
  undescribedPictures,
  workingNotes,
  type CheckResult,
  type ReadinessMeta
} from '@core/coherence'

// Synthetic fingerprints and text only: no book is quoted here.
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const TODAY = '2026-11-19'

const passedAll = (): CheckResult[] =>
  READINESS_CHECKS.map((k) => ({ id: k.id, outcome: 'PASSED' as const, summary: 'ran clean' }))

const withOne = (id: string, res: Partial<CheckResult>): CheckResult[] =>
  passedAll().map((r) => (r.id === id ? { ...r, ...res, id } : r))

const meta: ReadinessMeta = {
  book: 'Some-Book',
  writtenAt: '2026-11-19T10:00:00Z',
  today: TODAY,
  command: 'node scripts/readiness.mjs books/Some-Book',
  bookFingerprint: A,
  files: [{ role: 'interior', source: 'exports/x.pdf', sha256: B, bytes: 10, pages: 4 }],
  driver: 'not running',
  signOffNotes: []
}

describe('the readiness list', () => {
  it('holds C1 to C12 for checked and R1 to R11 for ready to upload, each once', () => {
    const ids = READINESS_CHECKS.map((k) => k.id)
    expect(ids).toEqual([
      ...Array.from({ length: 12 }, (_, i) => `C${i + 1}`),
      ...Array.from({ length: 11 }, (_, i) => `R${i + 1}`)
    ])
    expect(READINESS_CHECKS.filter((k) => k.stage === 'checked').map((k) => k.id)).toHaveLength(12)
  })
})

describe('the verdict', () => {
  it('is ready to upload only when every check passed', () => {
    const d = decideReadiness(passedAll(), 'ready')
    expect(d.verdict).toBe('ready to upload')
    expect(d.reachedAsked).toBe(true)
  })

  it('is not ready to upload when one ready check was NOT CHECKED', () => {
    const d = decideReadiness(
      withOne('R7', { outcome: 'NOT CHECKED', summary: 'no cover' }),
      'ready'
    )
    expect(d.verdict).toBe('checked')
    expect(d.reachedAsked).toBe(false)
    expect(d.blocking.map((b) => b.id)).toEqual(['R7'])
  })

  it('is not ready, and not checked, when one checked-stage item was NOT CHECKED', () => {
    const d = decideReadiness(
      withOne('C1', { outcome: 'NOT CHECKED', summary: 'no driver' }),
      'checked'
    )
    expect(d.verdict).toBe('not ready')
    expect(d.reachedAsked).toBe(false)
  })

  it('blocks on a failure and on a person check nobody signed off', () => {
    expect(decideReadiness(withOne('C11', { outcome: 'FAILED' }), 'ready').verdict).toBe(
      'not ready'
    )
    const waiting = withOne('R1', { outcome: 'NEEDS A PERSON', subjects: [B] })
    expect(decideReadiness(waiting, 'ready').verdict).toBe('checked')
  })

  it('counts a check with no result as NOT CHECKED rather than leaving it out', () => {
    const d = decideReadiness(
      passedAll().filter((r) => r.id !== 'R11'),
      'ready'
    )
    expect(d.results.find((r) => r.id === 'R11')?.outcome).toBe('NOT CHECKED')
    expect(d.verdict).toBe('checked')
  })

  it('refuses a result for a check the list does not have', () => {
    expect(() =>
      decideReadiness([...passedAll(), { id: 'R99', outcome: 'PASSED', summary: '' }], 'ready')
    ).toThrow(/R99/)
  })

  it('lets the worst part of a check stand when it has several', () => {
    const one = combineResults('C8', [
      { id: 'C8', outcome: 'PASSED', summary: 'sheets in step' },
      { id: 'C8', outcome: 'NOT CHECKED', summary: 'no driver' }
    ])
    expect(one.outcome).toBe('NOT CHECKED')
    expect(one.summary).toContain('sheets in step')
  })
})

describe('the report', () => {
  it('names every check in the list, even ones given no result', () => {
    const d = decideReadiness([{ id: 'C2', outcome: 'PASSED', summary: 'clean' }], 'ready')
    const md = readinessReport(d, meta)
    for (const k of READINESS_CHECKS) expect(md).toContain(`| ${k.id} | `)
    expect(md).toContain('**Verdict: not ready.**')
    expect(md).toContain(B)
  })

  it('gives a NEEDS A PERSON item the ledger line that would sign it off', () => {
    const d = decideReadiness(withOne('R6', { outcome: 'NEEDS A PERSON', subjects: [B] }), 'ready')
    expect(readinessReport(d, meta)).toContain(`Signed off: R6 ${B} ${TODAY} <`)
  })
})

describe('sign-offs in the ledger', () => {
  const ledger = [
    '# Ledger',
    `- Signed off: R1 ${B} 2026-11-18 the owner read the spelling sheet`,
    `Signed off: R10 ${A}, ${B} 2026-11-18 listing compared with both covers`,
    'Signed off: R6 abc 2026-11-18 too short a fingerprint',
    `Signed off: R8 ${B} 2026-11-18 <who did it, and what was decided>`,
    `Signed off: R6 ${B} 2027-01-01 dated ahead`
  ].join('\n')

  it('reads the documented form and reports a line that does not read', () => {
    const { signOffs, problems } = parseSignOffs(ledger)
    expect(signOffs.map((s) => s.id)).toEqual(['R1', 'R10', 'R6'])
    expect(signOffs[1]!.fingerprints).toEqual([A, B])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/line 4/)
    expect(problems[1]).toMatch(/line 5.*who did the reading/)
  })

  it('signs off a person check for the exact file, and nothing else', () => {
    const { signOffs } = parseSignOffs(ledger)
    const results: CheckResult[] = [
      { id: 'R1', outcome: 'NEEDS A PERSON', summary: 'sheet', subjects: [B] },
      { id: 'R10', outcome: 'NEEDS A PERSON', summary: 'listing', subjects: [A, B] },
      { id: 'R6', outcome: 'NEEDS A PERSON', summary: 'copy', subjects: [B] }
    ]
    const { results: out, notes } = applySignOffs(results, signOffs, TODAY)
    expect(out[0]!.signedOff?.line).toBe(2)
    expect(out[1]!.signedOff?.line).toBe(3)
    expect(out[2]!.signedOff).toBeUndefined()
    expect(notes.join('\n')).toMatch(/after today/)
  })

  it('does not sign off a sign-off for another file', () => {
    const { signOffs } = parseSignOffs(`Signed off: R1 ${A} 2026-11-18 read an older export`)
    const { results, notes } = applySignOffs(
      [{ id: 'R1', outcome: 'NEEDS A PERSON', summary: '', subjects: [B] }],
      signOffs,
      TODAY
    )
    expect(results[0]!.signedOff).toBeUndefined()
    expect(notes[0]).toMatch(/not the file checked here/)
  })

  /**
   * C6 comes in two parts: the half inside C1 (PASSED) and the witness half
   * (NEEDS A PERSON when the scan has none). Signed part by part, the sign-off
   * met the PASSED half and was refused, and combining the parts afterwards
   * dropped the half it did sign, so no book without a witness could be
   * called checked.
   */
  it('signs off a check given in parts as one check', () => {
    const { signOffs } = parseSignOffs(
      `Signed off: C6 ${A} 2026-11-18 the owner: this scan sets no italic to witness`
    )
    const given: CheckResult[] = [
      ...passedAll().filter((r) => r.id !== 'C6'),
      { id: 'C6', outcome: 'PASSED', summary: 'no italics-absent among C1 findings' },
      { id: 'C6', outcome: 'NEEDS A PERSON', summary: 'no italic witness', subjects: [A] }
    ]
    const { results, notes } = applySignOffs(given, signOffs, TODAY)
    expect(notes).toEqual([])
    const d = decideReadiness(results, 'checked')
    expect(d.results.find((r) => r.id === 'C6')?.signedOff?.line).toBe(1)
    expect(d.verdict).toBe('ready to upload')
  })

  it('still refuses a sign-off on a check one of whose parts failed', () => {
    const { signOffs } = parseSignOffs(`Signed off: C11 ${A} 2026-11-18 read the brackets`)
    const { results, notes } = applySignOffs(
      [
        { id: 'C11', outcome: 'FAILED', summary: '1 working note left' },
        { id: 'C11', outcome: 'NEEDS A PERSON', summary: '2 to read', subjects: [A] }
      ],
      signOffs,
      TODAY
    )
    expect(results).toHaveLength(1)
    expect(results[0]!.signedOff).toBeUndefined()
    expect(notes[0]).toMatch(/C11 is FAILED/)
  })

  it('never signs away a failure or a check that did not run', () => {
    const { signOffs } = parseSignOffs(
      `Signed off: C11 ${A} 2026-11-18 looked fine\nSigned off: C1 ${A} 2026-11-18 trust me`
    )
    const { results } = applySignOffs(
      [
        { id: 'C11', outcome: 'FAILED', summary: '', subjects: [A] },
        { id: 'C1', outcome: 'NOT CHECKED', summary: '', subjects: [A] }
      ],
      signOffs,
      TODAY
    )
    const d = decideReadiness(
      [...withOne('C11', results[0]!).filter((r) => r.id !== 'C1'), results[1]!],
      'checked'
    )
    expect(d.verdict).toBe('not ready')
    expect(d.blocking.map((b) => b.id)).toEqual(['C1', 'C11'])
  })
})

describe('the checks the command does itself', () => {
  it('fails a working note and lists other bracketed words for a person', () => {
    const found = workingNotes([
      {
        where: 'section Introduction',
        text: 'A line.\nThe word (delete) stays (aura) here, (a) and (iv) (sic).'
      }
    ])
    expect(found.notes.map((h) => [h.word, h.line])).toEqual([['delete', 2]])
    expect(found.toRead.map((h) => h.word)).toEqual(['aura'])
    expect(found.ordinary).toBe(3)
  })

  it('counts our own tags printed in the PDF text', () => {
    expect(countMarkup('plain <i>text</i> and <sc>caps</sc> <bold>')).toBe(4)
    expect(countMarkup('no tags at all, a < b > c')).toBe(0)
  })

  it('lists a block that lost italic, not one merged away', () => {
    const s = emphasisSurvival({
      pristine: [
        { id: 'p1b1', text: 'one <i>two</i> <i>three</i>' },
        { id: 'p1b2', text: '<b>four</b>' },
        { id: 'p1b3', text: 'merged <i>away</i>' }
      ],
      edited: [
        { id: 'p1b1', text: 'one two <i>three</i>' },
        { id: 'p1b2', text: '<b>four</b> <i>added</i>' }
      ]
    })
    expect(s.losses).toEqual([{ id: 'p1b1', tag: 'i', was: 2, now: 1 }])
    expect(s.compared).toBe(2)
    expect(s.uncompared).toBe(1)
  })

  it('compares each cover spec with the interior page count', () => {
    expect(coverCountsDisagree(142, [{ cover: 'softcover', pageCount: 142 }])).toEqual([])
    expect(
      coverCountsDisagree(144, [
        { cover: 'softcover', pageCount: 142 },
        { cover: 'hardcover', pageCount: null }
      ])
    ).toHaveLength(2)
  })

  it('names EPUB pictures with no description', () => {
    const r = undescribedPictures([
      {
        name: 'OEBPS/c1.xhtml',
        text: '<img src="a.png" alt="A drawn plate of a gate"/><img src="b.png" alt=""/><img src="c.png" alt="Figure"/><img src="d.png"/>'
      }
    ])
    expect(r.pictures).toBe(4)
    expect(r.undescribed.map((u) => u.src)).toEqual(['b.png', 'c.png', 'd.png'])
  })
})
