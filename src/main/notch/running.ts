import { app, screen } from 'electron'
import { startMacMouseDownMonitor } from '../mouseDownMonitor'
import { S } from './state'
import { bridge, registerBridge } from './bridge'
import type { NotchRunningAgent } from '../../shared/types'
import type { NotchQueuedMessage } from './types'
import { HEIGHT_ANIM_MS, SIDE_REVEAL_MS, SIDE_REVEAL_DELAY_MS } from './types'
import {
  cancelAnimation,
  afterMs,
  publishPhaseSnapshot,
  isFinishPhase,
  isRunningPhase
} from './phase'
import { composeSnapshot, publishSnapshot } from './snapshot'
import { pinOverlayFrame } from './geometry'
import {
  ensureNotchOverlay,
  whenOverlayReady,
  showOverlayInactive,
  hideEmptyNotchOverlay,
  applyFocusMode,
  applyMousePassthrough,
  setOverlayClickThrough
} from './window'

export const openNotchRunningOverview = (): boolean => {
  // If a previous expand stalled mid-appear, recover into a full open.
  if (S.phase === 'runningAppearing' && S.overviewKind === 'running') {
    cancelAnimation()
    S.phase = 'runningOpen'
    S.appearStep = 2
    pinOverlayFrame()
    publishPhaseSnapshot()
    applyMousePassthrough()
    startRunningAwayWatch()
    applyFocusMode()
    return true
  }
  if (S.phase === 'runningParked' && S.overviewKind === 'running') {
    return unparkNotchRunningDetail() || openStatusOverview('running')
  }
  return openStatusOverview('running')
}

/** Expand compact Done into a list of unread finished tasks. */
export const openNotchDoneOverview = (): boolean => {
  if (S.phase === 'runningParked' && S.overviewKind === 'done') {
    return unparkNotchRunningDetail() || openStatusOverview('done')
  }
  return openStatusOverview('done')
}

export function openStatusOverview(kind: 'running' | 'done'): boolean {
  if (!S.deps?.getSettings().enabled) return false
  if (S.deps.isMainAppFocused()) {
    bridge.dismissForMainFocus()
    return false
  }
  if (isFinishPhase()) return false
  if (kind === 'running' && resolvedRunningCount() <= 0) return false
  if (kind === 'done' && (S.deps.getDoneUnreadCount() ?? 0) <= 0) return false

  if (S.phase === 'runningOpen' && S.overviewKind === kind) {
    pinOverlayFrame()
    publishPhaseSnapshot()
    applyMousePassthrough()
    return true
  }

  // Stalled mid-appear / mid-dismiss: jump to a full open instead of ignoring the click.
  if (S.phase === 'runningAppearing' || S.phase === 'runningDismissing') {
    cancelAnimation()
    S.overviewKind = kind
    S.phase = 'runningOpen'
    S.appearStep = 2
    S.dismissStep = 0
    if (kind === 'done' && !S.runningDetailOpen) {
      S.selectedRunningTaskId = null
    }
    pinOverlayFrame()
    publishPhaseSnapshot()
    applyMousePassthrough()
    startRunningAwayWatch()
    applyFocusMode()
    return true
  }

  // Switching kind while already open: rebuild in place.
  if (S.phase === 'runningOpen' && S.overviewKind !== kind) {
    S.overviewKind = kind
    S.selectedRunningTaskId = null
    S.runningDetailOpen = false
    pinOverlayFrame()
    publishPhaseSnapshot()
    applyMousePassthrough()
    return true
  }

  presentRunningOverview(kind)
  return true
}

export const closeNotchRunningOverview = (): boolean =>
  closeRunningOverview({ revealCompactAfter: true })

export const selectNotchRunningTask = (taskId: string): boolean => {
  if (S.phase !== 'runningOpen' && S.phase !== 'runningAppearing') return false
  const agents = resolvedOverviewAgents()
  const known =
    agents.some((agent) => agent.taskId === taskId) || Boolean(S.deps?.getTaskNotchMeta(taskId))
  if (!known) return false
  S.selectedRunningTaskId = taskId
  S.runningDetailOpen = true
  publishPhaseSnapshot()
  applyFocusMode()
  return true
}

/** Leave a pinned task detail and return to the agents list. */
export const closeNotchRunningDetail = (): boolean => {
  if (!isRunningPhase()) return false
  S.runningDetailOpen = false
  S.selectedRunningTaskId = null
  // List emptied while pinned — leave overview (and maybe show finish chat).
  if (resolvedOverviewCount() <= 0) {
    return closeRunningOverview({ revealCompactAfter: true })
  }
  publishPhaseSnapshot()
  applyFocusMode()
  applyMousePassthrough()
  return true
}

