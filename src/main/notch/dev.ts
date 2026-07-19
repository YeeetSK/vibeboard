import { is } from '@electron-toolkit/utils'
import type { NotchRunningAgent } from '../../shared/types'
import { S } from './state'
import { bridge, registerBridge } from './bridge'
import { DEV_FINISH_EXPAND_DELAY_MS } from './types'
import { isFinishPhase } from './phase'
import { ensureNotchOverlay } from './window'

export const scheduleDevNotchFinishTest = (_delayMs?: number): boolean => {
  if (!is.dev) return false
  clearDevFinishTestTimer()
  clearDevRunningTest()
  S.devFinishTestPending = true
  ensureNotchOverlay()
  // Already in the background: expand after the notch reveal delay.
  maybeScheduleDevFinishExpand()
  return true
}

/**
 * Dev-only: open the running-overview panel with simulated agents.
 * Does not require real processing tasks or leaving the app (unlike finish-chat test).
 */
export const scheduleDevNotchRunningTest = (_delayMs?: number): boolean => {
  if (!is.dev) return false
  clearDevRunningTestTimer()
  clearDevFinishTestTimer()
  S.devFinishTestPending = false
  S.devRunningTestPending = false
  seedDevRunningSim()
  ensureNotchOverlay()
  forcePresentRunningOverview()
  return true
}

/** Once the notch is showing in the background, expand the armed finish test. */
export function maybeScheduleDevFinishExpand(): void {
  if (!is.dev || !S.devFinishTestPending) return
  if (S.deps?.isMainAppFocused()) return
  if (S.expandEvent?.showReply) {
    S.devFinishTestPending = false
    clearDevFinishTestTimer()
    return
  }
  if (S.devFinishTestTimer) return

  S.devFinishTestTimer = setTimeout(() => {
    S.devFinishTestTimer = null
    if (!S.devFinishTestPending) return
    if (S.deps?.isMainAppFocused()) return
    if (S.expandEvent?.showReply) {
      S.devFinishTestPending = false
      return
    }
    S.devFinishTestPending = false
    bridge.presentFinishChat(
      {
        headline: 'Finished',
        detail: 'Dev finish-chat test',
        taskId: `dev-notch-test-${Date.now()}`,
        taskTitle: 'Dev finish-chat test',
        projectName: 'vibeboard',
        answer:
          'Simulated agent reply. Click outside this island (or switch apps) to park it, then click the strip to expand again. Hold Esc 0.5s to close.',
        showReply: true,
        focusInput: false,
        simulated: true
      },
      { focusInput: false, forceShow: true }
    )
  }, DEV_FINISH_EXPAND_DELAY_MS)
}

/** Once the notch is showing in the background, expand the armed running overview test. */
export function maybeScheduleDevRunningExpand(): void {
  if (!is.dev || !S.devRunningTestPending) return
  if (S.deps?.isMainAppFocused()) return
  if (S.phase === 'runningOpen') {
    S.devRunningTestPending = false
    clearDevRunningTestTimer()
    return
  }
  if (isFinishPhase()) return
  if (S.devRunningTestTimer) return

  S.devRunningTestTimer = setTimeout(() => {
    S.devRunningTestTimer = null
    if (!S.devRunningTestPending) return
    if (S.deps?.isMainAppFocused()) return
    if (S.phase === 'runningOpen' || isFinishPhase()) {
      S.devRunningTestPending = false
      return
    }
    S.devRunningTestPending = false
    forcePresentRunningOverview()
  }, DEV_FINISH_EXPAND_DELAY_MS)
}

export function seedDevRunningSim(): void {
  const now = Date.now()
  const agents: NotchRunningAgent[] = [
    {
      taskId: 'dev-running-1',
      title: 'Wire notch running overview',
      projectName: 'vibeboard',
      runStartedAt: new Date(now - 125_000).toISOString(),
      queuedCount: 1
    },
    {
      taskId: 'dev-running-2',
      title: 'Polish overlay system tail',
      projectName: 'vibeboard',
      runStartedAt: new Date(now - 42_000).toISOString(),
      queuedCount: 0
    }
  ]
  S.devRunningSim = {
    agents,
    systemByTask: new Map([
      [
        'dev-running-1',
        [
          'Reading src/main/notchOverlay.ts',
          'Editing OverlayApp.tsx',
          'Running typecheck…'
        ]
      ],
      [
        'dev-running-2',
        ['Searching for .running-overview', 'Updating overlay.css']
      ]
    ]),
    queuedByTask: new Map([
      ['dev-running-1', [{ id: 'dev-q-1', content: 'Also add Esc to close' }]]
    ])
  }
}

export function forcePresentRunningOverview(): void {
  if (!S.devRunningSim) seedDevRunningSim()
  bridge.presentRunningOverview('running', { forceShow: true })
}

export function clearDevFinishTestTimer(): void {
  if (!S.devFinishTestTimer) return
  clearTimeout(S.devFinishTestTimer)
  S.devFinishTestTimer = null
}

export function clearDevRunningTestTimer(): void {
  if (!S.devRunningTestTimer) return
  clearTimeout(S.devRunningTestTimer)
  S.devRunningTestTimer = null
}

export function clearDevRunningTest(): void {
  clearDevRunningTestTimer()
  S.devRunningTestPending = false
  S.devRunningSim = null
  S.forceOverlayVisible = false
}

registerBridge({
  clearDevFinishTestTimer,
  clearDevRunningTest,
  clearDevRunningTestTimer,
  maybeScheduleDevFinishExpand,
  maybeScheduleDevRunningExpand
})
