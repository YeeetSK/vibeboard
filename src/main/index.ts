import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { VibeBoardStore } from './database'
import { PlaceholderCursorAdapter, cursorInstallCommand } from './cursorAdapter'
import {
  cleanupTaskGitWorkspace,
  flushAllCursorProgress,
  runCursorTask,
  stopAllCursorTasks,
  stopCursorTask
} from './cursorRunner'
import { deleteTaskAttachments, saveTaskAttachments, withAttachmentDataUrls } from './attachments'
import type {
  CreateLaneInput,
  CreateProjectInput,
  CreateTabInput,
  CreateTaskInput,
  GetTaskDetailInput,
  MoveTaskInput,
  NotificationEventKey,
  NotificationSettings,
  Project,
  RecordSearchOpenInput,
  ReorderTabsInput,
  RenameInput,
  RunTaskResult,
  SearchWorkspaceInput,
  SendTaskMessageInput,
  Task,
  UpdateInfo,
  UpdateProjectRunModeInput,
  UpdateTabMetaInput,
  UpdateTaskStatusInput
} from '../shared/types'
import type { TaskStatusChangeEvent } from './database'

let store: VibeBoardStore
const cursorAdapter = new PlaceholderCursorAdapter()
const runningTasks = new Set<string>()
const runningTaskPromises = new Map<string, Promise<void>>()
const taskRunStartedAt = new Map<string, string>()
const cancelledTasks = new Set<string>()
const projectRunQueues = new Map<string, Promise<void>>()
const windows = new Set<BrowserWindow>()
const execFileAsync = promisify(execFile)
let isQuitConfirmed = false
let isQuitPromptOpen = false
let isShuttingDownAgents = false
let quitPromptFallbackTimer: NodeJS.Timeout | null = null
let lastRendererActivityAt = Date.now()
let updateInfo: UpdateInfo = {
  status: 'idle',
  mode: getUpdateMode(),
  currentVersion: app.getVersion(),
  latestVersion: null,
  message: 'Ready to check for updates.',
  progress: null,
  releaseUrl: null,
  releaseNotes: null
}

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

interface NotificationPayload {
  event: NotificationEventKey
  title: string
  body: string
  priority: 'default' | 'high'
  taskId?: string
}

const appUserModelId = 'com.yeeetsk.vibeboard'
const notificationTitle = 'VibeBoard 🌊'
const notificationInactivityMs = 2 * 60 * 1000

const formatNotificationBody = (payload: NotificationPayload): string =>
  payload.body ? `${payload.title}: ${payload.body}` : payload.title

const cleanupTasksGitWorkspace = async (
  entries: Array<{ task: Task; project: Project | null }>
): Promise<void> => {
  for (const entry of entries) {
    try {
      await cleanupTaskGitWorkspace(entry.task, entry.project)
    } catch (error) {
      console.warn('[VibeBoard] Failed to clean up task git workspace', {
        taskId: entry.task.id,
        branchName: entry.task.branchName,
        worktreePath: entry.task.worktreePath,
        error: error instanceof Error ? error.message : error
      })
    }
  }
}

app.setName('VibeBoard')
if (process.platform === 'win32') {
  app.setAppUserModelId(appUserModelId)
}

function getUpdateMode(): UpdateInfo['mode'] {
  if (is.dev) return 'dev'
  return 'auto'
}

function isDevUpdateMockEnabled(): boolean {
  return is.dev && process.env.VIBEBOARD_UPDATE_MOCK === '1'
}

const getMacAppBundlePath = (): string => path.resolve(path.dirname(process.execPath), '../..')

const isMacDeveloperIdSigned = async (): Promise<boolean> => {
  if (process.platform !== 'darwin' || !app.isPackaged) return false

  try {
    const appBundlePath = getMacAppBundlePath()
    const result = await execFileAsync('/usr/bin/codesign', ['-dv', '--verbose=4', appBundlePath])
    const output = `${result.stdout}\n${result.stderr}`
    return /Authority=Developer ID Application:/i.test(output) && /TeamIdentifier=/i.test(output)
  } catch {
    return false
  }
}

const shouldUseManualMacUpdates = async (): Promise<boolean> =>
  process.platform === 'darwin' && !(await isMacDeveloperIdSigned())

