import { app, screen } from 'electron'
import { startMacMouseDownMonitor } from '../mouseDownMonitor'
import { S } from './state'
import { bridge, registerBridge } from './bridge'
import type { ExpandEvent } from './types'
import { HEIGHT_ANIM_MS, SIDE_REVEAL_MS, SIDE_REVEAL_DELAY_MS } from './types'
import {
  cancelAnimation,
  afterMs,
  publishPhaseSnapshot,
  isFinishPhase,
  isRunningPhase
} from './phase'
import { composeSnapshot, publishSnapshot, truncateAnswer } from './snapshot'
import { pinOverlayFrame } from './geometry'
import {
  ensureNotchOverlay,
  whenOverlayReady,
  showOverlayInactive,
  hideEmptyNotchOverlay,
  applyFocusMode,
  applyMousePassthrough,
  setOverlayClickThrough,
  hasNotchActivity
} from './window'

export const clearNotchFinishForTask = (taskId: string): void => {
  if (!taskId) return
  S.finishQueue = S.finishQueue.filter((item) => item.taskId !== taskId)
  if (S.lastFinishChat?.taskId === taskId) {
    S.lastFinishChat = null
  }
  if (S.expandEvent?.showReply && S.expandEvent.taskId === taskId) {
    if (isFinishPhase() && S.phase !== 'finishDismissing') {
      startFinishDismiss({
        stashToQueue: false,
        advanceQueue: true,
        clearReopen: true,
        verticalOnly: true
      })
      return
    }
    S.expandEvent = null
  }
}

/** Next queued finish that still needs attention (skips already-viewed tasks). */
export function takeNextPendingFinish(): ExpandEvent | null {
  while (S.finishQueue.length > 0) {
    const next = S.finishQueue.shift()!
    if (!next.taskId || bridge.isSimulatedNotchTaskId(next.taskId)) return next
    if (S.deps?.isTaskFinishPending(next.taskId)) return next
  }
  return null
}

export function presentFinishChat(
  event: ExpandEvent,
  options?: {
    focusInput?: boolean
    forceShow?: boolean
    /** Already at status height with sides open (e.g. after Esc vertical dismiss). */
    fromRevealedStatus?: boolean
  }
): void {
  const settings = S.deps?.getSettings()
  if (settings && (!settings.enabled || !settings.showFinishChat || !settings.expandOnTaskCompleted)) {
    // Setting off - never present finish chat.
    return
  }

  // Capture before we change S.phase - expand from the live "Done / Running" island
  // instead of tucking to 0 and growing out of the camera housing.
  const windowVisible = Boolean(
    S.overlayWindow && !S.overlayWindow.isDestroyed() && S.overlayWindow.isVisible()
  )
  const expandFromExisting =
    Boolean(options?.fromRevealedStatus) ||
    (windowVisible && S.appearStep >= 1 && (S.phase === 'compact' || S.phase === 'finishParked'))

  cancelAnimation()
  bridge.endEscapeHold()
  stopFinishAwayWatch()
  // Finish chat wins over the running overview (unless detail is pinned — caller should queue).
  if (isRunningPhase()) {
    S.selectedRunningTaskId = null
    S.runningDetailOpen = false
    S.overviewKind = 'running'
    stopFinishAwayWatch()
  }
  S.forceOverlayVisible = Boolean(options?.forceShow) || S.forceOverlayVisible
  S.unparkGuardUntil = Date.now() + 400
  S.expandEvent = {
    ...event,
    focusInput: options?.focusInput ?? true
  }
  S.lastFinishChat = { ...S.expandEvent, focusInput: false }

  if (bridge.shouldKeepNotchDark() && !S.forceOverlayVisible) {
    // Don't show over the board / during launch - queue for when the user leaves.
    S.finishQueue = S.finishQueue.filter((item) => item.taskId !== event.taskId)
    S.finishQueue.unshift({ ...S.expandEvent, focusInput: false })
    S.expandEvent = null
    S.phase = 'hidden'
    S.appearStep = 0
    S.dismissStep = 0
    hideEmptyNotchOverlay()
    return
  }

  S.phase = 'finishAppearing'
  // Keep sides open when morphing from an existing island; only cold-start from tucked.
  S.appearStep = expandFromExisting ? 1 : 0
  S.dismissStep = 0
  ensureNotchOverlay()
  void whenOverlayReady().then(() => {
    if (S.phase !== 'finishAppearing' || !S.expandEvent?.showReply) return
    if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
    if (bridge.shouldKeepNotchDark()) {
      bridge.dismissForMainFocus()
      return
    }
    showOverlayInactive()

    /** After status band is full-width: grow height only. */
    const growHeightToOpen = (): void => {
      if (S.phase !== 'finishAppearing' || !S.expandEvent?.showReply) return
      if (bridge.shouldKeepNotchDark()) {
        bridge.dismissForMainFocus()
        return
      }
      // Never animate BrowserWindow bounds (transparent panels flash on macOS).
      S.phase = 'finishOpen'
      S.appearStep = 2
      pinOverlayFrame()
      publishPhaseSnapshot()
      applyMousePassthrough()
      startFinishAwayWatch()
      afterMs(HEIGHT_ANIM_MS, () => {
        if (S.phase !== 'finishOpen' || !S.expandEvent?.showReply) return
        applyFocusMode()
      })
    }

    /** Widen at status height first, then grow vertically. */
    const widenThenGrow = (): void => {
      if (S.phase !== 'finishAppearing' || !S.expandEvent?.showReply) return
      if (bridge.shouldKeepNotchDark()) {
        bridge.dismissForMainFocus()
        return
      }
      S.appearStep = 2
      publishPhaseSnapshot()
      afterMs(SIDE_REVEAL_MS, growHeightToOpen)
    }

    if (expandFromExisting) {
      // Already a revealed compact pill: widen horizontally, then grow height.
      S.appearStep = 1
      publishPhaseSnapshot()
      applyMousePassthrough()
      afterMs(32, () => {
        if (S.phase !== 'finishAppearing' || !S.expandEvent?.showReply) return
        pinOverlayFrame()
        afterMs(32, widenThenGrow)
      })
      return
    }

    // Cold start: tucked → sides out (still narrow) → widen → grow height
    publishPhaseSnapshot()
    applyMousePassthrough()
    pinOverlayFrame()
    afterMs(SIDE_REVEAL_DELAY_MS, () => {
      if (S.phase !== 'finishAppearing' || !S.expandEvent?.showReply) return
      if (bridge.shouldKeepNotchDark()) {
        bridge.dismissForMainFocus()
        return
      }
      S.appearStep = 1
      publishPhaseSnapshot()
      afterMs(SIDE_REVEAL_MS, widenThenGrow)
    })
  })
}

