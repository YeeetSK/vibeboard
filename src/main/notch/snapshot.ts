import type { NotchOverlaySnapshot } from '../../shared/types'
import { startMacEscapeKeyMonitor } from '../escKeyMonitor'
import { S } from './state'
import { bridge, registerBridge } from './bridge'
import {
  deriveSurfaceVisible,
  deriveCompactSize,
  deriveNarrowSize,
  deriveParked,
  isRunningPhase,
  cancelAnimation
} from './phase'
import { ESCAPE_HOLD_MS, ESCAPE_HOLD_DEFAULT_SEC, MAX_ANSWER_CHARS } from './types'

export const getNotchOverlaySnapshot = (): NotchOverlaySnapshot => S.snapshot

export function composeSnapshot(mode: 'compact' | 'expanded'): NotchOverlaySnapshot {
  const base = buildCountsSnapshot(mode)
  if (isRunningPhase()) {
    return withSurface(buildRunningOverviewSnapshot(base))
  }
  if (mode === 'expanded' && S.expandEvent) {
    return withSurface({
      ...base,
      mode: 'expanded',
      headline: S.expandEvent.headline,
      detail: S.expandEvent.detail,
      taskId: S.expandEvent.taskId || null,
      taskTitle: S.expandEvent.taskTitle || null,
      projectName: S.expandEvent.projectName || null,
      answer: S.expandEvent.answer,
      showReply: S.expandEvent.showReply,
      showRunningOverview: false,
      overviewKind: null,
      runningAgents: [],
      selectedRunningTaskId: null,
      runningDetailOpen: false,
      selectedRunningStatus: null,
      systemLines: [],
      queuedMessages: [],
      focusInput: S.expandEvent.focusInput,
      parked: deriveParked(),
      compactSize: deriveCompactSize(),
      narrowSize: deriveNarrowSize(),
      finishQueueRemaining: S.finishQueue.length
    })
  }
  return withSurface(base)
}

export function buildRunningOverviewSnapshot(base: NotchOverlaySnapshot): NotchOverlaySnapshot {
  const kind = S.overviewKind
  const agents = bridge.resolvedOverviewAgents()
  let selected = S.selectedRunningTaskId
  let selectedAgent = agents.find((agent) => agent.taskId === selected) ?? null
  let selectedStatus: NotchOverlaySnapshot['selectedRunningStatus'] = selectedAgent
    ? kind === 'done'
      ? 'done'
      : 'processing'
    : null
  let answer: string | null = null

  if (S.runningDetailOpen && selected) {
    if (!selectedAgent) {
      const meta = S.deps?.getTaskNotchMeta(selected) ?? null
      if (!meta || !S.deps?.isTaskOnOpenTab(selected)) {
        // Task vanished / tab closed — drop back to the list.
        S.runningDetailOpen = false
        S.selectedRunningTaskId = null
        selected = null
        selectedStatus = null
      } else {
        selectedAgent = {
          taskId: selected,
          title: meta.title,
          projectName: meta.projectName,
          runStartedAt: meta.runStartedAt,
          queuedCount: bridge.resolvedQueuedMessages(selected).length
        }
        selectedStatus =
          meta.status === 'processing'
            ? 'processing'
            : meta.status === 'attention'
              ? 'attention'
              : 'done'
        if (selectedStatus !== 'processing') {
          answer = truncateAnswer(S.deps.getLatestAssistantReply(selected))
        }
      }
    } else if (kind === 'done' || selectedStatus === 'done') {
      selectedStatus = kind === 'done' ? 'done' : selectedStatus
      answer = truncateAnswer(S.deps?.getLatestAssistantReply(selected) ?? null)
    }
  } else {
    S.runningDetailOpen = false
    if (selected && !agents.some((agent) => agent.taskId === selected)) {
      selected = null
      S.selectedRunningTaskId = null
      selectedAgent = null
      selectedStatus = null
    }
  }

  const listHeadline = kind === 'done' ? 'Done' : 'Running'
  const listDetail =
    kind === 'done'
      ? agents.length === 1
        ? '1 finished, waiting to be viewed'
        : `${agents.length} finished, waiting to be viewed`
      : agents.length === 1
        ? '1 session active'
        : `${agents.length} sessions active`

  return {
    ...base,
    mode: 'expanded',
    headline:
      S.runningDetailOpen && selectedStatus === 'done'
        ? 'Finished'
        : S.runningDetailOpen && selectedStatus === 'attention'
          ? 'Needs you'
          : listHeadline,
    trailing: agents.length > 0 ? String(agents.length) : null,
    detail: listDetail,
    showReply: false,
    showRunningOverview: true,
    overviewKind: kind,
    runningAgents: agents,
    selectedRunningTaskId: selected,
    runningDetailOpen: S.runningDetailOpen,
    selectedRunningStatus: selectedStatus,
    // Live system stream only while this task is still processing. Once it
    // finishes (even if we stayed on the Running overview), show the answer.
    systemLines:
      selected && selectedStatus === 'processing' ? bridge.resolvedSystemTail(selected) : [],
    queuedMessages: selected ? bridge.resolvedQueuedMessages(selected) : [],
    taskId: selected,
    taskTitle: selectedAgent?.title ?? null,
    projectName: selectedAgent?.projectName ?? null,
    answer: selectedStatus === 'processing' ? null : answer,
    focusInput: false,
    parked: false,
    compactSize: deriveCompactSize(),
    narrowSize: deriveNarrowSize(),
    finishQueueRemaining: S.finishQueue.length
  }
}

