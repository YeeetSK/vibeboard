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
import { startMacEscapeKeyMonitor } from './escKeyMonitor'

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
/** Finish-chat parked (click-away) height beyond the menu-bar / notch band. */
const PARKED_EXTRA_HEIGHT = 40
const PARK_ANIM_MS = 340
const NOTCH_WINDOW_TITLE = 'VibeBoard Notch'
const NOTCH_WINDOW_MARK = '__vibeboardNotchOverlay'
const MAX_ANSWER_CHARS = 6000
const ESCAPE_HOLD_MS = 1500
const ESCAPE_HOLD_DEFAULT_SEC = 1.5
const isMac = process.platform === 'darwin'
/** Always-on-top level that works on both macOS (menu-bar band) and Windows. */
const OVERLAY_ALWAYS_ON_TOP_LEVEL = isMac ? 'main-menu' : 'screen-saver'

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
  /** Dev / preview panel: no real task backing it. */
  simulated?: boolean
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
let overlayReady = false
let overlayReadyWaiters: Array<() => void> = []
let snapshot: NotchOverlaySnapshot = emptySnapshot()
let collapseTimer: ReturnType<typeof setTimeout> | null = null
let pinningPosition = false
let processTeardownBound = false
let displayMetricsBound = false
let expandEvent: ExpandEvent | null = null
/** Last finish-chat panel, kept so compact click can reopen after dismiss. */
let lastFinishChat: ExpandEvent | null = null
/** Finished tasks waiting to show: only one finish panel at a time. */
let finishQueue: ExpandEvent[] = []
/** Finish chat shrunk after click-away; click island to expand again. */
let finishParked = false
/** Ignore park briefly after unpark so the activating click doesn't re-collapse. */
let unparkGuardUntil = 0
/** Allow showing the overlay even while the main window is focused (dev test). */
let forceOverlayVisible = false

function setOverlayClickThrough(passthrough: boolean): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (!passthrough) {
    overlayWindow.setIgnoreMouseEvents(false)
    return
  }
  if (isMac) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    return
  }
  overlayWindow.setIgnoreMouseEvents(true)
}
/** Dev test armed: expand finish-chat after the notch appears in the background. */
let devFinishTestPending = false
let devFinishTestTimer: ReturnType<typeof setTimeout> | null = null
const DEV_FINISH_EXPAND_DELAY_MS = 1500
/** Stop watching for click-away / app switch while finish chat is expanded. */
let stopAwayWatch: (() => void) | null = null
/** Island revealed under the hardware notch (animates in/out on app focus). */
let surfaceVisible = false
let surfaceAnimTimer: ReturnType<typeof setTimeout> | null = null
const SURFACE_ANIM_MS = 340
/** Global Escape hold-to-close while finish chat is open (works unfocused). */
let stopEscMonitor: (() => void) | null = null
let escHoldStartedAt: number | null = null
let escHoldTimer: ReturnType<typeof setInterval> | null = null
/** Scripted marketing notch demo (dev only). */
let marketingDemoActive = false
let marketingDemoTimers: Array<ReturnType<typeof setTimeout>> = []

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
  clearSurfaceAnimTimer()
  stopFinishAwayWatch()
  clearDevFinishTestTimer()
  stopNotchMarketingDemoTimers()
  marketingDemoActive = false
  stopEscapeHoldMonitor()
  expandEvent = null
  lastFinishChat = null
  finishQueue = []
  finishParked = false
  forceOverlayVisible = false
  unparkGuardUntil = 0
  devFinishTestPending = false
  surfaceVisible = false
  overlayReady = false
  overlayReadyWaiters = []
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
  if (marketingDemoActive) {
    ensureNotchOverlay()
    void showOverlayWhenReady()
    return
  }
  const settings = deps.getSettings()
  const capability = getNotchOverlayCapability()
  if (!settings.enabled || !capability.supported) {
    purgeNotchOverlays()
    return
  }

  // Preload the overlay while VibeBoard is focused so the first leave isn't a cold start.
  ensureNotchOverlay()

  // Main VibeBoard window is focused: keep the notch fully out of the way.
  if (deps.isMainAppFocused() && !forceOverlayVisible) {
    suppressNotchOverlay()
    return
  }

  if (!expandEvent?.showReply && finishQueue.length > 0) {
    const next = finishQueue.shift()!
    presentFinishChat(next)
    return
  }

  // Nothing running / waiting / finished-unread: stay tucked in the hardware notch.
  if (!expandEvent && !hasNotchActivity()) {
    hideEmptyNotchOverlay()
    return
  }

  snapshot = composeSnapshot(expandEvent ? 'expanded' : 'compact')
  publishSnapshot()
  void showOverlayWhenReady()
  applyFocusMode()
  applyMousePassthrough()
  maybeScheduleDevFinishExpand()
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

  if (isDone && settings.expandOnTaskCompleted && settings.showFinishChat) {
    const answer = truncateAnswer(deps.getLatestAssistantReply(input.task.id))
    enqueueFinishChat({
      headline: 'Finished',
      detail: input.task.title,
      taskId: input.task.id,
      taskTitle: input.task.title,
      answer,
      showReply: true,
      focusInput: true
    })
  } else if (expandEvent?.showReply) {
    // Keep the active finish panel / queue; only refresh compact counts underneath.
    snapshot = composeSnapshot('expanded')
    publishSnapshot()
    void showOverlayWhenReady()
    applyFocusMode()
    applyMousePassthrough()
  } else {
    clearCollapseTimer()
    expandEvent = null
    if (!hasNotchActivity()) {
      hideEmptyNotchOverlay()
      applyFocusMode()
      applyMousePassthrough()
    } else {
      snapshot = composeSnapshot('compact')
      publishSnapshot()
      void showOverlayWhenReady()
      applyFocusMode()
      applyMousePassthrough()
    }
  }

  if (becameAttention && settings.expandOnAttention && !deps.isMainAppFocused()) {
    deps.onOpenTask(input.task.id)
  }
}

