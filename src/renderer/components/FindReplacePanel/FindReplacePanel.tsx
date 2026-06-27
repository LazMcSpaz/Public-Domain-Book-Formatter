/**
 * FindReplacePanel — the per-book find-replace dictionary + suspicious-character
 * scan (SPEC §4). CRUD over the project's rules, an "Apply all" that rewrites
 * the markdown, and a scan that merges suspicious-char heuristic flags into the
 * flag list (without duplicating prior scans).
 */
import { useCallback } from 'react'
import type { FindReplaceRule } from '@core/model'
import { useReview } from '../../store/ReviewContext'
import { applyFindReplace } from '../../utils/apply-find-replace'
import { isSuspiciousCharFlag, scanSuspiciousChars } from '../../utils/suspicious-chars'
import { RuleItem } from './RuleItem'
import './FindReplacePanel.css'

/** Reasonably-unique id for a new rule (crypto.randomUUID where available). */
function newRuleId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return `rule_${c.randomUUID()}`
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function FindReplacePanel(): JSX.Element {
  const { state, dispatch } = useReview()
  const rules = state.project?.findReplace ?? []

  const setRules = useCallback(
    (next: FindReplaceRule[]) => dispatch({ type: 'SET_FIND_REPLACE', rules: next }),
    [dispatch]
  )

  const onAdd = useCallback(() => {
    setRules([...rules, { id: newRuleId(), find: '', replace: '', regex: false }])
  }, [rules, setRules])

  const onChangeRule = useCallback(
    (updated: FindReplaceRule) => {
      setRules(rules.map((r) => (r.id === updated.id ? updated : r)))
    },
    [rules, setRules]
  )

  const onDeleteRule = useCallback(
    (id: string) => {
      setRules(rules.filter((r) => r.id !== id))
    },
    [rules, setRules]
  )

  const onApplyAll = useCallback(() => {
    if (!state.project) return
    const markdown = applyFindReplace(state.project.markdown, rules)
    dispatch({ type: 'SET_MARKDOWN', markdown })
  }, [state.project, rules, dispatch])

  const onScan = useCallback(() => {
    if (!state.project) return
    const scanned = scanSuspiciousChars(state.project.markdown)
    // Drop prior suspicious-char flags so re-scanning never duplicates them,
    // then append the fresh results. Other flags (OCR, structure, etc.) survive.
    const kept = state.project.flags.filter((f) => !isSuspiciousCharFlag(f))
    dispatch({ type: 'SET_FLAGS', flags: [...kept, ...scanned] })
  }, [state.project, dispatch])

  return (
    <section className="find-replace-panel panel">
      <header className="panel-header">
        <h3>Find &amp; replace</h3>
        <button type="button" className="fr-add" onClick={onAdd}>
          + Rule
        </button>
      </header>

      {rules.length === 0 ? (
        <p className="panel-empty">No rules yet.</p>
      ) : (
        <ul className="rule-list">
          {rules.map((rule) => (
            <RuleItem
              key={rule.id}
              rule={rule}
              onChange={onChangeRule}
              onDelete={onDeleteRule}
            />
          ))}
        </ul>
      )}

      <div className="fr-actions">
        <button type="button" onClick={onApplyAll} disabled={rules.length === 0}>
          Apply all
        </button>
        <button type="button" onClick={onScan} title="Scan markdown for suspicious characters">
          Scan suspicious characters
        </button>
      </div>
    </section>
  )
}
