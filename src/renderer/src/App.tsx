import { ReactElement, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DragEvent as ReactDragEvent } from 'react'
import {
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import confetti from 'canvas-confetti'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dart from 'highlight.js/lib/languages/dart'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  CornerDownLeft,
  Download,
  Ellipsis,
  ExternalLink,
  FolderPlus,
  FolderOpen,
  GitCommitHorizontal,
  GitBranch,
  GitPullRequestDraft,
  History,
  LayoutDashboard,
  MessageSquare,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Plus,
  Pin,
  RadioTower,
  RotateCcw,
  Search,
  Send,
  Smartphone,
  Square,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import type {
  AppState,
  BoardTab,
  CodeChange,
  ConversationAttachment,
  ConversationEntry,
  CursorSetupPhase,
  CursorStatus,
  Lane,
  Project,
  QueuedTaskMessage,
  QuitRequest,
  RunMode,
  SearchResult,
  Task,
  TaskDetail,
  TaskMessageAttachmentInput,
  UpdateInfo,
  NotificationEventSettings,
  NotificationSettings,
} from '../../shared/types'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('css', css)
hljs.registerLanguage('dart', dart)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('go', go)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('less', less)
hljs.registerLanguage('lua', lua)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('php', php)
hljs.registerLanguage('python', python)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('scss', scss)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)

const emptyState: AppState = {
  projects: [],
  tabs: [],
  closedTabs: [],
  lanes: [],
  tasks: [],
  activeTabId: ''
}

const emptyTaskDetail: TaskDetail = {
  conversations: [],
  changes: [],
  hasOlderConversations: false
}
// Page size is user→agent turns (not raw DB rows / system progress lines).
const conversationPageSize = 5

const tabColors = ['#ff7a1a', '#f7c56b', '#2fcf75', '#42b883', '#9b8cff', '#ff5f57']
const platformClass = navigator.userAgent.includes('Mac')
  ? 'platform-mac'
  : navigator.userAgent.includes('Windows')
    ? 'platform-windows'
    : 'platform-linux'
const isDevMode = window.location.protocol === 'http:' || window.location.protocol === 'https:'
const taskCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions

  const intersectionCollisions = rectIntersection(args)
  if (intersectionCollisions.length > 0) return intersectionCollisions

  return closestCorners(args)
}

const emptyCursorStatus: CursorStatus = {
  available: false,
  label: 'Checking Cursor',
  debug: {
    cursorCommand: null,
    agentCommand: null,
    authStatus: 'checking',
    checkedCursorCommands: [],
    checkedAgentCommands: [],
    installCommand: '',
    lastInstallOutput: '',
    processPath: '',
    shellPath: ''
  }
}
const emptyUpdateInfo: UpdateInfo = {
  status: 'idle',
  mode: 'auto',
  currentVersion: '0.0.0',
  latestVersion: null,
  message: 'Ready to check for updates.',
  progress: null,
  releaseUrl: null,
  releaseNotes: null
}

const emptyNotificationSettings: NotificationSettings = {
  desktopEnabled: false,
  desktopEvents: {
    taskCompleted: true,
    taskFailed: true,
    allTasksFinished: false
  },
  ntfy: {
    enabled: false,
    serverUrl: 'https://ntfy.sh',
    topic: '',
    events: {
      taskCompleted: true,
      taskFailed: true,
      allTasksFinished: false
    }
  }
}

interface PendingReleaseNotes {
  version: string
  notes: string | null
  releaseUrl: string | null
}

const pendingReleaseNotesStorageKey = 'vibeboard.pendingReleaseNotes'
const seenReleaseNotesStorageKey = 'vibeboard.seenReleaseNotesVersion'
const taskComposerDraftStoragePrefix = 'vibeboard.taskComposerDraft.'
const onboardingStorageKey = 'vibeboard.onboarding.v1'
const showCodeChangesStorageKey = 'vibeboard.showCodeChanges'

const runModeLabels: Record<RunMode, string> = {
  shared: 'Shared',
  branch: 'Branch',
  worktree: 'Worktree'
}

const runModeDescriptions: Record<RunMode, string> = {
  shared: 'One project folder',
  branch: 'Git branch per task',
  worktree: 'Git worktree per task'
}

const tutorialSteps = [
  {
    id: 'sidebar',
    title: 'Projects and search live here',
    body: 'Add project folders, open global search, and configure notifications from the sidebar.',
    spotlight: 'sidebar',
    target: 'sidebar',
    card: 'right'
  },
  {
    id: 'tabs',
    title: 'One tab is one project',
    body: 'Tabs keep project boards separate. Closed projects stay in recent history so you can reopen them.',
    spotlight: 'tabs',
    target: 'tabs',
    card: 'below'
  },
  {
    id: 'board',
    title: 'Tasks move through lanes',
    body: 'Cards can be dragged between lanes and ordered inside each lane. Their borders show running, attention, and done states.',
    spotlight: 'board',
    target: 'board-lanes',
    card: 'center'
  },
  {
    id: 'worktree',
    title: 'Worktree is the default run mode',
    body: 'Each task gets its own Git worktree so parallel agents do not fight over the same files.',
    spotlight: 'actions',
    target: 'board-actions',
    card: 'left'
  },
  {
    id: 'demo',
    title: 'Task details split chat and code',
    body: 'The task popup keeps the conversation on the left and captured file changes on the right.',
    spotlight: 'modal',
    target: 'tutorial-demo',
    card: 'bottom'
  }
]
const commitTaskPrompt = [
  'Commit the current working tree changes for this task.',
  'Inspect git status and git diff first.',
  'Stage only files that belong to this task.',
  'Choose a concise conventional commit message yourself.',
  'Create the commit locally.',
  'Push the commit to the default branch on origin without checking out that branch.',
  'If main/master is already checked out in another worktree, use `git push origin HEAD:main` (or HEAD:master).',
  'Do not try to update the project main checkout yourself; VibeBoard syncs it after this run.',
  'If there are no commit-worthy changes, say that clearly.'
].join('\n')
const draftPrPrompt = [
  'Create a draft pull request for the current task changes.',
  'Inspect git status, current branch, and remote first.',
  'If needed, create a focused local commit with a concise conventional commit message.',
  'Push the branch to origin.',
  'Open a draft PR with a clear title and useful body.',
  'Return the PR URL when it is created.',
  'If a draft PR cannot be created, explain the exact blocker.'
].join('\n')
const promptTemplates = [
  {
    label: 'PR',
    prompt: [
      'Review the current task changes and prepare a draft pull request.',
      'Check git status, summarize the changes, create a focused commit if needed, and draft a clear PR description.',
      'Do not merge anything.'
    ].join('\n')
  },
  {
    label: 'Fix tests',
    prompt: [
      'Run the relevant tests for this project, inspect any failures, and fix the smallest necessary code path.',
      'Do not make unrelated refactors.',
      'Report the commands you ran and what changed.'
    ].join('\n')
  },
  {
    label: 'Refactor',
    prompt: [
      'Refactor this area for clarity while preserving behavior.',
      'Keep the change scoped, follow existing project patterns, and avoid unrelated formatting churn.',
      'Run the relevant checks if they exist.'
    ].join('\n')
  }
]

function buildRevertTaskPrompt(changes: CodeChange[]): string {
  const files = [...new Set(changes.map((change) => change.filePath).filter(Boolean))]
  return [
    'Revert the code changes made for this specific task only.',
    'Inspect git status and git diff first.',
    'Only touch the captured files listed below.',
    'Do not revert unrelated local work.',
    'Do not commit.',
    'After reverting, report exactly which files changed.',
    '',
    'Captured files:',
    ...files.map((file) => `- ${file}`)
  ].join('\n')
}

function getTaskComposerDraftStorageKey(taskId: string): string {
  return `${taskComposerDraftStoragePrefix}${taskId}`
}

function readTaskComposerDraft(taskId: string): string {
  try {
    return localStorage.getItem(getTaskComposerDraftStorageKey(taskId)) ?? ''
  } catch {
    return ''
  }
}

