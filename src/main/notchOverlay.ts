import type {
  NotchOverlayCapability,
  NotchOverlaySettings,
  NotchOverlaySnapshot,
  Task
} from '../shared/types'
import { BrowserWindow, screen, app } from 'electron'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { is } from '@electron-toolkit/utils'

/**
 * Compact size hugs the camera housing. Expanded grows that same black island
 * wider + taller (Dynamic Island style). Finish-chat uses a taller frame so the
 * answer + reply field fit; width stays fixed so expand never slides sideways.
 */
const HARDWARE_NOTCH_WIDTH = 172
const SIDE_WING = 92
const COMPACT_WIDTH = HARDWARE_NOTCH_WIDTH + SIDE_WING * 2
const EXPANDED_WIDTH = 620
const EXPANDED_EXTRA_HEIGHT = 72
const CHAT_EXTRA_HEIGHT = 420
const FINISH_CHAT_COLLAPSE_MS = 120000
const FINISH_DISMISS_GRACE_MS = 1000
const NOTCH_WINDOW_TITLE = 'VibeBoard Notch'
const NOTCH_WINDOW_MARK = '__vibeboardNotchOverlay'
const MAX_ANSWER_CHARS = 6000

export const defaultNotchOverlaySettings: NotchOverlaySettings = {
  enabled: false,
  expandOnTaskCompleted: true,
  showFinishChat: true,
  expandOnAttention: true,
  expandOnAllFinished: false
}

export const mergeNotchOverlaySettings = (
  settings: Partial<NotchOverlaySettings> | null | undefined
): NotchOverlaySettings => ({
  enabled: Boolean(settings?.enabled),
  expandOnTaskCompleted: settings?.expandOnTaskCompleted ?? defaultNotchOverlaySettings.expandOnTaskCompleted,
  showFinishChat: settings?.showFinishChat ?? defaultNotchOverlaySettings.showFinishChat,
  expandOnAttention: settings?.expandOnAttention ?? defaultNotchOverlaySettings.expandOnAttention,
  expandOnAllFinished: settings?.expandOnAllFinished ?? defaultNotchOverlaySettings.expandOnAllFinished
})

type ExpandEvent = {
  headline: string
  detail: string
  taskId: string
  taskTitle: string
  answer: string | null
  showReply: boolean
  focusInput: boolean
}

type OverlayDeps = {
  getSettings: () => NotchOverlaySettings
  getRunningCount: () => number
  getAttentionCount: () => number
  getDoneUnreadCount: () => number
  getDoneReadCount: () => number
  getLatestAssistantReply: (taskId: string) => string | null
  onOpenTask: (taskId: string) => void
  onSendReply: (taskId: string, content: string) => Promise<void>
  isMainAppFocused: () => boolean
}

type MarkedWindow = BrowserWindow & { [NOTCH_WINDOW_MARK]?: boolean }

let deps: OverlayDeps | null = null
let overlayWindow: BrowserWindow | null = null
let snapshot: NotchOverlaySnapshot = emptySnapshot()
let collapseTimer: ReturnType<typeof setTimeout> | null = null
let pinningPosition = false
let processTeardownBound = false
let displayMetricsBound = false
let expandEvent: ExpandEvent | null = null
/** Last finish-chat panel, kept so compact click can reopen after dismiss. */
let lastFinishChat: ExpandEvent | null = null
/** Earliest time an outside-click / blur may dismiss finish chat (Escape is immediate). */
let finishDismissableAt = 0
let blurDismissTimer: ReturnType<typeof setTimeout> | null = null

export const bindNotchOverlayDeps = (next: OverlayDeps): void => {
  deps = next
  bindProcessTeardown()
}

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

export const getNotchOverlaySnapshot = (): NotchOverlaySnapshot => snapshot

