/**
 * The version GitHub names a file by: git's blob sha of its bytes.
 *
 * A flush now checks that the version the shelf names just before a write is
 * the blob sha of the exact bytes it read, and reads again when it is not (a
 * session's push landed in between). So a faked shelf in a browser check has to
 * answer the real sha, as GitHub does: a made-up one reads as a book that keeps
 * changing, and the flush rightly writes nothing.
 */
import { createHash } from 'node:crypto'

/** `git hash-object` of a string (as UTF-8) or of bytes. */
export function blobSha(content) {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex')
}
