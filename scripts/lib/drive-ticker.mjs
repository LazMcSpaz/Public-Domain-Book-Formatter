/**
 * Progress for a driver verb that takes most of an hour.
 *
 * The client waits on one HTTP reply, and a whole-book `recon` sends it only
 * at the end. So while it waits, this asks the driver how far the reading
 * has got (`recon --status`, a second request the driver answers at once)
 * and prints one line each time, to stderr, where a session running the verb
 * in the background reads it from the output file.
 */
import { request } from 'node:http'

/** POST one command to the driver and resolve with its reply text. */
export function ask(port, verb, args) {
  const body = JSON.stringify({ verb, args })
  return new Promise((done, fail) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => done(text))
        res.on('error', fail)
      }
    )
    req.on('error', fail)
    req.end(body)
  })
}

/** The line printed for one status reply, or null when nothing is under way. */
export function progressLine(status) {
  if (!status || status.reading !== 'under way') return null
  return `recon: leaf ${status.leaf} of ${status.of} (${status.phase}), ${status.elapsed} so far`
}

/**
 * Print the reading's progress every `every` milliseconds until stopped.
 * Returns the function that stops it. A failed poll prints nothing: the
 * verb's own reply is what reports a failure.
 */
export function tickRecon(port, print = (line) => console.error(line), every = 30_000) {
  const timer = setInterval(() => {
    ask(port, 'recon', ['--status'])
      .then((text) => {
        const line = progressLine(JSON.parse(text))
        if (line) print(line)
      })
      .catch(() => {})
  }, every)
  timer.unref()
  return () => clearInterval(timer)
}