/** Kill every notch panel we can see (tracked + any stragglers). Safe to call anytime. */
export const purgeNotchOverlays = (): void => {
  clearCollapseTimer()
  clearBlurDismissTimer()
  expandEvent = null
  lastFinishChat = null
  finishDismissableAt = 0
  snapshot = emptySnapshot()
  overlayWindow = null

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

export const syncNotchOverlay = (): void => {
  if (!deps) return
  const settings = deps.getSettings()
  const capability = getNotchOverlayCapability()
  if (!settings.enabled || !capability.supported) {
    purgeNotchOverlays()
    return
  }

  // Main VibeBoard window is focused — keep the notch fully out of the way.
  if (deps.isMainAppFocused()) {
    suppressNotchOverlay()
    return
  }

  ensureNotchOverlay()
  snapshot = composeSnapshot(expandEvent ? 'expanded' : 'compact')
  publishSnapshot()
  showOverlay()
  applyFocusMode()
  applyMousePassthrough()
}

export const handleNotchOverlayStatusChange = (input: {
  task: Task
  oldStatus: string
  newStatus: string
  runningCount: number
  runningCountBeforeChange: number
}): void => {
  if (!deps) return
  const settings = deps.getSettings()
  const capability = getNotchOverlayCapability()
  if (!settings.enabled || !capability.supported) {
    purgeNotchOverlays()
    return
  }

  // Don't expand or show the notch while the user is actively in VibeBoard.
  if (deps.isMainAppFocused()) {
    suppressNotchOverlay()
    return
  }

  ensureNotchOverlay()

  const isDone = input.newStatus === 'done_unread' || input.newStatus === 'done_read'
  const becameAttention = input.newStatus === 'attention'
  const allFinished =
    input.oldStatus === 'processing' &&
    input.newStatus !== 'processing' &&
    input.runningCountBeforeChange > 0 &&
    input.runningCount === 0

  if (becameAttention && settings.expandOnAttention) {
    // Stay compact — a hollow expand with "Dismiss" is noise. Click opens the task.
    expandEvent = null
    clearCollapseTimer()
  } else if (isDone && settings.expandOnTaskCompleted && settings.showFinishChat) {
    const answer = truncateAnswer(deps.getLatestAssistantReply(input.task.id))
    expandEvent = {
      headline: 'Finished',
      detail: input.task.title,
      taskId: input.task.id,
      taskTitle: input.task.title,
      answer,
      showReply: true,
      focusInput: true
    }
    lastFinishChat = { ...expandEvent, focusInput: false }
    markFinishChatOpened()
    scheduleCollapse(FINISH_CHAT_COLLAPSE_MS)
  } else if (isDone && settings.expandOnTaskCompleted) {
    // Status-only: refresh compact counts, no empty expand panel.
    expandEvent = null
    clearCollapseTimer()
  } else if (allFinished && settings.expandOnAllFinished) {
    expandEvent = null
    clearCollapseTimer()
  } else {
    expandEvent = null
    clearCollapseTimer()
  }

  snapshot = composeSnapshot(expandEvent ? 'expanded' : 'compact')
  publishSnapshot()
  showOverlay()
  applyFocusMode()
  applyMousePassthrough()

  if (becameAttention && settings.expandOnAttention && !deps.isMainAppFocused()) {
    deps.onOpenTask(input.task.id)
  }
}

export const collapseNotchOverlay = (): void => {
  clearCollapseTimer()
  clearBlurDismissTimer()
  expandEvent = null
  snapshot = composeSnapshot('compact')
  publishSnapshot()
  applyFocusMode()
  pinOverlayFrame()
  applyMousePassthrough()
}

/** Close finish chat but keep it reopenable from the compact notch. */
export const dismissNotchFinishChat = (options?: { force?: boolean }): boolean => {
  if (!expandEvent?.showReply) {
    collapseNotchOverlay()
    return true
  }
  if (!options?.force && Date.now() < finishDismissableAt) {
    return false
  }
  lastFinishChat = { ...expandEvent, focusInput: false }
  clearBlurDismissTimer()
  collapseNotchOverlay()
  return true
}

/** Reopen the last dismissed finish-chat panel. */
export const reopenNotchFinishChat = (): boolean => {
  if (!deps?.getSettings().enabled || !lastFinishChat) return false
  if (deps.isMainAppFocused()) {
    suppressNotchOverlay()
    return false
  }
  expandEvent = { ...lastFinishChat, focusInput: true }
  markFinishChatOpened()
  snapshot = composeSnapshot('expanded')
  publishSnapshot()
  showOverlay()
  applyFocusMode()
  applyMousePassthrough()
  scheduleCollapse(FINISH_CHAT_COLLAPSE_MS)
  return true
}

export const peekNotchOverlay = (): void => {
  // Intentionally no-op — peek expands were just noise.
}

export const openTaskFromNotch = (taskId: string): void => {
  lastFinishChat = null
  deps?.onOpenTask(taskId)
  collapseNotchOverlay()
}

export const sendReplyFromNotch = async (taskId: string, content: string): Promise<void> => {
  const trimmed = content.trim()
  if (!trimmed || !deps) return
  lastFinishChat = null
  await deps.onSendReply(taskId, trimmed)
  collapseNotchOverlay()
}

export const destroyNotchOverlay = (): void => {
  purgeNotchOverlays()
}

export const isNotchOverlayWindow = (window: BrowserWindow): boolean => isNotchLikeWindow(window)

function isNotchLikeWindow(window: BrowserWindow): boolean {
  if (window.isDestroyed()) return false
  const marked = window as MarkedWindow
  if (marked[NOTCH_WINDOW_MARK]) return true
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.id === window.id) return true
  try {
    return window.getTitle() === NOTCH_WINDOW_TITLE
  } catch {
    return false
  }
}

