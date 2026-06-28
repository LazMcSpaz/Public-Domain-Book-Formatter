/**
 * StructurePanel — sidebar listing all structural tags plus a live TOC preview
 * (SPEC §5, §7). Self-contained: reads everything from ReviewContext, so the
 * integrator mounts it with no props.
 *
 * Each tag row shows its type + the text slice it covers. Clicking a row selects
 * it (SET_ACTIVE_TAG) and hovers the token at `range.start` so both panes scroll
 * to / highlight it. Heading tags carry a confirm/reject affordance: confirm
 * sets `data.confirmed=true` (promoting it into the TOC), reject removes it.
 * Every row has a delete control.
 *
 * Below the list, a live TOC preview is built from the confirmed heading tags
 * via `buildToc`, with jump-to using the same hover dispatch.
 */
import { useMemo } from 'react'
import './StructurePanel.css'
import type { StructuralTag } from '@core/model'
import { buildToc } from '@core/structure'
import { useReview } from '../../store/ReviewContext'
import { TAG_META } from './tag-meta'

const MAX_SLICE = 60

export function StructurePanel(): JSX.Element {
  const { state, dispatch } = useReview()
  const project = state.project
  const markdown = project?.markdown ?? ''
  const tags = project?.tags ?? []
  const coordinateMap = state.coordinateMap

  // Tags in document order (by range start).
  const ordered = useMemo(() => [...tags].sort((a, b) => a.range.start - b.range.start), [tags])

  const confirmedHeadings = useMemo(
    () => tags.filter((t) => t.type === 'heading' && isConfirmed(t)),
    [tags]
  )

  const toc = useMemo(() => buildToc(confirmedHeadings, markdown), [confirmedHeadings, markdown])

  const sliceOf = (tag: StructuralTag): string => {
    const raw = markdown.slice(tag.range.start, tag.range.end).replace(/\s+/g, ' ').trim()
    return raw.length > MAX_SLICE ? `${raw.slice(0, MAX_SLICE)}…` : raw
  }

  const jumpTo = (outputOffset: number): void => {
    const entry = coordinateMap?.atOutputOffset(outputOffset) ?? null
    dispatch({
      type: 'SET_HOVER',
      hover: {
        tokenId: entry?.tokenId ?? null,
        sourcePageIndex: entry?.pageIndex ?? null,
        outputOffset
      }
    })
  }

  const selectTag = (tag: StructuralTag): void => {
    dispatch({ type: 'SET_ACTIVE_TAG', id: tag.id })
    jumpTo(tag.range.start)
  }

  if (!project) {
    return <div className="structure-panel structure-panel--empty">No project loaded.</div>
  }

  return (
    <div className="structure-panel">
      <section className="structure-section">
        <h2 className="structure-heading">Structure tags</h2>
        {ordered.length === 0 ? (
          <p className="structure-empty">
            Select a passage in the output and right-click to tag it.
          </p>
        ) : (
          <ul className="structure-list">
            {ordered.map((tag) => {
              const meta = TAG_META[tag.type]
              const active = tag.id === state.activeTagId
              const heading = tag.type === 'heading'
              return (
                <li
                  key={tag.id}
                  className={`structure-row${active ? ' structure-row--active' : ''}`}
                >
                  <button
                    type="button"
                    className="structure-row-main"
                    onClick={() => selectTag(tag)}
                  >
                    <span className="structure-badge" style={{ background: meta.color }}>
                      {meta.badge}
                    </span>
                    <span className="structure-row-text">
                      <span className="structure-row-type">{meta.label}</span>
                      <span className="structure-row-slice">{sliceOf(tag) || '(empty)'}</span>
                    </span>
                  </button>
                  <span className="structure-row-actions">
                    {heading && !isConfirmed(tag) && (
                      <button
                        type="button"
                        className="structure-act structure-act--confirm"
                        title="Confirm heading (adds to TOC)"
                        onClick={() =>
                          dispatch({
                            type: 'UPDATE_TAG',
                            id: tag.id,
                            patch: { data: { ...tag.data, confirmed: true } }
                          })
                        }
                      >
                        ✓
                      </button>
                    )}
                    {heading && isConfirmed(tag) && (
                      <button
                        type="button"
                        className="structure-act structure-act--reject"
                        title="Reject heading"
                        onClick={() => dispatch({ type: 'REMOVE_TAG', id: tag.id })}
                      >
                        ✗
                      </button>
                    )}
                    <button
                      type="button"
                      className="structure-act structure-act--delete"
                      title="Delete tag"
                      onClick={() => dispatch({ type: 'REMOVE_TAG', id: tag.id })}
                    >
                      🗑
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="structure-section">
        <h2 className="structure-heading">Table of contents (preview)</h2>
        {toc.length === 0 ? (
          <p className="structure-empty">Confirm heading tags to build the TOC.</p>
        ) : (
          <ul className="structure-toc">
            {toc.map((entry) => (
              <li
                key={entry.outputOffset}
                className="structure-toc-row"
                style={{ paddingLeft: `${(entry.level - 1) * 14}px` }}
              >
                <button
                  type="button"
                  className="structure-toc-link"
                  onClick={() => jumpTo(entry.outputOffset)}
                >
                  {entry.title || '(untitled)'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function isConfirmed(tag: StructuralTag): boolean {
  return tag.data?.confirmed === true
}