function presentFinishChat(
  event: ExpandEvent,
  options?: { focusInput?: boolean; forceShow?: boolean }
): void {
  clearCollapseTimer()
  endEscapeHold()
  finishParked = false
  forceOverlayVisible = Boolean(options?.forceShow)
  // Brief guard so activation focus thrash doesn't instantly re-park.
  unparkGuardUntil = Date.now() + 400
  expandEvent = {
    ...event,
    focusInput: options?.focusInput ?? true
  }
  lastFinishChat = { ...expandEvent, focusInput: false }
  snapshot = composeSnapshot('expanded')
  publishSnapshot()
  void showOverlayWhenReady()
  applyFocusMode()
  pinOverlayFrame()
  applyMousePassthrough()
  startFinishAwayWatch()
}

function enqueueFinishChat(event: ExpandEvent): void {
  if (expandEvent?.showReply && expandEvent.taskId === event.taskId) {
    expandEvent = {
      ...event,
      focusInput: Boolean(expandEvent.focusInput && !finishParked)
    }
    lastFinishChat = { ...expandEvent, focusInput: false }
    snapshot = composeSnapshot('expanded')
    publishSnapshot()
    void showOverlayWhenReady()
    applyFocusMode()
    applyMousePassthrough()
    return
  }

  const existingIndex = finishQueue.findIndex((item) => item.taskId === event.taskId)
  if (existingIndex >= 0) {
    finishQueue[existingIndex] = { ...event, focusInput: false }
  } else if (expandEvent?.showReply) {
    finishQueue.push({ ...event, focusInput: false })
  } else {
    presentFinishChat(event)
    return
  }

  snapshot = composeSnapshot('expanded')
  publishSnapshot()
  void showOverlayWhenReady()
  applyMousePassthrough()
}

/** Close the current finish panel and show the next queued one, if any. */
function advanceFinishQueue(options?: {
  saveDismissed?: ExpandEvent | null
  clearReopen?: boolean
}): void {
  clearCollapseTimer()
  stopFinishAwayWatch()
  endEscapeHold()
  finishParked = false
  forceOverlayVisible = false

  const closed = options?.saveDismissed ?? (expandEvent?.showReply ? expandEvent : null)
  if (options?.clearReopen) {
    lastFinishChat = null
  } else if (closed?.showReply) {
    lastFinishChat = { ...closed, focusInput: false }
  }

  if (closed?.taskId) {
    finishQueue = finishQueue.filter((item) => item.taskId !== closed.taskId)
  }

  expandEvent = null

  if (finishQueue.length > 0) {
    const next = finishQueue.shift()!
    presentFinishChat(next)
    return
  }

  if (!hasNotchActivity()) {
    hideEmptyNotchOverlay()
    applyFocusMode()
    applyMousePassthrough()
    return
  }

  snapshot = composeSnapshot('compact')
  publishSnapshot()
  applyFocusMode()
  pinOverlayFrame()
  applyMousePassthrough()
}

