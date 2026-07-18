import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  CreateLaneInput,
  CreateProjectInput,
  CreateTabInput,
  CreateTaskInput,
  GetTaskDetailInput,
  MoveTaskInput,
  NotificationOpenRequest,
  NotificationSettings,
  AppearanceSettings,
  NotchOverlayCapability,
  NotchOverlaySettings,
  NotchOverlaySnapshot,
  RecordSearchOpenInput,
  ReorderTabsInput,
  RenameInput,
  SearchWorkspaceInput,
  SendTaskMessageInput,
  UpdateTabMetaInput,
  UpdateProjectAutoMoveInput,
  UpdateProjectRunModeInput,
  UpdateTaskModelInput,
  UpdateTaskStatusInput,
  UpdateInfo,
  QuitRequest,
  VibeBoardApi
} from '../shared/types'

const api: VibeBoardApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  getTaskDetail: (input: GetTaskDetailInput) => ipcRenderer.invoke('task:detail', input),
  searchWorkspace: (input: SearchWorkspaceInput) => ipcRenderer.invoke('search:workspace', input),
  recordSearchOpen: (input: RecordSearchOpenInput) => ipcRenderer.invoke('search:recordOpen', input),
  onStateChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  onQuitRequested: (callback: (request: QuitRequest) => void) => {
    const listener = (_event: IpcRendererEvent, request: QuitRequest): void => {
      ipcRenderer.send('app:quitPromptShown')
      callback(request)
    }
    ipcRenderer.on('app:quit-requested', listener)
    return () => ipcRenderer.removeListener('app:quit-requested', listener)
  },
  onUpdateChanged: (callback: (info: UpdateInfo) => void) => {
    const listener = (_event: IpcRendererEvent, info: UpdateInfo): void => callback(info)
    ipcRenderer.on('updates:changed', listener)
    return () => ipcRenderer.removeListener('updates:changed', listener)
  },
  onNotificationOpened: (callback: (request: NotificationOpenRequest) => void) => {
    const listener = (_event: IpcRendererEvent, request: NotificationOpenRequest): void => callback(request)
    ipcRenderer.on('notifications:opened', listener)
    return () => ipcRenderer.removeListener('notifications:opened', listener)
  },
  getUpdateInfo: () => ipcRenderer.invoke('updates:get'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  getNotificationSettings: () => ipcRenderer.invoke('notifications:get'),
  updateNotificationSettings: (settings: NotificationSettings) => ipcRenderer.invoke('notifications:update', settings),
  getAppearanceSettings: () => ipcRenderer.invoke('appearance:get'),
  updateAppearanceSettings: (settings: AppearanceSettings) => ipcRenderer.invoke('appearance:update', settings),
  sendTestNotification: () => ipcRenderer.invoke('notifications:test'),
  previewFinishSound: () => ipcRenderer.invoke('notifications:previewFinishSound'),
  getNotchOverlayCapability: () => ipcRenderer.invoke('notch:capability'),
  getNotchOverlaySettings: () => ipcRenderer.invoke('notch:getSettings'),
  updateNotchOverlaySettings: (settings: NotchOverlaySettings) => ipcRenderer.invoke('notch:updateSettings', settings),
  getNotchOverlaySnapshot: () => ipcRenderer.invoke('notch:getSnapshot'),
  onNotchOverlaySnapshot: (callback: (snapshot: NotchOverlaySnapshot) => void) => {
    const listener = (_event: IpcRendererEvent, snapshot: NotchOverlaySnapshot): void => callback(snapshot)
    ipcRenderer.on('notch:snapshot', listener)
    return () => ipcRenderer.removeListener('notch:snapshot', listener)
  },
  openTaskFromNotch: (taskId: string) => ipcRenderer.invoke('notch:openTask', taskId),
  collapseNotchOverlay: () => ipcRenderer.invoke('notch:collapse'),
  peekNotchOverlay: () => ipcRenderer.invoke('notch:peek'),
  dismissNotchFinishChat: (options?: { force?: boolean }) =>
    ipcRenderer.invoke('notch:dismiss', options),
  reopenNotchFinishChat: () => ipcRenderer.invoke('notch:reopen'),
  unparkNotchFinishChat: () => ipcRenderer.invoke('notch:unpark'),
  parkNotchFinishChat: () => ipcRenderer.invoke('notch:park'),
  scheduleDevNotchFinishTest: (delayMs?: number) =>
    ipcRenderer.invoke('notch:devFinishTest', delayMs),
  startNotchMarketingDemo: () => ipcRenderer.invoke('notch:marketingDemoStart'),
  stopNotchMarketingDemo: () => ipcRenderer.invoke('notch:marketingDemoStop'),
  setNotchMousePassthrough: (passthrough: boolean) => {
    ipcRenderer.send('notch:mousePassthrough', passthrough)
  },
  sendNotchReply: (input: { taskId: string; content: string }) =>
    ipcRenderer.invoke('notch:sendReply', input),
  getOnboardingComplete: () => ipcRenderer.invoke('onboarding:getComplete'),
  markOnboardingComplete: () => ipcRenderer.invoke('onboarding:markComplete'),
  reportUserActivity: () => ipcRenderer.send('app:userActivity'),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke('project:create', input),
  relocateProject: (projectId: string) => ipcRenderer.invoke('project:relocate', projectId),
  updateProjectRunMode: (input: UpdateProjectRunModeInput) => ipcRenderer.invoke('project:runMode', input),
  updateProjectAutoMove: (input: UpdateProjectAutoMoveInput) => ipcRenderer.invoke('project:autoMove', input),
  openProjectFolder: (projectId: string) => ipcRenderer.invoke('project:openFolder', projectId),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  createTab: (input: CreateTabInput) => ipcRenderer.invoke('tab:create', input),
  renameTab: (input: RenameInput) => ipcRenderer.invoke('tab:rename', input),
  updateTabMeta: (input: UpdateTabMetaInput) => ipcRenderer.invoke('tab:updateMeta', input),
  reorderTabs: (input: ReorderTabsInput) => ipcRenderer.invoke('tab:reorder', input),
  closeTab: (tabId: string) => ipcRenderer.invoke('tab:close', tabId),
  reopenTab: (tabId: string) => ipcRenderer.invoke('tab:reopen', tabId),
  deleteTab: (tabId: string) => ipcRenderer.invoke('tab:delete', tabId),
  setActiveTab: (tabId: string) => ipcRenderer.invoke('tab:active', tabId),
  createLane: (input: CreateLaneInput) => ipcRenderer.invoke('lane:create', input),
  renameLane: (input: RenameInput) => ipcRenderer.invoke('lane:rename', input),
  deleteLane: (laneId: string) => ipcRenderer.invoke('lane:delete', laneId),
  createTask: (input: CreateTaskInput) => ipcRenderer.invoke('task:create', input),
  renameTask: (input: RenameInput) => ipcRenderer.invoke('task:rename', input),
  moveTask: (input: MoveTaskInput) => ipcRenderer.invoke('task:move', input),
  deleteTask: (taskId: string) => ipcRenderer.invoke('task:delete', taskId),
  updateTaskModel: (input: UpdateTaskModelInput) => ipcRenderer.invoke('task:model', input),
  sendTaskMessage: (input: SendTaskMessageInput) => ipcRenderer.invoke('task:message', input),
  runTaskWithCursor: (taskId: string) => ipcRenderer.invoke('task:runCursor', taskId),
  retryTaskPrompt: (taskId: string) => ipcRenderer.invoke('task:retryPrompt', taskId),
  stopTask: (taskId: string) => ipcRenderer.invoke('task:stop', taskId),
  updateTaskStatus: (input: UpdateTaskStatusInput) => ipcRenderer.invoke('task:status', input),
  markTaskRead: (taskId: string) => ipcRenderer.invoke('task:read', taskId),
  getCursorAdapterStatus: () => ipcRenderer.invoke('cursor:status'),
  listAgentModels: () => ipcRenderer.invoke('cursor:listModels'),
  installCursorCli: () => ipcRenderer.invoke('cursor:installCli'),
  openCursorInstallTerminal: () => ipcRenderer.invoke('cursor:installTerminal'),
  openCursorSetup: () => ipcRenderer.invoke('cursor:setup'),
  confirmQuit: () => ipcRenderer.invoke('app:confirmQuit'),
  cancelQuit: () => ipcRenderer.invoke('app:cancelQuit')
}

contextBridge.exposeInMainWorld('vibeboard', api)
