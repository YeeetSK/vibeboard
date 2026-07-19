import type {
  NotchOverlaySettings,
  NotchRunningAgent,
  Task
} from '../../shared/types'
import type { BrowserWindow } from 'electron'
import {
  SIDE_REVEAL_MS,
  SIDE_REVEAL_DELAY_MS,
  HEIGHT_ANIM_MS,
  PARK_ANIM_MS
} from '../../shared/notch'

export {
  SIDE_REVEAL_MS,
  SIDE_REVEAL_DELAY_MS,
  HEIGHT_ANIM_MS,
  PARK_ANIM_MS
}

export const NOTCH_WINDOW_TITLE = 'VibeBoard Notch'
export const NOTCH_WINDOW_MARK = '__vibeboardNotchOverlay'
export const MAX_ANSWER_CHARS = 6000
export const ESCAPE_HOLD_MS = 500
export const ESCAPE_HOLD_DEFAULT_SEC = 0.5
export const isMac = process.platform === 'darwin'
/** Always-on-top level that works on both macOS (menu-bar band) and Windows. */
export const OVERLAY_ALWAYS_ON_TOP_LEVEL = isMac ? 'main-menu' : 'screen-saver'
export const NOTCH_LAUNCH_GRACE_MS = 1200
export const DEV_FINISH_EXPAND_DELAY_MS = 1500

export type ExpandEvent = {
  headline: string
  detail: string
  taskId: string
  taskTitle: string
  projectName: string | null
  answer: string | null
  showReply: boolean
  focusInput: boolean
  /** Dev / preview panel: no real task backing it. */
  simulated?: boolean
}

export type NotchQueuedMessage = { id: string; content: string }

export type OverlayDeps = {
  getSettings: () => NotchOverlaySettings
  getRunningCount: () => number
  getAttentionCount: () => number
  getDoneUnreadCount: () => number
  getDoneReadCount: () => number
  getRunningAgents: () => NotchRunningAgent[]
  getDoneAgents: () => NotchRunningAgent[]
  getSystemTail: (taskId: string) => string[]
  getQueuedMessages: (taskId: string) => NotchQueuedMessage[]
  /** Meta for a task that may have left the processing list (pinned detail). */
  getTaskNotchMeta: (taskId: string) => {
    title: string
    projectName: string | null
    status: Task['status']
    runStartedAt: string | null
  } | null
  isTaskOnOpenTab: (taskId: string) => boolean
  /** True while the task still needs a finish-chat nudge (unread done). */
  isTaskFinishPending: (taskId: string) => boolean
  getLatestAssistantReply: (taskId: string) => string | null
  getBoardLabelForTask: (task: Task) => string | null
  onOpenTask: (taskId: string) => void
  onSendReply: (taskId: string, content: string) => Promise<void>
  onUpdateQueuedMessage: (taskId: string, messageId: string, content: string) => boolean
  onRemoveQueuedMessage: (taskId: string, messageId: string) => boolean
  isMainAppFocused: () => boolean
  /** False until the main BrowserWindow has shown once this session. */
  hasMainWindowBeenShown: () => boolean
}

export type MarkedWindow = BrowserWindow & { [NOTCH_WINDOW_MARK]?: boolean }

/**
 * Single owner of notch geometry / animation.
 * Snapshot flags (surfaceVisible / parked / compactSize) are derived from this.
 */
export type NotchPhase =
  | 'hidden'
  | 'compact'
  | 'runningAppearing'
  | 'runningOpen'
  | 'runningParked'
  | 'runningDismissing'
  | 'finishAppearing'
  | 'finishOpen'
  | 'finishParked'
  | 'finishDismissing'
