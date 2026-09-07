/**
 * The book to read, and to mark while reading.
 *
 * The pass that chooses the footnotes and finds the introduction's material
 * happens before either is written, and until this view existed the app had
 * nowhere to hold it: the reading was done in another application whose
 * highlights could not be exported, so the book was read once for real and once
 * from memory, and the remembered reading was the one the edition was built
 * from. What that cost is measurable — of the 23 footnotes in the first book
 * published here, 22 hang on a proper name, because an annotator scanning a
 * page finds the entities it already knows and not the places a person stops.
 *
 * It is the same column the galley builds (`passagesOf`, shared, so a mark can
 * never land on a paragraph the editor was not looking at) and deliberately
 * *not* the same surface:
 *
 *  - **Nothing here can change the text.** Not "editable but you probably
 *    won't": there is no `contenteditable`, no toolbar, no Ctrl+I, no find and
 *    replace. Two hundred pages of reading on a touch screen with a caret in
 *    the words is an evening of accidental edits. The way out is deliberate and
 *    explicit — "Edit this passage" hands the block to the galley.
 *  - **The gesture is a finger drag on text**, which is the platform's own
 *    selection and nothing else. No Pencil layer, no canvas, no hit-testing of
 *    our own. What this adds is a popover on `selectionchange`.
 *  - **A mark is one of four things**, and three of them are highlights while
 *    the fourth is a comment — a memo, the channel that already exists and is
 *    already swept. A fourth *tag* would have been a second inbox, and an
 *    apparatus with two of anything gets done for one book and skipped for the
 *    next.
 *
 * Every mark commits as an ordinary record in the same edit list, through the
 * same `withEdit`, so it travels in the saved run and in `book.json` and is
 * undone by the same Ctrl+Z as everything else.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { outlineOf, passagesOf, sectionTitlesOf, type Passage } from './passages'
import { selectionSpan } from './dom-offsets'
import type { BookDocument } from '@core/assemble'
import { parseInlineMarkup } from '@core/transcribe'
import {
  HIGHLIGHT_TAGS,
  clearHighlight,
  highlightCounts,
  highlightsOf,
  htmlWithSpans,
  memosOf,
  withEdit,
  type BookEdit,
  type HighlightTag,
  type TextSpan
} from '@core/edits'
import { findQuote } from '@core/annotate'

export interface BookReaderProps {
  /** The book as it stands — `applyEdits` output, sections and all. */
  document: BookDocument
  edits: BookEdit[]
  onChange: (edits: BookEdit[]) => void
  /**
   * Hand this block to the galley for editing — the deliberate way out of a
   * read-only surface. An errant full stop is a five-second fix and making the
   * editor file a comment about it would be silly.
   */
  onEditPassage: (blockId: string) => void
  /** Identifies the book, so where you left off is remembered per book. */
  bookKey?: string
}

/** What each button says, and what it is for. */
const BUTTONS: { tag: HighlightTag; label: string; hint: string }[] = [
  { tag: 'note', label: 'Needs a note', hint: 'a place that wants a footnote' },
  { tag: 'intro', label: 'For the introduction', hint: 'material for the front matter' },
  { tag: 'glossary', label: 'A term to define', hint: 'a word for the glossary' }
]

const TAG_LABEL: Record<HighlightTag, string> = {
  note: 'Needs a note',
  intro: 'For the introduction',
  glossary: 'A term to define'
}

