import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
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
  GetTaskDetailInput,
  MoveTaskInput,
  RecordSearchOpenInput,
  ReorderTabsInput,
  RenameInput,
  SearchWorkspaceInput,
  SendTaskMessageInput,
  UpdateInfo,
  UpdateTabMetaInput,
  UpdateTaskStatusInput
} from '../shared/types'

let store: VibeBoardStore
const cursorAdapter = new PlaceholderCursorAdapter()
const runningTasks = new Set<string>()
const windows = new Set<BrowserWindow>()
const execFileAsync = promisify(execFile)
let isQuitConfirmed = false
let isQuitPromptOpen = false
let quitPromptFallbackTimer: NodeJS.Timeout | null = null
let updateInfo: UpdateInfo = {
  status: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: null,
  message: 'Ready to check for updates.',
  progress: null,
  releaseUrl: null
}

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

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
  mainWindow.on('close', (event) => {
    if (isQuitConfirmed) return
    event.preventDefault()
    requestQuitConfirmation()
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
  ipcMain.handle('task:detail', (_event, input: GetTaskDetailInput) => store.getTaskDetail(input))
  ipcMain.handle('search:workspace', (_event, input: SearchWorkspaceInput) => store.searchWorkspace(input))
  ipcMain.handle('search:recordOpen', (_event, input: RecordSearchOpenInput) => store.recordSearchOpen(input))
  ipcMain.handle('project:create', (_event, input: CreateProjectInput) => store.createProject(input))
  ipcMain.handle('project:openFolder', async (_event, projectId: string) => {
    const project = store.getProject(projectId)
    if (!project) return
    const error = await shell.openPath(project.path)
    if (error) {
      throw new Error(error)
    }
  })
  ipcMain.handle('project:relocate', (_event, projectId: string) => store.relocateProject(projectId))
  ipcMain.handle('tab:create', (_event, input: CreateTabInput) => store.createTab(input))
  ipcMain.handle('tab:rename', (_event, input: RenameInput) => store.renameTab(input))
  ipcMain.handle('tab:updateMeta', (_event, input: UpdateTabMetaInput) => store.updateTabMeta(input))
  ipcMain.handle('tab:reorder', (_event, input: ReorderTabsInput) => store.reorderTabs(input))
  ipcMain.handle('tab:close', (_event, tabId: string) => store.closeTab(tabId))
  ipcMain.handle('tab:reopen', (_event, tabId: string) => store.reopenTab(tabId))
  ipcMain.handle('tab:delete', (_event, tabId: string) => store.deleteTab(tabId))
  ipcMain.handle('tab:active', (_event, tabId: string) => store.setActiveTab(tabId))
  ipcMain.handle('lane:create', (_event, input: CreateLaneInput) => store.createLane(input))
  ipcMain.handle('lane:rename', (_event, input: RenameInput) => store.renameLane(input))
  ipcMain.handle('lane:delete', (_event, laneId: string) => store.deleteLane(laneId))
  ipcMain.handle('task:create', (_event, input: CreateTaskInput) => {
    const task = store.createTask(input)
    return task
  })
  ipcMain.handle('task:move', (_event, input: MoveTaskInput) => store.moveTask(input))
  ipcMain.handle('task:delete', (_event, taskId: string) => store.deleteTask(taskId))
  ipcMain.handle('task:message', (_event, input: SendTaskMessageInput) => {
    store.sendTaskMessage(input)
    return startCursorTask(input.taskId)
  })
  ipcMain.handle('task:runCursor', (_event, taskId: string) => startCursorTask(taskId))
  ipcMain.handle('task:status', (_event, input: UpdateTaskStatusInput) => store.updateTaskStatus(input))
  ipcMain.handle('task:read', (_event, taskId: string) => store.markTaskRead(taskId))
  ipcMain.handle('cursor:status', () => cursorAdapter.status())
  ipcMain.handle('cursor:installCli', () => cursorAdapter.installCli())
  ipcMain.handle('cursor:installTerminal', () => openCursorInstallTerminal())
  ipcMain.handle('cursor:setup', () => openCursorSetup())
  ipcMain.handle('updates:get', () => updateInfo)
  ipcMain.handle('updates:check', () => checkForUpdates())
  ipcMain.handle('updates:download', () => downloadUpdate())
  ipcMain.handle('updates:install', () => installUpdate())
  ipcMain.on('app:quitPromptShown', () => {
    clearQuitPromptFallback()
  })
  ipcMain.handle('app:confirmQuit', () => {
    clearQuitPromptFallback()
    isQuitConfirmed = true
    isQuitPromptOpen = false
    app.quit()
  })
  ipcMain.handle('app:cancelQuit', () => {
    clearQuitPromptFallback()
    isQuitPromptOpen = false
  })
}

const registerUpdaterEvents = (): void => {
  autoUpdater.on('checking-for-update', () => {
    setUpdateInfo({
      status: 'checking',
      latestVersion: null,
      message: 'Checking for updates.',
      progress: null,
      releaseUrl: null
    })
  })

  autoUpdater.on('update-available', (info) => {
    setUpdateInfo({
      status: 'available',
      latestVersion: info.version,
      message: `Version ${info.version} is available.`,
      progress: null,
      releaseUrl: `https://github.com/YeeetSK/vibeboard/releases/tag/v${info.version}`
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    setUpdateInfo({
      status: 'not_available',
      latestVersion: info.version ?? app.getVersion(),
      message: 'VibeBoard is up to date.',
      progress: null,
      releaseUrl: null
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setUpdateInfo({
      status: 'downloading',
      latestVersion: updateInfo.latestVersion,
      message: 'Downloading update.',
      progress: Math.round(progress.percent),
      releaseUrl: updateInfo.releaseUrl
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateInfo({
      status: 'downloaded',
      latestVersion: info.version,
      message: `Version ${info.version} is ready to install.`,
      progress: 100,
      releaseUrl: updateInfo.releaseUrl
    })
  })

  autoUpdater.on('error', (error) => {
    setUpdateInfo({
      status: 'error',
      latestVersion: updateInfo.latestVersion,
      message: error.message,
      progress: null,
      releaseUrl: updateInfo.releaseUrl
    })
  })
}

const setUpdateInfo = (next: Partial<UpdateInfo>): UpdateInfo => {
  updateInfo = {
    ...updateInfo,
    ...next,
    currentVersion: app.getVersion()
  }
  for (const window of windows) {
    window.webContents.send('updates:changed', updateInfo)
  }
  return updateInfo
}

const checkForUpdates = async (): Promise<UpdateInfo> => {
  if (is.dev) {
    return checkGithubReleaseForDev()
  }

  try {
    setUpdateInfo({
      status: 'checking',
      message: 'Checking for updates.',
      progress: null,
      releaseUrl: null
    })
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setUpdateInfo({
      status: 'error',
      message: error instanceof Error ? error.message : 'Update check failed.',
      progress: null,
      releaseUrl: updateInfo.releaseUrl
    })
  }

  return updateInfo
}

const checkGithubReleaseForDev = async (): Promise<UpdateInfo> => {
  try {
    setUpdateInfo({
      status: 'checking',
      latestVersion: null,
      message: 'Checking GitHub releases.',
      progress: null,
      releaseUrl: null
    })

    const response = await fetch('https://api.github.com/repos/YeeetSK/vibeboard/releases/latest', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'VibeBoard'
      }
    })
    if (!response.ok) {
      if (response.status === 404) {
        return setUpdateInfo({
          status: 'not_available',
          latestVersion: null,
          message: 'GitHub release metadata is not public yet.',
          progress: null,
          releaseUrl: null
        })
      }
      throw new Error(`GitHub returned ${response.status}`)
    }

    const release = (await response.json()) as {
      tag_name?: string
      html_url?: string
      prerelease?: boolean
    }
    const latestVersion = normalizeVersion(release.tag_name ?? '')
    if (!latestVersion) {
      throw new Error('Latest release has no version tag.')
    }

    if (compareVersions(latestVersion, app.getVersion()) > 0) {
      return setUpdateInfo({
        status: 'available',
        latestVersion,
        message: `Version ${latestVersion} is available.`,
        progress: null,
        releaseUrl: release.html_url ?? `https://github.com/YeeetSK/vibeboard/releases/tag/v${latestVersion}`
      })
    }

    return setUpdateInfo({
      status: 'not_available',
      latestVersion,
      message: 'VibeBoard is up to date.',
      progress: null,
      releaseUrl: null
    })
  } catch (error) {
    return setUpdateInfo({
      status: 'error',
      latestVersion: null,
      message: error instanceof Error ? error.message : 'Update check failed.',
      progress: null,
      releaseUrl: null
    })
  }
}

const downloadUpdate = async (): Promise<UpdateInfo> => {
  if (updateInfo.status !== 'available') return updateInfo

  if (is.dev) {
    if (updateInfo.releaseUrl) {
      await shell.openExternal(updateInfo.releaseUrl)
    }
    return updateInfo
  }

  try {
    setUpdateInfo({
      status: 'downloading',
      message: 'Downloading update.',
      progress: 0,
      releaseUrl: updateInfo.releaseUrl
    })
    await autoUpdater.downloadUpdate()
  } catch (error) {
    setUpdateInfo({
      status: 'error',
      message: error instanceof Error ? error.message : 'Update download failed.',
      progress: null,
      releaseUrl: updateInfo.releaseUrl
    })
  }

  return updateInfo
}

const installUpdate = (): void => {
  if (updateInfo.status !== 'downloaded') return
  isQuitConfirmed = true
  autoUpdater.quitAndInstall(false, true)
}

const normalizeVersion = (version: string): string => version.trim().replace(/^v/i, '')

const compareVersions = (a: string, b: string): number => {
  const left = normalizeVersion(a).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const right = normalizeVersion(b).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }

  return 0
}

const startCursorTask = (taskId: string): { started: boolean; message: string } => {
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

  broadcastStateChanged()
  return { started: true, message: 'Cursor agent started.' }
}

const openCursorInstallTerminal = async (): Promise<void> => {
  const command = [
    'if ! command -v agent >/dev/null 2>&1; then',
    cursorInstallCommand,
    'fi',
    'echo "Cursor Agent login"',
    'echo "If the browser is blank, copy the link printed below into another tab."',
    'NO_OPEN_BROWSER=1 agent login',
    'echo',
    'agent status',
    'echo',
    'echo "Done. Return to VibeBoard."',
    'read -k 1 "?Press any key to close."'
  ].join('; ')
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

const requestQuitConfirmation = (): void => {
  if (isQuitPromptOpen) return

  const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!targetWindow || targetWindow.webContents.isDestroyed()) {
    quitWithoutPrompt()
    return
  }

  isQuitPromptOpen = true
  targetWindow.webContents.send('app:quit-requested', {
    hasRunningTasks: runningTasks.size > 0
  })
  quitPromptFallbackTimer = setTimeout(() => {
    if (isQuitPromptOpen) {
      quitWithoutPrompt()
    }
  }, is.dev ? 1200 : 3000)
}

const clearQuitPromptFallback = (): void => {
  if (!quitPromptFallbackTimer) return
  clearTimeout(quitPromptFallbackTimer)
  quitPromptFallbackTimer = null
}

const quitWithoutPrompt = (): void => {
  clearQuitPromptFallback()
  isQuitConfirmed = true
  isQuitPromptOpen = false
  app.quit()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.yeeetsk.vibeboard')
  store = new VibeBoardStore()
  registerIpc()
  registerUpdaterEvents()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  setTimeout(() => {
    void checkForUpdates()
  }, 3000)

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

app.on('before-quit', (event) => {
  if (isQuitConfirmed) return
  event.preventDefault()
  requestQuitConfirmation()
})
