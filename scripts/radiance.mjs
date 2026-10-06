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
/**
 * The artwork's box, wide to tall. Wider than any box it can be asked to fill.
 *
 * A picture wider than its box is scaled to the box's HEIGHT and cropped at the
 * sides, so two things hold exactly on every trim and in both placements: the
 * eye's height on the board is the fraction written into this file, and the
 * emblem prints at the width it was written for, because the only box height
 * either placement has is the full height of the cover sheet.
 *
 * 2.6 is set by the wrap. Across a whole 7x10 cover the eye sits on the front
 * panel and the far corner of the back is 13.5 in away, so the artwork's own
 * half-width has to reach it; at 2.6 it reaches 13.3 in across and 14.0 in to
 * its own corner. A front panel alone needs a twentieth of that and loses the
 * rest off the sides, which costs nothing but file.
 */
const BOX_ASPECT = 2.6
const TAPER = 0.3 // how much of a ray's widening it keeps once past the core
const FRAME_HEIGHT_IN = 10.25 // a 7x10 cover out to the bleed; sets the pixel scale only

/**
 * How far out the rays hold the fan's own weight, before they begin to thin.
 *
 * The engraving is an ellipse — its ink reaches 953 px at the sides and 464 at
 * the foot — so rays that begin thinning where each one leaves the fan begin
 * thinning at a different radius in every direction, and what a reader sees is
 * a wide flat lozenge of heavy ink round the eye with clean rays beyond it. The
 * lozenge is the fan's own outline, and it is the thing to be rid of.
 *
 * So every ray stays a wedge — the fan's angular width, held — out to the fan's
 * LONGEST reach, and only past that does any of them taper. The heavy zone is
 * then a circle rather than a lens, which reads as a radiance instead of as a
 * shape somebody cropped. Taken off the trace rather than set, so a re-traced
 * emblem moves it.
 */
const CORE_AT_MAX_REACH = true

