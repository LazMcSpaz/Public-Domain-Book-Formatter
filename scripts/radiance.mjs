/**
 * Carry a traced emblem's rays out to the edges of the board.
 *
 * Written for Manly P. Hall's all-seeing eye, whose fan is a half-disc at the
 * foot of the cover when it prints as it was traced. The editor wanted the rays
 * extended in every direction, so the whole board is the radiance and the eye
 * sits in the middle of it.
 *
 * ## There is nothing in the trace to pick up and lengthen
 *
 * The engraving is one connected mass of ink with the slits between its rays
 * cut out of it, so the file is a single snaking contour and two hundred-odd
 * specks — classify it however you like, no contour is a ray. What there is, is
 * the pattern the rays make where they reach the rim: a ring of ink and gap in
 * the press's own irregular spacing. That is read off the ink and carried
 * straight outward, each run of ink becoming one ray on its own angle. Nothing
 * here is drawn: the angles, the widths and the gaps are all the engraving's,
 * and the emblem itself is written out untouched over the top of them.
 *
 * ## A ray goes out as a line, not as a widening wedge
 *
 * Carried out at its own angular width a ray keeps half the board inked at
 * every radius, which is a wash rather than a radiance — the first emission
 * covered a 7x10 in alternating black and ground right to the corners. What an
 * engraver draws is a hairline, so `TAPER` holds back most of the widening.
 *
 * ## The box is wider than any cover, on purpose
 *
 * A picture wider than its box is scaled to the box's HEIGHT and cropped at the
 * sides, so the eye's height on the board is the fraction written into the file,
 * exactly, on every trim — only the far ends of the rays are lost. At the
 * widest trim the studio offers, 8.5x11, the front panel out to the bleed is
 * 0.767 wide to tall; `BOX_ASPECT` is 0.80, above it. A box the shape of one
 * panel would be exact on that book and wrong on the next.
 *
 * Usage:
 *   node scripts/radiance.mjs public/devices/all-seeing-eye.svg \
 *     public/devices/all-seeing-eye-radiant.svg --width 3.8 --at 0.362
 */
import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BINS = 4320 // a twelfth of a degree
const DUTY_AT = 0.85 // where round the fan the ink pattern is read
const INK = 0.45 // coverage that counts as ink
const BOX_ASPECT = 0.8
const TAPER = 0.3 // how much of a ray's widening it keeps going out
const FRAME_HEIGHT_IN = 10.25 // a 7x10 cover out to the bleed; sets the pixel scale only

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const [src, out] = args.filter(
  (a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.slice(0, 2) !== '--'
)
const emblemWidthIn = Number(flag('width', 3.8))
const eyeAt = Number(flag('at', 0.362))
const givenCentre = flag('centre', null)

if (!src || !out) {
  console.error('usage: radiance.mjs <trace.svg> <out.svg> [--width in] [--at frac] [--centre x,y]')
  process.exit(2)
}

const svg = await readFile(resolve(src), 'utf8')
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })

const measured = await page.evaluate(
  async ({ svg, BINS, DUTY_AT, INK, givenCentre }) => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
    })
    const W = img.naturalWidth
    const H = img.naturalHeight
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, W, H)
    const d = ctx.getImageData(0, 0, W, H).data
    const ink = new Float64Array(W * H)
    for (let i = 0, p = 0; p < W * H; p++, i += 4) ink[p] = (d[i + 3] / 255) * (1 - d[i] / 255)
    const at = (x, y) => {
      const xi = Math.round(x)
      const yi = Math.round(y)
      return xi < 0 || yi < 0 || xi >= W || yi >= H ? 0 : ink[yi * W + xi]
    }

    // --- where the fan radiates from ------------------------------------
    //
    // Every stroke of an engraved sunburst points at the centre, and a stroke's
    // direction is the perpendicular of the image gradient — so at the true
    // centre the gradient is square to the radius wherever there is an edge.
    // Score a candidate by the share of gradient energy lying ALONG the radius,
    // which is the part a radial stroke cannot have, and take the minimum. It
    // uses every edge pixel and needs no opinion about what is a ray, which is
    // what the contour measurements it replaced all needed.
    //
    // Scored over a ring: inside it are the eye and the stars, which are not
    // radial and would count as error wherever the centre were put.
    const edges = []
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const gx = ink[y * W + x + 1] - ink[y * W + x - 1]
        const gy = ink[(y + 1) * W + x] - ink[(y - 1) * W + x]
        const g2 = gx * gx + gy * gy
        if (g2 > 0.04) edges.push(x, y, gx, gy, g2)
      }
    const rLo = Math.min(W, H) * 0.24
    const rHi = Math.min(W, H) * 0.51
    const radialShare = (cx, cy) => {
      let along = 0
      let all = 0
      for (let i = 0; i < edges.length; i += 5) {
        const dx = edges[i] - cx
        const dy = edges[i + 1] - cy
        const r = Math.hypot(dx, dy)
        if (r < rLo || r > rHi) continue
        const dot = (edges[i + 2] * dx + edges[i + 3] * dy) / r
        along += dot * dot
        all += edges[i + 4]
      }
      return all ? along / all : 1
    }
    let centre = givenCentre ?? [W / 2, H / 2]
    if (!givenCentre) {
      let step = Math.min(W, H) / 14
      for (let pass = 0; pass < 9; pass++) {
        let best = Infinity
        let found = centre
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++) {
            const p = [centre[0] + dx * step, centre[1] + dy * step]
            const s = radialShare(p[0], p[1])
            if (s < best) {
              best = s
              found = p
            }
          }
        centre = found
        step = Math.max(0.5, step / 2)
      }
    }
    const [cx, cy] = centre

    // --- the fan's rim, and the ink round it -----------------------------
    const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))
    const outer = new Float64Array(BINS)
    for (let b = 0; b < BINS; b++) {
      const a = ((b + 0.5) / BINS) * 2 * Math.PI
      const ux = Math.cos(a)
      const uy = Math.sin(a)
      let last = 0
      for (let r = Math.min(W, H) * 0.11; r < far; r += 1)
        if (at(cx + r * ux, cy + r * uy) > INK) last = r
      outer[b] = last
    }
    // An upper envelope, so the gaps between rays do not pull the rim inward.
    const halfWindow = Math.round(BINS / 48)
    const env = new Float64Array(BINS)
    for (let b = 0; b < BINS; b++) {
      const v = []
      for (let k = -halfWindow; k <= halfWindow; k++) v.push(outer[(b + k + BINS) % BINS])
      v.sort((p, q) => p - q)
      env[b] = v[Math.floor(0.9 * (v.length - 1))]
    }
    const duty = []
    for (let b = 0; b < BINS; b++) {
      const a = ((b + 0.5) / BINS) * 2 * Math.PI
      const r = env[b] * DUTY_AT
      duty.push(at(cx + r * Math.cos(a), cy + r * Math.sin(a)) > INK)
    }
    return { W, H, centre, env: [...env], duty, share: radialShare(cx, cy) }
  },
  { svg, BINS, DUTY_AT, INK, givenCentre: givenCentre ? givenCentre.split(',').map(Number) : null }
)
await browser.close()