export const collapseNotchOverlay = (): void => {
  clearCollapseTimer()
  stopFinishAwayWatch()
  endEscapeHold()
  expandEvent = null
  finishParked = false
  forceOverlayVisible = false
  if (!hasNotchActivity()) {
    hideEmptyNotchOverlay()
    applyFocusMode()
    applyMousePassthrough()
    return
  }
  snapshot = composeSnapshot('compact')
  publishSnapshot()
  applyFocusMode()
  pinOverlayFrame()
  applyMousePassthrough()
}

/** Close finish chat but keep it reopenable; advances to the next queued finish. */
export const dismissNotchFinishChat = (_options?: { force?: boolean }): boolean => {
  if (!expandEvent?.showReply) {
    if (finishQueue.length > 0) {
      const next = finishQueue.shift()!
      presentFinishChat(next)
      return true
    }
    collapseNotchOverlay()
    return true
  }
  advanceFinishQueue({ saveDismissed: expandEvent })
  return true
}

/** Reopen the last dismissed finish-chat panel. */
export const reopenNotchFinishChat = (): boolean => {
  if (!deps?.getSettings().enabled) return false
  if (deps.isMainAppFocused()) {
    suppressNotchOverlay()
    return false
  }
  if (expandEvent?.showReply) {
    if (finishParked) return unparkNotchFinishChat()
    return true
  }
  if (finishQueue.length > 0) {
    const next = finishQueue.shift()!
    presentFinishChat(next)
    return true
  }
  if (!lastFinishChat) return false
  presentFinishChat(lastFinishChat)
  return true
}

/** Expand a parked finish-chat panel after the user clicks it again. */
export const unparkNotchFinishChat = (): boolean => {
  if (!expandEvent?.showReply || !finishParked) return false
  endEscapeHold()
  finishParked = false
  // Guard only the activating click / focus thrash, not long enough to feel stuck.
  unparkGuardUntil = Date.now() + 450
  expandEvent = { ...expandEvent, focusInput: true }
  snapshot = composeSnapshot('expanded')
  publishSnapshot()
  // Don't reposition the BrowserWindow; only CSS height should change.
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setFocusable(true)
    setOverlayClickThrough(false)
    if (expandEvent.focusInput) {
      overlayWindow.webContents.focus()
      setTimeout(() => {
        if (expandEvent) expandEvent = { ...expandEvent, focusInput: false }
        if (snapshot.focusInput) {
          snapshot = { ...snapshot, focusInput: false }
        }
      }, 800)
    }
  }
  startFinishAwayWatch()
  return true
}

/**
 * Park (collapse) the finish panel to the mid strip.
 * Triggered by: click on the transparent overlay chrome, app switch, or Electron inactive.
 * Never triggered by mouse-leave alone.
 */
export const parkNotchFinishChat = (): boolean => {
  if (!expandEvent?.showReply || finishParked) return false
  if (Date.now() < unparkGuardUntil) return false
  stopFinishAwayWatch()
  endEscapeHold()
  finishParked = true
  forceOverlayVisible = false
  expandEvent = { ...expandEvent, focusInput: false }
  snapshot = composeSnapshot('expanded')
  publishSnapshot()
  applyMousePassthrough()
  return true
}

/**
 * Dev-only: arm a finish-chat test. When the notch appears (you leave VibeBoard),
 * wait briefly then expand the finish panel with no wall-clock race from the click.
 */
export const scheduleDevNotchFinishTest = (_delayMs?: number): boolean => {
  if (!is.dev) return false
  clearDevFinishTestTimer()
  devFinishTestPending = true
  ensureNotchOverlay()
  // Already in the background: expand after the notch reveal delay.
  maybeScheduleDevFinishExpand()
  return true
}

/**
 * Dev-only marketing demo: countdown lives in the main UI; this sequence
 * starts after that (~10s of notch beats with breathing room).
 * Allowed on Windows too so the scripted island can be filmed over the backdrop.
 */
