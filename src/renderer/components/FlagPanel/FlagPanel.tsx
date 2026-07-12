/**
 * FlagPanel — the flag report (SPEC §4 "confidence & flags — honest tiers" and
 * jump-to-flag). Lists every flag on the project; clicking one makes it the
 * active flag and sets hover to its token so both panes highlight it.
 *
 * OCR flags carry a real number; heuristic flags are labelled chips only. The
 * rendering of that distinction lives in FlagItem.
 */
import { useCallback, useMemo, useState } from 'react'
import { useReview } from '../../store/ReviewContext'
import { useFlagNav } from '../../store/FlagNavContext'
import { flagTokenId } from '../../utils/flag-token'
import { jumpToToken } from '../../highlight'
import { FlagItem } from './FlagItem'
import './FlagPanel.css'

/** The token id a flag anchors to (for the mark-good checkbox), or null. */
function anchorTokenId(flag: { kind: string; tokenId?: string }): string | null {
  return typeof flag.tokenId === 'string' ? flag.tokenId : null
}

export function FlagPanel(): JSX.Element {
  const { state, dispatch } = useReview()
  const { activeIndex, setActiveIndex } = useFlagNav()
  const flags = state.project?.flags ?? []
  const [showResolved, setShowResolved] = useState(false)

  const resolved = useMemo(
    () => new Set(state.project?.resolvedTokenIds ?? []),
    [state.project?.resolvedTokenIds]
  )

  const onSelect = useCallback(
    (index: number) => {
      setActiveIndex(index)
      const flag = state.project?.flags[index]
      if (!flag) return
      const tokenId = flagTokenId(flag, state.coordinateMap)
      if (tokenId) jumpToToken(tokenId)
    },
    [state.project, state.coordinateMap, setActiveIndex]
  )

  const onToggleResolved = useCallback(
    (tokenId: string) => dispatch({ type: 'TOGGLE_FLAG_RESOLVED', tokenId }),
    [dispatch]
  )

  // Keep original indices (FlagNav/next-flag index into project.flags) while
  // filtering out resolved rows unless the user asks to see them.
  const rows = flags
    .map((flag, index) => ({ flag, index, tokenId: anchorTokenId(flag) }))
    .filter((r) => showResolved || !(r.tokenId && resolved.has(r.tokenId)))

  const ocrCount = flags.filter((f) => f.kind === 'ocr').length
  const heuristicCount = flags.length - ocrCount
  const resolvedCount = flags.filter((f) => {
    const id = anchorTokenId(f)
    return id !== null && resolved.has(id)
  }).length

  return (
    <section className="flag-panel panel">
      <header className="panel-header">
        <h3>Flags</h3>
        <span className="panel-count">
          {ocrCount} OCR · {heuristicCount} heuristic
        </span>
      </header>
      {resolvedCount > 0 ? (
        <label className="flag-showresolved" title="Show flags you already marked good">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={() => setShowResolved((v) => !v)}
          />
          <span>Show {resolvedCount} marked good</span>
        </label>
      ) : null}
      {flags.length === 0 ? (
        <p className="panel-empty">No flags.</p>
      ) : rows.length === 0 ? (
        <p className="panel-empty">All flags reviewed. 🎉</p>
      ) : (
        <ul className="flag-list">
          {rows.map(({ flag, index, tokenId }) => (
            <FlagItem
              key={index}
              flag={flag}
              index={index}
              active={index === activeIndex}
              tokenId={tokenId}
              resolved={tokenId !== null && resolved.has(tokenId)}
              onSelect={onSelect}
              onToggleResolved={onToggleResolved}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
