/**
 * Cover art: the brief, and the pixels it has to come back with.
 *
 * The resolution arithmetic is the reason this file exists. Everything else
 * here is a string; `requiredPixels` and `checkResolution` are what stop a
 * cover that looks immaculate on a laptop from printing soft.
 */
import { describe, expect, it } from 'vitest'
import {
  buildArtPrompt,
  checkResolution,
  HOUSE_CONSTRAINTS,
  requiredPixels,
  SUGGESTED_ART_MODELS,
  type ArtBriefInput
} from '@core/cover'

const base: ArtBriefInput = {
  brief: 'ground',
  subject: 'laid paper with a faint chain line',
  period: '1877',
  title: 'A Treatise on Bee Keeping',
  palette: { ground: '#f4efe4', ink: '#22201c', accent: '#7a2e2e' },
  direction: ''
}

describe('buildArtPrompt', () => {
  it('always forbids lettering, because the composer sets the type', () => {
    const { prompt, negative } = buildArtPrompt(base)
    expect(prompt).toContain(HOUSE_CONSTRAINTS[0])
    expect(negative).toContain('lettering')
  })

  it('never asks for the book’s title to be drawn', () => {
    // The title is passed for context and must not reach the model as a thing
    // to render — a garbled title under a real one is the classic tell.
    expect(buildArtPrompt(base).prompt).not.toContain('A Treatise on Bee Keeping')
  })

  it('carries the book’s own period and palette', () => {
    const { prompt } = buildArtPrompt(base)
    expect(prompt).toContain('1877')
    expect(prompt).toContain('#f4efe4')
  })

  it('builds the same brief for two books in a collection', () => {
    // What makes a set look like a set: the brief is assembled, not remembered.
    const a = buildArtPrompt({ ...base, subject: 'oak gall ink on rag' })
    const b = buildArtPrompt({ ...base, subject: 'iron gall ink on rag' })
    const strip = (s: string) => s.replace(/oak gall ink on rag|iron gall ink on rag/, 'SUBJECT')
    expect(strip(a.prompt)).toBe(strip(b.prompt))
  })

  it('appends the user’s own direction last, verbatim', () => {
    const { prompt } = buildArtPrompt({ ...base, direction: 'keep the top third empty' })
    expect(prompt.endsWith('keep the top third empty')).toBe(true)
  })

  it('says what each brief is likely to cost you', () => {
    expect(buildArtPrompt({ ...base, brief: 'scene' }).note).toMatch(/recognised as generated/)
    expect(buildArtPrompt({ ...base, brief: 'ground' }).note).toMatch(/safest/)
  })
})

describe('requiredPixels', () => {
  it('is the placed size times the DPI, rounded up', () => {
    expect(requiredPixels({ width: 6, height: 9 })).toEqual({
      width: 1800,
      height: 2700,
      megapixels: 4.86
    })
  })

  it('rounds up rather than down', () => {
    // 1799 pixels where 1800 are needed is an afternoon spent finding out why
    // a check fails by a hair.
    expect(requiredPixels({ width: 5.999, height: 1 }).width).toBe(1800)
  })
})

describe('checkResolution', () => {
  const front = { width: 6, height: 9 }

  it('turns megapixels into the number that matters: DPI at print size', () => {
    const verdict = checkResolution(front, { label: 'A 1 MP model', maxMegapixels: 1 })
    expect(verdict.kind).toBe('short')
    if (verdict.kind !== 'short') throw new Error('unreachable')
    expect(verdict.message).toMatch(/DPI/)
    expect(verdict.message).toMatch(/print soft/)
    // ~136 DPI across a 6×9 — the honest number, not "1 megapixel".
    expect(verdict.message).toMatch(/13[0-9] DPI/)
  })

  it('passes a model with the pixels for the job', () => {
    expect(checkResolution(front, { label: 'Big', maxMegapixels: 8 }).kind).toBe('ok')
  })

  it('says out loud that upscaling invents detail', () => {
    const verdict = checkResolution(front, { label: 'Small', maxMegapixels: 1 })
    if (verdict.kind !== 'short') throw new Error('unreachable')
    expect(verdict.message).toMatch(/invented rather than drawn/)
  })

  it('has at least one suggested model that can actually print a 6×9 front', () => {
    const usable = SUGGESTED_ART_MODELS.filter((m) => checkResolution(front, m).kind === 'ok')
    expect(usable.length).toBeGreaterThan(0)
  })

  it('marks the cheap models as what they are — trial, not print', () => {
    const schnell = SUGGESTED_ART_MODELS.find((m) => m.slug.endsWith('flux-schnell'))!
    expect(checkResolution(front, schnell).kind).toBe('short')
    expect(schnell.note).toMatch(/[Nn]ot a print source/)
  })
})