function writeTaskComposerDraft(taskId: string, value: string): void {
  try {
    const key = getTaskComposerDraftStorageKey(taskId)
    if (value) {
      localStorage.setItem(key, value)
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    // Draft persistence is best-effort. The composer still works if storage is unavailable.
  }
}

function readShowCodeChangesPreference(): boolean {
  try {
    const raw = localStorage.getItem(showCodeChangesStorageKey)
    if (raw === null) return true
    return raw !== '0' && raw !== 'false'
  } catch {
    return true
  }
}

function writeShowCodeChangesPreference(value: boolean): void {
  try {
    localStorage.setItem(showCodeChangesStorageKey, value ? '1' : '0')
  } catch {
    // Preference persistence is best-effort.
  }
}

export function App(): ReactElement {
  const [state, setState] = useState<AppState>(emptyState)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [newTaskLaneId, setNewTaskLaneId] = useState<string | null>(null)
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null)
  const [dragOverlayWidth, setDragOverlayWidth] = useState<number | null>(null)
  const [dragPreviewTarget, setDragPreviewTarget] = useState<{ laneId: string; position: number } | null>(null)
  const [cursorStatus, setCursorStatus] = useState<CursorStatus>(emptyCursorStatus)
  const [isInstallingCursorCli, setInstallingCursorCli] = useState(false)
  const [cursorSetupPhase, setCursorSetupPhase] = useState<CursorSetupPhase>('checking')
  const [cursorFeedback, setCursorFeedback] = useState('')
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [deleteTabId, setDeleteTabId] = useState<string | null>(null)
  const [deleteLaneId, setDeleteLaneId] = useState<string | null>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  const [renameTaskId, setRenameTaskId] = useState<string | null>(null)
  const [quitRequest, setQuitRequest] = useState<QuitRequest | null>(null)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchResults, setGlobalSearchResults] = useState<SearchResult[]>([])
  const [isGlobalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>(emptyUpdateInfo)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(emptyNotificationSettings)
  const [isNotificationSettingsOpen, setNotificationSettingsOpen] = useState(false)
  const [notificationFeedback, setNotificationFeedback] = useState('')
  const [releaseNotesModal, setReleaseNotesModal] = useState<PendingReleaseNotes | null>(null)
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskDetail>(emptyTaskDetail)
  const [isLoadingOlderConversations, setLoadingOlderConversations] = useState(false)
  const [tutorialStep, setTutorialStep] = useState<number | null>(() => {
    try {
      return window.localStorage.getItem(onboardingStorageKey) ? null : 0
    } catch {
      return null
    }
  })
  const [isTutorialCompleteOpen, setTutorialCompleteOpen] = useState(false)
  const pendingActionsRef = useRef(new Set<string>())
  const [, setPendingActionVersion] = useState(0)

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
  const activeProject = activeTab?.activeProjectId
    ? state.projects.find((project) => project.id === activeTab.activeProjectId) ?? null
    : null
  const openProjectLabel =
    navigator.userAgent.includes('Windows') ? 'Explorer' : navigator.userAgent.includes('Mac') ? 'Finder' : 'Folder'
  const activeLanes = useMemo(
    () => state.lanes.filter((lane) => lane.tabId === activeTab?.id).sort(byPosition),
    [state.lanes, activeTab?.id]
  )
  const activeTasks = useMemo(
    () => state.tasks.filter((task) => task.tabId === activeTab?.id),
    [state.tasks, activeTab?.id]
  )
  const tasksByLaneId = useMemo(() => {
    const grouped = new Map<string, Task[]>()
    for (const task of state.tasks) {
      const laneTasks = grouped.get(task.laneId)
      if (laneTasks) {
        laneTasks.push(task)
      } else {
        grouped.set(task.laneId, [task])
      }
    }
    for (const laneTasks of grouped.values()) {
      laneTasks.sort(byPosition)
    }
    return grouped
  }, [state.tasks])
  const tabStatuses = useMemo(() => buildTabStatusMap(state.tasks), [state.tasks])
  const activeBoardStats = useMemo(() => {
    const running = activeTasks.filter((task) => task.status === 'processing').length
    const attention = activeTasks.filter((task) => task.status === 'attention').length
    const done = activeTasks.filter((task) => task.status === 'done_read' || task.status === 'done_unread').length
    return { running, attention, done, total: activeTasks.length }
  }, [activeTasks])
  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId) ?? null
  const activeDragTask = state.tasks.find((task) => task.id === activeDragTaskId) ?? null

  const runAction = async (key: string, action: () => Promise<void>): Promise<void> => {
    if (pendingActionsRef.current.has(key)) return
    pendingActionsRef.current.add(key)
    setPendingActionVersion((version) => version + 1)
    try {
      await action()
    } finally {
      pendingActionsRef.current.delete(key)
      setPendingActionVersion((version) => version + 1)
    }
  }
  const isActionPending = (key: string): boolean => pendingActionsRef.current.has(key)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    refresh()
    prepareCursorOnLaunch()
    const stopStateListener = window.vibeboard.onStateChanged(() => {
      refresh()
    })
    const stopQuitListener = window.vibeboard.onQuitRequested((request) => {
      setQuitRequest(request)
    })
    const stopUpdateListener = window.vibeboard.onUpdateChanged((info) => {
      setUpdateInfo(info)
    })
    const stopNotificationOpenListener = window.vibeboard.onNotificationOpened((request) => {
      void openTaskFromNotification(request.taskId)
    })
    window.vibeboard.getUpdateInfo().then(setUpdateInfo)
    window.vibeboard.getNotificationSettings().then(setNotificationSettings)
    return () => {
      stopStateListener()
      stopQuitListener()
      stopUpdateListener()
      stopNotificationOpenListener()
    }
  }, [])

  useEffect(() => {
    let lastReportedAt = 0
    const reportActivity = (): void => {
      const now = Date.now()
      if (now - lastReportedAt < 15_000) return
      lastReportedAt = now
      window.vibeboard.reportUserActivity()
    }
    const activityEvents = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'focus']
    reportActivity()
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, reportActivity, { passive: true })
    }
    return () => {
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, reportActivity)
      }
    }
  }, [])

  useEffect(() => {
    if (!updateInfo.currentVersion || updateInfo.currentVersion === '0.0.0') return

    const pending = readPendingReleaseNotes()
    if (!pending || pending.version !== updateInfo.currentVersion) return
    if (localStorage.getItem(seenReleaseNotesStorageKey) === pending.version) return

    setReleaseNotesModal(pending)
    localStorage.setItem(seenReleaseNotesStorageKey, pending.version)
    localStorage.removeItem(pendingReleaseNotesStorageKey)
  }, [updateInfo.currentVersion])

  useEffect(() => {
    if (updateInfo.status !== 'downloaded' || !updateInfo.latestVersion) return
    writePendingReleaseNotes(updateInfo)
  }, [updateInfo])

  useEffect(() => {
    if (cursorSetupPhase !== 'failed') return
    const intervalId = window.setInterval(() => {
      if (document.hidden) return
      refreshCursorStatus({ quiet: true })
    }, 15000)
    return () => window.clearInterval(intervalId)
  }, [cursorSetupPhase])

  useEffect(() => {
    const query = globalSearchQuery.trim()
    if (!isGlobalSearchOpen) {
      setGlobalSearchResults([])
      return
    }

    let cancelled = false
    const timerId = window.setTimeout(() => {
      window.vibeboard.searchWorkspace({ query, limit: query ? 18 : 4 }).then((results) => {
        if (!cancelled) {
          setGlobalSearchResults(results)
        }
      })
    }, query ? 140 : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timerId)
    }
  }, [globalSearchQuery, isGlobalSearchOpen])

  useEffect(() => {
    setSelectedTaskDetail(emptyTaskDetail)
    setLoadingOlderConversations(false)
  }, [selectedTask?.id])

  useEffect(() => {
    let cancelled = false

    if (!selectedTask) {
      setSelectedTaskDetail(emptyTaskDetail)
      setLoadingOlderConversations(false)
      return
    }

    const taskId = selectedTask.id
    const taskStatus = selectedTask.status

    window.vibeboard
      .getTaskDetail({ taskId, limit: conversationPageSize, includeChanges: true })
      .then((detail) => {
        if (cancelled) return
        setSelectedTaskDetail((current) => {
          const sameTask =
            current.conversations.length > 0 &&
            current.conversations.every((entry) => entry.taskId === taskId)
          // Opening a task must show the server page immediately — do not keep a stale
          // partial thread that only grows after the next send/refetch.
          if (!sameTask) return detail

          const merged = mergeConversationEntries(current.conversations, detail.conversations)
          // When idle, drop live system progress so classic user/assistant history stays clean.
          const conversations =
            taskStatus === 'processing' || taskStatus === 'attention'
              ? merged
              : merged.filter((entry) => entry.role !== 'system')

          return {
            conversations,
            changes: detail.changes,
            hasOlderConversations: current.hasOlderConversations || detail.hasOlderConversations
          }
        })
      })

    return () => {
      cancelled = true
    }
  }, [selectedTask?.id, selectedTask?.status, selectedTask?.updatedAt])

  // If a task finishes while its detail is open, treat it as already viewed (dashed done border).
  useEffect(() => {
    if (!selectedTask || selectedTask.status !== 'done_unread') return
    const taskId = selectedTask.id
    void runAction(`task:read:${taskId}`, async () => {
      await window.vibeboard.markTaskRead(taskId)
      await refresh()
    })
  }, [selectedTask?.id, selectedTask?.status])

  const loadOlderSelectedTaskConversations = async (): Promise<void> => {
    if (!selectedTask || !selectedTaskDetail.hasOlderConversations || isLoadingOlderConversations) return
    // Cursor must be a user turn anchor; system live-progress rows must not shrink the page window.
    const oldestConversation =
      selectedTaskDetail.conversations.find((entry) => entry.role === 'user') ??
      selectedTaskDetail.conversations.find((entry) => entry.role !== 'system') ??
      selectedTaskDetail.conversations[0]
    if (!oldestConversation) return

    setLoadingOlderConversations(true)
    try {
      const detail = await window.vibeboard.getTaskDetail({
        taskId: selectedTask.id,
        beforeCreatedAt: oldestConversation.createdAt,
        limit: conversationPageSize,
        includeChanges: false
      })
      setSelectedTaskDetail((current) => ({
        conversations: mergeConversationEntries(detail.conversations, current.conversations),
        changes: current.changes,
        hasOlderConversations: detail.hasOlderConversations
      }))
    } finally {
      setLoadingOlderConversations(false)
    }
  }

  const prepareCursorOnLaunch = async (): Promise<void> => {
    const nextStatus = await window.vibeboard.getCursorAdapterStatus()
    setCursorStatus(nextStatus)
    if (nextStatus.available) {
      setCursorSetupPhase('ready')
      setCursorFeedback('')
      return
    }
    if (nextStatus.debug.agentCommand) {
      setCursorSetupPhase('failed')
      setCursorFeedback('Cursor Agent needs login.')
      return
    }

    setCursorSetupPhase('preparing')
    setCursorFeedback('')
    const result = await window.vibeboard.installCursorCli()
    const statusAfterInstall = await window.vibeboard.getCursorAdapterStatus()
    setCursorStatus(statusAfterInstall)
    if (statusAfterInstall.available) {
      setCursorSetupPhase('ready')
      setCursorFeedback('')
      return
    }

    setCursorSetupPhase('failed')
    setCursorFeedback(result.message || 'Cursor CLI setup needs attention.')
  }

  const refreshCursorStatus = async (options: { quiet?: boolean } = {}): Promise<void> => {
    const nextStatus = await window.vibeboard.getCursorAdapterStatus()
    setCursorStatus(nextStatus)
    if (nextStatus.available) {
      setCursorSetupPhase('ready')
      setCursorFeedback('')
      return
    }

    setCursorSetupPhase('failed')
    if (!options.quiet) {
      setCursorFeedback(nextStatus.debug.agentCommand ? 'Cursor Agent needs login.' : 'Cursor Agent is missing.')
    }
  }

  const openCursorRepair = async (): Promise<void> => {
    await runAction('cursor:repair', async () => {
      setInstallingCursorCli(true)
      setCursorFeedback('Terminal install opened. VibeBoard will recheck automatically.')
      try {
        await window.vibeboard.openCursorInstallTerminal()
      } finally {
        setInstallingCursorCli(false)
      }
    })
  }

  const refresh = async (): Promise<void> => {
    setState(await window.vibeboard.getState())
  }

  const createProject = async (): Promise<void> => {
    await runAction('project:create', async () => {
      await window.vibeboard.createProject({})
      await refresh()
    })
  }

  const createTab = async (): Promise<void> => {
    await createProject()
  }

  const closeTab = async (tabId: string): Promise<void> => {
    await runAction(`tab:close:${tabId}`, async () => {
      await window.vibeboard.closeTab(tabId)
      await refresh()
    })
  }

  const reopenTab = async (tabId: string): Promise<void> => {
    await runAction(`tab:reopen:${tabId}`, async () => {
      await window.vibeboard.reopenTab(tabId)
      await refresh()
    })
  }

  const deleteTab = async (tabId: string): Promise<void> => {
    await runAction(`tab:delete:${tabId}`, async () => {
      await window.vibeboard.deleteTab(tabId)
      setDeleteTabId(null)
      await refresh()
    })
  }

  const updateTabMeta = async (input: { id: string; isPinned?: boolean; color?: string | null }): Promise<void> => {
    await runAction(`tab:update:${input.id}`, async () => {
      await window.vibeboard.updateTabMeta(input)
      await refresh()
    })
  }

  const reorderTabs = async (orderedIds: string[]): Promise<void> => {
    await runAction('tab:reorder', async () => {
      await window.vibeboard.reorderTabs({ orderedIds })
      await refresh()
    })
  }

  const setActiveTab = async (tabId: string): Promise<void> => {
    await runAction(`tab:active:${tabId}`, async () => {
      await window.vibeboard.setActiveTab(tabId)
      await refresh()
    })
  }

  const openTaskFromNotification = async (taskId: string): Promise<void> => {
    await runAction(`notification:open:${taskId}`, async () => {
      const nextState = await window.vibeboard.getState()
      const task = nextState.tasks.find((item) => item.id === taskId)
      if (!task) return

      const isOpenTab = nextState.tabs.some((tab) => tab.id === task.tabId)
      const isClosedTab = nextState.closedTabs.some((tab) => tab.id === task.tabId)
      if (!isOpenTab && isClosedTab) {
        await window.vibeboard.reopenTab(task.tabId)
      }

      await window.vibeboard.setActiveTab(task.tabId)

      setGlobalSearchOpen(false)
      setGlobalSearchQuery('')
      setSelectedTaskId(task.id)
      setState(await window.vibeboard.getState())
    })
  }

  const openSearchResult = async (result: SearchResult): Promise<void> => {
    const actionKey = `search:open:${result.kind}:${result.tabId ?? result.projectId ?? result.taskId ?? result.title}`
    await runAction(actionKey, async () => {
      await window.vibeboard.recordSearchOpen({ result })

      if (result.tabId) {
        if (result.isClosedTab) {
          await window.vibeboard.reopenTab(result.tabId)
        } else {
          await window.vibeboard.setActiveTab(result.tabId)
        }
        await refresh()
      } else if (result.projectId) {
        await window.vibeboard.createTab({ name: result.title, projectId: result.projectId })
        await refresh()
      }

      if (result.taskId) {
        setSelectedTaskId(result.taskId)
      }

      setGlobalSearchQuery('')
      setGlobalSearchResults([])
      setGlobalSearchOpen(false)
    })
  }

  const createLane = async (): Promise<void> => {
    if (!activeTab) return
    await runAction(`lane:create:${activeTab.id}`, async () => {
      await window.vibeboard.createLane({ tabId: activeTab.id, name: 'New lane' })
      await refresh()
    })
  }

  const openActiveProjectFolder = async (): Promise<void> => {
    if (!activeProject || activeProject.pathMissing) return
    await runAction(`project:open:${activeProject.id}`, async () => {
      await window.vibeboard.openProjectFolder(activeProject.id)
    })
  }

  const relocateActiveProject = async (): Promise<void> => {
    if (!activeProject) return
    await runAction(`project:relocate:${activeProject.id}`, async () => {
      await window.vibeboard.relocateProject(activeProject.id)
      await refresh()
    })
  }

  const updateActiveProjectRunMode = async (runMode: RunMode): Promise<void> => {
    if (!activeProject || activeProject.runMode === runMode) return
    await runAction(`project:runMode:${activeProject.id}`, async () => {
      await window.vibeboard.updateProjectRunMode({ projectId: activeProject.id, runMode })
      await refresh()
    })
  }

  const persistTutorialComplete = (): void => {
    try {
      window.localStorage.setItem(onboardingStorageKey, 'done')
    } catch {
      // Tutorial persistence is best-effort.
    }
  }

  const skipTutorial = (): void => {
    persistTutorialComplete()
    setTutorialStep(null)
    setTutorialCompleteOpen(false)
  }

  const finishTutorial = (): void => {
    persistTutorialComplete()
    setTutorialStep(null)
    setTutorialCompleteOpen(true)
  }

  const replayTutorial = (): void => {
    try {
      window.localStorage.removeItem(onboardingStorageKey)
    } catch {
      // Tutorial persistence is best-effort.
    }
    setTutorialCompleteOpen(false)
    setTutorialStep(0)
  }

  const advanceTutorial = (): void => {
    if (tutorialStep !== null && tutorialStep >= tutorialSteps.length - 1) {
      finishTutorial()
      return
    }

    setTutorialStep((step) => (step === null ? null : step + 1))
  }

  const renameActiveTab = async (name: string): Promise<void> => {
    if (!activeTab || !name.trim()) return
    await runAction(`tab:rename:${activeTab.id}`, async () => {
      await window.vibeboard.renameTab({ id: activeTab.id, name })
      await refresh()
    })
  }

  const renameLane = async (id: string, name: string): Promise<void> => {
    if (!name.trim()) return
    await runAction(`lane:rename:${id}`, async () => {
      await window.vibeboard.renameLane({ id, name })
      await refresh()
    })
  }

  const deleteLane = async (id: string): Promise<void> => {
    if (activeLanes.length <= 1) return
    await runAction(`lane:delete:${id}`, async () => {
      setDeleteLaneId(null)
      await window.vibeboard.deleteLane(id)
      await refresh()
    })
  }

  const deleteTask = async (id: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === id)
    if (task?.status === 'processing') return
    await runAction(`task:delete:${id}`, async () => {
      if (selectedTaskId === id) {
        setSelectedTaskId(null)
      }
      setDeleteTaskId(null)
      await window.vibeboard.deleteTask(id)
      await refresh()
    })
  }

  const finishTask = async (id: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === id)
    if (task?.status === 'processing') return
    await runAction(`task:finish:${id}`, async () => {
      await window.vibeboard.updateTaskStatus({ taskId: id, status: 'done_unread' })
      await refresh()
    })
  }

  const renameTask = async (id: string, title: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === id)
    if (!title.trim() || task?.status === 'processing') return
    await runAction(`task:rename:${id}`, async () => {
      await window.vibeboard.renameTask({ id, name: title })
      setRenameTaskId(null)
      await refresh()
    })
  }

  const createTask = async (input: NewTaskInput): Promise<void> => {
    if (!activeTab || !newTaskLaneId) return
    await runAction(`task:create:${newTaskLaneId}`, async () => {
      await window.vibeboard.createTask({
        tabId: activeTab.id,
        laneId: newTaskLaneId,
        projectId: activeProject?.id ?? null,
        title: input.title
      })
      setNewTaskLaneId(null)
      await refresh()
    })
  }

  const openTask = async (task: Task): Promise<void> => {
    setSelectedTaskId(task.id)
  }

  const sendTaskMessage = async (
    taskId: string,
    content: string,
    attachments: TaskMessageAttachmentInput[] = []
  ): Promise<void> => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!cursorStatus.available || !task?.projectId) return
    const trimmed = content.trim()
    if (!trimmed && attachments.length === 0) return
    await runAction(`task:message:${taskId}`, async () => {
      const isQueuing = task.status === 'processing'
      if (selectedTaskId === taskId && !isQueuing) {
        const optimisticEntry: ConversationEntry = {
          id: `optimistic-${crypto.randomUUID()}`,
          taskId,
          role: 'user',
          content: trimmed,
          attachments: attachments.map((attachment, index) => ({
            id: `optimistic-attachment-${index}`,
            name: attachment.name,
            mimeType: attachment.mimeType,
            filePath: '',
            dataUrl: `data:${attachment.mimeType};base64,${attachment.dataBase64}`
          })),
          createdAt: new Date().toISOString()
        }
        setSelectedTaskDetail((current) => ({
          ...current,
          conversations: mergeConversationEntries(current.conversations, [optimisticEntry])
        }))
      }
      await window.vibeboard.sendTaskMessage({ taskId, content: trimmed, attachments })
      if (selectedTaskId === taskId) {
        const detail = await window.vibeboard.getTaskDetail({
          taskId,
          limit: conversationPageSize,
          includeChanges: true
        })
        setSelectedTaskDetail((current) => ({
          conversations: mergeConversationEntries(current.conversations, detail.conversations),
          changes: detail.changes,
          hasOlderConversations: current.hasOlderConversations || detail.hasOlderConversations
        }))
      }
      await refresh()
    })
  }

  const retryTask = async (taskId: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!cursorStatus.available || !task?.projectId || task.status === 'processing') return
    await runAction(`task:retry:${taskId}`, async () => {
      await window.vibeboard.runTaskWithCursor(taskId)
      await refresh()
    })
  }

  const retryTaskPrompt = async (taskId: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!cursorStatus.available || !task?.projectId) return

    const detailConversations =
      selectedTaskId === taskId ? selectedTaskDetail.conversations : []
    const lastUserPrompt =
      [...detailConversations].reverse().find((entry) => entry.role === 'user')?.content.trim() ||
      task.summary.trim() ||
      task.title.trim()

    await runAction(`task:retryPrompt:${taskId}`, async () => {
      if (selectedTaskId === taskId && lastUserPrompt) {
        const timestamp = new Date().toISOString()
        const optimisticEntries: ConversationEntry[] = [
          {
            id: `optimistic-${crypto.randomUUID()}`,
            taskId,
            role: 'system',
            content:
              task.status === 'processing'
                ? 'Stopped the previous run and retrying the last prompt.'
                : 'Retrying the last prompt.',
            createdAt: timestamp
          },
          {
            id: `optimistic-${crypto.randomUUID()}`,
            taskId,
            role: 'user',
            content: lastUserPrompt,
            createdAt: timestamp
          }
        ]
        setSelectedTaskDetail((current) => ({
          ...current,
          conversations: mergeConversationEntries(current.conversations, optimisticEntries)
        }))
      }
      await window.vibeboard.retryTaskPrompt(taskId)
      await refresh()
    })
  }

  const stopTask = async (taskId: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (task?.status !== 'processing') return
    await runAction(`task:stop:${taskId}`, async () => {
      await window.vibeboard.stopTask(taskId)
      await refresh()
    })
  }

  const cancelQuit = async (): Promise<void> => {
    await runAction('quit:cancel', async () => {
      setQuitRequest(null)
      await window.vibeboard.cancelQuit()
    })
  }

  const confirmQuit = async (): Promise<void> => {
    await runAction('quit:confirm', async () => {
      await window.vibeboard.confirmQuit()
    })
  }

  const downloadUpdate = async (): Promise<void> => {
    await runAction('update:download', async () => {
      setUpdateInfo((current) => ({
        ...current,
        status: 'downloading',
        message: current.mode === 'dev' ? 'Simulating update download.' : 'Starting download.',
        progress: current.progress ?? 0
      }))
      setUpdateInfo(await window.vibeboard.downloadUpdate())
    })
  }

  const installUpdate = async (): Promise<void> => {
    await runAction('update:install', async () => {
      writePendingReleaseNotes(updateInfo)
      setUpdateInfo((current) => ({
        ...current,
        status: 'installing',
        message: current.mode === 'dev' ? 'Finishing simulated update.' : 'Restarting to finish update.',
        progress: 100
      }))
      const nextInfo = await window.vibeboard.installUpdate()
      setUpdateInfo(nextInfo)
      if (nextInfo.mode === 'dev' && nextInfo.latestVersion) {
        setReleaseNotesModal({
          version: nextInfo.latestVersion,
          notes: nextInfo.releaseNotes,
          releaseUrl: nextInfo.releaseUrl
        })
      }
    })
  }

  const saveNotificationSettings = async (settings: NotificationSettings): Promise<void> => {
    await runAction('notifications:save', async () => {
      const nextSettings = await window.vibeboard.updateNotificationSettings(settings)
      setNotificationSettings(nextSettings)
      setNotificationFeedback('Saved')
    })
  }

  const testNotificationSettings = async (settings: NotificationSettings): Promise<void> => {
    await runAction('notifications:test', async () => {
      const nextSettings = await window.vibeboard.updateNotificationSettings(settings)
      setNotificationSettings(nextSettings)
      try {
        await window.vibeboard.sendTestNotification()
        setNotificationFeedback('Test sent')
      } catch (error) {
        setNotificationFeedback(error instanceof Error ? error.message : 'Test failed')
      }
    })
  }

  useEffect(() => {
    const switchToTab = async (tabId: string): Promise<void> => {
      await window.vibeboard.setActiveTab(tabId)
      await refresh()
    }

    const switchRelativeTab = (direction: 1 | -1): void => {
      if (state.tabs.length <= 1 || !activeTab) return
      const currentIndex = state.tabs.findIndex((tab) => tab.id === activeTab.id)
      if (currentIndex < 0) return
      const nextIndex = (currentIndex + direction + state.tabs.length) % state.tabs.length
      void switchToTab(state.tabs[nextIndex].id)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setGlobalSearchOpen(true)
        return
      }

      if (event.key === 'Escape') {
        if (isGlobalSearchOpen) {
          event.preventDefault()
          setGlobalSearchOpen(false)
          setGlobalSearchQuery('')
          return
        }
        if (quitRequest) {
          event.preventDefault()
          void cancelQuit()
          return
        }
        if (deleteTaskId) {
          event.preventDefault()
          setDeleteTaskId(null)
          return
        }
        if (deleteTabId) {
          event.preventDefault()
          setDeleteTabId(null)
          return
        }
        if (newTaskLaneId) {
          event.preventDefault()
          setNewTaskLaneId(null)
          return
        }
        if (renameTaskId) {
          event.preventDefault()
          setRenameTaskId(null)
          return
        }
        if (selectedTaskId) {
          event.preventDefault()
          setSelectedTaskId(null)
        }
        return
      }

      const hasTabModifier = event.metaKey || event.ctrlKey
      if (!hasTabModifier || state.tabs.length <= 1) return

      if (event.key === 'Tab') {
        event.preventDefault()
        switchRelativeTab(event.shiftKey ? -1 : 1)
        return
      }

      if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        event.preventDefault()
        switchRelativeTab(event.key === 'ArrowRight' ? 1 : -1)
        return
      }

      if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault()
        switchRelativeTab(event.key === 'PageDown' ? 1 : -1)
        return
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault()
        const targetIndex = event.key === '9' ? state.tabs.length - 1 : Number(event.key) - 1
        const targetTab = state.tabs[targetIndex]
        if (targetTab) {
          void switchToTab(targetTab.id)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeTab, deleteTabId, deleteTaskId, isGlobalSearchOpen, newTaskLaneId, quitRequest, renameTaskId, selectedTaskId, state.tabs])

  const clearTaskDrag = (): void => {
    setActiveDragTaskId(null)
    setDragOverlayWidth(null)
    setDragPreviewTarget(null)
  }

  const onDragStart = (event: DragStartEvent): void => {
    setActiveDragTaskId(String(event.active.id))
    setDragOverlayWidth(event.active.rect.current.initial?.width ?? null)
    setDragPreviewTarget(null)
  }

  const getTaskDropTarget = (event: DragOverEvent | DragEndEvent): { laneId: string; position: number } | null => {
    const { active, over } = event
    if (!over) return null

    const task = state.tasks.find((item) => item.id === active.id)
    if (!task) return null

    const overTask = state.tasks.find((item) => item.id === over.id)
    const overLane = state.lanes.find((lane) => lane.id === over.id)
    const targetLaneId = overTask?.laneId ?? overLane?.id
    if (!targetLaneId) return null

    const laneTasks = state.tasks.filter((item) => item.laneId === targetLaneId && item.id !== task.id)
    const overTaskIndex = overTask ? laneTasks.findIndex((item) => item.id === overTask.id) : -1
    const activeRect = active.rect.current.translated ?? active.rect.current.initial
    const overMiddleY = over.rect.top + over.rect.height / 2
    const activeMiddleY = activeRect ? activeRect.top + activeRect.height / 2 : overMiddleY
    const shouldInsertAfter = Boolean(overTask && activeMiddleY > overMiddleY)
    const position = overTaskIndex >= 0 ? overTaskIndex + (shouldInsertAfter ? 1 : 0) : laneTasks.length

    return { laneId: targetLaneId, position }
  }

  const onDragOver = (event: DragOverEvent): void => {
    setDragPreviewTarget(getTaskDropTarget(event))
  }

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    const target = getTaskDropTarget(event)
    const task = state.tasks.find((item) => item.id === event.active.id)

    if (!target || !task) {
      clearTaskDrag()
      return
    }

    const sourceLaneTasks = state.tasks
      .filter((item) => item.laneId === task.laneId)
      .sort(byPosition)
    const sourcePosition = sourceLaneTasks.findIndex((item) => item.id === task.id)
    const didMove = task.laneId !== target.laneId || sourcePosition !== target.position

    if (didMove) {
      setState((current) => ({
        ...current,
        tasks: applyTaskMove(current.tasks, task.id, target.laneId, target.position)
      }))
    }
    clearTaskDrag()

    if (!didMove) return

    await runAction(`task:move:${task.id}`, async () => {
      await window.vibeboard.moveTask({
        taskId: task.id,
        laneId: target.laneId,
        position: target.position
      })
      await refresh()
    })
  }

  return (
    <div className={`app-shell ${platformClass}`}>
      <TopBar
        tabs={state.tabs}
        closedTabs={state.closedTabs}
        projects={state.projects}
        tabStatuses={tabStatuses}
        activeTabId={activeTab?.id}
        onCloseTab={closeTab}
        onCreateTab={createTab}
        onDeleteTab={(id) => setDeleteTabId(id)}
        onReopenTab={reopenTab}
        onReorderTabs={reorderTabs}
        onSelectTab={setActiveTab}
        onUpdateTabMeta={updateTabMeta}
        isCreatingProject={isActionPending('project:create')}
      />

      <main className={isSidebarCollapsed ? 'workspace sidebar-collapsed' : 'workspace'}>
        <aside className="sidebar" data-tour="sidebar">
          <div className="sidebar-head">
            <div className="brand">
              <LayoutDashboard size={22} />
              <span>VibeBoard</span>
            </div>
            <button
              className="icon-button sidebar-toggle"
              type="button"
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              {isSidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>

          <button
            className="primary-action sidebar-project-button"
            type="button"
            onClick={createProject}
            disabled={isActionPending('project:create')}
            title="Add project"
          >
            <FolderPlus size={18} />
            <span>Add project</span>
          </button>

          <GlobalSearchLauncher onOpen={() => setGlobalSearchOpen(true)} />
          <NotificationLauncher
            onOpen={() => {
              setNotificationFeedback('')
              setNotificationSettingsOpen(true)
            }}
          />
          {isDevMode && <DevTutorialLauncher onOpen={replayTutorial} />}

          <section className="panel board-snapshot">
            <div className="panel-title">
              <CheckCircle2 size={16} />
              <span>Board</span>
            </div>
            <div className="sidebar-stat-grid">
              <SidebarStat label="Tasks" value={activeBoardStats.total} />
              <SidebarStat label="Running" value={activeBoardStats.running} tone="orange" />
              <SidebarStat label="Issues" value={activeBoardStats.attention} tone="red" />
              <SidebarStat label="Done" value={activeBoardStats.done} tone="green" />
            </div>
          </section>

          <section className="panel integration-panel">
            {cursorSetupPhase === 'failed' && (
              <>
                <div className="panel-title">
                  <RadioTower size={16} />
                  <span>Cursor</span>
                </div>
                <CursorConnection
                  feedback={cursorFeedback}
                  isInstalling={isInstallingCursorCli}
                  status={cursorStatus}
                  onRepair={openCursorRepair}
                />
              </>
            )}
          </section>

        </aside>

        <section className="board-area" data-tour="board">
          {activeTab ? (
            <>
              <header className="board-header">
                <div>
                  <EditableTitle
                    className="board-title-input"
                    value={activeTab.name}
                    onCommit={renameActiveTab}
                  />
                </div>
                <div className="board-header-actions" data-tour="board-actions">
                  {activeProject && (
                    <RunModeDropdown
                      runMode={activeProject.runMode}
                      disabled={isActionPending(`project:runMode:${activeProject.id}`)}
                      onChange={updateActiveProjectRunMode}
                    />
                  )}
                  <button
                    className="icon-text-button"
                    type="button"
                    onClick={openActiveProjectFolder}
                    disabled={!activeProject || activeProject.pathMissing || isActionPending(`project:open:${activeProject.id}`)}
                    title={`Open in ${openProjectLabel}`}
                  >
                    <FolderOpen size={17} />
                    <span>{openProjectLabel}</span>
                  </button>
                  {activeProject?.pathMissing && (
                    <button
                      className="icon-text-button needs-attention"
                      type="button"
                      onClick={relocateActiveProject}
                      disabled={isActionPending(`project:relocate:${activeProject.id}`)}
                      title="Relocate project folder"
                    >
                      <FolderOpen size={17} />
                      <span>Relocate</span>
                    </button>
                  )}
                  <button
                    className="icon-text-button"
                    type="button"
                    onClick={createLane}
                    disabled={isActionPending(`lane:create:${activeTab.id}`)}
                  >
                    <Plus size={17} />
                    <span>Lane</span>
                  </button>
                </div>
              </header>

              <DndContext
                sensors={sensors}
                collisionDetection={taskCollisionDetection}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragCancel={clearTaskDrag}
                onDragEnd={onDragEnd}
              >
                <div
                  data-tour="board-lanes"
                  className={activeDragTaskId ? 'lane-grid dragging-card' : 'lane-grid'}
                  style={{ '--lane-count': Math.min(activeLanes.length, 4) } as React.CSSProperties}
                >
                  {activeLanes.map((lane) => (
                    <LaneColumn
                      key={lane.id}
                      lane={lane}
                      tasks={tasksByLaneId.get(lane.id) ?? []}
                      activeDragTaskId={activeDragTaskId}
                      dropPreviewPosition={dragPreviewTarget?.laneId === lane.id ? dragPreviewTarget.position : null}
                      onOpenTask={openTask}
                      onAddTask={() => setNewTaskLaneId(lane.id)}
                      onDeleteLane={setDeleteLaneId}
                      onDeleteTask={setDeleteTaskId}
                      onFinishTask={finishTask}
                      onRenameTask={setRenameTaskId}
                      canDelete={activeLanes.length > 1}
                      onRenameLane={renameLane}
                    />
                  ))}
                </div>
                <DragOverlay dropAnimation={null}>
                  {activeDragTask ? (
                    <TaskCardPreview task={activeDragTask} width={dragOverlayWidth} />
                  ) : null}
                </DragOverlay>
              </DndContext>
            </>
          ) : (
            <EmptyBoard
              closedTabs={state.closedTabs}
              projects={state.projects}
              onCreateProject={createProject}
              onDeleteTab={(id) => setDeleteTabId(id)}
              onReopenTab={reopenTab}
              isCreatingProject={isActionPending('project:create')}
            />
          )}
        </section>
      </main>

      {newTaskLaneId && (
        <TaskFormModal
          onClose={() => setNewTaskLaneId(null)}
          onSubmit={createTask}
        />
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          project={state.projects.find((project) => project.id === selectedTask.projectId) ?? null}
          conversations={selectedTaskDetail.conversations}
          changes={selectedTaskDetail.changes}
          hasOlderConversations={selectedTaskDetail.hasOlderConversations}
          isLoadingOlderConversations={isLoadingOlderConversations}
          canUseCursor={cursorStatus.available}
          onLoadOlderConversations={loadOlderSelectedTaskConversations}
          onSendMessage={sendTaskMessage}
          onRetryTask={retryTask}
          onRetryPrompt={retryTaskPrompt}
          onStopTask={stopTask}
          onDeleteTask={setDeleteTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {renameTaskId && (
        <RenameTaskModal
          task={state.tasks.find((task) => task.id === renameTaskId) ?? null}
          onClose={() => setRenameTaskId(null)}
          onSubmit={(title) => renameTask(renameTaskId, title)}
        />
      )}

      {deleteTabId && (
        <DeleteTabModal
          tab={state.tabs.find((tab) => tab.id === deleteTabId) ?? state.closedTabs.find((tab) => tab.id === deleteTabId) ?? null}
          canDelete={
            Boolean(state.closedTabs.find((tab) => tab.id === deleteTabId)) ||
            Boolean(state.tabs.find((tab) => tab.id === deleteTabId))
          }
          onClose={() => setDeleteTabId(null)}
          onConfirm={() => deleteTab(deleteTabId)}
        />
      )}

      {deleteLaneId && (
        <DeleteLaneModal
          lane={state.lanes.find((lane) => lane.id === deleteLaneId) ?? null}
          taskCount={state.tasks.filter((task) => task.laneId === deleteLaneId).length}
          onClose={() => setDeleteLaneId(null)}
          onConfirm={() => deleteLane(deleteLaneId)}
        />
      )}

      {deleteTaskId && (
        <DeleteTaskModal
          task={state.tasks.find((task) => task.id === deleteTaskId) ?? null}
          onClose={() => setDeleteTaskId(null)}
          onConfirm={() => deleteTask(deleteTaskId)}
        />
      )}

      {quitRequest && (
        <QuitConfirmModal
          hasRunningTasks={quitRequest.hasRunningTasks}
          onClose={cancelQuit}
          onConfirm={confirmQuit}
        />
      )}

      {isGlobalSearchOpen && (
        <CommandSearchPalette
          query={globalSearchQuery}
          results={globalSearchResults}
          onChange={setGlobalSearchQuery}
          onClose={() => {
            setGlobalSearchOpen(false)
            setGlobalSearchQuery('')
          }}
          onOpenResult={openSearchResult}
        />
      )}

      {isNotificationSettingsOpen && (
        <NotificationSettingsModal
          settings={notificationSettings}
          feedback={notificationFeedback}
          isSaving={isActionPending('notifications:save') || isActionPending('notifications:test')}
          onClose={() => setNotificationSettingsOpen(false)}
          onSave={saveNotificationSettings}
          onTest={testNotificationSettings}
        />
      )}

      <UpdateBanner
        info={updateInfo}
        onDownload={downloadUpdate}
        onInstall={installUpdate}
      />

      {releaseNotesModal && (
        <ReleaseNotesModal
          release={releaseNotesModal}
          onClose={() => setReleaseNotesModal(null)}
        />
      )}

      {tutorialStep !== null && (
        <TutorialOverlay
          step={tutorialStep}
          onBack={() => setTutorialStep((step) => (step === null ? null : Math.max(0, step - 1)))}
          onNext={advanceTutorial}
          onSkip={skipTutorial}
        />
      )}

      {isTutorialCompleteOpen && (
        <TutorialCompleteOverlay onClose={() => setTutorialCompleteOpen(false)} />
      )}
    </div>
  )
}

function RunModeDropdown({
  runMode,
  disabled,
  onChange
}: {
  runMode: RunMode
  disabled: boolean
  onChange: (runMode: RunMode) => void
}): ReactElement {
  const [isOpen, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const closeOnOutside = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', closeOnOutside, true)
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside, true)
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [isOpen])

  return (
    <div className="run-mode-menu" ref={menuRef}>
      <button
        className={isOpen ? 'run-mode-trigger open' : 'run-mode-trigger'}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title="Task run isolation"
      >
        <GitBranch size={15} />
        <span>{runModeLabels[runMode]}</span>
        <ChevronDown size={14} />
      </button>

      {isOpen && (
        <div className="run-mode-options" role="menu">
          {(['worktree', 'branch', 'shared'] as RunMode[]).map((mode) => (
            <button
              key={mode}
              className={mode === runMode ? 'selected' : ''}
              type="button"
              role="menuitemradio"
              aria-checked={mode === runMode}
              onClick={() => {
                onChange(mode)
                setOpen(false)
              }}
            >
              <span className="run-mode-check">{mode === runMode && <Check size={14} />}</span>
              <span className="run-mode-option-copy">
                <strong>{runModeLabels[mode]}</strong>
                <small>{runModeDescriptions[mode]}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TutorialOverlay({
  step,
  onBack,
  onNext,
  onSkip
}: {
  step: number
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}): ReactElement {
  const currentStep = tutorialSteps[step] ?? tutorialSteps[0]
  const isLastStep = step >= tutorialSteps.length - 1
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    overlayRef.current?.focus()
  }, [step])

  useEffect(() => {
    const updateSpotlightRect = (): void => {
      const target = document.querySelector<HTMLElement>(`[data-tour="${currentStep.target}"]`)
      setSpotlightRect(target?.getBoundingClientRect() ?? null)
    }

    const frameId = window.requestAnimationFrame(updateSpotlightRect)
    window.addEventListener('resize', updateSpotlightRect)
    window.addEventListener('scroll', updateSpotlightRect, true)

    const target = document.querySelector<HTMLElement>(`[data-tour="${currentStep.target}"]`)
    const resizeObserver = target ? new ResizeObserver(updateSpotlightRect) : null
    if (target && resizeObserver) {
      resizeObserver.observe(target)
    }

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateSpotlightRect)
      window.removeEventListener('scroll', updateSpotlightRect, true)
      resizeObserver?.disconnect()
    }
  }, [currentStep.target, step])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onSkip()
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        onNext()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onNext, onSkip])

  return (
    <div
      className="tutorial-overlay"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="VibeBoard tour"
      tabIndex={-1}
    >
      <div
        className="tutorial-spotlight"
        style={spotlightStyle(spotlightRect, currentStep.spotlight)}
      />

      {currentStep.id === 'board' && (
        <TutorialBoardDemo spotlightRect={spotlightRect} />
      )}

      {currentStep.id === 'demo' && (
        <section className="modal-panel task-detail tutorial-demo" data-tour="tutorial-demo">
          <div className="modal-head">
            <div>
              <h2>Review release notes</h2>
              <p>vibeboard</p>
            </div>
          </div>

          <div className="detail-grid">
            <section className="detail-column">
              <div className="agent-thread">
                <div className="agent-stream tutorial-demo-stream">
                  <article className="agent-step role-user">
                    <MessageSquare size={16} />
                    <div>
                      <span className="agent-step-label">You</span>
                      <div className="user-message-bubble">
                        <p>Summarize the latest changes and check the release notes.</p>
                      </div>
                    </div>
                  </article>
                  <article className="agent-step role-assistant">
                    <Code2 size={16} />
                    <div>
                      <span className="agent-step-label">Agent</span>
                      <div className="message-markdown tutorial-demo-agent">
                        <p>Checking the diff and release workflow</p>
                      </div>
                    </div>
                  </article>
                </div>
                <div className="thread-composer tutorial-demo-composer">
                  <textarea disabled rows={1} placeholder="Message" />
                  <button className="icon-button" type="button" disabled title="Send">
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </section>

            <section className="detail-column">
              <div className="section-title">
                <Code2 size={16} />
                <span>Code changes</span>
              </div>
              <div className="change-stack">
                <div className="change-summary">
                  <span>1 files</span>
                  <span>1 modified</span>
                </div>
                <div className="change-list">
                  <article className="diff-file tutorial-demo-diff">
                    <header className="diff-file-header">
                      <div>
                        <span className="change-type modified">modified</span>
                        <strong>CHANGELOG.md</strong>
                      </div>
                      <span>markdown</span>
                    </header>
                    <div className="diff-table" role="table" aria-label="CHANGELOG.md diff">
                      <div className="diff-rows">
                        <div className="diff-line hunk" role="row">
                          <span className="diff-gutter" />
                          <span className="diff-number" />
                          <code>@@ -12,3 +12,4 @@</code>
                        </div>
                        <div className="diff-line removed" role="row">
                          <span className="diff-gutter">-</span>
                          <span className="diff-number">12</span>
                          <code>Release notes include updater internals.</code>
                        </div>
                        <div className="diff-line added" role="row">
                          <span className="diff-gutter">+</span>
                          <span className="diff-number">12</span>
                          <code>Release notes focus on user-facing changes.</code>
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              </div>
            </section>
          </div>
        </section>
      )}

      <section className={`tutorial-card tutorial-card-${currentStep.card}`}>
        <span className="tutorial-step-count">
          {step + 1} / {tutorialSteps.length}
        </span>
        <h2>{currentStep.title}</h2>
        <p>{currentStep.body}</p>
        <div className="tutorial-actions">
          <button className="secondary-action compact" type="button" onClick={onSkip}>
            Skip
            <span className="key-hint">Esc</span>
          </button>
          {step > 0 && (
            <button className="secondary-action compact" type="button" onClick={onBack}>
              Back
            </button>
          )}
          <button className="primary-action compact" type="button" onClick={onNext}>
            {isLastStep ? 'Done' : 'Next'}
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={13} />
            </span>
          </button>
        </div>
      </section>
    </div>
  )
}

const tutorialDemoTabId = 'tutorial-tab'
const tutorialDemoProjectId = 'tutorial-project'
const tutorialDemoCreatedAt = '2026-07-17T00:00:00.000Z'

const tutorialDemoLanes: Lane[] = [
  { id: 'tutorial-lane-backlog', tabId: tutorialDemoTabId, name: 'Backlog', position: 0 },
  { id: 'tutorial-lane-active', tabId: tutorialDemoTabId, name: 'Active', position: 1 },
  { id: 'tutorial-lane-review', tabId: tutorialDemoTabId, name: 'Review', position: 2 },
  { id: 'tutorial-lane-done', tabId: tutorialDemoTabId, name: 'Done', position: 3 }
]

const createTutorialTask = (
  id: string,
  laneId: string,
  title: string,
  status: Task['status'],
  position: number
): Task => ({
  id,
  tabId: tutorialDemoTabId,
  laneId,
  projectId: tutorialDemoProjectId,
  title,
  summary: '',
  status,
  runModeOverride: null,
  branchName: null,
  worktreePath: null,
  position,
  createdAt: tutorialDemoCreatedAt,
  updatedAt: tutorialDemoCreatedAt
})

const tutorialDemoTasks: Task[] = [
  createTutorialTask('tutorial-task-release', 'tutorial-lane-backlog', 'Plan release notes', 'idle', 0),
  createTutorialTask('tutorial-task-tests', 'tutorial-lane-active', 'Fix failing tests', 'processing', 0),
  createTutorialTask('tutorial-task-deploy', 'tutorial-lane-review', 'Clarify deploy target', 'attention', 0),
  createTutorialTask('tutorial-task-diff', 'tutorial-lane-done', 'Review generated diff', 'done_unread', 0)
]

function TutorialBoardDemo({ spotlightRect }: { spotlightRect: DOMRect | null }): ReactElement | null {
  if (!spotlightRect) return null

  const tasksByLane = new Map<string, Task[]>()
  for (const lane of tutorialDemoLanes) {
    tasksByLane.set(
      lane.id,
      tutorialDemoTasks.filter((task) => task.laneId === lane.id)
    )
  }

  return (
    <div
      className="tutorial-board-demo"
      style={{
        top: spotlightRect.top,
        left: spotlightRect.left,
        width: spotlightRect.width,
        height: spotlightRect.height
      }}
      aria-hidden="true"
    >
      <DndContext>
        <div className="lane-grid tutorial-lane-grid" style={{ '--lane-count': 4 } as React.CSSProperties}>
          {tutorialDemoLanes.map((lane) => (
            <LaneColumn
              key={lane.id}
              lane={lane}
              tasks={tasksByLane.get(lane.id) ?? []}
              activeDragTaskId={null}
              dropPreviewPosition={null}
              onOpenTask={() => undefined}
              onAddTask={() => undefined}
              onDeleteLane={() => undefined}
              onDeleteTask={() => undefined}
              onFinishTask={() => undefined}
              onRenameTask={() => undefined}
              canDelete={false}
              onRenameLane={() => undefined}
            />
          ))}
        </div>
      </DndContext>
    </div>
  )
}

function TutorialCompleteOverlay({ onClose }: { onClose: () => void }): ReactElement {
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null)
  useModalEscape(onClose)

  useEffect(() => {
    const canvas = confettiCanvasRef.current
    if (!canvas) return

    const fireConfetti = confetti.create(canvas, {
      resize: true,
      useWorker: true
    })
    const defaults = {
      particleCount: 80,
      spread: 64,
      startVelocity: 34,
      ticks: 220,
      gravity: 0.92,
      scalar: 0.9,
      colors: ['#ff7a1a', '#2fcf75', '#f7c56b', '#9b8cff', '#f2f2f2']
    }

    void fireConfetti({
      ...defaults,
      origin: { x: 0.34, y: 0.42 },
      angle: 58
    })
    void fireConfetti({
      ...defaults,
      origin: { x: 0.66, y: 0.42 },
      angle: 122
    })

    return () => {
      fireConfetti.reset()
    }
  }, [])

  useEffect(() => {
    const closeOnEnter = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Enter') return
      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', closeOnEnter, true)
    return () => window.removeEventListener('keydown', closeOnEnter, true)
  }, [onClose])

  return (
    <div
      className="modal-backdrop tutorial-complete-backdrop"
      role="presentation"
      onMouseDown={closeOnBackdropMouseDown(onClose)}
    >
      <canvas className="tutorial-confetti-canvas" ref={confettiCanvasRef} aria-hidden="true" />
      <section className="tutorial-complete-card" role="dialog" aria-modal="true">
        <h2>
          You're ready to start VibeBoard<em>ing</em>
        </h2>
        <p>Create a project, add tasks, and let each agent run in its own worktree.</p>
        <footer className="tutorial-complete-actions">
          <button className="primary-action" type="button" onClick={onClose}>
            Start
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function spotlightStyle(rect: DOMRect | null, type: string): React.CSSProperties {
  if (!rect) return { display: 'none' }

  const paddingByType: Record<string, number> = {
    sidebar: 6,
    tabs: 5,
    board: 10,
    actions: 6,
    modal: 0
  }
  const padding = paddingByType[type] ?? 6

  return {
    top: Math.max(6, rect.top - padding),
    left: Math.max(6, rect.left - padding),
    width: Math.min(window.innerWidth - Math.max(6, rect.left - padding) - 6, rect.width + padding * 2),
    height: Math.min(window.innerHeight - Math.max(6, rect.top - padding) - 6, rect.height + padding * 2)
  }
}

function EmptyBoard({
  closedTabs,
  projects,
  onCreateProject,
  onDeleteTab,
  onReopenTab,
  isCreatingProject
}: {
  closedTabs: BoardTab[]
  projects: Project[]
  onCreateProject: () => void
  onDeleteTab: (id: string) => void
  onReopenTab: (id: string) => void
  isCreatingProject: boolean
}): ReactElement {
  const [query, setQuery] = useState('')
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const recentTabs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const source = normalizedQuery
      ? closedTabs.filter((tab) => {
          const project = tab.activeProjectId ? projectById.get(tab.activeProjectId) : null
          return [tab.name, project?.name, project?.path]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(normalizedQuery))
        })
      : closedTabs
    return source.slice(0, 10)
  }, [closedTabs, projectById, query])

  return (
    <div className="empty-board">
      <section className="empty-board-panel">
        <header className="empty-board-header">
          <div>
            <h2>Recent projects</h2>
            <span>{closedTabs.length} closed</span>
          </div>
          <button className="primary-action" type="button" onClick={onCreateProject} disabled={isCreatingProject}>
            <FolderPlus size={18} />
            <span>Add project</span>
          </button>
        </header>

        <div className="empty-board-surface">
          <label className="empty-project-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search recent projects"
              autoFocus
            />
          </label>
          <div className="empty-project-list">
            {recentTabs.map((tab) => {
              const project = tab.activeProjectId ? projectById.get(tab.activeProjectId) : null
              const detail = project?.pathMissing
                ? 'Missing folder'
                : project?.path
                  ? compactPath(project.path)
                  : 'Closed board'

              return (
                <div className="empty-project-row" key={tab.id}>
                  <button
                    className="empty-project-open"
                    type="button"
                    onClick={() => onReopenTab(tab.id)}
                    title={tab.name}
                  >
                    <span className="empty-project-icon">
                      <RotateCcw size={16} />
                    </span>
                    <span className="empty-project-copy">
                      <strong>{tab.name}</strong>
                      <small className={project?.pathMissing ? 'is-missing' : undefined}>{detail}</small>
                    </span>
                  </button>
                  <button
                    className="empty-project-delete"
                    type="button"
                    onClick={() => onDeleteTab(tab.id)}
                    title="Delete permanently"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
            {recentTabs.length === 0 && <p>{query.trim() ? 'No matches' : 'No recent projects'}</p>}
          </div>
        </div>
      </section>
    </div>
  )
}

function GlobalSearchLauncher({ onOpen }: { onOpen: () => void }): ReactElement {
  return (
    <button className="global-search-launcher" type="button" onClick={onOpen} title="Search">
      <Search size={16} />
      <span>Search</span>
      <kbd>{navigator.userAgent.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  )
}

function NotificationLauncher({ onOpen }: { onOpen: () => void }): ReactElement {
  return (
    <button className="global-search-launcher notification-launcher" type="button" onClick={onOpen} title="Notifications">
      <Bell size={16} />
      <span>Notifications</span>
    </button>
  )
}

function DevTutorialLauncher({ onOpen }: { onOpen: () => void }): ReactElement {
  return (
    <button className="global-search-launcher dev-tutorial-launcher" type="button" onClick={onOpen} title="Replay tutorial">
      <RotateCcw size={16} />
      <span>Replay tutorial</span>
    </button>
  )
}

function NotificationSettingsModal({
  settings,
  feedback,
  isSaving,
  onClose,
  onSave,
  onTest
}: {
  settings: NotificationSettings
  feedback: string
  isSaving: boolean
  onClose: () => void
  onSave: (settings: NotificationSettings) => Promise<void>
  onTest: (settings: NotificationSettings) => Promise<void>
}): ReactElement {
  const [draft, setDraft] = useState(settings)
  useModalEscape(onClose)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const setDesktopEvent = (key: keyof NotificationEventSettings, value: boolean): void => {
    setDraft((current) => ({
      ...current,
      desktopEvents: {
        ...current.desktopEvents,
        [key]: value
      }
    }))
  }

  const setNtfyEvent = (key: keyof NotificationEventSettings, value: boolean): void => {
    setDraft((current) => ({
      ...current,
      ntfy: {
        ...current.ntfy,
        events: {
          ...current.ntfy.events,
          [key]: value
        }
      }
    }))
  }

  const save = (): void => {
    void onSave(draft)
  }

  const test = (): void => {
    void onTest(draft)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section
        className="modal-panel compact notification-settings-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'TEXTAREA') {
            event.preventDefault()
            save()
          }
        }}
      >
        <header className="modal-head">
          <div>
            <h2>Notifications</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>

        <div className="notification-settings-body">
          <section className="settings-section">
            <label className="settings-toggle-row">
              <span>
                <Monitor size={15} />
                <strong>Desktop</strong>
              </span>
              <input
                type="checkbox"
                checked={draft.desktopEnabled}
                onChange={(event) => setDraft((current) => ({ ...current, desktopEnabled: event.target.checked }))}
              />
            </label>
            <NotificationEventChecks
              events={draft.desktopEvents}
              disabled={!draft.desktopEnabled}
              onChange={setDesktopEvent}
            />
          </section>

          <section className="settings-section">
            <label className="settings-toggle-row">
              <span>
                <Smartphone size={15} />
                <strong>ntfy.sh</strong>
              </span>
              <input
                type="checkbox"
                checked={draft.ntfy.enabled}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    ntfy: { ...current.ntfy, enabled: event.target.checked }
                  }))
                }
              />
            </label>
            <div className="settings-fields">
              <label>
                <span>Server</span>
                <input
                  className="settings-input"
                  value={draft.ntfy.serverUrl}
                  disabled={!draft.ntfy.enabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      ntfy: { ...current.ntfy, serverUrl: event.target.value }
                    }))
                  }
                  placeholder="https://ntfy.sh"
                />
              </label>
              <label>
                <span>Topic</span>
                <input
                  className="settings-input"
                  value={draft.ntfy.topic}
                  disabled={!draft.ntfy.enabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      ntfy: { ...current.ntfy, topic: event.target.value }
                    }))
                  }
                  placeholder="your-topic"
                />
              </label>
            </div>
            <NotificationEventChecks events={draft.ntfy.events} disabled={!draft.ntfy.enabled} onChange={setNtfyEvent} />
          </section>
        </div>

        <footer className="modal-actions notification-actions">
          <span className="settings-feedback">{feedback}</span>
          <button className="secondary-action" type="button" onClick={test} disabled={isSaving}>
            Test
          </button>
          <button className="primary-action" type="button" onClick={save} disabled={isSaving}>
            Save
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function NotificationEventChecks({
  events,
  disabled,
  onChange
}: {
  events: NotificationEventSettings
  disabled: boolean
  onChange: (key: keyof NotificationEventSettings, value: boolean) => void
}): ReactElement {
  return (
    <div className="notification-event-grid">
      <label>
        <input
          type="checkbox"
          checked={events.taskCompleted}
          disabled={disabled}
          onChange={(event) => onChange('taskCompleted', event.target.checked)}
        />
        <span>Task completed</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={events.taskFailed}
          disabled={disabled}
          onChange={(event) => onChange('taskFailed', event.target.checked)}
        />
        <span>Task failed</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={events.allTasksFinished}
          disabled={disabled}
          onChange={(event) => onChange('allTasksFinished', event.target.checked)}
        />
        <span>All tasks finished</span>
      </label>
    </div>
  )
}

