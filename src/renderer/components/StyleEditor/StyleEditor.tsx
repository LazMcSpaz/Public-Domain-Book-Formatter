/**
 * StyleEditor — the reusable "look" editor (SPEC §7). Holds a *working*
 * StyleProfile (the user's tweaks) seeded from the project's applied profile if
 * any, else the shipped default. Edits here never touch the project until the
 * user banks them via the ProfileManager ("Save as profile") and/or applies a
 * profile to the book.
 *
 * SPEC §7 three states are honoured: shipped defaults (defaultStyleProfile /
 * DEFAULT_STYLE_PROFILES) → user tweaks (this working copy) → saved profiles
 * (ProfileManager + window.api.{list,save,delete}StyleProfile).
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import type { Margins, PageNumberPosition, RunningHeadMode, StyleProfile } from '@core/model'
import { defaultStyleProfile, DEFAULT_STYLE_PROFILES } from '@core/style'
import { useReview } from '../../store/ReviewContext'
import { ProfileManager } from './ProfileManager'
import './StyleEditor.css'

const TRIM_SIZES = ['5x8', '5.25x8', '5.5x8.5', '6x9', '6.14x9.21', '7x10', '8x10']

const RUNNING_HEAD_MODES: RunningHeadMode[] = [
  'none',
  'bookTitle',
  'author',
  'chapterTitle',
  'pageNumber'
]

const RUNNING_HEAD_LABELS: Record<RunningHeadMode, string> = {
  none: 'None',
  bookTitle: 'Book title',
  author: 'Author',
  chapterTitle: 'Chapter title',
  pageNumber: 'Page number'
}

const PAGE_NUMBER_POSITIONS: PageNumberPosition[] = [
  'none',
  'bottomCenter',
  'bottomOuter',
  'topOuter'
]

const PAGE_NUMBER_LABELS: Record<PageNumberPosition, string> = {
  none: 'None',
  bottomCenter: 'Bottom centre',
  bottomOuter: 'Bottom outer',
  topOuter: 'Top outer'
}

/** Seed the working profile from the applied saved profile, else the default. */
function seedProfile(styleProfileId: string | null, saved: StyleProfile[]): StyleProfile {
  if (styleProfileId) {
    const fromSaved = saved.find((p) => p.id === styleProfileId)
    if (fromSaved) return structuredClone(fromSaved)
    const fromShipped = DEFAULT_STYLE_PROFILES.find((p) => p.id === styleProfileId)
    if (fromShipped) return structuredClone(fromShipped)
  }
  return defaultStyleProfile()
}

interface NumberFieldProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  onChange: (v: number) => void
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange
}: NumberFieldProps): JSX.Element {
  const handle = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value)),
    [onChange]
  )
  return (
    <label className="se-field">
      <span className="se-field-label">{label}</span>
      <span className="se-field-control">
        <input type="number" value={value} min={min} max={max} step={step ?? 1} onChange={handle} />
        {unit ? <span className="se-field-unit">{unit}</span> : null}
      </span>
    </label>
  )
}

