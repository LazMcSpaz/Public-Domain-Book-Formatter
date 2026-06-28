/**
 * ReviewContext — the single source of truth for the review instrument.
 *
 * Holds `ReviewState` in a `useReducer` and exposes it (plus `dispatch`) through
 * React context. Components call `useReview()` to read state and dispatch
 * actions. The coordinate-map lookup index is rebuilt here whenever a project
 * loads, so consumers never construct it themselves.
 */
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode
} from 'react'
import { createCoordinateMap } from '@core/model'
import { DEFAULT_READING_PREFS, EMPTY_HOVER, type ReviewAction, type ReviewState } from './types'

const INITIAL_STATE: ReviewState = {
  project: null,
  projectPath: null,
  coordinateMap: null,
  readingPrefs: DEFAULT_READING_PREFS,
  hover: EMPTY_HOVER,
  activeFlagIndex: -1,
  dirtyTokenIds: new Set<string>(),
  activeTagId: null,
  activeImageRegion: null,
  activeView: 'review',
  isDirty: false
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'SET_PROJECT':
      return {
        ...state,
        project: action.project,
        projectPath: action.projectPath,
        coordinateMap: createCoordinateMap(action.project.coordinateMap),
        hover: EMPTY_HOVER,
        activeFlagIndex: -1,
        dirtyTokenIds: new Set<string>(),
        activeTagId: null,
        activeImageRegion: null,
        activeView: 'review',
        isDirty: false
      }

    case 'CLOSE_PROJECT':
      return { ...INITIAL_STATE, readingPrefs: state.readingPrefs }

    case 'SET_MARKDOWN': {
      if (!state.project) return state
      const dirty = new Set(state.dirtyTokenIds)
      for (const id of action.dirtyTokenIds ?? []) dirty.add(id)
      return {
        ...state,
        project: { ...state.project, markdown: action.markdown },
        dirtyTokenIds: dirty,
        isDirty: true
      }
    }

    case 'SET_HOVER':
      return { ...state, hover: action.hover }

    case 'CLEAR_HOVER':
      return { ...state, hover: EMPTY_HOVER }

    case 'SET_READING_PREFS':
      return { ...state, readingPrefs: { ...state.readingPrefs, ...action.prefs } }

    case 'TOGGLE_TINT':
      return {
        ...state,
        readingPrefs: {
          ...state.readingPrefs,
          confidenceTint: !state.readingPrefs.confidenceTint
        }
      }

    case 'SET_ACTIVE_FLAG':
      return { ...state, activeFlagIndex: action.index }

    case 'SET_FLAGS':
      if (!state.project) return state
      return { ...state, project: { ...state.project, flags: action.flags }, isDirty: true }

    case 'SET_FIND_REPLACE':
      if (!state.project) return state
      return {
        ...state,
        project: { ...state.project, findReplace: action.rules },
        isDirty: true
      }

    case 'PATCH_PROJECT':
      if (!state.project) return state
      return { ...state, project: { ...state.project, ...action.patch }, isDirty: true }

    case 'MARK_SAVED':
      return { ...state, isDirty: false }

    // --- Phase 3: structural tagging (SPEC §5) ---
    case 'ADD_TAG':
      if (!state.project) return state
      return {
        ...state,
        project: { ...state.project, tags: [...state.project.tags, action.tag] },
        activeTagId: action.tag.id,
        isDirty: true
      }

    case 'REMOVE_TAG':
      if (!state.project) return state
      return {
        ...state,
        project: {
          ...state.project,
          tags: state.project.tags.filter((t) => t.id !== action.id)
        },
        activeTagId: state.activeTagId === action.id ? null : state.activeTagId,
        isDirty: true
      }

    case 'UPDATE_TAG':
      if (!state.project) return state
      return {
        ...state,
        project: {
          ...state.project,
          tags: state.project.tags.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t))
        },
        isDirty: true
      }

    case 'SET_ACTIVE_TAG':
      return { ...state, activeTagId: action.id }

    // --- Phase 3: images (SPEC §6) ---
    case 'SET_REGION_ACCEPTED':
      if (!state.project) return state
      return {
        ...state,
        project: {
          ...state.project,
          pages: state.project.pages.map((p) =>
            p.index === action.pageIndex
              ? {
                  ...p,
                  regions: p.regions.map((r) =>
                    r.id === action.regionId ? { ...r, accepted: action.accepted } : r
                  )
                }
              : p
          )
        },
        isDirty: true
      }

    case 'SET_PAGES':
      if (!state.project) return state
      return { ...state, project: { ...state.project, pages: action.pages }, isDirty: true }

    case 'SET_IMAGE_EDITS': {
      if (!state.project) return state
      const existing = state.project.imageEdits
      const has = existing.some((e) => e.regionId === action.regionId)
      const imageEdits = has
        ? existing.map((e) =>
            e.regionId === action.regionId ? { regionId: action.regionId, ops: action.ops } : e
          )
        : [...existing, { regionId: action.regionId, ops: action.ops }]
      return { ...state, project: { ...state.project, imageEdits }, isDirty: true }
    }

    case 'OPEN_IMAGE_EDITOR':
      return {
        ...state,
        activeImageRegion: { pageIndex: action.pageIndex, regionId: action.regionId }
      }

    case 'CLOSE_IMAGE_EDITOR':
      return { ...state, activeImageRegion: null }

    // --- Phase 4: style profile, front matter, navigation (SPEC §7) ---
    case 'SET_STYLE_PROFILE':
      if (!state.project) return state
      return {
        ...state,
        project: { ...state.project, styleProfileId: action.styleProfileId },
        isDirty: true
      }

    case 'PATCH_FRONT_MATTER':
      if (!state.project) return state
      return {
        ...state,
        project: {
          ...state.project,
          frontMatter: { ...state.project.frontMatter, ...action.patch }
        },
        isDirty: true
      }

    case 'SET_ACTIVE_VIEW':
      return { ...state, activeView: action.view }

    default:
      return state
  }
}

interface ReviewContextValue {
  state: ReviewState
  dispatch: Dispatch<ReviewAction>
}

const ReviewContext = createContext<ReviewContextValue | null>(null)

export function ReviewProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reviewReducer, INITIAL_STATE)
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
}

/** Access review state + dispatch. Throws if used outside the provider. */
export function useReview(): ReviewContextValue {
  const ctx = useContext(ReviewContext)
  if (!ctx) throw new Error('useReview must be used within a ReviewProvider')
  return ctx
}
