/**
 * ControlBar — the review instrument's top bar (SPEC §4 reading-comfort
 * controls). Holds the reading-typography sliders, the confidence-tint toggle,
 * Save, and Jump-to-next-flag. Everything reads from and dispatches through
 * ReviewContext so the panes stay in sync.
 */
import { useCallback, useState, type ChangeEvent } from 'react'
import { useReview } from '../../store/ReviewContext'
import { useFlagNav } from '../../store/FlagNavContext'
import { flagTokenId } from '../../utils/flag-token'
import { jumpToToken } from '../../highlight'
import type { ReadingPrefs } from '../../store/types'
import './ControlBar.css'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step, format, onChange }: SliderProps): JSX.Element {
  const handle = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value)),
    [onChange]
  )
  return (
    <label className="control-slider">
      <span className="control-slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step ?? 1} value={value} onChange={handle} />
      <span className="control-slider-value">{format ? format(value) : String(value)}</span>
    </label>
  )
}

export function ControlBar(): JSX.Element {
  const { state, dispatch } = useReview()
  const { activeIndex, setActiveIndex } = useFlagNav()
  const prefs = state.readingPrefs
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const setPref = useCallback(
    (patch: Partial<ReadingPrefs>) => dispatch({ type: 'SET_READING_PREFS', prefs: patch }),
    [dispatch]
  )

  const onSave = useCallback(async () => {
    if (!state.projectPath || !state.project) return
    setSaving(true)
    setSaveError(null)
    try {
      await window.api.saveProject(state.projectPath, state.project)
      dispatch({ type: 'MARK_SAVED' })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [state.projectPath, state.project, dispatch])

  const onNextFlag = useCallback(() => {
    const flags = state.project?.flags ?? []
    if (flags.length === 0) return
    const next = (activeIndex + 1 + flags.length) % flags.length
    setActiveIndex(next)
    const tokenId = flagTokenId(flags[next]!, state.coordinateMap)
    if (tokenId) jumpToToken(tokenId)
  }, [state.project, state.coordinateMap, activeIndex, setActiveIndex])

  const hasFlags = (state.project?.flags.length ?? 0) > 0

  return (
    <div className="control-bar">
      <div className="control-group control-sliders">
        <Slider
          label="Font"
          value={prefs.fontSize}
          min={14}
          max={22}
          format={(v) => `${v}px`}
          onChange={(v) => setPref({ fontSize: v })}
        />
        <Slider
          label="Spacing"
          value={prefs.lineSpacing}
          min={1.2}
          max={2.0}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => setPref({ lineSpacing: v })}
        />
        <Slider
          label="Width"
          value={prefs.lineLength}
          min={50}
          max={100}
          format={(v) => `${v}ch`}
          onChange={(v) => setPref({ lineLength: v })}
        />
        <Slider
          label="Split"
          value={prefs.leftPaneWidthPct}
          min={30}
          max={70}
          format={(v) => `${v}%`}
          onChange={(v) => setPref({ leftPaneWidthPct: v })}
        />
      </div>

      <div className="control-group control-actions">
        <label className="control-toggle" title="Highlight low-confidence / flagged areas">
          <input
            type="checkbox"
            checked={prefs.confidenceTint}
            onChange={() => dispatch({ type: 'TOGGLE_TINT' })}
          />
          <span>Confidence tint</span>
        </label>

        <button
          type="button"
          className="control-next-flag"
          onClick={onNextFlag}
          disabled={!hasFlags}
          title="Jump to the next flag"
        >
          Next flag ▸
        </button>

        <button
          type="button"
          className="control-save"
          onClick={onSave}
          disabled={!state.isDirty || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        {saveError ? (
          <span className="error control-save-error" title={saveError}>
            Save failed
          </span>
        ) : null}
      </div>
    </div>
  )
}
