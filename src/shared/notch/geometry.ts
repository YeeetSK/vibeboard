/**
 * Compact size hugs the camera housing. Expanded grows that same black island
 * wider + taller (Dynamic Island style). Finish-chat uses a taller frame so the
 * answer + reply field fit; width stays fixed so expand never slides sideways.
 *
 * CSS `:root` fallbacks in overlay.css must match these numbers. Main overrides
 * menu-bar-dependent heights at runtime via `islandCssVars`.
 */

export const HARDWARE_NOTCH_WIDTH = 172
export const SIDE_WING = 92
export const COMPACT_WIDTH = HARDWARE_NOTCH_WIDTH + SIDE_WING * 2
export const EXPANDED_WIDTH = 620
export const EXPANDED_EXTRA_HEIGHT = 72
export const CHAT_EXTRA_HEIGHT = 420
/** Finish-chat parked (click-away) height beyond the menu-bar / notch band. */
export const PARKED_EXTRA_HEIGHT = 32

export const PARK_ANIM_MS = 340
export const SIDE_REVEAL_MS = 340
export const SIDE_REVEAL_DELAY_MS = 40
export const HEIGHT_ANIM_MS = PARK_ANIM_MS

/** Fallback menu-bar / notch band height used in CSS before main injects metrics. */
export const DEFAULT_MENU_BAR_HEIGHT = 32

export type NotchFrameKind = 'compact' | 'expandedPanel'

export type NotchFrameInput = {
  menuBarHeight: number
  surface: boolean
  narrow: boolean
  statusSized: boolean
  parked: boolean
  /** Expanded finish-chat or running overview panel (vs compact status pill). */
  kind: NotchFrameKind
}

export function frameSize(input: NotchFrameInput): { width: number; height: number } {
  const { menuBarHeight, surface, narrow, statusSized, parked, kind } = input

  if (kind === 'expandedPanel') {
    let width = EXPANDED_WIDTH
    let height = menuBarHeight + CHAT_EXTRA_HEIGHT
    if (!surface) {
      width = HARDWARE_NOTCH_WIDTH
      height = menuBarHeight
    } else if (parked) {
      width = EXPANDED_WIDTH
      height = menuBarHeight + PARKED_EXTRA_HEIGHT
    } else if (statusSized && narrow) {
      width = COMPACT_WIDTH
      height = menuBarHeight
    } else if (statusSized) {
      width = EXPANDED_WIDTH
      height = menuBarHeight
    } else if (narrow) {
      width = COMPACT_WIDTH
      height = menuBarHeight + CHAT_EXTRA_HEIGHT
    }
    return { width, height }
  }

  const width = surface ? COMPACT_WIDTH : HARDWARE_NOTCH_WIDTH
  return { width, height: menuBarHeight }
}

/** CSS custom-property block injected into the overlay window. */
export function islandCssVars(menuBarHeight: number): string {
  return `:root {
    --notch-compact-width: ${COMPACT_WIDTH}px;
    --notch-expanded-width: ${EXPANDED_WIDTH}px;
    --notch-compact-height: ${menuBarHeight}px;
    --notch-expanded-height: ${menuBarHeight + EXPANDED_EXTRA_HEIGHT}px;
    --notch-chat-height: ${menuBarHeight + CHAT_EXTRA_HEIGHT}px;
    --notch-parked-height: ${menuBarHeight + PARKED_EXTRA_HEIGHT}px;
    --notch-camera-gap: ${HARDWARE_NOTCH_WIDTH}px;
  }`
}
