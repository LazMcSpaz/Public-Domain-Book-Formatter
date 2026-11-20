/**
 * Each role's emblem and colour in the Workroom, as the approved mock-up
 * draws them (`docs/specs/workroom-mockup.html`): a simple line icon in a dark
 * gilded medallion. Compass for the scout, eye for the reader, page for the
 * typesetter, quill for Etsu, a quill with a check for Etsu's editor, a shield
 * with a check for the checker; plain ones for the managing editor (a ledger),
 * the builder (a square and rule) and the reviewer (a lens).
 *
 * Presentation only: who the roles are is core's (`ROLES`, `ROLE_LABELS`).
 */
import type { Role } from '@core/work'

export interface RoleLook {
  /** The emblem's stroke, light enough to read on the dark medallion. */
  color: string
  /** One line under the role's name. */
  blurb: string
}

export const ROLE_LOOK: Readonly<Record<Role, RoleLook>> = {
  'managing-editor': { color: '#e8cf8f', blurb: 'plans, hands out, reports' },
  scout: { color: '#7fb8d3', blurb: 'finds and fetches sources' },
  reader: { color: '#9fd38a', blurb: 'text against the page' },
  typesetter: { color: '#d3a67f', blurb: 'pictures, layout, covers' },
  etsu: { color: '#c99be0', blurb: 'introduction, notes, glossary' },
  'etsu-editor': { color: '#b3a6ee', blurb: 'checks the writing' },
  checker: { color: '#f1d48a', blurb: 'the independent gate' },
  builder: { color: '#a9bccc', blurb: 'changes the tools' },
  reviewer: { color: '#d9a3a3', blurb: 'reviews the tools’ changes' }
}

const PATHS: Readonly<Record<Role, JSX.Element>> = {
  'managing-editor': (
    <>
      <path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" />
      <path d="M12 6v13.5" />
    </>
  ),
  scout: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16M4 12h16M12 7l3 5-3 5-3-5z" />
    </>
  ),
  reader: (
    <>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  typesetter: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="1" />
      <path d="M8 8h8M8 11h8M8 14h5" />
    </>
  ),
  etsu: (
    <>
      <path d="M5 19c4-1 9-6 13-14-6 3-11 8-13 14z" />
      <path d="M5 19l5-5" />
    </>
  ),
  'etsu-editor': (
    <>
      <path d="M4 17c3-1 7-5 10-11-5 2-8 6-10 11z" />
      <path d="M4 17l4-4" />
      <path d="M13 17l2.5 2.5L20 15" />
    </>
  ),
  checker: (
    <>
      <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  builder: (
    <>
      <path d="M5 5h3v14H5zM8 16h11v3H8z" />
      <path d="M11 16v-2M14 16v-3M17 16v-2" />
    </>
  ),
  reviewer: (
    <>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M14.5 14.5L20 20" />
    </>
  )
}

/** The role's emblem in its gilded medallion. */
export function Emblem({ role, size = 'small' }: { role: Role; size?: 'small' | 'large' }) {
  return (
    <span className={`wr-sig wr-sig-${size}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" style={{ stroke: ROLE_LOOK[role].color }}>
        {PATHS[role]}
      </svg>
    </span>
  )
}

const SPINES = ['#4b2a5e', '#24465c', '#5e2a2a', '#2f4a2c', '#5a4320', '#3a2f5c', '#22504a']

/** A book's spine colour, the same every time for the same folder. */
export function spineColor(folder: string): string {
  let h = 0
  for (let i = 0; i < folder.length; i++) h = (h * 31 + folder.charCodeAt(i)) >>> 0
  return SPINES[h % SPINES.length]!
}
