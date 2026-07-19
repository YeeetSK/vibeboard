import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Task } from '../../shared/types'
import { S } from './state'
import { bridge, registerBridge } from './bridge'
import { getNotchOverlayCapability } from './capability'
import {
  cancelAnimation,
  afterMs,
  publishPhaseSnapshot,
  isFinishPhase,
  isRunningPhase
} from './phase'
import { pinOverlayFrame } from './geometry'
import {
  purgeNotchOverlays,
  yankNotchOutOfActivation,
  ensureNotchOverlay,
  whenOverlayReady,
  showOverlayInactive,
  applyFocusMode,
  applyMousePassthrough,
  setOverlayClickThrough,
  hideEmptyNotchOverlay,
  hasNotchActivity,
  bindProcessTeardown
} from './window'
import {
  SIDE_REVEAL_MS,
  SIDE_REVEAL_DELAY_MS,
  NOTCH_LAUNCH_GRACE_MS,
  type OverlayDeps
} from './types'

export const bindNotchOverlayDeps = (next: OverlayDeps): void => {
  S.deps = next
  bindProcessTeardown()
}

export const noteMainWindowShown = (): void => {
  S.launchGraceUntil = Date.now() + NOTCH_LAUNCH_GRACE_MS
  if (S.launchGraceTimer) clearTimeout(S.launchGraceTimer)
  // If the user already left during grace, sync once grace ends so the island
  // is not stuck dark until the next focus→blur cycle.
  S.launchGraceTimer = setTimeout(() => {
    S.launchGraceTimer = null
    if (!S.deps || S.deps.isMainAppFocused() || app.isActive()) return
    syncNotchOverlay()
  }, NOTCH_LAUNCH_GRACE_MS + 16)
}

export function isInLaunchGrace(): boolean {
  return Date.now() < S.launchGraceUntil
}

/** True when the notch must not create or show over the board / during launch. */
export function shouldKeepNotchDark(): boolean {
  if (S.forceOverlayVisible) return false
  if (!S.deps) return true
  if (!S.deps.hasMainWindowBeenShown()) return true
  if (S.deps.isMainAppFocused()) return true
  // Activate can beat window focus by a frame. Keep compact/idle dark while
  // VibeBoard is frontmost so Inactive does not re-appear then tuck-hide.
  // Finish / running panels may still show while interacting with the island.
  if (app.isActive() && !isFinishPhase() && !isRunningPhase()) return true
  // Grace only while VibeBoard is still the active app (launch focus thrash).
  // Once the user clicks into another app, show the notch immediately.
  if (isInLaunchGrace() && app.isActive()) return true
  return false
}

export const onMainAppFocused = (): void => {
  yankNotchOutOfActivation()
  dismissForMainFocus()
}

/**
 * Dock icon / Cmd+Tab: hide the panel synchronously BEFORE focusing the board.
 * Soft dismiss alone is too slow - macOS activates the panel as the app.
 */
export const demoteNotchOverlayForAppActivate = (): void => {
  S.forceOverlayVisible = false
  yankNotchOutOfActivation()
  // Proper state teardown (stash finish queue, etc.) after the window is hidden.
  dismissForMainFocus()
  // If dismiss left a mid-animation visible frame, force-hide again.
  yankNotchOutOfActivation()
}