export function buildCountsSnapshot(mode: 'compact' | 'expanded'): NotchOverlaySnapshot {
  const runningCount = bridge.resolvedRunningCount()
  const attentionCount = S.deps?.getAttentionCount() ?? 0
  const doneUnreadCount = S.deps?.getDoneUnreadCount() ?? 0
  const doneReadCount = S.deps?.getDoneReadCount() ?? 0
  const doneCount = doneUnreadCount + doneReadCount

  // Dev running-overview test wins compact status so "Running" is visible to click/expand.
  if (S.devRunningSim && runningCount > 0) {
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
      projectName: null,
      answer: null,
      showReply: false,
      showRunningOverview: false,
      overviewKind: null,
      runningAgents: [],
      selectedRunningTaskId: null,
      runningDetailOpen: false,
      selectedRunningStatus: null,
      systemLines: [],
      queuedMessages: [],
      focusInput: false,
      surfaceVisible: deriveSurfaceVisible(),
      escapeCloseRemainingSec: null,
      parked: false,
      compactSize: false,
      narrowSize: false,
      finishQueueRemaining: 0
    }
  }

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
      projectName: null,
      answer: null,
      showReply: false,
      showRunningOverview: false,
      overviewKind: null,
      runningAgents: [],
      selectedRunningTaskId: null,
      runningDetailOpen: false,
      selectedRunningStatus: null,
      systemLines: [],
      queuedMessages: [],
      focusInput: false,
      surfaceVisible: deriveSurfaceVisible(),
      escapeCloseRemainingSec: null,
      parked: false,
      compactSize: false,
      narrowSize: false,
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
      projectName: null,
      answer: null,
      showReply: false,
      showRunningOverview: false,
      overviewKind: null,
      runningAgents: [],
      selectedRunningTaskId: null,
      runningDetailOpen: false,
      selectedRunningStatus: null,
      systemLines: [],
      queuedMessages: [],
      focusInput: false,
      surfaceVisible: deriveSurfaceVisible(),
      escapeCloseRemainingSec: null,
      parked: false,
      compactSize: false,
      narrowSize: false,
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
      projectName: null,
      answer: null,
      showReply: false,
      showRunningOverview: false,
      overviewKind: null,
      runningAgents: [],
      selectedRunningTaskId: null,
      runningDetailOpen: false,
      selectedRunningStatus: null,
      systemLines: [],
      queuedMessages: [],
      focusInput: false,
      surfaceVisible: deriveSurfaceVisible(),
      escapeCloseRemainingSec: null,
      parked: false,
      compactSize: false,
      narrowSize: false,
      finishQueueRemaining: 0
    }
  }

  // Nothing running / needing you / unread done - always show Inactive (even at 0 tasks).
  return {
    mode,
    runningCount,
    attentionCount,
    doneCount,
    headline: 'Inactive',
    trailing: null,
    detail: 'Nothing needs attention',
    taskId: null,
    taskTitle: null,
    projectName: null,
    answer: null,
    showReply: false,
    showRunningOverview: false,
    overviewKind: null,
    runningAgents: [],
    selectedRunningTaskId: null,
    runningDetailOpen: false,
    selectedRunningStatus: null,
    systemLines: [],
    queuedMessages: [],
    focusInput: false,
    surfaceVisible: deriveSurfaceVisible(),
    escapeCloseRemainingSec: null,
    parked: false,
    compactSize: false,
    narrowSize: false,
    finishQueueRemaining: 0
  }
}

export function truncateAnswer(answer: string | null): string | null {
  if (!answer) return null
  if (answer.length <= MAX_ANSWER_CHARS) return answer
  return `${answer.slice(0, MAX_ANSWER_CHARS).trimEnd()}…`
}

