import {
  CHAT_EXTRA_HEIGHT,
  COMPACT_WIDTH,
  EXPANDED_WIDTH,
  islandCssVars,
  SIDE_REVEAL_MS
} from '../../shared/notch'
import { S } from './state'
import { registerBridge } from './bridge'
import { isFinishPhase, isRunningPhase } from './phase'
import { compactHeightForDisplay, getNotchTargetDisplay } from './capability'
import { OVERLAY_ALWAYS_ON_TOP_LEVEL } from './types'

export function pinOverlayFrame(options?: { animate?: boolean }): void {
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  const frame = overlayFrameForDisplay(getNotchTargetDisplay())
  const animate = Boolean(options?.animate)
  const gen = ++S.pinGeneration

  S.pinningPosition = true
  S.overlayWindow.setBounds(frame, animate)
  S.overlayWindow.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, 3)
  if (animate) {
    setTimeout(() => {
      if (gen !== S.pinGeneration) return
      S.pinningPosition = false
    }, SIDE_REVEAL_MS)
    return
  }
  setTimeout(() => {
    if (gen !== S.pinGeneration) return
    if (!S.overlayWindow || S.overlayWindow.isDestroyed()) {
      S.pinningPosition = false
      return
    }
    const latest = overlayFrameForDisplay(getNotchTargetDisplay())
    S.overlayWindow.setBounds(latest, false)
    S.pinningPosition = false
  }, 0)
}

/**
 * Window bounds stay on a stable frame so CSS can morph width/height/clip-path.
 * Stepping Electron setBounds for every appear/park step reads as instant jumps
 * (animate:true flashes transparent chrome on macOS panels).
 */
export function overlayFrameForDisplay(display: Electron.Display): {
  x: number
  y: number
  width: number
  height: number
} {
  const menuBarHeight = compactHeightForDisplay(display)

  // Finish / running panels: full expanded chat frame for the whole phase machine.
  if (S.expandEvent?.showReply || isRunningPhase() || isFinishPhase()) {
    const width = EXPANDED_WIDTH
    const height = menuBarHeight + CHAT_EXTRA_HEIGHT
    const { x, y } = topCenteredOrigin(display, width)
    return { x, y, width, height }
  }

  // Compact status pill: stable compact width; CSS clip-path tucks into the camera.
  const width = COMPACT_WIDTH
  const { x, y } = topCenteredOrigin(display, width)
  return { x, y, width, height: menuBarHeight }
}

export function applyIslandMetrics(): void {
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  const menuBarHeight = compactHeightForDisplay(getNotchTargetDisplay())
  void S.overlayWindow.webContents.insertCSS(islandCssVars(menuBarHeight))
}

export function topCenteredOrigin(display: Electron.Display, width: number): { x: number; y: number } {
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - width) / 2),
    y: Math.round(display.bounds.y)
  }
}

registerBridge({ pinOverlayFrame })
