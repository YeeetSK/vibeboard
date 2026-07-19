export { defaultNotchOverlaySettings, mergeNotchOverlaySettings } from './settings'
export { bindNotchOverlayDeps } from './sync'
export { getNotchOverlayCapability } from './capability'
export { getNotchOverlaySnapshot } from './snapshot'
export { purgeNotchOverlays, destroyNotchOverlay, isNotchOverlayWindow, setNotchOverlayMousePassthrough } from './window'
export {
  noteMainWindowShown,
  onMainAppFocused,
  demoteNotchOverlayForAppActivate,
  syncNotchOverlay,
  syncNotchIfEnabled,
  handleNotchOverlayStatusChange,
  peekNotchOverlay,
  openTaskFromNotch,
  sendReplyFromNotch
} from './sync'
export {
  clearNotchFinishForTask,
  collapseNotchOverlay,
  dismissNotchFinishChat,
  reopenNotchFinishChat,
  unparkNotchFinishChat,
  parkNotchFinishChat
} from './finish'
export {
  openNotchRunningOverview,
  openNotchDoneOverview,
  closeNotchRunningOverview,
  selectNotchRunningTask,
  closeNotchRunningDetail,
  updateNotchQueuedMessage,
  removeNotchQueuedMessage
} from './running'
export { scheduleDevNotchFinishTest, scheduleDevNotchRunningTest } from './dev'

// Ensure bridge registrations run (side-effect imports)
import './geometry'
import './snapshot'
import './window'
import './finish'
import './running'
import './sync'
import './dev'