const manualMacUpdateMessage = (version: string | null): string =>
  version
    ? `Version ${version} is available. This macOS build is not Developer ID signed, so open GitHub and install the new DMG manually.`
    : 'This macOS build is not Developer ID signed, so automatic macOS updates are disabled.'

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
    trafficLightPosition: { x: 12, y: 14 },
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url)
    return { action: 'deny' }
  })
  windows.add(mainWindow)

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const registerIpc = (): void => {
  ipcMain.handle('state:get', () => {
    const state = store.getState()
    return {
      ...state,
      tasks: state.tasks.map((task) => ({
        ...task,
        runStartedAt: taskRunStartedAt.get(task.id) ?? null
      }))
    }
  })
  ipcMain.handle('task:detail', async (_event, input: GetTaskDetailInput) => {
    const detail = store.getTaskDetail(input)
    const conversations = await Promise.all(
      detail.conversations.map(async (entry) => ({
        ...entry,
        attachments: await withAttachmentDataUrls(entry.attachments)
      }))
    )
    return { ...detail, conversations }
  })
  ipcMain.handle('search:workspace', (_event, input: SearchWorkspaceInput) => store.searchWorkspace(input))
  ipcMain.handle('search:recordOpen', (_event, input: RecordSearchOpenInput) => store.recordSearchOpen(input))
  ipcMain.handle('project:create', (_event, input: CreateProjectInput) => store.createProject(input))
  ipcMain.handle('project:runMode', (_event, input: UpdateProjectRunModeInput) =>
    store.updateProjectRunMode(input.projectId, input.runMode)
  )
  ipcMain.handle('project:openFolder', async (_event, projectId: string) => {
    const project = store.getProject(projectId)
    if (!project) return
    const error = await shell.openPath(project.path)
    if (error) {
      throw new Error(error)
    }
  })
  ipcMain.handle('shell:openExternal', (_event, url: string) => openExternalUrl(url))
  ipcMain.handle('project:relocate', (_event, projectId: string) => store.relocateProject(projectId))
  ipcMain.handle('tab:create', (_event, input: CreateTabInput) => store.createTab(input))
  ipcMain.handle('tab:rename', (_event, input: RenameInput) => store.renameTab(input))
  ipcMain.handle('tab:updateMeta', (_event, input: UpdateTabMetaInput) => store.updateTabMeta(input))
  ipcMain.handle('tab:reorder', (_event, input: ReorderTabsInput) => store.reorderTabs(input))
  ipcMain.handle('tab:close', (_event, tabId: string) => store.closeTab(tabId))
  ipcMain.handle('tab:reopen', (_event, tabId: string) => store.reopenTab(tabId))
  ipcMain.handle('tab:delete', async (_event, tabId: string) => {
    await cleanupTasksGitWorkspace(store.listTasksForCleanup({ tabId }))
    store.deleteTab(tabId)
  })
  ipcMain.handle('tab:active', (_event, tabId: string) => store.setActiveTab(tabId))
  ipcMain.handle('lane:create', (_event, input: CreateLaneInput) => store.createLane(input))
  ipcMain.handle('lane:rename', (_event, input: RenameInput) => store.renameLane(input))
  ipcMain.handle('lane:delete', async (_event, laneId: string) => {
    await cleanupTasksGitWorkspace(store.listTasksForCleanup({ laneId }))
    store.deleteLane(laneId)
  })
  ipcMain.handle('task:create', (_event, input: CreateTaskInput) => {
    const task = store.createTask(input)
    return task
  })
  ipcMain.handle('task:rename', (_event, input: RenameInput) => store.renameTask(input))
  ipcMain.handle('task:move', (_event, input: MoveTaskInput) => store.moveTask(input))
  ipcMain.handle('task:delete', async (_event, taskId: string) => {
    await cleanupTasksGitWorkspace(store.listTasksForCleanup({ taskId }))
    const task = store.getState().tasks.find((item) => item.id === taskId)
    store.deleteTask(taskId)
    const stillExists = store.getState().tasks.some((item) => item.id === taskId)
    if (task && !stillExists) {
      await deleteTaskAttachments(taskId)
    }
  })
  ipcMain.handle('task:message', async (_event, input: SendTaskMessageInput) => {
    const attachments = await saveTaskAttachments(input.taskId, input.attachments)
    store.sendTaskMessage({
      taskId: input.taskId,
      content: input.content,
      attachments
    })
    return startCursorTask(input.taskId)
  })
  ipcMain.handle('task:runCursor', (_event, taskId: string) => startCursorTask(taskId))
  ipcMain.handle('task:retryPrompt', (_event, taskId: string) => retryTaskPrompt(taskId))
  ipcMain.handle('task:stop', async (_event, taskId: string) => {
    const wasStopped = await stopAndWaitForCursorTask(taskId)
    if (!wasStopped) {
      return { started: false, message: 'No running task to stop.' }
    }
    store.updateTaskStatus({ taskId, status: 'attention' })
    store.appendConversation(
      taskId,
      'system',
      'Task stopped. Retry keeps the saved conversation and focused project context.'
    )
    broadcastStateChanged()
    return { started: true, message: 'Task stopped.' }
  })
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
  ipcMain.handle('notifications:get', () => store.getNotificationSettings())
  ipcMain.handle('notifications:update', (_event, settings: NotificationSettings) =>
    store.updateNotificationSettings(settings)
  )
  ipcMain.handle('notifications:test', () =>
    sendConfiguredNotification(
      {
        event: 'taskCompleted',
        title: 'VibeBoard notification test',
        body: 'Notifications are configured.',
        priority: 'default'
      },
      { throwOnError: true, bypassActivityGate: true }
    )
  )
  ipcMain.on('app:userActivity', () => {
    lastRendererActivityAt = Date.now()
  })
  ipcMain.on('app:quitPromptShown', () => {
    clearQuitPromptFallback()
  })
  ipcMain.handle('app:confirmQuit', async () => {
    clearQuitPromptFallback()
    isQuitConfirmed = true
    isQuitPromptOpen = false
    await shutdownCursorAgentsForQuit()
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
      releaseUrl: null,
      releaseNotes: null
    })
  })

  autoUpdater.on('update-available', (info) => {
    setUpdateInfo({
      status: 'available',
      latestVersion: info.version,
      message: `Version ${info.version} is available.`,
      progress: null,
      releaseUrl: `https://github.com/YeeetSK/vibeboard/releases/tag/v${info.version}`,
      releaseNotes: readUpdaterReleaseNotes(info)
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    setUpdateInfo({
      status: 'not_available',
      latestVersion: info.version ?? app.getVersion(),
      message: 'VibeBoard is up to date.',
      progress: null,
      releaseUrl: null,
      releaseNotes: null
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setUpdateInfo({
      status: 'downloading',
      latestVersion: updateInfo.latestVersion,
      message: 'Downloading update.',
      progress: Math.round(progress.percent),
      releaseUrl: updateInfo.releaseUrl,
      releaseNotes: updateInfo.releaseNotes
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateInfo({
      status: 'downloaded',
      latestVersion: info.version,
      message: `Version ${info.version} is ready to install.`,
      progress: 100,
      releaseUrl: updateInfo.releaseUrl,
      releaseNotes: readUpdaterReleaseNotes(info) ?? updateInfo.releaseNotes
    })
  })

  autoUpdater.on('error', (error) => {
    setUpdateInfo({
      status: 'error',
      latestVersion: updateInfo.latestVersion,
      message: error.message,
      progress: null,
      releaseUrl: updateInfo.releaseUrl,
      releaseNotes: updateInfo.releaseNotes
    })
  })
}

const setUpdateInfo = (next: Partial<UpdateInfo>): UpdateInfo => {
  updateInfo = {
    ...updateInfo,
    ...next,
    mode: next.mode ?? getUpdateMode(),
    currentVersion: app.getVersion()
  }
  for (const window of windows) {
    window.webContents.send('updates:changed', updateInfo)
  }
  return updateInfo
}

const checkForUpdates = async (): Promise<UpdateInfo> => {
  if (is.dev) {
    if (isDevUpdateMockEnabled()) {
      return checkMockUpdateForDev()
    }
    return checkGithubReleaseMetadata('dev')
  }

  if (await shouldUseManualMacUpdates()) {
    return checkGithubReleaseMetadata('manual')
  }

  try {
    setUpdateInfo({
      status: 'checking',
      message: 'Checking for updates.',
      progress: null,
      releaseUrl: null,
      releaseNotes: null
    })
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setUpdateInfo({
      status: 'error',
      message: error instanceof Error ? error.message : 'Update check failed.',
      progress: null,
      releaseUrl: updateInfo.releaseUrl,
      releaseNotes: updateInfo.releaseNotes
    })
  }

  return updateInfo
}

const checkMockUpdateForDev = (): UpdateInfo => {
  const latestVersion = incrementPatchVersion(app.getVersion())
  return setUpdateInfo({
    status: 'available',
    mode: 'dev',
    latestVersion,
    message: `Dev update test v${latestVersion} is available.`,
    progress: null,
    releaseUrl: 'https://github.com/YeeetSK/vibeboard/releases',
    releaseNotes: [
      '## Dev update test',
      '',
      '- Simulates download progress inside npm run dev.',
      '- Simulates install completion without quitting Electron.',
      '- Use this to verify update banners and release notes locally.'
    ].join('\n')
  })
}

const checkGithubReleaseMetadata = async (mode: UpdateInfo['mode']): Promise<UpdateInfo> => {
  try {
    setUpdateInfo({
      status: 'checking',
      mode,
      latestVersion: null,
      message: 'Checking GitHub releases.',
      progress: null,
      releaseUrl: null,
      releaseNotes: null
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
          mode,
          latestVersion: null,
          message: 'GitHub release metadata is not public yet.',
          progress: null,
          releaseUrl: null,
          releaseNotes: null
        })
      }
      throw new Error(`GitHub returned ${response.status}`)
    }

    const release = (await response.json()) as {
      tag_name?: string
      html_url?: string
      body?: string
      prerelease?: boolean
    }
    const latestVersion = normalizeVersion(release.tag_name ?? '')
    if (!latestVersion) {
      throw new Error('Latest release has no version tag.')
    }

    if (compareVersions(latestVersion, app.getVersion()) > 0) {
      return setUpdateInfo({
        status: 'available',
        mode,
        latestVersion,
        message:
          mode === 'dev'
            ? `Version ${latestVersion} is available. Dev will simulate the update flow.`
            : mode === 'manual' && process.platform === 'darwin'
              ? manualMacUpdateMessage(latestVersion)
              : `Version ${latestVersion} is available. Ready to download.`,
        progress: null,
        releaseUrl: release.html_url ?? `https://github.com/YeeetSK/vibeboard/releases/tag/v${latestVersion}`,
        releaseNotes: release.body?.trim() || null
      })
    }

    return setUpdateInfo({
      status: 'not_available',
      mode,
      latestVersion,
      message: 'VibeBoard is up to date.',
      progress: null,
      releaseUrl: null,
      releaseNotes: null
    })
  } catch (error) {
    return setUpdateInfo({
      status: 'error',
      mode,
      latestVersion: null,
      message: error instanceof Error ? error.message : 'Update check failed.',
      progress: null,
      releaseUrl: null,
      releaseNotes: null
    })
  }
}

const downloadUpdate = async (): Promise<UpdateInfo> => {
  if (updateInfo.status !== 'available') return updateInfo

  if (is.dev) {
    return simulateDevUpdateDownload()
  }

  if (await shouldUseManualMacUpdates()) {
    if (updateInfo.releaseUrl) {
      await shell.openExternal(updateInfo.releaseUrl)
    }
    return setUpdateInfo({
      status: 'available',
      mode: 'manual',
      latestVersion: updateInfo.latestVersion,
      message: 'Opened the GitHub release. Download and install the new macOS DMG manually.',
      progress: null,
      releaseUrl: updateInfo.releaseUrl,
      releaseNotes: updateInfo.releaseNotes
    })
  }

  try {
    setUpdateInfo({
      status: 'downloading',
      mode: 'auto',
      message: 'Downloading update.',
      progress: 0,
      releaseUrl: updateInfo.releaseUrl,
      releaseNotes: updateInfo.releaseNotes
    })
    await autoUpdater.downloadUpdate()
  } catch (error) {
    setUpdateInfo({
      status: 'error',
      mode: getUpdateMode(),
      message: error instanceof Error ? error.message : 'Update download failed.',
      progress: null,
      releaseUrl: updateInfo.releaseUrl,
      releaseNotes: updateInfo.releaseNotes
    })
  }

  return updateInfo
}

const simulateDevUpdateDownload = async (): Promise<UpdateInfo> => {
  for (const progress of [0, 18, 34, 57, 76, 92, 100]) {
    setUpdateInfo({
      status: progress === 100 ? 'downloaded' : 'downloading',
      mode: 'dev',
      latestVersion: updateInfo.latestVersion,
      message: progress === 100 ? `Dev update v${updateInfo.latestVersion} is ready.` : 'Simulating update download.',
      progress,
      releaseUrl: updateInfo.releaseUrl,
      releaseNotes: updateInfo.releaseNotes
    })
    if (progress < 100) {
      await new Promise((resolve) => setTimeout(resolve, 180))
    }
  }
  return updateInfo
}

const installUpdate = (): UpdateInfo => {
  if (updateInfo.status !== 'downloaded') return updateInfo

  if (is.dev) {
    return setUpdateInfo({
      status: 'not_available',
      mode: 'dev',
      latestVersion: updateInfo.latestVersion,
      message: `Dev update v${updateInfo.latestVersion} installed.`,
      progress: 100,
      releaseUrl: updateInfo.releaseUrl,
      releaseNotes: updateInfo.releaseNotes
    })
  }

  setUpdateInfo({
    status: 'installing',
    mode: 'auto',
    message: 'Restarting to finish update.',
    progress: 100,
    releaseUrl: updateInfo.releaseUrl,
    releaseNotes: updateInfo.releaseNotes
  })
  isQuitConfirmed = true
  void shutdownCursorAgentsForQuit().finally(() => {
    autoUpdater.quitAndInstall(false, true)
  })
  return updateInfo
}

const openExternalUrl = async (url: string): Promise<void> => {
  try {
    const parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return
    await shell.openExternal(parsedUrl.toString())
  } catch {
    // Ignore malformed links from generated agent output.
  }
}

const readUpdaterReleaseNotes = (info: { releaseNotes?: unknown }): string | null => {
  const notes = info.releaseNotes
  if (typeof notes === 'string') return notes.trim() || null
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry === 'object' && 'note' in entry) {
          const note = (entry as { note?: unknown }).note
          return typeof note === 'string' ? note : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
      .trim() || null
  }
  return null
}

const normalizeVersion = (version: string): string => version.trim().replace(/^v/i, '')

const incrementPatchVersion = (version: string): string => {
  const parts = normalizeVersion(version).split('.').map((part) => Number.parseInt(part, 10) || 0)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  return parts.slice(0, 3).join('.')
}

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

const startCursorTask = (taskId: string): RunTaskResult => {
  if (runningTasks.has(taskId)) {
    return { started: false, message: 'Task is already running.' }
  }

  const context = store.getTaskRunContext(taskId)
  const effectiveRunMode = context?.task.runModeOverride ?? context?.project?.runMode ?? 'shared'
  const projectQueueKey = context?.project?.path && effectiveRunMode !== 'worktree' ? context.project.path : null
  const previousProjectRun = projectQueueKey ? projectRunQueues.get(projectQueueKey) : null
  const isRetry = context?.task.status === 'attention'

  cancelledTasks.delete(taskId)
  runningTasks.add(taskId)
  taskRunStartedAt.set(taskId, new Date().toISOString())

  if (isRetry) {
    store.appendConversation(taskId, 'system', 'Retrying with the saved task conversation and focused project context.')
  }

  if (previousProjectRun) {
    store.updateTaskStatus({ taskId, status: 'processing' })
    store.appendConversation(taskId, 'system', 'Queued behind another running task for this project.')
  }

  const run = async (): Promise<void> => {
    if (previousProjectRun) {
      await previousProjectRun.catch(() => undefined)
    }

    if (cancelledTasks.has(taskId)) {
      cancelledTasks.delete(taskId)
      store.updateTaskStatus({ taskId, status: 'attention' })
      return
    }

    await runCursorTask({
      taskId,
      store,
      onStateChanged: broadcastStateChanged
    })
  }

  const runPromise = run().finally(() => {
    runningTasks.delete(taskId)
    runningTaskPromises.delete(taskId)
    taskRunStartedAt.delete(taskId)
    if (projectQueueKey && projectRunQueues.get(projectQueueKey) === runPromise) {
      projectRunQueues.delete(projectQueueKey)
    }
    broadcastStateChanged()
  })

  runningTaskPromises.set(taskId, runPromise)

  if (projectQueueKey) {
    projectRunQueues.set(projectQueueKey, runPromise)
  }

  broadcastStateChanged()
  return previousProjectRun
    ? { started: true, message: 'Cursor agent queued for this project.' }
    : { started: true, message: 'Cursor agent started.' }
}

const stopAndWaitForCursorTask = async (taskId: string): Promise<boolean> => {
  const wasTracked = runningTasks.has(taskId) || runningTaskPromises.has(taskId)
  cancelledTasks.add(taskId)
  const stoppedProcess = stopCursorTask(taskId)
  const pending = runningTaskPromises.get(taskId)
  if (pending) {
    await pending.catch(() => undefined)
  }
  cancelledTasks.delete(taskId)
  return wasTracked || stoppedProcess
}

const retryTaskPrompt = async (taskId: string): Promise<RunTaskResult> => {
  const context = store.getTaskRunContext(taskId)
  if (!context) {
    return { started: false, message: 'Task not found.' }
  }
  if (!context.project) {
    return { started: false, message: 'Select a project before retrying this prompt.' }
  }

  const prompt = context.prompt.trim()
  if (!prompt) {
    return { started: false, message: 'No prompt available to retry.' }
  }

  const wasStopped = await stopAndWaitForCursorTask(taskId)
  store.updateTaskStatus({ taskId, status: 'idle' })
  store.appendConversation(
    taskId,
    'system',
    wasStopped
      ? 'Stopped the previous run and retrying the last prompt.'
      : 'Retrying the last prompt.'
  )
  store.sendTaskMessage({ taskId, content: prompt })
  broadcastStateChanged()
  return startCursorTask(taskId)
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

const openTaskFromNotification = (taskId: string): void => {
  const targetWindow = BrowserWindow.getAllWindows()[0]
  if (!targetWindow || targetWindow.webContents.isDestroyed()) return

  if (targetWindow.isMinimized()) {
    targetWindow.restore()
  }
  targetWindow.show()
  targetWindow.focus()
  targetWindow.webContents.send('notifications:opened', { taskId })
}

const normalizeNtfyServerUrl = (serverUrl: string): string =>
  (serverUrl.trim() || 'https://ntfy.sh').replace(/\/+$/, '')

const sendNtfyNotification = async (
  ntfy: NotificationSettings['ntfy'],
  payload: NotificationPayload
): Promise<void> => {
  const topic = ntfy.topic.trim()
  if (!topic) {
    throw new Error('ntfy.sh topic is empty')
  }

  const response = await fetch(normalizeNtfyServerUrl(ntfy.serverUrl), {
    method: 'POST',
    body: JSON.stringify({
      topic,
      title: notificationTitle,
      message: formatNotificationBody(payload),
      priority: payload.priority === 'high' ? 4 : 3,
      tags: ['vibeboard']
    }),
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`ntfy notification failed with ${response.status}`)
  }
}

const sendMacOsNotification = async (payload: NotificationPayload): Promise<void> => {
  await execFileAsync('osascript', [
    '-e',
    `display notification ${JSON.stringify(formatNotificationBody(payload))} with title ${JSON.stringify(notificationTitle)}`
  ])
}

const sendDesktopNotification = async (payload: NotificationPayload): Promise<void> => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: notificationTitle,
      body: formatNotificationBody(payload),
      silent: false
    })
    if (payload.taskId) {
      notification.on('click', () => openTaskFromNotification(payload.taskId!))
    }
    notification.show()
    return
  }

  if (process.platform === 'darwin') {
    await sendMacOsNotification(payload)
  }
}

