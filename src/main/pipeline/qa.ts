import { alphaBBox, colorDistance } from './image'
import type { CheckStatus, QaCheck, QaOptions, QaReport, RawImage, Side } from './types'

function edgeMaxAlpha(img: RawImage, side: Side): number {
  const { width: w, height: h, data } = img
  let max = 0
  const len = side === 'left' || side === 'right' ? h : w
  for (let t = 0; t < len; t++) {
    let p: number
    if (side === 'top') p = t
    else if (side === 'bottom') p = (h - 1) * w + t
    else if (side === 'left') p = t * w
    else p = t * w + w - 1
    const a = data[p * 4 + 3]
    if (a > max) max = a
  }
  return max
}

export function qa(result: RawImage, original: RawImage, resultHasAlpha: boolean, options: QaOptions = {}): QaReport {
  const checks: QaCheck[] = []
  const edgeMax = options.edgeAlphaMax ?? 20
  const minFill = options.minFill ?? 0.85
  const anchored = options.edgeAnchored ?? []
  const sizeOk = result.width === original.width && result.height === original.height
  checks.push({
    id: 'size',
    status: sizeOk ? 'pass' : 'fail',
    value: result.width * 10000 + result.height,
    threshold: original.width * 10000 + original.height,
    message: `${result.width}x${result.height} vs ${original.width}x${original.height}`
  })
  checks.push({
    id: 'alpha',
    status: resultHasAlpha ? 'pass' : 'fail',
    value: resultHasAlpha ? 1 : 0,
    threshold: 1,
    message: resultHasAlpha ? 'RGBA' : 'no alpha channel'
  })
  const sides: Side[] = ['left', 'right', 'top', 'bottom']
  const bad: string[] = []
  let worst = 0
  for (const side of sides) {
    if (anchored.includes(side)) continue
    const m = edgeMaxAlpha(result, side)
    if (m > worst) worst = m
    if (m > edgeMax) bad.push(`${side}=${m}`)
  }
  checks.push({
    id: 'edges',
    status: bad.length ? 'fail' : 'pass',
    value: worst,
    threshold: edgeMax,
    message: bad.length ? `alpha on edges: ${bad.join(', ')}` : `max edge alpha ${worst}${anchored.length ? ` (anchored: ${anchored.join(',')})` : ''}`
  })
  const ob = alphaBBox(original)
  const rb = alphaBBox(result)
  let fill = 0
  if (ob && rb) fill = Math.min(rb.w / ob.w, rb.h / ob.h, 1)
  checks.push({
    id: 'fill',
    status: fill >= minFill ? 'pass' : 'warn',
    value: Math.round(fill * 1000) / 1000,
    threshold: minFill,
    message: rb && ob ? `bbox ${rb.w}x${rb.h} vs original ${ob.w}x${ob.h}` : 'empty image'
  })
  if (options.chroma) {
    const chroma = options.chroma
    const tol = options.chromaDistance ?? 70
    const maxRatio = options.chromaMaxRatio ?? 0.002
    const { data } = result
    let visible = 0
    let leftover = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue
      visible++
      if (colorDistance(data[i], data[i + 1], data[i + 2], chroma) < tol) leftover++
    }
    const ratio = visible ? leftover / visible : 0
    const status: CheckStatus = ratio > maxRatio ? 'fail' : leftover > 0 ? 'warn' : 'pass'
    checks.push({
      id: 'chroma',
      status,
      value: leftover,
      threshold: maxRatio,
      message: `${leftover} chroma-like px (${(ratio * 100).toFixed(2)}% of visible)`
    })
  }
  const minCoverage = options.minCoverage ?? 0.9
  let solid = 0
  let covered = 0
  for (let i = 3; i < original.data.length && sizeOk; i += 4) {
    if (original.data[i] < 250) continue
    solid++
    if (result.data[i] >= 128) covered++
  }
  const coverage = solid ? covered / solid : 1
  checks.push({
    id: 'coverage',
    status: coverage >= minCoverage ? 'pass' : 'warn',
    value: Math.round(coverage * 1000) / 1000,
    threshold: minCoverage,
    message: `${covered}/${solid} solid original px covered`
  })
  return { pass: checks.every((c) => c.status !== 'fail'), checks }
}