export const syncNotchOverlay = (): void => {
  if (!S.deps) return
  const settings = S.deps.getSettings()
  const capability = getNotchOverlayCapability()
  if (!settings.enabled || !capability.supported) {
    purgeNotchOverlays()
    return
  }

  // Never create/show the notch before the main window has appeared once.
  if (!S.deps.hasMainWindowBeenShown() && !S.forceOverlayVisible) {
    return
  }

  // Drop finish panels / queue items whose tabs were closed or already viewed in-app.
  pruneClosedTabFinishState()
  pruneAddressedFinishState()

  // Finish chat disabled - collapse any live finish panel.
  if (!settings.showFinishChat && S.expandEvent?.showReply && isFinishPhase()) {
    bridge.startFinishDismiss({
      stashToQueue: false,
      advanceQueue: false,
      clearReopen: true,
      verticalOnly: true
    })
    return
  }

  // Board focused or launch grace: dismiss only - never create the panel window
  // (creating a macOS panel mid-launch steals activation from the main window).
  if (shouldKeepNotchDark()) {
    dismissForMainFocus()
    return
  }

  ensureNotchOverlay()

  // Don't interrupt an in-flight dismiss (focus thrash / deferred sync).
  if (S.phase === 'finishDismissing') return

  // Finish already live - refresh counts only.
  if (S.phase === 'finishOpen' || S.phase === 'finishParked' || S.phase === 'finishAppearing') {
    publishPhaseSnapshot()
    applyFocusMode()
    applyMousePassthrough()
    return
  }

  // Status overview: refresh live agents / system tail, or close if none left.
  if (isRunningPhase()) {
    if (S.phase === 'runningDismissing') return
    // Stay open while the user is inside a pinned task detail (even after it finishes).
    const listEmpty = bridge.resolvedOverviewCount() <= 0
    if (listEmpty && !(S.runningDetailOpen && S.selectedRunningTaskId)) {
      bridge.closeRunningOverview({ revealCompactAfter: true })
      return
    }
    publishPhaseSnapshot()
    applyFocusMode()
    applyMousePassthrough()
    return
  }

  // Armed running test with 0 real tasks: reveal compact so expand can fire.
  if (S.devRunningTestPending || S.devRunningSim) {
    void revealCompact()
    bridge.maybeScheduleDevRunningExpand()
    return
  }

  if (!S.expandEvent?.showReply && S.finishQueue.length > 0) {
    if (!settings.expandOnTaskCompleted) {
      S.finishQueue = []
    } else {
      const next = bridge.takeNextPendingFinish()
      if (next) {
        bridge.presentQueuedFinish(next)
        return
      }
    }
  }

  // Idle: keep a compact "Inactive" pill instead of going fully dark.
  void revealCompact()
  bridge.maybeScheduleDevFinishExpand()
}

/** Remove finish UI tied to closed tabs so the notch only reflects open boards. */
export function pruneClosedTabFinishState(): void {
  if (!S.deps) return

  const keepOpen = (taskId: string | null | undefined): boolean => {
    if (!taskId) return true
    if (isSimulatedNotchTaskId(taskId)) return true
    return S.deps!.isTaskOnOpenTab(taskId)
  }

  S.finishQueue = S.finishQueue.filter((item) => keepOpen(item.taskId))

  if (S.lastFinishChat && !keepOpen(S.lastFinishChat.taskId)) {
    S.lastFinishChat = null
  }

  if (S.expandEvent?.showReply && !keepOpen(S.expandEvent.taskId)) {
    if (isFinishPhase() && S.phase !== 'finishDismissing') {
      bridge.startFinishDismiss({
        stashToQueue: false,
        advanceQueue: true,
        saveDismissed: { ...S.expandEvent, focusInput: false },
        clearReopen: true,
        verticalOnly: true
      })
      return
    }
    S.expandEvent = null
  }
}

