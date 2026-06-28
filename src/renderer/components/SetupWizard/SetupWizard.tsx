/**
 * SetupWizard — first-run dependency bootstrapper (SPEC §12 #21). Calls
 * getDependencies() and lists the external tools the pipeline relies on
 * (Tesseract, OCRmyPDF, Pandoc, XeLaTeX, pdftoppm) with their found/version/
 * meetsMinimum status, what each is for, and plain-text install guidance. A
 * "Re-check" button re-runs detection.
 *
 * `hasMissingRequired` is exported so the integrator can decide whether to show
 * the wizard at all (e.g. gate startup until required tools are present).
 */
import { useCallback, useEffect, useState } from 'react'
import type { DependencyStatus } from '../../../shared/ipc-types'
import './SetupWizard.css'

/** Tools the app cannot function without. Optional tools (e.g. OCRmyPDF) inform
 * but don't gate, so `hasMissingRequired` only reports on these. */
const REQUIRED_TOOLS = ['tesseract', 'pandoc', 'xelatex', 'pdftoppm']

/**
 * True when any *required* tool is absent or below its minimum version. The
 * integrator uses this to decide whether to surface the wizard. Trivially pure:
 * a missing-or-outdated required tool ⇒ true.
 */
export function hasMissingRequired(deps: DependencyStatus[]): boolean {
  return REQUIRED_TOOLS.some((name) => {
    const dep = deps.find((d) => d.name === name)
    return !dep || !dep.found || !dep.meetsMinimum
  })
}

interface ToolInfo {
  /** Display name. */
  label: string
  /** Whether the app requires it. */
  required: boolean
  /** What the tool is used for, in one line. */
  purpose: string
  /** Plain-text install guidance URL. */
  url: string
}

/** Static descriptions keyed by canonical dependency id. */
const TOOL_INFO: Record<string, ToolInfo> = {
  tesseract: {
    label: 'Tesseract',
    required: true,
    purpose: 'OCR engine — reads text and coordinates from the scanned pages.',
    url: 'https://tesseract-ocr.github.io/tessdoc/Installation.html'
  },
  ocrmypdf: {
    label: 'OCRmyPDF',
    required: false,
    purpose: 'Adds a searchable text layer to source PDFs before processing.',
    url: 'https://ocrmypdf.readthedocs.io/en/latest/installation.html'
  },
  pandoc: {
    label: 'Pandoc',
    required: true,
    purpose: 'Converts the cleaned Markdown into the typesetting document.',
    url: 'https://pandoc.org/installing.html'
  },
  xelatex: {
    label: 'XeLaTeX (TeX Live)',
    required: true,
    purpose: 'Typesets the print-ready interior PDF with your chosen fonts.',
    url: 'https://tug.org/texlive/'
  },
  pdftoppm: {
    label: 'pdftoppm (Poppler)',
    required: true,
    purpose: 'Renders source PDF pages to images for the review instrument.',
    url: 'https://poppler.freedesktop.org/'
  }
}

/** Order tools are presented in the wizard. */
const TOOL_ORDER = ['tesseract', 'ocrmypdf', 'pandoc', 'xelatex', 'pdftoppm']

function statusText(dep: DependencyStatus | undefined): string {
  if (!dep || !dep.found) return 'Not found'
  if (!dep.meetsMinimum) {
    return `Found${dep.version ? ` (${dep.version})` : ''} — below minimum`
  }
  return dep.version ? `Found · ${dep.version}` : 'Found'
}

function statusKind(dep: DependencyStatus | undefined, required: boolean): string {
  if (dep && dep.found && dep.meetsMinimum) return 'sw-ok'
  return required ? 'sw-missing' : 'sw-optional'
}

export function SetupWizard(): JSX.Element {
  const [deps, setDeps] = useState<DependencyStatus[]>([])
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      setDeps(await window.api.getDependencies())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  const missing = hasMissingRequired(deps)

  return (
    <div className="setup-wizard">
      <header className="sw-header">
        <h2>Set up dependencies</h2>
        <p className="sw-subhead">
          This tool drives a few external programs. Install any that are missing,
          then re-check. Required tools must be present; optional ones add
          capabilities.
        </p>
        <div className="sw-summary">
          <span
            className={`sw-summary-badge ${missing ? 'sw-summary-missing' : 'sw-summary-ready'}`}
          >
            {missing ? 'Some required tools are missing' : 'All required tools present'}
          </span>
          <button type="button" onClick={() => void check()} disabled={checking}>
            {checking ? 'Checking…' : 'Re-check'}
          </button>
        </div>
        {error ? <p className="error sw-error">{error}</p> : null}
      </header>

      <ul className="sw-list">
        {TOOL_ORDER.map((name) => {
          const info = TOOL_INFO[name]!
          const dep = deps.find((d) => d.name === name)
          return (
            <li key={name} className={`sw-item ${statusKind(dep, info.required)}`}>
              <span className="sw-dot" aria-hidden />
              <div className="sw-item-body">
                <div className="sw-item-head">
                  <span className="sw-item-name">{info.label}</span>
                  {info.required ? (
                    <span className="sw-tag sw-tag-required">Required</span>
                  ) : (
                    <span className="sw-tag sw-tag-optional">Optional</span>
                  )}
                  <span className="sw-item-status">{statusText(dep)}</span>
                </div>
                <p className="sw-item-purpose">{info.purpose}</p>
                {dep?.path ? <code className="sw-item-path">{dep.path}</code> : null}
                <p className="sw-item-url">
                  Install guide: <span className="sw-url">{info.url}</span>
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
