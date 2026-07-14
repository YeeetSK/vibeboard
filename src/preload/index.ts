import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateLaneInput,
  CreateProjectInput,
  CreateTabInput,
  CreateTaskInput,
  MoveTaskInput,
  RenameInput,
  SendTaskMessageInput,
  UpdateTabMetaInput,
  UpdateTaskStatusInput,
  VibeBoardApi
} from '../shared/types'

const api: VibeBoardApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  onStateChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke('project:create', input),
  createTab: (input: CreateTabInput) => ipcRenderer.invoke('tab:create', input),
  renameTab: (input: RenameInput) => ipcRenderer.invoke('tab:rename', input),
  updateTabMeta: (input: UpdateTabMetaInput) => ipcRenderer.invoke('tab:updateMeta', input),
  closeTab: (tabId: string) => ipcRenderer.invoke('tab:close', tabId),
  reopenTab: (tabId: string) => ipcRenderer.invoke('tab:reopen', tabId),
  deleteTab: (tabId: string) => ipcRenderer.invoke('tab:delete', tabId),
  setActiveTab: (tabId: string) => ipcRenderer.invoke('tab:active', tabId),
  createLane: (input: CreateLaneInput) => ipcRenderer.invoke('lane:create', input),
  renameLane: (input: RenameInput) => ipcRenderer.invoke('lane:rename', input),
  deleteLane: (laneId: string) => ipcRenderer.invoke('lane:delete', laneId),
  createTask: (input: CreateTaskInput) => ipcRenderer.invoke('task:create', input),
  moveTask: (input: MoveTaskInput) => ipcRenderer.invoke('task:move', input),
  sendTaskMessage: (input: SendTaskMessageInput) => ipcRenderer.invoke('task:message', input),
  runTaskWithCursor: (taskId: string) => ipcRenderer.invoke('task:runCursor', taskId),
  updateTaskStatus: (input: UpdateTaskStatusInput) => ipcRenderer.invoke('task:status', input),
  markTaskRead: (taskId: string) => ipcRenderer.invoke('task:read', taskId),
  getCursorAdapterStatus: () => ipcRenderer.invoke('cursor:status')
}

contextBridge.exposeInMainWorld('vibeboard', api)
