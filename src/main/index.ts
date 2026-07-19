import { app, BrowserWindow, ipcMain, Menu, Notification, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { promisify } from 'node:util'
import { VibeBoardStore } from './database'
import {
  PlaceholderCursorAdapter,
  cursorInstallCommand,
  ensureWindowsAgentPath,
  windowsCursorAgentDir
} from './cursorAdapter'
import {
  agentCliDocsUrl,
  claudeUnixInstallCommand,
  claudeWindowsInstallCommand,
  codexNpmInstallCommand,
  getAgentCliSnapshot,
  invalidateAgentCliStatusCache,
  listActiveAgentModels,
  rememberedProvidersFromSnapshot,
  resolveProviderCommand
} from './agentCli'
import {
  bindNotchOverlayDeps,
  clearNotchFinishForTask,
  closeNotchRunningDetail,
  closeNotchRunningOverview,
  collapseNotchOverlay,
  destroyNotchOverlay,
  dismissNotchFinishChat,
  getNotchOverlayCapability,
  getNotchOverlaySnapshot,
  handleNotchOverlayStatusChange,
  isNotchOverlayWindow,
  demoteNotchOverlayForAppActivate,
  noteMainWindowShown,
  onMainAppFocused,
  openNotchDoneOverview,
  openNotchRunningOverview,
  openTaskFromNotch,
  peekNotchOverlay,
  purgeNotchOverlays,
  reopenNotchFinishChat,
  parkNotchFinishChat,
  scheduleDevNotchFinishTest,
  scheduleDevNotchRunningTest,
  selectNotchRunningTask,
  sendReplyFromNotch,
  updateNotchQueuedMessage,
  removeNotchQueuedMessage,
  setNotchOverlayMousePassthrough,
  syncNotchOverlay,
  syncNotchIfEnabled,
  unparkNotchFinishChat
} from './notch'
import {
  bindKeyboardAlertDeps,
  clearKeyboardAlertFlashForTask,
  destroyKeyboardAlertFlash,
  getKeyboardAlertCapability,
  handleKeyboardAlertForStatus,
  pauseKeyboardAlertFlashForTask,
  resumeKeyboardAlertFlashIfNeeded,
  stopKeyboardAlertFlashIfNeededOnFocus,
  testKeyboardAlertFlash
} from './keyboardBacklight'
import {
  cleanupTaskGitWorkspace,
  ensureProjectMemoryGitignoredForRoots,
  flushAllCursorProgress,
  readTaskWorkspaceFile,
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
  AppearanceSettings,
  AgentCliId,
  AgentCliSettings,
  NotchOverlaySettings,
  KeyboardAlertSettings,
  Project,
  QueuedTaskMessage,
  RecordSearchOpenInput,
  ReorderTabsInput,
  RenameInput,
  RunTaskResult,
  SearchWorkspaceInput,
  SendTaskMessageInput,
  Task,
  UpdateInfo,
  UpdateProjectAutoMoveInput,
  UpdateProjectRunModeInput,
  UpdateTabMetaInput,
  UpdateTaskModelInput,
  UpdateTaskStatusInput
} from '../shared/types'
import type { TaskStatusChangeEvent } from './database'

let store: VibeBoardStore
const cursorAdapter = new PlaceholderCursorAdapter()
const runningTasks = new Set<string>()
const runningTaskPromises = new Map<string, Promise<void>>()
const cancelledTasks = new Set<string>()
const projectRunQueues = new Map<string, Promise<void>>()
const taskMessageQueues = new Map<string, QueuedTaskMessage[]>()
const windows = new Set<BrowserWindow>()
const execFileAsync = promisify(execFile)
let isQuitConfirmed = false
let isQuitPromptOpen = false
let isShuttingDownAgents = false
/** Gates notch overlay until the main window has shown at least once. */
let mainWindowHasShown = false
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

// Keep Chromium on sRGB so a notch panel doesn't tone-map / mute the whole display.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('force-color-profile', 'srgb')
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })
}

function getMainBrowserWindow(): BrowserWindow | null {
  for (const window of windows) {
    if (!window.isDestroyed() && !isNotchOverlayWindow(window)) return window
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !isNotchOverlayWindow(window)) return window
  }
  return null
}

function revealMainWindow(targetWindow: BrowserWindow): void {
  if (targetWindow.isDestroyed()) return
  if (targetWindow.isMinimized()) targetWindow.restore()
  // Show first, then maximize. Maximize-while-hidden is flaky on macOS and can
  // leave the board "running" in the dock with nothing on screen.
  if (!targetWindow.isVisible()) targetWindow.show()
  if (!targetWindow.isMaximized()) targetWindow.maximize()
  try {
    targetWindow.setOpacity(1)
  } catch {
    // ignore
  }
  targetWindow.moveTop()
  targetWindow.focus()
  if (process.platform === 'darwin') {
    app.focus({ steal: true })
    try {
      app.dock?.show()
    } catch {
      // ignore
    }
  }
  const firstShow = !mainWindowHasShown
  mainWindowHasShown = true
  // Launch grace only on first reveal - not every dock re-focus.
  if (firstShow) noteMainWindowShown()
}

function focusMainWindow(): void {
  // Notch panel first out of the way - otherwise dock activation lands on the
  // overlay and the board never comes forward (needs a second dock click).
  demoteNotchOverlayForAppActivate()

  const targetWindow = getMainBrowserWindow()
  if (!targetWindow) {
    if (app.isReady()) createWindow()
    return
  }
  revealMainWindow(targetWindow)
  onMainAppFocused()
  stopKeyboardAlertFlashIfNeededOnFocus()
}

