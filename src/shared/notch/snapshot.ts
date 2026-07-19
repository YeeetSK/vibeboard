import type { NotchOverlaySnapshot } from '../types'

export function emptyNotchOverlaySnapshot(): NotchOverlaySnapshot {
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
    surfaceVisible: false,
    escapeCloseRemainingSec: null,
    parked: false,
    compactSize: false,
    narrowSize: false,
    finishQueueRemaining: 0
  }
}