export const updateNotchQueuedMessage = (
  taskId: string,
  messageId: string,
  content: string
): boolean => {
  const trimmed = content.trim()
  if (!trimmed) return false
  if (S.devRunningSim && bridge.isSimulatedNotchTaskId(taskId)) {
    const queue = S.devRunningSim.queuedByTask.get(taskId) ?? []
    const item = queue.find((entry) => entry.id === messageId)
    if (!item) return false
    item.content = trimmed
    publishPhaseSnapshot()
    return true
  }
  const ok = S.deps?.onUpdateQueuedMessage(taskId, messageId, trimmed) ?? false
  if (ok && isRunningPhase()) publishPhaseSnapshot()
  return ok
}

export const removeNotchQueuedMessage = (taskId: string, messageId: string): boolean => {
  if (S.devRunningSim && bridge.isSimulatedNotchTaskId(taskId)) {
    const queue = S.devRunningSim.queuedByTask.get(taskId) ?? []
    const next = queue.filter((entry) => entry.id !== messageId)
    if (next.length === queue.length) return false
    if (next.length === 0) S.devRunningSim.queuedByTask.delete(taskId)
    else S.devRunningSim.queuedByTask.set(taskId, next)
    publishPhaseSnapshot()
    return true
  }
  const ok = S.deps?.onRemoveQueuedMessage(taskId, messageId) ?? false
  if (ok && isRunningPhase()) publishPhaseSnapshot()
  return ok
}

export function presentRunningOverview(
  kind: 'running' | 'done' = 'running',
  options?: { forceShow?: boolean; selectTaskId?: string | null; openDetail?: boolean }
): void {
  if (!S.deps?.getSettings().enabled) return
  if (kind === 'running' && resolvedRunningCount() <= 0 && !S.devRunningSim) return
  if (kind === 'done' && (S.deps.getDoneUnreadCount() ?? 0) <= 0) return

  const windowVisible = Boolean(
    S.overlayWindow && !S.overlayWindow.isDestroyed() && S.overlayWindow.isVisible()
  )
  const expandFromExisting =
    windowVisible && S.appearStep >= 1 && (S.phase === 'compact' || S.phase === 'runningDismissing')

  cancelAnimation()
  bridge.endEscapeHold()
  bridge.stopFinishAwayWatch()
  S.expandEvent = null
  S.overviewKind = kind
  S.forceOverlayVisible = Boolean(options?.forceShow) || S.forceOverlayVisible

  const agents = resolvedOverviewAgents()
  if (kind === 'done') {
    if (options?.selectTaskId && options.openDetail) {
      S.selectedRunningTaskId = options.selectTaskId
      S.runningDetailOpen = true
    } else {
      // Done opens on the list; pick a task only when the user clicks one.
      S.selectedRunningTaskId = null
      S.runningDetailOpen = false
    }
  } else if (
    !S.selectedRunningTaskId ||
    !agents.some((agent) => agent.taskId === S.selectedRunningTaskId)
  ) {
    S.selectedRunningTaskId = agents[0]?.taskId ?? null
  }

  if (bridge.shouldKeepNotchDark() && !S.forceOverlayVisible) {
    return
  }

  S.phase = 'runningAppearing'
  S.appearStep = expandFromExisting ? 1 : 0
  S.dismissStep = 0
  ensureNotchOverlay()
  void whenOverlayReady().then(() => {
    if (S.phase !== 'runningAppearing') return
    if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
    if (bridge.shouldKeepNotchDark() && !S.forceOverlayVisible) {
      bridge.dismissForMainFocus()
      return
    }
    showOverlayInactive()

    /** After status band is full-width: grow height only. */
    const growHeightToOpen = (): void => {
      if (S.phase !== 'runningAppearing') return
      if (bridge.shouldKeepNotchDark() && !S.forceOverlayVisible) {
        bridge.dismissForMainFocus()
        return
      }
      S.phase = 'runningOpen'
      S.appearStep = 2
      pinOverlayFrame()
      publishPhaseSnapshot()
      applyMousePassthrough()
      startRunningAwayWatch()
      afterMs(HEIGHT_ANIM_MS, () => {
        if (S.phase !== 'runningOpen') return
        applyFocusMode()
      })
    }

    /** Widen at status height first, then grow vertically. */
    const widenThenGrow = (): void => {
      if (S.phase !== 'runningAppearing') return
      if (bridge.shouldKeepNotchDark() && !S.forceOverlayVisible) {
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
        if (S.phase !== 'runningAppearing') return
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
      if (S.phase !== 'runningAppearing') return
      if (bridge.shouldKeepNotchDark() && !S.forceOverlayVisible) {
        bridge.dismissForMainFocus()
        return
      }
      S.appearStep = 1
      publishPhaseSnapshot()
      afterMs(SIDE_REVEAL_MS, widenThenGrow)
    })
  })
}