function CommandSearchPalette({
  query,
  results,
  onChange,
  onClose,
  onOpenResult
}: {
  query: string
  results: SearchResult[]
  onChange: (query: string) => void
  onClose: () => void
  onOpenResult: (result: SearchResult) => void
}): ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const selectedResultRef = useRef<HTMLButtonElement | null>(null)
  const hasQuery = query.trim().length > 0

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query, results.length])

  useEffect(() => {
    selectedResultRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const moveSelection = (direction: 1 | -1): void => {
    if (results.length === 0) return
    setSelectedIndex((current) => (current + direction + results.length) % results.length)
  }

  const onPaletteKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(-1)
      return
    }
    if (event.key === 'Enter' && results[selectedIndex]) {
      event.preventDefault()
      onOpenResult(results[selectedIndex])
    }
  }

  return (
    <div className="command-search-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-search"
        role="dialog"
        aria-modal="true"
        onKeyDown={onPaletteKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="command-search-input">
          <Search size={20} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Search projects, tasks, prompts"
          />
          <kbd>{navigator.userAgent.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
        </label>

        <div className="command-search-results">
          {results.map((result, index) => (
            <button
              key={result.id}
              ref={index === selectedIndex ? selectedResultRef : null}
              className={[
                index === selectedIndex ? 'selected' : '',
                result.taskStatus ? `result-status-${result.taskStatus}` : ''
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => onOpenResult(result)}
            >
              <span className={`search-kind kind-${result.kind}`}>{searchKindLabel(result.kind)}</span>
              <span className="search-result-main">
                <span className="search-result-topline">
                  <strong>{result.title}</strong>
                  {result.meta && <small>{result.meta}</small>}
                </span>
                <span className="search-result-subline">
                  <small>{result.subtitle}</small>
                  {shouldShowSearchMatch(result) && <em>{formatSearchMatch(result.match)}</em>}
                </span>
              </span>
            </button>
          ))}
          {hasQuery && results.length === 0 && <p>No matches</p>}
          {!hasQuery && results.length === 0 && <p>No recent projects</p>}
        </div>
      </section>
    </div>
  )
}

function CursorConnection({
  feedback,
  isInstalling,
  status,
  onRepair
}: {
  feedback: string
  isInstalling: boolean
  status: CursorStatus
  onRepair: () => void
}): ReactElement {
  const hasAgent = Boolean(status.debug.agentCommand)
  return (
    <div className="cursor-card missing">
      <div className="cursor-status-row">
        <div>
          <Code2 size={15} />
          <span>Needs setup</span>
        </div>
        <span className="connection-pill missing">{hasAgent ? 'Login' : 'Missing'}</span>
      </div>
      <div className="cursor-actions">
        <button className="primary-action setup-button" type="button" onClick={onRepair} disabled={isInstalling}>
          <ExternalLink size={15} />
          <span>{isInstalling ? 'Opening' : hasAgent ? 'Login in Terminal' : 'Fix in Terminal'}</span>
        </button>
      </div>
      {feedback && <div className="cursor-feedback">{feedback}</div>}
      {import.meta.env.DEV && <CursorDebugPanel status={status} />}
    </div>
  )
}

function UpdateBanner({
  info,
  onDownload,
  onInstall
}: {
  info: UpdateInfo
  onDownload: () => void
  onInstall: () => void
}): ReactElement {
  const isVisible =
    info.status === 'available' ||
    info.status === 'downloading' ||
    info.status === 'downloaded' ||
    info.status === 'installing' ||
    (info.status === 'error' && Boolean(info.latestVersion || info.releaseUrl))
  if (!isVisible) return <></>

  const isBusy = info.status === 'checking' || info.status === 'downloading' || info.status === 'installing'
  const canDownload = info.status === 'available'
  const canInstall = info.status === 'downloaded'
  const buttonLabel = canInstall
    ? info.mode === 'dev'
      ? 'Show notes'
      : 'Restart'
    : canDownload
      ? info.mode === 'manual'
        ? 'Open release'
        : 'Update'
      : info.status === 'installing'
        ? info.mode === 'dev'
          ? 'Finishing'
          : 'Restarting'
        : 'Downloading'
  const buttonAction = canInstall ? onInstall : onDownload
  const tone =
    info.status === 'available' || info.status === 'downloaded'
      ? 'ready'
      : info.status === 'error'
        ? 'error'
        : 'idle'

  return (
    <section className={`update-banner ${tone}`} aria-live="polite">
      <div className="update-banner-title">
        <Download size={16} />
        <span>{info.latestVersion ? `VibeBoard v${info.latestVersion}` : 'VibeBoard update'}</span>
      </div>
      <div className="update-banner-body">
        <span>{info.message}</span>
        {(info.status === 'downloading' || info.status === 'installing') && (
          <div className="update-progress" aria-label={`Update ${info.progress ?? 0}%`}>
            <span style={{ width: `${info.progress ?? 0}%` }} />
          </div>
        )}
      </div>
      {(canDownload || canInstall || isBusy) && (
        <button className="primary-action" type="button" onClick={buttonAction} disabled={isBusy}>
          {canInstall ? <Check size={15} /> : info.mode === 'manual' ? <ExternalLink size={15} /> : <Download size={15} />}
          <span>{buttonLabel}</span>
        </button>
      )}
    </section>
  )
}

function ReleaseNotesModal({
  release,
  onClose
}: {
  release: PendingReleaseNotes
  onClose: () => void
}): ReactElement {
  useModalEscape(onClose)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section
        className="modal-panel compact release-notes-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape' || event.key === 'Enter') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <header className="modal-head">
          <div>
            <h2>Updated to v{release.version}</h2>
            <p>Release notes</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="release-notes-body">
          <MessageMarkdown content={normalizeReleaseNotes(release.notes)} />
        </div>
        <footer className="modal-actions">
          {release.releaseUrl && (
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                if (release.releaseUrl) void window.vibeboard.openExternalUrl(release.releaseUrl)
              }}
            >
              <ExternalLink size={15} />
              <span>GitHub</span>
            </button>
          )}
          <button className="primary-action" type="button" onClick={onClose} autoFocus>
            Done
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function normalizeReleaseNotes(notes: string | null | undefined): string {
  const content = notes?.trim()
  if (!content) return 'No release notes were provided for this version.'
  if (!/<\/?[a-z][\s\S]*>/i.test(content)) return content
  return htmlReleaseNotesToMarkdown(content) || content.replace(/<[^>]+>/g, '').trim()
}

function htmlReleaseNotesToMarkdown(content: string): string {
  const parser = new DOMParser()
  const document = parser.parseFromString(`<main>${content}</main>`, 'text/html')
  const root = document.querySelector('main')
  if (!root) return ''
  return Array.from(root.childNodes)
    .map((node) => htmlNodeToMarkdown(node).trim())
    .filter(Boolean)
    .join('\n\n')
}

function htmlNodeToMarkdown(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  }
  if (!(node instanceof HTMLElement)) return ''

  const tag = node.tagName.toLowerCase()
  const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text && tag !== 'br') return ''

  if (tag === 'h1') return `# ${text}`
  if (tag === 'h2') return `## ${text}`
  if (tag === 'h3') return `### ${text}`
  if (tag === 'h4') return `#### ${text}`
  if (tag === 'p') return inlineHtmlToMarkdown(node)
  if (tag === 'br') return '\n'
  if (tag === 'ul' || tag === 'ol') {
    return Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((child, index) => `${tag === 'ol' ? `${index + 1}.` : '-'} ${inlineHtmlToMarkdown(child)}`)
      .join('\n')
  }
  if (tag === 'table') return htmlTableToMarkdown(node)
  if (tag === 'blockquote') return inlineHtmlToMarkdown(node).split('\n').map((line) => `> ${line}`).join('\n')
  if (tag === 'pre') return `\`\`\`\n${node.textContent?.trim() ?? ''}\n\`\`\``
  return Array.from(node.childNodes)
    .map((child) => htmlNodeToMarkdown(child).trim())
    .filter(Boolean)
    .join('\n\n') || inlineHtmlToMarkdown(node)
}