export function enqueueFinishChat(
  event: ExpandEvent,
  options?: { queueOnly?: boolean }
): void {
  // Pinned running-detail: never steal the page; queue finish for when they leave.
  if (!options?.queueOnly && isRunningPhase() && S.runningDetailOpen) {
    enqueueFinishChat(event, { queueOnly: true })
    if (isRunningPhase()) publishPhaseSnapshot()
    return
  }

  if (options?.queueOnly) {
    const existingIndex = S.finishQueue.findIndex((item) => item.taskId === event.taskId)
    if (existingIndex >= 0) {
      S.finishQueue[existingIndex] = { ...event, focusInput: false }
    } else {
      S.finishQueue.push({ ...event, focusInput: false })
    }
    return
  }

  if (S.expandEvent?.showReply && S.expandEvent.taskId === event.taskId) {
    S.expandEvent = {
      ...event,
      focusInput: Boolean(S.expandEvent.focusInput && S.phase === 'finishOpen')
    }
    S.lastFinishChat = { ...S.expandEvent, focusInput: false }
    publishPhaseSnapshot()
    return
  }

  const existingIndex = S.finishQueue.findIndex((item) => item.taskId === event.taskId)
  if (existingIndex >= 0) {
    S.finishQueue[existingIndex] = { ...event, focusInput: false }
  } else if (S.expandEvent?.showReply || isFinishPhase()) {
    S.finishQueue.push({ ...event, focusInput: false })
  } else {
    presentFinishChat(event)
    return
  }

  publishPhaseSnapshot()
}

/**
 * Close the current finish panel and show the next queued one, if any.
 * When the finish island is visible, always shrink→tuck first (same as Esc / app focus).
 */