export function closeRunningOverview(options?: {
  revealCompactAfter?: boolean
  tuckAway?: boolean
}): boolean {
  if (S.phase === 'runningDismissing') return true
  if (!isRunningPhase()) return false

  cancelAnimation()
  bridge.stopFinishAwayWatch()
  bridge.endEscapeHold()

  const hadDevSim = Boolean(S.devRunningSim)
  const revealCompactAfter = options?.revealCompactAfter !== false
  const tuckAway = Boolean(options?.tuckAway)

  const clearOverviewSelection = (): void => {
    S.selectedRunningTaskId = null
    S.runningDetailOpen = false
    S.overviewKind = 'running'
    S.runningDismissNarrow = false
    if (hadDevSim) bridge.clearDevRunningTest()
  }

  /**
   * After height+width morph to the compact pill size: shrink the Electron
   * window while still painting overview@status, then swap to compact copy.
   * (Same order as finish-chat vertical dismiss - avoids a post-collapse flash.)
   */
  const settleToCompact = (): void => {
    clearOverviewSelection()

    const settings = S.deps?.getSettings()
    if (
      revealCompactAfter &&
      S.finishQueue.length > 0 &&
      settings?.expandOnTaskCompleted &&
      S.deps &&
      !S.deps.isMainAppFocused()
    ) {
      const next = bridge.takeNextPendingFinish()
      if (next) {
        S.phase = 'compact'
        S.appearStep = 1
        S.dismissStep = 0
        bridge.presentQueuedFinish(next)
        return
      }
    }

    // Settle to compact (Running / Done / Inactive) - never leave a blank frame.
    S.phase = 'compact'
    S.appearStep = 1
    S.dismissStep = 0
    pinOverlayFrame()
    applyFocusMode()
    applyMousePassthrough()
    afterMs(48, () => {
      if (S.phase !== 'compact') return
      S.snapshot = composeSnapshot('compact')
      publishSnapshot()
      applyMousePassthrough()
    })
  }

  const settleTuckAway = (): void => {
    clearOverviewSelection()
    S.phase = 'compact'
    S.appearStep = 0
    S.dismissStep = 0
    publishPhaseSnapshot()
    pinOverlayFrame()
    applyFocusMode()
    applyMousePassthrough()
    bridge.startCompactHide()
  }

  if (!S.overlayWindow || S.overlayWindow.isDestroyed() || !S.overlayWindow.isVisible()) {
    clearOverviewSelection()
    S.phase = 'compact'
    S.appearStep = tuckAway ? 0 : 1
    S.dismissStep = 0
    publishPhaseSnapshot()
    if (tuckAway) {
      hideEmptyNotchOverlay()
      return true
    }
    if (!bridge.shouldKeepNotchDark()) void bridge.revealCompact()
    return true
  }

  S.phase = 'runningDismissing'
  S.dismissStep = 0
  S.appearStep = 0
  // Click-away / Esc: after height shrink, narrow horizontally to the compact pill.
  // App-focus tuck: after height shrink, tuck sides (clip-path) instead of CSS-narrow.
  S.runningDismissNarrow = !tuckAway
  try {
    setOverlayClickThrough(true)
    S.overlayWindow.setFocusable(false)
  } catch {
    // ignore
  }
  // Step 0: height only (keep full width).
  pinOverlayFrame()
  publishPhaseSnapshot()

  afterMs(HEIGHT_ANIM_MS, () => {
    if (S.phase !== 'runningDismissing') return
    // Step 1: horizontal (narrow to compact, or tuck into camera).
    S.dismissStep = 1
    publishPhaseSnapshot()
    afterMs(SIDE_REVEAL_MS, () => {
      if (S.phase !== 'runningDismissing') return
      if (tuckAway) {
        settleTuckAway()
        return
      }
      settleToCompact()
    })
  })
  return true
}

/**
 * Click-away / resign-active while the running overview is open.
 * Task detail → park (mid strip, like finish-chat). List → collapse to compact.
 */
