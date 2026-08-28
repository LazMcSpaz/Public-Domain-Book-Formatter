/**
 * The book as a book: one scrolling column, click into a passage and type.
 *
 * The proof sheet is the right shape for checking a transcription against the
 * paper — one leaf beside its scan. This is the other job, working on the book
 * as prose: the whole volume in reading order (divisions set before the body,
 * the body, divisions after), set in a book face, with italic shown as italic.
 * It is a second door onto the same edit list, never a second document: every
 * change commits as exactly the `BookEdit` the proof sheet produces, through
 * the same `withEdit`, so the two views cannot disagree about what the book is.
 *
 * What it deliberately does not offer — the container-box disease this app
 * exists to escape: no manual line break (Enter is a *paragraph* break, the
 * `split` edit; a pasted `<br>` commits as a space), no page break, no
 * per-block font size or spacing. Presentation belongs to the block's kind and
 * the style profile, which set every block of a kind at once.
 *
 * Only the passage being edited is a `contenteditable`; everything else is
 * cheap read-only markup, which is what lets a three-hundred-page book scroll
 * as one column without putting hundreds of editors in the DOM. The editable
 * is uncontrolled while focused — React must not re-render what the caret is
 * standing in — and commits on blur, Enter, or the toolbar's Done.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BookDocument } from '@core/assemble'
import type { BlockKind } from '@core/transcribe'
import { withMarkup, wordCount } from '@core/transcribe'
import {
  findMatches,
  htmlOfMarkup,
  markupOfNodes,
  memosOf,
  clearMemo,
  sweepText,
  withEdit,
  type BookEdit,
  type MemoEdit
} from '@core/edits'

export interface BookEditorProps {
  /** The book as it stands — `applyEdits` output, sections and all. */
  document: BookDocument
  edits: BookEdit[]
  onChange: (edits: BookEdit[]) => void
}

/**
 * One editable unit of the column.
 *
 * A body passage is a real block and edits target its id. A section passage is
 * one paragraph of a division the editor wrote: its block exists only in the
 * assembled document, so editing it rewrites the owning `section` edit's text
 * at that paragraph's index instead.
 */
interface Passage {
  id: string
  kind: BlockKind
  /** Current text, markup on — the string an edit must be written in terms of. */
  text: string
  label?: string
  level?: number
  origin: { type: 'body' } | { type: 'section'; sectionId: string; index: number }
}

const KINDS: { value: BlockKind; label: string }[] = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'heading', label: 'Heading' },
  { value: 'blockquote', label: 'Quotation' },
  { value: 'verse', label: 'Verse' },
  { value: 'epigraph', label: 'Epigraph' },
  { value: 'caption', label: 'Caption' },
  { value: 'list-item', label: 'List item' },
  { value: 'table', label: 'Table' }
]

/** Verse and tables carry meaningful newlines, which a contenteditable would eat. */
const editsAsPlainText = (kind: BlockKind): boolean => kind === 'verse' || kind === 'table'

/** The paragraphs of a section's raw text, exactly as `paragraphsOf` derives them. */
const partsOf = (text: string): string[] =>
  text
    .split(/\n\s*\n/u)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => part.length > 0)

/** Plain-text caret offset of the current selection inside `root`. */
function caretOffset(root: HTMLElement): number {
  const sel = root.ownerDocument.defaultView?.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return 0
  const pre = range.cloneRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length
}

/** Put the caret at a plain-text offset inside `root`. */
function setCaret(root: HTMLElement, offset: number): void {
  const sel = root.ownerDocument.defaultView?.getSelection()
  if (!sel) return
  let remaining = offset
  const walk = (node: Node): boolean => {
    if (node.nodeType === 3) {
      const length = node.nodeValue?.length ?? 0
      if (remaining <= length) {
        sel.collapse(node, remaining)
        return true
      }
      remaining -= length
      return false
    }
    for (const child of Array.from(node.childNodes)) if (walk(child)) return true
    return false
  }
  if (!walk(root)) sel.collapse(root, root.childNodes.length)
}

