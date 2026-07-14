import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { VibeBoardStore } from './database'
import { PlaceholderCursorAdapter, cursorInstallCommand } from './cursorAdapter'
import { runCursorTask } from './cursorRunner'
import type {
  CreateLaneInput,
  CreateProjectInput,
  CreateTabInput,
  CreateTaskInput,
  MoveTaskInput,
  RenameInput,
  SendTaskMessageInput,
  UpdateTabMetaInput,
  UpdateTaskStatusInput
} from '../shared/types'

let store: VibeBoardStore
const cursorAdapter = new PlaceholderCursorAdapter()
const runningTasks = new Set<string>()
const windows = new Set<BrowserWindow>()
const execFileAsync = promisify(execFile)

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    title: 'VibeBoard',
    backgroundColor: '#111111',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })
  mainWindow.on('closed', () => {
    windows.delete(mainWindow)
  })
  windows.add(mainWindow)

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const registerIpc = (): void => {
  ipcMain.handle('state:get', () => store.getState())
  ipcMain.handle('project:create', (_event, input: CreateProjectInput) => store.createProject(input))
  ipcMain.handle('tab:create', (_event, input: CreateTabInput) => store.createTab(input))
  ipcMain.handle('tab:rename', (_event, input: RenameInput) => store.renameTab(input))
  ipcMain.handle('tab:updateMeta', (_event, input: UpdateTabMetaInput) => store.updateTabMeta(input))
  ipcMain.handle('tab:close', (_event, tabId: string) => store.closeTab(tabId))
  ipcMain.handle('tab:reopen', (_event, tabId: string) => store.reopenTab(tabId))
  ipcMain.handle('tab:delete', (_event, tabId: string) => store.deleteTab(tabId))
  ipcMain.handle('tab:active', (_event, tabId: string) => store.setActiveTab(tabId))
  ipcMain.handle('lane:create', (_event, input: CreateLaneInput) => store.createLane(input))
  ipcMain.handle('lane:rename', (_event, input: RenameInput) => store.renameLane(input))
  ipcMain.handle('lane:delete', (_event, laneId: string) => store.deleteLane(laneId))
  ipcMain.handle('task:create', (_event, input: CreateTaskInput) => store.createTask(input))
  ipcMain.handle('task:move', (_event, input: MoveTaskInput) => store.moveTask(input))
  ipcMain.handle('task:delete', (_event, taskId: string) => store.deleteTask(taskId))
  ipcMain.handle('task:message', (_event, input: SendTaskMessageInput) => store.sendTaskMessage(input))
  ipcMain.handle('task:runCursor', (_event, taskId: string) => {
    if (runningTasks.has(taskId)) {
      return { started: false, message: 'Task is already running.' }
    }

    runningTasks.add(taskId)
    runCursorTask({
      taskId,
      store,
      onStateChanged: broadcastStateChanged
    }).finally(() => {
      runningTasks.delete(taskId)
      broadcastStateChanged()
    })

    return { started: true, message: 'Cursor agent started.' }
  })
  ipcMain.handle('task:status', (_event, input: UpdateTaskStatusInput) => store.updateTaskStatus(input))
  ipcMain.handle('task:read', (_event, taskId: string) => store.markTaskRead(taskId))
  ipcMain.handle('cursor:status', () => cursorAdapter.status())
  ipcMain.handle('cursor:installCli', () => cursorAdapter.installCli())
  ipcMain.handle('cursor:installTerminal', () => openCursorInstallTerminal())
  ipcMain.handle('cursor:setup', () => openCursorSetup())
}

const openCursorInstallTerminal = async (): Promise<void> => {
  const command = `if ! command -v agent >/dev/null 2>&1; then ${cursorInstallCommand}; fi; agent login; echo; echo "Done. Return to VibeBoard."; read -k 1 "?Press any key to close."`
  if (process.platform === 'darwin') {
    await execFileAsync('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(command)}`])
    await execFileAsync('osascript', ['-e', 'tell application "Terminal" to activate'])
    return
  }

  await shell.openExternal('https://cursor.com/docs/cli/installation')
}

const openCursorSetup = async (): Promise<void> => {
  const cursorAppPath = '/Applications/Cursor.app'
  if (process.platform === 'darwin' && existsSync(cursorAppPath)) {
    await shell.openPath(cursorAppPath)
    return
  }

  await shell.openExternal('https://cursor.com/downloads')
}

const broadcastStateChanged = (): void => {
  for (const window of windows) {
    window.webContents.send('state:changed')
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.yeeetsk.vibeboard')
  store = new VibeBoardStore()
  registerIpc()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