const isUserActiveInApp = (): boolean =>
  BrowserWindow.getAllWindows().some((window) => window.isFocused()) &&
  Date.now() - lastRendererActivityAt < notificationInactivityMs

const sendConfiguredNotification = async (
  payload: NotificationPayload,
  options: { throwOnError?: boolean; bypassActivityGate?: boolean } = {}
): Promise<void> => {
  if (!options.bypassActivityGate && isUserActiveInApp()) {
    if (is.dev) {
      console.info('[VibeBoard notifications] skipped while app is active')
    }
    return
  }

  const settings = store.getNotificationSettings()
  const errors: string[] = []

  if (settings.desktopEnabled && settings.desktopEvents[payload.event]) {
    try {
      await sendDesktopNotification(payload)
    } catch (error) {
      if (process.platform === 'darwin' && !is.dev) {
        try {
          await sendMacOsNotification(payload)
        } catch (fallbackError) {
          errors.push(
            `Desktop: ${fallbackError instanceof Error ? fallbackError.message : 'notification failed'}`
          )
          if (is.dev) {
            console.error('[VibeBoard desktop notifications]', fallbackError)
          }
        }
      } else {
        errors.push(`Desktop: ${error instanceof Error ? error.message : 'notification failed'}`)
        if (is.dev) {
          console.error('[VibeBoard desktop notifications]', error)
        }
      }
    }
  }

  if (settings.ntfy.enabled && settings.ntfy.events[payload.event]) {
    try {
      await sendNtfyNotification(settings.ntfy, payload)
    } catch (error) {
      errors.push(`ntfy.sh: ${error instanceof Error ? error.message : 'notification failed'}`)
      if (is.dev) {
        console.error('[VibeBoard notifications]', error)
      }
    }
  }

  if (options.throwOnError && errors.length > 0) {
    throw new Error(errors.join(' / '))
  }
}