function emptySnapshot(): NotchOverlaySnapshot {
  return {
    mode: 'compact',
    runningCount: 0,
    attentionCount: 0,
    doneCount: 0,
    headline: '',
    trailing: null,
    detail: null,
    taskId: null,
    taskTitle: null,
    answer: null,
    showReply: false,
    focusInput: false
  }
}

function composeSnapshot(mode: 'compact' | 'expanded'): NotchOverlaySnapshot {
  const base = buildCountsSnapshot(mode)
  if (mode === 'expanded' && expandEvent) {
    return {
      ...base,
      mode: 'expanded',
      headline: expandEvent.headline,
      detail: expandEvent.detail,
      taskId: expandEvent.taskId || null,
      taskTitle: expandEvent.taskTitle || null,
      answer: expandEvent.answer,
      showReply: expandEvent.showReply,
      focusInput: expandEvent.focusInput
    }
  }
  return base
}

function buildCountsSnapshot(mode: 'compact' | 'expanded'): NotchOverlaySnapshot {
  const runningCount = deps?.getRunningCount() ?? 0
  const attentionCount = deps?.getAttentionCount() ?? 0
  const doneUnreadCount = deps?.getDoneUnreadCount() ?? 0
  const doneReadCount = deps?.getDoneReadCount() ?? 0
  const doneCount = doneUnreadCount + doneReadCount

  if (attentionCount > 0) {
    return {
      mode,
      runningCount,
      attentionCount,
      doneCount,
      headline: 'Needs you',
      trailing: String(attentionCount),
      detail:
        attentionCount === 1 ? '1 task waiting for input' : `${attentionCount} tasks waiting for input`,
      taskId: null,
      taskTitle: null,
      answer: null,
      showReply: false,
      focusInput: false
    }
  }

  if (runningCount > 0) {
    return {
      mode,
      runningCount,
      attentionCount,
      doneCount,
      headline: 'Running',
      trailing: String(runningCount),
      detail: runningCount === 1 ? '1 session active' : `${runningCount} sessions active`,
      taskId: null,
      taskTitle: null,
      answer: null,
      showReply: false,
      focusInput: false
    }
  }

  if (doneUnreadCount > 0) {
    return {
      mode,
      runningCount,
      attentionCount,
      doneCount,
      headline: 'Done',
      trailing: String(doneUnreadCount),
      detail:
        doneUnreadCount === 1
          ? '1 finished, waiting to be viewed'
          : `${doneUnreadCount} finished, waiting to be viewed`,
      taskId: null,
      taskTitle: null,
      answer: null,
      showReply: false,
      focusInput: false
    }
  }

  if (doneReadCount > 0) {
    return {
      mode,
      runningCount,
      attentionCount,
      doneCount,
      headline: 'Inactive',
      trailing: 'spinner',
      detail: 'Nothing needs attention',
      taskId: null,
      taskTitle: null,
      answer: null,
      showReply: false,
      focusInput: false
    }
  }

  return {
    mode,
    runningCount,
    attentionCount,
    doneCount,
    headline: '',
    trailing: null,
    detail: null,
    taskId: null,
    taskTitle: null,
    answer: null,
    showReply: false,
    focusInput: false
  }
}

function truncateAnswer(answer: string | null): string | null {
  if (!answer) return null
  if (answer.length <= MAX_ANSWER_CHARS) return answer
  return `${answer.slice(0, MAX_ANSWER_CHARS).trimEnd()}…`
}

function ensureNotchOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const extras = BrowserWindow.getAllWindows().filter(
      (window) => isNotchLikeWindow(window) && window.id !== overlayWindow!.id
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

  const display = getNotchTargetDisplay()
  const frame = overlayFrameForDisplay(display)

  const window = new BrowserWindow({
    width: frame.width,
    height: frame.height,
    x: frame.x,
    y: frame.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    enableLargerThanScreen: true,
    roundedCorners: false,
    type: 'panel',
    title: NOTCH_WINDOW_TITLE,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  }) as MarkedWindow

  window[NOTCH_WINDOW_MARK] = true
  overlayWindow = window

  window.setAlwaysOnTop(true, 'main-menu', 3)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.excludedFromShownWindowsMenu = true
  window.setWindowButtonVisibility(false)
  // Start click-through until we know the panel needs interaction.
  window.setIgnoreMouseEvents(true, { forward: true })
  window.on('closed', () => {
    if (overlayWindow?.id === window.id) {
      overlayWindow = null
    }
  })
  window.on('move', () => {
    if (pinningPosition || !overlayWindow || overlayWindow.isDestroyed()) return
    pinOverlayFrame()
  })
  window.on('blur', () => {
    scheduleBlurDismiss()
  })
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return
    if (!expandEvent?.showReply) return
    dismissNotchFinishChat({ force: true })
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/overlay.html'))
  }

  window.webContents.on('did-finish-load', () => {
    applyIslandMetrics()
    publishSnapshot()
    pinOverlayFrame()
    showOverlay()
    applyFocusMode()
    applyMousePassthrough()
  })

  if (!displayMetricsBound) {
    displayMetricsBound = true
    screen.on('display-metrics-changed', () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        applyIslandMetrics()
        pinOverlayFrame()
      }
    })
  }
}

function showOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (deps?.isMainAppFocused()) {
    suppressNotchOverlay()
    return
  }
  // Never activate the app just to show status — use inactive show.
  if (!overlayWindow.isVisible()) {
    overlayWindow.showInactive()
  }
  pinOverlayFrame()
  applyMousePassthrough()
}

/** Hide the notch window and clear expand state while the main app is focused. */
function suppressNotchOverlay(): void {
  clearCollapseTimer()
  clearBlurDismissTimer()
  expandEvent = null
  snapshot = composeSnapshot('compact')
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  try {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    overlayWindow.setFocusable(false)
    if (overlayWindow.isVisible()) overlayWindow.hide()
  } catch {
    // Window may already be tearing down.
  }
}

function applyFocusMode(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const wantsInput = Boolean(expandEvent?.showReply && expandEvent.focusInput)
  if (wantsInput) {
    overlayWindow.setFocusable(true)
    overlayWindow.show()
    overlayWindow.focus()
    overlayWindow.webContents.focus()
    setTimeout(() => {
      if (expandEvent) expandEvent = { ...expandEvent, focusInput: false }
      if (snapshot.focusInput) {
        snapshot = { ...snapshot, focusInput: false }
      }
    }, 800)
    return
  }
  // Idle / compact status must never steal keyboard focus from other apps.
  overlayWindow.setFocusable(false)
}

/** Compact idle status is click-through so Chrome tabs near the notch stay usable. */
function applyMousePassthrough(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (isOverlayMouseInteractive()) {
    overlayWindow.setIgnoreMouseEvents(false)
    return
  }
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
}

function isOverlayMouseInteractive(): boolean {
  // Expanded finish-chat needs clicks (reply / dismiss).
  if (expandEvent?.showReply) return true
  // Compact: only capture when there is something to click (reopen or attention).
  // Pure idle / running status stays click-through so Chrome tabs near the notch work.
  if (lastFinishChat) return true
  if ((deps?.getAttentionCount() ?? 0) > 0) return true
  return false
}

function pinOverlayFrame(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const frame = overlayFrameForDisplay(getNotchTargetDisplay())

  pinningPosition = true
  overlayWindow.setBounds(frame, false)
  overlayWindow.setAlwaysOnTop(true, 'main-menu', 3)
  setTimeout(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      pinningPosition = false
      return
    }
    overlayWindow.setBounds(frame, false)
    pinningPosition = false
  }, 0)
}

