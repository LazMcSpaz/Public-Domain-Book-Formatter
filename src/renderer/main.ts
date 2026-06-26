/**
 * Renderer bootstrap — a minimal vanilla-TS placeholder UI that proves the
 * preload bridge works. This is NOT the Phase-2 review instrument; it just
 * exercises `window.api.getDependencies()` and `window.api.onPipelineProgress`.
 */
import type { DependencyStatus, PipelineProgress } from '@shared/ipc-types'
import './styles.css'

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) {
    throw new Error(`Expected element #${id} in the DOM`)
  }
  return el as T
}

/** Render the dependency report as a list of rows. */
function renderDependencies(target: HTMLUListElement, deps: DependencyStatus[]): void {
  target.replaceChildren()

  if (deps.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'No dependencies reported.'
    target.append(li)
    return
  }

  for (const dep of deps) {
    const li = document.createElement('li')
    li.className = dep.found && dep.meetsMinimum ? 'dep dep-ok' : 'dep dep-bad'

    const name = document.createElement('span')
    name.className = 'dep-name'
    name.textContent = dep.name

    const status = document.createElement('span')
    status.className = 'dep-detail'
    if (!dep.found) {
      status.textContent = 'not found'
    } else {
      const version = dep.version ?? 'unknown version'
      const min = dep.meetsMinimum ? 'meets minimum' : 'below minimum'
      status.textContent = `${version} — ${min}`
    }

    li.append(name, status)
    target.append(li)
  }
}

function describeProgress(progress: PipelineProgress): string {
  const stageNo = progress.index + 1
  const detail = progress.message ? ` — ${progress.message}` : ''
  return `Stage ${stageNo}/${progress.total}: ${progress.stage}${detail}`
}

function init(): void {
  const checkButton = requireEl<HTMLButtonElement>('check-deps')
  const depsList = requireEl<HTMLUListElement>('deps-list')
  const progressStatus = requireEl<HTMLDivElement>('progress-status')

  checkButton.addEventListener('click', () => {
    void (async () => {
      checkButton.disabled = true
      depsList.replaceChildren()
      const pending = document.createElement('li')
      pending.className = 'empty'
      pending.textContent = 'Checking…'
      depsList.append(pending)

      try {
        const deps = await window.api.getDependencies()
        renderDependencies(depsList, deps)
      } catch (error) {
        depsList.replaceChildren()
        const li = document.createElement('li')
        li.className = 'dep dep-bad'
        li.textContent = `Failed to check dependencies: ${
          error instanceof Error ? error.message : String(error)
        }`
        depsList.append(li)
      } finally {
        checkButton.disabled = false
      }
    })()
  })

  // Live pipeline progress subscription. Unsubscribe on unload to avoid leaks.
  const unsubscribe = window.api.onPipelineProgress((progress) => {
    progressStatus.textContent = describeProgress(progress)
    progressStatus.classList.add('active')
  })
  window.addEventListener('beforeunload', unsubscribe)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