const mintId = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`

/** The plain text of a passage — what a highlight's offsets are measured in. */
const plainOf = (markup: string): string => parseInlineMarkup(markup).text

/** A selection waiting for the editor to say what it is for. */
interface Pending {
  passageId: string
  from: number
  to: number
  quote: string
  /** Where to put the popover, in viewport coordinates. */
  at: { top: number; left: number }
}

export function BookReader({
  document: doc,
  edits,
  onChange,
  onEditPassage,
  bookKey
}: BookReaderProps): JSX.Element {
  const passages = useMemo(() => passagesOf(doc, edits), [doc, edits])
  const sectionTitles = useMemo(() => sectionTitlesOf(doc, edits), [doc, edits])
  const outline = useMemo(() => outlineOf(doc), [doc])
  const counts = useMemo(() => highlightCounts(edits), [edits])
  const marked = counts.note + counts.intro + counts.glossary

  const [pending, setPending] = useState<Pending | null>(null)
  /** The mark whose note is open for typing, if any. */
  const [openNote, setOpenNote] = useState<string | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)

  /**
   * Every mark on each passage, as tinted stretches.
   *
   * Located by `findQuote` against the passage as it stands rather than by the
   * stored offsets, for the reason the record itself gives: a correction made
   * after the reading shifts every character in the block, and a tint drawn at
   * the stored number would sit on words the editor never marked. A mark whose
   * words are gone is simply not drawn — it is not lost, and the harvest still
   * reports it with the editor's own words attached.
   */
  const spansByPassage = useMemo(() => {
    const plain = new Map(passages.map((p) => [p.id, plainOf(p.text)]))
    const out = new Map<string, TextSpan[]>()
    const add = (blockId: string, span: TextSpan): void => {
      const list = out.get(blockId) ?? []
      list.push(span)
      out.set(blockId, list)
    }
    for (const h of highlightsOf(edits)) {
      const text = plain.get(h.blockId)
      const found = text === undefined ? null : findQuote(text, h.quote, h.from)
      if (found) add(h.blockId, { ...found, key: `tag-${h.tag}`, id: h.highlightId })
    }
    // A comment left on a selection is drawn too — the editor made one gesture
    // and both are marks on the page, whatever they are addressed to.
    for (const m of memosOf(edits)) {
      if (!m.quote) continue
      const text = plain.get(m.blockId)
      const found = text === undefined ? null : findQuote(text, m.quote, m.at)
      if (found) add(m.blockId, { ...found, key: 'tag-comment', id: m.memoId })
    }
    return out
  }, [edits, passages])

  /**
   * A drag over words offers the buttons; a tap does not.
   *
   * `selectionchange` rather than a mouse or touch event, because it is the one
   * signal iOS gives for a selection that has been adjusted by dragging the
   * handles — which is how a reader fixes a selection that grabbed half a word.
   */
  useEffect(() => {
    const onSelect = (): void => {
      const column = columnRef.current
      if (!column) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setPending(null)
        return
      }
      const range = sel.getRangeAt(0)
      const host = (
        range.startContainer.nodeType === 1
          ? (range.startContainer as Element)
          : range.startContainer.parentElement
      )?.closest('[data-passage]')
      if (!host || !column.contains(host)) {
        setPending(null)
        return
      }
      // Both ends inside *this* passage, or it is not a mark: a highlight names
      // one block, so a drag across a paragraph boundary is refused rather than
      // silently truncated at an edge the reader cannot see.
      const span = selectionSpan(host as HTMLElement)
      if (!span) {
        setPending(null)
        return
      }
      const rect = range.getBoundingClientRect()
      setPending({
        passageId: (host as HTMLElement).dataset['passage'] ?? '',
        from: span.from,
        to: span.to,
        // The words, not the offsets: this is the durable anchor.
        quote: range.toString(),
        at: { top: rect.top, left: rect.left + rect.width / 2 }
      })
    }
    window.document.addEventListener('selectionchange', onSelect)
    return () => window.document.removeEventListener('selectionchange', onSelect)
  }, [])

  /** Where you left off, per book — a reading is resumed, not restarted. */
  const placeKey = bookKey ? `pdbf.reading.place.${bookKey}` : null
  useEffect(() => {
    if (!placeKey) return
    let held: string | null = null
    try {
      held = window.localStorage.getItem(placeKey)
    } catch {
      held = null
    }
    if (!held) return
    const target = window.document.querySelector(`[data-passage="${CSS.escape(held)}"]`)
    target?.scrollIntoView({ block: 'center' })
  }, [placeKey])

  useEffect(() => {
    if (!placeKey) return
    const column = columnRef.current
    if (!column) return
    let timer: number | undefined
    const remember = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        // The passage nearest the middle of the screen is where the eye is.
        const middle = window.innerHeight / 2
        let best: { id: string; distance: number } | null = null
        for (const el of Array.from(column.querySelectorAll('[data-passage]'))) {
          const rect = el.getBoundingClientRect()
          const distance = Math.abs(rect.top + rect.height / 2 - middle)
          const id = (el as HTMLElement).dataset['passage']
          if (id && (!best || distance < best.distance)) best = { id, distance }
        }
        try {
          if (best) window.localStorage.setItem(placeKey, best.id)
        } catch {
          // A browser refusing storage loses the place and nothing else.
        }
      }, 400)
    }
    window.addEventListener('scroll', remember, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('scroll', remember)
    }
  }, [placeKey])

  const mark = useCallback(
    (tag: HighlightTag): void => {
      if (!pending) return
      const highlightId = mintId('hl')
      onChange(
        withEdit(edits, {
          kind: 'highlight',
          highlightId,
          blockId: pending.passageId,
          quote: pending.quote,
          from: pending.from,
          to: pending.to,
          tag,
          madeAt: new Date().toISOString()
        })
      )
      window.getSelection()?.removeAllRanges()
      setPending(null)
      // Opened for typing but never *required*: a bare highlight is a mark, and
      // making the editor write something to record a place would slow the
      // reading down to the speed of the writing.
      setOpenNote(highlightId)
    },
    [edits, onChange, pending]
  )

  const comment = useCallback((): void => {
    if (!pending) return
    const memoId = mintId('memo')
    onChange(
      withEdit(edits, {
        kind: 'memo',
        memoId,
        blockId: pending.passageId,
        at: pending.from,
        to: pending.to,
        quote: pending.quote,
        text: ''
      })
    )
    window.getSelection()?.removeAllRanges()
    setPending(null)
    setOpenNote(memoId)
  }, [edits, onChange, pending])

  /** Hand this passage to the galley, with the selection cleared behind us. */
  const fixHere = useCallback((): void => {
    if (!pending) return
    const blockId = pending.passageId
    window.getSelection()?.removeAllRanges()
    setPending(null)
    onEditPassage(blockId)
  }, [onEditPassage, pending])

  const openRecord = useMemo(() => {
    if (!openNote) return null
    const highlight = highlightsOf(edits).find((h) => h.highlightId === openNote)
    if (highlight) return { kind: 'highlight' as const, record: highlight }
    const memo = memosOf(edits).find((m) => m.memoId === openNote)
    return memo ? { kind: 'memo' as const, record: memo } : null
  }, [edits, openNote])

  const writeNote = (text: string): void => {
    if (!openRecord) return
    onChange(
      withEdit(
        edits,
        openRecord.kind === 'highlight'
          ? { ...openRecord.record, ...(text ? { text } : { text: undefined }) }
          : { ...openRecord.record, text }
      )
    )
  }

  const jumpTo = (id: string): void => {
    window.document.querySelector(`[data-passage="${CSS.escape(id)}"]`)?.scrollIntoView({
      block: 'start',
      behavior: 'smooth'
    })
  }

  return (
    <div className="reading">
      <div className="reading-bar">
        <span className="reading-count">
          {marked === 0
            ? 'Nothing marked yet — drag over words to mark a passage.'
            : `${marked} marked`}
        </span>
        {marked > 0 ? (
          <span className="reading-tally">
            {HIGHLIGHT_TAGS.filter((t) => counts[t] > 0).map((t) => (
              <span key={t} className={`reading-chip tag-${t}`}>
                {counts[t]} {TAG_LABEL[t].toLowerCase()}
              </span>
            ))}
          </span>
        ) : null}
        <span className="reading-hint">
          Marks are yours. They never print, and they brief the notes and the introduction.
        </span>
      </div>

      <div className="reading-layout">
        {outline.length > 0 ? (
          <nav className="galley-outline" aria-label="Outline">
            {outline.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.kind === 'division' ? 'galley-outline-division' : ''}
                onClick={() => jumpTo(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="galley-page reading-page" ref={columnRef}>
          {passages.map((passage) => (
            <PassageView
              key={passage.id}
              passage={passage}
              title={sectionTitles.get(passage.id)?.title ?? null}
              spans={spansByPassage.get(passage.id) ?? []}
              onOpenMark={setOpenNote}
            />
          ))}
        </div>
      </div>

      {pending ? (
        <div
          className="reading-popover"
          style={{ top: `${Math.max(8, pending.at.top - 8)}px`, left: `${pending.at.left}px` }}
          role="dialog"
          aria-label="What is this passage for?"
        >
          {BUTTONS.map((b) => (
            <button
              key={b.tag}
              type="button"
              className={`tag-${b.tag}`}
              title={b.hint}
              onClick={() => mark(b.tag)}
            >
              {b.label}
            </button>
          ))}
          <button
            type="button"
            className="tag-comment"
            title="goes to your assistant — never printed"
            onClick={comment}
          >
            Comment
          </button>
          {/* The way out of a read-only surface, put where the gesture already
              is. A floating control on every paragraph was the first attempt
              and was wrong twice over: it appeared on hover, and an iPad has
              no hover — so on the one device this view is for it was either
              always visible, which is chrome on every paragraph of a book
              being read, or never. Dragging over the words is what a reader
              does anyway on seeing an errant full stop, so the offer belongs
              on that. */}
          <button type="button" className="reading-fix" onClick={fixHere}>
            Fix it here
          </button>
        </div>
      ) : null}

      {openRecord ? (
        <div className="reading-note" role="dialog" aria-label="A note on this passage">
          <div className="reading-note-what">
            {openRecord.kind === 'highlight'
              ? TAG_LABEL[openRecord.record.tag]
              : 'Comment — goes to your assistant, never printed'}
          </div>
          <blockquote>{openRecord.record.quote}</blockquote>
          <textarea
            autoFocus
            defaultValue={openRecord.record.text ?? ''}
            placeholder={
              openRecord.kind === 'highlight'
                ? 'Why this passage? (optional — the mark alone is enough)'
                : 'What should be done about it?'
            }
            onBlur={(e) => writeNote(e.target.value.trim())}
          />
          <div className="reading-note-actions">
            <button type="button" onClick={() => setOpenNote(null)}>
              Done
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                onChange(
                  openRecord.kind === 'highlight'
                    ? clearHighlight(edits, openRecord.record.highlightId)
                    : edits.filter(
                        (e) => e.kind !== 'memo' || e.memoId !== openRecord.record.memoId
                      )
                )
                setOpenNote(null)
              }}
            >
              Remove the mark
            </button>
            <button
              type="button"
              onClick={() => {
                const blockId = openRecord.record.blockId
                setOpenNote(null)
                onEditPassage(blockId)
              }}
            >
              Edit this passage
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * One passage, read-only, with its marks tinted.
 *
 * `dangerouslySetInnerHTML` is safe here for the reason it is safe in the
 * galley: `htmlWithSpans` builds on `htmlOfMarkup`, which escapes every
 * character that did not come out of its own tags.
 */
function PassageView({
  passage,
  title,
  spans,
  onOpenMark
}: {
  passage: Passage
  title: string | null
  spans: TextSpan[]
  onOpenMark: (id: string) => void
}): JSX.Element {
  const html = useMemo(() => htmlWithSpans(passage.text, spans), [passage.text, spans])
  const className =
    passage.kind === 'heading'
      ? `galley-heading level-${passage.level ?? 1}`
      : `galley-${passage.kind}`

  return (
    <div className="galley-passage reading-passage">
      {title ? <div className="galley-section-title">{title}</div> : null}
      {passage.label ? <div className="galley-label">{passage.label}</div> : null}
      <div
        data-passage={passage.id}
        className={`galley-block ${className}`}
        onClick={(e) => {
          const mark = (e.target as HTMLElement).closest('.reading-mark')
          const first = mark?.getAttribute('data-marks')?.split(' ')[0]
          if (first) onOpenMark(first)
        }}
        // Safe: every character not from htmlOfMarkup's own tags is escaped.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
