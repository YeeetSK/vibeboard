import type { BrowserWindow } from 'electron'
import type { NotchOverlaySnapshot, NotchRunningAgent } from '../../shared/types'
import { emptyNotchOverlaySnapshot } from '../../shared/notch'
import type { ExpandEvent, NotchQueuedMessage, OverlayDeps, NotchPhase } from './types'

/**
 * Mutable module state shared across notch/* modules.
 * Use `S.field` reads/writes so ESM live bindings stay writable across files.
 */
export const S = {
  deps: null as OverlayDeps | null,
  overlayWindow: null as BrowserWindow | null,
  overlayReady: false,
  overlayReadyWaiters: [] as Array<() => void>,
  snapshot: emptyNotchOverlaySnapshot() as NotchOverlaySnapshot,
  pinningPosition: false,
  processTeardownBound: false,
  displayMetricsBound: false,
  expandEvent: null as ExpandEvent | null,
  /** Last finish-chat panel, kept so compact click can reopen after dismiss. */
  lastFinishChat: null as ExpandEvent | null,
  /** Finished tasks waiting to show: only one finish panel at a time. */
  finishQueue: [] as ExpandEvent[],
  /** Ignore park briefly after unpark/present so the activating click doesn't re-collapse. */
  unparkGuardUntil: 0,
  /** Allow showing the overlay even while the main window is focused (dev test). */
  forceOverlayVisible: false,
  /** After first main-window show, keep the notch dark so launch never races the board. */
  launchGraceUntil: 0,
  launchGraceTimer: null as ReturnType<typeof setTimeout> | null,

  phase: 'hidden' as NotchPhase,
  /** Status overview list kind while a running* phase is active. */
  overviewKind: 'running' as 'running' | 'done',
  /** Selected processing task inside the running overview panel. */
  selectedRunningTaskId: null as string | null,
  /** Detail page open for selectedRunningTaskId (stays open after that task finishes). */
  runningDetailOpen: false,
  /**
   * Vertical Running/Done dismiss: CSS-narrow to the compact pill on step 1.
   * App-focus tuck keeps full width and uses clip-path instead.
   */
  runningDismissNarrow: false,
  /** Vertical finish dismiss (Esc → compact): CSS-narrow on step 1 after height shrink. */
  finishDismissNarrow: false,
  /**
   * Appear:
   * 0 = tucked@status (narrow)
   * 1 = sides open@status (still narrow)
   * 2 = widened@status (full width, still status height) → then grow open
   */
  appearStep: 0,
  /**
   * Dismiss:
   * 0 = full-width@status (height shrunk only)
   * 1 = narrowed or tucked@status → then settle/hide
   */
  dismissStep: 0,

  animGeneration: 0,
  animTimers: [] as Array<ReturnType<typeof setTimeout>>,
  awayBlurTimer: null as ReturnType<typeof setTimeout> | null,
  unparkFocusTimer: null as ReturnType<typeof setTimeout> | null,
  focusInputClearTimer: null as ReturnType<typeof setTimeout> | null,

  /** Dev test armed: expand finish-chat after the notch appears in the background. */
  devFinishTestPending: false,
  devFinishTestTimer: null as ReturnType<typeof setTimeout> | null,
  /** Dev test armed: expand running overview after the notch appears in the background. */
  devRunningTestPending: false,
  devRunningTestTimer: null as ReturnType<typeof setTimeout> | null,
  /** Simulated processing agents for the running-overview notch test. */
  devRunningSim: null as {
    agents: NotchRunningAgent[]
    systemByTask: Map<string, string[]>
    queuedByTask: Map<string, NotchQueuedMessage[]>
  } | null,

  /** Stop watching for click-away / app switch while finish chat is expanded. */
  stopAwayWatch: null as (() => void) | null,
  /** Global Escape hold-to-close while finish chat is open (works unfocused). */
  stopEscMonitor: null as (() => void) | null,
  escHoldStartedAt: null as number | null,
  escHoldTimer: null as ReturnType<typeof setInterval> | null,

  pinGeneration: 0
}