const handleTaskStatusChange = (event: TaskStatusChangeEvent): void => {
  const notifications: NotificationPayload[] = []
  const wasRunning = event.oldStatus === 'processing'
  const runningTaskCount = store.getRunningTaskCount()
  const runningTaskCountBeforeChange = runningTaskCount + (wasRunning && event.newStatus !== 'processing' ? 1 : 0)
  const isDone = event.newStatus === 'done_unread' || event.newStatus === 'done_read'

  if (!isDone && event.newStatus === 'attention') {
    notifications.push({
      event: 'taskFailed',
      title: 'Task needs attention',
      body: event.task.title,
      priority: 'high',
      taskId: event.task.id
    })
  }

  if (event.oldStatus !== 'done_unread' && event.oldStatus !== 'done_read' && isDone) {
    notifications.push({
      event: 'taskCompleted',
      title: 'Task completed',
      body: event.task.title,
      priority: 'default',
      taskId: event.task.id
    })
  }

  if (wasRunning && event.newStatus !== 'processing' && runningTaskCountBeforeChange > 1 && runningTaskCount === 0) {
    notifications.push({
      event: 'allTasksFinished',
      title: 'All tasks finished',
      body: 'No tasks are running.',
      priority: 'default'
    })
  }

  for (const notification of notifications) {
    void sendConfiguredNotification(notification)
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
  void shutdownCursorAgentsForQuit().finally(() => {
    app.quit()
  })
}

const shutdownCursorAgentsForQuit = async (): Promise<void> => {
  if (isShuttingDownAgents) return
  isShuttingDownAgents = true

  // Persist any buffered live progress before marking interruption.
  flushAllCursorProgress()

  // Flip processing → attention (red border) while status is still processing.
  const interruptedCount = store.recoverInterruptedProcessingTasks()
  if (interruptedCount > 0) {
    broadcastStateChanged()
  }

  stopAllCursorTasks()

  const pending = [...runningTaskPromises.values()]
  if (pending.length === 0) return

  await Promise.race([
    Promise.allSettled(pending),
    new Promise<void>((resolve) => {
      setTimeout(resolve, 2000)
    })
  ])
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId(appUserModelId)
  store = new VibeBoardStore()
  const recoveredCount = store.recoverInterruptedProcessingTasks()
  if (recoveredCount > 0) {
    console.info('[VibeBoard] Recovered interrupted processing tasks:', recoveredCount)
  }
  store.setTaskStatusListener(handleTaskStatusChange)
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
