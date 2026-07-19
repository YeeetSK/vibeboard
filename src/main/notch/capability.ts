import type { NotchOverlayCapability } from '../../shared/types'
import { screen } from 'electron'
import { execFileSync } from 'node:child_process'
import { isMac } from './types'

export const getNotchOverlayCapability = (): NotchOverlayCapability => {
  if (process.platform !== 'darwin') {
    return {
      supported: false,
      platform: process.platform,
      hasNotch: false,
      reason: 'Notch overlay is only available on macOS.'
    }
  }

  const notchedDisplay = findNotchedDisplay()
  const model = getMacHardwareModel()
  const modelHasNotch = model ? macHardwareLikelyHasNotch(model) : false
  const hasNotch = Boolean(notchedDisplay) || modelHasNotch

  let reason: string | null = null
  if (!hasNotch) {
    reason = 'No notched Mac display detected. Use a MacBook with a camera notch.'
  } else if (!notchedDisplay && modelHasNotch) {
    reason =
      'This Mac has a notch, but the notched display is not active (lid closed or external-only). Open the built-in display to show the overlay.'
  }

  return {
    // Allow enabling whenever this Mac is a notched model or a notched display is present.
    supported: hasNotch,
    platform: 'darwin',
    hasNotch,
    reason
  }
}

export function findNotchedDisplay(): Electron.Display | null {
  const displays = screen.getAllDisplays()
  const notched = displays.filter(displayLooksNotched)
  if (notched.length === 0) return null
  // Prefer the built-in panel when multiple screens report a tall top inset.
  const builtin = notched.find((display) => isLikelyBuiltinDisplay(display))
  return builtin ?? notched[0]
}

export function getNotchTargetDisplay(): Electron.Display {
  return findNotchedDisplay() ?? screen.getPrimaryDisplay()
}

export function displayLooksNotched(display: Electron.Display): boolean {
  // Notched MacBooks report ~37pt top inset; classic menu bar is ~22-25.
  const topInset = display.workArea.y - display.bounds.y
  return topInset >= 28
}

export function isLikelyBuiltinDisplay(display: Electron.Display): boolean {
  const label = `${(display as Electron.Display & { label?: string }).label ?? ''}`.toLowerCase()
  return label.includes('built-in') || label.includes('color lcd') || label.includes('liquid retina')
}

export function compactHeightForDisplay(display: Electron.Display): number {
  // Windows / Linux have no menu-bar notch inset; keep a stable island height for demos.
  if (!isMac) return 37
  const menuBarHeight = Math.round(display.workArea.y - display.bounds.y)
  const notched = macHardwareLikelyHasNotch(getMacHardwareModel() ?? '')
  // Notched MacBooks: hug the real menu-bar / camera housing band (~37).
  // Prefer the measured inset; only fall back when workArea is wrong while waking.
  if (notched) {
    if (menuBarHeight >= 28 && menuBarHeight <= 40) return menuBarHeight
    return 37
  }
  // Classic menu bar is shorter; still clamp to a sane island.
  return Math.max(22, Math.min(28, menuBarHeight || 24))
}

export function getMacHardwareModel(): string | null {
  if (!isMac) return null
  try {
    return execFileSync('/usr/sbin/sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim() || null
  } catch {
    try {
      return execFileSync('/usr/bin/sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim() || null
    } catch {
      return null
    }
  }
}

/**
 * Notched MacBooks: Air M2+, Pro 14/16 2021+.
 * Uses hw.model so settings still work when an external monitor is primary.
 */
export function macHardwareLikelyHasNotch(model: string): boolean {
  if (!model) return false
  if (/^MacBookAir10,/.test(model)) return false
  if (/^MacBookAir(1[4-9]|[2-9]\d),/.test(model)) return true
  if (/^MacBookPro(1[8-9]|[2-9]\d),/.test(model)) return true

  const match = model.match(/^Mac(\d+),(\d+)$/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major === 14) return [5, 6, 9, 10].includes(minor)
  if (major === 15) return [3, 6, 7, 8, 9, 10, 11, 12, 13].includes(minor)
  if (major >= 16) {
    // Mac mini M4 is Mac16,10 / Mac16,11; everything else in this series is laptop.
    if (major === 16 && (minor === 10 || minor === 11)) return false
    return true
  }
  return false
}