export function advanceFinishQueue(options?: {
  saveDismissed?: ExpandEvent | null
  clearReopen?: boolean
}): void {
  const closed = options?.saveDismissed ?? (S.expandEvent?.showReply ? S.expandEvent : null)
  const windowVisible =
    Boolean(S.overlayWindow && !S.overlayWindow.isDestroyed() && S.overlayWindow.isVisible())

  if (
    closed?.showReply &&
    windowVisible &&
    isFinishPhase() &&
    S.phase !== 'finishDismissing'
  ) {
    startFinishDismiss({
      stashToQueue: false,
      advanceQueue: true,
      saveDismissed: closed,
      clearReopen: options?.clearReopen,
      // Esc / send / open-task: height only - no tuck into the camera (compact often returns).
      verticalOnly: true
    })
    return
  }

  // Already hidden / mid-dismiss cleanup - settle immediately.
  cancelAnimation()
  stopFinishAwayWatch()
  bridge.endEscapeHold()
  S.forceOverlayVisible = false

  if (options?.clearReopen) {
    S.lastFinishChat = null
  } else if (closed?.showReply) {
    S.lastFinishChat = { ...closed, focusInput: false }
  }

  if (closed?.taskId) {
    S.finishQueue = S.finishQueue.filter((item) => item.taskId !== closed.taskId)
  }

  S.expandEvent = null
  S.phase = 'hidden'
  S.appearStep = 0
  S.dismissStep = 0

  if (S.deps && !S.deps.isMainAppFocused()) {
    const next = takeNextPendingFinish()
    if (next) {
      presentQueuedFinish(next)
      return
    }
  }

  if (bridge.shouldKeepNotchDark()) {
    hideEmptyNotchOverlay()
    return
  }

  void bridge.revealCompact()
}

export const collapseNotchOverlay = (): void => {
  cancelAnimation()
  stopFinishAwayWatch()
  bridge.endEscapeHold()
  S.expandEvent = null
  S.forceOverlayVisible = false
  S.phase = 'hidden'
  S.appearStep = 0
  S.dismissStep = 0
  if (bridge.shouldKeepNotchDark()) {
    hideEmptyNotchOverlay()
    return
  }
  void bridge.revealCompact()
}

/** Close finish chat but keep it reopenable; advances to the next queued finish. */
export const dismissNotchFinishChat = (_options?: { force?: boolean }): boolean => {
  if (isRunningPhase()) {
    return bridge.closeRunningOverview({ revealCompactAfter: true })
  }
  if (!S.expandEvent?.showReply) {
    const next = takeNextPendingFinish()
    if (next) {
      presentQueuedFinish(next)
      return true
    }
    collapseNotchOverlay()
    return true
  }
  // Esc close: shrink vertically only (no horizontal tuck - status often stays visible).
  startFinishDismiss({
    stashToQueue: false,
    advanceQueue: true,
    saveDismissed: S.expandEvent,
    verticalOnly: true
  })
  return true
}

/** Reopen the last dismissed finish panel (Done overview for real tasks). */
export const reopenNotchFinishChat = (): boolean => {
  if (!S.deps?.getSettings().enabled) return false
  if (S.deps.isMainAppFocused()) {
    bridge.dismissForMainFocus()
    return false
  }
  if (S.expandEvent?.showReply) {
    if (S.phase === 'finishParked') return unparkNotchFinishChat()
    return true
  }
  const queued = takeNextPendingFinish()
  if (queued) {
    presentQueuedFinish(queued)
    return true
  }
  if ((S.deps.getDoneUnreadCount() ?? 0) > 0) {
    return bridge.openStatusOverview('done')
  }
  if (!S.lastFinishChat) return false
  if (
    S.lastFinishChat.taskId &&
    !bridge.isSimulatedNotchTaskId(S.lastFinishChat.taskId) &&
    !S.deps.isTaskFinishPending(S.lastFinishChat.taskId)
  ) {
    S.lastFinishChat = null
    return false
  }
  if (S.lastFinishChat.taskId && !bridge.isSimulatedNotchTaskId(S.lastFinishChat.taskId)) {
    presentDoneOverviewForTask(S.lastFinishChat.taskId, {
      openDetail: S.deps.getSettings().showFinishChat
    })
    return true
  }
  presentFinishChat(S.lastFinishChat)
  return true
}

export function queueDoneOverviewExpand(input: {
  taskId: string
  title: string
  projectName: string | null
}): void {
  if (!S.deps) return
  const answer = truncateAnswer(S.deps.getLatestAssistantReply(input.taskId))
  enqueueFinishChat(
    {
      headline: 'Finished',
      detail: input.title,
      taskId: input.taskId,
      taskTitle: input.title,
      projectName: input.projectName,
      answer,
      showReply: true,
      focusInput: false
    },
    { queueOnly: true }
  )
}

