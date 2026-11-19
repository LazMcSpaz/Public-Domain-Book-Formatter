/**
 * The files inside a zip archive (an EPUB is one), read with Node alone.
 *
 * Enough of the format for reading an EPUB we or KDP made: the central
 * directory, stored and deflated entries. No zip64, no encryption; an archive
 * that needs either is refused with a message rather than half read.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** `[{ name, bytes }]` for every file entry whose name `want` accepts. */
export function readZip(buf, want = () => true) {
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('not a zip archive (no end-of-directory record)')
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  if (count === 0xffff || at === 0xffffffff)
    throw new Error('a zip64 archive, which this cannot read')
  const out = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== CENTRAL) throw new Error(`zip directory entry ${n} is damaged`)
    const flags = buf.readUInt16LE(at + 8)
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    at += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || !want(name)) continue
    if (flags & 1) throw new Error(`${name} is encrypted`)
    if (buf.readUInt32LE(local) !== LOCAL) throw new Error(`${name}: its local header is damaged`)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    if (method === 0) out.push({ name, bytes: raw })
    else if (method === 8) out.push({ name, bytes: inflateRawSync(raw) })
    else throw new Error(`${name} is compressed with method ${method}, which this cannot read`)
  }
  return out
}
