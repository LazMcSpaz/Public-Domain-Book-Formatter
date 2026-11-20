/**
 * Which Chromium a browser script drives.
 *
 * `CHROMIUM_PATH` wins when it is set. Otherwise the sandbox's vendored
 * browser is used if it is actually there, and where it is not (any other
 * machine, or a sandbox whose browser has moved on a version) the answer is
 * undefined, so Playwright launches the copy it installed itself. A path that
 * was only ever right on one machine fails with a missing executable, which
 * reads like a broken install: the cover scripts carried one such path.
 */
import { existsSync } from 'node:fs'

const VENDORED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

/** The executable to hand `chromium.launch`, or undefined for Playwright's own. */
export function chromiumPath(env = process.env, exists = existsSync) {
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH
  return exists(VENDORED) ? VENDORED : undefined
}
