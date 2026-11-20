import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * `scripts/storage.mjs`, run as a session runs it, against a stand-in for the
 * bucket (`fixtures/fake-r2.mjs`, which replaces `fetch`), so no request ever
 * leaves the machine and no real key is needed. It must refuse a destination
 * inside any copy of the tools, which is public, before it sends anything,
 * and a link planted where it writes beside a file must not carry the write
 * elsewhere. Made-up files only.
 */
const REPO = fileURLToPath(new URL('..', import.meta.url))
const FAKE = pathToFileURL(fileURLToPath(new URL('./fixtures/fake-r2.mjs', import.meta.url))).href
const dir = mkdtempSync(join(tmpdir(), 'storage-script-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// A copy of the tools: any folder whose package.json is the tools' own.
const tools = join(dir, 'tools-copy')
mkdirSync(join(tools, 'sub'), { recursive: true })
writeFileSync(join(tools, 'package.json'), readFileSync(join(REPO, 'package.json')))
const bucket = join(dir, 'bucket')
const file = join(dir, 'made-up-scan.pdf')
writeFileSync(file, 'Made-up bytes standing for a scan.\n')

const PROXIES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']

/** The command with the stand-in loaded first: `trap` makes any request a fault. */
function storage(args: string[], fake: 'trap' | string) {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const name of PROXIES) delete env[name]
  const r = spawnSync(process.execPath, ['--import', FAKE, 'scripts/storage.mjs', ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...env,
      FAKE_R2: fake,
      CLOUDFLARE_API_TOKEN: 'dummy-token-for-tests',
      CLOUDFLARE_ACCOUNT_ID: 'dummyaccount'
    }
  })
  return { status: r.status, out: r.stdout, err: r.stderr }
}

const KEY = `sources/${'a'.repeat(64)}.pdf`

describe('storage.mjs refuses the tools before it sends anything', () => {
  it('the stand-in catches a request, so "nothing was sent" means something', () => {
    const r = storage(['list'], 'trap')
    expect(r.status).toBe(97)
    expect(r.err).toMatch(/A REQUEST WAS SENT: GET api\.cloudflare\.com/)
  }, 30_000)

  it('get into a copy of the tools', () => {
    const r = storage(['get', KEY, join(tools, 'sub', 'scan.pdf')], 'trap')
    expect(r.err).not.toMatch(/A REQUEST WAS SENT/)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/Refusing to write .* inside the tools repository \(.*tools-copy\)/)
    expect(readdirSync(join(tools, 'sub'))).toEqual([])
  }, 30_000)

  it('get into a folder that links into a subfolder of a copy of the tools', () => {
    const link = join(dir, 'looks-like-scratch')
    symlinkSync(join(tools, 'sub'), link, 'dir')
    const r = storage(['get', KEY, join(link, 'scan.pdf')], 'trap')
    expect(r.err).not.toMatch(/A REQUEST WAS SENT/)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/inside the tools repository/)
    expect(readdirSync(join(tools, 'sub'))).toEqual([])
  }, 30_000)

  it('put with a copy of the tools as the shelf', () => {
    const r = storage(['put', file, '--kind', 'sources', '--shelf', tools], 'trap')
    expect(r.err).not.toMatch(/A REQUEST WAS SENT/)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/Refusing to write the storage list .* inside the tools repository/)
    expect(existsSync(join(tools, 'STORAGE.tsv'))).toBe(false)
  }, 30_000)
})

describe('storage.mjs writes beside a file without following a planted link', () => {
  const shelf = join(dir, 'shelf')
  mkdirSync(shelf)
  let key = ''

  it('put: a link at STORAGE.tsv.tmp into the tools is replaced, not written through', () => {
    const planted = join(tools, 'sub', 'planted.tsv')
    symlinkSync(planted, join(shelf, 'STORAGE.tsv.tmp'))
    const r = storage(['put', file, '--kind', 'sources', '--shelf', shelf], bucket)
    expect(r.status, r.err).toBe(0)
    key = JSON.parse(r.out).key
    expect(existsSync(planted)).toBe(false)
    expect(lstatSync(join(shelf, 'STORAGE.tsv')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(shelf, 'STORAGE.tsv'), 'utf8')).toContain(`${key}\t`)
  }, 30_000)

  it('get: a link at <file>.part into the tools is replaced, not written through', () => {
    const planted = join(tools, 'sub', 'planted.pdf')
    const out = join(dir, 'back', 'scan.pdf')
    mkdirSync(join(dir, 'back'))
    symlinkSync(planted, `${out}.part`)
    const r = storage(['get', key, out], bucket)
    expect(r.status, r.err).toBe(0)
    expect(existsSync(planted)).toBe(false)
    expect(lstatSync(out).isSymbolicLink()).toBe(false)
    expect(readFileSync(out)).toEqual(readFileSync(file))
  }, 30_000)
})