/** Present a queued finish: Done overview for real tasks, finish-chat for sims. */
export function presentQueuedFinish(event: ExpandEvent): void {
  if (event.simulated || (event.taskId && bridge.isSimulatedNotchTaskId(event.taskId))) {
    presentFinishChat(event)
    return
  }
  if (event.taskId) {
    presentDoneOverviewForTask(event.taskId, {
      openDetail: S.deps?.getSettings().showFinishChat ?? true
    })
    return
  }
  presentFinishChat(event)
}

/**
 * Open the Done overview (same UI as clicking compact Done).
 * Optionally land on a task detail when "show answer and reply" is enabled.
 */
export function presentDoneOverviewForTask(
  taskId: string,
  options?: { openDetail?: boolean; forceShow?: boolean }
): void {
  if (!S.deps?.getSettings().enabled) return
  if ((S.deps.getDoneUnreadCount() ?? 0) <= 0 && !S.deps.getTaskNotchMeta(taskId)) return

  const openDetail = Boolean(options?.openDetail)
  const meta = S.deps.getTaskNotchMeta(taskId)
  const queueFromMeta = (): void => {
    if (!meta) return
    queueDoneOverviewExpand({
      taskId,
      title: meta.title,
      projectName: meta.projectName
    })
  }

  // Pinned running detail: never steal the page; refresh it as finished + queue.
  if (isRunningPhase() && S.runningDetailOpen && S.overviewKind === 'running') {
    queueFromMeta()
    if (S.selectedRunningTaskId === taskId) {
      // Keep the same detail open; S.snapshot flips to answer (no system stream).
      S.runningDetailOpen = true
    }
    publishPhaseSnapshot()
    applyFocusMode()
    applyMousePassthrough()
    return
  }

  // Already on Done overview: refresh the list; don't steal an open detail.
  if (isRunningPhase() && S.overviewKind === 'done') {
    if (openDetail && !S.runningDetailOpen) {
      S.selectedRunningTaskId = taskId
      S.runningDetailOpen = true
    }
    publishPhaseSnapshot()
    applyFocusMode()
    applyMousePassthrough()
    return
  }

  if (isFinishPhase()) {
    queueFromMeta()
    return
  }

  bridge.presentRunningOverview('done', {
    forceShow: options?.forceShow,
    selectTaskId: openDetail ? taskId : null,
    openDetail
  })
}

export const unparkNotchFinishChat = (): boolean => {
  if (S.phase === 'runningParked') return bridge.unparkNotchRunningDetail()
  if (!S.expandEvent?.showReply || S.phase !== 'finishParked') return false
  cancelAnimation()
  bridge.endEscapeHold()
  S.unparkGuardUntil = Date.now() + 450
  S.phase = 'finishOpen'
  S.expandEvent = { ...S.expandEvent, focusInput: false }
  pinOverlayFrame()
  publishPhaseSnapshot()
  if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
    S.overlayWindow.setFocusable(true)
    setOverlayClickThrough(false)
  }
  startFinishAwayWatch()

  S.unparkFocusTimer = setTimeout(() => {
    S.unparkFocusTimer = null
    if (S.phase !== 'finishOpen' || !S.expandEvent?.showReply) return
    if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
    S.expandEvent = { ...S.expandEvent, focusInput: true }
    publishPhaseSnapshot()
    try {
      S.overlayWindow.webContents.focus()
    } catch {
      // ignore
    }
    S.focusInputClearTimer = setTimeout(() => {
      S.focusInputClearTimer = null
      if (S.expandEvent) S.expandEvent = { ...S.expandEvent, focusInput: false }
      if (S.snapshot.focusInput) {
        S.snapshot = { ...S.snapshot, focusInput: false }
      }
    }, 800)
  }, HEIGHT_ANIM_MS)
  return true
}

/**
 * Park (collapse) the finish panel or Running/Done task detail to the mid strip.
 * Triggered by: click on the transparent overlay chrome, app switch, or Electron inactive.
 * Never triggered by mouse-leave alone. Ignored while dismissing/appearing.
 */
