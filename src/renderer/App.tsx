/**
 * App — top-level view router and project-open orchestration.
 *
 * Three states: pick a source (OpenProjectView) → pipeline running (LoadingView)
 * → review (ReviewShell). All IPC/async orchestration lives here so the views
 * stay presentational; the loaded project lives in ReviewContext.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PipelineProgress } from '@shared/ipc-types'
import { useReview } from './store/ReviewContext'
import { OpenProjectView } from './components/OpenProjectView'
import { LoadingView } from './components/LoadingView'
import { ReviewShell } from './components/ReviewShell'

export function App(): JSX.Element {
  const { state, dispatch } = useReview()
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Forward pipeline progress events into local state for the loading view.
  useEffect(() => window.api.onPipelineProgress(setProgress), [])

  const pickPdf = useCallback(async () => {
    setError(null)
    const pdfPath = await window.api.openFileDialog([{ name: 'PDF', extensions: ['pdf'] }])
    if (!pdfPath) return
    setLoading(true)
    setProgress(null)
    try {
      const result = await window.api.runPipeline(pdfPath)
      const project = await window.api.openProject(result.projectPath)
      dispatch({ type: 'SET_PROJECT', project, projectPath: result.projectPath })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [dispatch])

  const openExisting = useCallback(async () => {
    setError(null)
    const projectPath = await window.api.openFolderDialog()
    if (!projectPath) return
    try {
      const project = await window.api.openProject(projectPath)
      dispatch({ type: 'SET_PROJECT', project, projectPath })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [dispatch])

  if (state.project) return <ReviewShell />
  if (loading) return <LoadingView progress={progress} />
  return (
    <OpenProjectView
      busy={loading}
      error={error}
      onPickPdf={pickPdf}
      onOpenExisting={openExisting}
    />
  )
}