export const startNotchMarketingDemo = (): boolean => {
  if (!is.dev) return false
  stopNotchMarketingDemo()
  marketingDemoActive = true
  forceOverlayVisible = true
  finishParked = false
  expandEvent = null
  finishQueue = []
  clearCollapseTimer()
  stopFinishAwayWatch()
  endEscapeHold()
  ensureNotchOverlay()

  const schedule = (ms: number, fn: () => void): void => {
    marketingDemoTimers.push(setTimeout(fn, ms))
  }

  const showCompact = (input: {
    headline: string
    trailing: string | null
    detail: string
    runningCount?: number
    attentionCount?: number
    doneCount?: number
  }): void => {
    expandEvent = null
    finishParked = false
    surfaceVisible = true
    snapshot = withSurface({
      mode: 'compact',
      runningCount: input.runningCount ?? 0,
      attentionCount: input.attentionCount ?? 0,
      doneCount: input.doneCount ?? 0,
      headline: input.headline,
      trailing: input.trailing,
      detail: input.detail,
      taskId: null,
      taskTitle: null,
      answer: null,
      showReply: false,
      focusInput: false,
      surfaceVisible: true,
      escapeCloseRemainingSec: null,
      parked: false,
      finishQueueRemaining: 0
    })
    publishSnapshot()
    void showOverlayWhenReady()
    applyFocusMode()
    applyMousePassthrough()
    pinOverlayFrame()
  }

  // Soft appear: running sessions
  showCompact({
    headline: 'Running',
    trailing: '3',
    detail: '3 sessions active',
    runningCount: 3
  })

  // Count ticks so the slot animation reads on camera
  schedule(1100, () => {
    if (!marketingDemoActive) return
    showCompact({
      headline: 'Running',
      trailing: '2',
      detail: '2 sessions active',
      runningCount: 2
    })
  })

  schedule(2000, () => {
    if (!marketingDemoActive) return
    showCompact({
      headline: 'Running',
      trailing: '1',
      detail: '1 session active',
      runningCount: 1
    })
  })

  // Needs attention
  schedule(3200, () => {
    if (!marketingDemoActive) return
    showCompact({
      headline: 'Needs you',
      trailing: '1',
      detail: '1 task waiting for input',
      attentionCount: 1,
      runningCount: 1
    })
  })

  // Done unread
  schedule(4600, () => {
    if (!marketingDemoActive) return
    showCompact({
      headline: 'Done',
      trailing: '2',
      detail: '2 finished, waiting to be viewed',
      doneCount: 2
    })
  })

  // Expand finish chat
  schedule(6000, () => {
    if (!marketingDemoActive) return
    presentFinishChat(
      {
        headline: 'Finished',
        detail: 'Fix auth redirect loop',
        taskId: 'dev-notch-marketing-demo',
        taskTitle: 'Fix auth redirect loop',
        answer:
          'Session cookies now use `path: /` and the auth guard redirects signed-in users straight to `/app`. Middleware skips the login bounce when a valid `sid` is present.',
        showReply: true,
        focusInput: false,
        simulated: true
      },
      { focusInput: false, forceShow: true }
    )
  })

  // Hold expanded, then park to mid strip
  schedule(8200, () => {
    if (!marketingDemoActive) return
    parkNotchFinishChat()
  })

  // Soft retract into the camera housing, then hide while still on that frame
  // (never publish an empty compact snapshot first; that flashes).
  schedule(9400, () => {
    if (!marketingDemoActive) return
    surfaceVisible = false
    snapshot = withSurface({
      ...snapshot,
      surfaceVisible: false
    })
    publishSnapshot()
  })

  schedule(9850, () => {
    if (!marketingDemoActive) return
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      try {
        setOverlayClickThrough(true)
        if (overlayWindow.isVisible()) overlayWindow.hide()
      } catch {
        // ignore
      }
    }
  })

  schedule(10000, () => {
    stopNotchMarketingDemo()
  })

  return true
}

export const stopNotchMarketingDemo = (): void => {
  stopNotchMarketingDemoTimers()
  if (!marketingDemoActive) return
  marketingDemoActive = false
  forceOverlayVisible = false
  finishParked = false
  expandEvent = null
  finishQueue = []
  endEscapeHold()
  stopFinishAwayWatch()
  surfaceVisible = false

  // Hide before resetting UI so the renderer never paints an empty compact beat.
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try {
      setOverlayClickThrough(true)
      if (overlayWindow.isVisible()) overlayWindow.hide()
    } catch {
      // ignore
    }
  }

  snapshot = composeSnapshot('compact')
  publishSnapshot()
}

function stopNotchMarketingDemoTimers(): void {
  for (const timer of marketingDemoTimers) clearTimeout(timer)
  marketingDemoTimers = []
}