export const parkNotchFinishChat = (): boolean => {
  if (S.phase === 'runningOpen' && S.runningDetailOpen) return bridge.parkNotchRunningDetail()
  if (!S.expandEvent?.showReply) return false
  if (S.phase !== 'finishOpen') return false
  if (Date.now() < S.unparkGuardUntil) return false
  stopFinishAwayWatch()
  bridge.endEscapeHold()
  S.phase = 'finishParked'
  S.forceOverlayVisible = false
  S.expandEvent = { ...S.expandEvent, focusInput: false }
  publishPhaseSnapshot()
  applyMousePassthrough()
  return true
}

/**
 * Finish dismiss.
 * - Default (app focus): shrink → tuck into camera → hide.
 * - verticalOnly (Esc / send / open-task): height only, sides stay open, then
 *   settle into compact or the next finish - no tuck→reappear glitch.
 */
export function startFinishDismiss(options: {
  stashToQueue: boolean
  advanceQueue?: boolean
  saveDismissed?: ExpandEvent | null
  clearReopen?: boolean
  verticalOnly?: boolean
}): void {
  if (S.phase === 'finishDismissing') return
  if (!S.expandEvent?.showReply && !isFinishPhase()) {
    hideEmptyNotchOverlay()
    return
  }

  cancelAnimation()
  stopFinishAwayWatch()
  bridge.endEscapeHold()
  S.forceOverlayVisible = false

  const closed = options.saveDismissed ?? (S.expandEvent?.showReply ? { ...S.expandEvent, focusInput: false } : null)
  const stash = options.stashToQueue ? closed : null
  const verticalOnly = Boolean(options.verticalOnly)

  // Already hidden - finish cleanup immediately.
  if (!S.overlayWindow || S.overlayWindow.isDestroyed() || !S.overlayWindow.isVisible()) {
    finishDismissCleanup({
      stash,
      closed,
      advanceQueue: options.advanceQueue,
      clearReopen: options.clearReopen,
      verticalOnly
    })
    return
  }

  S.phase = 'finishDismissing'
  S.dismissStep = 0
  S.appearStep = 0
  // Esc / settle to compact: narrow after height. App-focus: tuck after height.
  S.finishDismissNarrow = verticalOnly
  // Keep S.expandEvent so the finish UI paints during shrink/tuck.
  try {
    setOverlayClickThrough(true)
    S.overlayWindow.setFocusable(false)
  } catch {
    // ignore
  }
  pinOverlayFrame()
  publishPhaseSnapshot()

  // 1) Shrink to status (full width)
  afterMs(HEIGHT_ANIM_MS, () => {
    if (S.phase !== 'finishDismissing') return

    // 2) Horizontal: narrow to compact pill, or tuck into camera
    S.dismissStep = 1
    publishPhaseSnapshot()
    afterMs(SIDE_REVEAL_MS, () => {
      if (S.phase !== 'finishDismissing') return
      finishDismissCleanup({
        stash,
        closed,
        advanceQueue: options.advanceQueue,
        clearReopen: options.clearReopen,
        verticalOnly
      })
    })
  })
}

export function finishDismissCleanup(options: {
  stash: ExpandEvent | null
  closed: ExpandEvent | null
  advanceQueue?: boolean
  clearReopen?: boolean
  verticalOnly?: boolean
}): void {
  S.finishDismissNarrow = false
  if (options.stash) {
    S.finishQueue = S.finishQueue.filter((item) => item.taskId !== options.stash!.taskId)
    S.finishQueue.unshift(options.stash)
  }

  if (options.clearReopen) {
    S.lastFinishChat = null
  } else if (options.advanceQueue && options.closed?.showReply) {
    S.lastFinishChat = { ...options.closed, focusInput: false }
  }

  if (options.advanceQueue && options.closed?.taskId) {
    S.finishQueue = S.finishQueue.filter((item) => item.taskId !== options.closed!.taskId)
  }

  S.expandEvent = null
  S.appearStep = 0
  S.dismissStep = 0

  const stayInBackground =
    Boolean(options.verticalOnly) &&
    Boolean(S.deps && !S.deps.isMainAppFocused() && !S.forceOverlayVisible)

  // Next finish in queue - grow from the current revealed status band.
  if (options.advanceQueue && stayInBackground) {
    const next = takeNextPendingFinish()
    if (next) {
      presentQueuedFinish(next)
      return
    }
  }

  // Compact status still needed - morph in place (sides stay open, no hide/tuck).
  if (stayInBackground && hasNotchActivity()) {
    S.phase = 'compact'
    S.appearStep = 1
    // Resize the transparent window first while the renderer still paints the
    // finish@status frame, then swap to compact copy - avoids a wide→narrow flash.
    pinOverlayFrame()
    applyFocusMode()
    applyMousePassthrough()
    afterMs(32, () => {
      if (S.phase !== 'compact' || S.expandEvent) return
      S.snapshot = composeSnapshot('compact')
      publishSnapshot()
    })
    return
  }

  // Idle: hide on the shrunk finish frame - never publish empty compact while visible.
  S.phase = 'hidden'
  if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
    try {
      setOverlayClickThrough(true)
      S.overlayWindow.setFocusable(false)
      if (S.overlayWindow.isVisible()) S.overlayWindow.hide()
    } catch {
      // ignore
    }
  }

  S.snapshot = composeSnapshot('compact')
  publishSnapshot()
  pinOverlayFrame()

  // After focus dismiss (tucked): stay hidden. Compact / Inactive returns on blur via sync.
  if (!options.verticalOnly && !S.deps?.isMainAppFocused() && !S.forceOverlayVisible) {
    void bridge.revealCompact()
  }
}

