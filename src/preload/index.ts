import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  CreateLaneInput,
  CreateProjectInput,
  CreateTabInput,
  CreateTaskInput,
  GetTaskDetailInput,
  MoveTaskInput,
  RecordSearchOpenInput,
  ReorderTabsInput,
  RenameInput,
  SearchWorkspaceInput,
  SendTaskMessageInput,
  UpdateTabMetaInput,
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
  getUpdateInfo: () => ipcRenderer.invoke('updates:get'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke('project:create', input),
  relocateProject: (projectId: string) => ipcRenderer.invoke('project:relocate', projectId),
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
  moveTask: (input: MoveTaskInput) => ipcRenderer.invoke('task:move', input),
  deleteTask: (taskId: string) => ipcRenderer.invoke('task:delete', taskId),
  sendTaskMessage: (input: SendTaskMessageInput) => ipcRenderer.invoke('task:message', input),
  runTaskWithCursor: (taskId: string) => ipcRenderer.invoke('task:runCursor', taskId),
  updateTaskStatus: (input: UpdateTaskStatusInput) => ipcRenderer.invoke('task:status', input),
  markTaskRead: (taskId: string) => ipcRenderer.invoke('task:read', taskId),
  getCursorAdapterStatus: () => ipcRenderer.invoke('cursor:status'),
  installCursorCli: () => ipcRenderer.invoke('cursor:installCli'),
  openCursorInstallTerminal: () => ipcRenderer.invoke('cursor:installTerminal'),
  openCursorSetup: () => ipcRenderer.invoke('cursor:setup'),
  confirmQuit: () => ipcRenderer.invoke('app:confirmQuit'),
  cancelQuit: () => ipcRenderer.invoke('app:cancelQuit')
}

contextBridge.exposeInMainWorld('vibeboard', api)
