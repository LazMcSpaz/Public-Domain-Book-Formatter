/**
 * App-level store for reusable style profiles (SPEC §7). Profiles live in
 * `userData/profiles/<id>.json` so a configured look can be applied across every
 * book/series, independent of any one project.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { StyleProfile } from '@core/model'

function profilesDir(): string {
  return join(app.getPath('userData'), 'profiles')
}

/** List all saved profiles; tolerant of a missing dir or a stray bad file. */
export async function listStyleProfiles(): Promise<StyleProfile[]> {
  const dir = profilesDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const profiles: StyleProfile[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = await readFile(join(dir, name), 'utf8')
      profiles.push(JSON.parse(raw) as StyleProfile)
    } catch {
      // Skip unreadable/corrupt profile files rather than failing the list.
    }
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name))
  return profiles
}

/** Persist a profile (atomic write: temp file + rename). */
export async function saveStyleProfile(profile: StyleProfile): Promise<void> {
  const dir = profilesDir()
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${profile.id}.json`)
  const tmp = `${target}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, JSON.stringify(profile, null, 2), 'utf8')
  const { rename } = await import('node:fs/promises')
  await rename(tmp, target)
}

export async function deleteStyleProfile(id: string): Promise<void> {
  await rm(join(profilesDir(), `${id}.json`), { force: true })
}