function inlineHtmlToMarkdown(element: Element): string {
  return Array.from(element.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
      if (!(node instanceof HTMLElement)) return ''
      const tag = node.tagName.toLowerCase()
      const value = inlineHtmlToMarkdown(node).trim()
      if (!value) return ''
      if (tag === 'code') return `\`${value}\``
      if (tag === 'strong' || tag === 'b') return `**${value}**`
      if (tag === 'em' || tag === 'i') return `_${value}_`
      if (tag === 'a') {
        const href = node.getAttribute('href')
        return href ? `[${value}](${href})` : value
      }
      if (tag === 'br') return '\n'
      return value
    })
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function htmlTableToMarkdown(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.children).map((cell) => inlineHtmlToMarkdown(cell).replace(/\|/g, '\\|'))
  )
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const normalizedRows = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')])
  const header = normalizedRows[0]
  const separator = Array.from({ length: width }, () => '---')
  const body = normalizedRows.slice(1)
  return [header, separator, ...body]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')
}

function readPendingReleaseNotes(): PendingReleaseNotes | null {
  try {
    const raw = localStorage.getItem(pendingReleaseNotesStorageKey)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PendingReleaseNotes>
    if (!value.version) return null
    return {
      version: value.version,
      notes: value.notes ?? null,
      releaseUrl: value.releaseUrl ?? null
    }
  } catch {
    return null
  }
}

