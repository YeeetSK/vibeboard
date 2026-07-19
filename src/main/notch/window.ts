import { BrowserWindow, screen, app } from 'electron'
import path from 'node:path'
import { is } from '@electron-toolkit/utils'
import { emptyNotchOverlaySnapshot } from '../../shared/notch'
import { S } from './state'
import { bridge, registerBridge } from './bridge'
import {
  NOTCH_WINDOW_TITLE,
  NOTCH_WINDOW_MARK,
  OVERLAY_ALWAYS_ON_TOP_LEVEL,
  isMac,
  type MarkedWindow
} from './types'
import { cancelAnimation, isFinishPhase, isRunningPhase, publishPhaseSnapshot } from './phase'
import { composeSnapshot, publishSnapshot } from './snapshot'
import { pinOverlayFrame, applyIslandMetrics, overlayFrameForDisplay } from './geometry'
import { getNotchTargetDisplay } from './capability'

export function setOverlayClickThrough(passthrough: boolean): void {
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  if (!passthrough) {
    S.overlayWindow.setIgnoreMouseEvents(false)
    return
  }
  if (isMac) {
    S.overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    return
  }
  S.overlayWindow.setIgnoreMouseEvents(true)
}

export function yankNotchOutOfActivation(): void {
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  try {
    setOverlayClickThrough(true)
    S.overlayWindow.setFocusable(false)
    if (S.overlayWindow.isFocused()) S.overlayWindow.blur()
    // Panel + visible-on-all-workspaces steals dock activation. Clear both
    // while the board is coming forward so macOS targets the main window.
    if (isMac) {
      try {
        S.overlayWindow.setVisibleOnAllWorkspaces(false)
      } catch {
        // ignore
      }
    }
    if (S.overlayWindow.isVisible()) S.overlayWindow.hide()
  } catch {
    // ignore
  }
}

export function restoreNotchWorkspaceAffinity(): void {
  if (!isMac || !S.overlayWindow || S.overlayWindow.isDestroyed()) return
  try {
    S.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  } catch {
    // ignore
  }
}

export function showOverlayInactive(): void {
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  restoreNotchWorkspaceAffinity()
  try {
    if (!S.overlayWindow.isVisible()) S.overlayWindow.showInactive()
  } catch {
    // ignore
  }
}

export const purgeNotchOverlays = (): void => {
  cancelAnimation()
  bridge.stopFinishAwayWatch()
  bridge.clearDevFinishTestTimer()
  bridge.clearDevRunningTest()
  bridge.stopEscapeHoldMonitor()
  S.expandEvent = null
  S.lastFinishChat = null
  S.finishQueue = []
  S.forceOverlayVisible = false
  S.unparkGuardUntil = 0
  S.selectedRunningTaskId = null
  S.runningDetailOpen = false
  S.overviewKind = 'running'
  S.runningDismissNarrow = false
  S.finishDismissNarrow = false
  S.phase = 'hidden'
  S.appearStep = 0
  S.dismissStep = 0
  S.overlayReady = false
  S.overlayReadyWaiters = []
  S.snapshot = emptyNotchOverlaySnapshot()
  S.overlayWindow = null

  for (const window of BrowserWindow.getAllWindows()) {
    if (!isNotchLikeWindow(window) || window.isDestroyed()) continue
    try {
      window.removeAllListeners()
      window.hide()
      window.destroy()
    } catch {
      // Process may already be tearing down.
    }
  }
}

export const destroyNotchOverlay = (): void => {
  purgeNotchOverlays()
}

export const isNotchOverlayWindow = (window: BrowserWindow): boolean => isNotchLikeWindow(window)

export function isNotchLikeWindow(window: BrowserWindow): boolean {
  if (window.isDestroyed()) return false
  const marked = window as MarkedWindow
  if (marked[NOTCH_WINDOW_MARK]) return true
  if (S.overlayWindow && !S.overlayWindow.isDestroyed() && S.overlayWindow.id === window.id) return true
  try {
    return window.getTitle() === NOTCH_WINDOW_TITLE
  } catch {
    return false
  }
}

