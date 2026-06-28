/**
 * ExportPanel — the KDP export screen (SPEC §10). Shows toolchain readiness
 * (the export-relevant deps: Pandoc / XeLaTeX / pdftoppm), an "Export KDP PDF"
 * action, and the resulting validation report. The final interior page count is
 * shown prominently because the user needs it for externally-made spine math.
 *
 * Warnings inform, they don't block: a report with only ok/warn checks is still
 * "ready". Only a 'fail' check stops the user. Self-contained: reads from
 * useReview() / window.api; no props.
 */
import { useCallback, useEffect, useState } from 'react'
import type { DependencyStatus } from '../../../shared/ipc-types'
import type { KdpValidationReport, ValidationCheck, ValidationLevel } from '@core/model'
import { useReview } from '../../store/ReviewContext'
import './ExportPanel.css'

/** Tools that matter for assembling/typesetting the export (SPEC §10). */
const EXPORT_TOOLS = ['pandoc', 'xelatex', 'pdftoppm']

function levelClass(level: ValidationLevel): string {
  return `vc-${level}`
}

function levelIcon(level: ValidationLevel): string {
  if (level === 'ok') return '✓'
  if (level === 'warn') return '!'
  return '✕'
}

function CheckRow({ check }: { check: ValidationCheck }): JSX.Element {
  return (
    <li className={`vc-row ${levelClass(check.level)}`}>
      <span className="vc-icon" aria-hidden>
        {levelIcon(check.level)}
      </span>
      <span className="vc-body">
        <span className="vc-label">{check.label}</span>
        {check.detail ? <span className="vc-detail">{check.detail}</span> : null}
      </span>
    </li>
  )
}

export function ExportPanel(): JSX.Element {
  const { state } = useReview()
  const projectPath = state.projectPath

  const [deps, setDeps] = useState<DependencyStatus[]>([])
  const [report, setReport] = useState<KdpValidationReport | null>(null)
  const [pdfPath, setPdfPath] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDeps = useCallback(async () => {
    try {
      setDeps(await window.api.getDependencies())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadDeps()
  }, [loadDeps])

  const onExport = useCallback(async () => {
    if (!projectPath) return
    setExporting(true)
    setError(null)
    try {
      const result = await window.api.exportPdf(projectPath)
      setReport(result.validation)
      setPdfPath(result.pdfPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }, [projectPath])

  const onRevalidate = useCallback(async () => {
    if (!projectPath) return
    setValidating(true)
    setError(null)
    try {
      setReport(await window.api.validateExport(projectPath))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setValidating(false)
    }
  }, [projectPath])

  const exportDeps = deps.filter((d) => EXPORT_TOOLS.includes(d.name))
  const busy = exporting || validating
  const canRun = projectPath != null

  return (
    <div className="export-panel">
      <header className="ep-header">
        <h2>Export to KDP</h2>
        <p className="ep-subhead">
          Assemble and typeset the print-ready interior PDF, then read the validation report.
          Warnings are advisory — only failures block.
        </p>
      </header>

      {/* --- Toolchain readiness --- */}
      <section className="ep-card">
        <div className="ep-card-head">
          <h3>Toolchain</h3>
          <button type="button" onClick={() => void loadDeps()} disabled={busy}>
            Re-check
          </button>
        </div>
        {exportDeps.length === 0 ? (
          <p className="panel-empty">No toolchain status reported.</p>
        ) : (
          <ul className="ep-deps">
            {exportDeps.map((d) => {
              const ready = d.found && d.meetsMinimum
              return (
                <li key={d.name} className={`ep-dep ${ready ? 'ep-dep-ok' : 'ep-dep-missing'}`}>
                  <span className="ep-dep-dot" aria-hidden />
                  <span className="ep-dep-name">{d.name}</span>
                  <span className="ep-dep-status">
                    {d.found
                      ? d.meetsMinimum
                        ? (d.version ?? 'found')
                        : `outdated${d.version ? ` (${d.version})` : ''}`
                      : 'missing'}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* --- Actions --- */}
      <section className="ep-actions">
        <button
          type="button"
          className="ep-export"
          onClick={() => void onExport()}
          disabled={!canRun || busy}
        >
          {exporting ? 'Exporting…' : 'Export KDP PDF'}
        </button>
        <button
          type="button"
          onClick={() => void onRevalidate()}
          disabled={!canRun || busy}
          title="Recompute the validation report without rendering"
        >
          {validating ? 'Validating…' : 'Re-validate'}
        </button>
        {!canRun ? <span className="ep-hint">Open a book to export.</span> : null}
      </section>

      {error ? <p className="error ep-error">{error}</p> : null}

      {/* --- Report --- */}
      {report ? (
        <section className="ep-card ep-report">
          <div className="ep-pagecount">
            <span className="ep-pagecount-num">{report.pageCount}</span>
            <span className="ep-pagecount-label">
              interior pages
              <small>use this for your spine width</small>
            </span>
            <span className={`ep-readybadge ${report.ready ? 'ep-ready' : 'ep-notready'}`}>
              {report.ready ? 'Ready' : 'Not ready'}
            </span>
          </div>

          <ul className="vc-list">
            {report.checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>

          {pdfPath ? (
            <div className="ep-pdfpath">
              <span className="ep-pdfpath-label">PDF written to</span>
              <code className="ep-pdfpath-value">{pdfPath}</code>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
