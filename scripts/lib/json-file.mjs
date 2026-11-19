/**
 * Reading a JSON file, whatever wrote it.
 *
 * Windows PowerShell's `Out-File -Encoding utf8` (and older Notepad) puts a
 * byte-order mark, the invisible character U+FEFF, in front of the text, and
 * `JSON.parse` refuses it: "Unexpected token", on a file that looks perfect in
 * any editor. The scripts read their JSON files through here, so the mark is
 * dropped once, in one place. `test/json-file.test.ts` fails if a script goes
 * back to `JSON.parse(readFileSync(…))`.
 *
 * The rule is core's `stripBom` (`src/core/sync/storage.ts`, which reads
 * `STORAGE.tsv` through it). It is written again here because `drive.mjs` and
 * the other plain-Node scripts load this before anything can load TypeScript;
 * the same test holds the two level.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/** A leading UTF-8 byte-order mark removed. */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** `JSON.parse`, after the byte-order mark. */
export function parseJson(text) {
  return JSON.parse(stripBom(text))
}

/** A JSON file, read and parsed. */
export function readJsonSync(path) {
  return parseJson(readFileSync(path, 'utf8'))
}

/** A JSON file, read and parsed, without blocking. */
export async function readJson(path) {
  return parseJson(await readFile(path, 'utf8'))
}

/** A text file, read, without the byte-order mark. */
export async function readText(path) {
  return stripBom(await readFile(path, 'utf8'))
}