export function ensureNotchOverlay(): void {
  if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
    const extras = BrowserWindow.getAllWindows().filter(
      (window) => isNotchLikeWindow(window) && window.id !== S.overlayWindow!.id
    )
    for (const extra of extras) {
      try {
        extra.hide()
        extra.destroy()
      } catch {
        // ignore
      }
    }
    return
  }

  purgeNotchOverlays()

  S.overlayReady = false
  const display = getNotchTargetDisplay()
  const frame = overlayFrameForDisplay(display)

  // Transparent window + exact pill bounds. Opaque windows force square corners;
  // oversized transparent windows paint the gray slab. Keep both constraints.
  const window = new BrowserWindow({
    width: frame.width,
    height: frame.height,
    x: frame.x,
    y: frame.y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    roundedCorners: false,
    title: NOTCH_WINDOW_TITLE,
    // macOS-only: panel + larger-than-screen keep the island glued to the menu bar.
    ...(isMac
      ? {
          type: 'panel' as const,
          enableLargerThanScreen: true
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  }) as MarkedWindow

  window[NOTCH_WINDOW_MARK] = true
  S.overlayWindow = window
  try {
    window.setBackgroundColor('#00000000')
  } catch {
    // ignore
  }

  window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, 3)
  if (isMac) {
    // Enable visible-on-all-workspaces only when the island is shown (see
    // showOverlayInactive). A hidden panel with that flag steals dock activation
    // so the board never appears until a second click.
    // Never pass visibleOnFullScreen: true (UIElement / no Dock indicator):
    // https://github.com/electron/electron/issues/26350
    window.excludedFromShownWindowsMenu = true
    window.setWindowButtonVisibility(false)
  }
  // Start click-through until we know the panel needs interaction.
  setOverlayClickThrough(true)
  window.on('closed', () => {
    if (S.overlayWindow?.id === window.id) {
      S.overlayWindow = null
    }
  })
  window.on('move', () => {
    if (S.pinningPosition || !S.overlayWindow || S.overlayWindow.isDestroyed()) return
    // Expanded panels stay a fixed frame; re-pinning on focus jitter shakes them.
    if (S.expandEvent?.showReply || isRunningPhase()) return
    pinOverlayFrame()
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/overlay.html'))
  }

  window.webContents.on('did-finish-load', () => {
    S.overlayReady = true
    applyIslandMetrics()
    publishSnapshot()
    pinOverlayFrame()
    applyMousePassthrough()
    const waiters = S.overlayReadyWaiters
    S.overlayReadyWaiters = []
    for (const resolve of waiters) resolve()
    // Show compact / Inactive when away from the board (not during launch grace).
    if (!bridge.shouldKeepNotchDark()) {
      showOverlay()
      applyFocusMode()
    }
  })

  if (!S.displayMetricsBound) {
    S.displayMetricsBound = true
    screen.on('display-metrics-changed', () => {
      if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
        applyIslandMetrics()
        pinOverlayFrame()
      }
    })
  }
}

export function whenOverlayReady(): Promise<void> {
  if (S.overlayReady && S.overlayWindow && !S.overlayWindow.isDestroyed()) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    S.overlayReadyWaiters.push(resolve)
  })
}

export async function showOverlayWhenReady(): Promise<void> {
  ensureNotchOverlay()
  await whenOverlayReady()
  showOverlay()
}

export function showOverlay(): void {
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  if (bridge.shouldKeepNotchDark()) {
    bridge.dismissForMainFocus()
    return
  }
  if (S.phase === 'finishDismissing') return

  if (isFinishPhase() && S.expandEvent?.showReply) {
    // Finish presentation owns its own reveal; just ensure visible.
    showOverlayInactive()
    pinOverlayFrame()
    publishPhaseSnapshot()
    applyMousePassthrough()
    return
  }

  void bridge.revealCompact()
}

/** True when the compact island has something worth showing. */
export function hasNotchActivity(): boolean {
  if (S.expandEvent) return true
  if (S.finishQueue.length > 0) return true
  if (S.devRunningSim) return true
  const runningCount = bridge.resolvedRunningCount()
  const attentionCount = S.deps?.getAttentionCount() ?? 0
  const doneUnreadCount = S.deps?.getDoneUnreadCount() ?? 0
  return runningCount > 0 || attentionCount > 0 || doneUnreadCount > 0
}

/** Hide completely when idle. No tucked black strip under the camera. */
export function hideEmptyNotchOverlay(): void {
  cancelAnimation()
  bridge.clearDevFinishTestTimer()
  // Keep an armed running-overview test (sim + pending) so leave-app still has
  // something to show even when there are zero real processing tasks.
  bridge.clearDevRunningTestTimer()
  bridge.stopFinishAwayWatch()
  bridge.endEscapeHold()
  S.forceOverlayVisible = false
  S.expandEvent = null
  S.selectedRunningTaskId = null
  S.runningDetailOpen = false
  S.overviewKind = 'running'
  S.phase = 'hidden'
  S.appearStep = 0
  S.dismissStep = 0

  if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
    try {
      setOverlayClickThrough(true)
      S.overlayWindow.setFocusable(false)
      // Hide before publishing empty state so the island never flashes blank.
      if (isMac) {
        try {
          S.overlayWindow.setVisibleOnAllWorkspaces(false)
        } catch {
          // ignore
        }
      }
      if (S.overlayWindow.isVisible()) S.overlayWindow.hide()
    } catch {
      // Window may already be tearing down.
    }
  }

  S.snapshot = composeSnapshot('compact')
  publishSnapshot()
}

