/**
 * Renders whatever a wizard step asks for.
 *
 * This component knows nothing about *which* questions exist — it renders the
 * `Question` data a step emits. That's the whole point of the contract: adding
 * a question later needs no new UI code here.
 */
import type { Question, AnswerValue, TermVerdict, Evidence } from '@core/wizard'

interface Props {
  question: Question
  value: AnswerValue | undefined
  onChange: (value: AnswerValue) => void
  /** Resolves an evidence src like `page:3` to a displayable URL. */
  resolveEvidence?: (src: string) => string | undefined
}

function EvidenceView({
  items,
  resolve
}: {
  items?: Evidence[]
  resolve?: (src: string) => string | undefined
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
          return (
            <figure key={i} style={{ margin: 0 }}>
              <img src={src} alt={e.alt} />
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

function TermGrid({
  question,
  value,
  onChange
}: {
  question: Extract<Question, { type: 'term-grid' }>
  value: Record<string, TermVerdict>
  onChange: (v: Record<string, TermVerdict>) => void
}): JSX.Element {
  const set = (id: string, verdict: TermVerdict): void => onChange({ ...value, [id]: verdict })
  const acceptedCount = Object.values(value).filter((v) => v.action === 'accept').length

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
                      <img src={row.cropSrc} alt={`Scan of “${row.reading}”`} />
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
    </>
  )
}

export function QuestionView({ question, value, onChange, resolveEvidence }: Props): JSX.Element {
  const body = (): JSX.Element => {
    switch (question.type) {
      case 'text':
        return (
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
          <EvidenceView items={question.evidence} resolve={resolveEvidence} />
        </div>
      ) : (
        body()
      )}
    </div>
  )
}