export function StyleEditor(): JSX.Element {
  const { state, dispatch } = useReview()
  const appliedId = state.project?.styleProfileId ?? null

  const [saved, setSaved] = useState<StyleProfile[]>([])
  const [working, setWorking] = useState<StyleProfile>(() => seedProfile(appliedId, []))
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.listStyleProfiles()
      setSaved(list)
      return list
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
      return [] as StyleProfile[]
    }
  }, [])

  // Initial load: fetch saved profiles, then (re-)seed the working copy from the
  // applied profile if we now have its definition.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await refresh()
      if (!cancelled) setWorking(seedProfile(appliedId, list))
    })()
    return () => {
      cancelled = true
    }
    // Re-seed only when the applied profile id changes.
  }, [appliedId, refresh])

  const patch = useCallback((p: Partial<StyleProfile>) => {
    setWorking((prev) => ({ ...prev, ...p }))
  }, [])

  const patchMargins = useCallback((p: Partial<Margins>) => {
    setWorking((prev) => ({ ...prev, margins: { ...prev.margins, ...p } }))
  }, [])

  const patchHeading = useCallback((p: Partial<StyleProfile['headingStyle']>) => {
    setWorking((prev) => ({
      ...prev,
      headingStyle: { ...prev.headingStyle, ...p }
    }))
  }, [])

  const patchRunningHeads = useCallback((p: Partial<StyleProfile['runningHeads']>) => {
    setWorking((prev) => ({
      ...prev,
      runningHeads: { ...prev.runningHeads, ...p }
    }))
  }, [])

  const patchFrontMatter = useCallback((p: Partial<StyleProfile['frontMatter']>) => {
    setWorking((prev) => ({
      ...prev,
      frontMatter: { ...prev.frontMatter, ...p }
    }))
  }, [])

  const onResetToDefault = useCallback(() => {
    setWorking(defaultStyleProfile())
  }, [])

  const onLoadWorking = useCallback((profile: StyleProfile) => {
    setWorking(structuredClone(profile))
  }, [])

  return (
    <div className="style-editor">
      <div className="se-form" role="form" aria-label="Style profile editor">
        <header className="se-header">
          <h2>Style</h2>
          <p className="se-subhead">
            Edit the reusable look. Tweaks stay local until you bank them as a profile or apply them
            to this book.
          </p>
          {loadError ? <p className="error">Couldn’t load saved profiles: {loadError}</p> : null}
        </header>

        {/* --- Page geometry --- */}
        <fieldset className="se-section">
          <legend>Page</legend>
          <label className="se-field">
            <span className="se-field-label">Trim size</span>
            <span className="se-field-control">
              <select
                value={working.trimSize}
                onChange={(e) => patch({ trimSize: e.target.value })}
              >
                {(TRIM_SIZES.includes(working.trimSize)
                  ? TRIM_SIZES
                  : [working.trimSize, ...TRIM_SIZES]
                ).map((t) => (
                  <option key={t} value={t}>
                    {t.replace('x', ' × ')} in
                  </option>
                ))}
              </select>
            </span>
          </label>
          <div className="se-grid">
            <NumberField
              label="Top"
              value={working.margins.top}
              min={0}
              step={0.05}
              unit="in"
              onChange={(v) => patchMargins({ top: v })}
            />
            <NumberField
              label="Bottom"
              value={working.margins.bottom}
              min={0}
              step={0.05}
              unit="in"
              onChange={(v) => patchMargins({ bottom: v })}
            />
            <NumberField
              label="Inner (spine)"
              value={working.margins.inner}
              min={0}
              step={0.05}
              unit="in"
              onChange={(v) => patchMargins({ inner: v })}
            />
            <NumberField
              label="Outer"
              value={working.margins.outer}
              min={0}
              step={0.05}
              unit="in"
              onChange={(v) => patchMargins({ outer: v })}
            />
            <NumberField
              label="Gutter"
              value={working.gutter}
              min={0}
              step={0.01}
              unit="in"
              onChange={(v) => patch({ gutter: v })}
            />
          </div>
        </fieldset>

        {/* --- Body type --- */}
        <fieldset className="se-section">
          <legend>Body text</legend>
          <div className="se-grid">
            <label className="se-field">
              <span className="se-field-label">Body font</span>
              <span className="se-field-control">
                <input
                  type="text"
                  value={working.bodyFont}
                  onChange={(e) => patch({ bodyFont: e.target.value })}
                />
              </span>
            </label>
            <NumberField
              label="Body size"
              value={working.bodyFontSize}
              min={6}
              max={18}
              step={0.5}
              unit="pt"
              onChange={(v) => patch({ bodyFontSize: v })}
            />
          </div>
        </fieldset>

        {/* --- Headings --- */}
        <fieldset className="se-section">
          <legend>Headings</legend>
          <div className="se-grid">
            <label className="se-field">
              <span className="se-field-label">Heading font</span>
              <span className="se-field-control">
                <input
                  type="text"
                  value={working.headingFont}
                  onChange={(e) => patch({ headingFont: e.target.value })}
                />
              </span>
            </label>
            <NumberField
              label="Heading scale"
              value={working.headingStyle.scale}
              min={1}
              max={3}
              step={0.05}
              unit="×"
              onChange={(v) => patchHeading({ scale: v })}
            />
          </div>
          <div className="se-checks">
            <label className="se-check">
              <input
                type="checkbox"
                checked={working.headingStyle.smallCaps}
                onChange={(e) => patchHeading({ smallCaps: e.target.checked })}
              />
              <span>Small caps</span>
            </label>
            <label className="se-check">
              <input
                type="checkbox"
                checked={working.headingStyle.centered}
                onChange={(e) => patchHeading({ centered: e.target.checked })}
              />
              <span>Centred</span>
            </label>
          </div>
        </fieldset>

        {/* --- Running heads & page numbers --- */}
        <fieldset className="se-section">
          <legend>Running heads &amp; page numbers</legend>
          <div className="se-grid">
            <label className="se-field">
              <span className="se-field-label">Verso (left)</span>
              <span className="se-field-control">
                <select
                  value={working.runningHeads.verso}
                  onChange={(e) => patchRunningHeads({ verso: e.target.value as RunningHeadMode })}
                >
                  {RUNNING_HEAD_MODES.map((m) => (
                    <option key={m} value={m}>
                      {RUNNING_HEAD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="se-field">
              <span className="se-field-label">Recto (right)</span>
              <span className="se-field-control">
                <select
                  value={working.runningHeads.recto}
                  onChange={(e) => patchRunningHeads({ recto: e.target.value as RunningHeadMode })}
                >
                  {RUNNING_HEAD_MODES.map((m) => (
                    <option key={m} value={m}>
                      {RUNNING_HEAD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="se-field">
              <span className="se-field-label">Page number</span>
              <span className="se-field-control">
                <select
                  value={working.pageNumber}
                  onChange={(e) => patch({ pageNumber: e.target.value as PageNumberPosition })}
                >
                  {PAGE_NUMBER_POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {PAGE_NUMBER_LABELS[p]}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
        </fieldset>

        {/* --- Ornaments --- */}
        <fieldset className="se-section">
          <legend>Ornaments</legend>
          <div className="se-grid">
            <label className="se-field">
              <span className="se-field-label">Chapter opener</span>
              <span className="se-field-control">
                <input
                  type="text"
                  placeholder="ornament id (optional)"
                  value={working.ornaments.chapterOpener ?? ''}
                  onChange={(e) =>
                    patch({
                      ornaments: {
                        ...working.ornaments,
                        chapterOpener: e.target.value.trim() || null
                      }
                    })
                  }
                />
              </span>
            </label>
            <label className="se-field">
              <span className="se-field-label">Section divider</span>
              <span className="se-field-control">
                <input
                  type="text"
                  placeholder="ornament id (optional)"
                  value={working.ornaments.sectionDivider ?? ''}
                  onChange={(e) =>
                    patch({
                      ornaments: {
                        ...working.ornaments,
                        sectionDivider: e.target.value.trim() || null
                      }
                    })
                  }
                />
              </span>
            </label>
            <label className="se-field">
              <span className="se-field-label">Page-number ornament</span>
              <span className="se-field-control">
                <input
                  type="text"
                  placeholder="ornament id (optional)"
                  value={working.ornaments.pageNumber ?? ''}
                  onChange={(e) =>
                    patch({
                      ornaments: {
                        ...working.ornaments,
                        pageNumber: e.target.value.trim() || null
                      }
                    })
                  }
                />
              </span>
            </label>
          </div>
        </fieldset>

        {/* --- Front-matter toggles --- */}
        <fieldset className="se-section">
          <legend>Front matter</legend>
          <div className="se-checks">
            <label className="se-check">
              <input
                type="checkbox"
                checked={working.frontMatter.halfTitle}
                onChange={(e) => patchFrontMatter({ halfTitle: e.target.checked })}
              />
              <span>Half-title page</span>
            </label>
            <label className="se-check">
              <input
                type="checkbox"
                checked={working.frontMatter.titlePage}
                onChange={(e) => patchFrontMatter({ titlePage: e.target.checked })}
              />
              <span>Title page</span>
            </label>
            <label className="se-check">
              <input
                type="checkbox"
                checked={working.frontMatter.copyrightPage}
                onChange={(e) => patchFrontMatter({ copyrightPage: e.target.checked })}
              />
              <span>Copyright page</span>
            </label>
          </div>
        </fieldset>

        <div className="se-form-actions">
          <button type="button" onClick={onResetToDefault}>
            Reset to shipped default
          </button>
        </div>
      </div>

      <ProfileManager
        working={working}
        saved={saved}
        appliedId={appliedId}
        onRefresh={refresh}
        onLoadWorking={onLoadWorking}
        onApply={(id) => dispatch({ type: 'SET_STYLE_PROFILE', styleProfileId: id })}
      />
    </div>
  )
}
