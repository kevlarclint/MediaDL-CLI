import React, {useEffect, useMemo, useState} from 'react'
import {Box, Text} from 'ink'
import {type Theme, useTheme} from '../theme.js'

const ART = [
  '█▄█ █▀▀ █▀▄ ▀█▀ █▀█ █▀▄ █  ',
  '█ █ █▀▀ █ █  █  █▀█ █ █ █  ',
  '▀ ▀ ▀▀▀ ▀▀  ▀▀▀ ▀ ▀ ▀▀  ▀▀▀',
]
const GRID = ART.map(line => [...line])
const ROWS = GRID.length

// intro: each glyph flickers in as ░, sharpens to ▒, then resolves
const INTRO_MS = 900
const INTRO_SPREAD_MS = 550
// shimmer: a tilted beam crosses the glyphs, thinning them one density step
const SWEEP_MS = 1000
const SWEEP_EVERY_MS = 7_000
const TILT = 2 // columns of lean per row — beam slants like /
const HALF = 2.4 // beam half-width
// full-cell blocks can swap to a lighter shade char; half-blocks (▀ ▄) must
// keep their glyph or the effect spills outside the letterform — they dim instead
const LIGHTER: Record<string, string> = {'█': '▒', '▓': '░'}
const HALF_BLOCKS = new Set(['▀', '▄'])

const ease = (t: number) => 1 - Math.pow(1 - t, 3)

type Phase = 'intro' | 'idle' | 'sweep'

function cellAt(ch: string, row: number, col: number, phase: Phase, t: number, delay: number, theme: Theme) {
  if (ch === ' ' || phase === 'idle') return {ch, color: theme.primary, dim: false}
  if (phase === 'intro') {
    const dt = t - delay
    if (dt < 0) return {ch: ' ', color: theme.primary, dim: false}
    if (dt < 110) return {ch: HALF_BLOCKS.has(ch) ? ch : '░', color: theme.gray, dim: theme.dimSecondary}
    if (dt < 220) return {ch: HALF_BLOCKS.has(ch) ? ch : '▒', color: theme.gray, dim: theme.dimSecondary}
    return {ch, color: theme.primary, dim: false}
  }
  // sweep — beam position leans right as it climbs, only glyphs are touched
  const cols = GRID[0].length
  const pMin = -TILT * ROWS - HALF
  const pMax = cols + HALF
  const p = pMin + ease(t / SWEEP_MS) * (pMax - pMin)
  const d = Math.abs(col - (ROWS - 1 - row) * TILT - p)
  if (d <= HALF && 1 - d / HALF > 0.35) {
    if (HALF_BLOCKS.has(ch)) return {ch, color: theme.gray, dim: theme.dimSecondary}
    return {ch: LIGHTER[ch] ?? ch, color: theme.primary, dim: false}
  }
  return {ch, color: theme.primary, dim: false}
}

function renderRow(row: number, phase: Phase, t: number, delays: number[], theme: Theme) {
  // group consecutive same-color cells so each row is a few Text spans, not 24
  const segments: Array<{text: string; color?: string; dim: boolean}> = []
  GRID[row].forEach((ch, col) => {
    const cell = cellAt(ch, row, col, phase, t, delays[col], theme)
    const last = segments[segments.length - 1]
    if (last && ((last.color === cell.color && last.dim === cell.dim) || cell.ch === ' ')) last.text += cell.ch
    else segments.push({text: cell.ch, color: cell.color, dim: cell.dim})
  })
  return segments.map((seg, i) => (
    <Text key={i} color={seg.color} dimColor={seg.dim}>
      {seg.text}
    </Text>
  ))
}

export function Logo() {
  const theme = useTheme()
  const animated = Boolean(process.stdout.isTTY)
  const delays = useMemo(
    () => GRID.map(row => row.map(() => Math.random() * INTRO_SPREAD_MS)),
    [],
  )
  const [phase, setPhase] = useState<Phase>(animated ? 'intro' : 'idle')
  const [t, setT] = useState(0)

  useEffect(() => {
    if (!animated) return
    if (phase === 'idle') {
      const id = setTimeout(() => {
        setT(0)
        setPhase('sweep')
      }, SWEEP_EVERY_MS)
      return () => clearTimeout(id)
    }
    const duration = phase === 'intro' ? INTRO_MS : SWEEP_MS
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed >= duration) {
        setT(0)
        setPhase('idle')
      } else {
        setT(elapsed)
      }
    }, 33)
    return () => clearInterval(id)
  }, [phase, animated])

  return (
    // flexShrink=0 — the logo must keep its 3 rows even when a phase's
    // content would overflow the screen, or yoga crushes it first
    <Box flexDirection="column" flexShrink={0}>
      {GRID.map((_, row) => (
        <Text key={row}>{renderRow(row, phase, t, delays[row], theme)}</Text>
      ))}
    </Box>
  )
}