export function startRunningAwayWatch(): void {
  bridge.stopFinishAwayWatch()
  if (S.phase !== 'runningOpen') return
  const openedAt = Date.now()
  const GRACE_MS = 220
  let wasActive = app.isActive()

  const inGrace = (): boolean => Date.now() - openedAt < GRACE_MS || Date.now() < S.unparkGuardUntil

  const tryAway = (): void => {
    if (S.phase !== 'runningOpen') return
    if (inGrace()) return
    if (S.runningDetailOpen) {
      parkNotchRunningDetail()
      return
    }
    closeRunningOverview({ revealCompactAfter: true })
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
    tryAway()
  }
  app.on('did-resign-active', onResign)

  const interval = setInterval(() => {
    if (S.phase !== 'runningOpen') {
      bridge.stopFinishAwayWatch()
      return
    }
    const active = app.isActive()
    if (wasActive && !active) tryAway()
    wasActive = active
  }, 80)

  const onBlur = (): void => {
    if (S.awayBlurTimer) clearTimeout(S.awayBlurTimer)
    S.awayBlurTimer = setTimeout(() => {
      S.awayBlurTimer = null
      if (S.phase !== 'runningOpen') return
      if (inGrace()) return
      if (app.isActive() && S.overlayWindow && !S.overlayWindow.isDestroyed() && S.overlayWindow.isFocused()) {
        return
      }
      tryAway()
    }, 60)
  }
  if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
    S.overlayWindow.on('blur', onBlur)
  }

  const stopMouseDown = startMacMouseDownMonitor(() => {
    if (S.phase !== 'runningOpen') return
    if (inGrace()) return
    const pt = screen.getCursorScreenPoint()
    if (pointInsideOverlay(pt)) return
    tryAway()
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

/** Park a Running/Done task detail to the mid strip (same as finish-chat click-away). */
export function parkNotchRunningDetail(): boolean {
  if (S.phase !== 'runningOpen' || !S.runningDetailOpen) return false
  if (Date.now() < S.unparkGuardUntil) return false
  bridge.stopFinishAwayWatch()
  bridge.endEscapeHold()
  S.phase = 'runningParked'
  S.forceOverlayVisible = false
  publishPhaseSnapshot()
  applyFocusMode()
  applyMousePassthrough()
  return true
}

/** Expand a parked Running/Done task detail after the user clicks it again. */
export function unparkNotchRunningDetail(): boolean {
  if (S.phase !== 'runningParked') return false
  cancelAnimation()
  bridge.endEscapeHold()
  S.unparkGuardUntil = Date.now() + 450
  S.phase = 'runningOpen'
  pinOverlayFrame()
  publishPhaseSnapshot()
  if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
    S.overlayWindow.setFocusable(true)
    setOverlayClickThrough(false)
  }
  startRunningAwayWatch()
  afterMs(HEIGHT_ANIM_MS, () => {
    if (S.phase !== 'runningOpen') return
    applyFocusMode()
  })
  return true
}

export function resolvedRunningCount(): number {
  const real = S.deps?.getRunningCount() ?? 0
  if (S.devRunningSim) return Math.max(real, S.devRunningSim.agents.length)
  return real
}

export function resolvedRunningAgents(): NotchRunningAgent[] {
  if (!S.devRunningSim) return S.deps?.getRunningAgents() ?? []
  return S.devRunningSim.agents.map((agent) => ({
    ...agent,
    queuedCount: (S.devRunningSim?.queuedByTask.get(agent.taskId) ?? []).length
  }))
}

export function resolvedDoneAgents(): NotchRunningAgent[] {
  return S.deps?.getDoneAgents() ?? []
}

export function resolvedOverviewAgents(): NotchRunningAgent[] {
  return S.overviewKind === 'done' ? resolvedDoneAgents() : resolvedRunningAgents()
}

export function resolvedOverviewCount(): number {
  if (S.overviewKind === 'done') return S.deps?.getDoneUnreadCount() ?? 0
  return resolvedRunningCount()
}

export function resolvedSystemTail(taskId: string): string[] {
  if (S.devRunningSim?.systemByTask.has(taskId)) {
    return S.devRunningSim.systemByTask.get(taskId) ?? []
  }
  return S.deps?.getSystemTail(taskId) ?? []
}

export function resolvedQueuedMessages(taskId: string): NotchQueuedMessage[] {
  if (S.devRunningSim && bridge.isSimulatedNotchTaskId(taskId)) {
    return [...(S.devRunningSim.queuedByTask.get(taskId) ?? [])]
  }
  return S.deps?.getQueuedMessages(taskId) ?? []
}

registerBridge({
  presentRunningOverview,
  closeRunningOverview,
  startRunningAwayWatch,
  unparkNotchRunningDetail,
  parkNotchRunningDetail,
  openStatusOverview,
  resolvedRunningCount,
  resolvedOverviewAgents,
  resolvedOverviewCount,
  resolvedSystemTail,
  resolvedQueuedMessages
})