export function withSurface(next: NotchOverlaySnapshot): NotchOverlaySnapshot {
  return {
    ...next,
    surfaceVisible: deriveSurfaceVisible(),
    escapeCloseRemainingSec: currentEscapeCloseRemainingSec(),
    parked: deriveParked(),
    compactSize: deriveCompactSize(),
    narrowSize: deriveNarrowSize(),
    finishQueueRemaining: S.expandEvent?.showReply ? S.finishQueue.length : 0
  }
}

export function publishSnapshotRaw(next: NotchOverlaySnapshot): void {
  syncEscapeHoldMonitor()
  S.snapshot = next
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  S.overlayWindow.webContents.send('notch:S.snapshot', S.snapshot)
}

export function escapeHoldTargetActive(): boolean {
  if (S.expandEvent?.showReply && (S.phase === 'finishOpen' || S.phase === 'finishParked')) return true
  if (S.phase === 'runningOpen' || S.phase === 'runningParked') return true
  return false
}

export function currentEscapeCloseRemainingSec(): number | null {
  if (!escapeHoldTargetActive()) return null
  // Don't flash back to "0.5s" while the panel is already shrinking closed.
  if (S.phase === 'finishDismissing' || S.phase === 'runningDismissing') return null
  if (S.escHoldStartedAt == null) return ESCAPE_HOLD_DEFAULT_SEC
  const remainingMs = Math.max(0, ESCAPE_HOLD_MS - (Date.now() - S.escHoldStartedAt))
  return Math.round(remainingMs / 100) / 10
}

export function syncEscapeHoldMonitor(): void {
  const want = escapeHoldTargetActive()
  if (want && !S.stopEscMonitor) {
    S.stopEscMonitor = startMacEscapeKeyMonitor((down) => {
      if (down) beginEscapeHold()
      else endEscapeHold()
    })
    return
  }
  if (!want && S.stopEscMonitor) {
    stopEscapeHoldMonitor()
  }
}

export function beginEscapeHold(): void {
  if (!escapeHoldTargetActive() || S.escHoldStartedAt != null) return
  S.escHoldStartedAt = Date.now()
  if (S.escHoldTimer) clearInterval(S.escHoldTimer)
  S.escHoldTimer = setInterval(() => {
    if (S.escHoldStartedAt == null) return
    const remainingMs = ESCAPE_HOLD_MS - (Date.now() - S.escHoldStartedAt)
    S.snapshot = withSurface(S.snapshot)
    if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
      S.overlayWindow.webContents.send('notch:S.snapshot', S.snapshot)
    }
    if (remainingMs <= 0) {
      // Clear hold timers without republishing "0.5s" (that flashes before shrink).
      S.escHoldStartedAt = null
      if (S.escHoldTimer) {
        clearInterval(S.escHoldTimer)
        S.escHoldTimer = null
      }
      if (S.phase === 'runningOpen' || S.phase === 'runningParked') {
        bridge.closeRunningOverview({ revealCompactAfter: true })
        return
      }
      bridge.dismissNotchFinishChat({ force: true })
    }
  }, 100)
  S.snapshot = withSurface(S.snapshot)
  if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
    S.overlayWindow.webContents.send('notch:S.snapshot', S.snapshot)
  }
}

export function endEscapeHold(): void {
  const wasHolding = S.escHoldStartedAt != null || S.escHoldTimer != null
  S.escHoldStartedAt = null
  if (S.escHoldTimer) {
    clearInterval(S.escHoldTimer)
    S.escHoldTimer = null
  }
  if (wasHolding && escapeHoldTargetActive()) {
    S.snapshot = withSurface(S.snapshot)
    if (S.overlayWindow && !S.overlayWindow.isDestroyed()) {
      S.overlayWindow.webContents.send('notch:S.snapshot', S.snapshot)
    }
  }
}

export function stopEscapeHoldMonitor(): void {
  endEscapeHold()
  if (S.stopEscMonitor) {
    S.stopEscMonitor()
    S.stopEscMonitor = null
  }
}

export function publishSnapshot(): void {
  syncEscapeHoldMonitor()
  if (!S.overlayWindow || S.overlayWindow.isDestroyed()) return
  S.snapshot = withSurface(S.snapshot)
  S.overlayWindow.webContents.send('notch:S.snapshot', S.snapshot)
}

export function clearSurfaceAnimTimer(): void {
  cancelAnimation()
}

export function clearCollapseTimer(): void {
  // legacy no-op - collapse timer removed; animations use cancelAnimation()
}

registerBridge({
  composeSnapshot,
  publishSnapshot,
  truncateAnswer,
  endEscapeHold,
  stopEscapeHoldMonitor
})