function writePendingReleaseNotes(info: UpdateInfo): void {
  if (!info.latestVersion) return
  localStorage.setItem(
    pendingReleaseNotesStorageKey,
    JSON.stringify({
      version: info.latestVersion,
      notes: info.releaseNotes,
      releaseUrl: info.releaseUrl
    } satisfies PendingReleaseNotes)
  )
}

function CursorDebugPanel({ status }: { status: CursorStatus }): ReactElement {
  const debugLines = [
    ['cursor', status.debug.cursorCommand ?? 'not found'],
    ['agent', status.debug.agentCommand ?? 'not found'],
    ['auth', status.debug.authStatus],
    ['install', status.debug.installCommand],
    ['checked cursor', status.debug.checkedCursorCommands.join('\n')],
    ['checked agent', status.debug.checkedAgentCommands.join('\n')],
    ['process PATH', status.debug.processPath],
    ['shell PATH', status.debug.shellPath],
    ['last output', status.debug.lastInstallOutput || 'none']
  ]

  return (
    <details className="cursor-debug">
      <summary>Debug</summary>
      <div>
        {debugLines.map(([label, value]) => (
          <section key={label}>
            <strong>{label}</strong>
            <pre>{value}</pre>
          </section>
        ))}
      </div>
    </details>
  )
}