/** Once the notch is showing in the background, expand the armed finish test. */
function maybeScheduleDevFinishExpand(): void {
  if (!is.dev || !devFinishTestPending) return
  if (deps?.isMainAppFocused()) return
  if (expandEvent?.showReply) {
    devFinishTestPending = false
    clearDevFinishTestTimer()
    return
  }
  if (devFinishTestTimer) return

  devFinishTestTimer = setTimeout(() => {
    devFinishTestTimer = null
    if (!devFinishTestPending) return
    if (deps?.isMainAppFocused()) return
    if (expandEvent?.showReply) {
      devFinishTestPending = false
      return
    }
    devFinishTestPending = false
    presentFinishChat(
      {
        headline: 'Finished',
        detail: 'Dev finish-chat test',
        taskId: `dev-notch-test-${Date.now()}`,
        taskTitle: 'Dev finish-chat test',
        answer:
          'Simulated agent reply. Click outside this island (or switch apps) to park it, then click the strip to expand again. Hold Esc 1.5s to close.',
        showReply: true,
        focusInput: false,
        simulated: true
      },
      { focusInput: false, forceShow: true }
    )
  }, DEV_FINISH_EXPAND_DELAY_MS)
}

/**
 * Watch for click-away / app-switch while finish chat is expanded.
 * Uses an open grace period (not "must click the panel first") so the first
 * click outside or app switch can park immediately after it appears.
 */
function startFinishAwayWatch(): void {
  stopFinishAwayWatch()
  if (!expandEvent?.showReply || finishParked) return
  // Marketing demo drives park on its own timeline.
  if (marketingDemoActive) return

  const openedAt = Date.now()
  const GRACE_MS = 450
  let wasActive = app.isActive()

  const inGrace = (): boolean => Date.now() - openedAt < GRACE_MS || Date.now() < unparkGuardUntil

  const tryPark = (): void => {
    if (!expandEvent?.showReply || finishParked) return
    if (inGrace()) return
    parkNotchFinishChat()
  }

  const onResign = (): void => {
    tryPark()
  }
  app.on('did-resign-active', onResign)

  const interval = setInterval(() => {
    if (!expandEvent?.showReply || finishParked) {
      stopFinishAwayWatch()
      return
    }
    const active = app.isActive()
    if (wasActive && !active) tryPark()
    wasActive = active
  }, 80)

  const onBlur = (): void => {
    setTimeout(() => {
      if (!expandEvent?.showReply || finishParked) return
      if (inGrace()) return
      if (app.isActive() && overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isFocused()) {
        return
      }
      tryPark()
    }, 60)
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.on('blur', onBlur)
  }

  stopAwayWatch = () => {
    app.removeListener('did-resign-active', onResign)
    clearInterval(interval)
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.removeListener('blur', onBlur)
    }
    stopAwayWatch = null
  }
}

function stopFinishAwayWatch(): void {
  if (!stopAwayWatch) return
  stopAwayWatch()
}

function clearDevFinishTestTimer(): void {
  if (!devFinishTestTimer) return
  clearTimeout(devFinishTestTimer)
  devFinishTestTimer = null
}

export const peekNotchOverlay = (): void => {
  // Intentionally no-op; peek expands were just noise.
}

export const openTaskFromNotch = (taskId: string): void => {
  if (expandEvent?.simulated || isSimulatedNotchTaskId(taskId)) {
    advanceFinishQueue({ clearReopen: true, saveDismissed: expandEvent })
    return
  }
  deps?.onOpenTask(taskId)
  advanceFinishQueue({ clearReopen: true, saveDismissed: expandEvent })
}

export const sendReplyFromNotch = async (taskId: string, content: string): Promise<void> => {
  const trimmed = content.trim()
  if (!trimmed || !deps) return
  // Dev finish-chat test (and any other simulated panel) has no DB task.
  if (expandEvent?.simulated || isSimulatedNotchTaskId(taskId)) {
    advanceFinishQueue({ clearReopen: true, saveDismissed: expandEvent })
    return
  }
  try {
    await deps.onSendReply(taskId, trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    // Task was deleted while the finish panel was open: just close it.
    if (/no longer exists/i.test(message)) {
      advanceFinishQueue({ clearReopen: true, saveDismissed: expandEvent })
      return
    }
    throw error
  }
  advanceFinishQueue({ clearReopen: true, saveDismissed: expandEvent })
}

function isSimulatedNotchTaskId(taskId: string): boolean {
  return taskId.startsWith('dev-notch-test-')
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
    focusInput: false,
    surfaceVisible: false,
    escapeCloseRemainingSec: null,
    parked: false,
    finishQueueRemaining: 0
  }
}