export function startFinishAwayWatch(): void {
  stopFinishAwayWatch()
  if (!S.expandEvent?.showReply || S.phase !== 'finishOpen') return
  const openedAt = Date.now()
  // Short grace so the unpark / present click cannot immediately re-park.
  const GRACE_MS = 220
  let wasActive = app.isActive()

  const inGrace = (): boolean => Date.now() - openedAt < GRACE_MS || Date.now() < S.unparkGuardUntil

  const tryPark = (): void => {
    // Never park while dismissing / appearing / already parked / hidden.
    if (S.phase !== 'finishOpen') return
    if (!S.expandEvent?.showReply) return
    if (inGrace()) return
    parkNotchFinishChat()
  }

  const pointInsideOverlay = (pt: Electron.Point): boolean => {
    if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return false
    const bounds = S.overlayWindow.getBounds()
    return (
      pt.x >= bounds.x &&
      pt.x < bounds.x + bounds.width &&
      pt.y >= bounds.y &&
      pt.y < bounds.y + bounds.height
    )
  }

  const onResign = (): void => {
    tryPark()
  }
  app.on('did-resign-active', onResign)

  const interval = setInterval(() => {
    if (S.phase !== 'finishOpen' || !S.expandEvent?.showReply) {
      stopFinishAwayWatch()
      return
    }
    const active = app.isActive()
    if (wasActive && !active) tryPark()
    wasActive = active
  }, 80)

  const onBlur = (): void => {
    if (S.awayBlurTimer) clearTimeout(S.awayBlurTimer)
    S.awayBlurTimer = setTimeout(() => {
      S.awayBlurTimer = null
      if (S.phase !== 'finishOpen') return
      if (!S.expandEvent?.showReply) return
      if (inGrace()) return
      if (app.isActive() && S.overlayWindow && !S.overlayWindow.isDestroyed() && S.overlayWindow.isFocused()) {
        return
      }
      tryPark()
    }, 60)
  }
  if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
    S.overlayWindow.on('blur', onBlur)
  }

  // Outside click → park, even if the notch never took focus.
  const stopMouseDown = startMacMouseDownMonitor(() => {
    if (S.phase !== 'finishOpen' || !S.expandEvent?.showReply) return
    if (inGrace()) return
    const pt = screen.getCursorScreenPoint()
    if (pointInsideOverlay(pt)) return
    tryPark()
  })

  S.stopAwayWatch = () => {
    app.removeListener('did-resign-active', onResign)
    clearInterval(interval)
    stopMouseDown()
    if (S.awayBlurTimer) {
      clearTimeout(S.awayBlurTimer)
      S.awayBlurTimer = null
    }
    if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
      S.overlayWindow.removeListener('blur', onBlur)
    }
    S.stopAwayWatch = null
  }
}

export function stopFinishAwayWatch(): void {
  if (S.awayBlurTimer) {
    clearTimeout(S.awayBlurTimer)
    S.awayBlurTimer = null
  }
  if (!S.stopAwayWatch) return
  S.stopAwayWatch()
}

registerBridge({
  presentFinishChat,
  presentQueuedFinish,
  startFinishDismiss,
  stopFinishAwayWatch,
  startFinishAwayWatch,
  takeNextPendingFinish,
  presentDoneOverviewForTask,
  clearNotchFinishForTask,
  queueDoneOverviewExpand,
  advanceFinishQueue,
  dismissNotchFinishChat
})
