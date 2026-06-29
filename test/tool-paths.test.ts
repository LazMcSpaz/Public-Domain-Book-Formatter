import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  resolveToolPath,
  isBundled,
  platformDir,
  binFileName,
  type ResolveEnv
} from '../src/tooling/tool-paths'

function env(over: Partial<ResolveEnv>): ResolveEnv {
  return {
    platform: 'linux',
    resourcesPath: null,
    binDirOverride: null,
    exists: () => false,
    ...over
  }
}

describe('platformDir / binFileName', () => {
  it('maps platforms to bin subfolders', () => {
    expect(platformDir('win32')).toBe('win')
    expect(platformDir('darwin')).toBe('mac')
    expect(platformDir('linux')).toBe('linux')
  })

  it('adds .exe only on Windows', () => {
    expect(binFileName('pandoc', 'win32')).toBe('pandoc.exe')
    expect(binFileName('pandoc', 'darwin')).toBe('pandoc')
  })
})

describe('resolveToolPath', () => {
  it('falls back to the bare name when nothing is bundled', () => {
    expect(resolveToolPath('tesseract', env({}))).toBe('tesseract')
  })

  it('returns the bundled path under <resources>/bin/<os> when it exists', () => {
    // Use path.join so the expectation matches the host's separator (the resolver
    // uses node:path, which is POSIX on the CI/Linux test host).
    const expected = join('/app/resources', 'bin', 'win', 'tesseract.exe')
    const e = env({
      platform: 'win32',
      resourcesPath: '/app/resources',
      exists: (p) => p === expected
    })
    expect(resolveToolPath('tesseract', e)).toBe(expected)
  })

  it('prefers the override dir over the resources dir', () => {
    const e = env({
      platform: 'linux',
      binDirOverride: '/opt/pdbf/bin',
      resourcesPath: '/app/resources',
      exists: (p) => p === '/opt/pdbf/bin/pandoc' || p === '/app/resources/bin/linux/pandoc'
    })
    expect(resolveToolPath('pandoc', e)).toBe('/opt/pdbf/bin/pandoc')
  })

  it('resolves xelatex inside its bundled TinyTeX tree', () => {
    const expected = join('/app/resources', 'bin', 'win', 'tinytex/bin/windows/xelatex.exe')
    const e = env({
      platform: 'win32',
      resourcesPath: '/app/resources',
      exists: (p) => p === expected
    })
    expect(resolveToolPath('xelatex', e)).toBe(expected)
  })

  it('passes an already-pathlike input through unchanged', () => {
    const e = env({ exists: () => true })
    expect(resolveToolPath('/usr/bin/xelatex', e)).toBe('/usr/bin/xelatex')
    expect(resolveToolPath('./local/tool', e)).toBe('./local/tool')
  })
})

describe('isBundled', () => {
  it('is true only when a bundled binary resolves', () => {
    const present = env({
      platform: 'darwin',
      resourcesPath: '/A/resources',
      exists: (p) => p === '/A/resources/bin/mac/pandoc'
    })
    expect(isBundled('pandoc', present)).toBe(true)
    expect(isBundled('pandoc', env({}))).toBe(false)
  })
})
