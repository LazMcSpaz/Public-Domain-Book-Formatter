/**
 * FlagPanel — the flag report (SPEC §4 "confidence & flags — honest tiers" and
 * jump-to-flag). Lists every flag on the project; clicking one makes it the
 * active flag and sets hover to its token so both panes highlight it.
 *
 * OCR flags carry a real number; heuristic flags are labelled chips only. The
 * rendering of that distinction lives in FlagItem.
 */
import { useCallback } from 'react'
import { useReview } from '../../store/ReviewContext'
import { FlagItem } from './FlagItem'
import './FlagPanel.css'

export function FlagPanel(): JSX.Element {
  const { state, dispatch } = useReview()
  const flags = state.project?.flags ?? []

  const onSelect = useCallback(
    (index: number) => {
      dispatch({ type: 'SET_ACTIVE_FLAG', index })
      const flag = state.project?.flags[index]
      if (!flag) return
      const tokenId = flag.tokenId
      if (tokenId) {
        const entry = state.coordinateMap?.byTokenId(tokenId) ?? null
        dispatch({
          type: 'SET_HOVER',
          hover: {
            tokenId,
            sourcePageIndex: entry?.pageIndex ?? null,
            outputOffset: entry?.output.start ?? null
          }
        })
      } else {
        dispatch({ type: 'CLEAR_HOVER' })
      }
    },
    [state.project, state.coordinateMap, dispatch]
  )

  const ocrCount = flags.filter((f) => f.kind === 'ocr').length
  const heuristicCount = flags.length - ocrCount

  return (
    <section className="flag-panel panel">
      <header className="panel-header">
        <h3>Flags</h3>
        <span className="panel-count">
          {ocrCount} OCR · {heuristicCount} heuristic
        </span>
      </header>
      {flags.length === 0 ? (
        <p className="panel-empty">No flags.</p>
      ) : (
        <ul className="flag-list">
          {flags.map((flag, index) => (
            <FlagItem
              key={index}
              flag={flag}
              index={index}
              active={index === state.activeFlagIndex}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
