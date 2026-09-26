import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  shelfProgress,
  shelfTitleParts,
  type ShelfAbout,
  type ShelfProgress,
  type ShelfStage
} from '@core/sync'

/**
 * The shelf as a row of cards, one at a time in the middle, swiped left and
 * right.
 *
 * Everything a card says comes from `shelfProgress` and `shelfTitleParts`, so
 * this file only decides how the shelf *moves*: the card under the finger
 * follows it, the ones either side shrink and fade as they leave the middle and
 * grow as they arrive, and a release settles on the nearest card — or the next
 * one along, when the flick was quick enough to mean it.
 *
 * The actions sit under the row rather than on the card, for the active book
 * only. A card is something to drag, and a button inside something being
 * dragged is a button pressed by accident at the end of every swipe.
 */

export interface ShelfCarouselProps {
  books: ShelfAbout[]
  busy: boolean
  /** A picture of the book's cover, when one has been made. */
  coverFor?: (book: ShelfAbout) => string | null | undefined
  onQueries: (book: ShelfAbout) => void
  onRead: (book: ShelfAbout) => void
  onOpen: (book: ShelfAbout) => void
  describeAge: (iso: string) => string
}

const PLACE_STORAGE = 'pdbf.shelf.place'
/** How far a release has to have travelled, as a share of a step, to move on. */
const COMMIT_SHARE = 0.18
/** A flick faster than this (px/ms) moves on however short it was. */
const FLICK_SPEED = 0.45
/** Movement under this is a tap, not a drag. */
const TAP_SLOP = 6
/** Cards further than this from the middle are not drawn at all. */
const DRAWN_RADIUS = 3

const STAGE_LABEL: Record<ShelfStage, string> = {
  unread: 'Not started',
  reading: 'Reading',
  deciding: 'Decisions waiting',
  done: 'Complete'
}

function readPlace(): string | null {
  try {
    return window.localStorage.getItem(PLACE_STORAGE)
  } catch {
    return null
  }
}

function writePlace(key: string): void {
  try {
    window.localStorage.setItem(PLACE_STORAGE, key)
  } catch {
    /* a lost place is not worth an error */
  }
}