export function applyFocusMode(): void {
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  // Finish chat / running overview stay focusable for typing, but must NEVER activate the app.
  if (S.expandEvent?.showReply || S.phase === 'runningOpen' || S.phase === 'runningParked') {
    S.overlayWindow.setFocusable(true)
    if (
      S.phase === 'finishParked' ||
      S.phase === 'runningParked' ||
      S.phase === 'finishDismissing' ||
      S.phase === 'finishAppearing' ||
      S.phase === 'runningAppearing' ||
      S.phase === 'runningDismissing'
    ) {
      return
    }
    showOverlayInactive()
    if (S.expandEvent?.focusInput || (S.phase === 'runningOpen' && S.snapshot.focusInput)) {
      try {
        S.overlayWindow.webContents.focus()
      } catch {
        // ignore
      }
      setTimeout(() => {
        if (S.expandEvent) S.expandEvent = { ...S.expandEvent, focusInput: false }
        if (S.snapshot.focusInput) {
          S.snapshot = { ...S.snapshot, focusInput: false }
        }
      }, 800)
    }
    return
  }
  // Idle / compact status must never steal keyboard focus from other apps.
  S.overlayWindow.setFocusable(false)
}

/** Compact idle status is click-through so Chrome tabs near the notch stay usable. */
export function applyMousePassthrough(): void {
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  if (S.phase === 'runningOpen' || S.phase === 'runningAppearing') {
    setOverlayClickThrough(false)
    return
  }
  if (S.phase === 'runningParked' || S.phase === 'finishParked') {
    // Parked strip: click-through until the pointer hovers the island.
    setOverlayClickThrough(true)
    return
  }
  if (S.phase === 'runningDismissing') {
    setOverlayClickThrough(true)
    return
  }
  if (S.expandEvent?.showReply) {
    // Expanded finish chat MUST receive clicks so the dismiss-hit can park.
    // Click-through here is what broke park-after-unpark (Electron never blurred).
    setOverlayClickThrough(false)
    return
  }
  if (isOverlayMouseInteractive()) {
    setOverlayClickThrough(false)
    return
  }
  setOverlayClickThrough(true)
}

/**
 * Hover hit-testing for the parked strip only.
 * Expanded finish chat / running detail always capture mouse so click-away works.
 */
export const setNotchOverlayMousePassthrough = (passthrough: boolean): void => {
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  if (S.phase === 'runningOpen') {
    setOverlayClickThrough(false)
    return
  }
  if (S.phase === 'runningParked' || S.phase === 'finishParked') {
    setOverlayClickThrough(passthrough)
    return
  }
  if (!S.expandEvent?.showReply) {
    applyMousePassthrough()
    return
  }
  setOverlayClickThrough(false)
}

export function isOverlayMouseInteractive(): boolean {
  // Expanded finish-chat / running overview need clicks.
  if (S.expandEvent?.showReply) return true
  if (S.phase === 'runningOpen' || S.phase === 'runningAppearing') return true
  // Compact: capture when there is something to click.
  if (S.lastFinishChat) return true
  if ((S.deps?.getAttentionCount() ?? 0) > 0) return true
  if (bridge.resolvedRunningCount() > 0) return true
  if ((S.deps?.getDoneUnreadCount() ?? 0) > 0) return true
  return false
}

export function bindProcessTeardown(): void {
  if (S.processTeardownBound) return
  S.processTeardownBound = true

  const teardownAndExit = (code = 0): void => {
    purgeNotchOverlays()
    try {
      app.exit(code)
    } catch {
      process.exit(code)
    }
  }

  process.once('exit', () => {
    purgeNotchOverlays()
  })
  app.on('quit', () => {
    purgeNotchOverlays()
  })
  app.on('will-quit', () => {
    purgeNotchOverlays()
  })
  process.once('SIGINT', () => teardownAndExit(0))
  process.once('SIGTERM', () => teardownAndExit(0))
}

registerBridge({
  ensureNotchOverlay,
  whenOverlayReady,
  showOverlayInactive,
  hideEmptyNotchOverlay,
  applyFocusMode,
  applyMousePassthrough,
  setOverlayClickThrough,
  hasNotchActivity,
  bindProcessTeardown,
  purgeNotchOverlays
})