/**
 * Where in a passage's plain text a click landed, so opening it for editing
 * puts the caret under the pointer rather than at the start.
 */
function offsetAtPoint(root: HTMLElement, x: number, y: number): number {
  const doc = root.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let offset = 0
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(x, y)
    if (position) {
      node = position.offsetNode
      offset = position.offset
    }
  }
  if (!node || !root.contains(node)) return 0
  const range = doc.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

/** The last few words before a point, so a memo chip can say where it sits. */
function snippet(text: string, at: number): string {
  const before = text.slice(0, Math.max(0, Math.min(text.length, at))).trimEnd()
  const words = before.split(/\s+/u).filter(Boolean).slice(-4).join(' ')
  return words.length > 0 ? `…${words}` : 'the start'
}

const mintId = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`

export function BookEditor({ document: doc, edits, onChange }: BookEditorProps): JSX.Element {
  /** The passage open for editing, and the caret to restore when it mounts. */
  const [active, setActive] = useState<{ id: string; caret: number } | null>(null)
  const editableRef = useRef<HTMLDivElement | null>(null)

  /** Find & replace: what is being looked for, and where the walk stands. */
  const [find, setFind] = useState<{
    open: boolean
    query: string
    replace: string
    matchCase: boolean
    /** Index of the match last jumped to; -1 before the first jump. */
    cursor: number
    /** How many the last Replace All landed, shown until the query changes. */
    replaced?: number
  }>({ open: false, query: '', replace: '', matchCase: false, cursor: -1 })

  /** The passage briefly highlighted after a jump, so the eye lands with it. */
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (id: string): void => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlashId(id)
    flashTimer.current = setTimeout(() => setFlashId(null), 1400)
  }

  /** The division whose title is being renamed, if any. */
  const [editingTitle, setEditingTitle] = useState<string | null>(null)

  const passages = useMemo(() => {
    const ofSection = (placement: 'front' | 'back'): Passage[] =>
      doc.sections
        .filter((s) => s.placement === placement)
        .flatMap((s) =>
          s.blocks.map((b, index) => ({
            id: b.id,
            kind: b.kind,
            text: withMarkup(b.text, b.emphasis, b.strong),
            origin: { type: 'section' as const, sectionId: s.id, index }
          }))
        )
    // A division with nothing written yet has no blocks in the document — the
    // engine refuses to set an empty one — so a freshly added introduction
    // would be invisible here, with nowhere to type its first word. It gets a
    // placeholder passage, sourced from its own record.
    const inDoc = new Set(doc.sections.map((s) => s.id))
    const placeholders = (placement: 'front' | 'back'): Passage[] =>
      edits
        .filter(
          (e): e is BookEdit & { kind: 'section' } =>
            e.kind === 'section' && e.placement === placement && !inDoc.has(e.sectionId)
        )
        .map((e) => ({
          id: `${e.sectionId}/b0`,
          kind: 'paragraph' as const,
          text: '',
          origin: { type: 'section' as const, sectionId: e.sectionId, index: 0 }
        }))
    const body: Passage[] = doc.blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      text: withMarkup(b.text, b.emphasis, b.strong),
      ...(b.label ? { label: b.label } : {}),
      ...(b.level !== undefined ? { level: b.level } : {}),
      origin: { type: 'body' as const }
    }))
    return [
      ...ofSection('front'),
      ...placeholders('front'),
      ...body,
      ...ofSection('back'),
      ...placeholders('back')
    ]
  }, [doc, edits])

  const sectionTitles = useMemo(() => {
    // The first passage of each division carries its title, shown above it.
    const out = new Map<string, { sectionId: string; title: string }>()
    for (const section of doc.sections) {
      const first = section.blocks[0]
      if (first) out.set(first.id, { sectionId: section.id, title: section.title })
    }
    const inDoc = new Set(doc.sections.map((s) => s.id))
    for (const e of edits) {
      if (e.kind === 'section' && !inDoc.has(e.sectionId)) {
        out.set(`${e.sectionId}/b0`, { sectionId: e.sectionId, title: e.title })
      }
    }
    return out
  }, [doc, edits])

  /**
   * The outline, for a column that is otherwise one long scroll: divisions set
   * before the body, the chapters, divisions after — the same list the
   * contents page is built from, so it cannot disagree with the book.
   */
  const outline = useMemo(() => {
    const entries: { id: string; label: string; kind: 'division' | 'chapter' }[] = []
    for (const s of doc.sections.filter((x) => x.placement === 'front')) {
      const first = s.blocks[0]
      if (first) entries.push({ id: first.id, label: s.title, kind: 'division' })
    }
    for (const c of doc.chapters) {
      entries.push({
        id: c.id,
        label: c.label ? `${c.label} · ${c.title}` : c.title,
        kind: 'chapter'
      })
    }
    for (const s of doc.sections.filter((x) => x.placement === 'back')) {
      const first = s.blocks[0]
      if (first) entries.push({ id: first.id, label: s.title, kind: 'division' })
    }
    return entries
  }, [doc])

  const words = useMemo(() => passages.reduce((n, p) => n + wordCount(p.text), 0), [passages])

  /** The one toolbar, so a blur into it must not close the passage it acts on. */
  const toolbarRef = useRef<HTMLDivElement | null>(null)

  const jumpTo = (id: string): void => {
    document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Every place the query occurs, passage by passage, in reading order. */
  const matches = useMemo(() => {
    if (!find.open || find.query.length === 0) return []
    const out: { passageId: string; context: string }[] = []
    for (const p of passages) {
      for (const m of findMatches(p.text, find.query, find.matchCase)) {
        out.push({ passageId: p.id, context: m.context })
      }
    }
    return out
  }, [passages, find.open, find.query, find.matchCase])

  const goToMatch = (delta: number): void => {
    if (matches.length === 0) return
    const from = find.cursor === -1 && delta < 0 ? 0 : find.cursor
    const next = (((from + delta) % matches.length) + matches.length) % matches.length
    setFind((f) => ({ ...f, cursor: next }))
    const m = matches[next]!
    jumpTo(m.passageId)
    flash(m.passageId)
  }

  /**
   * Replace every match, as one change.
   *
   * A batch of the same records a hand edit produces — `text` edits for body
   * passages, a rewritten record for each division — handed over in a single
   * `onChange`, so the whole sweep is one undo step and one autosave.
   */
  const replaceAll = (): void => {
    if (find.query.length === 0) return
    let next = edits
    const sectionsDone = new Set<string>()
    let total = 0
    for (const p of passages) {
      if (p.origin.type === 'body') {
        const swept = sweepText(p.text, find.query, find.replace, find.matchCase)
        if (swept.count === 0) continue
        next = withEdit(next, { kind: 'text', blockId: p.id, text: swept.text })
        total += swept.count
      } else if (!sectionsDone.has(p.origin.sectionId)) {
        sectionsDone.add(p.origin.sectionId)
        const section = sectionEditOf(p.origin.sectionId)
        if (!section) continue
        // The whole record at once rather than paragraph by paragraph, so a
        // division is rewritten exactly once however many parts matched.
        const swept = sweepText(section.text, find.query, find.replace, find.matchCase)
        if (swept.count === 0) continue
        next = withEdit(next, { ...section, text: swept.text })
        total += swept.count
      }
    }
    if (next !== edits) onChange(next)
    setFind((f) => ({ ...f, cursor: -1, replaced: total }))
  }

  /** A fresh division, ready to be written into right here. */
  const addSection = (placement: 'front' | 'back'): void => {
    onChange([
      ...edits,
      {
        kind: 'section',
        sectionId: mintId('sec'),
        placement,
        title: placement === 'front' ? 'Introduction' : 'Afterword',
        text: ''
      }
    ])
  }

  const renameSection = (sectionId: string, title: string): void => {
    setEditingTitle(null)
    const section = sectionEditOf(sectionId)
    if (!section || title.trim().length === 0 || title === section.title) return
    push({ ...section, title: title.trim() })
  }

  const memosByBlock = useMemo(() => {
    const out = new Map<string, MemoEdit[]>()
    for (const memo of memosOf(edits)) {
      const list = out.get(memo.blockId) ?? []
      list.push(memo)
      out.set(memo.blockId, list)
    }
    for (const list of out.values()) list.sort((a, b) => a.at - b.at)
    return out
  }, [edits])

  const notesByBlock = useMemo(() => {
    const out = new Map<string, (BookEdit & { kind: 'note' })[]>()
    for (const edit of edits) {
      if (edit.kind !== 'note') continue
      const list = out.get(edit.blockId) ?? []
      list.push(edit)
      out.set(edit.blockId, list)
    }
    for (const list of out.values()) list.sort((a, b) => a.at - b.at)
    return out
  }, [edits])

  const openMemoCount = memosOf(edits).filter((m) => !m.resolved).length

  const push = (edit: BookEdit): void => onChange(withEdit(edits, edit))

  /** The owning `section` edit of a section passage — it holds the raw text. */
  const sectionEditOf = (sectionId: string): (BookEdit & { kind: 'section' }) | undefined =>
    edits.find(
      (e): e is BookEdit & { kind: 'section' } => e.kind === 'section' && e.sectionId === sectionId
    )

  /** Rewrite one paragraph of a division, in the blob the division travels as. */
  const rewriteSectionPart = (
    origin: { sectionId: string; index: number },
    change: (parts: string[]) => void
  ): void => {
    const section = sectionEditOf(origin.sectionId)
    if (!section) return
    const parts = partsOf(section.text)
    change(parts)
    push({ ...section, text: parts.join('\n\n') })
  }

  /** What the editable currently holds, as the notation an edit is written in. */
  const committedMarkup = (kind: BlockKind): string | null => {
    const root = editableRef.current
    if (!root) return null
    if (editsAsPlainText(kind)) {
      // Verse and tables edit in a textarea, read directly where they commit.
      return null
    }
    return markupOfNodes(root.childNodes).replace(/\s+/gu, ' ').trim()
  }

  const commitText = (passage: Passage, markup: string): void => {
    if (markup === passage.text) return
    if (passage.origin.type === 'body') {
      push({ kind: 'text', blockId: passage.id, text: markup })
      return
    }
    const { sectionId, index } = passage.origin
    rewriteSectionPart({ sectionId, index }, (parts) => {
      if (markup.trim().length === 0) parts.splice(index, 1)
      else parts[index] = markup
    })
  }

  const commitActive = (passage: Passage): void => {
    const markup = committedMarkup(passage.kind)
    if (markup !== null) commitText(passage, markup)
  }

  /** Enter: commit what is typed, then break the paragraph at the caret. */
  const splitAtCaret = (passage: Passage): void => {
    const root = editableRef.current
    if (!root) return
    const at = caretOffset(root)
    const markup = committedMarkup(passage.kind)
    if (markup === null) return
    const plainBefore = (root.textContent ?? '').slice(0, at).replace(/\s+/gu, ' ').trimStart()
    if (passage.origin.type === 'body') {
      let next = withEdit(edits, { kind: 'text', blockId: passage.id, text: markup })
      // Not collapsed by `withEdit`: two splits of one paragraph are two
      // corrections, and the offset is into the text just committed.
      next = [...next, { kind: 'split', blockId: passage.id, at: plainBefore.length }]
      onChange(next)
      setActive(null)
      return
    }
    const { sectionId, index } = passage.origin
    // In a division the paragraph break is the blob's own convention: a blank
    // line. The plain text has no tags, so the split point is found in the
    // committed markup by word count rather than by character.
    const words = markup.split(/\s+/u).filter((w) => w.length > 0)
    const wordsBefore =
      plainBefore.length === 0 ? 0 : plainBefore.split(/\s+/u).filter((w) => w.length > 0).length
    if (wordsBefore <= 0 || wordsBefore >= words.length) {
      commitText(passage, markup)
      setActive(null)
      return
    }
    rewriteSectionPart({ sectionId, index }, (parts) => {
      parts.splice(
        index,
        1,
        words.slice(0, wordsBefore).join(' '),
        words.slice(wordsBefore).join(' ')
      )
    })
    setActive(null)
  }

  /** Backspace at the very start: join this passage onto the one before it. */
  const mergeIntoPrevious = (passage: Passage): void => {
    if (passage.origin.type === 'body') {
      const index = doc.blocks.findIndex((b) => b.id === passage.id)
      if (index <= 0) return
      const markup = committedMarkup(passage.kind)
      let next = edits
      if (markup !== null && markup !== passage.text) {
        next = withEdit(next, { kind: 'text', blockId: passage.id, text: markup })
      }
      onChange([...next, { kind: 'merge', blockId: doc.blocks[index - 1]!.id }])
      setActive(null)
      return
    }
    const { sectionId, index } = passage.origin
    if (index <= 0) return
    const markup = committedMarkup(passage.kind) ?? passage.text
    rewriteSectionPart({ sectionId, index }, (parts) => {
      parts.splice(index - 1, 2, `${parts[index - 1]} ${markup}`.replace(/\s+/gu, ' ').trim())
    })
    setActive(null)
  }

  const leaveMemo = (passage: Passage): void => {
    const root = editableRef.current
    const at = root ? caretOffset(root) : 0
    onChange([
      ...edits,
      {
        kind: 'memo',
        // Minted from the clock so an id is never reused after one is cleared.
        memoId: mintId('mm'),
        blockId: passage.id,
        at,
        text: ''
      }
    ])
  }

  const addFootnote = (passage: Passage): void => {
    const root = editableRef.current
    const at = root ? caretOffset(root) : 0
    onChange([...edits, { kind: 'note', noteId: mintId('ed'), blockId: passage.id, at, text: '' }])
  }

  // Seed the editable when a passage opens, and put the caret where the click
  // landed. The content is written once here and never re-rendered while the
  // user types — React re-painting a contenteditable resets the caret.
  const activePassage = active ? (passages.find((p) => p.id === active.id) ?? null) : null
  useEffect(() => {
    const root = editableRef.current
    if (!root || !activePassage) return
    if (!editsAsPlainText(activePassage.kind)) {
      root.innerHTML = htmlOfMarkup(activePassage.text)
    }
    root.focus()
    if (!editsAsPlainText(activePassage.kind)) setCaret(root, active?.caret ?? 0)
    // Keyed on the passage's id alone, deliberately: re-seeding on every
    // keystroke's re-render would reset the caret the user is typing at.
  }, [active?.id])

  // Ctrl+H opens find & replace, the shortcut a word-processor user reaches
  // for. Ctrl+F is left to the browser on purpose: the whole book is one
  // page, so native find genuinely works here, highlights and all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setFind((f) => ({ ...f, open: true }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const readonlyClass = (kind: BlockKind, level?: number): string => {
    if (kind === 'heading') return `galley-block galley-heading level-${level ?? 1}`
    return `galley-block galley-${kind}`
  }

  if (passages.length === 0) {
    return <div className="galley empty">There is no text to edit.</div>
  }

  const bodyActive = activePassage !== null && activePassage.origin.type === 'body'
  const richActive = activePassage !== null && !editsAsPlainText(activePassage.kind)

  return (
    <div className="galley">
      <div className="galley-bar">
        <span className="galley-hint">
          Click into a passage and type, as in any document. Enter starts a new paragraph and the
          whole book reflows — line and page breaks are the design&rsquo;s to decide, so italic and
          bold are yours here and size and spacing are not. Ctrl+F finds text anywhere: the whole
          book is on this one page.
        </span>
        <span className="galley-counts">
          {openMemoCount > 0 ? (
            <span className="galley-memo-count">
              {openMemoCount} comment{openMemoCount === 1 ? '' : 's'} for your assistant
            </span>
          ) : null}
          <span className="galley-words">{words.toLocaleString()} words</span>
        </span>
      </div>

      {/* One toolbar at the top, where a word processor keeps it, acting on
          whichever passage is open. Every button that must not steal focus
          from the editable prevents its own mousedown. */}
      <div className="galley-toolbar" ref={toolbarRef}>
        <select
          value={bodyActive ? activePassage!.kind : 'paragraph'}
          disabled={!bodyActive}
          aria-label="Paragraph style"
          title="Paragraph style — how every passage of this kind is set"
          onChange={(e) => {
            if (!activePassage) return
            // What was typed commits first, or restyling would re-seed the
            // editor over unsaved words.
            commitActive(activePassage)
            push({
              kind: 'retype',
              blockId: activePassage.id,
              blockKind: e.target.value as BlockKind,
              ...(e.target.value === 'heading' ? { level: activePassage.level ?? 1 } : {})
            })
          }}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!richActive}
          title="Italic (Ctrl+I) — as the book prints it"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => document.execCommand('italic')}
        >
          <i>I</i>
        </button>
        <button
          type="button"
          disabled={!richActive}
          title="Bold (Ctrl+B) — a glossary headword, a heading word"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => document.execCommand('bold')}
        >
          <b>B</b>
        </button>
        <button
          type="button"
          disabled={!bodyActive}
          title="A footnote of your own at the cursor — printed at the foot of its page"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => activePassage && addFootnote(activePassage)}
        >
          Footnote
        </button>
        <button
          type="button"
          disabled={activePassage === null}
          title="A comment at the cursor — it goes to your assistant and is never printed"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => activePassage && leaveMemo(activePassage)}
        >
          Comment
        </button>
        <button
          type="button"
          disabled={!bodyActive}
          title="Not part of the book"
          onClick={() => {
            if (!activePassage) return
            const dropped = activePassage
            setActive(null)
            push({ kind: 'drop', blockId: dropped.id })
          }}
        >
          Remove
        </button>
        <button
          type="button"
          title="Find & replace across the whole book (Ctrl+H)"
          onClick={() => setFind((f) => ({ ...f, open: !f.open }))}
        >
          Find &amp; replace
        </button>
        <button
          type="button"
          className="galley-done"
          disabled={activePassage === null}
          onClick={() => {
            if (activePassage) commitActive(activePassage)
            setActive(null)
          }}
        >
          Done
        </button>
        {activePassage === null ? (
          <span className="galley-toolbar-note">Click a passage to edit it</span>
        ) : null}
      </div>

      {find.open ? (
        <div className="galley-findbar">
          <input
            type="text"
            value={find.query}
            placeholder="Find in the book"
            aria-label="Find in the book"
            autoFocus
            onChange={(e) =>
              setFind((f) => {
                const { replaced: _replaced, ...rest } = f
                return { ...rest, query: e.target.value, cursor: -1 }
              })
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') goToMatch(e.shiftKey ? -1 : 1)
            }}
          />
          <input
            type="text"
            value={find.replace}
            placeholder="Replace with"
            aria-label="Replace with"
            onChange={(e) => setFind((f) => ({ ...f, replace: e.target.value }))}
          />
          <label className="galley-find-case">
            <input
              type="checkbox"
              checked={find.matchCase}
              onChange={(e) => setFind((f) => ({ ...f, matchCase: e.target.checked, cursor: -1 }))}
            />
            Match case
          </label>
          <span className="galley-find-count">
            {find.replaced !== undefined
              ? `Replaced ${find.replaced}`
              : find.query.length === 0
                ? ''
                : matches.length === 0
                  ? 'No matches'
                  : `${matches.length} match${matches.length === 1 ? '' : 'es'}`}
          </span>
          <button type="button" disabled={matches.length === 0} onClick={() => goToMatch(-1)}>
            ‹
          </button>
          <button type="button" disabled={matches.length === 0} onClick={() => goToMatch(1)}>
            ›
          </button>
          <button type="button" disabled={matches.length === 0} onClick={replaceAll}>
            Replace all
          </button>
          <button
            type="button"
            title="Close"
            onClick={() => setFind((f) => ({ ...f, open: false }))}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="galley-body">
        {outline.length > 0 ? (
          <nav className="galley-outline" aria-label="Book outline">
            {outline.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`galley-outline-${entry.kind}`}
                onClick={() => jumpTo(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="galley-page">
          {passages.map((passage) => {
            const heading = sectionTitles.get(passage.id)
            const isActive = active?.id === passage.id
            const memos = memosByBlock.get(passage.id) ?? []
            const notes = notesByBlock.get(passage.id) ?? []

            return (
              <div
                key={passage.id}
                id={`g-${passage.id}`}
                className={`galley-passage${flashId === passage.id ? ' flash' : ''}`}
              >
                {heading ? (
                  editingTitle === heading.sectionId ? (
                    <input
                      type="text"
                      className="galley-section-title-input"
                      defaultValue={heading.title}
                      autoFocus
                      aria-label="Title of this division"
                      onBlur={(e) => renameSection(heading.sectionId, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setEditingTitle(null)
                      }}
                    />
                  ) : (
                    <div
                      className="galley-section-title"
                      title="Click to rename this division"
                      onClick={() => setEditingTitle(heading.sectionId)}
                    >
                      {heading.title}
                    </div>
                  )
                ) : null}
                {passage.label ? <div className="galley-label">{passage.label}</div> : null}

                {isActive ? (
                  <div className="galley-active">
                    {editsAsPlainText(passage.kind) ? (
                      <textarea
                        className={`galley-editable galley-plain galley-${passage.kind}`}
                        defaultValue={passage.text}
                        autoFocus
                        rows={Math.max(3, passage.text.split('\n').length + 1)}
                        aria-label={`Text of ${passage.id}`}
                        onKeyDown={(e) => {
                          if (
                            (e.ctrlKey || e.metaKey) &&
                            !e.altKey &&
                            e.key.toLowerCase() === 's'
                          ) {
                            commitText(passage, e.currentTarget.value.replace(/\n+$/u, ''))
                          }
                        }}
                        onBlur={(e) => commitText(passage, e.target.value.replace(/\n+$/u, ''))}
                      />
                    ) : (
                      <div
                        ref={editableRef}
                        className={`galley-editable ${readonlyClass(passage.kind, passage.level)}`}
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck
                        role="textbox"
                        aria-label={`Text of ${passage.id}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            splitAtCaret(passage)
                            return
                          }
                          if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'm') {
                            // Docs' comment shortcut, honoured here.
                            e.preventDefault()
                            leaveMemo(passage)
                            return
                          }
                          if (
                            (e.ctrlKey || e.metaKey) &&
                            !e.altKey &&
                            e.key.toLowerCase() === 's'
                          ) {
                            // What is being typed commits, then the event
                            // reaches the window listener that saves — a
                            // Ctrl+S that left the open passage behind would
                            // claim saved for words that were not.
                            commitActive(passage)
                            return
                          }
                          if (
                            e.key === 'Backspace' &&
                            editableRef.current &&
                            caretOffset(editableRef.current) === 0 &&
                            (editableRef.current.ownerDocument.defaultView?.getSelection()
                              ?.isCollapsed ??
                              true)
                          ) {
                            e.preventDefault()
                            mergeIntoPrevious(passage)
                          }
                        }}
                        onBlur={(e) => {
                          // Leaving for the toolbar keeps the passage open — it
                          // is about to act on it; leaving for anywhere else
                          // commits it.
                          const next = e.relatedTarget as Node | null
                          if (next && (toolbarRef.current?.contains(next) ?? false)) return
                          commitActive(passage)
                          // Functional, because a mousedown on another passage
                          // has already queued that passage as active and this
                          // blur lands after it — clearing unconditionally would
                          // close the passage the user just clicked into.
                          setActive((cur) => (cur && cur.id !== passage.id ? cur : null))
                        }}
                      />
                    )}
                  </div>
                ) : passage.text.length === 0 ? (
                  // A division with nothing written yet. The placeholder is
                  // chrome, not content — it renders as an invitation and
                  // commits as nothing.
                  <div
                    className="galley-readonly galley-block galley-placeholder"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      if (activePassage) commitActive(activePassage)
                      setActive({ id: passage.id, caret: 0 })
                    }}
                  >
                    Write here — this division is still empty.
                  </div>
                ) : (
                  <div
                    className={`galley-readonly ${readonlyClass(passage.kind, passage.level)}`}
                    onMouseDown={(e) => {
                      // The default action would move focus to the body *after*
                      // the effect above focuses the freshly-mounted editable —
                      // blurring it, which commits and closes the passage the
                      // same instant it opened. Measured, not hypothetical: the
                      // event trace is mousedown → focusin → focusout.
                      e.preventDefault()
                      const at = offsetAtPoint(e.currentTarget, e.clientX, e.clientY)
                      // Commit whatever passage was open before switching.
                      if (activePassage) commitActive(activePassage)
                      setActive({ id: passage.id, caret: at })
                    }}
                    // Safe: `htmlOfMarkup` escapes everything but its own <i>/<b>.
                    dangerouslySetInnerHTML={{ __html: htmlOfMarkup(passage.text) }}
                  />
                )}

                {notes.map((note) => (
                  <div key={note.noteId} className="proof-annotation galley-note">
                    <span className="proof-annotation-bar">
                      <span className="proof-annotation-label">
                        Your footnote, after “{snippet(passage.text, note.at)}”
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onChange(
                            edits.filter((e) => e.kind !== 'note' || e.noteId !== note.noteId)
                          )
                        }
                      >
                        Remove
                      </button>
                    </span>
                    <textarea
                      value={note.text}
                      spellCheck
                      rows={2}
                      placeholder="Your note — set at the foot of the page this falls on."
                      aria-label="Your footnote"
                      onChange={(e) => push({ ...note, text: e.target.value })}
                    />
                  </div>
                ))}

                {memos.map((memo) => (
                  <div
                    key={memo.memoId}
                    className={`galley-memo${memo.resolved ? ' resolved' : ''}`}
                  >
                    <span className="proof-annotation-bar">
                      <span className="proof-annotation-label">
                        {memo.resolved
                          ? 'Comment — answered by your assistant'
                          : `Comment for your assistant, at “${snippet(passage.text, memo.at)}” — never printed`}
                      </span>
                      <button type="button" onClick={() => onChange(clearMemo(edits, memo.memoId))}>
                        {memo.resolved ? 'Clear' : 'Withdraw'}
                      </button>
                    </span>
                    {memo.resolved ? (
                      <>
                        <p className="galley-memo-ask">“{memo.text}”</p>
                        <p className="galley-memo-outcome">{memo.resolved}</p>
                      </>
                    ) : (
                      <textarea
                        value={memo.text}
                        spellCheck
                        rows={2}
                        placeholder="What should your assistant look at here? Comments never reach the printed book."
                        aria-label="Comment for your assistant"
                        onChange={(e) => push({ ...memo, text: e.target.value })}
                      />
                    )}
                  </div>
                ))}
              </div>
            )
          })}

          {/* Where a document ends is where a Docs user looks for "add more".
              An introduction or an afterword is set as a division of the book,
              listed in the contents — the same records the sheet's buttons
              make. */}
          <div className="galley-add">
            <button type="button" onClick={() => addSection('front')}>
              ＋ Write an introduction
            </button>
            <button type="button" onClick={() => addSection('back')}>
              ＋ Write an afterword
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