function TopBar({
  tabs,
  closedTabs,
  projects,
  tabStatuses,
  activeTabId,
  onCloseTab,
  onCreateTab,
  onDeleteTab,
  onReopenTab,
  onReorderTabs,
  onSelectTab,
  onUpdateTabMeta,
  isCreatingProject
}: {
  tabs: BoardTab[]
  closedTabs: BoardTab[]
  projects: Project[]
  tabStatuses: Map<string, Task['status']>
  activeTabId?: string
  onCloseTab: (id: string) => void
  onCreateTab: () => void
  onDeleteTab: (id: string) => void
  onReopenTab: (id: string) => void
  onReorderTabs: (orderedIds: string[]) => void
  onSelectTab: (id: string) => void
  onUpdateTabMeta: (input: { id: string; isPinned?: boolean; color?: string | null }) => void
  isCreatingProject: boolean
}): ReactElement {
  const [menuState, setMenuState] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [closedMenuOpen, setClosedMenuOpen] = useState(false)
  const [closedSearch, setClosedSearch] = useState('')
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [tabDropIndex, setTabDropIndex] = useState<number | null>(null)
  const menuTab = tabs.find((tab) => tab.id === menuState?.tabId) ?? null
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const previewTabs = useMemo(() => {
    if (!draggedTabId || tabDropIndex === null) return tabs
    const draggedTab = tabs.find((tab) => tab.id === draggedTabId)
    if (!draggedTab) return tabs

    const otherTabs = tabs.filter((tab) => tab.id !== draggedTabId)
    const nextTabs = [...otherTabs]
    nextTabs.splice(Math.max(0, Math.min(tabDropIndex, nextTabs.length)), 0, draggedTab)
    return nextTabs
  }, [draggedTabId, tabDropIndex, tabs])
  const filteredClosedTabs = useMemo(() => {
    const query = closedSearch.trim().toLowerCase()
    const source = query
      ? closedTabs.filter((tab) => {
          const project = tab.activeProjectId ? projectById.get(tab.activeProjectId) : null
          return [tab.name, project?.name, project?.path]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(query))
        })
      : closedTabs
    return source.slice(0, 12)
  }, [closedSearch, closedTabs, projectById])

  useEffect(() => {
    if (!menuState && !closedMenuOpen) return
    const close = (): void => {
      setMenuState(null)
      setClosedMenuOpen(false)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuState, closedMenuOpen])

  const moveTab = (draggedId: string, position: number): void => {
    const draggedTab = tabs.find((tab) => tab.id === draggedId)
    if (!draggedTab) return

    const nextTabs = tabs.filter((tab) => tab.id !== draggedId)
    nextTabs.splice(Math.max(0, Math.min(position, nextTabs.length)), 0, draggedTab)
    const nextIds = nextTabs.map((tab) => tab.id)
    if (nextIds.every((id, index) => id === tabs[index]?.id)) return
    onReorderTabs(nextIds)
  }

  const getTabDropIndex = (event: ReactDragEvent<HTMLElement>, targetTabId?: string): number => {
    if (!draggedTabId) return 0
    const otherTabs = tabs.filter((tab) => tab.id !== draggedTabId)
    if (!targetTabId || targetTabId === draggedTabId) return otherTabs.length

    const targetIndex = otherTabs.findIndex((tab) => tab.id === targetTabId)
    if (targetIndex < 0) return otherTabs.length

    const targetRect = event.currentTarget.getBoundingClientRect()
    const shouldInsertAfter = event.clientX > targetRect.left + targetRect.width / 2
    return targetIndex + (shouldInsertAfter ? 1 : 0)
  }

  const handleTabDragStart = (event: ReactDragEvent<HTMLDivElement>, tabId: string): void => {
    setDraggedTabId(tabId)
    setTabDropIndex(tabs.findIndex((tab) => tab.id === tabId))
    setMenuState(null)
    setClosedMenuOpen(false)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tabId)
  }

  const handleTabDragOver = (event: ReactDragEvent<HTMLDivElement>, tabId: string): void => {
    if (!draggedTabId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (draggedTabId === tabId) return
    setTabDropIndex(getTabDropIndex(event, tabId))
  }

  const handleTabsDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!draggedTabId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (event.currentTarget === event.target) {
      setTabDropIndex(tabs.filter((tab) => tab.id !== draggedTabId).length)
    }
  }

  const handleTabDrop = (event: ReactDragEvent<HTMLElement>, targetTabId?: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const draggedId = event.dataTransfer.getData('text/plain') || draggedTabId
    if (draggedId) {
      moveTab(draggedId, tabDropIndex ?? getTabDropIndex(event, targetTabId))
    }
    setDraggedTabId(null)
    setTabDropIndex(null)
  }

  const clearTabDrag = (): void => {
    setDraggedTabId(null)
    setTabDropIndex(null)
  }

  return (
    <div className="tabs-bar">
      <div
        className={draggedTabId ? 'tabs dragging-tab' : 'tabs'}
        data-tour="tabs"
        onDragOver={handleTabsDragOver}
        onDrop={(event) => handleTabDrop(event)}
      >
        {previewTabs.map((tab) => (
          <div
            key={tab.id}
            draggable
            className={`tab status-${tabStatuses.get(tab.id) ?? 'idle'} ${tab.id === activeTabId ? 'active' : ''} ${
              draggedTabId === tab.id ? 'dragging' : ''
            }`}
            style={
              {
                '--tab-bg': tab.color ? hexToRgba(tab.color, tab.id === activeTabId ? 0.24 : 0.14) : '#202020'
              } as React.CSSProperties
            }
            title={tab.name}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenuState({ tabId: tab.id, x: event.clientX, y: event.clientY })
            }}
            onDragStart={(event) => handleTabDragStart(event, tab.id)}
            onDragOver={(event) => handleTabDragOver(event, tab.id)}
            onDrop={(event) => handleTabDrop(event, tab.id)}
            onDragEnd={clearTabDrag}
          >
            <button className="tab-select" type="button" onClick={() => onSelectTab(tab.id)}>
              {tab.isPinned ? <Pin size={12} /> : null}
              <span className="tab-status-dot" aria-hidden="true" />
              <span>{tab.name}</span>
            </button>
            <button
              className="tab-close"
              type="button"
              title="Close project"
              onClick={(event) => {
                event.stopPropagation()
                onCloseTab(tab.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tabs-actions">
        <button className="icon-button" type="button" onClick={onCreateTab} disabled={isCreatingProject} title="Add project">
          <Plus size={17} />
        </button>
        {closedTabs.length > 0 && (
          <div className="closed-tabs-wrap" onClick={(event) => event.stopPropagation()}>
            <button
              className="icon-button"
              type="button"
              onClick={() => {
                setMenuState(null)
                setClosedMenuOpen((value) => !value)
              }}
              title="Closed projects"
            >
              <History size={17} />
            </button>
            {closedMenuOpen && (
              <div className="closed-tabs-menu">
                <div className="closed-tabs-head">
                  <span>Closed projects</span>
                  <small>{closedTabs.length}</small>
                </div>
                <label className="closed-tabs-search">
                  <Search size={14} />
                  <input
                    value={closedSearch}
                    onChange={(event) => setClosedSearch(event.target.value)}
                    placeholder="Search recent projects"
                  />
                </label>
                <div className="closed-tabs-list">
                  {filteredClosedTabs.map((tab) => {
                    const project = tab.activeProjectId ? projectById.get(tab.activeProjectId) : null
                    const detail = project?.pathMissing
                      ? 'Missing folder'
                      : project?.path
                        ? compactPath(project.path)
                        : 'Closed board'

                    return (
                      <div className="closed-tab-row" key={tab.id}>
                        <button
                          className="closed-tab-restore"
                          type="button"
                          title={tab.name}
                          onClick={() => {
                            onReopenTab(tab.id)
                            setClosedMenuOpen(false)
                          }}
                        >
                          <span className="closed-tab-icon">
                            <RotateCcw size={15} />
                          </span>
                          <span className="closed-tab-copy">
                            <strong>{tab.name}</strong>
                            <small className={project?.pathMissing ? 'is-missing' : undefined}>{detail}</small>
                          </span>
                        </button>
                        <button
                          className="closed-tab-delete"
                          type="button"
                          title="Delete permanently"
                          onClick={() => {
                            onDeleteTab(tab.id)
                            setClosedMenuOpen(false)
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )
                  })}
                </div>
                {filteredClosedTabs.length === 0 && <p className="closed-tabs-empty">No matches</p>}
              </div>
            )}
          </div>
        )}
      </div>
      {menuTab && (
        <div
          className="tab-menu"
          style={{ left: menuState?.x ?? 12, top: menuState?.y ?? 42 }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              onUpdateTabMeta({ id: menuTab.id, isPinned: !menuTab.isPinned })
              setMenuState(null)
            }}
          >
            {menuTab.isPinned ? 'Unpin project' : 'Pin project'}
          </button>
          <div className="tab-color-grid">
            {tabColors.map((color) => (
              <button
                key={color}
                type="button"
                className="tab-color-swatch"
                style={{ background: color }}
                title={color}
                onClick={() => {
                  onUpdateTabMeta({ id: menuTab.id, color })
                  setMenuState(null)
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              onUpdateTabMeta({ id: menuTab.id, color: null })
              setMenuState(null)
            }}
          >
            Clear color
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseTab(menuTab.id)
              setMenuState(null)
            }}
          >
            Close project
          </button>
          <button
            type="button"
            onClick={() => {
              onDeleteTab(menuTab.id)
              setMenuState(null)
            }}
          >
            Delete project tab
          </button>
        </div>
      )}
    </div>
  )
}

function DeleteTabModal({
  tab,
  canDelete,
  onClose,
  onConfirm
}: {
  tab: BoardTab | null
  canDelete: boolean
  onClose: () => void
  onConfirm: () => void
}): ReactElement {
  const [draft, setDraft] = useState('')
  const isConfirmed = draft.trim().toLowerCase() === 'confirm'
  useModalEscape(onClose)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section
        className="modal-panel compact confirm-modal"
        role="dialog"
        aria-modal="true"
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Enter' && isConfirmed && canDelete) {
            event.preventDefault()
            onConfirm()
          }
        }}
      >
        <header className="modal-head">
          <div>
            <h2>Delete project tab</h2>
            <p>{tab?.name ?? 'Project'}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="confirm-body">
          <p>Permanent delete removes this project tab, its lanes, tasks, chat, and code changes.</p>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="confirm"
            autoFocus
          />
        </div>
        <footer className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>
            Cancel
            <span className="key-hint">Esc</span>
          </button>
          <button className="danger-action" type="button" disabled={!isConfirmed || !canDelete} onClick={onConfirm}>
            Delete
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function closeOnBackdropMouseDown(onClose: () => void): (event: ReactMouseEvent<HTMLElement>) => void {
  return (event) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }
}

function useModalEscape(onClose: () => void): void {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [onClose])
}

function DeleteTaskModal({
  task,
  onClose,
  onConfirm
}: {
  task: Task | null
  onClose: () => void
  onConfirm: () => void
}): ReactElement {
  useModalEscape(onClose)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section
        className="modal-panel compact confirm-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onConfirm()
          }
        }}
      >
        <header className="modal-head">
          <div>
            <h2>Delete task</h2>
            <p>{task?.title ?? 'Task'}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="confirm-body">
          <p>
            This removes the task, its chat, and captured code changes.
            {task?.branchName || task?.worktreePath
              ? ' Its worktree and branch are deleted locally and on origin when present.'
              : ''}
          </p>
        </div>
        <footer className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose} autoFocus>
            Cancel
            <span className="key-hint">Esc</span>
          </button>
          <button className="danger-action" type="button" onClick={onConfirm}>
            Delete
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function DeleteLaneModal({
  lane,
  taskCount,
  onClose,
  onConfirm
}: {
  lane: Lane | null
  taskCount: number
  onClose: () => void
  onConfirm: () => void
}): ReactElement {
  useModalEscape(onClose)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section
        className="modal-panel compact confirm-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onConfirm()
          }
        }}
      >
        <header className="modal-head">
          <div>
            <h2>Delete lane</h2>
            <p>{lane?.name ?? 'Lane'}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="confirm-body">
          <p>
            {taskCount > 0
              ? `This removes the lane and ${taskCount} task${taskCount === 1 ? '' : 's'} inside it.`
              : 'This removes the empty lane.'}
          </p>
        </div>
        <footer className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose} autoFocus>
            Cancel
            <span className="key-hint">Esc</span>
          </button>
          <button className="danger-action" type="button" onClick={onConfirm}>
            Delete
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function QuitConfirmModal({
  hasRunningTasks,
  onClose,
  onConfirm
}: {
  hasRunningTasks: boolean
  onClose: () => void
  onConfirm: () => void
}): ReactElement {
  useModalEscape(onClose)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section
        className="modal-panel compact confirm-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onConfirm()
          }
        }}
      >
        <header className="modal-head">
          <div>
            <h2>Quit VibeBoard</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="confirm-body">
          <p>{hasRunningTasks ? 'An AI task is still running. Quitting now may interrupt it.' : 'Close VibeBoard now?'}</p>
        </div>
        <footer className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose} autoFocus>
            Cancel
            <span className="key-hint">Esc</span>
          </button>
          <button className="danger-action" type="button" onClick={onConfirm}>
            Quit
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function SidebarStat({
  label,
  value,
  tone = 'neutral'
}: {
  label: string
  value: number
  tone?: 'neutral' | 'orange' | 'red' | 'green'
}): ReactElement {
  return (
    <div className={`sidebar-stat tone-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function LaneColumn({
  lane,
  tasks,
  activeDragTaskId,
  dropPreviewPosition,
  onOpenTask,
  onAddTask,
  onDeleteLane,
  onDeleteTask,
  onFinishTask,
  onRenameTask,
  canDelete,
  onRenameLane
}: {
  lane: Lane
  tasks: Task[]
  activeDragTaskId: string | null
  dropPreviewPosition: number | null
  onOpenTask: (task: Task) => void
  onAddTask: () => void
  onDeleteLane: (id: string) => void
  onDeleteTask: (id: string) => void
  onFinishTask: (id: string) => void
  onRenameTask: (id: string) => void
  canDelete: boolean
  onRenameLane: (id: string, name: string) => void
}): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id })
  let visibleTaskIndex = 0

  return (
    <section className={isOver ? 'lane over' : 'lane'} ref={setNodeRef}>
      <header className="lane-header">
        <EditableTitle
          className="lane-title-input"
          value={lane.name}
          onCommit={(name) => onRenameLane(lane.id, name)}
        />
        <div className="lane-header-actions">
          <span>{tasks.length}</span>
          {canDelete && (
            <button
              className="lane-delete-button"
              type="button"
              title="Delete lane"
              onClick={() => onDeleteLane(lane.id)}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list">
          {tasks.map((task) => {
            const isActiveDragTask = task.id === activeDragTaskId
            const shouldShowDropPreview = dropPreviewPosition === visibleTaskIndex && !isActiveDragTask
            const card = (
              <TaskCard
                key={task.id}
                task={task}
                onOpen={() => onOpenTask(task)}
                onDelete={() => onDeleteTask(task.id)}
                onFinish={() => onFinishTask(task.id)}
                onRename={() => onRenameTask(task.id)}
              />
            )

            if (isActiveDragTask) return card

            visibleTaskIndex += 1
            return (
              <div className="task-stack-item" key={task.id}>
                {shouldShowDropPreview && <TaskDropPreview />}
                {card}
              </div>
            )
          })}
          {dropPreviewPosition === visibleTaskIndex && <TaskDropPreview />}
        </div>
      </SortableContext>
      <button className="add-task-button" type="button" onClick={onAddTask}>
        <Plus size={16} />
        <span>Task</span>
      </button>
    </section>
  )
}

function EditableTitle({
  value,
  className,
  onCommit
}: {
  value: string
  className: string
  onCommit: (value: string) => void
}): ReactElement {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = (): void => {
    const next = draft.trim()
    if (next && next !== value) {
      onCommit(next)
    } else {
      setDraft(value)
    }
  }

  return (
    <input
      className={className}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
      aria-label="Name"
    />
  )
}

function TaskCard({
  task,
  onOpen,
  onDelete,
  onFinish,
  onRename
}: {
  task: Task
  onOpen: () => void
  onDelete: () => void
  onFinish: () => void
  onRename: () => void
}): ReactElement {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id
  })
  const style = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition
  }
  const canMutate = task.status !== 'processing'
  const canFinish = canMutate && task.status !== 'done_unread' && task.status !== 'done_read'

  const closeMenu = (): void => {
    setIsMenuOpen(false)
    setMenuPosition(null)
  }

  useEffect(() => {
    if (!isMenuOpen) return

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [isMenuOpen])

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-card status-${task.status} ${isDragging ? 'dragging' : ''} ${isMenuOpen ? 'menu-open' : ''}`}
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="task-open">
        <div className="task-title-row">
          <h3>{task.title}</h3>
          <TaskStatusChip status={task.status} />
        </div>
        {task.summary && <p>{task.summary}</p>}
      </div>
      {canMutate && (
        <div className={isMenuOpen ? 'task-card-actions open' : 'task-card-actions'} aria-label="Task actions">
          <button
            className="task-action-button"
            type="button"
            title="Task options"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={(event) => {
              event.stopPropagation()
              if (isMenuOpen) {
                closeMenu()
                return
              }
              const rect = event.currentTarget.getBoundingClientRect()
              setMenuPosition({
                top: rect.bottom + 4,
                left: Math.max(8, rect.right - 146)
              })
              setIsMenuOpen(true)
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Ellipsis size={15} />
          </button>
        </div>
      )}
      {isMenuOpen &&
        menuPosition &&
        createPortal(
          <div className="task-action-overlay" role="presentation">
            <button
              className="task-action-menu-backdrop"
              type="button"
              aria-label="Close task menu"
              onClick={closeMenu}
              onPointerDown={(event) => event.stopPropagation()}
            />
            <div
              className="task-action-menu"
              role="menu"
              style={{ top: menuPosition.top, left: menuPosition.left }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  closeMenu()
                  onRename()
                }}
              >
                <Pencil size={15} />
                <span>Rename task</span>
              </button>
              {canFinish && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeMenu()
                    onFinish()
                  }}
                >
                  <Check size={15} />
                  <span>Finish task</span>
                </button>
              )}
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  closeMenu()
                  onDelete()
                }}
              >
                <Trash2 size={15} />
                <span>Delete task</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </article>
  )
}

function TaskCardPreview({ task, width }: { task: Task; width: number | null }): ReactElement {
  return (
    <article
      className={`task-card drag-preview status-${task.status}`}
      style={width ? { width } : undefined}
    >
      <div className="task-open">
        <div className="task-title-row">
          <h3>{task.title}</h3>
          <TaskStatusChip status={task.status} />
        </div>
        {task.summary && <p>{task.summary}</p>}
      </div>
    </article>
  )
}

function TaskDropPreview(): ReactElement {
  return <div className="task-drop-preview" aria-hidden="true" />
}

function TaskStatusChip({ status }: { status: Task['status'] }): ReactElement | null {
  if (status === 'attention') {
    return (
      <span className="task-status-chip attention" title="Needs you">
        <AlertTriangle size={12} />
        <span>Needs you</span>
      </span>
    )
  }

  if (status === 'done_unread' || status === 'done_read') {
    return (
      <span className="task-status-chip done" title={status === 'done_unread' ? 'Done' : 'Done read'}>
        <Check size={13} />
      </span>
    )
  }

  return null
}

interface NewTaskInput {
  title: string
}

function TaskFormModal({
  onClose,
  onSubmit
}: {
  onClose: () => void
  onSubmit: (input: NewTaskInput) => void
}): ReactElement {
  const [title, setTitle] = useState('')
  const formRef = useRef<HTMLFormElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  useModalEscape(onClose)

  useEffect(() => {
    const titleInput = titleRef.current
    if (!titleInput) return
    titleInput.style.height = '0px'
    titleInput.style.height = `${Math.min(titleInput.scrollHeight, 112)}px`
  }, [title])

  return (
    <div className="modal-backdrop" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <form
        ref={formRef}
        className="task-form modal-panel compact"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit({ title })
        }}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            formRef.current?.requestSubmit()
          }
        }}
      >
        <div className="modal-head">
          <h2>New task</h2>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <label>
          <span>Title</span>
          <textarea
            ref={titleRef}
            className="task-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
            rows={1}
          />
        </label>

        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>
            Cancel
            <span className="key-hint">Esc</span>
          </button>
          <button className="primary-action" type="submit">
            <Plus size={18} />
            <span>Create</span>
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </div>
      </form>
    </div>
  )
}

function RenameTaskModal({
  task,
  onClose,
  onSubmit
}: {
  task: Task | null
  onClose: () => void
  onSubmit: (title: string) => void
}): ReactElement {
  const [title, setTitle] = useState(task?.title ?? '')
  const formRef = useRef<HTMLFormElement | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  useModalEscape(onClose)

  useEffect(() => {
    setTitle(task?.title ?? '')
  }, [task?.title])

  useEffect(() => {
    const titleInput = titleRef.current
    if (!titleInput) return
    titleInput.style.height = '0px'
    titleInput.style.height = `${Math.min(titleInput.scrollHeight, 112)}px`
  }, [title])

  useEffect(() => {
    const titleInput = titleRef.current
    titleInput?.focus()
    titleInput?.select()
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <form
        ref={formRef}
        className="task-form modal-panel compact"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(title)
        }}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            formRef.current?.requestSubmit()
          }
        }}
      >
        <div className="modal-head">
          <h2>Rename task</h2>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <label>
          <span>Title</span>
          <textarea
            ref={titleRef}
            className="task-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            rows={1}
          />
        </label>

        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>
            Cancel
            <span className="key-hint">Esc</span>
          </button>
          <button className="primary-action" type="submit" disabled={!title.trim()}>
            <Pencil size={16} />
            <span>Save</span>
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </div>
      </form>
    </div>
  )
}

function formatTaskRunElapsed(startedAt: string, nowMs: number): string {
  const startedMs = Date.parse(startedAt)
  if (!Number.isFinite(startedMs)) return '0s'
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
  return `${seconds}s`
}

function TaskRunElapsed({ startedAt }: { startedAt: string }): ReactElement {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  return (
    <span className="task-run-elapsed" title="Time since this run started">
      {formatTaskRunElapsed(startedAt, nowMs)}
    </span>
  )
}