function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(process.cwd(), 'build', 'icon.png')
  ]
  for (const iconPath of candidates) {
    if (!existsSync(iconPath)) continue
    app.dock.setIcon(iconPath)
    return
  }
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
  const isMac = process.platform === 'darwin'
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    title: 'VibeBoard',
    backgroundColor: '#111111',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    show: false,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 12, y: 14 }
        }
      : {
          frame: false,
          autoHideMenuBar: true
        }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const revealOnce = (): void => {
    if (mainWindow.isDestroyed()) return
    // Keep notch dark while the board claims the screen.
    demoteNotchOverlayForAppActivate()
    revealMainWindow(mainWindow)
    onMainAppFocused()
  }

  mainWindow.once('ready-to-show', () => {
    revealOnce()
  })
  // ready-to-show can stall; never leave the dock bouncing with no window.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) revealOnce()
    }, 50)
  })
  setTimeout(() => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) revealOnce()
  }, 2500)
  mainWindow.on('focus', () => {
    // Dismiss only - do not re-enter sync (avoids flash mid-retract).
    if (store.getNotchOverlaySettings().enabled) onMainAppFocused()
    stopKeyboardAlertFlashIfNeededOnFocus()
  })
  mainWindow.on('blur', () => {
    // Defer slightly so macOS has resigned active - otherwise launch-grace
    // still thinks we're frontmost and keeps the notch dark on first leave.
    setTimeout(() => {
      if (!mainWindow.isDestroyed() && !mainWindow.isFocused()) {
        syncNotchIfEnabled()
      }
    }, 40)
    // Resume keyboard flash if something still needs you while you're in another app.
    resumeKeyboardAlertFlashIfNeeded()
  })
  mainWindow.on('show', () => {
    if (store.getNotchOverlaySettings().enabled) onMainAppFocused()
  })
  mainWindow.on('hide', () => {
    syncNotchIfEnabled()
    resumeKeyboardAlertFlashIfNeeded()
  })
  mainWindow.on('minimize', () => {
    syncNotchIfEnabled()
    resumeKeyboardAlertFlashIfNeeded()
  })
  mainWindow.on('restore', () => {
    // Restoring is coming back to the board - focus path, not notch sync.
    if (store.getNotchOverlaySettings().enabled) onMainAppFocused()
  })
  const sendMaximizedChanged = (): void => {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', sendMaximizedChanged)
  mainWindow.on('unmaximize', sendMaximizedChanged)
  mainWindow.on('close', (event) => {
    if (isQuitConfirmed) return
    event.preventDefault()
    requestQuitConfirmation()
  })
  mainWindow.on('closed', () => {
    windows.delete(mainWindow)
    // Never leave a notch panel alive as the only remaining window.
    if ([...windows].every((window) => window.isDestroyed())) {
      destroyNotchOverlay()
    }
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
        queuedMessages: taskMessageQueues.get(task.id) ?? []
      }))
    }
  })
  ipcMain.handle('task:detail', async (_event, input: GetTaskDetailInput) => {
    // Pause flash while viewing; resumes on blur if the task still needs you.
    pauseKeyboardAlertFlashForTask(input.taskId)
    const runContext = store.getTaskRunContext(input.taskId)
    if (runContext?.project) {
      // Keep local project memory out of commits whenever a task is opened.
      void ensureProjectMemoryGitignoredForRoots(runContext.project.path, runContext.task.worktreePath)
    }
    const detail = store.getTaskDetail(input)
    const conversations = await Promise.all(
      detail.conversations.map(async (entry) => ({
        ...entry,
        attachments: await withAttachmentDataUrls(entry.attachments)
      }))
    )
    return { ...detail, conversations }
  })
  ipcMain.handle(
    'task:readWorkspaceFile',
    (_event, input: { taskId: string; filePath: string }) =>
      readTaskWorkspaceFile(store, input.taskId, input.filePath)
  )
  ipcMain.handle('search:workspace', (_event, input: SearchWorkspaceInput) => store.searchWorkspace(input))
  ipcMain.handle('search:recordOpen', (_event, input: RecordSearchOpenInput) => store.recordSearchOpen(input))
  ipcMain.handle('project:create', (_event, input: CreateProjectInput) => store.createProject(input))
  ipcMain.handle('project:runMode', (_event, input: UpdateProjectRunModeInput) =>
    store.updateProjectRunMode(input.projectId, input.runMode)
  )
  ipcMain.handle('project:autoMove', (_event, input: UpdateProjectAutoMoveInput) =>
    store.updateProjectAutoMove(input.projectId, input.autoMoveTasks)
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
  ipcMain.handle('tab:close', (_event, tabId: string) => {
    store.closeTab(tabId)
    // Notch counts ignore closed tabs - refresh immediately.
    syncNotchIfEnabled()
  })
  ipcMain.handle('tab:reopen', (_event, tabId: string) => {
    store.reopenTab(tabId)
    syncNotchIfEnabled()
  })
  ipcMain.handle('tab:delete', async (_event, tabId: string) => {
    await cleanupTasksGitWorkspace(store.listTasksForCleanup({ tabId }))
    store.deleteTab(tabId)
    syncNotchIfEnabled()
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
    const cleanupEntries = store.listTasksForCleanup({ taskId })
    const task = store.getState().tasks.find((item) => item.id === taskId)
    if (!task) return { ok: true as const }
    if (task.status === 'processing') {
      throw new Error('Can’t delete a running task.')
    }

    clearTaskMessageQueue(taskId)
    store.deleteTask(taskId)
    const stillExists = store.getState().tasks.some((item) => item.id === taskId)
    if (stillExists) {
      throw new Error('Couldn’t delete this task.')
    }

    // Return immediately so the board can update; git/attachments cleanup is background work.
    broadcastStateChanged()
    void (async () => {
      try {
        await cleanupTasksGitWorkspace(cleanupEntries)
        await deleteTaskAttachments(taskId)
      } catch (error) {
        console.warn('[VibeBoard] Failed to clean up deleted task assets', {
          taskId,
          error: error instanceof Error ? error.message : error
        })
      }
    })()

    return { ok: true as const }
  })
  ipcMain.handle('task:model', (_event, input: UpdateTaskModelInput) => {
    store.updateTaskModel(input.taskId, input.model)
  })
  ipcMain.handle('task:message', async (_event, input: SendTaskMessageInput) => {
    return sendTaskMessageAndMaybeRun(input)
  })
  ipcMain.handle(
    'task:queuedUpdate',
    (_event, input: { taskId: string; messageId: string; content: string }) => {
      if (input.taskId.startsWith('dev-running-')) {
        return updateNotchQueuedMessage(input.taskId, input.messageId, input.content)
      }
      return updateQueuedTaskMessage(input.taskId, input.messageId, input.content)
    }
  )
  ipcMain.handle(
    'task:queuedDelete',
    (_event, input: { taskId: string; messageId: string }) => {
      if (input.taskId.startsWith('dev-running-')) {
        return removeNotchQueuedMessage(input.taskId, input.messageId)
      }
      return removeQueuedTaskMessage(input.taskId, input.messageId)
    }
  )
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
  ipcMain.handle('task:read', (_event, taskId: string) => {
    store.markTaskRead(taskId)
    // Viewing in the board consumes the finish nudge - don't replay it on the notch later.
    clearNotchFinishForTask(taskId)
    // Marked read: permanently clear keyboard alert for this task.
    clearKeyboardAlertFlashForTask(taskId)
  })
  ipcMain.handle('cursor:status', () => cursorAdapter.status())
  ipcMain.handle('agentCli:getSettings', () => store.getAgentCliSettings())
  ipcMain.handle('agentCli:updateSettings', (_event, settings: Partial<AgentCliSettings>) =>
    store.updateAgentCliSettings(settings)
  )
  ipcMain.handle('agentCli:snapshot', async (_event, options?: { fresh?: boolean; source?: 'remembered' | 'live' }) => {
    const settings = store.getAgentCliSettings()
    if (options?.source === 'remembered') {
      return getAgentCliSnapshot(settings, { source: 'remembered' })
    }
    const shouldProbe = Boolean(options?.fresh || options?.source === 'live')
    if (shouldProbe) invalidateAgentCliStatusCache()
    const snapshot = await getAgentCliSnapshot(settings, {
      ...options,
      fresh: shouldProbe || options?.fresh
    })
    // Persist live probe results so the next launch paints instantly.
    if (shouldProbe) {
      store.rememberAgentCliProviders(rememberedProvidersFromSnapshot(snapshot))
    }
    return snapshot
  })
  ipcMain.handle('cursor:listModels', async () => {
    const active = store.getAgentCliSettings().activeCli
    return listActiveAgentModels(active)
  })
  ipcMain.handle('cursor:installCli', async () => {
    invalidateAgentCliStatusCache('cursor')
    return cursorAdapter.installCli()
  })
  ipcMain.handle('cursor:installTerminal', () => openCursorInstallTerminal())
  ipcMain.handle('cursor:setup', () => openCursorSetup())
  ipcMain.handle('agentCli:openSetup', (_event, id: AgentCliId) => openAgentCliSetup(id))
  ipcMain.handle('updates:get', () => updateInfo)
  ipcMain.handle('updates:check', () => checkForUpdates())
  ipcMain.handle('updates:download', () => downloadUpdate())
  ipcMain.handle('updates:install', () => installUpdate())
  ipcMain.handle('notifications:get', () => store.getNotificationSettings())
  ipcMain.handle('notifications:update', (_event, settings: NotificationSettings) =>
    store.updateNotificationSettings(settings)
  )
  ipcMain.handle('appearance:get', () => store.getAppearanceSettings())
  ipcMain.handle('appearance:update', (_event, settings: AppearanceSettings) =>
    store.updateAppearanceSettings(settings)
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
  ipcMain.handle('notifications:previewFinishSound', () => {
    playTaskFinishedSound()
  })
  ipcMain.handle('notch:capability', () => getNotchOverlayCapability())
  ipcMain.handle('notch:getSettings', () => store.getNotchOverlaySettings())
  ipcMain.handle('notch:updateSettings', (_event, settings: NotchOverlaySettings) => {
    const next = store.updateNotchOverlaySettings(settings)
    // Enabled off → purge; other toggles are applied inside sync (finish chat, etc.).
    syncNotchOverlay()
    return next
  })
  ipcMain.handle('keyboardAlert:capability', () => getKeyboardAlertCapability())
  ipcMain.handle('keyboardAlert:getSettings', () => store.getKeyboardAlertSettings())
  ipcMain.handle('keyboardAlert:updateSettings', (_event, settings: KeyboardAlertSettings) =>
    store.updateKeyboardAlertSettings(settings)
  )
  ipcMain.handle('keyboardAlert:test', () => testKeyboardAlertFlash())
  ipcMain.handle('notch:getSnapshot', () => getNotchOverlaySnapshot())
  ipcMain.handle('notch:openTask', (_event, taskId: string) => {
    openTaskFromNotch(taskId)
  })
  ipcMain.handle('notch:collapse', () => {
    collapseNotchOverlay()
  })
  ipcMain.handle('notch:peek', () => {
    peekNotchOverlay()
  })
  ipcMain.handle('notch:dismiss', (_event, options?: { force?: boolean }) =>
    dismissNotchFinishChat(options)
  )
  ipcMain.handle('notch:reopen', () => reopenNotchFinishChat())
  ipcMain.handle('notch:openRunningOverview', () => openNotchRunningOverview())
  ipcMain.handle('notch:openDoneOverview', () => openNotchDoneOverview())
  ipcMain.handle('notch:closeRunningOverview', () => closeNotchRunningOverview())
  ipcMain.handle('notch:selectRunningTask', (_event, taskId: string) =>
    selectNotchRunningTask(taskId)
  )
  ipcMain.handle('notch:closeRunningDetail', () => closeNotchRunningDetail())
  ipcMain.handle(
    'notch:queuedUpdate',
    (_event, input: { taskId: string; messageId: string; content: string }) =>
      updateNotchQueuedMessage(input.taskId, input.messageId, input.content)
  )
  ipcMain.handle(
    'notch:queuedDelete',
    (_event, input: { taskId: string; messageId: string }) =>
      removeNotchQueuedMessage(input.taskId, input.messageId)
  )
  ipcMain.handle('notch:unpark', () => unparkNotchFinishChat())
  ipcMain.handle('notch:park', () => parkNotchFinishChat())
  ipcMain.handle('notch:devFinishTest', (_event, delayMs?: number) => {
    if (!is.dev) return { ok: false as const, reason: 'Dev only' }
    if (process.platform !== 'darwin') {
      return { ok: false as const, reason: 'Notch finish test is only available on macOS.' }
    }
    const current = store.getNotchOverlaySettings()
    if (!current.enabled) {
      store.updateNotchOverlaySettings({ ...current, enabled: true, showFinishChat: true })
      syncNotchOverlay()
    }
    const ok = scheduleDevNotchFinishTest(
      typeof delayMs === 'number' && Number.isFinite(delayMs) ? delayMs : undefined
    )
    return { ok, delayMs: 1500 }
  })
  ipcMain.handle('notch:devRunningTest', (_event, delayMs?: number) => {
    if (!is.dev) return { ok: false as const, reason: 'Dev only' }
    if (process.platform !== 'darwin') {
      return { ok: false as const, reason: 'Notch running test is only available on macOS.' }
    }
    const current = store.getNotchOverlaySettings()
    if (!current.enabled) {
      store.updateNotchOverlaySettings({ ...current, enabled: true })
      syncNotchOverlay()
    }
    const ok = scheduleDevNotchRunningTest(
      typeof delayMs === 'number' && Number.isFinite(delayMs) ? delayMs : undefined
    )
    return { ok, delayMs: 0 }
  })
  ipcMain.on('notch:mousePassthrough', (_event, passthrough: boolean) => {
    setNotchOverlayMousePassthrough(Boolean(passthrough))
  })
  ipcMain.handle('notch:sendReply', async (_event, input: { taskId: string; content: string }) => {
    await sendReplyFromNotch(input.taskId, input.content)
  })
  ipcMain.handle('onboarding:getComplete', () => store.getOnboardingComplete())
  ipcMain.handle('onboarding:markComplete', () => {
    store.markOnboardingComplete()
    broadcastStateChanged()
  })
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
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
    destroyNotchOverlay()
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
  destroyNotchOverlay()
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

const hasQueuedTaskMessages = (taskId: string): boolean =>
  (taskMessageQueues.get(taskId)?.length ?? 0) > 0

const hasAnyQueuedTaskMessages = (): boolean => {
  for (const queue of taskMessageQueues.values()) {
    if (queue.length > 0) return true
  }
  return false
}

const enqueueTaskMessage = (
  taskId: string,
  content: string,
  attachments: QueuedTaskMessage['attachments']
): QueuedTaskMessage => {
  const queued: QueuedTaskMessage = {
    id: randomUUID(),
    content: content.trim(),
    attachments
  }
  const queue = taskMessageQueues.get(taskId) ?? []
  queue.push(queued)
  taskMessageQueues.set(taskId, queue)
  return queued
}

const shiftQueuedTaskMessage = (taskId: string): QueuedTaskMessage | null => {
  const queue = taskMessageQueues.get(taskId)
  if (!queue || queue.length === 0) return null
  const next = queue.shift()!
  if (queue.length === 0) {
    taskMessageQueues.delete(taskId)
  } else {
    taskMessageQueues.set(taskId, queue)
  }
  return next
}

const clearTaskMessageQueue = (taskId: string): void => {
  taskMessageQueues.delete(taskId)
}

const updateQueuedTaskMessage = (
  taskId: string,
  messageId: string,
  content: string
): boolean => {
  const trimmed = content.trim()
  if (!trimmed) return false
  const queue = taskMessageQueues.get(taskId)
  if (!queue) return false
  const item = queue.find((entry) => entry.id === messageId)
  if (!item) return false
  item.content = trimmed
  broadcastStateChanged()
  return true
}

const removeQueuedTaskMessage = (taskId: string, messageId: string): boolean => {
  const queue = taskMessageQueues.get(taskId)
  if (!queue) return false
  const next = queue.filter((entry) => entry.id !== messageId)
  if (next.length === queue.length) return false
  if (next.length === 0) {
    taskMessageQueues.delete(taskId)
  } else {
    taskMessageQueues.set(taskId, next)
  }
  broadcastStateChanged()
  return true
}

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

const sendTaskMessageAndMaybeRun = async (input: SendTaskMessageInput): Promise<RunTaskResult> => {
  const task = store.getState().tasks.find((item) => item.id === input.taskId)
  if (!task) {
    throw new Error('Task no longer exists.')
  }
  const attachments = await saveTaskAttachments(input.taskId, input.attachments)
  if (runningTasks.has(input.taskId)) {
    enqueueTaskMessage(input.taskId, input.content, attachments)
    broadcastStateChanged()
    return { started: true, message: 'Message queued. It will send when the current run finishes.' }
  }
  store.sendTaskMessage({
    taskId: input.taskId,
    content: input.content,
    attachments
  })
  return startCursorTask(input.taskId)
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
  store.setTaskRunStartedAt(taskId, new Date().toISOString())

  if (isRetry) {
    store.appendConversation(taskId, 'system', 'Retrying with the saved task conversation and focused project context.')
  }

  if (previousProjectRun) {
    store.updateTaskStatus({ taskId, status: 'processing' })
    store.appendConversation(taskId, 'system', 'Queued behind another running task for this project.')
  }

  const runQueuedFollowUps = async (): Promise<void> => {
    while (!cancelledTasks.has(taskId) && hasQueuedTaskMessages(taskId)) {
      const task = store.getState().tasks.find((item) => item.id === taskId)
      // Setup failures and stops land on attention; keep remaining queue visible but do not auto-run.
      if (!task || task.status === 'attention') break

      const next = shiftQueuedTaskMessage(taskId)
      if (!next) break

      store.sendTaskMessage({
        taskId,
        content: next.content,
        attachments: next.attachments
      })
      store.appendConversation(taskId, 'system', 'Sending next queued message.')
      broadcastStateChanged()

      await runCursorTask({
        taskId,
        store,
        onStateChanged: broadcastStateChanged,
        shouldContinue: () => hasQueuedTaskMessages(taskId)
      })
    }
  }

  const run = async (): Promise<void> => {
    if (previousProjectRun) {
      await previousProjectRun.catch(() => undefined)
    }

    if (cancelledTasks.has(taskId)) {
      cancelledTasks.delete(taskId)
      clearTaskMessageQueue(taskId)
      store.updateTaskStatus({ taskId, status: 'attention' })
      return
    }

    await runCursorTask({
      taskId,
      store,
      onStateChanged: broadcastStateChanged,
      shouldContinue: () => hasQueuedTaskMessages(taskId)
    })

    await runQueuedFollowUps()
  }

  const runPromise = run().finally(() => {
    runningTasks.delete(taskId)
    runningTaskPromises.delete(taskId)
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
  if (wasTracked) {
    clearTaskMessageQueue(taskId)
  }
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

const openAgentCliSetup = async (id: AgentCliId): Promise<void> => {
  invalidateAgentCliStatusCache(id)
  switch (id) {
    case 'cursor':
      await openCursorInstallTerminal()
      return
    case 'claude':
      await openClaudeSetupTerminal()
      return
    case 'codex':
      await openCodexSetupTerminal()
      return
  }
}

const openCursorInstallTerminal = async (): Promise<void> => {
  if (process.platform === 'win32') {
    ensureWindowsAgentPath()
    const agentDir = windowsCursorAgentDir().replace(/'/g, "''")
    const psScript = `
$ErrorActionPreference = 'Continue'
$agentDir = '${agentDir}'
if ($env:PATH -notlike "*$agentDir*") { $env:PATH = "$agentDir;" + $env:PATH }
if (-not (Test-Path (Join-Path $agentDir 'agent.exe'))) {
  Write-Host 'Installing Cursor Agent...'
  irm 'https://cursor.com/install?win32=true' | iex
  if ($env:PATH -notlike "*$agentDir*") { $env:PATH = "$agentDir;" + $env:PATH }
}
Write-Host ''
Write-Host 'Sign in to Cursor Agent (a browser window should open).'
Write-Host 'If nothing opens, copy any URL printed below into your browser.'
Write-Host ''
$agentExe = Join-Path $agentDir 'agent.exe'
if (Test-Path $agentExe) { & $agentExe login } else { agent login }
Write-Host ''
if (Test-Path $agentExe) { & $agentExe status } else { agent status }
Write-Host ''
Write-Host 'Done. Return to VibeBoard. It will reconnect automatically.'
Read-Host 'Press Enter to close'
`.trim()
    await openWindowsPowerShell(psScript)
    return
  }

  const command = [
    'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
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
  await openUnixTerminalScript(command, agentCliDocsUrl('cursor'))
}

const openClaudeSetupTerminal = async (): Promise<void> => {
  if (process.platform === 'win32') {
    const psScript = `
$ErrorActionPreference = 'Continue'
$localBin = Join-Path $env:USERPROFILE '.local\\bin'
$npmBin = Join-Path $env:APPDATA 'npm'
function Refresh-SessionPath {
  $user = [Environment]::GetEnvironmentVariable('PATH', 'User')
  $machine = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
  $env:PATH = "$localBin;$npmBin;$user;$machine"
}
Refresh-SessionPath
$claudeExe = Join-Path $localBin 'claude.exe'
if (-not (Test-Path $claudeExe) -and -not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing Claude Code CLI...'
  ${claudeWindowsInstallCommand}
  Refresh-SessionPath
}
if (Test-Path $claudeExe) {
  $claude = $claudeExe
} elseif (Get-Command claude -ErrorAction SilentlyContinue) {
  $claude = (Get-Command claude).Source
} else {
  Write-Host 'Claude CLI was not found after install. Open the docs, then try again.'
  Start-Process '${agentCliDocsUrl('claude')}'
  Read-Host 'Press Enter to close'
  exit 1
}
Write-Host ''
Write-Host 'Sign in to Claude Code (a browser window should open).'
Write-Host ''
& $claude auth login
Write-Host ''
& $claude auth status
Write-Host ''
Write-Host 'Done. Return to VibeBoard. It will reconnect automatically.'
Read-Host 'Press Enter to close'
`.trim()
    await openWindowsPowerShell(psScript)
    return
  }

  const command = [
    'export PATH="$HOME/.local/bin:$HOME/.claude/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"',
    'if ! command -v claude >/dev/null 2>&1; then',
    `  echo "Installing Claude Code CLI..."`,
    `  ${claudeUnixInstallCommand}`,
    'fi',
    'echo "Claude Code login"',
    'claude auth login',
    'echo',
    'claude auth status',
    'echo',
    'echo "Done. Return to VibeBoard."',
    'read -k 1 "?Press any key to close."'
  ].join('; ')
  await openUnixTerminalScript(command, agentCliDocsUrl('claude'))
}

const openCodexSetupTerminal = async (): Promise<void> => {
  const existing = await resolveProviderCommand('codex')
  const chatGptBundle =
    process.platform === 'darwin' && existsSync('/Applications/ChatGPT.app/Contents/Resources/codex')
      ? '/Applications/ChatGPT.app/Contents/Resources/codex'
      : null
  const codexBin = existing ?? chatGptBundle ?? 'codex'

  if (process.platform === 'win32') {
    const psScript = `
$ErrorActionPreference = 'Continue'
$localBin = Join-Path $env:USERPROFILE '.local\\bin'
$npmBin = Join-Path $env:APPDATA 'npm'
function Refresh-SessionPath {
  $user = [Environment]::GetEnvironmentVariable('PATH', 'User')
  $machine = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
  $env:PATH = "$localBin;$npmBin;$user;$machine"
}
Refresh-SessionPath
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js/npm is required to install Codex CLI on Windows.'
    Write-Host 'Install Node.js LTS, reopen this window, then click Install again.'
    Start-Process 'https://nodejs.org/en/download'
    Read-Host 'Press Enter to close'
    exit 1
  }
  Write-Host 'Installing Codex CLI via npm...'
  ${codexNpmInstallCommand}
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'npm install failed. See errors above, or read the Codex docs.'
    Start-Process '${agentCliDocsUrl('codex')}'
    Read-Host 'Press Enter to close'
    exit 1
  }
  Refresh-SessionPath
}
$codexCmd = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codexCmd) {
  Write-Host 'Codex CLI was not found after install.'
  Start-Process '${agentCliDocsUrl('codex')}'
  Read-Host 'Press Enter to close'
  exit 1
}
Write-Host ''
Write-Host 'Sign in to Codex (ChatGPT or API key).'
Write-Host ''
& $codexCmd.Source login
Write-Host ''
& $codexCmd.Source login status
Write-Host ''
Write-Host 'Done. Return to VibeBoard. It will reconnect automatically.'
Read-Host 'Press Enter to close'
`.trim()
    await openWindowsPowerShell(psScript)
    return
  }

  // Prefer ChatGPT.app when present; otherwise install the npm Codex CLI.
  if (process.platform === 'darwin' && !existing && !chatGptBundle) {
    void shell.openExternal('https://chatgpt.com/download')
  }

  const quotedBin = JSON.stringify(codexBin)
  const command = [
    'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
    `CODEX_BIN=${quotedBin}`,
    'if [ ! -x "$CODEX_BIN" ] && ! command -v codex >/dev/null 2>&1; then',
    '  echo "Installing Codex CLI via npm..."',
    `  ${codexNpmInstallCommand}`,
    '  CODEX_BIN="$(command -v codex)"',
    'elif command -v codex >/dev/null 2>&1; then',
    '  CODEX_BIN="$(command -v codex)"',
    'fi',
    'echo "Codex login"',
    'echo "Sign in with ChatGPT or an API key when prompted."',
    '"$CODEX_BIN" login',
    'echo',
    '"$CODEX_BIN" login status',
    'echo',
    'echo "Done. Return to VibeBoard."',
    'read -k 1 "?Press any key to close."'
  ].join('; ')
  await openUnixTerminalScript(command, agentCliDocsUrl('codex'))
}

const openWindowsPowerShell = async (psScript: string): Promise<void> => {
  // Write a temp .ps1 so multiline if-blocks and installers are reliable
  // (long -Command strings break quoting / length limits on Windows).
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vibeboard-cli-setup-'))
  const scriptPath = path.join(dir, 'setup.ps1')
  writeFileSync(scriptPath, `\uFEFF${psScript}\r\n`, 'utf8')

  // Empty title ("") is required so `start` does not treat powershell.exe as the window title.
  spawn(
    'cmd.exe',
    [
      '/c',
      'start',
      '""',
      'powershell.exe',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }
  ).unref()
}

const openUnixTerminalScript = async (command: string, docsUrl: string): Promise<void> => {
  if (process.platform === 'darwin') {
    await execFileAsync('osascript', [
      '-e',
      `tell application "Terminal" to do script ${JSON.stringify(command)}`
    ])
    await execFileAsync('osascript', ['-e', 'tell application "Terminal" to activate'])
    return
  }

  const linuxTerminals: Array<{ bin: string; args: string[] }> = [
    { bin: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', `${command}; exec bash`] },
    { bin: 'gnome-terminal', args: ['--', 'bash', '-lc', `${command}; exec bash`] },
    { bin: 'konsole', args: ['-e', 'bash', '-lc', `${command}; exec bash`] },
    { bin: 'xterm', args: ['-e', 'bash', '-lc', `${command}; exec bash`] }
  ]
  for (const terminal of linuxTerminals) {
    try {
      spawn(terminal.bin, terminal.args, { detached: true, stdio: 'ignore' }).unref()
      return
    } catch {
      // try next
    }
  }

  await shell.openExternal(docsUrl)
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
  // Notch is optional: only sync when enabled so board updates stay lightweight.
  syncNotchIfEnabled()
}

const openTaskFromNotification = (taskId: string): void => {
  pauseKeyboardAlertFlashForTask(taskId)
  focusMainWindow()
  const targetWindow = getMainBrowserWindow()
  if (!targetWindow || targetWindow.webContents.isDestroyed()) return
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
  [...windows].some((window) => !window.isDestroyed() && window.isFocused()) &&
  Date.now() - lastRendererActivityAt < notificationInactivityMs

const sendConfiguredNotification = async (
  payload: NotificationPayload,
  options: { throwOnError?: boolean; bypassActivityGate?: boolean } = {}
): Promise<void> => {
  if (!options.bypassActivityGate && isUserActiveInApp()) {
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

const playTaskFinishedSound = (): void => {
  if (process.platform === 'darwin') {
    void execFileAsync('afplay', ['/System/Library/Sounds/Glass.aiff']).catch(() => {
      shell.beep()
    })
    return
  }
  shell.beep()
}

const playTaskFinishedSoundIfEnabled = (): void => {
  if (!store.getNotificationSettings().playFinishSound) return
  playTaskFinishedSound()
}

const handleTaskStatusChange = (event: TaskStatusChangeEvent): void => {
  const notifications: NotificationPayload[] = []
  const wasRunning = event.oldStatus === 'processing'
  const runningTaskCount = store.getRunningTaskCount()
  const runningTaskCountBeforeChange = runningTaskCount + (wasRunning && event.newStatus !== 'processing' ? 1 : 0)
  const isDone = event.newStatus === 'done_unread' || event.newStatus === 'done_read'
  const deferForQueuedMessages = hasQueuedTaskMessages(event.task.id)

  if (!deferForQueuedMessages && !isDone && event.newStatus === 'attention') {
    notifications.push({
      event: 'taskFailed',
      title: 'Task needs attention',
      body: event.task.title,
      priority: 'high',
      taskId: event.task.id
    })
  }

  if (
    !deferForQueuedMessages &&
    event.oldStatus !== 'done_unread' &&
    event.oldStatus !== 'done_read' &&
    isDone
  ) {
    notifications.push({
      event: 'taskCompleted',
      title: 'Task completed',
      body: event.task.title,
      priority: 'default',
      taskId: event.task.id
    })
    playTaskFinishedSoundIfEnabled()
  }

  if (
    wasRunning &&
    event.newStatus !== 'processing' &&
    runningTaskCountBeforeChange > 1 &&
    runningTaskCount === 0 &&
    !hasAnyQueuedTaskMessages()
  ) {
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

  if (!deferForQueuedMessages) {
    handleKeyboardAlertForStatus({
      newStatus: event.newStatus,
      oldStatus: event.oldStatus,
      taskId: event.task.id,
      runningCount: runningTaskCount,
      runningCountBeforeChange: runningTaskCountBeforeChange
    })
    handleNotchOverlayStatusChange({
      task: event.task,
      oldStatus: event.oldStatus,
      newStatus: event.newStatus,
      runningCount: runningTaskCount,
      runningCountBeforeChange: runningTaskCountBeforeChange
    })
  } else {
    syncNotchOverlay()
  }
}

const requestQuitConfirmation = (): void => {
  if (isQuitPromptOpen) return

  const targetWindow =
    [...windows].find((window) => !window.isDestroyed()) ??
    BrowserWindow.getAllWindows().find((window) => !isNotchOverlayWindow(window) && !window.isDestroyed())
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
  destroyNotchOverlay()
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
  if (!gotSingleInstanceLock) return
  electronApp.setAppUserModelId(appUserModelId)
  applyDockIcon()
  // Drop the default Electron File/Edit/View/Window menu on Windows/Linux.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }
  // Dev restarts often leave a previous Electron child alive with its notch panel.
  reapStaleDevElectronProcesses()
  // Wipe any leftover notch panels from a previous / crashed session in this process.
  purgeNotchOverlays()
  store = new VibeBoardStore()
  store.recoverInterruptedProcessingTasks()
  store.setTaskStatusListener(handleTaskStatusChange)
  const isMainAppFocused = (): boolean => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && !focused.isDestroyed() && !isNotchOverlayWindow(focused)) {
      return true
    }
    return [...windows].some((window) => !window.isDestroyed() && window.isFocused())
  }

  bindNotchOverlayDeps({
    getSettings: () => store.getNotchOverlaySettings(),
    getRunningCount: () => store.getRunningTaskCount(),
    getAttentionCount: () => store.getAttentionTaskCount(),
    getDoneUnreadCount: () => store.getDoneUnreadTaskCount(),
    getDoneReadCount: () => store.getDoneReadTaskCount(),
    getRunningAgents: () =>
      store.listRunningTasksForNotch().map((task) => ({
        taskId: task.id,
        title: task.title,
        projectName: task.projectName,
        runStartedAt: task.runStartedAt,
        queuedCount: taskMessageQueues.get(task.id)?.length ?? 0
      })),
    getDoneAgents: () =>
      store.listDoneTasksForNotch().map((task) => ({
        taskId: task.id,
        title: task.title,
        projectName: task.projectName,
        runStartedAt: task.runStartedAt,
        queuedCount: taskMessageQueues.get(task.id)?.length ?? 0
      })),
    getSystemTail: (taskId) => store.getRecentSystemMessages(taskId, 16),
    getQueuedMessages: (taskId) =>
      (taskMessageQueues.get(taskId) ?? []).map((item) => ({
        id: item.id,
        content: item.content
      })),
    getTaskNotchMeta: (taskId) => {
      const task = store.getState().tasks.find((item) => item.id === taskId)
      if (!task) return null
      return {
        title: task.title,
        projectName: store.getBoardLabelForTask(task),
        status: task.status,
        runStartedAt: task.runStartedAt ?? null
      }
    },
    isTaskOnOpenTab: (taskId) => store.isTaskOnOpenTab(taskId),
    isTaskFinishPending: (taskId) => store.isTaskFinishPending(taskId),
    getLatestAssistantReply: (taskId) => store.getLatestAssistantMessage(taskId),
    getBoardLabelForTask: (task) => store.getBoardLabelForTask(task),
    onOpenTask: (taskId) => openTaskFromNotification(taskId),
    onSendReply: async (taskId, content) => {
      await sendTaskMessageAndMaybeRun({ taskId, content, attachments: [] })
      broadcastStateChanged()
    },
    onUpdateQueuedMessage: (taskId, messageId, content) =>
      updateQueuedTaskMessage(taskId, messageId, content),
    onRemoveQueuedMessage: (taskId, messageId) =>
      removeQueuedTaskMessage(taskId, messageId),
    isMainAppFocused,
    hasMainWindowBeenShown: () => mainWindowHasShown
  })
  bindKeyboardAlertDeps({
    getSettings: () => store.getKeyboardAlertSettings(),
    isMainAppFocused,
    getAlertTaskIds: () => {
      const settings = store.getKeyboardAlertSettings()
      return store.getKeyboardAlertTaskIds({
        includeAttention: settings.flashOnTaskFailed,
        includeDoneUnread: settings.flashOnTaskCompleted
      })
    }
  })
  registerIpc()
  registerUpdaterEvents()

  app.on('browser-window-created', (_, window) => {
    if (isNotchOverlayWindow(window)) return
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  setTimeout(() => {
    void checkForUpdates()
  }, 3000)

  app.on('activate', () => {
    // Dock icon / Cmd+Tab: demote notch panel, then force the board on screen.
    focusMainWindow()
  })

  // Leaving the app is the reliable signal to show the notch (window blur can
  // race ahead of resign-active and get ignored during launch grace).
  app.on('did-resign-active', () => {
    syncNotchIfEnabled()
  })

  // Extra safety: if something left us "running" with no visible board, recover.
  if (process.platform === 'darwin') {
    app.on('did-become-active', () => {
      const main = getMainBrowserWindow()
      if (!main) {
        focusMainWindow()
        return
      }
      if (!main.isVisible() || main.isMinimized()) {
        focusMainWindow()
      }
    })
  }
})

app.on('window-all-closed', () => {
  destroyNotchOverlay()
  destroyKeyboardAlertFlash()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  // Always kill notch panels first so they cannot outlive the quit flow.
  destroyNotchOverlay()
  destroyKeyboardAlertFlash()
  if (isQuitConfirmed) {
    return
  }
  event.preventDefault()
  requestQuitConfirmation()
})

app.on('will-quit', () => {
  destroyNotchOverlay()
  destroyKeyboardAlertFlash()
})

/** Kill leftover Electron children from prior `npm run dev` runs (ghost notch panels). */
const reapStaleDevElectronProcesses = (): void => {
  if (!is.dev || process.platform === 'win32') return
  const marker = `${path.sep}vibeboard${path.sep}node_modules${path.sep}electron`
  const stalePids: number[] = []
  try {
    const rows = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      timeout: 2000
    })
    for (const line of rows.split('\n')) {
      if (!line.includes(marker)) continue
      // Never touch Helper/GPU/Renderer processes for the live app.
      if (/Helper|GPU|Renderer|Plugin/i.test(line)) continue
      const parts = line.trim().split(/\s+/)
      const pid = Number(parts[0])
      const ppid = Number(parts[1])
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue
      if (ppid === process.pid) continue
      stalePids.push(pid)
    }
  } catch {
    return
  }

  for (const pid of stalePids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
  // Ghost mains often ignore SIGTERM (quit prompt / hung renderer); force them.
  if (stalePids.length > 0) {
    setTimeout(() => {
      for (const pid of stalePids) {
        try {
          process.kill(pid, 0)
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone.
        }
      }
    }, 400)
  }
}
