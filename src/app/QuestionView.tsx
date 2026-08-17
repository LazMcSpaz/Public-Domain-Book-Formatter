/**
 * Renders whatever a wizard step asks for.
 *
 * This component knows nothing about *which* questions exist — it renders the
 * `Question` data a step emits. That's the whole point of the contract: adding
 * a question later needs no new UI code here.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Question, AnswerValue, TermVerdict, DiscrepancyVerdict, Evidence } from '@core/wizard'
import { Lightbox } from './Lightbox'

interface Props {
  question: Question
  value: AnswerValue | undefined
  onChange: (value: AnswerValue) => void
  /** Resolves an evidence src like `page:3` to a displayable URL. */
  resolveEvidence?: (src: string) => string | undefined
  /**
   * A version of the same evidence big enough to read, made on demand.
   *
   * The thumbnail beside a question is 150 pixels wide, which is enough to know
   * *which* page it is and nowhere near enough to check a transcription against.
   * Rendering every leaf at readable size up front would be hundreds of
   * megabytes for a book, so it is done when the user asks to see one.
   */
  enlargeEvidence?: (src: string) => Promise<string | undefined>
  /**
   * Cut these words out of a leaf's scan, for the discrepancy grid.
   *
   * Async and by the handful, because unlike Gate 1's term crops these are not
   * pre-made: which words a cross-check calls missing is not known until the
   * vision pass has run. One call per leaf renders that leaf once; the returned
   * URLs are the caller's to revoke.
   */
  cropWords?: (
    pageIndex: number,
    groups: readonly { id: string; tokenIds: readonly string[] }[]
  ) => Promise<Map<string, string>>
}

/** A scan opened full size, and where it came from. */
interface Enlarged {
  src: string
  caption: string
  loading: boolean
}

function EvidenceView({
  items,
  resolve,
  onOpen
}: {
  items?: Evidence[]
  resolve?: (src: string) => string | undefined
  onOpen?: (src: string, caption: string) => void
}): JSX.Element | null {
  if (!items?.length) return null
  // Evidence that includes a passage of text needs room to be read, and so does
  // the scan beside it. A word crop at Gate 1 does not — it is one word — so
  // the wider layout is asked for rather than assumed.
  const readable = items.some((e) => e.kind === 'text')
  return (
    <div className={readable ? 'q-evidence readable' : 'q-evidence'}>
      {items.map((e, i) => {
        if (e.kind === 'image') {
          const src = resolve?.(e.src) ?? e.src
          if (!src.startsWith('blob:') && !src.startsWith('data:') && !src.startsWith('/')) {
            return null // unresolved placeholder — show nothing rather than a broken image
          }
          // A button rather than a clickable image: this is the only way to see
          // the scan at a size it can be read at, so it has to be reachable
          // from a keyboard and announce itself as something to press.
          return (
            <figure key={i} style={{ margin: 0 }}>
              {onOpen ? (
                <button
                  type="button"
                  className="evidence-open"
                  title="See it full size"
                  onClick={() => onOpen(e.src, e.alt)}
                >
                  <img src={src} alt={e.alt} />
                  <span className="evidence-zoom" aria-hidden="true">
                    ⤢
                  </span>
                </button>
              ) : (
                <img src={src} alt={e.alt} />
              )}
              <figcaption>{e.alt}</figcaption>
            </figure>
          )
        }
        if (e.kind === 'text') {
          return (
            <figure key={i} style={{ margin: 0 }}>
              <pre>{e.text}</pre>
              {e.label ? <figcaption>{e.label}</figcaption> : null}
            </figure>
          )
        }
        return (
          <figure key={i} style={{ margin: 0 }}>
            <img src={e.src} alt={e.caption} />
            <figcaption>{e.caption}</figcaption>
          </figure>
        )
      })}
    </div>
  )
}

/** Where a hovered word crop's wider cutting should appear, in viewport space. */
interface Peek {
  src: string
  alt: string
  left: number
  top: number
}

