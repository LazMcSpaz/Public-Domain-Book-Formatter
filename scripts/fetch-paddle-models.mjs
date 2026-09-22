/**
 * Vendor the second reader's weights into `public/paddle/<tier>/`.
 *
 *   node scripts/fetch-paddle-models.mjs [tiny|small]
 *
 * `ppu-paddle-ocr` fetches its models from Hugging Face at run time. This
 * app fetches nothing at run time it can ship — Tesseract's core and language
 * data are vendored for the same reason — so the weights are downloaded once,
 * here, from the models repository's Git LFS host (the Hugging Face mirror is
 * unreachable from some networks, this session's among them), and committed
 * with their SHA-256 and their licence beside them. The files are Apache-2.0
 * (`public/paddle/LICENSE`, fetched with them); this package is MIT.
 *
 * Run it again to check: a file already present is re-hashed and reported,
 * never re-downloaded.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LFS =
  'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main'
const RAW = 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main'

/** The tiers the plan names. PP-OCRv6, `.ort` (pre-serialised, loads faster than `.onnx`). */
const TIERS = {
  tiny: {
    detection: `${LFS}/detection/ort/PP-OCRv6_tiny_det.ort`,
    recognition: `${LFS}/recognition/ort/PP-OCRv6_tiny_rec.ort`,
    dictionary: `${RAW}/recognition/ppocrv6_tiny_dict.txt`
  },
  small: {
    detection: `${LFS}/detection/ort/PP-OCRv6_small_det.ort`,
    recognition: `${LFS}/recognition/ort/PP-OCRv6_small_rec.ort`,
    dictionary: `${RAW}/recognition/ppocrv6_dict.txt`
  }
}
const FILES = { detection: 'det.ort', recognition: 'rec.ort', dictionary: 'dict.txt' }

const tier = process.argv[2] ?? 'tiny'
const urls = TIERS[tier]
if (!urls) {
  console.error(`usage: node scripts/fetch-paddle-models.mjs [${Object.keys(TIERS).join('|')}]`)
  process.exit(2)
}
const dir = join(ROOT, 'public', 'paddle', tier)
mkdirSync(dir, { recursive: true })

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function fetchBytes(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const licencePath = join(ROOT, 'public', 'paddle', 'LICENSE')
if (!existsSync(licencePath)) {
  writeFileSync(licencePath, await fetchBytes(`${RAW}/LICENSE`))
  console.log('fetched LICENSE (Apache-2.0)')
}

for (const [part, name] of Object.entries(FILES)) {
  const at = join(dir, name)
  if (existsSync(at)) {
    const bytes = readFileSync(at)
    console.log(`${tier}/${name}  present  ${bytes.length} bytes  sha256 ${sha(bytes)}`)
    continue
  }
  const bytes = await fetchBytes(urls[part])
  writeFileSync(at, bytes)
  console.log(
    `${tier}/${name}  fetched  ${bytes.length} bytes  sha256 ${sha(bytes)}  from ${urls[part]}`
  )
}
