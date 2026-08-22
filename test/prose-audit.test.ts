import { describe, expect, it } from 'vitest'
import { HEDGE_RATIO_LIMIT, auditProse } from '@core/annotate'

/**
 * The check that exists because the writer cannot be asked.
 *
 * SPEC §4's rule, applied to the editor's own prose: escalation is decided by
 * a deterministic cross-check, never by the writer's opinion of their own
 * even-handedness. These tests are written against the bias that was actually
 * shipped to a book on this shelf and then found by reading it back, which is
 * the only reason to trust that the measure is aimed at a real thing.
 */
describe('auditing the editor’s prose for a thumb on the scale', () => {
  /** The glossary as it really was, before the audit existed. */
  const LEANING = `
    Akashic Records. The supposed imperishable record of everything that has happened. A trained seer is said to read it directly.

    Astral plane. The world of subtle matter said to interpenetrate the physical. Its divisions are held to be seven.

    Aura. The field of subtle emanation said to surround a living body. Its colours are believed to change with the thought passing through it.

    Thought-form. A shape purported to be taken in astral matter by a definite thought. It is claimed to persist as long as the force behind it.

    Prana. The vital energy said to move in the body and to be drawn in with the breath. It is alleged to pass from one person to another.

    Etheric double. The counterpart of the physical body, so-called, and held to be the vehicle of prana.

    Pineal gland. A small gland near the centre of the brain, which secretes melatonin. Physiology has measured it in detail.

    Medulla oblongata. The lowest part of the brainstem, which governs breathing and the beat of the heart.

    Mesmerism. A French commission tested it by experiment in 1784 and reported the cures real. Clinical research on suggestion followed.

    Roentgen. He discovered a radiation the eye cannot observe. The apparatus was in every laboratory within a year.

    Coherer. A tube of metal filings whose electrical resistance falls in the presence of radiation. Branly devised it in 1890.

    Galton. He measured how far people differ in forming a mental image, and published the statistics in 1883.
  `
  /** The same subjects, reported evenly. */
  const EVEN = `
    Akashic Records. The imperishable record of everything that has happened, held in akasha. A trained seer reads it directly.

    Astral plane. The world of subtle matter that interpenetrates the physical. It has seven divisions.

    Aura. The field of subtle emanation surrounding a living body. Its colours change with the thought passing through it.

    Thought-form. A definite thought taking shape in astral matter. It persists as long as the force behind it.

    Prana. The vital energy moving in the body, drawn in with the breath. It passes from one person to another.

    Etheric double. The counterpart of the physical body, and the vehicle of prana.

    Pineal gland. A small gland near the centre of the brain, which secretes melatonin. Physiology has measured it in detail.

    Medulla oblongata. The lowest part of the brainstem, which governs breathing and the beat of the heart.

    Mesmerism. A French commission tested it by experiment in 1784 and reported the cures real. Clinical research on suggestion followed.

    Roentgen. He discovered a radiation the eye cannot observe. The apparatus was in every laboratory within a year.

    Coherer. A tube of metal filings whose electrical resistance falls in the presence of radiation. Branly devised it in 1890.

    Galton. He measured how far people differ in forming a mental image, and published the statistics in 1883.
  `

  it('measures the asymmetry that no single sentence shows', () => {
    const leaning = auditProse(LEANING)
    expect(leaning.ratio).not.toBeNull()
    expect(leaning.ratio!).toBeGreaterThan(HEDGE_RATIO_LIMIT)
    expect(leaning.clean).toBe(false)
  })

  it('passes the same subjects reported evenly', () => {
    const even = auditProse(EVEN)
    expect(even.hedges.tradition).toBe(0)
    expect(even.clean).toBe(true)
  })

  it('measures the definition and not the headword', () => {
    // The first thing this check got wrong on real prose. A splitter makes
    // "Akashic Records." a sentence of its own, so "the opening sentence" was
    // the term, the hedge in the definition under it went uncounted, and a
    // glossary full of them reported no hedged openings at all.
    const audit = auditProse('Akashic Records. The supposed imperishable record of everything.')
    expect(audit.openings.tradition).toBe(1)
    expect(audit.openingHedges.tradition).toBe(1)
  })

  it('finds the lean in the definitions when the whole document washes it out', () => {
    // Why the opening ratio exists. Spread over a long document the effect
    // disappears — the real glossary this is modelled on hedged its doctrinal
    // definitions and still scored 0.72 overall, because hundreds of sentences
    // about people and dates diluted it away.
    const filler = Array.from(
      { length: 12 },
      (_, i) =>
        `Someone ${i}. A person named in passing, who died in 1881 and needs no hedge at all.`
    ).join('\n\n')
    const leaning = auditProse(`${LEANING}\n\n${filler}`)
    expect(leaning.openingRatio).not.toBeNull()
    expect(leaning.openingRatio!).toBeGreaterThan(HEDGE_RATIO_LIMIT)
    expect(leaning.clean).toBe(false)
  })

  it('does not build a rate out of one hedge', () => {
    // A clean glossary with a single legitimate hedge in it, and none on the
    // science side, divided one by zero and reported an infinite lean. Flagging
    // good prose is how a check gets switched off.
    const audit = auditProse(
      `${EVEN}\n\nSecond sight. It was held to be commonest in the Highlands.`
    )
    expect(audit.openingRatio).toBeNull()
    expect(audit.clean).toBe(true)
    // Still listed, because it is still a decision for a person.
    expect(audit.hedgedTeaching).toHaveLength(1)
  })

  it('lists a hedge on the tradition without calling it a fault', () => {
    // The correction that reshaped this module: symmetry with the science is
    // not the goal. Every hedge on a teaching is a decision — stated plainly if
    // it is established doctrine, reported as a claim if it is contested — and
    // no lexicon can tell those apart.
    const audit = auditProse(
      'Astral cord. The thread said to join the astral body to the physical.'
    )
    expect(audit.hedgedTeaching).toHaveLength(1)
    expect(audit.hedgedTeaching[0]!.match).toBe('said to')
  })

  it('says nothing about a text too short to have a rate', () => {
    // A quorum, for the reason verify-book has them: a ratio from two
    // sentences is noise, and a check that cries wolf gets switched off.
    const audit = auditProse('The supposed astral body. A gland which secretes melatonin.')
    expect(audit.ratio).toBeNull()
    expect(audit.clean).toBe(true)
  })

  it('does not count a hedge as a fault on its own', () => {
    // "Held to be" is the correct way to report a doctrine. The count carries
    // the argument; the individual match is only there to be read in context.
    const audit = auditProse('The astral body is held to be the vehicle of desire.')
    expect(audit.findings.some((f) => f.kind === 'hedge')).toBe(true)
    expect(audit.clean).toBe(true)
  })

  it('catches a verdict however it is dressed', () => {
    for (const line of [
      'The science is worthless and the book was influential.',
      'The commission found the fluid imaginary.',
      'Brain sand has no known function of the kind claimed.',
      'It is nothing more than the mesmerists’ fluid renamed.'
    ]) {
      const audit = auditProse(line)
      expect(audit.findings.some((f) => f.kind === 'dismissal')).toBe(true)
      expect(audit.clean).toBe(false)
    }
  })

  it('catches a dash doing the work of a comma', () => {
    const audit = auditProse(
      'The astral body \u2014 the vehicle of desire \u2014 is not the etheric double.'
    )
    expect(audit.findings.filter((f) => f.kind === 'dash')).toHaveLength(2)
    expect(audit.clean).toBe(false)
  })

  it('leaves a hyphen inside a compound alone', () => {
    const audit = auditProse(
      'A needle-pointed mind pierces where a blunt-pointed one is turned back.'
    )
    expect(audit.findings.filter((f) => f.kind === 'dash')).toHaveLength(0)
  })

  it('reports a grade level and the sentence length behind it', () => {
    const plain = auditProse(
      'The book is a course. It has twenty lessons. Each one asks you to try something.'
    )
    const tangled = auditProse(
      'The book, which is a course of twenty consecutive lessons, each of which incorporates ' +
        'exercises intended for independent practical application, presupposes a systematic ' +
        'progression through its constituent parts rather than intermittent consultation.'
    )
    expect(plain.reading.grade).toBeLessThan(tangled.reading.grade)
    expect(plain.reading.wordsPerSentence).toBeLessThan(tangled.reading.wordsPerSentence)
  })

  it('leaves an ordinary intensifier alone', () => {
    // The first false positive this check produced on real prose: the book's
    // own advice on concentration is to write a letter thinking of nothing but
    // that letter, which is not a verdict about anything.
    const fine = auditProse('Write a letter thinking of nothing but that letter.')
    expect(fine.findings).toHaveLength(0)
    const verdict = auditProse('The astral body is nothing but a figure of speech.')
    expect(verdict.findings.some((f) => f.kind === 'dismissal')).toBe(true)
  })

  it('catches the phrasing the house rules ban', () => {
    const audit = auditProse('It is worth noting that this is a fascinating case.')
    const banned = audit.findings.filter((f) => f.kind === 'banned').map((f) => f.match)
    expect(banned).toContain('it is worth noting')
    expect(banned).toContain('fascinating')
    expect(audit.clean).toBe(false)
  })

  it('counts a sentence that does both jobs on both sides', () => {
    // The sentence where the asymmetry actually does its work — a doctrine and
    // a measurement in the same breath, one of them hedged.
    const audit = auditProse('The supposed astral counterpart of the gland secretes nothing.')
    expect(audit.sentences.tradition).toBe(1)
    expect(audit.sentences.science).toBe(1)
  })
})
