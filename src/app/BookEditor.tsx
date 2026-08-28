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
import { withMarkup } from '@core/transcribe'
import {
  htmlOfMarkup,
  markupOfNodes,
  memosOf,
  clearMemo,
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
    const body: Passage[] = doc.blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      text: withMarkup(b.text, b.emphasis, b.strong),
      ...(b.label ? { label: b.label } : {}),
      ...(b.level !== undefined ? { level: b.level } : {}),
      origin: { type: 'body' as const }
    }))
    return [...ofSection('front'), ...body, ...ofSection('back')]
  }, [doc])

  const sectionTitles = useMemo(() => {
    // The first passage of each division carries its title, shown above it.
    const out = new Map<string, { sectionId: string; title: string }>()
    for (const section of doc.sections) {
      const first = section.blocks[0]
      if (first) out.set(first.id, { sectionId: section.id, title: section.title })
    }
    return out
  }, [doc])

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

  const readonlyClass = (kind: BlockKind, level?: number): string => {
    if (kind === 'heading') return `galley-block galley-heading level-${level ?? 1}`
    return `galley-block galley-${kind}`
  }

  if (passages.length === 0) {
    return <div className="galley empty">There is no text to edit.</div>
  }

  return (
    <div className="galley">
      <div className="galley-bar">
        <span className="galley-hint">
          Click into a passage to edit it. Enter breaks a paragraph; everything downstream reflows.
          Italic and bold are content; size and spacing belong to the design.
        </span>
        {openMemoCount > 0 ? (
          <span className="galley-memo-count">
            {openMemoCount} note{openMemoCount === 1 ? '' : 's'} for the assistant
          </span>
        ) : null}
      </div>

      <div className="galley-page">
        {passages.map((passage) => {
          const heading = sectionTitles.get(passage.id)
          const isActive = active?.id === passage.id
          const memos = memosByBlock.get(passage.id) ?? []
          const notes = notesByBlock.get(passage.id) ?? []

          return (
            <div key={passage.id} className="galley-passage">
              {heading ? <div className="galley-section-title">{heading.title}</div> : null}
              {passage.label ? <div className="galley-label">{passage.label}</div> : null}

              {isActive ? (
                <div className="galley-active">
                  <div className="galley-tools">
                    {passage.origin.type === 'body' ? (
                      <select
                        value={passage.kind}
                        aria-label="What this is"
                        onChange={(e) => {
                          // What was typed commits first, or retyping the kind
                          // would re-seed the editor over unsaved words.
                          commitActive(passage)
                          push({
                            kind: 'retype',
                            blockId: passage.id,
                            blockKind: e.target.value as BlockKind,
                            ...(e.target.value === 'heading' ? { level: passage.level ?? 1 } : {})
                          })
                        }}
                      >
                        {KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="galley-kind-note">your own writing</span>
                    )}
                    {!editsAsPlainText(passage.kind) ? (
                      <>
                        <button
                          type="button"
                          title="Italic — as the book prints it"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => document.execCommand('italic')}
                        >
                          <i>I</i>
                        </button>
                        <button
                          type="button"
                          title="Bold — a glossary headword, a heading word"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => document.execCommand('bold')}
                        >
                          <b>B</b>
                        </button>
                      </>
                    ) : null}
                    {passage.origin.type === 'body' ? (
                      <button
                        type="button"
                        title="A footnote of your own at the cursor — printed at the foot of its page"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addFootnote(passage)}
                      >
                        Footnote
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title="A note for the assistant at the cursor — never printed"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => leaveMemo(passage)}
                    >
                      For the assistant
                    </button>
                    {passage.origin.type === 'body' ? (
                      <button
                        type="button"
                        title="Not part of the book"
                        onClick={() => {
                          setActive(null)
                          push({ kind: 'drop', blockId: passage.id })
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="galley-done"
                      onClick={() => {
                        commitActive(passage)
                        setActive(null)
                      }}
                    >
                      Done
                    </button>
                  </div>

                  {editsAsPlainText(passage.kind) ? (
                    <textarea
                      className={`galley-editable galley-plain galley-${passage.kind}`}
                      defaultValue={passage.text}
                      autoFocus
                      rows={Math.max(3, passage.text.split('\n').length + 1)}
                      aria-label={`Text of ${passage.id}`}
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
                        // Clicking the toolbar keeps the passage open; leaving
                        // for anywhere else commits it.
                        const next = e.relatedTarget as Node | null
                        if (next && e.currentTarget.closest('.galley-active')?.contains(next)) {
                          return
                        }
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
              ) : (
                <div
                  className={`galley-readonly ${readonlyClass(passage.kind, passage.level)}`}
                  onMouseDown={(e) => {
                    // The default action would move focus to the body *after*
                    // the effect below focuses the freshly-mounted editable —
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
                        onChange(edits.filter((e) => e.kind !== 'note' || e.noteId !== note.noteId))
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
                <div key={memo.memoId} className={`galley-memo${memo.resolved ? ' resolved' : ''}`}>
                  <span className="proof-annotation-bar">
                    <span className="proof-annotation-label">
                      {memo.resolved
                        ? 'For the assistant — answered'
                        : `For the assistant, at “${snippet(passage.text, memo.at)}” — never printed`}
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
                      placeholder="What should the assistant look at here? This never reaches the printed book."
                      aria-label="Note for the assistant"
                      onChange={(e) => push({ ...memo, text: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
