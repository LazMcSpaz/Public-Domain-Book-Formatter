/**
 * Process-execution seam (SPEC §2 tool chain).
 *
 * Every external-tool wrapper and the dependency detector run their commands
 * through a `CommandRunner` rather than calling `child_process` directly. The
 * real runner is `runCommand`; tests inject a mock runner that records argv and
 * returns canned output, so the entire tooling/pipeline layer is unit-testable
 * WITHOUT any system binaries (tesseract/ocrmypdf/pandoc/xelatex/pdftoppm)
 * installed.
 */
import { spawn } from 'node:child_process'

/** The captured outcome of running a command. */
export interface CommandResult {
  /** Process exit code (or a non-zero sentinel on signal). */
  code: number
  stdout: string
  stderr: string
}

/** Knobs for a single command run. */
export interface RunOptions {
  /** Working directory for the child process. */
  cwd?: string
  /** Kill the process (and reject) if it runs longer than this many ms. */
  timeoutMs?: number
  /** Cancellation: abort the run, killing the child and rejecting. */
  signal?: AbortSignal
}

/**
 * The injectable seam. A runner takes a command + argv and resolves with the
 * captured result. It resolves on completion regardless of exit code (callers
 * decide what a non-zero code means); it rejects only on a spawn error, a
 * timeout, or an abort.
 */
export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: RunOptions
) => Promise<CommandResult>

/**
 * Real `CommandRunner` backed by `node:child_process` `spawn`.
 *
 * - Captures stdout/stderr in full.
 * - Resolves with the exit code on normal exit (does NOT throw on non-zero).
 * - Rejects on spawn error, on `timeoutMs` elapsing (killing the child), and on
 *   `signal` abort (killing the child).
 */
export const runCommand: CommandRunner = (cmd, args, opts = {}) => {
  return new Promise<CommandResult>((resolve, reject) => {
    const { cwd, timeoutMs, signal } = opts

    if (signal?.aborted) {
      reject(new Error(`Command aborted before start: ${cmd}`))
      return
    }

    const child = spawn(cmd, args, { cwd })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    const finish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const onAbort = (): void => {
      child.kill('SIGKILL')
      fail(new Error(`Command aborted: ${cmd}`))
    }

    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        fail(new Error(`Command timed out after ${timeoutMs}ms: ${cmd}`))
      }, timeoutMs)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      fail(err)
    })

    child.on('close', (code, sig) => {
      // A null exit code means the process was terminated by a signal; surface
      // a non-zero sentinel so callers don't read it as success.
      const exitCode = code ?? (sig ? 137 : 1)
      finish({ code: exitCode, stdout, stderr })
    })
  })
}