function overlayFrameForDisplay(display: Electron.Display): {
  x: number
  y: number
  width: number
  height: number
} {
  const menuBarHeight = compactHeightForDisplay(display)
  // Finish-chat: full-display transparent click-catcher so outside clicks dismiss.
  if (expandEvent?.showReply) {
    return {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }
  }
  const { x, y } = topCenteredOrigin(display, COMPACT_WIDTH)
  return { x, y, width: COMPACT_WIDTH, height: menuBarHeight }
}

function markFinishChatOpened(): void {
  finishDismissableAt = Date.now() + FINISH_DISMISS_GRACE_MS
  clearBlurDismissTimer()
}

function scheduleBlurDismiss(): void {
  if (!expandEvent?.showReply) return
  clearBlurDismissTimer()
  const waitMs = Math.max(0, finishDismissableAt - Date.now())
  blurDismissTimer = setTimeout(() => {
    blurDismissTimer = null
    if (!expandEvent?.showReply) return
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isFocused()) return
    dismissNotchFinishChat()
  }, waitMs)
}

function clearBlurDismissTimer(): void {
  if (!blurDismissTimer) return
  clearTimeout(blurDismissTimer)
  blurDismissTimer = null
}

function applyIslandMetrics(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const menuBarHeight = compactHeightForDisplay(getNotchTargetDisplay())
  const css = `:root {
    --notch-compact-width: ${COMPACT_WIDTH}px;
    --notch-expanded-width: ${EXPANDED_WIDTH}px;
    --notch-compact-height: ${menuBarHeight}px;
    --notch-expanded-height: ${menuBarHeight + EXPANDED_EXTRA_HEIGHT}px;
    --notch-chat-height: ${menuBarHeight + CHAT_EXTRA_HEIGHT}px;
    --notch-camera-gap: ${HARDWARE_NOTCH_WIDTH}px;
  }`
  void overlayWindow.webContents.insertCSS(css)
}

function topCenteredOrigin(display: Electron.Display, width: number): { x: number; y: number } {
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - width) / 2),
    y: Math.round(display.bounds.y)
  }
}

function publishSnapshot(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.webContents.send('notch:snapshot', snapshot)
}

function scheduleCollapse(ms: number): void {
  clearCollapseTimer()
  collapseTimer = setTimeout(() => {
    collapseNotchOverlay()
  }, ms)
}

function clearCollapseTimer(): void {
  if (!collapseTimer) return
  clearTimeout(collapseTimer)
  collapseTimer = null
}

/** Prefer a display that actually reports a tall menu-bar / notch inset. */
function findNotchedDisplay(): Electron.Display | null {
  const displays = screen.getAllDisplays()
  const notched = displays.filter(displayLooksNotched)
  if (notched.length === 0) return null
  // Prefer the built-in panel when multiple screens report a tall top inset.
  const builtin = notched.find((display) => isLikelyBuiltinDisplay(display))
  return builtin ?? notched[0]
}

function getNotchTargetDisplay(): Electron.Display {
  return findNotchedDisplay() ?? screen.getPrimaryDisplay()
}

function displayLooksNotched(display: Electron.Display): boolean {
  // Notched MacBooks report ~37pt top inset; classic menu bar is ~22–25.
  const topInset = display.workArea.y - display.bounds.y
  return topInset >= 28
}

function isLikelyBuiltinDisplay(display: Electron.Display): boolean {
  const label = `${(display as Electron.Display & { label?: string }).label ?? ''}`.toLowerCase()
  return label.includes('built-in') || label.includes('color lcd') || label.includes('liquid retina')
}

function compactHeightForDisplay(display: Electron.Display): number {
  const menuBarHeight = display.workArea.y - display.bounds.y
  // Notched models use ~37 even if workArea briefly reports lower while waking.
  if (macHardwareLikelyHasNotch(getMacHardwareModel() ?? '') && menuBarHeight < 28) {
    return 37
  }
  return Math.max(30, Math.min(38, Math.round(menuBarHeight || 37)))
}

function getMacHardwareModel(): string | null {
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
function macHardwareLikelyHasNotch(model: string): boolean {
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
    // Mac mini M4 is Mac16,10 / Mac16,11 — everything else in this series is laptop.
    if (major === 16 && (minor === 10 || minor === 11)) return false
    return true
  }
  return false
}

function bindProcessTeardown(): void {
  if (processTeardownBound) return
  processTeardownBound = true

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