// --- the texture, all of it measured off the trace -----------------------
//
// A carried ray was a clean polygon and an engraved one is not, so the two read
// as different materials and the join between them shows. Followed outward run
// by run, a ray of this fan wanders sideways about half its own width over the
// fan's depth (1.26 px per 10 px out, against a width of 8.7 px at that
// radius), and along its length it is a chain of dashes.
//
// The dash figures need one judgement and it is worth stating. Packed hatching
// gives dashes of 16 px and gaps of 12 px at the median — 57 per cent ink along
// the ray — but the pattern read round a circle is already that dashing, so
// breaking a carried ray at 57 per cent would halve a density the circle
// reading had got right. The breaks are therefore taken from the long end of
// the engraving's own dash distribution (its ninth decile, 67 px) with the
// median gap: a ray of the same material, cut less often.
//
// A ray is walked in the LOGARITHM of its radius, and that is not tidiness.
// Measured on the fan, a ray is 150 px deep; carried, it is ten times that. A
// wobble of a fixed wavelength then gives twenty-seven waves down its length
// and the board grows hair, and a dash of a fixed 67 px gives sixty beads on a
// string — both were printed and looked at. What the engraving actually holds
// constant is the stroke as a PROPORTION of where it is on the figure, which
// is a constant step in log r, so that is what a step here is. (A constant
// step in r / coreRadius is not the same thing and does not work: it is a
// fixed number of pixels under another name, which is the version that printed
// the foot of the board as bamboo.)
//
// The gap is the one length that does not scale, because a break is where the
// burin left the plate and that is the same size wherever on the figure it
// happens.
const WOBBLE = 0.7 // sideways wander, as a share of the ray's own half-width
const WOBBLE_LN = 0.8 // one wave per 2.2x of radius
const WIDTH_VAR = 0.3 // how much a ray's width breathes along its length
const WIDTH_LN = 0.35
const DASH_LN = 0.17 // a dash spans about a sixth of the radius it is at
// A burin enters and leaves the plate, so a stroke is a lens and not a bar.
// Cut square, a break across a ray a twentieth of an inch wide reads as a dash
// in a dashed line however narrow the gap is made — which is what the first
// textured emission printed, and no amount of shortening the gap fixed it.
// This is the shape of the taper: 1 is a pure lens, 0 a bar.
const NIB = 0.45
const GAP_PX = 12 // the fan's own median gap, in the trace's own pixels
const STEP_LN = 0.02 // how finely a ray's edges are built

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const [src, out] = args.filter(
  (a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.slice(0, 2) !== '--'
)
const emblemWidthIn = Number(flag('width', 3))
const eyeAt = Number(flag('at', 0.352))
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
const coreTo = CORE_AT_MAX_REACH ? Math.max(...env) : 0

const angleOf = (b) => ((b + 0.5) / BINS) * 2 * Math.PI
const point = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`

/**
 * Smooth noise in one dimension, from a seed, so every run writes the same file.
 *
 * A hash at each integer, cosine-interpolated between them, which is all the
 * wander needs — it is a wobble with a length, not a spectrum.
 */
function noise(seed, t) {
  const hash = (n) => {
    let h = Math.imul(n ^ seed, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 3266489917)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5
  }
  const i = Math.floor(t)
  const f = t - i
  const w = (1 - Math.cos(f * Math.PI)) / 2
  return hash(i) * (1 - w) + hash(i + 1) * w
}

const wedges = []
let dashes = 0
rays.forEach(([start, len], index) => {
  const mid = angleOf((start + (len - 1) / 2) % BINS)
  let rIn = 0
  for (let k = 0; k < len; k++) rIn += env[(start + k) % BINS] * DUTY_AT
  rIn /= len
  const half = (rIn * ((Math.min(len, cap) / BINS) * 2 * Math.PI)) / 2
  const ux = Math.cos(mid)
  const uy = Math.sin(mid)
  const nx = -uy
  const ny = ux
  const seed = Math.imul(index + 1, 2654435761)
  const holdTo = Math.max(coreTo, rIn)

  /** Half-width at a radius: the fan's own wedge to the core, thinning past it. */
  const halfAt = (r) =>
    r <= holdTo ? half * (r / rIn) : half * (holdTo / rIn) * Math.pow(r / holdTo, TAPER)

  /**
   * A point on the ray's wandering centre line, and its half-width there.
   *
   * `at` is how far along its own dash the point is, 0 to 1, which is what
   * draws the stroke's ends to a point.
   */
  const spine = (u, at) => {
    const r = Math.exp(u)
    const nib = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, at))), NIB)
    const w = halfAt(r) * (1 + WIDTH_VAR * 2 * noise(seed + 1, u / WIDTH_LN)) * nib
    const off = WOBBLE * halfAt(r) * 2 * noise(seed, u / WOBBLE_LN)
    return { x: EX + r * ux + off * nx, y: EY + r * uy + off * ny, w: Math.max(0.15, w) }
  }

  // Cut into dashes, so a carried ray is the same material as the fan's own.
  // The first starts under the fan's ink, where the reading was taken, so the
  // join is buried exactly as it was before the texture existed.
  const uEnd = Math.log(rOuter)
  let u = Math.log(rIn)
  while (u < uEnd) {
    const end = Math.min(uEnd, u + DASH_LN * (0.6 + 1.3 * (noise(seed + 2, u / DASH_LN) + 0.5)))
    const left = []
    const right = []
    for (let t = u; ; t = Math.min(end, t + STEP_LN)) {
      const p = spine(t, (t - u) / (end - u))
      left.push(point(p.x + p.w * nx, p.y + p.w * ny))
      right.push(point(p.x - p.w * nx, p.y - p.w * ny))
      if (t >= end) break
    }
    wedges.push(`M${left.join('L')}L${right.reverse().join('L')}Z`)
    dashes++
    const gap = Math.log1p(GAP_PX / Math.exp(end))
    u = end + gap * (0.5 + 1.4 * (noise(seed + 3, u / Math.max(gap, 1e-6)) + 0.5))
  }
})

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
  `${rays.length} rays carried out in ${dashes} dashes, the fan's weight held to ${coreTo.toFixed(0)}px; widths ${((widths[0] / BINS) * 360).toFixed(2)}deg to ${((widths.at(-1) / BINS) * 360).toFixed(2)}deg,`
)
console.log(
  `  capped at ${((cap / BINS) * 360).toFixed(2)}deg, which holds back ${rays.filter(([, l]) => l > cap).length}`
)
console.log(
  `${out}: ${VW}x${VH}, the emblem ${emblemWidthIn}in wide with its centre at ${(EY / VH).toFixed(4)} down the board`
)
