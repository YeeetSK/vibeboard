import { S } from './state'
import { bridge } from './bridge'
import type { NotchPhase } from './types'

export function isFinishPhase(p: NotchPhase = S.phase): boolean {
  return (
    p === 'finishAppearing' ||
    p === 'finishOpen' ||
    p === 'finishParked' ||
    p === 'finishDismissing'
  )
}

export function isRunningPhase(p: NotchPhase = S.phase): boolean {
  return (
    p === 'runningAppearing' ||
    p === 'runningOpen' ||
    p === 'runningParked' ||
    p === 'runningDismissing'
  )
}

export function deriveSurfaceVisible(): boolean {
  switch (S.phase) {
    case 'compact':
      // S.appearStep 0 = tucked (reveal/hide), >=1 = sides open
      return S.appearStep >= 1
    case 'runningOpen':
    case 'runningParked':
    case 'finishOpen':
    case 'finishParked':
      return true
    case 'runningAppearing':
    case 'finishAppearing':
      return S.appearStep >= 1
    case 'runningDismissing':
      // Step 0: full-width status. Step 1: stay revealed while narrowing, or tuck (app-focus).
      if (S.runningDismissNarrow) return true
      return S.dismissStep === 0
    case 'finishDismissing':
      // Step 0: full-width status. Step 1: stay revealed while narrowing, or tuck (app-focus).
      if (S.finishDismissNarrow) return true
      return S.dismissStep === 0
    default:
      return false
  }
}

export function deriveCompactSize(): boolean {
  return (
    S.phase === 'finishAppearing' ||
    S.phase === 'finishDismissing' ||
    S.phase === 'runningAppearing' ||
    S.phase === 'runningDismissing'
  )
}

/**
 * Horizontal size only - never change in the same step as height.
 * Appear: narrow until S.appearStep 2 (widen), then grow height on open.
 * Dismiss: full width during height shrink (step 0); narrow on step 1.
 */
export function deriveNarrowSize(): boolean {
  if (S.phase === 'finishAppearing' || S.phase === 'runningAppearing') {
    return S.appearStep < 2
  }
  if (S.phase === 'runningDismissing') {
    return S.runningDismissNarrow && S.dismissStep >= 1
  }
  if (S.phase === 'finishDismissing') {
    return S.finishDismissNarrow && S.dismissStep >= 1
  }
  return false
}

export function deriveParked(): boolean {
  return S.phase === 'finishParked' || S.phase === 'runningParked'
}

/** Cancel every sequenced animation / deferred focus timer. */
export function cancelAnimation(): void {
  S.animGeneration += 1
  for (const timer of S.animTimers) clearTimeout(timer)
  S.animTimers = []
  if (S.awayBlurTimer) {
    clearTimeout(S.awayBlurTimer)
    S.awayBlurTimer = null
  }
  if (S.unparkFocusTimer) {
    clearTimeout(S.unparkFocusTimer)
    S.unparkFocusTimer = null
  }
  if (S.focusInputClearTimer) {
    clearTimeout(S.focusInputClearTimer)
    S.focusInputClearTimer = null
  }
}

export function afterMs(ms: number, fn: () => void): void {
  const gen = S.animGeneration
  const id = setTimeout(() => {
    S.animTimers = S.animTimers.filter((timer) => timer !== id)
    if (gen !== S.animGeneration) return
    fn()
  }, ms)
  S.animTimers.push(id)
}

export function publishPhaseSnapshot(): void {
  if (isRunningPhase()) {
    S.snapshot = bridge.composeSnapshot('expanded')
  } else if (isFinishPhase() && S.expandEvent) {
    S.snapshot = bridge.composeSnapshot('expanded')
  } else {
    S.snapshot = bridge.composeSnapshot('compact')
  }
  bridge.publishSnapshot()
  // Bounds follow the black pill every step - never leave transparent chrome.
  bridge.pinOverlayFrame()
}

