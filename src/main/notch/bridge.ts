/**
 * Late-bound cross-module calls to break circular import init cycles.
 * Modules register implementations after their own exports are defined.
 */
import type { NotchOverlaySnapshot } from '../../shared/types'
import type { ExpandEvent } from './types'

type Bridge = {
  composeSnapshot: (mode: 'compact' | 'expanded') => NotchOverlaySnapshot
  publishSnapshot: () => void
  pinOverlayFrame: (options?: { animate?: boolean }) => void
  ensureNotchOverlay: () => void
  whenOverlayReady: () => Promise<void>
  showOverlayInactive: () => void
  hideEmptyNotchOverlay: () => void
  applyFocusMode: () => void
  applyMousePassthrough: () => void
  setOverlayClickThrough: (passthrough: boolean) => void
  shouldKeepNotchDark: () => boolean
  dismissForMainFocus: () => void
  revealCompact: () => Promise<void>
  startCompactHide: () => void
  hasNotchActivity: () => boolean
  syncNotchOverlay: () => void
  presentFinishChat: (
    event: ExpandEvent,
    options?: { focusInput?: boolean; forceShow?: boolean; fromRevealedStatus?: boolean }
  ) => void
  presentQueuedFinish: (event: ExpandEvent) => void
  startFinishDismiss: (options: {
    stashToQueue: boolean
    advanceQueue?: boolean
    saveDismissed?: ExpandEvent | null
    clearReopen?: boolean
    verticalOnly?: boolean
  }) => void
  stopFinishAwayWatch: () => void
  startFinishAwayWatch: () => void
  endEscapeHold: () => void
  stopEscapeHoldMonitor: () => void
  takeNextPendingFinish: () => ExpandEvent | null
  presentDoneOverviewForTask: (
    taskId: string,
    options?: { openDetail?: boolean; forceShow?: boolean }
  ) => void
  clearNotchFinishForTask: (taskId: string) => void
  queueDoneOverviewExpand: (input: {
    taskId: string
    title: string
    projectName: string | null
  }) => void
  presentRunningOverview: (
    kind?: 'running' | 'done',
    options?: { forceShow?: boolean; selectTaskId?: string | null; openDetail?: boolean }
  ) => void
  closeRunningOverview: (options?: {
    revealCompactAfter?: boolean
    tuckAway?: boolean
  }) => boolean
  startRunningAwayWatch: () => void
  unparkNotchRunningDetail: () => boolean
  parkNotchRunningDetail: () => boolean
  clearDevFinishTestTimer: () => void
  clearDevRunningTest: () => void
  clearDevRunningTestTimer: () => void
  maybeScheduleDevFinishExpand: () => void
  maybeScheduleDevRunningExpand: () => void
  resolvedRunningCount: () => number
  resolvedOverviewAgents: () => import('../../shared/types').NotchRunningAgent[]
  resolvedOverviewCount: () => number
  resolvedSystemTail: (taskId: string) => string[]
  resolvedQueuedMessages: (taskId: string) => import('./types').NotchQueuedMessage[]
  isSimulatedNotchTaskId: (taskId: string) => boolean
  truncateAnswer: (answer: string | null) => string | null
  dismissNotchFinishChat: (options?: { force?: boolean }) => boolean
  openStatusOverview: (kind: 'running' | 'done') => boolean
  advanceFinishQueue: (options?: {
    saveDismissed?: ExpandEvent | null
    clearReopen?: boolean
  }) => void
  bindProcessTeardown: () => void
  purgeNotchOverlays: () => void
}

export const bridge = {} as Bridge

export function registerBridge(partial: Partial<Bridge>): void {
  Object.assign(bridge, partial)
}
