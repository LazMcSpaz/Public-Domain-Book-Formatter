import { describe, it, expect } from 'vitest'
import type { CommandRunner, CommandResult } from '@tooling/process'
import { detectTool, detectDependencies, compareVersions } from '@tooling/deps/detect'
import { REQUIRED_TOOLS } from '@tooling/deps/registry'

/** Build a mock runner that returns canned output and records calls. */
function mockRunner(
  responder: (cmd: string, args: string[]) => CommandResult | Promise<CommandResult>,
): CommandRunner & { calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const runner = (async (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    return responder(cmd, args)
  }) as CommandRunner & { calls: typeof calls }
  runner.calls = calls
  return runner
}

describe('compareVersions', () => {
  it('orders x.y.z correctly', () => {
    expect(compareVersions('5.3.0', '4.0.0')).toBe(1)
    expect(compareVersions('4.0.0', '5.3.0')).toBe(-1)
    expect(compareVersions('5.3.0', '5.3.0')).toBe(0)
  })

  it('treats a missing patch as 0', () => {
    expect(compareVersions('5.3', '5.3.0')).toBe(0)
    expect(compareVersions('5.3', '5.3.1')).toBe(-1)
    expect(compareVersions('5.4', '5.3.9')).toBe(1)
  })

  it('handles non-numeric components as 0', () => {
    expect(compareVersions('5.x', '5.0')).toBe(0)
  })
})

describe('detectTool', () => {
  const tesseract = REQUIRED_TOOLS.find((t) => t.name === 'tesseract')!

  it('reports found with version and meetsMinimum true', async () => {
    const run = mockRunner(() => ({
      code: 0,
      stdout: 'tesseract 5.3.0\n leptonica-1.82.0',
      stderr: '',
    }))
    const status = await detectTool(tesseract, run)
    expect(status.found).toBe(true)
    expect(status.version).toBe('5.3.0')
    expect(status.meetsMinimum).toBe(true)
    expect(run.calls[0]).toEqual({ cmd: 'tesseract', args: ['--version'] })
  })

  it('reports meetsMinimum false when below the floor', async () => {
    const run = mockRunner(() => ({
      code: 0,
      stdout: 'tesseract 3.05.00',
      stderr: '',
    }))
    const status = await detectTool(tesseract, run)
    expect(status.found).toBe(true)
    expect(status.version).toBe('3.05.00')
    expect(status.meetsMinimum).toBe(false)
  })

  it('reports not-found when the runner throws (binary missing)', async () => {
    const run = mockRunner(() => {
      throw new Error('spawn tesseract ENOENT')
    })
    const status = await detectTool(tesseract, run)
    expect(status.found).toBe(false)
    expect(status.version).toBeNull()
    expect(status.meetsMinimum).toBe(false)
  })

  it('reports not-found on a non-zero exit code', async () => {
    const run = mockRunner(() => ({ code: 127, stdout: '', stderr: 'not found' }))
    const status = await detectTool(tesseract, run)
    expect(status.found).toBe(false)
  })

  it('reads version from stderr (pdftoppm-style banner)', async () => {
    const pdftoppm = REQUIRED_TOOLS.find((t) => t.name === 'pdftoppm')!
    const run = mockRunner(() => ({
      code: 0,
      stdout: '',
      stderr: 'pdftoppm version 23.08.0',
    }))
    const status = await detectTool(pdftoppm, run)
    expect(status.found).toBe(true)
    expect(status.version).toBe('23.08.0')
    // minVersion is null → meetsMinimum is true.
    expect(status.meetsMinimum).toBe(true)
  })

  it('found-but-unparsable still counts as found, meetsMinimum from minVersion', async () => {
    const run = mockRunner(() => ({ code: 0, stdout: 'no version here', stderr: '' }))
    const status = await detectTool(tesseract, run)
    expect(status.found).toBe(true)
    expect(status.version).toBeNull()
    // tesseract has a minVersion but version is null → can't meet it.
    expect(status.meetsMinimum).toBe(false)
  })
})

describe('detectDependencies', () => {
  it('maps over all required tools', async () => {
    const run = mockRunner((cmd) => ({
      code: 0,
      stdout: `${cmd} 99.0.0`,
      stderr: `${cmd} version 99.0.0\nXeTeX 99.0.0`,
    }))
    const statuses = await detectDependencies(run)
    expect(statuses.map((s) => s.name)).toEqual([
      'tesseract',
      'ocrmypdf',
      'pandoc',
      'xelatex',
      'pdftoppm',
    ])
    expect(statuses.every((s) => s.found)).toBe(true)
  })
})
