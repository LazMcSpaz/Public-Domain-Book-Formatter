/**
 * CurveEditor — a small draggable tone-curve widget (SPEC §6 "curves").
 *
 * Produces control points `[input, output]` in 0..255 (input ascending). The
 * engine's `curves` op builds a LUT from these. Endpoints are locked in x (0 and
 * 255) but movable in y; interior points drag freely (x clamped between
 * neighbors). Click an empty spot to add a point; double-click a point to remove
 * it. Pure-presentational: all state lives in the parent via `onChange`.
 */
import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import './CurveEditor.css'

export type CurvePoint = [number, number]

export const IDENTITY_CURVE: CurvePoint[] = [
  [0, 0],
  [255, 255]
]

export function isIdentityCurve(points: readonly CurvePoint[]): boolean {
  return (
    points.length === 2 &&
    points[0]![0] === 0 &&
    points[0]![1] === 0 &&
    points[1]![0] === 255 &&
    points[1]![1] === 255
  )
}

interface CurveEditorProps {
  points: CurvePoint[]
  onChange: (points: CurvePoint[]) => void
}

const DOMAIN = 255

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function CurveEditor({ points, onChange }: CurveEditorProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragIndex = useRef<number | null>(null)

  /** Map a pointer event to domain coords (0..255, y already un-inverted). */
  const toDomain = useCallback((clientX: number, clientY: number): CurvePoint => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const rect = svg.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * DOMAIN
    const yTop = ((clientY - rect.top) / rect.height) * DOMAIN
    return [clamp(Math.round(x), 0, DOMAIN), clamp(Math.round(DOMAIN - yTop), 0, DOMAIN)]
  }, [])

  const onPointerMove = useCallback(
    (clientX: number, clientY: number) => {
      const i = dragIndex.current
      if (i === null) return
      const [nx, ny] = toDomain(clientX, clientY)
      const last = points.length - 1
      const next = points.map((p) => [...p] as CurvePoint)
      if (i === 0) next[0] = [0, ny]
      else if (i === last) next[last] = [DOMAIN, ny]
      else {
        const lo = points[i - 1]![0] + 1
        const hi = points[i + 1]![0] - 1
        next[i] = [clamp(nx, lo, hi), ny]
      }
      onChange(next)
    },
    [points, onChange, toDomain]
  )

  const startDrag = useCallback(
    (index: number, e: ReactPointerEvent) => {
      e.stopPropagation()
      dragIndex.current = index
      const move = (ev: globalThis.PointerEvent): void => onPointerMove(ev.clientX, ev.clientY)
      const up = (): void => {
        dragIndex.current = null
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [onPointerMove]
  )

  /** Click on empty canvas → insert a new control point at that x. */
  const addPoint = useCallback(
    (e: ReactPointerEvent) => {
      const [nx, ny] = toDomain(e.clientX, e.clientY)
      if (nx <= 0 || nx >= DOMAIN) return
      const next = points.filter((p) => p[0] !== nx)
      next.push([nx, ny])
      next.sort((a, b) => a[0] - b[0])
      onChange(next)
    },
    [points, onChange, toDomain]
  )

  const removePoint = useCallback(
    (index: number, e: { stopPropagation: () => void }) => {
      e.stopPropagation()
      if (index === 0 || index === points.length - 1) return
      onChange(points.filter((_, i) => i !== index))
    },
    [points, onChange]
  )

  // SVG y is inverted (output 255 at top).
  const toSvg = (p: CurvePoint): [number, number] => [p[0], DOMAIN - p[1]]
  const path = points.map((p) => toSvg(p)).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ')

  return (
    <div className="curve-editor">
      <svg
        ref={svgRef}
        className="curve-editor__svg"
        viewBox={`0 0 ${DOMAIN} ${DOMAIN}`}
        preserveAspectRatio="none"
        onPointerDown={addPoint}
      >
        <line x1={0} y1={DOMAIN} x2={DOMAIN} y2={0} className="curve-editor__diag" />
        <path d={path} className="curve-editor__curve" fill="none" />
        {points.map((p, i) => {
          const [cx, cy] = toSvg(p)
          return (
            <circle
              key={`${p[0]}-${i}`}
              cx={cx}
              cy={cy}
              r={6}
              className="curve-editor__pt"
              onPointerDown={(e) => startDrag(i, e)}
              onDoubleClick={(e) => removePoint(i, e)}
            />
          )
        })}
      </svg>
      <p className="ie-note">Drag points · click to add · double-click to remove</p>
    </div>
  )
}