/**
 * The wider cutting of a word, shown beside the pointer.
 *
 * Through a portal, and positioned in viewport coordinates, because the term
 * grid scrolls sideways on a narrow screen: an absolutely positioned popover
 * inside it is clipped to the scroll box, which is what made this unreadable —
 * a strip of a printed line squeezed into the width of a table cell.
 */
function PeekView({ peek }: { peek: Peek | null }): JSX.Element | null {
  if (!peek) return null
  return createPortal(
    <div className="crop-context" style={{ left: peek.left, top: peek.top }}>
      <img src={peek.src} alt={peek.alt} />
      <small>{peek.alt} — click the cutting to see it larger</small>
    </div>,
    document.body
  )
}

function TermGrid({
  question,
  value,
  onChange,
  onOpen
}: {
  question: Extract<Question, { type: 'term-grid' }>
  value: Record<string, TermVerdict>
  onChange: (v: Record<string, TermVerdict>) => void
  onOpen: (src: string, caption: string) => void
}): JSX.Element {
  const set = (id: string, verdict: TermVerdict): void => onChange({ ...value, [id]: verdict })
  const acceptedCount = Object.values(value).filter((v) => v.action === 'accept').length
  const [peek, setPeek] = useState<Peek | null>(null)

  /** Anchor the popover under the cutting, kept inside the window. */
  const show = (el: HTMLElement, src: string, alt: string): void => {
    const box = el.getBoundingClientRect()
    const width = Math.min(680, window.innerWidth - 24)
    setPeek({
      src,
      alt,
      left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
      top: box.bottom + 8
    })
  }

  return (
    <>
      <div className="grid-head">
        <span className="hint">
          {acceptedCount} of {question.rows.length} accepted
        </span>
        <button
          type="button"
          className="accept-all"
          onClick={() =>
            onChange(
              Object.fromEntries(
                question.rows.map((r) => [r.id, { action: 'accept' } as TermVerdict])
              )
            )
          }
        >
          Accept all
        </button>
      </div>
      <div className="terms-scroll">
        <table className="terms">
          <thead>
            <tr>
              <th>From the page</th>
              <th>Read as</th>
              <th>Uses</th>
              <th>Why</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {question.rows.map((row) => {
              const v = value[row.id] ?? { action: 'accept' }
              return (
                <tr key={row.id} className={v.action === 'ignore' ? 'ignored' : undefined}>
                  <td>
                    {row.cropSrc ? (
                      // Hovering shows the word in its line; clicking opens
                      // that line full size. One word is enough to read the
                      // letters and not always enough to judge them, and a
                      // strip of print shrunk into a table cell is enough for
                      // neither. A button, so both are reachable by keyboard.
                      <button
                        type="button"
                        className="crop"
                        title={row.contextSrc ? 'See this line full size' : 'See it full size'}
                        onMouseEnter={(e) =>
                          row.contextSrc &&
                          show(e.currentTarget, row.contextSrc, `“${row.reading}” in its line`)
                        }
                        onFocus={(e) =>
                          row.contextSrc &&
                          show(e.currentTarget, row.contextSrc, `“${row.reading}” in its line`)
                        }
                        onMouseLeave={() => setPeek(null)}
                        onBlur={() => setPeek(null)}
                        onClick={() => {
                          setPeek(null)
                          onOpen(
                            row.contextSrc ?? row.cropSrc!,
                            `“${row.reading}” as the page prints it`
                          )
                        }}
                      >
                        <img src={row.cropSrc} alt={`Scan of “${row.reading}”`} />
                      </button>
                    ) : (
                      <span className="crop-missing">no crop</span>
                    )}
                  </td>
                  <td className="reading">
                    {v.action === 'correct' ? (
                      <input
                        className="fix"
                        value={v.text}
                        aria-label={`Correction for ${row.reading}`}
                        onChange={(e) => set(row.id, { action: 'correct', text: e.target.value })}
                      />
                    ) : (
                      row.reading
                    )}
                  </td>
                  <td className="count">{row.count}×</td>
                  <td>
                    {row.signals.map((s) => (
                      <span className="sig" key={s}>
                        {s.replace(/-/g, ' ')}
                      </span>
                    ))}
                  </td>
                  <td>
                    <div className="verdict">
                      <button
                        type="button"
                        className={v.action === 'accept' ? 'on' : ''}
                        onClick={() => set(row.id, { action: 'accept' })}
                        title="This reading is correct"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className={v.action === 'correct' ? 'on' : ''}
                        onClick={() => set(row.id, { action: 'correct', text: row.reading })}
                        title="Fix this reading"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className={v.action === 'ignore' ? 'on' : ''}
                        onClick={() => set(row.id, { action: 'ignore' })}
                        title="Not a real word — ignore it"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <PeekView peek={peek} />
    </>
  )
}

/**
 * The passages off one leaf, editable in place.
 *
 * The answer holds only what was *changed*, so a box the user never touched
 * contributes nothing and reverting one removes its entry rather than recording
 * "corrected back to what it said". That is what keeps a gate someone walked
 * through twice from claiming every block in the book was corrected.
 */
function PageEditor({
  question,
  value,
  onChange
}: {
  question: Extract<Question, { type: 'page-edit' }>
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
}): JSX.Element {
  const set = (id: string, text: string, original: string): void => {
    const next = { ...value }
    if (text === original) delete next[id]
    else next[id] = text
    onChange(next)
  }

  return (
    <div className="page-edit">
      {question.rows.map((row) => {
        const current = value[row.id] ?? row.text
        const changed = current !== row.text
        return (
          <div key={row.id} className={changed ? 'page-edit-row changed' : 'page-edit-row'}>
            <div className="page-edit-head">
              <span className="page-edit-kind">{row.kind}</span>
              {row.alsoFromPages.length > 0 ? (
                <span className="page-edit-seam">
                  runs on to page {row.alsoFromPages.map((p) => p + 1).join(', ')}
                </span>
              ) : null}
              {changed ? (
                <button type="button" onClick={() => set(row.id, row.text, row.text)}>
                  Undo
                </button>
              ) : null}
            </div>
            <textarea
              value={current}
              rows={Math.min(12, Math.max(2, Math.ceil(current.length / 60)))}
              aria-label={`${row.kind} from this page`}
              onChange={(e) => set(row.id, e.target.value, row.text)}
            />
          </div>
        )
      })}
    </div>
  )
}

export function QuestionView({
  question,
  value,
  onChange,
  resolveEvidence,
  cropWords,
  enlargeEvidence
}: Props): JSX.Element {
  const [enlarged, setEnlarged] = useState<Enlarged | null>(null)
  // Minted here, so it is revoked here. A readable render of a 300-DPI leaf is
  // megabytes, and leaking one per look would add up over a book.
  const madeRef = useRef<string | null>(null)

  useEffect(
    () => () => {
      if (madeRef.current) URL.revokeObjectURL(madeRef.current)
      madeRef.current = null
    },
    []
  )

  const open = (src: string, caption: string): void => {
    const immediate = resolveEvidence?.(src) ?? src
    if (!enlargeEvidence) {
      setEnlarged({ src: immediate, caption, loading: false })
      return
    }
    // The thumbnail goes up at once and the readable render replaces it, so
    // opening a leaf never shows an empty frame while pdf.js works.
    setEnlarged({ src: immediate, caption, loading: false })
    void enlargeEvidence(src).then((big) => {
      if (!big) return
      if (madeRef.current) URL.revokeObjectURL(madeRef.current)
      madeRef.current = big
      setEnlarged((current) => (current ? { ...current, src: big } : current))
    })
  }

  const body = (): JSX.Element => {
    switch (question.type) {
      case 'text':
        // A question that asks for a sentence has to look like it wants one.
        // Both of the questions that set this — what the book is about, and
        // what the introduction should say — are invitations to write, and a
        // single line that scrolls sideways answers them with "keep it short".
        return question.multiline ? (
          <textarea
            value={(value as string) ?? ''}
            rows={3}
            placeholder={question.placeholder}
            aria-label={question.prompt}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            type="text"
            value={(value as string) ?? ''}
            placeholder={question.placeholder}
            aria-label={question.prompt}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      case 'confirm':
        return (
          <div className="opts">
            {[
              { v: true, t: 'Yes' },
              { v: false, t: 'No' }
            ].map((o) => (
              <label key={String(o.v)} className={`opt ${value === o.v ? 'sel' : ''}`}>
                <input
                  type="radio"
                  name={question.id}
                  checked={value === o.v}
                  onChange={() => onChange(o.v)}
                />
                <span className="t">{o.t}</span>
              </label>
            ))}
          </div>
        )
      case 'choice':
        return (
          <div className="opts">
            {question.options.map((o) => (
              <label key={o.value} className={`opt ${value === o.value ? 'sel' : ''}`}>
                <input
                  type="radio"
                  name={question.id}
                  checked={value === o.value}
                  onChange={() => onChange(o.value)}
                />
                <span>
                  <span className="t">{o.label}</span>
                  {o.description ? <span className="d"> — {o.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
        )
      case 'multi-choice': {
        const sel = (value as string[]) ?? []
        return (
          <div className="opts">
            {question.options.map((o) => (
              <label key={o.value} className={`opt ${sel.includes(o.value) ? 'sel' : ''}`}>
                <input
                  type="checkbox"
                  checked={sel.includes(o.value)}
                  onChange={() =>
                    onChange(
                      sel.includes(o.value) ? sel.filter((x) => x !== o.value) : [...sel, o.value]
                    )
                  }
                />
                <span>
                  <span className="t">{o.label}</span>
                  {o.description ? <span className="d"> — {o.description}</span> : null}
                  {/* Evidence per option, not per question: "is this an
                      illustration?" cannot be answered without seeing that one. */}
                  <EvidenceView items={o.evidence} resolve={resolveEvidence} />
                </span>
              </label>
            ))}
          </div>
        )
      }
      case 'term-grid':
        return (
          <TermGrid
            question={question}
            value={(value as Record<string, TermVerdict>) ?? {}}
            onChange={onChange}
            onOpen={open}
          />
        )
      case 'discrepancies':
        return (
          <DiscrepancyGrid
            question={question}
            value={(value as Record<string, DiscrepancyVerdict>) ?? {}}
            onChange={onChange}
            cropWords={cropWords}
            onOpen={open}
          />
        )
      case 'page-edit':
        return (
          <PageEditor
            question={question}
            value={(value as Record<string, string>) ?? {}}
            onChange={onChange}
          />
        )
    }
  }

  const hasEvidence = (question.evidence?.length ?? 0) > 0
  // Evidence carrying a passage of text is the point of the screen, not a
  // footnote to it: the scan and the transcription both need room, and three
  // radio buttons do not. So the row is told which way to divide itself.
  const readsEvidence = question.evidence?.some((e) => e.kind === 'text') ?? false

  return (
    <div className="q">
      <span className="prompt">{question.prompt}</span>
      {question.help ? <div className="help">{question.help}</div> : null}
      {hasEvidence ? (
        <div className={readsEvidence ? 'q-row evidence-led' : 'q-row'}>
          <div className="fields">{body()}</div>
          <EvidenceView items={question.evidence} resolve={resolveEvidence} onOpen={open} />
        </div>
      ) : (
        body()
      )}
      {enlarged ? (
        <Lightbox
          src={enlarged.src}
          caption={enlarged.caption}
          loading={enlarged.loading}
          onClose={() => setEnlarged(null)}
        />
      ) : null}
    </div>
  )
}

/**
 * The disagreements on one leaf, each shown at the pixels it was read from.
 *
 * What this replaces: a count and a thumbnail. "18 words OCR read clearly are
 * absent from the transcription", a 150-pixel picture of a dense page, and one
 * splice offer covering four of the eighteen — which left the user reading the
 * scan against the transcription by eye, in two panes, to find the other
 * fourteen. The information to point at every one of them was already in hand
 * and thrown away.
 *
 * So each row is the word as it appears *on the paper*, the transcribed words
 * either side of where it belongs, and a verdict. Nothing is pre-selected: OCR
 * is the noisier witness of the two, and a default that put every run back
 * would copy its misreadings into a transcription the user paid a better model
 * to produce.
 *
 * The crops are made on arrival and released on leaving — a leaf at a time, one
 * render each, never a book's worth held at once.
 */
function DiscrepancyGrid({
  question,
  value,
  onChange,
  cropWords,
  onOpen
}: {
  question: Extract<Question, { type: 'discrepancies' }>
  value: Record<string, DiscrepancyVerdict>
  onChange: (v: Record<string, DiscrepancyVerdict>) => void
  cropWords?: (
    pageIndex: number,
    groups: readonly { id: string; tokenIds: readonly string[] }[]
  ) => Promise<Map<string, string>>
  onOpen?: (src: string, caption: string) => void
}): JSX.Element {
  const [crops, setCrops] = useState<Map<string, string>>(new Map())
  const madeRef = useRef<string[]>([])

  const groups = question.rows.map((r) => ({ id: r.id, tokenIds: r.tokenIds }))
  const tokenKey = groups.map((g) => `${g.id}:${g.tokenIds.join('+')}`).join(',')

  useEffect(() => {
    if (!cropWords || groups.length === 0) return
    let live = true
    void cropWords(question.pageIndex, groups).then((made) => {
      if (!live) {
        for (const url of made.values()) URL.revokeObjectURL(url)
        return
      }
      madeRef.current = [...made.values()]
      setCrops(made)
    })
    return () => {
      live = false
      for (const url of madeRef.current) URL.revokeObjectURL(url)
      madeRef.current = []
      setCrops(new Map())
    }
    // Keyed on `tokenKey`, the joined ids, rather than on the array itself: the
    // rows are rebuilt on every render of the gate, so a dependency on the
    // array would re-render the leaf and re-cut every crop each time anything
    // else on the screen changed.
  }, [tokenKey, question.pageIndex, cropWords])

  const set = (id: string, verdict: DiscrepancyVerdict): void => {
    const next = { ...value }
    // Clicking the chosen verdict again clears it, so a row can be put back to
    // undecided without reloading the gate.
    if (next[id] === verdict) delete next[id]
    else next[id] = verdict
    onChange(next)
  }

  const decided = question.rows.filter((r) => value[r.id]).length

  return (
    <div className="discrepancies">
      <div className="discrepancy-head">
        {decided} of {question.rows.length} decided
        <button
          type="button"
          className="ghost"
          onClick={() =>
            onChange(Object.fromEntries(question.rows.map((r) => [r.id, 'ignore' as const])))
          }
        >
          None of these are missing
        </button>
      </div>

      {question.rows.map((row) => {
        const crop = crops.get(row.id)
        return (
          <div className={`discrepancy ${row.strength}`} key={row.id}>
            <div className="discrepancy-pixels">
              {crop ? (
                <img
                  src={crop}
                  alt={`“${row.text}” on the scan`}
                  onClick={() =>
                    onOpen?.(crop, `“${row.text}” as it appears on page ${question.pageIndex + 1}`)
                  }
                />
              ) : (
                <span className="no-crop">no crop</span>
              )}
              <small>
                OCR {row.confidence}% sure
                {row.strength === 'weak' ? ' · single word — often not a real omission' : null}
              </small>
            </div>

            <div className="discrepancy-where">
              <span className="ctx">{row.after || '(start of the page)'}</span>{' '}
              <b className="gap">{row.text}</b>{' '}
              <span className="ctx">{row.before || '(end of the page)'}</span>
            </div>

            <div className="discrepancy-verdict">
              <button
                type="button"
                className={value[row.id] === 'restore' ? 'primary' : 'ghost'}
                onClick={() => set(row.id, 'restore')}
              >
                Put it back
              </button>
              <button
                type="button"
                className={value[row.id] === 'ignore' ? 'primary' : 'ghost'}
                onClick={() => set(row.id, 'ignore')}
              >
                Not missing
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
