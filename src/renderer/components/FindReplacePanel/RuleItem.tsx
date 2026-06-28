/**
 * RuleItem — one editable find-replace rule (SPEC §4 per-book find-replace
 * dictionary). All fields edit in place; changes bubble up through onChange so
 * the panel owns the canonical rules array.
 */
import { useCallback, type ChangeEvent } from 'react'
import type { FindReplaceRule } from '@core/model'

export interface RuleItemProps {
  rule: FindReplaceRule
  onChange: (rule: FindReplaceRule) => void
  onDelete: (id: string) => void
}

export function RuleItem({ rule, onChange, onDelete }: RuleItemProps): JSX.Element {
  const patch = useCallback(
    (p: Partial<FindReplaceRule>) => onChange({ ...rule, ...p }),
    [rule, onChange]
  )

  return (
    <li className="rule-item">
      <div className="rule-row">
        <input
          className="rule-find"
          type="text"
          placeholder="find"
          value={rule.find}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patch({ find: e.target.value })}
        />
        <span className="rule-arrow">→</span>
        <input
          className="rule-replace"
          type="text"
          placeholder="replace"
          value={rule.replace}
          onChange={(e: ChangeEvent<HTMLInputElement>) => patch({ replace: e.target.value })}
        />
        <button
          type="button"
          className="rule-delete"
          title="Delete rule"
          onClick={() => onDelete(rule.id)}
        >
          ✕
        </button>
      </div>
      <div className="rule-row rule-meta">
        <label className="rule-regex">
          <input
            type="checkbox"
            checked={rule.regex}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patch({ regex: e.target.checked })}
          />
          <span>regex</span>
        </label>
        <input
          className="rule-note"
          type="text"
          placeholder="note (optional)"
          value={rule.note ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            patch({ note: e.target.value === '' ? undefined : e.target.value })
          }
        />
      </div>
    </li>
  )
}
