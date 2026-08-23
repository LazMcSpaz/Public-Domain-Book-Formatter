/**
 * What the export screen hands the cover studio.
 *
 * Two halves, on purpose. The **facts** — trim, the measured page count, the
 * title as it was confirmed at the export gate — go through `sessionStorage`,
 * so a refresh of the studio does not lose them and the user is not asked
 * again for something the app spent an evening working out. The **pixels** —
 * plates already cut out of the scan — stay in a module variable, because they
 * are megabytes and because an object URL is meaningless once the tab that
 * minted it is gone. A refresh therefore keeps the numbers and drops the
 * plates, which is the honest split: the numbers cost thought and the plates
 * cost one click of "open the book again".
 *
 * Not a store and not state: a doorway. Read once, then owned by the studio.
 */
import type { PlateOffer } from '@core/cover'

export interface CoverHandoffFacts {
  trimSize: string
  pageCount: number
  /** True when the page count came from the layout engine rather than a guess. */
  pageCountMeasured: boolean
  title: string
  author: string
  imprint: string
}

const FACTS_KEY = 'pdbf.coverHandoff'

/** Plates and their pixels — this tab only. */
let plates: { offers: PlateOffer[]; bytes: Map<string, Uint8Array> } = {
  offers: [],
  bytes: new Map()
}

export function setCoverHandoff(
  facts: CoverHandoffFacts,
  art: { offers: PlateOffer[]; bytes: Map<string, Uint8Array> } = { offers: [], bytes: new Map() }
): void {
  plates = art
  try {
    sessionStorage.setItem(FACTS_KEY, JSON.stringify(facts))
  } catch {
    // Private browsing. The studio still gets the plates and asks for the rest.
  }
}

export function takeCoverHandoffFacts(): CoverHandoffFacts | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(FACTS_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CoverHandoffFacts>
    return {
      trimSize: typeof parsed.trimSize === 'string' ? parsed.trimSize : '6x9',
      pageCount: typeof parsed.pageCount === 'number' ? parsed.pageCount : 0,
      pageCountMeasured: parsed.pageCountMeasured === true,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      author: typeof parsed.author === 'string' ? parsed.author : '',
      imprint: typeof parsed.imprint === 'string' ? parsed.imprint : ''
    }
  } catch {
    return null
  }
}

export function coverHandoffPlates(): { offers: PlateOffer[]; bytes: Map<string, Uint8Array> } {
  return plates
}

/** Forget the facts, so a later visit to `#cover` starts clean. */
export function clearCoverHandoff(): void {
  try {
    sessionStorage.removeItem(FACTS_KEY)
  } catch {
    // Nothing to clear.
  }
  plates = { offers: [], bytes: new Map() }
}