function TaskDetailModal({
  task,
  project,
  conversations,
  changes,
  hasOlderConversations,
  isLoadingOlderConversations,
  canUseCursor,
  onLoadOlderConversations,
  onSendMessage,
  onRetryTask,
  onRetryPrompt,
  onStopTask,
  onDeleteTask,
  onClose
}: {
  task: Task
  project: Project | null
  conversations: ConversationEntry[]
  changes: CodeChange[]
  hasOlderConversations: boolean
  isLoadingOlderConversations: boolean
  canUseCursor: boolean
  onLoadOlderConversations: () => void
  onSendMessage: (taskId: string, content: string, attachments?: TaskMessageAttachmentInput[]) => void
  onRetryTask: (taskId: string) => void
  onRetryPrompt: (taskId: string) => void
  onStopTask: (taskId: string) => void
  onDeleteTask: (taskId: string) => void
  onClose: () => void
}): ReactElement {
  const canChat = Boolean(project) && canUseCursor
  const canRetry = canChat && task.status === 'attention'
  const isRunning = task.status === 'processing'
  const lastUserMessageAt =
    [...conversations].reverse().find((entry) => entry.role === 'user')?.createdAt ?? null
  // Prefer the persisted run start; never use updatedAt (it moves with live progress).
  const runStartedAt = task.runStartedAt ?? (isRunning ? lastUserMessageAt : null)
  const lastPrompt =
    [...conversations].reverse().find((entry) => entry.role === 'user')?.content.trim() ||
    task.summary.trim() ||
    task.title.trim()
  const canRetryPrompt = Boolean(project) && canUseCursor && Boolean(lastPrompt)
  const hasCapturedChanges = changes.length > 0
  const [showCodeChanges, setShowCodeChanges] = useState(readShowCodeChangesPreference)
  useModalEscape(onClose)

  const requestCommit = (): void => {
    if (!canChat || isRunning || !hasCapturedChanges) return
    onSendMessage(task.id, commitTaskPrompt)
  }

  const requestDraftPr = (): void => {
    if (!canChat || isRunning || !hasCapturedChanges) return
    onSendMessage(task.id, draftPrPrompt)
  }

  const requestRevert = (): void => {
    if (!canChat || isRunning || !hasCapturedChanges) return
    onSendMessage(task.id, buildRevertTaskPrompt(changes))
  }

  const requestRetry = (): void => {
    if (!canRetry) return
    onRetryTask(task.id)
  }

  const setCodeChangesVisible = (visible: boolean): void => {
    setShowCodeChanges(visible)
    writeShowCodeChangesPreference(visible)
  }

  return (
    <div className="modal-backdrop" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section className="modal-panel task-detail">
        <div className="modal-head">
          <div>
            <h2>{task.title}</h2>
            <p className="task-detail-meta">
              {isRunning && runStartedAt && (
                <span className="task-run-status">
                  <span className="task-run-status-label">Running</span>
                  <TaskRunElapsed startedAt={runStartedAt} />
                </span>
              )}
              <span>{project?.name ?? 'No project'}</span>
            </p>
          </div>
          <div className="modal-head-actions">
            {isRunning && (
              <button
                className="icon-text-button task-stop-action"
                type="button"
                onClick={() => onStopTask(task.id)}
                title="Stop the current task run"
              >
                <Square size={14} />
                <span>Stop</span>
              </button>
            )}
            {canRetry && (
              <button
                className="icon-text-button task-retry-action"
                type="button"
                onClick={requestRetry}
                title="Retry with the saved task conversation"
              >
                <RotateCcw size={16} />
                <span>Retry</span>
              </button>
            )}
            {hasCapturedChanges && (
              <>
                <button
                  className="icon-text-button task-git-action"
                  type="button"
                  onClick={requestCommit}
                  disabled={!canChat || isRunning}
                  title="Ask agent to commit these changes and push to the default branch on origin"
                >
                  <GitCommitHorizontal size={16} />
                  <span>Commit</span>
                </button>
                <button
                  className="icon-text-button task-git-action"
                  type="button"
                  onClick={requestDraftPr}
                  disabled={!canChat || isRunning}
                  title="Ask agent to create a draft pull request"
                >
                  <GitPullRequestDraft size={16} />
                  <span>Draft PR</span>
                </button>
                <button
                  className="icon-text-button task-git-action danger"
                  type="button"
                  onClick={requestRevert}
                  disabled={!canChat || isRunning}
                  title="Ask agent to revert this task's captured changes"
                >
                  <Undo2 size={16} />
                  <span>Revert</span>
                </button>
              </>
            )}
            <label
              className="code-changes-switch"
              title={showCodeChanges ? 'Hide code changes and enlarge chat' : 'Show code changes'}
            >
              <Code2 size={14} />
              <span>Changes</span>
              <input
                type="checkbox"
                checked={showCodeChanges}
                onChange={(event) => setCodeChangesVisible(event.target.checked)}
              />
            </label>
            <button
              className="icon-text-button task-git-action danger"
              type="button"
              onClick={() => onDeleteTask(task.id)}
              disabled={task.status === 'processing'}
              title="Delete task"
            >
              <Trash2 size={16} />
              <span>Delete</span>
            </button>
            <button className="icon-button" type="button" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={showCodeChanges ? 'detail-grid' : 'detail-grid detail-grid-chat-only'}>
          <section className="detail-column">
            <AgentThread
              key={task.id}
              conversations={conversations}
              task={task}
              queuedMessages={task.queuedMessages ?? []}
              hasOlderConversations={hasOlderConversations}
              isLoadingOlderConversations={isLoadingOlderConversations}
              canSend={canChat}
              canRetryPrompt={canRetryPrompt}
              disabledLabel={!canUseCursor ? 'Cursor not connected' : !project ? 'No project selected' : 'Unavailable'}
              onLoadOlderConversations={onLoadOlderConversations}
              onSendMessage={onSendMessage}
              onRetryPrompt={onRetryPrompt}
            />
          </section>

          {showCodeChanges && (
            <section className="detail-column">
              <div className="section-title">
                <Code2 size={16} />
                <span>Code changes</span>
              </div>
              <div className="change-stack">
                {changes.length > 0 && <ChangeSummary changes={changes} />}
                <div className="change-list">
                  {changes.length === 0 ? (
                    <div className="detail-empty-state">No changes captured</div>
                  ) : (
                    changes.map((change) => <DiffViewer key={change.id} change={change} />)
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  )
}

function AgentThread({
  conversations,
  task,
  queuedMessages,
  hasOlderConversations,
  isLoadingOlderConversations,
  canSend,
  canRetryPrompt,
  disabledLabel,
  onLoadOlderConversations,
  onSendMessage,
  onRetryPrompt
}: {
  conversations: ConversationEntry[]
  task: Task
  queuedMessages: QueuedTaskMessage[]
  hasOlderConversations: boolean
  isLoadingOlderConversations: boolean
  canSend: boolean
  canRetryPrompt: boolean
  disabledLabel: string
  onLoadOlderConversations: () => void
  onSendMessage: (taskId: string, content: string, attachments?: TaskMessageAttachmentInput[]) => void
  onRetryPrompt: (taskId: string) => void
}): ReactElement {
  const [draft, setDraft] = useState(() => readTaskComposerDraft(task.id))
  const [pendingAttachments, setPendingAttachments] = useState<PendingComposerAttachment[]>([])
  const streamRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const olderScrollSnapshotRef = useRef<{ height: number; top: number } | null>(null)
  const lastAssistantIndex = conversations.reduce(
    (lastIndex, entry, index) => (entry.role === 'assistant' ? index : lastIndex),
    -1
  )
  const isRunning = task.status === 'processing'
  const threadEntries = compactConversationEntries(
    conversations
      .filter((entry, index) => {
        if (isNoisyConversationEntry(entry)) return false
        if (entry.role !== 'system') return true
        if (isUselessSystemStatusFragment(entry.content)) return false
        // Live status prints are only useful while the agent is still running.
        if (task.status === 'processing') return true
        // After the AI returns a message, drop preceding system status updates.
        // Keep system rows when they are the only feedback, or when they follow the reply (e.g. failure notes).
        if (task.status === 'attention') {
          return lastAssistantIndex === -1 || index > lastAssistantIndex
        }
        return false
      })
      .map((entry) => ({
        ...entry,
        content:
          entry.role === 'user'
            ? entry.content.trim()
            : entry.role === 'system'
              ? cleanSystemConversationContent(entry.content)
              : cleanConversationContent(entry.content)
      }))
      .filter((entry) => entry.content || (entry.attachments?.length ?? 0) > 0)
  )
  const scrollKey = `${task.status}:${queuedMessages.length}:${threadEntries.map((entry) => `${entry.id}:${entry.content.length}:${entry.attachments?.length ?? 0}`).join('|')}`
  const canSubmit = canSend && (Boolean(draft.trim()) || pendingAttachments.length > 0)
  const composerPlaceholder = !canSend
    ? disabledLabel
    : isRunning
      ? queuedMessages.length > 0
        ? `Queue a follow-up (${queuedMessages.length} waiting)`
        : 'Queue a follow-up for when this run finishes'
      : 'Message or paste an image'

  useEffect(() => {
    setDraft(readTaskComposerDraft(task.id))
    setPendingAttachments([])
  }, [task.id])

  useEffect(() => {
    writeTaskComposerDraft(task.id, draft)
  }, [draft, task.id])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    composer.style.height = '36px'
    composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 36), 120)}px`
  }, [draft])

  useEffect(() => {
    const stream = streamRef.current
    if (!stream) return

    const frameId = window.requestAnimationFrame(() => {
      const olderSnapshot = olderScrollSnapshotRef.current
      if (olderSnapshot) {
        olderScrollSnapshotRef.current = null
        stream.scrollTop = stream.scrollHeight - olderSnapshot.height + olderSnapshot.top
        return
      }
      stream.scrollTop = stream.scrollHeight
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [scrollKey])

  const maybeLoadOlder = (): void => {
    const stream = streamRef.current
    if (!stream || !hasOlderConversations || isLoadingOlderConversations) return
    if (stream.scrollTop > 24) return
    olderScrollSnapshotRef.current = {
      height: stream.scrollHeight,
      top: stream.scrollTop
    }
    onLoadOlderConversations()
  }

  const handleStreamScroll = (): void => {
    maybeLoadOlder()
  }

  const addImageFiles = async (files: File[]): Promise<void> => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    const nextAttachments = await Promise.all(imageFiles.map((file) => fileToPendingAttachment(file)))
    setPendingAttachments((current) => [...current, ...nextAttachments].slice(0, 6))
  }

  const send = (): void => {
    const content = draft.trim()
    if (!canSend || (!content && pendingAttachments.length === 0)) return
    onSendMessage(
      task.id,
      content,
      pendingAttachments.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 }))
    )
    writeTaskComposerDraft(task.id, '')
    setDraft('')
    setPendingAttachments([])
  }

  const useTemplate = (template: string): void => {
    setDraft((current) => {
      const trimmed = current.trim()
      return trimmed ? `${trimmed}\n\n${template}` : template
    })
    window.requestAnimationFrame(() => composerRef.current?.focus())
  }

  return (
    <div className="agent-thread">
      <div className="agent-stream" ref={streamRef} onScroll={handleStreamScroll}>
        {isLoadingOlderConversations && <div className="thread-empty-state">Loading earlier messages</div>}
        {threadEntries.length === 0 ? (
          <div className="thread-empty-state">
            Chat is empty
          </div>
        ) : (
          threadEntries.map((entry) => (
            <div
              key={entry.id}
              className={`agent-step role-${entry.role}`}
            >
              {entry.role === 'user' ? <MessageSquare size={16} /> : <Code2 size={16} />}
              <div>
                <strong className="agent-step-label">
                  {entry.role === 'user'
                    ? 'You'
                    : entry.role === 'assistant'
                      ? 'Agent'
                      : isThinkingSystemStatus(entry.content)
                        ? 'Thinking'
                        : 'System'}
                </strong>
                {entry.role === 'user' ? (
                  <div className="user-message-bubble">
                    <MessageAttachments attachments={entry.attachments} />
                    {entry.content ? <MessageMarkdown content={entry.content} /> : null}
                  </div>
                ) : (
                  <MessageMarkdown content={entry.content} />
                )}
              </div>
            </div>
          ))
        )}
        {queuedMessages.map((queued, index) => (
          <div key={queued.id} className="agent-step role-user is-queued">
            <MessageSquare size={16} />
            <div>
              <strong className="agent-step-label">
                Queued{queuedMessages.length > 1 ? ` · ${index + 1}` : ''}
              </strong>
              <div className="user-message-bubble queued-message-bubble">
                <MessageAttachments attachments={queued.attachments} />
                {queued.content ? <MessageMarkdown content={queued.content} /> : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {(canSend || canRetryPrompt) && (
        <div className="prompt-template-row" aria-label="Prompt templates">
          {canRetryPrompt && (
            <button
              className="template-chip"
              type="button"
              onClick={() => onRetryPrompt(task.id)}
              title={
                task.status === 'processing'
                  ? 'Stop the current run and re-send the last prompt'
                  : 'Re-send the last prompt'
              }
            >
              Retry prompt
            </button>
          )}
          {canSend &&
            promptTemplates.map((template) => (
              <button
                key={template.label}
                className="template-chip"
                type="button"
                onClick={() => useTemplate(template.prompt)}
              >
                {template.label}
              </button>
            ))}
        </div>
      )}

      {pendingAttachments.length > 0 && (
        <div className="composer-attachments" aria-label="Pending attachments">
          {pendingAttachments.map((attachment) => (
            <div key={attachment.id} className="composer-attachment">
              <img src={attachment.dataUrl} alt={attachment.name} />
              <button
                className="composer-attachment-remove"
                type="button"
                title="Remove attachment"
                onClick={() =>
                  setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id))
                }
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="thread-composer">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            void addImageFiles(files)
            event.target.value = ''
          }}
        />
        <button
          className="icon-button"
          type="button"
          disabled={!canSend}
          title="Attach image"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={16} />
        </button>
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!canSend}
          rows={1}
          placeholder={composerPlaceholder}
          onPaste={(event) => {
            const files = collectClipboardImageFiles(event.clipboardData)
            if (files.length === 0) return
            event.preventDefault()
            void addImageFiles(files)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button
          className="icon-button"
          type="button"
          onClick={send}
          disabled={!canSubmit}
          title={isRunning ? 'Queue message' : 'Send'}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

function MessageAttachments({ attachments }: { attachments?: ConversationAttachment[] }): ReactElement | null {
  const [preview, setPreview] = useState<ConversationAttachment | null>(null)
  if (!attachments || attachments.length === 0) return null
  return (
    <>
      <div className="message-attachments">
        {attachments.map((attachment) =>
          attachment.dataUrl ? (
            <button
              key={attachment.id}
              type="button"
              className="message-attachment"
              title={`View ${attachment.name}`}
              onClick={() => setPreview(attachment)}
            >
              <img src={attachment.dataUrl} alt={attachment.name} />
            </button>
          ) : (
            <div key={attachment.id} className="message-attachment message-attachment-missing">
              {attachment.name}
            </div>
          )
        )}
      </div>
      {preview?.dataUrl ? (
        <AttachmentImagePreview
          name={preview.name}
          dataUrl={preview.dataUrl}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  )
}

function AttachmentImagePreview({
  name,
  dataUrl,
  onClose
}: {
  name: string
  dataUrl: string
  onClose: () => void
}): ReactElement {
  useModalEscape(onClose)

  return (
    <div
      className="attachment-preview-backdrop"
      role="presentation"
      onMouseDown={closeOnBackdropMouseDown(onClose)}
    >
      <div
        className="attachment-preview-panel"
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="attachment-preview-head">
          <span title={name}>{name}</span>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <img className="attachment-preview-image" src={dataUrl} alt={name} />
      </div>
    </div>
  )
}

interface PendingComposerAttachment {
  id: string
  name: string
  mimeType: string
  dataBase64: string
  dataUrl: string
}

async function fileToPendingAttachment(file: File): Promise<PendingComposerAttachment> {
  const dataUrl = await readFileAsDataUrl(file)
  const commaIndex = dataUrl.indexOf(',')
  const dataBase64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
  return {
    id: crypto.randomUUID(),
    name: file.name || 'image.png',
    mimeType: file.type || 'image/png',
    dataBase64,
    dataUrl
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'))
    reader.readAsDataURL(file)
  })
}

function collectClipboardImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return []

  const fromItems: File[] = []
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) fromItems.push(file)
  }
  if (fromItems.length > 0) return fromItems

  return Array.from(clipboardData.files ?? []).filter((file) => file.type.startsWith('image/'))
}

function MessageMarkdown({ content }: { content: string }): ReactElement {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            return (
              <a
                href={href}
                onClick={(event) => {
                  if (!href) return
                  event.preventDefault()
                  void window.vibeboard.openExternalUrl(href)
                }}
              >
                {children}
              </a>
            )
          },
          table({ children }) {
            return (
              <div className="markdown-table-wrap">
                <table>{children}</table>
              </div>
            )
          },
          code({ className, children }) {
            const rawCode = String(children).replace(/\n$/, '')
            const language = normalizeLanguage((className ?? '').replace(/^language-/, ''))
            const isBlock = rawCode.includes('\n') || Boolean(className)

            if (!isBlock) {
              return <code className="inline-code">{children}</code>
            }

            return (
              <code
                className="markdown-code"
                dangerouslySetInnerHTML={{ __html: highlightCode(rawCode, language) }}
              />
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function isNoisyConversationEntry(entry: ConversationEntry): boolean {
  const content = entry.content.trim()
  if (!content) return (entry.attachments?.length ?? 0) === 0
  if (/^(system|user|assistant|thinking|tool_call|result|metadata|init|start|started|end|done|completed|success)$/i.test(content)) return true
  if (content.includes('You are running inside VibeBoard as a background coding agent.')) return true
  if (content.includes('Token and exploration rules:')) return true
  return false
}

function isOperationalSystemMessage(content: string): boolean {
  const text = content.trim()
  return (
    /^(Agent is running|Still working|Starting Cursor|Select a project|Cursor (CLI|Agent)|This run was interrupted|Project folder|Could not|Retry keeps|This run mode|Git repository)/i.test(
      text
    ) ||
    /^(Using |Reading |Read |Editing |Edited |Deleted |Deleting |Searched |Searching |Listed files|Listing files|Ran command|Running command|Fetched |Fetching |Used )/i.test(
      text
    ) ||
    /\b(not installed|not signed in|skipped sync|matches origin|left untouched|Commit-to-main|fast-forward)/i.test(text)
  )
}

/** Drop streamed mid-thought scraps like "actual source of the" that used to spam System rows. */
function isUselessSystemStatusFragment(content: string): boolean {
  const text = content.trim()
  if (!text) return true
  if (isOperationalSystemMessage(text)) return false

  // Incomplete stream deltas often start mid-sentence.
  if (/^[a-z]/.test(text)) return true

  // Short clauses without a finished sentence or tool target are not useful status.
  if (text.length < 60 && !/[.!?…]$/.test(text) && !/`/.test(text)) return true

  // Tiny finished scraps that are clearly not operational status.
  if (text.length < 40 && !isOperationalSystemMessage(text)) return true

  return false
}

