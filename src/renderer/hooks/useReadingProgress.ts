/**
 * useReadingProgress — reads and updates the reading-progress slice of the
 * project (SPEC §9). This is reading *position* (where the user left off and
 * which pages they've approved), kept distinct from edit state.
 *
 * Mutators shallow-merge into `project.readingProgress` via PATCH_PROJECT so the
 * reducer's dirty-tracking and persistence flow stay intact.
 */
import { useCallback } from 'react'
import { useReview } from '../store/ReviewContext'

export interface UseReadingProgress {
  lastPageIndex: number
  approvedPages: number[]
  markApproved(pageIndex: number): void
  setLastPage(pageIndex: number): void
}

export function useReadingProgress(): UseReadingProgress {
  const { state, dispatch } = useReview()
  const progress = state.project?.readingProgress
  const lastPageIndex = progress?.lastPageIndex ?? 0
  const approvedPages = progress?.approvedPages ?? []

  const setLastPage = useCallback(
    (pageIndex: number) => {
      if (!state.project) return
      dispatch({
        type: 'PATCH_PROJECT',
        patch: {
          readingProgress: {
            ...state.project.readingProgress,
            lastPageIndex: pageIndex
          }
        }
      })
    },
    [state.project, dispatch]
  )

  const markApproved = useCallback(
    (pageIndex: number) => {
      if (!state.project) return
      const current = state.project.readingProgress.approvedPages
      if (current.includes(pageIndex)) return
      dispatch({
        type: 'PATCH_PROJECT',
        patch: {
          readingProgress: {
            ...state.project.readingProgress,
            approvedPages: [...current, pageIndex].sort((a, b) => a - b)
          }
        }
      })
    },
    [state.project, dispatch]
  )

  return { lastPageIndex, approvedPages, markApproved, setLastPage }
}