function composeSnapshot(mode: 'compact' | 'expanded'): NotchOverlaySnapshot {
  const base = buildCountsSnapshot(mode)
  if (mode === 'expanded' && expandEvent) {
    return withSurface({
      ...base,
      mode: 'expanded',
      headline: expandEvent.headline,
      detail: expandEvent.detail,
      taskId: expandEvent.taskId || null,
      taskTitle: expandEvent.taskTitle || null,
      answer: expandEvent.answer,
      showReply: expandEvent.showReply,
      focusInput: expandEvent.focusInput,
      parked: finishParked,
      finishQueueRemaining: finishQueue.length
    })
  }
  return withSurface(base)
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
      focusInput: false,
      surfaceVisible: surfaceVisible,
      escapeCloseRemainingSec: null,
      parked: false,
      finishQueueRemaining: 0
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
      focusInput: false,
      surfaceVisible: surfaceVisible,
      escapeCloseRemainingSec: null,
      parked: false,
      finishQueueRemaining: 0
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
      focusInput: false,
      surfaceVisible: surfaceVisible,
      escapeCloseRemainingSec: null,
      parked: false,
      finishQueueRemaining: 0
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
      focusInput: false,
      surfaceVisible: surfaceVisible,
      escapeCloseRemainingSec: null,
      parked: false,
      finishQueueRemaining: 0
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
    focusInput: false,
    surfaceVisible: surfaceVisible,
    escapeCloseRemainingSec: null,
    parked: false,
    finishQueueRemaining: 0
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

  overlayReady = false
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
  overlayWindow = window

  window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, 3)
  if (isMac) {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.excludedFromShownWindowsMenu = true
    window.setWindowButtonVisibility(false)
  }
  // Start click-through until we know the panel needs interaction.
  setOverlayClickThrough(true)
  window.on('closed', () => {
    if (overlayWindow?.id === window.id) {
      overlayWindow = null
    }
  })
  window.on('move', () => {
    if (pinningPosition || !overlayWindow || overlayWindow.isDestroyed()) return
    pinOverlayFrame()
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/overlay.html'))
  }

  window.webContents.on('did-finish-load', () => {
    overlayReady = true
    applyIslandMetrics()
    publishSnapshot()
    pinOverlayFrame()
    applyMousePassthrough()
    const waiters = overlayReadyWaiters
    overlayReadyWaiters = []
    for (const resolve of waiters) resolve()
    // Only auto-show if VibeBoard isn't focused (warm load stays hidden).
    if (!deps?.isMainAppFocused()) {
      showOverlay()
      applyFocusMode()
    }
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

function whenOverlayReady(): Promise<void> {
  if (overlayReady && overlayWindow && !overlayWindow.isDestroyed()) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    overlayReadyWaiters.push(resolve)
  })
}

async function showOverlayWhenReady(): Promise<void> {
  ensureNotchOverlay()
  await whenOverlayReady()
  showOverlay()
}

function showOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (deps?.isMainAppFocused() && !forceOverlayVisible) {
    suppressNotchOverlay()
    return
  }
  if (!expandEvent && !hasNotchActivity() && !marketingDemoActive && !forceOverlayVisible) {
    hideEmptyNotchOverlay()
    return
  }

  clearSurfaceAnimTimer()
  const wasHidden = !overlayWindow.isVisible()

  // Never activate the app just to show status; use inactive show.
  if (wasHidden) {
    surfaceVisible = false
    snapshot = withSurface(snapshot)
    overlayWindow.showInactive()
    publishSnapshot()
    pinOverlayFrame()
    applyMousePassthrough()
    // Next ticks: slide the island out of the hardware notch.
    surfaceAnimTimer = setTimeout(() => {
      surfaceAnimTimer = null
      if (!overlayWindow || overlayWindow.isDestroyed()) return
      if (deps?.isMainAppFocused()) return
      if (!expandEvent && !hasNotchActivity() && !marketingDemoActive && !forceOverlayVisible) {
        hideEmptyNotchOverlay()
        return
      }
      surfaceVisible = true
      snapshot = withSurface(snapshot)
      publishSnapshot()
      pinOverlayFrame()
      applyMousePassthrough()
      maybeScheduleDevFinishExpand()
    }, 20)
    return
  }

  if (!surfaceVisible) {
    surfaceVisible = true
    snapshot = withSurface(snapshot)
    publishSnapshot()
  }
  pinOverlayFrame()
  applyMousePassthrough()
  maybeScheduleDevFinishExpand()
}

