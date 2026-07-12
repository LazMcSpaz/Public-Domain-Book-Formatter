/**
 * FlagItem — one row in the flag list. Renders the honest tiers (SPEC §4):
 *   - OCR flags show a REAL confidence number (e.g. "OCR 47").
 *   - Heuristic flags show ONLY a labelled chip (source · label) — never a
 *     number or percentage.
 * The two tiers are visually distinct so trust is never confused.
 */
import type { Flag } from '@core/model'

export interface FlagItemProps {
  flag: Flag
  index: number
  active: boolean
  /** The token this flag anchors to (null = can't be marked good). */
  tokenId: string | null
  /** Whether the user has marked this token reviewed-good. */
  resolved: boolean
  onSelect: (index: number) => void
  onToggleResolved: (tokenId: string) => void
}

export function FlagItem({
  flag,
  index,
  active,
  tokenId,
  resolved,
  onSelect,
  onToggleResolved
}: FlagItemProps): JSX.Element {
  const isOcr = flag.kind === 'ocr'
  return (
    <li className={`flag-row${resolved ? ' flag-row--resolved' : ''}`}>
      <button
        type="button"
        className={`flag-item flag-${flag.kind}${active ? ' flag-active' : ''}`}
        onClick={() => onSelect(index)}
        aria-current={active}
      >
        {isOcr ? (
          <>
            <span className="flag-badge flag-badge-ocr">OCR</span>
            <span
              className={`flag-confidence conf-${confidenceBand(flag.confidence)}`}
              title="True engine confidence (0–100)"
            >
              {Math.round(flag.confidence)}
            </span>
          </>
        ) : (
          <span className="flag-chip" title="Heuristic flag — not a probability">
            <span className="flag-chip-source">{flag.source}</span>
            <span className="flag-chip-sep">·</span>
            <span className="flag-chip-label">{flag.label}</span>
          </span>
        )}
      </button>
      <label
        className="flag-good"
        title={tokenId ? 'Mark this word reviewed — hides its flag & tint' : 'No token to mark'}
      >
        <input
          type="checkbox"
          checked={resolved}
          disabled={!tokenId}
          onChange={() => tokenId && onToggleResolved(tokenId)}
        />
        <span>good</span>
      </label>
    </li>
  )
}

/** Coarse confidence band for tinting the number — low/mid/high. */
function confidenceBand(confidence: number): 'low' | 'mid' | 'high' {
  if (confidence < 60) return 'low'
  if (confidence < 80) return 'mid'
  return 'high'
}