export function ShelfCarousel(props: ShelfCarouselProps): JSX.Element {
  const { books, busy, coverFor, onQueries, onRead, onOpen, describeAge } = props

  const [index, setIndex] = useState(() => {
    const kept = readPlace()
    const at = kept ? books.findIndex((b) => b.key === kept) : -1
    return at >= 0 ? at : 0
  })
  // The shelf is listed after the first render; land on the remembered book
  // once it arrives, and keep the index in range if the shelf shrinks.
  const placedRef = useRef(false)
  useEffect(() => {
    if (books.length === 0) return
    if (!placedRef.current) {
      placedRef.current = true
      const kept = readPlace()
      const at = kept ? books.findIndex((b) => b.key === kept) : -1
      if (at >= 0) {
        setIndex(at)
        return
      }
    }
    setIndex((i) => Math.min(i, books.length - 1))
  }, [books])

  const active = books[index]
  useEffect(() => {
    if (active) writePlace(active.key)
  }, [active])

  // --- geometry -------------------------------------------------------------
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageWidth, setStageWidth] = useState(360)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = (): void => setStageWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const cardWidth = Math.min(330, Math.max(240, stageWidth * 0.72))
  // Neighbours tuck behind the middle card rather than sitting a full card
  // away: close enough to be seen, far enough to be told apart.
  const step = cardWidth * 0.78

  // --- the drag ---------------------------------------------------------------
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const pointer = useRef<{
    id: number
    x0: number
    y0: number
    t: number
    lastX: number
    lastT: number
    v: number
    engaged: boolean
    cancelled: boolean
  } | null>(null)
  const suppressClick = useRef(false)

  const go = useCallback(
    (to: number) => setIndex(Math.max(0, Math.min(books.length - 1, to))),
    [books.length]
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    suppressClick.current = false
    pointer.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t: e.timeStamp,
      lastX: e.clientX,
      lastT: e.timeStamp,
      v: 0,
      engaged: false,
      cancelled: false
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const p = pointer.current
    if (!p || p.id !== e.pointerId || p.cancelled) return
    const dx = e.clientX - p.x0
    const dy = e.clientY - p.y0
    if (!p.engaged) {
      if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return
      // A mostly vertical start is the page being scrolled; let it go.
      if (Math.abs(dy) > Math.abs(dx)) {
        p.cancelled = true
        return
      }
      p.engaged = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const dt = Math.max(1, e.timeStamp - p.lastT)
    p.v = 0.7 * ((e.clientX - p.lastX) / dt) + 0.3 * p.v
    p.lastX = e.clientX
    p.lastT = e.timeStamp
    // Past either end the shelf resists, so the edge is felt rather than hit.
    const atStart = index === 0 && dx > 0
    const atEnd = index === books.length - 1 && dx < 0
    setDrag(atStart || atEnd ? dx * 0.28 : dx)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const p = pointer.current
    pointer.current = null
    if (!p || p.id !== e.pointerId || !p.engaged) return
    suppressClick.current = true
    const moved = e.clientX - p.x0
    let steps = Math.round(-moved / step)
    if (steps === 0) {
      if (Math.abs(p.v) > FLICK_SPEED || Math.abs(moved) > step * COMMIT_SHARE) {
        steps = moved < 0 ? 1 : -1
      }
    }
    setDragging(false)
    setDrag(0)
    go(index + steps)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(index + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(index - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      go(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      go(books.length - 1)
    }
  }

  // A trackpad's sideways swipe arrives as wheel events: one step per gesture.
  const wheelRef = useRef({ acc: 0, until: 0 })
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    const w = wheelRef.current
    if (e.timeStamp < w.until) return
    w.acc += e.deltaX
    if (Math.abs(w.acc) > 40) {
      go(index + (w.acc > 0 ? 1 : -1))
      w.acc = 0
      w.until = e.timeStamp + 420
    }
  }

  const progress = useMemo(() => books.map((b) => shelfProgress(b)), [books])

  if (books.length === 0 || !active) return <></>

  const activeProgress = progress[index]!
  const waiting = active.queries?.waiting ?? 0

  return (
    <div className="deck">
      <div
        ref={stageRef}
        className={`deck-stage${dragging ? ' dragging' : ''}`}
        role="region"
        aria-roledescription="carousel"
        aria-label="Books on your shelf"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        style={{ '--card-w': `${cardWidth}px` } as React.CSSProperties}
      >
        {books.map((book, i) => {
          // Where this card sits, in steps from the middle; fractional while a
          // finger is on the shelf, so every card answers the drag at once.
          const d = i - index + drag / -step
          const far = Math.abs(d)
          if (far > DRAWN_RADIUS) return null
          const x = (i - index) * step + drag
          const near = Math.min(far, 2)
          const scale = 1 - near * 0.13
          const opacity = far > 2.4 ? 0 : 1 - near * 0.38
          const tilt = Math.max(-1, Math.min(1, d)) * 7
          return (
            <BookCard
              key={book.key}
              book={book}
              progress={progress[i]!}
              cover={coverFor?.(book) ?? null}
              depth={d}
              current={i === index}
              style={{
                transform: `translate3d(calc(-50% + ${x}px), 0, 0) perspective(1200px) rotateY(${tilt}deg) scale(${scale})`,
                opacity,
                zIndex: 100 - Math.round(far * 10),
                filter:
                  far > 0.05
                    ? `saturate(${1 - near * 0.3}) brightness(${1 - near * 0.22})`
                    : undefined
              }}
              onSelect={() => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                if (i !== index) go(i)
              }}
            />
          )
        })}
      </div>

      <div className="deck-nav">
        <button
          type="button"
          className="deck-arrow"
          aria-label="Previous book"
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          <Chevron dir="left" />
        </button>
        <div className="deck-dots" role="tablist" aria-label="Choose a book">
          {books.map((b, i) => (
            <button
              key={b.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={shelfTitleParts(b).title}
              className={`deck-dot stage-${progress[i]!.stage}${i === index ? ' on' : ''}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="deck-arrow"
          aria-label="Next book"
          disabled={index === books.length - 1}
          onClick={() => go(index + 1)}
        >
          <Chevron dir="right" />
        </button>
      </div>

      {/* The doors, for the book in the middle. Ordered by what the card says
          is left: a book with decisions waiting leads with them. Every door is
          the same door a review link opens, so a tap and a link cannot land
          differently. */}
      <div className={`deck-actions stage-${activeProgress.stage}`} aria-live="polite">
        {waiting > 0 ? (
          <button
            type="button"
            className="deck-primary"
            disabled={busy}
            onClick={() => onQueries(active)}
          >
            <span>
              Work through the {waiting} {waiting === 1 ? 'query' : 'queries'}
            </span>
            <span className="deck-go" aria-hidden="true">
              ›››
            </span>
          </button>
        ) : null}
        {/* Reading does not fetch the scan — tens of megabytes and ten
            minutes of OCR that a reading pass never looks at. */}
        <button
          type="button"
          className={waiting > 0 ? 'deck-secondary' : 'deck-primary'}
          disabled={busy}
          onClick={() => onRead(active)}
        >
          <span>Read the book</span>
          {waiting > 0 ? null : (
            <span className="deck-go" aria-hidden="true">
              ›››
            </span>
          )}
        </button>
        <button
          type="button"
          className="deck-secondary"
          disabled={busy}
          onClick={() => onOpen(active)}
          title={
            active.scanPath
              ? 'Brings the scan down as well, so passages can be checked against the paper'
              : 'The scan is not on the shelf for this book'
          }
        >
          {active.scanPath ? 'Open with the scan' : 'Open the work'}
        </button>
        <div className="deck-meta">
          {active.pageCount} leaves
          {active.corrections > 0 ? ` · ${active.corrections} corrections` : ''}
          {active.marked > 0 ? ` · ${active.marked} marked` : ''}
          {active.notes > 0 ? ` · ${active.notes} notes` : ''}
          {' · saved '}
          {describeAge(active.savedAt)}
        </div>
      </div>
    </div>
  )
}

interface BookCardProps {
  book: ShelfAbout
  progress: ShelfProgress
  cover: string | null
  /** Steps from the middle, fractional while dragging; signed. */
  depth: number
  current: boolean
  style: React.CSSProperties
  onSelect: () => void
}

function BookCard(props: BookCardProps): JSX.Element {
  const { book, progress, cover, depth, current, style, onSelect } = props
  const { title, author } = shelfTitleParts(book)
  const pct = Math.round(progress.fraction * 100)
  // The cover drifts against the card as it moves, a little further than the
  // card does — the parallax is what makes it read as standing off the card.
  const drift = Math.max(-1.5, Math.min(1.5, depth)) * -18
  return (
    <article
      className={`deck-card stage-${progress.stage}${current ? ' current' : ''}`}
      style={{ ...style, '--progress': progress.fraction } as React.CSSProperties}
      aria-current={current ? 'true' : undefined}
      aria-label={`${title}${author ? `, ${author}` : ''}. ${progress.summary}`}
      onClick={onSelect}
    >
      <div className="deck-card-glow" aria-hidden="true" />
      <div
        className="deck-cover"
        style={{ transform: `translateX(${drift}px) rotate(${-2 + depth * 1.5}deg)` }}
      >
        {cover ? <img src={cover} alt="" draggable={false} /> : <CoverPlaceholder />}
      </div>
      <div className="deck-card-body">
        <h3 className="deck-title">{title}</h3>
        {author ? <div className="deck-author">{author}</div> : null}
        <div className="deck-status">
          <span className="deck-chip">
            <span className="deck-chip-dot" aria-hidden="true" />
            {STAGE_LABEL[progress.stage]}
          </span>
          <span className="deck-pct">{pct}%</span>
        </div>
        <div className="deck-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="deck-summary">{progress.summary}</p>
      </div>
    </article>
  )
}

/** A book not yet given a cover: a blank cloth board with a question on it. */
function CoverPlaceholder(): JSX.Element {
  return (
    <div className="deck-cover-blank" role="img" aria-label="No cover yet">
      <span className="deck-cover-frame" aria-hidden="true" />
      <span className="deck-cover-q" aria-hidden="true">
        ?
      </span>
    </div>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