/** True when the compact island has something worth showing. */
function hasNotchActivity(): boolean {
  if (expandEvent) return true
  if (finishQueue.length > 0) return true
  const runningCount = deps?.getRunningCount() ?? 0
  const attentionCount = deps?.getAttentionCount() ?? 0
  const doneUnreadCount = deps?.getDoneUnreadCount() ?? 0
  return runningCount > 0 || attentionCount > 0 || doneUnreadCount > 0
}

/** Hide completely when idle. No tucked black strip under the camera. */
function hideEmptyNotchOverlay(): void {
  clearCollapseTimer()
  clearSurfaceAnimTimer()
  clearDevFinishTestTimer()
  stopFinishAwayWatch()
  endEscapeHold()
  forceOverlayVisible = false
  surfaceVisible = false
  snapshot = withSurface(composeSnapshot('compact'))
  publishSnapshot()

  if (!overlayWindow || overlayWindow.isDestroyed()) return

  try {
    setOverlayClickThrough(true)
    overlayWindow.setFocusable(false)
    if (overlayWindow.isVisible()) overlayWindow.hide()
  } catch {
    // Window may already be tearing down.
  }
}

function suppressNotchOverlay(): void {
  clearCollapseTimer()
  clearSurfaceAnimTimer()
  // Coming back to VibeBoard: pause the expand countdown; stay armed if still pending.
  clearDevFinishTestTimer()
  stopFinishAwayWatch()
  endEscapeHold()
  // Stash the active finish panel so it can resume after leaving VibeBoard.
  if (expandEvent?.showReply) {
    finishQueue.unshift({ ...expandEvent, focusInput: false })
  }
  expandEvent = null
  finishParked = false
  forceOverlayVisible = false
  snapshot = composeSnapshot('compact')
  if (!overlayWindow || overlayWindow.isDestroyed()) return

  try {
    setOverlayClickThrough(true)
    overlayWindow.setFocusable(false)
  } catch {
    // Window may already be tearing down.
  }

  if (!overlayWindow.isVisible()) {
    surfaceVisible = false
    return
  }

  // Slide back into the notch, then hide the window.
  surfaceVisible = false
  snapshot = withSurface(snapshot)
  publishSnapshot()

  surfaceAnimTimer = setTimeout(() => {
    surfaceAnimTimer = null
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    // If focus left VibeBoard again during the exit animation, keep showing.
    if (deps && !deps.isMainAppFocused() && deps.getSettings().enabled) {
      showOverlay()
      return
    }
    surfaceVisible = false
    try {
      if (overlayWindow.isVisible()) overlayWindow.hide()
    } catch {
      // Window may already be tearing down.
    }
  }, SURFACE_ANIM_MS)
}

function applyFocusMode(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  // Finish chat stays focusable so click-away works immediately after open.
  if (expandEvent?.showReply) {
    overlayWindow.setFocusable(true)
    if (finishParked) return
    // Activate so the first outside click / app switch can park; otherwise the
    // panel is inert until you click it once. Skip during scripted marketing demos.
    if (!marketingDemoActive && process.platform === 'darwin') {
      app.focus({ steal: true })
    }
    if (!marketingDemoActive) {
      overlayWindow.show()
      overlayWindow.focus()
    } else {
      overlayWindow.showInactive()
    }
    if (expandEvent.focusInput) {
      overlayWindow.webContents.focus()
      setTimeout(() => {
        if (expandEvent) expandEvent = { ...expandEvent, focusInput: false }
        if (snapshot.focusInput) {
          snapshot = { ...snapshot, focusInput: false }
        }
      }, 800)
    }
    return
  }
  // Idle / compact status must never steal keyboard focus from other apps.
  overlayWindow.setFocusable(false)
}