/** Drop finish nudges the user already handled in the main app (viewed / marked read). */
export function pruneAddressedFinishState(): void {
  if (!S.deps) return

  const stillPending = (taskId: string | null | undefined): boolean => {
    if (!taskId) return false
    if (isSimulatedNotchTaskId(taskId)) return true
    return S.deps!.isTaskFinishPending(taskId)
  }

  S.finishQueue = S.finishQueue.filter((item) => stillPending(item.taskId))

  if (S.lastFinishChat && !stillPending(S.lastFinishChat.taskId)) {
    S.lastFinishChat = null
  }

  if (S.expandEvent?.showReply && !stillPending(S.expandEvent.taskId)) {
    if (isFinishPhase() && S.phase !== 'finishDismissing') {
      bridge.startFinishDismiss({
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


export const handleNotchOverlayStatusChange = (input: {
  task: Task
  oldStatus: string
  newStatus: string
  runningCount: number
  runningCountBeforeChange: number
}): void => {
  if (!S.deps) return
  const settings = S.deps.getSettings()
  const capability = getNotchOverlayCapability()
  if (!settings.enabled || !capability.supported) {
    purgeNotchOverlays()
    return
  }

  const isDone = input.newStatus === 'done_unread' || input.newStatus === 'done_read'
  const becameAttention = input.newStatus === 'attention'
  const allFinished =
    settings.expandOnAllFinished &&
    input.runningCountBeforeChange > 0 &&
    input.runningCount === 0

  // Viewed / resumed in-app - never re-nudge this finish on the notch.
  if (input.oldStatus === 'done_unread' && input.newStatus !== 'done_unread') {
    bridge.clearNotchFinishForTask(input.task.id)
  }

  if (shouldKeepNotchDark()) {
    // Remember unread finishes for when the user leaves; never create/show over the board.
    if (input.newStatus === 'done_unread' && settings.expandOnTaskCompleted) {
      bridge.queueDoneOverviewExpand({
        taskId: input.task.id,
        title: input.task.title,
        projectName: S.deps.getBoardLabelForTask(input.task)
      })
    }
    dismissForMainFocus()
    return
  }

  ensureNotchOverlay()

  // Pinned detail for this task: always refresh so the answer replaces the live stream.
  const pinnedThisTask =
    isRunningPhase() && S.runningDetailOpen && S.selectedRunningTaskId === input.task.id

  if (input.newStatus === 'done_unread' && settings.expandOnTaskCompleted) {
    // Same Done overview UI as clicking compact Done (detail when "show answer" is on).
    bridge.presentDoneOverviewForTask(input.task.id, {
      openDetail: settings.showFinishChat
    })
  } else if (pinnedThisTask && (isDone || becameAttention)) {
    publishPhaseSnapshot()
    applyFocusMode()
    applyMousePassthrough()
  } else if (isFinishPhase() && S.expandEvent?.showReply) {
    publishPhaseSnapshot()
    applyFocusMode()
    applyMousePassthrough()
  } else {
    void revealCompact()
  }

  // Setting: open the task in the board when attention arrives (notch stays compact).
  if (becameAttention && settings.expandOnAttention) {
    S.deps.onOpenTask(input.task.id)
  }
}

/** Main focused: shrink→tuck finish, or tuck compact - never park mid-flight. */
export function dismissForMainFocus(): void {
  S.forceOverlayVisible = false
  if (S.phase === 'hidden' || S.phase === 'finishDismissing') return

  if (isFinishPhase()) {
    bridge.startFinishDismiss({ stashToQueue: true })
    return
  }

  if (isRunningPhase()) {
    bridge.closeRunningOverview({ revealCompactAfter: false, tuckAway: true })
    return
  }

  if (S.phase === 'compact') {
    // Instant hide when returning to the board. Side-tuck looks like a weird
    // collapse flash on Inactive (and any compact pill).
    hideEmptyNotchOverlay()
  }
}

export async function revealCompact(): Promise<void> {
  if (shouldKeepNotchDark()) return
  if (S.phase === 'finishDismissing' || isFinishPhase() || isRunningPhase()) return
  if (!S.deps?.getSettings().enabled) return

  // Already revealing / visible compact - refresh only. Re-entering cancelAnimation
  // here was killing the side-reveal timers so the pill popped in with no morph.
  if (S.phase === 'compact') {
    if (S.appearStep === 0 && S.animTimers.length > 0) return
    publishPhaseSnapshot()
    pinOverlayFrame()
    applyFocusMode()
    applyMousePassthrough()
    bridge.maybeScheduleDevFinishExpand()
    bridge.maybeScheduleDevRunningExpand()
    return
  }

  cancelAnimation()
  S.expandEvent = null
  S.selectedRunningTaskId = null
  S.runningDetailOpen = false
  S.overviewKind = 'running'
  ensureNotchOverlay()
  await whenOverlayReady()
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  if (shouldKeepNotchDark()) return

  const wasHidden = !S.overlayWindow.isVisible()
  S.phase = 'compact'
  S.appearStep = wasHidden ? 0 : 1
  if (wasHidden) showOverlayInactive()
  publishPhaseSnapshot()
  pinOverlayFrame()
  applyFocusMode()
  applyMousePassthrough()

  if (wasHidden) {
    afterMs(SIDE_REVEAL_DELAY_MS, () => {
      if (S.phase !== 'compact') return
      if (shouldKeepNotchDark()) {
        startCompactHide()
        return
      }
      S.appearStep = 1
      publishPhaseSnapshot()
      pinOverlayFrame()
      applyMousePassthrough()
      bridge.maybeScheduleDevFinishExpand()
      bridge.maybeScheduleDevRunningExpand()
    })
    return
  }

  bridge.maybeScheduleDevFinishExpand()
  bridge.maybeScheduleDevRunningExpand()
}

export function startCompactHide(): void {
  if (S.phase === 'hidden') return
  // Already tucking - ignore re-entrant focus/show.
  if (S.phase === 'compact' && S.appearStep === 0 && S.animTimers.length > 0) return
  if (S.phase !== 'compact') {
    hideEmptyNotchOverlay()
    return
  }
  // Board / app coming forward: never morph compact away.
  if (S.deps?.isMainAppFocused() || app.isActive()) {
    hideEmptyNotchOverlay()
    return
  }
  cancelAnimation()
  bridge.stopFinishAwayWatch()
  bridge.endEscapeHold()
  S.forceOverlayVisible = false

  if (!S.overlayWindow || S.overlayWindow.isDestroyed() || !S.overlayWindow.isVisible()) {
    hideEmptyNotchOverlay()
    return
  }

  try {
    setOverlayClickThrough(true)
    S.overlayWindow.setFocusable(false)
  } catch {
    // ignore
  }

  // Tuck sides then hide (background-only path, e.g. idle cleanup).
  S.appearStep = 0
  publishPhaseSnapshot()

  afterMs(SIDE_REVEAL_MS, () => {
    if (S.deps && !S.deps.isMainAppFocused() && !app.isActive() && S.deps.getSettings().enabled && hasNotchActivity()) {
      // Focus left during tuck - show again.
      void revealCompact()
      return
    }
    hideEmptyNotchOverlay()
  })
}

export const peekNotchOverlay = (): void => {
  // Intentionally no-op; peek expands were just noise.
}

export const openTaskFromNotch = (taskId: string): void => {
  const closed = S.expandEvent
  const simulated = Boolean(closed?.simulated || isSimulatedNotchTaskId(taskId))
  // Shrink→tuck first; opening the board may focus main mid-flight (dismiss no-ops).
  if (closed?.showReply) {
    bridge.advanceFinishQueue({ clearReopen: true, saveDismissed: closed })
  }
  if (!simulated) {
    S.deps?.onOpenTask(taskId)
  }
}

export const sendReplyFromNotch = async (taskId: string, content: string): Promise<void> => {
  const trimmed = content.trim()
  if (!trimmed || !S.deps) return
  // Running / Done overview: queue/send without dismissing the panel.
  if (isRunningPhase()) {
    if (S.devRunningSim && isSimulatedNotchTaskId(taskId)) {
      const queued = S.devRunningSim.queuedByTask.get(taskId) ?? []
      queued.push({ id: randomUUID(), content: trimmed })
      S.devRunningSim.queuedByTask.set(taskId, queued)
      const lines = S.devRunningSim.systemByTask.get(taskId) ?? []
      lines.push(`Queued follow-up: ${trimmed}`)
      S.devRunningSim.systemByTask.set(taskId, lines)
      publishPhaseSnapshot()
      return
    }
    const fromDoneDetail = S.overviewKind === 'done' && S.runningDetailOpen
    await S.deps.onSendReply(taskId, trimmed)
    // Follow-up from Done: flip into live Running detail so progress is visible.
    if (fromDoneDetail) {
      S.overviewKind = 'running'
      S.selectedRunningTaskId = taskId
      S.runningDetailOpen = true
    }
    publishPhaseSnapshot()
    applyFocusMode()
    applyMousePassthrough()
    return
  }
  // Dev finish-chat test (and any other simulated panel) has no DB task.
  if (S.expandEvent?.simulated || isSimulatedNotchTaskId(taskId)) {
    bridge.advanceFinishQueue({ clearReopen: true, saveDismissed: S.expandEvent })
    return
  }
  try {
    await S.deps.onSendReply(taskId, trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    // Task was deleted while the finish panel was open: just close it.
    if (/no longer exists/i.test(message)) {
      bridge.advanceFinishQueue({ clearReopen: true, saveDismissed: S.expandEvent })
      return
    }
    throw error
  }
  bridge.advanceFinishQueue({ clearReopen: true, saveDismissed: S.expandEvent })
}

export function isSimulatedNotchTaskId(taskId: string): boolean {
  return taskId.startsWith('dev-notch-test-') || taskId.startsWith('dev-running-')
}

export function syncNotchIfEnabled(): void {
  if (!S.deps?.getSettings().enabled) return
  syncNotchOverlay()
}


registerBridge({
  shouldKeepNotchDark,
  dismissForMainFocus,
  revealCompact,
  startCompactHide,
  syncNotchOverlay,
  isSimulatedNotchTaskId
})