function isThinkingSystemStatus(content: string): boolean {
  const text = content.trim()
  if (!text || isOperationalSystemMessage(text)) return false
  return !isUselessSystemStatusFragment(text)
}

function cleanConversationContent(content: string): string {
  return stripLeadingActualMessageMarker(content)
    .split(/\r?\n/)
    .map((line) => cleanConversationLine(line))
    .filter((line) => line && !isProgressNarrationLine(line))
    .join('\n')
    .trim()
}

function cleanSystemConversationContent(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => cleanConversationLine(line))
    .filter(Boolean)
    .join('\n')
    .trim()
}

function cleanConversationLine(line: string): string {
  return line
    .trim()
    .replace(cursorStreamMarkerPattern(), '')
    .replace(
      /^(?:init|start|started|completed|success|done|end)\s+(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s+)?/i,
      ''
    )
    .replace(
      /\b(?:login|tool_call|tool|result|metadata|started|completed|success|done|init)\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      ''
    )
    .replace(/\btool_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/^(?:(?:started|completed|success|done|end)\s+)+/i, '')
    .replace(/\s+(?:(?:started|completed|success|done|end)\s*)+$/i, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function stripLeadingActualMessageMarker(content: string): string {
  return content.replace(/^\s*VibeBoardStartActualMessage\s*(?:\r?\n|$)/, '')
}

function cursorStreamMarkerPattern(): RegExp {
  return /\b(?:call--?\d+|call_\d+|tool--?\d+|tool_\d+|fc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_\d+)?)\b/gi
}

function isProgressNarrationLine(line: string): boolean {
  return (
    /^(i('|’)?m|i am|i('|’)?ll|i will|reading|reviewing|examining|checking|running|looking|scanning|opening|inspecting)\b/i.test(
      line
    ) ||
    /^(the user|the request|the context|a modified .+ appears|files to understand|likely about)\b/i.test(line) ||
    /^the project structure is now clear\b/i.test(line) ||
    /^the task is unclear\b/i.test(line) ||
    /^nothing clear to do yet\b/i.test(line) ||
    /^what do you want next\b/i.test(line)
  )
}

function mergeConversationEntries(left: ConversationEntry[], right: ConversationEntry[]): ConversationEntry[] {
  const entriesById = new Map<string, ConversationEntry>()
  for (const entry of left) {
    entriesById.set(entry.id, entry)
  }
  for (const entry of right) {
    entriesById.set(entry.id, entry)
  }
  const entries = Array.from(entriesById.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const realEntries = entries.filter((entry) => !entry.id.startsWith('optimistic-'))
  const optimisticEntries = entries.filter((entry) => entry.id.startsWith('optimistic-'))
  const usedRealIds = new Set<string>()
  const coveredOptimisticIds = new Set<string>()
  const dataUrlsByRealId = new Map<string, ConversationAttachment[]>()

  for (const optimistic of optimisticEntries) {
    const optimisticTime = Date.parse(optimistic.createdAt)
    const match = realEntries
      .filter((real) => {
        if (usedRealIds.has(real.id)) return false
        if (real.taskId !== optimistic.taskId || real.role !== optimistic.role) return false
        if (real.content !== optimistic.content) return false
        if ((real.attachments?.length ?? 0) !== (optimistic.attachments?.length ?? 0)) return false
        return true
      })
      .sort((leftEntry, rightEntry) => {
        const leftDelta = Math.abs(Date.parse(leftEntry.createdAt) - optimisticTime)
        const rightDelta = Math.abs(Date.parse(rightEntry.createdAt) - optimisticTime)
        return leftDelta - rightDelta
      })[0]

    if (!match) continue
    usedRealIds.add(match.id)
    coveredOptimisticIds.add(optimistic.id)
    if (optimistic.attachments?.length) {
      dataUrlsByRealId.set(match.id, optimistic.attachments)
    }
  }

  return entries
    .filter((entry) => !coveredOptimisticIds.has(entry.id))
    .map((entry) => {
      const optimisticAttachments = dataUrlsByRealId.get(entry.id)
      if (!optimisticAttachments?.length) return entry
      if (!entry.attachments?.length) {
        return { ...entry, attachments: optimisticAttachments }
      }
      return {
        ...entry,
        attachments: entry.attachments.map((attachment, index) => ({
          ...attachment,
          dataUrl: attachment.dataUrl || optimisticAttachments[index]?.dataUrl
        }))
      }
    })
}

function compactConversationEntries(entries: ConversationEntry[]): ConversationEntry[] {
  const compacted: ConversationEntry[] = []

  for (const entry of entries) {
    const previous = compacted.at(-1)
    // Keep system progress updates as separate chat rows so live status stays readable.
    if (previous && previous.role === 'assistant' && entry.role === 'assistant') {
      previous.content = joinConversationParts(previous.content, entry.content)
      previous.attachments = [...(previous.attachments ?? []), ...(entry.attachments ?? [])]
      if (previous.attachments.length === 0) {
        delete previous.attachments
      }
      continue
    }
    // Collapse successive thinking updates into the latest complete thought.
    if (
      previous &&
      previous.role === 'system' &&
      entry.role === 'system' &&
      isThinkingSystemStatus(previous.content) &&
      isThinkingSystemStatus(entry.content)
    ) {
      previous.content = entry.content
      continue
    }
    compacted.push({ ...entry, attachments: entry.attachments ? [...entry.attachments] : undefined })
  }

  return compacted
}

function joinConversationParts(previous: string, next: string): string {
  const right = next.trim()
  if (!right) return previous
  const left = previous.trim()
  if (!left) return right
  if (left.endsWith(right)) return left
  if (left.endsWith('.') || left.endsWith('!') || left.endsWith('?') || right.startsWith('#') || right.startsWith('- ')) {
    return `${left}\n\n${right}`
  }
  if (/^[,.;:!?)]/.test(right)) return `${left}${right}`
  return `${left} ${right}`
}

function ChangeSummary({ changes }: { changes: CodeChange[] }): ReactElement {
  const added = changes.filter((change) => change.changeType === 'added').length
  const modified = changes.filter((change) => change.changeType === 'modified').length
  const deleted = changes.filter((change) => change.changeType === 'deleted').length

  return (
    <div className="change-summary">
      <span>{changes.length} files</span>
      {added > 0 && <span className="summary-added">{added} added</span>}
      {modified > 0 && <span>{modified} modified</span>}
      {deleted > 0 && <span className="summary-deleted">{deleted} deleted</span>}
    </div>
  )
}

function DiffViewer({ change }: { change: CodeChange }): ReactElement {
  const diffText = useMemo(() => change.diffText.trim() || fallbackDiff(change), [change])
  const rows = useMemo(() => compactDiffRows(parseDiffRows(diffText)), [diffText])
  const language = useMemo(
    () => normalizeLanguage(change.language || languageFromPath(change.filePath)),
    [change.filePath, change.language]
  )
  const languageLabel = useMemo(() => displayLanguage(language), [language])

  return (
    <article className="diff-file">
      <header className="diff-file-header">
        <div>
          <span className={`change-type ${change.changeType}`}>{change.changeType}</span>
          <strong>{change.filePath}</strong>
        </div>
        <span>{languageLabel}</span>
      </header>
      <div className="diff-table" role="table" aria-label={`${change.filePath} diff`}>
        <div className="diff-rows">
          {rows.map((row, index) => {
            return (
              <div key={`${index}-${row.raw}`} className={`diff-line ${row.kind}`} role="row">
                <span className="diff-gutter">{diffGutterLabel(row)}</span>
                <span className="diff-number">{row.newLine ?? row.oldLine ?? ''}</span>
                <code
                  dangerouslySetInnerHTML={{
                    __html: row.kind === 'hunk' || row.kind === 'omitted' ? escapeHtml(row.text) : highlightCode(row.text, language)
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </article>
  )
}

interface DiffRow {
  raw: string
  text: string
  kind: 'added' | 'removed' | 'hunk' | 'context' | 'omitted'
  oldLine: number | null
  newLine: number | null
}

function parseDiffRows(diffText: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0

  for (const raw of diffText.split('\n')) {
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ raw, text: raw, kind: 'hunk', oldLine: null, newLine: null })
      continue
    }

    const kind = diffLineKind(raw)
    const text = raw.slice(1)
    if (kind === 'added') {
      rows.push({ raw, text, kind, oldLine: null, newLine })
      newLine += 1
      continue
    }
    if (kind === 'removed') {
      rows.push({ raw, text, kind, oldLine, newLine: null })
      oldLine += 1
      continue
    }
    rows.push({ raw, text, kind: 'context', oldLine, newLine })
    oldLine += 1
    newLine += 1
  }

  return rows
}

function compactDiffRows(rows: DiffRow[], contextLimit = 6): DiffRow[] {
  const compacted: DiffRow[] = []
  let index = 0

  while (index < rows.length) {
    const hunk = rows[index]
    if (hunk?.kind !== 'hunk') {
      compacted.push(hunk)
      index += 1
      continue
    }

    const hunkRows: DiffRow[] = [hunk]
    index += 1
    while (index < rows.length && rows[index]?.kind !== 'hunk') {
      hunkRows.push(rows[index])
      index += 1
    }

    compacted.push(...compactHunkRows(hunkRows, contextLimit))
  }

  return compacted
}

function compactHunkRows(rows: DiffRow[], contextLimit: number): DiffRow[] {
  const body = rows.slice(1)
  const changedIndexes = body
    .map((row, index) => (row.kind === 'added' || row.kind === 'removed' ? index : -1))
    .filter((index) => index >= 0)

  if (changedIndexes.length === 0) return rows

  const keepIndexes = new Set<number>()
  for (const changedIndex of changedIndexes) {
    const start = Math.max(0, changedIndex - contextLimit)
    const end = Math.min(body.length - 1, changedIndex + contextLimit)
    for (let index = start; index <= end; index += 1) {
      keepIndexes.add(index)
    }
  }

  const compacted: DiffRow[] = [rows[0]]
  let omittedCount = 0
  for (let index = 0; index < body.length; index += 1) {
    const row = body[index]
    if (keepIndexes.has(index)) {
      if (omittedCount > 0) {
        compacted.push(omittedDiffRow(omittedCount))
        omittedCount = 0
      }
      compacted.push(row)
    } else {
      omittedCount += 1
    }
  }

  if (omittedCount > 0) {
    compacted.push(omittedDiffRow(omittedCount))
  }

  return compacted
}

function omittedDiffRow(count: number): DiffRow {
  return {
    raw: `... ${count} unchanged ${count === 1 ? 'line' : 'lines'}`,
    text: `... ${count} unchanged ${count === 1 ? 'line' : 'lines'}`,
    kind: 'omitted',
    oldLine: null,
    newLine: null
  }
}

function diffGutterLabel(row: DiffRow): string {
  if (row.kind === 'context' || row.kind === 'omitted' || row.kind === 'hunk') return ' '
  return row.raw[0] ?? ' '
}

function diffLineKind(line: string): 'added' | 'removed' | 'hunk' | 'context' {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'context'
}

function highlightCode(code: string, language: string): string {
  if (!code.trim()) return ''
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  }
  return hljs.highlightAuto(code).value
}

function fallbackDiff(change: CodeChange): string {
  const prefix = change.changeType === 'deleted' ? '-' : '+'
  return `@@ ${change.filePath} @@\n${prefix}${change.summary}`
}

function languageFromPath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    c: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    css: 'css',
    cxx: 'cpp',
    dart: 'dart',
    dockerfile: 'dockerfile',
    go: 'go',
    h: 'c',
    hpp: 'cpp',
    html: 'xml',
    ini: 'ini',
    java: 'java',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    kt: 'kotlin',
    kts: 'kotlin',
    less: 'less',
    lua: 'lua',
    md: 'markdown',
    mjs: 'javascript',
    php: 'php',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    scss: 'scss',
    sh: 'bash',
    sql: 'sql',
    swift: 'swift',
    ts: 'typescript',
    tsx: 'tsx',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml'
  }
  return extension ? languageMap[extension] || '' : ''
}

function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase()
  const aliases: Record<string, string> = {
    cs: 'csharp',
    docker: 'dockerfile',
    htm: 'xml',
    html: 'xml',
    js: 'javascript',
    jsx: 'javascript',
    kt: 'kotlin',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    ts: 'typescript',
    yml: 'yaml'
  }
  return aliases[normalized] ?? normalized
}

function displayLanguage(language: string): string {
  const labels: Record<string, string> = {
    bash: 'shell',
    csharp: 'c#',
    cpp: 'c++',
    dockerfile: 'dockerfile',
    javascript: 'javascript',
    markdown: 'markdown',
    plaintext: 'text',
    tsx: 'typescript',
    typescript: 'typescript',
    xml: 'html',
    yaml: 'yaml'
  }
  return labels[language] ?? language
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function compactPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 3) return path
  return `.../${parts.slice(-3).join('/')}`
}

function formatSearchMatch(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= 96) return compact
  return `${compact.slice(0, 96)}...`
}

function shouldShowSearchMatch(result: SearchResult): boolean {
  const match = result.match.trim()
  if (!match) return false
  if (result.kind === 'project') return false
  return match.toLowerCase() !== result.title.trim().toLowerCase()
}

function searchKindLabel(kind: SearchResult['kind']): string {
  if (kind === 'project') return 'Project'
  if (kind === 'tab') return 'Tab'
  if (kind === 'task') return 'Task'
  return 'Prompt'
}

function buildTabStatusMap(tasks: Task[]): Map<string, Task['status']> {
  const statuses = new Map<string, Task['status']>()
  const taskCounts = new Map<string, number>()

  for (const task of tasks) {
    const current = statuses.get(task.tabId) ?? 'idle'
    taskCounts.set(task.tabId, (taskCounts.get(task.tabId) ?? 0) + 1)

    if (current === 'attention') continue
    if (task.status === 'attention') {
      statuses.set(task.tabId, 'attention')
      continue
    }
    if (current === 'processing') continue
    if (task.status === 'processing') {
      statuses.set(task.tabId, 'processing')
      continue
    }
    if (current === 'done_unread') continue
    if (task.status === 'done_unread') {
      statuses.set(task.tabId, 'done_unread')
      continue
    }
    if (task.status === 'done_read') {
      statuses.set(task.tabId, current === 'idle' ? 'done_read' : current)
      continue
    }
    statuses.set(task.tabId, 'idle')
  }

  for (const [tabId, status] of statuses) {
    if (status === 'done_read' && !taskCounts.get(tabId)) {
      statuses.set(tabId, 'idle')
    }
  }

  return statuses
}

function applyTaskMove(tasks: Task[], taskId: string, targetLaneId: string, position: number): Task[] {
  const moving = tasks.find((task) => task.id === taskId)
  if (!moving) return tasks

  const without = tasks.filter((task) => task.id !== taskId)
  const targetLaneTasks = without.filter((task) => task.laneId === targetLaneId).sort(byPosition)
  const clamped = Math.max(0, Math.min(position, targetLaneTasks.length))
  targetLaneTasks.splice(clamped, 0, { ...moving, laneId: targetLaneId })

  const updates = new Map<string, Task>()
  targetLaneTasks.forEach((task, index) => {
    updates.set(task.id, { ...task, laneId: targetLaneId, position: index })
  })

  if (moving.laneId !== targetLaneId) {
    without
      .filter((task) => task.laneId === moving.laneId)
      .sort(byPosition)
      .forEach((task, index) => {
        updates.set(task.id, { ...task, position: index })
      })
  }

  return tasks.map((task) => updates.get(task.id) ?? task)
}

function byPosition<T extends { position: number }>(a: T, b: T): number {
  return a.position - b.position
}