const { W, H, centre, env, duty, share } = measured

/** Runs of consecutive true bins, wrapping round the circle. */
function runsOf(flags) {
  const n = flags.length
  const runs = []
  let start = -1
  for (let b = 0; b < n * 2; b++) {
    const on = flags[b % n]
    if (on && start < 0) start = b
    else if (!on && start >= 0) {
      if (b - start <= n) runs.push([start % n, b - start])
      start = -1
      if (b >= n) break
    }
    if (b >= n && start < 0) break
  }
  return runs
}

const rays = runsOf(duty).filter(([, len]) => len >= 4)

/**
 * A run far wider than the rest is rays the trace lost, not one wide ray.
 *
 * Where the engraving's slits close up — the merged ink below the bottom star,
 * and three other places on this emblem — one reading at a single radius sees
 * several rays as one, and carried out at that width they print as blots among
 * hairlines. So the carried width is capped at the runs' ninth decile: a ray
 * still leaves the fan where it does and at the angle it does, and only its
 * thickness is held to what the fan's own rays are.
 */
const widths = rays.map(([, len]) => len).sort((a, b) => a - b)
const cap = widths[Math.floor(0.9 * (widths.length - 1))]

const VH = Math.round((W * FRAME_HEIGHT_IN) / emblemWidthIn)
const VW = Math.round(VH * BOX_ASPECT)
const EX = VW / 2
const EY = VH * eyeAt
const rOuter = Math.hypot(Math.max(EX, VW - EX), Math.max(EY, VH - EY)) * 1.06

const angleOf = (b) => ((b + 0.5) / BINS) * 2 * Math.PI
const point = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`

const wedges = []
for (const [start, len] of rays) {
  const mid = angleOf((start + (len - 1) / 2) % BINS)
  let rIn = 0
  for (let k = 0; k < len; k++) rIn += env[(start + k) % BINS] * DUTY_AT
  rIn /= len
  const half = (rIn * ((Math.min(len, cap) / BINS) * 2 * Math.PI)) / 2
  const ux = Math.cos(mid)
  const uy = Math.sin(mid)
  const nx = -uy
  const ny = ux
  // The inner end follows the fan's own rim, so the join is buried in its ink.
  const steps = Math.max(2, Math.ceil(len / 24))
  const inner = []
  for (let k = 0; k <= steps; k++) {
    const b = (start + Math.round((k / steps) * (len - 1))) % BINS
    const a = angleOf(b)
    const r = env[b] * DUTY_AT
    inner.push(point(EX + r * Math.cos(a), EY + r * Math.sin(a)))
  }
  const halfOut = half * Math.pow(rOuter / rIn, TAPER)
  const tipX = EX + rOuter * ux
  const tipY = EY + rOuter * uy
  wedges.push(
    `M${inner.join('L')}` +
      `L${point(tipX + halfOut * nx, tipY + halfOut * ny)}` +
      `L${point(tipX - halfOut * nx, tipY - halfOut * ny)}Z`
  )
}

const body = /\sd="([^"]+)"/.exec(svg)[1]
await writeFile(
  resolve(out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}">
<path fill="#141414" d="${wedges.join('')}"/>
<g transform="translate(${(EX - centre[0]).toFixed(1)} ${(EY - centre[1]).toFixed(1)})"><path fill="#141414" fill-rule="evenodd" d="${body}"/></g>
</svg>\n`
)

console.log(
  `${src} is ${W}x${H}; it radiates from ${centre[0].toFixed(1)}, ${centre[1].toFixed(1)}`
)
console.log(
  `  = ${(centre[0] / W).toFixed(4)}, ${(centre[1] / H).toFixed(4)} of its box, at a radial share of ${share.toFixed(4)}`
)
console.log(
  `${rays.length} rays carried out; widths ${((widths[0] / BINS) * 360).toFixed(2)}deg to ${((widths.at(-1) / BINS) * 360).toFixed(2)}deg,`
)
console.log(
  `  capped at ${((cap / BINS) * 360).toFixed(2)}deg, which holds back ${rays.filter(([, l]) => l > cap).length}`
)
console.log(
  `${out}: ${VW}x${VH}, the emblem ${emblemWidthIn}in wide with its centre at ${(EY / VH).toFixed(4)} down the board`
)
