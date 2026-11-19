/**
 * The house look, offered at the design gate.
 *
 * A book with no design answers of its own opens the design gate already
 * answered with the house look from the shelf (`design/house-look.json`): set
 * on the house trim, or on the short-book trim when it prints short there. The
 * answers are the book's from then on, saved with it like any other answer,
 * so a later change to the house look never moves a book already set.
 *
 * The decisions are core's (`@core/style` house look); this only fetches,
 * measures and fills in. A shelf that is not connected, or holds no house
 * look, leaves the gate as it always was.
 */
import { useEffect, useRef, useState } from 'react'
import type { BookDocument } from '@core/assemble'
import type { LayoutEdition } from '@core/layout'
import { hasOwnDesign, houseDesignFor, houseLookLine } from '@core/style'
import { FRESH_LOOK, appliedLook, type WizardState } from '@core/wizard'
import type { Answers } from '@core/wizard/questions'
import {
  fetchHouseLook,
  houseLookRefusal,
  type HouseLookRead
} from '../platform/browser/house-look'
import { interiorPageCount } from '../platform/browser/interior'
import { loadReviewProgress, loadShelf, shelfReady } from '../platform/browser/settings'

/**
 * Fill the design gate from the house look for a book with no design of its
 * own, and say so. Returns the sentence to show, or null.
 */
export function useHouseLook(input: {
  stepId: string
  fileKey: string | null
  state: WizardState
  answers: Answers
  setAnswers: (answers: Answers) => void
  document: BookDocument | null
  edition: LayoutEdition
}): string | null {
  const [house, setHouse] = useState<HouseLookRead | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // The latest of everything the measuring reads, so a slow measure never acts
  // on a book or an answer that has since changed.
  const latest = useRef(input)
  latest.current = input
  const seeded = useRef<string | null>(null)
  const measuring = useRef(false)

  useEffect(() => {
    const config = loadShelf()
    if (!shelfReady(config)) return
    let live = true
    fetchHouseLook(config)
      .then((read) => {
        if (live) setHouse(read)
      })
      .catch(() => {
        // A shelf that cannot be reached leaves the gate as it always was.
      })
    return () => {
      live = false
    }
  }, [])

  const { stepId, fileKey, answers, document } = input
  // A note belongs to the book it was written for. Before the effect that
  // writes one, so a note written in the same render survives.
  useEffect(() => {
    setNote(null)
  }, [fileKey])

  useEffect(() => {
    if (stepId !== 'design' || !fileKey || !house || !document) return
    if (seeded.current === fileKey || measuring.current) return
    if (Object.keys(answers).length > 0) return
    const own = loadReviewProgress(fileKey)['design'] as Answers | undefined
    if (hasOwnDesign(own)) return
    const refused = houseLookRefusal(house)
    if (refused || !('look' in house)) {
      seeded.current = fileKey
      setNote(`This book starts from the defaults: ${refused ?? 'no house look'}.`)
      return
    }
    const fresh = (design: Answers): Answers => ({ ...design, profile: FRESH_LOOK })
    const profile = appliedLook(latest.current.state, fresh(house.look.design)).style
    measuring.current = true
    void interiorPageCount(document, profile, {
      edition: latest.current.edition,
      orphanNotes: 'collect'
    })
      .then((pages) => {
        const now = latest.current
        // The person started answering, or moved on, while it measured.
        if (now.fileKey !== fileKey || Object.keys(now.answers).length > 0) return
        const { design, short } = houseDesignFor(house.look, pages)
        seeded.current = fileKey
        now.setAnswers(fresh(design))
        setNote(
          'This book had no design of its own, so it starts from ' +
            `${houseLookLine({ look: house.look, path: house.path, pagesOnHouseTrim: pages, short })}.`
        )
      })
      .catch(() => {
        seeded.current = fileKey
        setNote(
          'The house look could not be laid out on this book, so it starts from the defaults.'
        )
      })
      .finally(() => {
        measuring.current = false
      })
  }, [stepId, fileKey, house, answers, document])

  return stepId === 'design' ? note : null
}