/** Compact idle status is click-through so Chrome tabs near the notch stay usable. */
function applyMousePassthrough(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (expandEvent?.showReply) {
    if (finishParked) {
      // Parked strip: click-through until the pointer hovers the island.
      setOverlayClickThrough(true)
      return
    }
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
 * Expanded finish chat always captures mouse so click-away works.
 */
export const setNotchOverlayMousePassthrough = (passthrough: boolean): void => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (!expandEvent?.showReply) {
    applyMousePassthrough()
    return
  }
  if (!finishParked) {
    setOverlayClickThrough(false)
    return
  }
  setOverlayClickThrough(passthrough)
}

function isOverlayMouseInteractive(): boolean {
  // Expanded finish-chat needs clicks for reply / open task.
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
  overlayWindow.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, 3)
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
  // Finish-chat keeps a full-height window so park/expand can animate vertically.
  // Parked state only shrinks the island visually; transparent pixels click through.
  if (expandEvent?.showReply) {
    const height = menuBarHeight + CHAT_EXTRA_HEIGHT
    const { x, y } = topCenteredOrigin(display, EXPANDED_WIDTH)
    return { x, y, width: EXPANDED_WIDTH, height }
  }
  const { x, y } = topCenteredOrigin(display, COMPACT_WIDTH)
  return { x, y, width: COMPACT_WIDTH, height: menuBarHeight }
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
    --notch-parked-height: ${menuBarHeight + PARKED_EXTRA_HEIGHT}px;
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

function withSurface(next: NotchOverlaySnapshot): NotchOverlaySnapshot {
  return {
    ...next,
    surfaceVisible,
    escapeCloseRemainingSec: currentEscapeCloseRemainingSec(),
    parked: Boolean(expandEvent?.showReply && finishParked),
    finishQueueRemaining: expandEvent?.showReply ? finishQueue.length : 0
  }
}

function currentEscapeCloseRemainingSec(): number | null {
  if (!expandEvent?.showReply) return null
  if (escHoldStartedAt == null) return ESCAPE_HOLD_DEFAULT_SEC
  const remainingMs = Math.max(0, ESCAPE_HOLD_MS - (Date.now() - escHoldStartedAt))
  return Math.round(remainingMs / 100) / 10
}

function syncEscapeHoldMonitor(): void {
  const want = Boolean(expandEvent?.showReply)
  if (want && !stopEscMonitor) {
    stopEscMonitor = startMacEscapeKeyMonitor((down) => {
      if (down) beginEscapeHold()
      else endEscapeHold()
    })
    return
  }
  if (!want && stopEscMonitor) {
    stopEscapeHoldMonitor()
  }
}

function beginEscapeHold(): void {
  if (!expandEvent?.showReply || escHoldStartedAt != null) return
  escHoldStartedAt = Date.now()
  if (escHoldTimer) clearInterval(escHoldTimer)
  escHoldTimer = setInterval(() => {
    if (escHoldStartedAt == null) return
    const remainingMs = ESCAPE_HOLD_MS - (Date.now() - escHoldStartedAt)
    snapshot = withSurface(snapshot)
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('notch:snapshot', snapshot)
    }
    if (remainingMs <= 0) {
      endEscapeHold()
      dismissNotchFinishChat({ force: true })
    }
  }, 100)
  snapshot = withSurface(snapshot)
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('notch:snapshot', snapshot)
  }
}

function endEscapeHold(): void {
  escHoldStartedAt = null
  if (escHoldTimer) {
    clearInterval(escHoldTimer)
    escHoldTimer = null
  }
  if (expandEvent?.showReply) {
    snapshot = withSurface(snapshot)
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('notch:snapshot', snapshot)
    }
  }
}

function stopEscapeHoldMonitor(): void {
  endEscapeHold()
  if (stopEscMonitor) {
    stopEscMonitor()
    stopEscMonitor = null
  }
}

function publishSnapshot(): void {
  syncEscapeHoldMonitor()
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  snapshot = withSurface(snapshot)
  overlayWindow.webContents.send('notch:snapshot', snapshot)
}

function clearSurfaceAnimTimer(): void {
  if (!surfaceAnimTimer) return
  clearTimeout(surfaceAnimTimer)
  surfaceAnimTimer = null
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
  // Marketing demo: pin to the display under the cursor so Windows multi-monitor
  // setups keep the island over the nature backdrop.
  if (marketingDemoActive) {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  }
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
  // Windows / Linux have no menu-bar notch inset; keep a stable island height for demos.
  if (!isMac) return 37
  const menuBarHeight = display.workArea.y - display.bounds.y
  // Notched models use ~37 even if workArea briefly reports lower while waking.
  if (macHardwareLikelyHasNotch(getMacHardwareModel() ?? '') && menuBarHeight < 28) {
    return 37
  }
  return Math.max(30, Math.min(38, Math.round(menuBarHeight || 37)))
}

function getMacHardwareModel(): string | null {
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
    // Mac mini M4 is Mac16,10 / Mac16,11; everything else in this series is laptop.
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
