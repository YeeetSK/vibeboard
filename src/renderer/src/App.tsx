import {
  Children,
  CSSProperties,
  ReactElement,
  ReactNode,
  cloneElement,
  isValidElement,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
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
  arrayMove,
  horizontalListSortingStrategy,
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
import { buildCodeHtmlWithAddedHighlights, MarkdownCodeBlock } from './MarkdownCodeBlock'
import {
  MARKETING_DEMO_AGENT_REPLY,
  MARKETING_DEMO_AGENT_STATUS,
  MARKETING_DEMO_COUNTDOWN_MS,
  MARKETING_DEMO_FOLLOW_UP,
  MARKETING_PRODUCT_DEMO_MS,
  groupMarketingDemoTasksByLane,
  marketingDemoChanges,
  marketingDemoConversations,
  marketingDemoFeatureTaskId,
  marketingDemoLanes,
  marketingDemoProject,
  marketingDemoTasks
} from './marketingDemoData'
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clapperboard,
  Clock,
  Code2,
  Columns3,
  CornerDownLeft,
  Download,
  Eye,
  ExternalLink,
  FolderPlus,
  FolderOpen,
  GitCommitHorizontal,
  GitPullRequestDraft,
  Heart,
  History,
  Keyboard,
  LayoutDashboard,
  ListTodo,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Copy,
  Minus,
  Palette,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Pin,
  RotateCcw,
  Scan,
  Search,
  Send,
  Settings,
  Square,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import type {
  AgentCliId,
  AgentCliProviderStatus,
  AgentCliSnapshot,
  AgentModel,
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
  SearchResult,
  Task,
  TaskDetail,
  TaskMessageAttachmentInput,
  UpdateInfo,
  NotificationEventSettings,
  NotificationSettings,
  AppearanceSettings,
  NotchOverlayCapability,
  NotchOverlaySettings,
  KeyboardAlertCapability,
  KeyboardAlertSettings,
} from '../../shared/types'
import {
  defaultNotchOverlaySettings,
  emptyNotchOverlayCapability
} from '../../shared/notch'
import { AgentCliIcon } from './AgentCliIcons'
import {
  DevNotchFinishLauncher,
  DevNotchRunningLauncher,
  SettingsNotchPane
} from './notch'

const ICON_STROKE = 1.75
const ICON_SM = 14

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

const emptyAgentCliSnapshot: AgentCliSnapshot = {
  activeCli: 'cursor',
  providers: [
    {
      id: 'cursor',
      label: 'Cursor',
      installed: false,
      authenticated: false,
      available: false,
      command: null,
      detail: 'Checking…'
    },
    {
      id: 'claude',
      label: 'Claude',
      installed: false,
      authenticated: false,
      available: false,
      command: null,
      detail: 'Checking…'
    },
    {
      id: 'codex',
      label: 'Codex',
      installed: false,
      authenticated: false,
      available: false,
      command: null,
      detail: 'Checking…'
    }
  ],
  active: {
    id: 'cursor',
    label: 'Cursor',
    installed: false,
    authenticated: false,
    available: false,
    command: null,
    detail: 'Checking…'
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
  },
  playFinishSound: true
}

const emptyAppearanceSettings: AppearanceSettings = {
  uiFontSize: 14,
  codeFontSize: 13,
  fontSmoothing: true,
  reduceMotion: 'system'
}

const emptyKeyboardAlertSettings: KeyboardAlertSettings = {
  enabled: false,
  flashOnTaskFailed: true,
  flashOnTaskCompleted: false,
  flashOnAllFinished: false,
  stopOnAppFocus: true,
  stopOnOpenTask: true
}

const emptyKeyboardAlertCapability: KeyboardAlertCapability = {
  supported: false,
  platform: 'unknown',
  hasBacklight: false,
  reason: null
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

const tutorialSteps = [
  {
    id: 'sidebar',
    title: 'Projects and search live here',
    body: 'Add project folders, open global search, and configure notifications, notch, and appearance from the sidebar.',
    spotlight: 'sidebar',
    target: 'sidebar',
    card: 'bottom'
  },
  {
    id: 'tabs',
    title: 'One tab is one project',
    body: 'Each tab is its own board. Closed projects stay in recent history so you can reopen them anytime.',
    spotlight: 'tabs',
    target: 'tabs',
    card: 'below'
  },
  {
    id: 'board',
    title: 'Tasks move through lanes',
    body: 'New boards start with Active, Review, and Done. Drag cards between lanes; borders show running, needs you, and done.',
    spotlight: 'board',
    target: 'board-lanes',
    card: 'bottom'
  },
  {
    id: 'auto-move',
    title: 'Auto-move and board actions',
    body: 'Auto-move sends finished tasks to Review, then to Done when you open them. Use + Task, Finder, and + Lane from here too.',
    spotlight: 'actions',
    target: 'board-actions',
    card: 'left'
  },
  {
    id: 'demo',
    title: 'Task details split chat and code',
    body: 'Open a task for the agent chat on the left and captured file diffs on the right. Toggle Changes when you want a wider chat.',
    spotlight: 'modal',
    target: 'tutorial-demo',
    card: 'bottom'
  },
  {
    id: 'support',
    title: 'Support the project if you like',
    body: 'Support me is a simple way to say thanks. It also helps cover the $99/year Apple Developer Program fee that keeps VibeBoard signed and shipping updates on Mac.',
    spotlight: 'support',
    target: 'sidebar-support',
    card: 'bottom'
  }
]

const tutorialShowcaseTabId = 'tutorial-showcase-tab'
const tutorialShowcaseProjectId = 'tutorial-showcase-project'
const tutorialShowcaseCreatedAt = '2026-07-17T00:00:00.000Z'

const tutorialShowcaseLanes: Lane[] = [
  { id: 'tutorial-lane-active', tabId: tutorialShowcaseTabId, name: 'Active', position: 0 },
  { id: 'tutorial-lane-review', tabId: tutorialShowcaseTabId, name: 'Review', position: 1 },
  { id: 'tutorial-lane-done', tabId: tutorialShowcaseTabId, name: 'Done', position: 2 }
]

const createTutorialShowcaseTask = (
  id: string,
  laneId: string,
  title: string,
  summary: string,
  status: Task['status'],
  position: number,
  extras?: Partial<Task>
): Task => ({
  id,
  tabId: tutorialShowcaseTabId,
  laneId,
  projectId: tutorialShowcaseProjectId,
  title,
  summary,
  status,
  runModeOverride: null,
  model: null,
  branchName: extras?.branchName ?? null,
  worktreePath: null,
  pushedToMain: extras?.pushedToMain ?? 0,
  position,
  createdAt: tutorialShowcaseCreatedAt,
  updatedAt: tutorialShowcaseCreatedAt,
  runStartedAt: extras?.runStartedAt ?? null
})

const tutorialShowcaseTasks: Task[] = [
  createTutorialShowcaseTask(
    'tutorial-task-release',
    'tutorial-lane-active',
    'Plan release notes',
    'Idle cards wait here until you run them.',
    'idle',
    0
  ),
  createTutorialShowcaseTask(
    'tutorial-task-search',
    'tutorial-lane-active',
    'Improve global search',
    'Drag cards between lanes to reorder work.',
    'idle',
    1
  ),
  createTutorialShowcaseTask(
    'tutorial-task-tests',
    'tutorial-lane-active',
    'Fix failing tests',
    'Running border means Cursor is busy.',
    'processing',
    2,
    { runStartedAt: new Date(Date.now() - 42_000).toISOString(), branchName: 'fix/tests' }
  ),
  createTutorialShowcaseTask(
    'tutorial-task-deploy',
    'tutorial-lane-review',
    'Clarify deploy target',
    'Attention border means the agent needs you.',
    'attention',
    0
  ),
  createTutorialShowcaseTask(
    'tutorial-task-diff',
    'tutorial-lane-review',
    'Review generated diff',
    'Finished work lands in Review as Done unread.',
    'done_unread',
    1
  ),
  createTutorialShowcaseTask(
    'tutorial-task-shipped',
    'tutorial-lane-done',
    'Ship onboarding tour',
    'Opening a finished task moves it to Done.',
    'done_read',
    0,
    { pushedToMain: 1 }
  )
]

const tutorialShowcaseTasksByLaneId = new Map(
  tutorialShowcaseLanes.map((lane) => [
    lane.id,
    tutorialShowcaseTasks.filter((task) => task.laneId === lane.id)
  ])
)

const commitTaskPrompt = [
  'Commit the current working tree changes for this task.',
  'Inspect git status and git diff first.',
  'Stage only files that belong to this task.',
  'Choose a concise conventional commit message yourself.',
  'Create the commit locally.',
  '',
  'Authorship rules (mandatory):',
  '- Never add Co-authored-by, Made-with, Made with Cursor, or any agent/tool attribution trailer to the commit.',
  '- Do not pass --trailer, Co-authored-by, or similar attribution flags on git commit.',
  '- Leave authorship entirely to the user (normal git user.name / user.email only).',
  '- If a tool tries to inject co-author attribution, rewrite the commit command without it.',
  '',
  'Push the commit to the default branch on origin without checking out that branch.',
  'If main/master is already checked out in another worktree, use `git push origin HEAD:main` (or HEAD:master).',
  'Do not try to update the project main checkout yourself; VibeBoard syncs it after this run.',
  'If there are no commit-worthy changes, say that clearly.'
].join('\n')
const draftPrPrompt = [
  'Create a draft pull request for the current task changes.',
  'Inspect git status, current branch, and remote first.',
  'If needed, create a focused local commit with a concise conventional commit message.',
  'Authorship rules (mandatory): never add Co-authored-by, Made-with, Made with Cursor, or any agent attribution trailer; do not pass --trailer / Co-authored-by on git commit; leave authorship to the user.',
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
      'Never add Co-authored-by or any agent attribution trailer; leave authorship to the user.',
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
  const [agentCliSnapshot, setAgentCliSnapshot] = useState<AgentCliSnapshot>(emptyAgentCliSnapshot)
  const [isInstallingCursorCli, setInstallingCursorCli] = useState(false)
  const [cursorSetupPhase, setCursorSetupPhase] = useState<CursorSetupPhase>('checking')
  const [cursorFeedback, setCursorFeedback] = useState('')
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [deleteTabId, setDeleteTabId] = useState<string | null>(null)
  const [deleteLaneId, setDeleteLaneId] = useState<string | null>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  const [boardNotice, setBoardNotice] = useState<string | null>(null)
  const boardNoticeTimerRef = useRef<number | null>(null)
  const [marketingDemoMode, setMarketingDemoMode] = useState<'product' | null>(null)
  const marketingDemoTimersRef = useRef<number[]>([])
  const [productDemoCountdown, setProductDemoCountdown] = useState<number | null>(null)
  const [productDemoDraft, setProductDemoDraft] = useState<string | null>(null)
  const [productDemoTasks, setProductDemoTasks] = useState<Task[]>(() =>
    marketingDemoTasks.map((task) => ({ ...task }))
  )
  const [productDemoCursor, setProductDemoCursor] = useState<{
    x: number
    y: number
    pressing: boolean
    moving: boolean
  } | null>(null)
  const [productDemoAiming, setProductDemoAiming] = useState(false)
  const [taskDetailExiting, setTaskDetailExiting] = useState(false)
  const [renameTaskId, setRenameTaskId] = useState<string | null>(null)
  const [quitRequest, setQuitRequest] = useState<QuitRequest | null>(null)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchResults, setGlobalSearchResults] = useState<SearchResult[]>([])
  const [isGlobalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>(emptyUpdateInfo)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(emptyNotificationSettings)
  const [isSettingsOpen, setSettingsOpen] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState<
    'appearance' | 'notifications' | 'notch' | 'keyboard' | 'updates'
  >('appearance')
  const [notificationFeedback, setNotificationFeedback] = useState('')
  const [notchOverlaySettings, setNotchOverlaySettings] = useState<NotchOverlaySettings>(defaultNotchOverlaySettings)
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(emptyAppearanceSettings)
  const [notchCapability, setNotchCapability] = useState<NotchOverlayCapability>(emptyNotchOverlayCapability)
  const [notchFeedback, setNotchFeedback] = useState('')
  const [keyboardAlertSettings, setKeyboardAlertSettings] = useState<KeyboardAlertSettings>(
    emptyKeyboardAlertSettings
  )
  const [keyboardAlertCapability, setKeyboardAlertCapability] =
    useState<KeyboardAlertCapability>(emptyKeyboardAlertCapability)
  const [keyboardAlertFeedback, setKeyboardAlertFeedback] = useState('')
  const [releaseNotesModal, setReleaseNotesModal] = useState<PendingReleaseNotes | null>(null)
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskDetail>(emptyTaskDetail)
  const [isLoadingOlderConversations, setLoadingOlderConversations] = useState(false)
  const [tutorialStep, setTutorialStep] = useState<number | null>(null)
  const [isTutorialWelcomeOpen, setTutorialWelcomeOpen] = useState(false)
  const [isTutorialCompleteOpen, setTutorialCompleteOpen] = useState(false)
  const pendingActionsRef = useRef(new Set<string>())
  const [, setPendingActionVersion] = useState(0)

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
  const activeProject = activeTab?.activeProjectId
    ? state.projects.find((project) => project.id === activeTab.activeProjectId) ?? null
    : null
  const openProjectLabel =
    navigator.userAgent.includes('Windows') ? 'Explorer' : navigator.userAgent.includes('Mac') ? 'Finder' : 'Folder'
  const isTutorialActive = tutorialStep !== null || isTutorialWelcomeOpen
  const isProductDemo = marketingDemoMode === 'product'
  const isShowcaseBoard = isTutorialActive || isProductDemo
  const marketingDemoTasksByLaneId = useMemo(
    () => groupMarketingDemoTasksByLane(productDemoTasks),
    [productDemoTasks]
  )
  const activeLanes = useMemo(
    () => state.lanes.filter((lane) => lane.tabId === activeTab?.id).sort(byPosition),
    [state.lanes, activeTab?.id]
  )
  const boardLanes = isProductDemo
    ? marketingDemoLanes
    : isTutorialActive
      ? tutorialShowcaseLanes
      : activeLanes
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
  const boardTasksByLaneId = isProductDemo
    ? marketingDemoTasksByLaneId
    : isTutorialActive
      ? tutorialShowcaseTasksByLaneId
      : tasksByLaneId
  const tabStatuses = useMemo(() => buildTabStatusMap(state.tasks), [state.tasks])
  const boardStats = useMemo(() => {
    // Only the active board - other tabs (including closed ones still in state) must not inflate Issues.
    const tasks = isProductDemo
      ? productDemoTasks
      : isTutorialActive
        ? tutorialShowcaseTasks
        : activeTasks
    const running = tasks.filter((task) => task.status === 'processing').length
    const attention = tasks.filter((task) => task.status === 'attention').length
    const done = tasks.filter((task) => task.status === 'done_read' || task.status === 'done_unread').length
    return { running, attention, done, total: tasks.length }
  }, [isProductDemo, isTutorialActive, productDemoTasks, activeTasks])
  const selectedTask = isProductDemo
    ? productDemoTasks.find((task) => task.id === selectedTaskId) ?? null
    : state.tasks.find((task) => task.id === selectedTaskId) ?? null
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

  const showBoardNotice = (message: string): void => {
    setBoardNotice(message)
    if (boardNoticeTimerRef.current !== null) window.clearTimeout(boardNoticeTimerRef.current)
    boardNoticeTimerRef.current = window.setTimeout(() => {
      boardNoticeTimerRef.current = null
      setBoardNotice(null)
    }, 4200)
  }

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
    void window.vibeboard.getAppearanceSettings().then((settings) => {
      setAppearanceSettings(settings)
      applyAppearanceSettings(settings)
    })
    void window.vibeboard.getNotchOverlayCapability().then(setNotchCapability)
    void window.vibeboard.getNotchOverlaySettings().then(setNotchOverlaySettings)
    void window.vibeboard.getKeyboardAlertCapability().then(setKeyboardAlertCapability)
    void window.vibeboard.getKeyboardAlertSettings().then(setKeyboardAlertSettings)
    return () => {
      stopStateListener()
      stopQuitListener()
      stopUpdateListener()
      stopNotificationOpenListener()
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    const checkOnboarding = async (): Promise<void> => {
      try {
        const localComplete = window.localStorage.getItem(onboardingStorageKey) === 'done'
        const storedComplete = await window.vibeboard.getOnboardingComplete()

        if (localComplete && !storedComplete) {
          await window.vibeboard.markOnboardingComplete()
        }

        if (!isCancelled && !localComplete && !storedComplete) {
          setTutorialWelcomeOpen(true)
        }
      } catch {
        try {
          if (!isCancelled && window.localStorage.getItem(onboardingStorageKey) !== 'done') {
            setTutorialWelcomeOpen(true)
          }
        } catch {
          // If persistence is unavailable, avoid showing the tutorial repeatedly.
        }
      }
    }

    void checkOnboarding()

    return () => {
      isCancelled = true
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
    if (agentCliSnapshot.active.available) return
    const intervalId = window.setInterval(() => {
      if (document.hidden) return
      void refreshAgentCliSnapshot({ quiet: true, source: 'live' })
    }, 15000)
    return () => window.clearInterval(intervalId)
  }, [agentCliSnapshot.active.available, agentCliSnapshot.activeCli])

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
    if (selectedTask?.id.startsWith('md-task-')) {
      setSelectedTaskDetail(
        selectedTask.id === marketingDemoFeatureTaskId
          ? {
              conversations: marketingDemoConversations,
              changes: marketingDemoChanges,
              hasOlderConversations: false
            }
          : emptyTaskDetail
      )
      setLoadingOlderConversations(false)
      return
    }
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

    if (selectedTask.id.startsWith('md-task-')) {
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
          // Opening a task must show the server page immediately; do not keep a stale
          // partial thread that only grows after the next send/refetch.
          if (!sameTask) return detail

          const merged = mergeConversationEntries(current.conversations, detail.conversations)
          // When idle, drop live system progress so classic user/assistant history stays clean.
          // While running, take system rows only from the fresh page (already scoped to this run)
          // so prior-run status does not stick around via client merge.
          const conversations =
            taskStatus === 'processing' || taskStatus === 'attention'
              ? [
                  ...merged.filter((entry) => entry.role !== 'system'),
                  ...detail.conversations.filter((entry) => entry.role === 'system')
                ].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
              : merged.filter(
                  (entry) =>
                    entry.role !== 'system' || isAgentCliDiagnosticMessage(entry.content)
                )

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

  // If a task finishes while its detail is open *and the app is focused*, treat it as viewed.
  // Background / notch-only viewing must not consume the unread finish nudge.
  useEffect(() => {
    if (!selectedTask || selectedTask.status !== 'done_unread') return
    if (selectedTask.id.startsWith('md-task-') || selectedTask.id.startsWith('tutorial-')) return
    const taskId = selectedTask.id

    const markReadIfAppFocused = (): void => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      void runAction(`task:read:${taskId}`, async () => {
        await window.vibeboard.markTaskRead(taskId)
        await refresh()
      })
    }

    markReadIfAppFocused()
    window.addEventListener('focus', markReadIfAppFocused)
    document.addEventListener('visibilitychange', markReadIfAppFocused)
    return () => {
      window.removeEventListener('focus', markReadIfAppFocused)
      document.removeEventListener('visibilitychange', markReadIfAppFocused)
    }
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

  const applyAgentCliSnapshot = (
    snapshot: AgentCliSnapshot,
    options: { quiet?: boolean } = {}
  ): void => {
    setAgentCliSnapshot(snapshot)
    if (snapshot.active.available) {
      setCursorSetupPhase('ready')
      setCursorFeedback('')
      return
    }
    setCursorSetupPhase('failed')
    if (!options.quiet) {
      setCursorFeedback(snapshot.active.detail)
    }
  }

  const refreshAgentCliSnapshot = async (
    options: { quiet?: boolean; fresh?: boolean; source?: 'remembered' | 'live' } = {}
  ): Promise<AgentCliSnapshot> => {
    const snapshot = await window.vibeboard.getAgentCliSnapshot({
      source: options.source,
      fresh: options.fresh
    })
    applyAgentCliSnapshot(snapshot, options)
    // Cursor adapter debug is only needed when Cursor is the active CLI.
    if (snapshot.activeCli === 'cursor' && options.source !== 'remembered') {
      const nextCursor = await window.vibeboard.getCursorAdapterStatus()
      setCursorStatus(nextCursor)
    }
    return snapshot
  }

  const prepareCursorOnLaunch = async (): Promise<void> => {
    // Instant paint from DB-remembered install/login state.
    const remembered = await refreshAgentCliSnapshot({ quiet: true, source: 'remembered' })

    // Verify in the background; update UI + DB if something changed.
    void (async () => {
      const live = await refreshAgentCliSnapshot({ quiet: true, source: 'live', fresh: true })

      // Auto-install Cursor only after a live probe confirms it's missing.
      if (live.activeCli === 'cursor' && !live.active.installed) {
        setCursorSetupPhase('preparing')
        setCursorFeedback('Downloading Cursor CLI…')
        const result = await window.vibeboard.installCursorCli()
        const after = await refreshAgentCliSnapshot({ quiet: true, source: 'live', fresh: true })
        if (after.active.available) return
        if (after.active.installed && !after.active.authenticated) {
          setCursorSetupPhase('failed')
          setCursorFeedback('Cursor CLI installed. Complete sign-in in the window that opened.')
          await window.vibeboard.openCursorInstallTerminal()
          return
        }
        setCursorSetupPhase('failed')
        setCursorFeedback(result.message || after.active.detail)
        return
      }

      if (live.activeCli === 'cursor' && live.active.installed && !live.active.authenticated) {
        setCursorSetupPhase('failed')
        setCursorFeedback('Cursor CLI is installed. Click Sign in to finish setup.')
        return
      }

      if (!live.active.available && !remembered.active.available) {
        setCursorSetupPhase('failed')
        setCursorFeedback(live.active.detail)
      }
    })()
  }

  const selectAgentCli = (id: AgentCliId): void => {
    if (agentCliSnapshot.activeCli === id) return
    const provider =
      agentCliSnapshot.providers.find((item) => item.id === id) ?? null
    if (!provider) return

    // Swap instantly from the already-loaded provider list; do not wait on
    // slow --version / auth probes before the picker updates.
    setAgentCliSnapshot({
      activeCli: id,
      providers: agentCliSnapshot.providers,
      active: provider
    })
    if (provider.available) {
      setCursorSetupPhase('ready')
      setCursorFeedback('')
    } else {
      setCursorSetupPhase('failed')
      setCursorFeedback(
        provider.installed
          ? `${provider.label} is installed. Sign in to start using it.`
          : `${provider.label} is not installed yet.`
      )
    }

    void runAction('agentCli:select', async () => {
      await window.vibeboard.updateAgentCliSettings({ activeCli: id })
      // Background live check; remembered DB row updates when probe finishes.
      await refreshAgentCliSnapshot({ quiet: true, source: 'live' })
    })
  }

  const refreshCursorStatus = async (options: { quiet?: boolean } = {}): Promise<void> => {
    await refreshAgentCliSnapshot(options)
  }

  const openAgentCliSetup = async (): Promise<void> => {
    await runAction('agentCli:setup', async () => {
      const active = agentCliSnapshot.active
      const needsInstall = !active.installed
      setInstallingCursorCli(true)
      setCursorSetupPhase('preparing')
      setCursorFeedback(
        needsInstall
          ? `Installing ${active.label} and opening sign-in. Return here when the setup window finishes.`
          : `Sign-in opened for ${active.label}. Return here when the setup window finishes.`
      )
      try {
        if (active.id === 'cursor' && needsInstall) {
          const result = await window.vibeboard.installCursorCli()
          const after = await window.vibeboard.getAgentCliSnapshot({ fresh: true })
          setAgentCliSnapshot(after)
          if (after.active.available) {
            setCursorSetupPhase('ready')
            setCursorFeedback('')
            return
          }
          if (!after.active.installed) {
            setCursorSetupPhase('failed')
            setCursorFeedback(result.message || after.active.detail)
            return
          }
        }

        await window.vibeboard.openAgentCliSetup(active.id)
        setCursorSetupPhase('failed')
        setCursorFeedback(
          `Finish install/sign-in for ${active.label} in the setup window. VibeBoard will mark it Signed in when ready.`
        )
        setInstallingCursorCli(false)
        // Poll in the background after Terminal opens.
        for (let attempt = 0; attempt < 36; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2500))
          const after = await window.vibeboard.getAgentCliSnapshot({ fresh: true })
          setAgentCliSnapshot(after)
          if (after.activeCli === active.id && after.active.available) {
            setCursorSetupPhase('ready')
            setCursorFeedback('')
            return
          }
        }
        setCursorFeedback(
          `${active.label} setup still pending. Finish install/sign-in in the setup window, then click Sign in again if needed.`
        )
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

  const updateActiveProjectAutoMove = async (autoMoveTasks: boolean): Promise<void> => {
    if (!activeProject || Boolean(activeProject.autoMoveTasks) === autoMoveTasks) return
    await runAction(`project:autoMove:${activeProject.id}`, async () => {
      await window.vibeboard.updateProjectAutoMove({ projectId: activeProject.id, autoMoveTasks })
      await refresh()
    })
  }

  const persistTutorialComplete = (): void => {
    try {
      window.localStorage.setItem(onboardingStorageKey, 'done')
    } catch {
      // Tutorial persistence is best-effort.
    }
    void window.vibeboard.markOnboardingComplete()
  }

  const skipTutorial = (): void => {
    persistTutorialComplete()
    setTutorialWelcomeOpen(false)
    setTutorialStep(null)
    setTutorialCompleteOpen(false)
  }

  const finishTutorial = (): void => {
    persistTutorialComplete()
    setTutorialWelcomeOpen(false)
    setTutorialStep(null)
    setTutorialCompleteOpen(true)
  }

  const startTutorialTour = (): void => {
    setTutorialWelcomeOpen(false)
    setTutorialCompleteOpen(false)
    setTutorialStep(0)
  }

  const clearMarketingDemoTimers = (): void => {
    for (const timer of marketingDemoTimersRef.current) window.clearTimeout(timer)
    marketingDemoTimersRef.current = []
  }

  const stopMarketingDemo = (): void => {
    clearMarketingDemoTimers()
    setProductDemoCountdown(null)
    setProductDemoDraft(null)
    setProductDemoCursor(null)
    setProductDemoAiming(false)
    setTaskDetailExiting(false)
    setSelectedTaskId(null)
    setSelectedTaskDetail(emptyTaskDetail)
    setProductDemoTasks(marketingDemoTasks.map((task) => ({ ...task })))
    setMarketingDemoMode(null)
  }

  const startProductMarketingDemo = (): void => {
    if (!isDevMode) return
    clearMarketingDemoTimers()
    setTutorialStep(null)
    setTutorialWelcomeOpen(false)
    setTutorialCompleteOpen(false)
    setSelectedTaskId(null)
    setSelectedTaskDetail(emptyTaskDetail)
    setTaskDetailExiting(false)
    setProductDemoDraft(null)
    setProductDemoCursor(null)
    setProductDemoAiming(false)
    setProductDemoTasks(marketingDemoTasks.map((task) => ({ ...task })))
    setMarketingDemoMode('product')
    setProductDemoCountdown(3)

    const schedule = (ms: number, fn: () => void): void => {
      marketingDemoTimersRef.current.push(window.setTimeout(fn, ms))
    }

    const targetCardPoint = (): { x: number; y: number } | null => {
      const card = document.querySelector('.task-card.is-demo-target')
      if (!(card instanceof HTMLElement)) return null
      const rect = card.getBoundingClientRect()
      return {
        x: rect.left + rect.width * 0.62,
        y: rect.top + rect.height * 0.55
      }
    }

    const markFeatureTaskRunning = (): void => {
      const startedAt = new Date().toISOString()
      setProductDemoTasks((tasks) =>
        tasks.map((task) =>
          task.id === marketingDemoFeatureTaskId
            ? {
                ...task,
                status: 'processing',
                summary: 'Shipping the session cookie path fix.',
                runStartedAt: startedAt,
                updatedAt: startedAt
              }
            : task
        )
      )
    }

    const moveFeatureTaskToActive = (): void => {
      const startedAt = new Date().toISOString()
      setProductDemoTasks((tasks) => {
        const feature = tasks.find((task) => task.id === marketingDemoFeatureTaskId)
        if (!feature) return tasks
        const rest = tasks
          .filter((task) => task.id !== marketingDemoFeatureTaskId)
          .map((task) =>
            task.laneId === 'md-lane-active' ? { ...task, position: task.position + 1 } : task
          )
        return [
          ...rest,
          {
            ...feature,
            laneId: 'md-lane-active',
            position: 0,
            status: 'processing',
            summary: 'Shipping the session cookie path fix.',
            runStartedAt: feature.runStartedAt ?? startedAt,
            updatedAt: startedAt
          }
        ]
      })
    }

    schedule(900, () => setProductDemoCountdown(2))
    schedule(1800, () => setProductDemoCountdown(1))
    schedule(2700, () => setProductDemoCountdown(null))

    // Aim at the finished auth card, then show a real click.
    schedule(3100, () => {
      setProductDemoAiming(true)
      const point = targetCardPoint()
      if (!point) return
      setProductDemoCursor({
        x: point.x + 72,
        y: point.y + 96,
        pressing: false,
        moving: false
      })
    })
    schedule(3300, () => {
      const point = targetCardPoint()
      if (!point) return
      setProductDemoCursor({
        x: point.x,
        y: point.y,
        pressing: false,
        moving: true
      })
    })
    schedule(4100, () => {
      setProductDemoCursor((current) =>
        current ? { ...current, pressing: true, moving: false } : current
      )
    })
    schedule(4300, () => {
      setProductDemoCursor(null)
      setProductDemoAiming(false)
      setTaskDetailExiting(false)
      setSelectedTaskId(marketingDemoFeatureTaskId)
    })

    // Type a follow-up into the real composer, then send.
    const followUp = MARKETING_DEMO_FOLLOW_UP
    const typeStart = 5000
    const typeStep = 16
    const charsPerTick = 2
    const typeTicks = Math.ceil(followUp.length / charsPerTick)
    for (let tick = 1; tick <= typeTicks; tick += 1) {
      const end = Math.min(tick * charsPerTick, followUp.length)
      schedule(typeStart + tick * typeStep, () => {
        setProductDemoDraft(followUp.slice(0, end))
      })
    }
    const sendAt = typeStart + typeTicks * typeStep + 280
    schedule(sendAt, () => {
      const content = followUp
      setProductDemoDraft(null)
      setSelectedTaskDetail((current) => ({
        ...current,
        conversations: [
          ...current.conversations,
          {
            id: `md-demo-send-${Date.now()}`,
            taskId: marketingDemoFeatureTaskId,
            role: 'user',
            content,
            createdAt: new Date().toISOString()
          }
        ]
      }))
    })

    // Agent picks up the follow-up and starts working in-chat.
    schedule(sendAt + 450, () => {
      markFeatureTaskRunning()
      setSelectedTaskDetail((current) => ({
        ...current,
        conversations: [
          ...current.conversations,
          {
            id: `md-demo-status-${Date.now()}`,
            taskId: marketingDemoFeatureTaskId,
            role: 'system',
            content: MARKETING_DEMO_AGENT_STATUS,
            createdAt: new Date().toISOString()
          }
        ]
      }))
    })

    const reply = MARKETING_DEMO_AGENT_REPLY
    const replyStart = sendAt + 800
    const replyStep = 18
    const replyCharsPerTick = 2
    const replyTicks = Math.ceil(reply.length / replyCharsPerTick)
    schedule(replyStart, () => {
      setSelectedTaskDetail((current) => ({
        ...current,
        conversations: [
          ...current.conversations,
          {
            id: 'md-demo-agent-reply',
            taskId: marketingDemoFeatureTaskId,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString()
          }
        ]
      }))
    })
    for (let tick = 1; tick <= replyTicks; tick += 1) {
      const end = Math.min(tick * replyCharsPerTick, reply.length)
      schedule(replyStart + tick * replyStep, () => {
        setSelectedTaskDetail((current) => ({
          ...current,
          conversations: current.conversations.map((entry) =>
            entry.id === 'md-demo-agent-reply' ? { ...entry, content: reply.slice(0, end) } : entry
          )
        }))
      })
    }

    const closeAt = replyStart + replyTicks * replyStep + 900
    schedule(closeAt, () => setTaskDetailExiting(true))

    // After the popup exits, move the card into Active and highlight it again.
    schedule(closeAt + 420, () => {
      moveFeatureTaskToActive()
    })
    schedule(closeAt + 560, () => {
      setProductDemoAiming(true)
    })
    schedule(closeAt + 2200, () => {
      setProductDemoAiming(false)
    })
    schedule(MARKETING_PRODUCT_DEMO_MS, () => {
      setMarketingDemoMode(null)
      setProductDemoCountdown(null)
      setProductDemoDraft(null)
      setProductDemoCursor(null)
      setProductDemoAiming(false)
      setProductDemoTasks(marketingDemoTasks.map((task) => ({ ...task })))
      marketingDemoTimersRef.current = []
    })
  }

  const replayTutorial = (): void => {
    stopMarketingDemo()
    setTutorialCompleteOpen(false)
    setTutorialStep(null)
    setTutorialWelcomeOpen(true)
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
    if (!task || task.status === 'processing') return

    await runAction(`task:delete:${id}`, async () => {
      const snapshotTask = task
      const restoreSelected = selectedTaskId === id
      setDeleteTaskId(null)
      if (restoreSelected) setSelectedTaskId(null)
      // Optimistic: drop it from the board immediately.
      setState((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((item) => item.id !== id)
      }))

      try {
        await window.vibeboard.deleteTask(id)
      } catch (error) {
        setState((prev) => {
          if (prev.tasks.some((item) => item.id === snapshotTask.id)) return prev
          return { ...prev, tasks: [...prev.tasks, snapshotTask] }
        })
        if (restoreSelected) setSelectedTaskId(id)
        showBoardNotice(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'Couldn’t delete the task. It’s back on the board.'
        )
      }
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

  const updateTaskModel = async (taskId: string, model: string | null): Promise<void> => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task || (task.model ?? null) === model) return
    await runAction(`task:model:${taskId}`, async () => {
      await window.vibeboard.updateTaskModel({ taskId, model })
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
    // Tutorial showcase cards are fake and are not in app state.
    if (isTutorialActive || task.id.startsWith('tutorial-')) return
    if (isProductDemo || task.id.startsWith('md-task-')) {
      setSelectedTaskId(task.id)
      return
    }
    setSelectedTaskId(task.id)
  }

  const sendTaskMessage = async (
    taskId: string,
    content: string,
    attachments: TaskMessageAttachmentInput[] = []
  ): Promise<void> => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!agentCliSnapshot.active.available || !task?.projectId) return
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
    if (!agentCliSnapshot.active.available || !task?.projectId || task.status === 'processing') return
    await runAction(`task:retry:${taskId}`, async () => {
      await window.vibeboard.runTaskWithCursor(taskId)
      await refresh()
    })
  }

  const retryTaskPrompt = async (taskId: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!agentCliSnapshot.active.available || !task?.projectId) return

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
    })
  }

  const saveNotchOverlaySettings = async (settings: NotchOverlaySettings): Promise<void> => {
    await runAction('notch:save', async () => {
      const nextSettings = await window.vibeboard.updateNotchOverlaySettings(settings)
      setNotchOverlaySettings(nextSettings)
      const capability = await window.vibeboard.getNotchOverlayCapability()
      setNotchCapability(capability)
      setNotchFeedback(
        nextSettings.enabled && !capability.supported
          ? (capability.reason ?? 'This display is not supported.')
          : ''
      )
    })
  }

  const saveKeyboardAlertSettings = async (settings: KeyboardAlertSettings): Promise<void> => {
    await runAction('keyboardAlert:save', async () => {
      const nextSettings = await window.vibeboard.updateKeyboardAlertSettings(settings)
      setKeyboardAlertSettings(nextSettings)
      const capability = await window.vibeboard.getKeyboardAlertCapability()
      setKeyboardAlertCapability(capability)
      setKeyboardAlertFeedback(
        nextSettings.enabled && !capability.supported
          ? (capability.reason ?? 'Keyboard backlight is not available on this Mac.')
          : ''
      )
    })
  }

  const testKeyboardAlert = async (): Promise<void> => {
    await runAction('keyboardAlert:test', async () => {
      const result = await window.vibeboard.testKeyboardAlertFlash()
      setKeyboardAlertFeedback(result.ok ? 'Flashing keyboard…' : (result.reason ?? 'Test failed'))
      if (result.ok) {
        window.setTimeout(() => setKeyboardAlertFeedback(''), 3600)
      }
    })
  }

  const saveAppearanceSettings = async (settings: AppearanceSettings): Promise<void> => {
    await runAction('appearance:save', async () => {
      const nextSettings = await window.vibeboard.updateAppearanceSettings(settings)
      setAppearanceSettings(nextSettings)
      applyAppearanceSettings(nextSettings)
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
        // Nested modals (e.g. image preview over task detail) share Escape.
        // Defer to the topmost useModalEscape handler so only that overlay closes.
        if (modalEscapeStack.length > 1) {
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
          if (!isProductDemo) setTaskDetailExiting(true)
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
  }, [
    activeTab,
    deleteTabId,
    deleteTaskId,
    isGlobalSearchOpen,
    isProductDemo,
    newTaskLaneId,
    quitRequest,
    renameTaskId,
    selectedTaskId,
    state.tabs
  ])

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

      <main
        className={`${isSidebarCollapsed ? 'workspace sidebar-collapsed' : 'workspace'}${
          isProductDemo ? ' marketing-product-demo' : ''
        }${
          isProductDemo && productDemoCountdown == null ? ' marketing-product-demo-live' : ''
        }${productDemoAiming ? ' marketing-product-demo-aiming' : ''}${
          productDemoCursor?.pressing ? ' marketing-product-demo-clicking' : ''
        }${productDemoCursor ? ' marketing-product-demo-fake-cursor' : ''}`}
      >
        <aside className="sidebar" data-tour="sidebar">
          <div className="sidebar-head">
            <div className="brand">
              <LayoutDashboard size={18} strokeWidth={1.75} />
              <span>VibeBoard</span>
            </div>
            <button
              className="icon-button sidebar-toggle"
              type="button"
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen size={16} strokeWidth={1.75} />
              ) : (
                <PanelLeftClose size={16} strokeWidth={1.75} />
              )}
            </button>
          </div>

          <nav className="sidebar-nav" aria-label="Workspace">
            <button
              className="sidebar-nav-item sidebar-nav-primary"
              type="button"
              onClick={createProject}
              disabled={isActionPending('project:create') || isShowcaseBoard}
              title="Add project"
            >
              <FolderPlus size={16} strokeWidth={1.75} />
              <span>Add project</span>
            </button>

            <GlobalSearchLauncher onOpen={() => setGlobalSearchOpen(true)} />
            <SettingsLauncher
              onOpen={() => {
                setNotificationFeedback('')
                setNotchFeedback('')
                setKeyboardAlertFeedback('')
                setSettingsCategory('appearance')
                void window.vibeboard.getAppearanceSettings().then((settings) => {
                  setAppearanceSettings(settings)
                  applyAppearanceSettings(settings)
                })
                if (navigator.userAgent.includes('Mac')) {
                  void window.vibeboard.getNotchOverlayCapability().then(setNotchCapability)
                  void window.vibeboard.getNotchOverlaySettings().then(setNotchOverlaySettings)
                  void window.vibeboard.getKeyboardAlertCapability().then(setKeyboardAlertCapability)
                  void window.vibeboard.getKeyboardAlertSettings().then(setKeyboardAlertSettings)
                }
                void window.vibeboard.getUpdateInfo().then(setUpdateInfo)
                setSettingsOpen(true)
              }}
            />
            {isDevMode && !isShowcaseBoard && (
              <DevTutorialLauncher onOpen={replayTutorial} />
            )}
            {isDevMode &&
              !isShowcaseBoard &&
              notchCapability.platform === 'darwin' && <DevNotchFinishLauncher />}
            {isDevMode &&
              !isShowcaseBoard &&
              notchCapability.platform === 'darwin' && <DevNotchRunningLauncher />}
            {isDevMode && !isProductDemo && (
              <DevProductDemoLauncher onStart={startProductMarketingDemo} />
            )}
          </nav>

          <section className="sidebar-section board-snapshot">
            <div className="sidebar-section-label">Task overview</div>
            <div className="sidebar-metrics">
              <SidebarStat label="Tasks" value={boardStats.total} />
              <SidebarStat label="Running" value={boardStats.running} tone="orange" />
              <SidebarStat label="Issues" value={boardStats.attention} tone="red" />
              <SidebarStat label="Done" value={boardStats.done} tone="green" />
            </div>
          </section>

          {!isShowcaseBoard && (
            <section className="sidebar-section integration-panel">
              <div className="sidebar-section-label">Agent CLI</div>
              <AgentCliPicker
                snapshot={agentCliSnapshot}
                onSelect={selectAgentCli}
              />
              {!agentCliSnapshot.active.available && (
                <AgentCliSetupCard
                  provider={agentCliSnapshot.active}
                  feedback={cursorFeedback}
                  isWorking={isInstallingCursorCli || cursorSetupPhase === 'preparing'}
                  onSetup={() => void openAgentCliSetup()}
                />
              )}
            </section>
          )}

          <div className="sidebar-cta-stack">
            <button
              className="sidebar-nav-item sidebar-feedback"
              type="button"
              data-tour="sidebar-feedback"
              title="Send feedback on GitHub"
              onClick={() => {
                void window.vibeboard.openExternalUrl(
                  'https://github.com/YeeetSK/vibeboard/issues/new/choose'
                )
              }}
            >
              <MessageSquare size={16} strokeWidth={1.75} />
              <span>Feedback</span>
            </button>
            <button
              className="sidebar-nav-item sidebar-support"
              type="button"
              data-tour="sidebar-support"
              title="Support me on Buy Me a Coffee"
              onClick={() => {
                void window.vibeboard.openExternalUrl('https://buymeacoffee.com/yeeet')
              }}
            >
              <Heart size={16} strokeWidth={1.75} />
              <span>Support me</span>
            </button>
          </div>
        </aside>

        <section className="board-area" data-tour="board">
          {activeTab || isProductDemo ? (
            <>
              <header className="board-header">
                <div>
                  {isProductDemo ? (
                    <h1 className="board-title-input marketing-demo-board-title">Northstar</h1>
                  ) : (
                    <EditableTitle
                      className="board-title-input"
                      value={activeTab!.name}
                      onCommit={renameActiveTab}
                    />
                  )}
                </div>
                <div className="board-header-actions" data-tour="board-actions">
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => {
                      const firstLane = boardLanes[0]
                      if (firstLane) setNewTaskLaneId(firstLane.id)
                    }}
                    disabled={!boardLanes[0] || isShowcaseBoard}
                    title="Add task"
                  >
                    <Plus size={16} strokeWidth={1.75} />
                    <span>Task</span>
                  </button>
                  {activeProject && !isProductDemo && (
                    <AutoMoveToggle
                      enabled={Boolean(activeProject.autoMoveTasks)}
                      disabled={isActionPending(`project:autoMove:${activeProject.id}`)}
                      onChange={updateActiveProjectAutoMove}
                    />
                  )}
                  {!isProductDemo && (
                    <button
                      className="icon-text-button"
                      type="button"
                      onClick={openActiveProjectFolder}
                      disabled={
                        !activeProject ||
                        activeProject.pathMissing ||
                        isActionPending(`project:open:${activeProject.id}`)
                      }
                      title={`Open in ${openProjectLabel}`}
                    >
                      <FolderOpen size={ICON_SM} strokeWidth={ICON_STROKE} />
                      <span>{openProjectLabel}</span>
                    </button>
                  )}
                  {activeProject?.pathMissing && !isProductDemo && (
                    <button
                      className="icon-text-button needs-attention"
                      type="button"
                      onClick={relocateActiveProject}
                      disabled={isActionPending(`project:relocate:${activeProject.id}`)}
                      title="Relocate project folder"
                    >
                      <FolderOpen size={ICON_SM} strokeWidth={ICON_STROKE} />
                      <span>Relocate</span>
                    </button>
                  )}
                  <button
                    className="icon-text-button"
                    type="button"
                    onClick={createLane}
                    disabled={isShowcaseBoard || isActionPending(`lane:create:${activeTab?.id ?? ''}`)}
                  >
                    <Plus size={ICON_SM} strokeWidth={ICON_STROKE} />
                    <span>Lane</span>
                  </button>
                </div>
              </header>

              <DndContext
                sensors={sensors}
                collisionDetection={taskCollisionDetection}
                onDragStart={isShowcaseBoard ? () => undefined : onDragStart}
                onDragOver={isShowcaseBoard ? () => undefined : onDragOver}
                onDragCancel={clearTaskDrag}
                onDragEnd={isShowcaseBoard ? () => undefined : onDragEnd}
              >
                <div
                  data-tour="board-lanes"
                  className={activeDragTaskId ? 'lane-grid dragging-card' : 'lane-grid'}
                  style={{ '--lane-count': Math.min(boardLanes.length, 4) } as React.CSSProperties}
                >
                  {boardLanes.map((lane) => (
                    <LaneColumn
                      key={lane.id}
                      lane={lane}
                      tasks={boardTasksByLaneId.get(lane.id) ?? []}
                      activeDragTaskId={isShowcaseBoard ? null : activeDragTaskId}
                      dropPreviewPosition={
                        isTutorialActive
                          ? null
                          : dragPreviewTarget?.laneId === lane.id
                            ? dragPreviewTarget.position
                            : null
                      }
                      onOpenTask={openTask}
                      onDeleteLane={setDeleteLaneId}
                      onDeleteTask={setDeleteTaskId}
                      onFinishTask={finishTask}
                      onRenameTask={setRenameTaskId}
                      canDelete={!isShowcaseBoard && activeLanes.length > 1}
                      onRenameLane={renameLane}
                    />
                  ))}
                </div>
                <DragOverlay dropAnimation={null}>
                  {activeDragTask ? (
                    <TaskCardPreview
                      task={activeDragTask}
                      width={dragOverlayWidth}
                    />
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
          project={
            isProductDemo
              ? marketingDemoProject
              : state.projects.find((project) => project.id === selectedTask.projectId) ?? null
          }
          conversations={selectedTaskDetail.conversations}
          changes={selectedTaskDetail.changes}
          hasOlderConversations={selectedTaskDetail.hasOlderConversations}
          isLoadingOlderConversations={isLoadingOlderConversations}
          canUseCursor={isProductDemo || agentCliSnapshot.active.available}
          activeAgentLabel={agentCliSnapshot.active.label}
          activeAgentCli={agentCliSnapshot.activeCli}
          forcedDraft={isProductDemo ? productDemoDraft ?? '' : undefined}
          isExiting={taskDetailExiting}
          onLoadOlderConversations={loadOlderSelectedTaskConversations}
          onSendMessage={(taskId, content, attachments) => {
            if (isProductDemo) {
              const trimmed = content.trim()
              if (!trimmed) return
              setSelectedTaskDetail((current) => ({
                ...current,
                conversations: [
                  ...current.conversations,
                  {
                    id: `md-demo-send-${Date.now()}`,
                    taskId,
                    role: 'user',
                    content: trimmed,
                    createdAt: new Date().toISOString()
                  }
                ]
              }))
              setProductDemoDraft(null)
              return
            }
            void sendTaskMessage(taskId, content, attachments)
          }}
          onRetryTask={retryTask}
          onRetryPrompt={retryTaskPrompt}
          onStopTask={stopTask}
          onUpdateModel={updateTaskModel}
          onDeleteTask={setDeleteTaskId}
          onClose={() => {
            if (isProductDemo) return
            setTaskDetailExiting(true)
          }}
          onExited={() => {
            setSelectedTaskId(null)
            setSelectedTaskDetail(emptyTaskDetail)
            setTaskDetailExiting(false)
            setProductDemoDraft(null)
          }}
        />
      )}

      {productDemoCountdown != null && (
        <div className="marketing-countdown" aria-live="assertive">
          <span key={productDemoCountdown} className="marketing-countdown-digit">
            {productDemoCountdown}
          </span>
        </div>
      )}

      {productDemoCursor && (
        <div
          className={`marketing-demo-cursor${productDemoCursor.moving ? ' is-moving' : ''}${
            productDemoCursor.pressing ? ' is-pressing' : ''
          }`}
          style={{
            transform: `translate3d(${productDemoCursor.x}px, ${productDemoCursor.y}px, 0)`
          }}
          aria-hidden="true"
        >
          <div className="marketing-demo-cursor-hand">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M5.5 3.2 18.2 12.1l-5.4 1.3 2.6 6.5-2.5 1-2.6-6.5-4.3 4.2V3.2Z"
                fill="#f4f4f5"
                stroke="#111"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span className="marketing-demo-cursor-ripple" />
          </div>
        </div>
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

      {isSettingsOpen && (
        <SettingsModal
          category={settingsCategory}
          onCategoryChange={setSettingsCategory}
          appearanceSettings={appearanceSettings}
          notificationSettings={notificationSettings}
          notificationFeedback={notificationFeedback}
          notchSettings={notchOverlaySettings}
          notchCapability={notchCapability}
          notchFeedback={notchFeedback}
          keyboardSettings={keyboardAlertSettings}
          keyboardCapability={keyboardAlertCapability}
          keyboardFeedback={keyboardAlertFeedback}
          updateInfo={updateInfo}
          isSavingAppearance={isActionPending('appearance:save')}
          isSavingNotifications={
            isActionPending('notifications:save') || isActionPending('notifications:test')
          }
          isSavingNotch={isActionPending('notch:save')}
          isSavingKeyboard={
            isActionPending('keyboardAlert:save') || isActionPending('keyboardAlert:test')
          }
          isUpdating={
            isActionPending('update:download') || isActionPending('update:install')
          }
          onClose={() => setSettingsOpen(false)}
          onSaveAppearance={saveAppearanceSettings}
          onSaveNotifications={saveNotificationSettings}
          onTestNotifications={testNotificationSettings}
          onSaveNotch={saveNotchOverlaySettings}
          onSaveKeyboard={saveKeyboardAlertSettings}
          onTestKeyboard={testKeyboardAlert}
          onDownloadUpdate={downloadUpdate}
          onInstallUpdate={installUpdate}
        />
      )}

      <UpdateBanner
        info={updateInfo}
        onDownload={downloadUpdate}
        onInstall={installUpdate}
        onOpenSettings={() => {
          setSettingsCategory('updates')
          setSettingsOpen(true)
        }}
      />

      {releaseNotesModal && (
        <ReleaseNotesModal
          release={releaseNotesModal}
          onClose={() => setReleaseNotesModal(null)}
        />
      )}

      {isTutorialWelcomeOpen && (
        <TutorialWelcomeOverlay
          onStart={startTutorialTour}
          onSkip={skipTutorial}
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

      {boardNotice ? (
        <div className="board-notice" role="status" aria-live="polite">
          <span>{boardNotice}</span>
          <button
            className="board-notice-dismiss"
            type="button"
            onClick={() => setBoardNotice(null)}
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X size={14} strokeWidth={ICON_STROKE} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function AutoMoveToggle({
  enabled,
  disabled,
  onChange
}: {
  enabled: boolean
  disabled: boolean
  onChange: (enabled: boolean) => void
}): ReactElement {
  const tooltip =
    enabled
      ? 'Auto-move is on. Finished tasks move to Review, and opening them moves them to Done.'
      : 'Auto-move is off. Task status changes still happen, but cards stay in the lane where you put them.'

  return (
    <span className="auto-move-toggle-wrap">
      <button
        className={enabled ? 'icon-text-button auto-move-toggle enabled' : 'icon-text-button auto-move-toggle'}
        type="button"
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        aria-pressed={enabled}
        aria-describedby="auto-move-tooltip"
      >
        {enabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
        <span>Auto-move</span>
      </button>
      <span className="auto-move-tooltip" id="auto-move-tooltip" role="tooltip">
        {tooltip}
      </span>
    </span>
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
        className={`tutorial-spotlight${currentStep.spotlight === 'sidebar' ? ' is-sidebar' : ''}`}
        style={spotlightStyle(spotlightRect, currentStep.spotlight)}
      />

      {currentStep.id === 'demo' && (
        <section className="modal-panel task-detail tutorial-demo" data-tour="tutorial-demo">
          <div className="modal-head">
            <div>
              <h2>Review release notes</h2>
              <p className="task-detail-meta">
                <span>vibeboard</span>
              </p>
            </div>
            <div className="modal-head-actions">
              <button
                className="code-changes-switch on"
                type="button"
                role="switch"
                aria-checked="true"
                tabIndex={-1}
                title="Show code changes"
              >
                <Code2 size={14} strokeWidth={1.75} />
                <span>Changes</span>
                <span className="code-changes-track" aria-hidden="true">
                  <span className="code-changes-thumb" />
                </span>
              </button>
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
                  <button className="icon-button" type="button" disabled title="Attach image">
                    <Paperclip size={16} />
                  </button>
                  <textarea disabled rows={1} placeholder="Message…" value="" readOnly />
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

function TutorialWelcomeOverlay({
  onStart,
  onSkip
}: {
  onStart: () => void
  onSkip: () => void
}): ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onSkip()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        onStart()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onSkip, onStart])

  return (
    <div className="modal-backdrop tutorial-welcome-backdrop" role="presentation">
      <section className="tutorial-complete-card tutorial-welcome-card" role="dialog" aria-modal="true">
        <h2>
          Welcome to VibeBoard
        </h2>
        <p>
          A short tour of projects, lanes, and agent chat. Skip anytime if you already know your way
          around.
        </p>
        <footer className="tutorial-complete-actions">
          <button className="secondary-action" type="button" onClick={onSkip}>
            Skip
            <span className="key-hint">Esc</span>
          </button>
          <button className="primary-action" type="button" onClick={onStart}>
            Start tour
            <span className="key-hint key-hint-icon" aria-label="Enter">
              <CornerDownLeft size={14} />
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}

function TutorialCompleteOverlay({ onClose }: { onClose: () => void }): ReactElement {
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isExiting, setIsExiting] = useState(false)
  const exitTimerRef = useRef<number | null>(null)

  const requestClose = (): void => {
    if (isExiting) return
    setIsExiting(true)
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)
    const prefersReduced =
      document.documentElement.dataset.reduceMotion === 'reduce' ||
      (document.documentElement.dataset.reduceMotion !== 'no-preference' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null
      onClose()
    }, prefersReduced ? 40 : 460)
  }

  useModalEscape(requestClose)

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const canvas = confettiCanvasRef.current
    if (!canvas) return

    // Electron CSP blocks blob workers, so keep rendering on the main thread.
    const fireConfetti = confetti.create(canvas, {
      resize: true,
      useWorker: false
    })
    const defaults = {
      particleCount: 100,
      spread: 70,
      startVelocity: 38,
      ticks: 240,
      gravity: 0.9,
      scalar: 0.95,
      colors: ['#ff7a1a', '#2fcf75', '#f7c56b', '#9b8cff', '#f2f2f2']
    }

    let burstTimeout = 0
    const frameId = window.requestAnimationFrame(() => {
      void fireConfetti({
        ...defaults,
        origin: { x: 0.28, y: 0.35 },
        angle: 60
      })
      void fireConfetti({
        ...defaults,
        origin: { x: 0.72, y: 0.35 },
        angle: 120
      })
      burstTimeout = window.setTimeout(() => {
        void fireConfetti({
          ...defaults,
          particleCount: 55,
          origin: { x: 0.5, y: 0.28 },
          angle: 90,
          spread: 100
        })
      }, 180)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(burstTimeout)
      fireConfetti.reset()
    }
  }, [])

  useEffect(() => {
    const closeOnEnter = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Enter') return
      event.preventDefault()
      requestClose()
    }

    window.addEventListener('keydown', closeOnEnter, true)
    return () => window.removeEventListener('keydown', closeOnEnter, true)
  }, [isExiting])

  return (
    <div
      className={`modal-backdrop tutorial-complete-backdrop${isExiting ? ' is-exiting' : ''}`}
      role="presentation"
      onMouseDown={closeOnBackdropMouseDown(requestClose)}
    >
      <canvas className="tutorial-confetti-canvas" ref={confettiCanvasRef} aria-hidden="true" />
      <section className="tutorial-complete-card" role="dialog" aria-modal="true">
        <h2>
          You're ready to start VibeBoard<em>ing</em>
        </h2>
        <p>Create a project, add tasks, and let each agent run in its own worktree.</p>
        <footer className="tutorial-complete-actions">
          <button className="primary-action" type="button" onClick={requestClose} disabled={isExiting}>
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

  if (type === 'sidebar') {
    // Flush to the window edge so the cutout doesn't float with uneven padding.
    const left = Math.max(0, Math.round(rect.left))
    const top = Math.max(0, Math.round(rect.top))
    return {
      top,
      left,
      width: Math.round(rect.width + Math.min(left, 1)),
      height: Math.round(rect.height),
      borderRadius: '0 12px 12px 0'
    }
  }

  const paddingByType: Record<string, number> = {
    tabs: 5,
    board: 10,
    actions: 6,
    modal: 10,
    support: 8
  }
  const padding = paddingByType[type] ?? 6
  const left = Math.max(0, rect.left - padding)
  const top = Math.max(0, rect.top - padding)

  return {
    top,
    left,
    width: Math.min(window.innerWidth - left - 6, rect.width + padding * 2),
    height: Math.min(window.innerHeight - top - 6, rect.height + padding * 2)
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
    <button className="sidebar-nav-item sidebar-search" type="button" onClick={onOpen} title="Search">
      <Search size={16} strokeWidth={1.75} />
      <span>Search</span>
      <kbd>{navigator.userAgent.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  )
}

function SettingsLauncher({ onOpen }: { onOpen: () => void }): ReactElement {
  return (
    <button className="sidebar-nav-item" type="button" onClick={onOpen} title="Settings">
      <Settings size={16} strokeWidth={1.75} />
      <span>Settings</span>
    </button>
  )
}

function DevTutorialLauncher({ onOpen }: { onOpen: () => void }): ReactElement {
  return (
    <button className="sidebar-nav-item" type="button" onClick={onOpen} title="Replay tutorial">
      <RotateCcw size={16} strokeWidth={1.75} />
      <span>Replay tutorial</span>
    </button>
  )
}

function DevProductDemoLauncher({ onStart }: { onStart: () => void }): ReactElement {
  return (
    <button
      className="sidebar-nav-item"
      type="button"
      title="Auto-play board + chat marketing demo"
      onClick={onStart}
    >
      <Clapperboard size={16} strokeWidth={1.75} />
      <span>Product demo</span>
    </button>
  )
}

type SettingsCategory = 'appearance' | 'notifications' | 'notch' | 'keyboard' | 'updates'

function SettingsSwitch({
  checked,
  disabled,
  onChange,
  label
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  label: string
}): ReactElement {
  return (
    <button
      className={`settings-switch${checked ? ' on' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch-knob" />
    </button>
  )
}

function SettingsRow({
  title,
  description,
  disabled,
  control,
  nested
}: {
  title: string
  description?: ReactNode
  disabled?: boolean
  control: ReactElement
  nested?: boolean
}): ReactElement {
  return (
    <div className={`settings-row${nested ? ' nested' : ''}${disabled ? ' disabled' : ''}`}>
      <div className="settings-row-copy">
        <span className="settings-row-title">{title}</span>
        {description ? <span className="settings-row-desc">{description}</span> : null}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  )
}

function SettingsModal({
  category,
  onCategoryChange,
  appearanceSettings,
  notificationSettings,
  notificationFeedback,
  notchSettings,
  notchCapability,
  notchFeedback,
  keyboardSettings,
  keyboardCapability,
  keyboardFeedback,
  updateInfo,
  isSavingAppearance,
  isSavingNotifications,
  isSavingNotch,
  isSavingKeyboard,
  isUpdating,
  onClose,
  onSaveAppearance,
  onSaveNotifications,
  onTestNotifications,
  onSaveNotch,
  onSaveKeyboard,
  onTestKeyboard,
  onDownloadUpdate,
  onInstallUpdate
}: {
  category: SettingsCategory
  onCategoryChange: (category: SettingsCategory) => void
  appearanceSettings: AppearanceSettings
  notificationSettings: NotificationSettings
  notificationFeedback: string
  notchSettings: NotchOverlaySettings
  notchCapability: NotchOverlayCapability
  notchFeedback: string
  keyboardSettings: KeyboardAlertSettings
  keyboardCapability: KeyboardAlertCapability
  keyboardFeedback: string
  updateInfo: UpdateInfo
  isSavingAppearance: boolean
  isSavingNotifications: boolean
  isSavingNotch: boolean
  isSavingKeyboard: boolean
  isUpdating: boolean
  onClose: () => void
  onSaveAppearance: (settings: AppearanceSettings) => Promise<void>
  onSaveNotifications: (settings: NotificationSettings) => Promise<void>
  onTestNotifications: (settings: NotificationSettings) => Promise<void>
  onSaveNotch: (settings: NotchOverlaySettings) => Promise<void>
  onSaveKeyboard: (settings: KeyboardAlertSettings) => Promise<void>
  onTestKeyboard: () => Promise<void>
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
}): ReactElement {
  const showNotch = notchCapability.platform === 'darwin'
  const showKeyboard = keyboardCapability.platform === 'darwin'
  useModalEscape(onClose)

  useEffect(() => {
    if (category === 'notch' && !showNotch) onCategoryChange('appearance')
    if (category === 'keyboard' && !showKeyboard) onCategoryChange('appearance')
  }, [category, showNotch, showKeyboard, onCategoryChange])

  const navItems: Array<{ id: SettingsCategory; label: string; icon: ReactElement }> = [
    { id: 'appearance', label: 'Appearance', icon: <Palette size={16} strokeWidth={1.75} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={16} strokeWidth={1.75} /> },
    ...(showNotch
      ? [{ id: 'notch' as const, label: 'Notch', icon: <Scan size={16} strokeWidth={1.75} /> }]
      : []),
    ...(showKeyboard
      ? [{ id: 'keyboard' as const, label: 'Keyboard', icon: <Keyboard size={16} strokeWidth={1.75} /> }]
      : []),
    { id: 'updates', label: 'Updates', icon: <Download size={16} strokeWidth={1.75} /> }
  ]

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section className="modal-panel settings-modal" role="dialog" aria-modal="true" tabIndex={-1}>
        <header className="settings-modal-head">
          <h2>Settings</h2>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <div className="settings-shell">
          <nav className="settings-nav" aria-label="Settings categories">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`settings-nav-item${category === item.id ? ' active' : ''}`}
                type="button"
                onClick={() => onCategoryChange(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-pane">
            {category === 'appearance' && (
              <SettingsAppearancePane
                settings={appearanceSettings}
                isSaving={isSavingAppearance}
                onSave={onSaveAppearance}
              />
            )}
            {category === 'notifications' && (
              <SettingsNotificationsPane
                settings={notificationSettings}
                feedback={notificationFeedback}
                isSaving={isSavingNotifications}
                onSave={onSaveNotifications}
                onTest={onTestNotifications}
              />
            )}
            {category === 'notch' && showNotch && (
              <SettingsNotchPane
                settings={notchSettings}
                capability={notchCapability}
                feedback={notchFeedback}
                isSaving={isSavingNotch}
                onSave={onSaveNotch}
              />
            )}
            {category === 'keyboard' && showKeyboard && (
              <SettingsKeyboardPane
                settings={keyboardSettings}
                capability={keyboardCapability}
                feedback={keyboardFeedback}
                isSaving={isSavingKeyboard}
                onSave={onSaveKeyboard}
                onTest={onTestKeyboard}
              />
            )}
            {category === 'updates' && (
              <SettingsUpdatesPane
                info={updateInfo}
                isUpdating={isUpdating}
                onDownload={onDownloadUpdate}
                onInstall={onInstallUpdate}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function SettingsStepper({
  value,
  min,
  max,
  onChange,
  label
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  label: string
}): ReactElement {
  return (
    <div className="settings-stepper" aria-label={label}>
      <button type="button" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Decrease ${label}`}>
        <Minus size={14} strokeWidth={ICON_STROKE} />
      </button>
      <strong>{value}</strong>
      <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`Increase ${label}`}>
        <Plus size={14} strokeWidth={ICON_STROKE} />
      </button>
    </div>
  )
}

function SettingsSelect({
  value,
  options,
  onChange,
  label
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  label: string
}): ReactElement {
  return (
    <select
      className="settings-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

const APPEARANCE_PREVIEW_CODE = `export function signIn(session: Session) {
  cookies().set('sid', session.id, { path: '/' })
  return redirect('/app')
}`

function AppearanceTypographyPreview(): ReactElement {
  const codeHtml = highlightCode(APPEARANCE_PREVIEW_CODE, 'ts')

  return (
    <div className="settings-type-preview" aria-label="Typography preview">
      <div className="settings-type-preview-pane">
        <span className="settings-type-preview-kicker">Interface</span>
        <article className="task-card settings-type-preview-card">
          <div className="task-card-content">
            <div className="task-card-topline">
              <span className="task-card-eyebrow">vibeboard / main</span>
            </div>
            <h3 className="task-card-title">Fix auth redirect loop</h3>
            <p className="task-card-summary">
              Session cookies should keep you signed in after a refresh.
            </p>
            <div className="task-card-footer">
              <span className="task-card-footer-status tone-working">
                <Loader2 size={13} strokeWidth={ICON_STROKE} className="task-card-spinner" />
                <span>Running</span>
              </span>
              <span className="task-card-footer-dot" aria-hidden="true">
                ·
              </span>
              <span className="task-card-footer-time">just now</span>
            </div>
          </div>
        </article>
        <div className="message-markdown">
          <p>
            Updated the session cookie path so sign-in survives a refresh. Reply here uses the same
            chat typography as agent conversations.
          </p>
        </div>
      </div>

      <div className="settings-type-preview-pane">
        <span className="settings-type-preview-kicker">Code</span>
        <MarkdownCodeBlock code={APPEARANCE_PREVIEW_CODE} language="ts" html={codeHtml} />
        <div className="diff-table" role="table" aria-label="Sample diff">
          <div className="diff-rows">
            <div className="diff-line removed" role="row">
              <span className="diff-gutter">-</span>
              <span className="diff-number">18</span>
              <code
                dangerouslySetInnerHTML={{
                  __html: highlightCode("cookies().set('sid', session.id)", 'ts')
                }}
              />
            </div>
            <div className="diff-line added" role="row">
              <span className="diff-gutter">+</span>
              <span className="diff-number">18</span>
              <code
                dangerouslySetInnerHTML={{
                  __html: highlightCode(
                    "cookies().set('sid', session.id, { path: '/' })",
                    'ts'
                  )
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsAppearancePane({
  settings,
  onSave
}: {
  settings: AppearanceSettings
  isSaving: boolean
  onSave: (settings: AppearanceSettings) => Promise<void>
}): ReactElement {
  const [draft, setDraft] = useState(settings)
  const saveTimerRef = useRef<number | null>(null)
  const latestDraftRef = useRef(settings)

  useEffect(() => {
    setDraft(settings)
    latestDraftRef.current = settings
  }, [settings])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        void onSave(latestDraftRef.current)
      }
    }
  }, [onSave])

  const persist = (next: AppearanceSettings): void => {
    latestDraftRef.current = next
    setDraft(next)
    applyAppearanceSettings(next)
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void onSave(latestDraftRef.current)
    }, 280)
  }

  const patch = (partial: Partial<AppearanceSettings>): void => {
    persist({ ...latestDraftRef.current, ...partial })
  }

  const typographyIsCustom =
    draft.uiFontSize !== emptyAppearanceSettings.uiFontSize ||
    draft.codeFontSize !== emptyAppearanceSettings.codeFontSize

  return (
    <div className="settings-pane-body">
      <header className="settings-pane-intro">
        <h3>Appearance</h3>
        <p>Typography and motion preferences.</p>
      </header>

      <div className="settings-block">
        <h4 className="settings-block-label">Typography</h4>
        <div className="settings-list">
          <SettingsRow
            title="UI font size"
            description="Font size for the VibeBoard interface"
            control={
              <SettingsStepper
                label="UI font size"
                value={draft.uiFontSize}
                min={12}
                max={18}
                onChange={(value) => patch({ uiFontSize: value })}
              />
            }
          />
          <SettingsRow
            title="Code font size"
            description="Font size for code blocks and diffs"
            control={
              <SettingsStepper
                label="Code font size"
                value={draft.codeFontSize}
                min={11}
                max={16}
                onChange={(value) => patch({ codeFontSize: value })}
              />
            }
          />
          {typographyIsCustom ? (
            <SettingsRow
              title="Custom sizes"
              description="UI or code size differs from the defaults"
              control={
                <button
                  className="settings-preview-button"
                  type="button"
                  title="Reset UI and code font sizes to defaults"
                  onClick={() =>
                    patch({
                      uiFontSize: emptyAppearanceSettings.uiFontSize,
                      codeFontSize: emptyAppearanceSettings.codeFontSize
                    })
                  }
                >
                  <span>Reset to default</span>
                </button>
              }
            />
          ) : null}
          <AppearanceTypographyPreview />
          <SettingsRow
            title="Font smoothing"
            description="Use native macOS font anti-aliasing"
            control={
              <SettingsSwitch
                label="Font smoothing"
                checked={draft.fontSmoothing}
                onChange={(checked) => patch({ fontSmoothing: checked })}
              />
            }
          />
        </div>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-label">Motion</h4>
        <div className="settings-list">
          <SettingsRow
            title="Reduce motion"
            description="Minimize interface animations. System follows your OS preference."
            control={
              <SettingsSelect
                label="Reduce motion"
                value={draft.reduceMotion}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'reduce', label: 'Reduce' },
                  { value: 'no-preference', label: 'No preference' }
                ]}
                onChange={(value) => patch({ reduceMotion: value as AppearanceSettings['reduceMotion'] })}
              />
            }
          />
        </div>
      </div>
    </div>
  )
}

function SettingsNotificationsPane({
  settings,
  feedback,
  isSaving,
  onSave,
  onTest
}: {
  settings: NotificationSettings
  feedback: string
  isSaving: boolean
  onSave: (settings: NotificationSettings) => Promise<void>
  onTest: (settings: NotificationSettings) => Promise<void>
}): ReactElement {
  const [draft, setDraft] = useState(settings)
  const saveTimerRef = useRef<number | null>(null)
  const latestDraftRef = useRef(settings)

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        void onSave(latestDraftRef.current)
      }
    }
  }, [onSave])

  const persist = (next: NotificationSettings): void => {
    latestDraftRef.current = next
    setDraft(next)
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void onSave(latestDraftRef.current)
    }, 280)
  }

  const setDesktopEvent = (key: keyof NotificationEventSettings, value: boolean): void => {
    persist({
      ...latestDraftRef.current,
      desktopEvents: {
        ...latestDraftRef.current.desktopEvents,
        [key]: value
      }
    })
  }

  const setNtfyEvent = (key: keyof NotificationEventSettings, value: boolean): void => {
    const current = latestDraftRef.current
    persist({
      ...current,
      ntfy: {
        ...current.ntfy,
        events: {
          ...current.ntfy.events,
          [key]: value
        }
      }
    })
  }

  return (
    <>
      <div className="settings-pane-body">
        <header className="settings-pane-intro">
          <h3>Notifications</h3>
          <p>How VibeBoard alerts you when work finishes or needs you.</p>
        </header>

        <div className="settings-block">
          <h4 className="settings-block-label">Desktop</h4>
          <div className="settings-list">
            <SettingsRow
              title="Desktop notifications"
              description="Show native alerts on this Mac"
              control={
                <SettingsSwitch
                  label="Desktop notifications"
                  checked={draft.desktopEnabled}
                  onChange={(checked) =>
                    persist({ ...latestDraftRef.current, desktopEnabled: checked })
                  }
                />
              }
            />
            <SettingsRow
              title="Task completed"
              nested
              disabled={!draft.desktopEnabled}
              control={
                <SettingsSwitch
                  label="Notify when a task completes"
                  checked={draft.desktopEvents.taskCompleted}
                  disabled={!draft.desktopEnabled}
                  onChange={(checked) => setDesktopEvent('taskCompleted', checked)}
                />
              }
            />
            <SettingsRow
              title="Task failed"
              nested
              disabled={!draft.desktopEnabled}
              control={
                <SettingsSwitch
                  label="Notify when a task fails"
                  checked={draft.desktopEvents.taskFailed}
                  disabled={!draft.desktopEnabled}
                  onChange={(checked) => setDesktopEvent('taskFailed', checked)}
                />
              }
            />
            <SettingsRow
              title="All tasks finished"
              nested
              disabled={!draft.desktopEnabled}
              control={
                <SettingsSwitch
                  label="Notify when all tasks finish"
                  checked={draft.desktopEvents.allTasksFinished}
                  disabled={!draft.desktopEnabled}
                  onChange={(checked) => setDesktopEvent('allTasksFinished', checked)}
                />
              }
            />
          </div>
        </div>

        <div className="settings-block">
          <h4 className="settings-block-label">Sound</h4>
          <div className="settings-list">
            <SettingsRow
              title="Play sound when a task finishes"
              description="Uses a short system chime on macOS"
              control={
                <div className="settings-row-actions">
                  <button
                    className="settings-preview-button"
                    type="button"
                    title="Play sample"
                    onClick={() => {
                      void window.vibeboard.previewFinishSound()
                    }}
                  >
                    <Play size={13} strokeWidth={2} />
                    <span>Play</span>
                  </button>
                  <SettingsSwitch
                    label="Play sound when a task finishes"
                    checked={draft.playFinishSound}
                    onChange={(checked) =>
                      persist({ ...latestDraftRef.current, playFinishSound: checked })
                    }
                  />
                </div>
              }
            />
          </div>
        </div>

        <div className="settings-block">
          <h4 className="settings-block-label">Phone (ntfy.sh)</h4>
          <div className="settings-list">
            <SettingsRow
              title="Phone notifications"
              description={
                <>
                  Push alerts to your phone with the ntfy app. Install it and subscribe to a topic at{' '}
                  <button
                    type="button"
                    className="settings-text-link"
                    onClick={() => void window.vibeboard.openExternalUrl('https://ntfy.sh')}
                  >
                    ntfy.sh
                  </button>
                  .
                </>
              }
              control={
                <div className="settings-row-actions">
                  <button
                    className="settings-preview-button"
                    type="button"
                    title="Send a test phone notification"
                    disabled={isSaving || !draft.ntfy.enabled || !draft.ntfy.topic.trim()}
                    onClick={() => void onTest(draft)}
                  >
                    <span>Test</span>
                  </button>
                  <SettingsSwitch
                    label="Phone notifications via ntfy.sh"
                    checked={draft.ntfy.enabled}
                    onChange={(checked) => {
                      const current = latestDraftRef.current
                      persist({
                        ...current,
                        ntfy: { ...current.ntfy, enabled: checked }
                      })
                    }}
                  />
                </div>
              }
            />
            {feedback ? <p className="settings-inline-feedback">{feedback}</p> : null}
            <div className={`settings-field-row${!draft.ntfy.enabled ? ' disabled' : ''}`}>
              <label>
                <span>Server</span>
                <input
                  className="settings-input"
                  value={draft.ntfy.serverUrl}
                  disabled={!draft.ntfy.enabled}
                  onChange={(event) => {
                    const current = latestDraftRef.current
                    persist({
                      ...current,
                      ntfy: { ...current.ntfy, serverUrl: event.target.value }
                    })
                  }}
                  placeholder="https://ntfy.sh"
                />
              </label>
            </div>
            <div className={`settings-field-row${!draft.ntfy.enabled ? ' disabled' : ''}`}>
              <label>
                <span>Topic</span>
                <input
                  className="settings-input"
                  value={draft.ntfy.topic}
                  disabled={!draft.ntfy.enabled}
                  onChange={(event) => {
                    const current = latestDraftRef.current
                    persist({
                      ...current,
                      ntfy: { ...current.ntfy, topic: event.target.value }
                    })
                  }}
                  placeholder="your-topic"
                />
              </label>
            </div>
            <SettingsRow
              title="Task completed"
              nested
              disabled={!draft.ntfy.enabled}
              control={
                <SettingsSwitch
                  label="ntfy when a task completes"
                  checked={draft.ntfy.events.taskCompleted}
                  disabled={!draft.ntfy.enabled}
                  onChange={(checked) => setNtfyEvent('taskCompleted', checked)}
                />
              }
            />
            <SettingsRow
              title="Task failed"
              nested
              disabled={!draft.ntfy.enabled}
              control={
                <SettingsSwitch
                  label="ntfy when a task fails"
                  checked={draft.ntfy.events.taskFailed}
                  disabled={!draft.ntfy.enabled}
                  onChange={(checked) => setNtfyEvent('taskFailed', checked)}
                />
              }
            />
            <SettingsRow
              title="All tasks finished"
              nested
              disabled={!draft.ntfy.enabled}
              control={
                <SettingsSwitch
                  label="ntfy when all tasks finish"
                  checked={draft.ntfy.events.allTasksFinished}
                  disabled={!draft.ntfy.enabled}
                  onChange={(checked) => setNtfyEvent('allTasksFinished', checked)}
                />
              }
            />
          </div>
        </div>
      </div>
    </>
  )
}

function SettingsKeyboardPane({
  settings,
  capability,
  feedback,
  isSaving,
  onSave,
  onTest
}: {
  settings: KeyboardAlertSettings
  capability: KeyboardAlertCapability
  feedback: string
  isSaving: boolean
  onSave: (settings: KeyboardAlertSettings) => Promise<void>
  onTest: () => Promise<void>
}): ReactElement {
  const [draft, setDraft] = useState(settings)
  const saveTimerRef = useRef<number | null>(null)
  const latestDraftRef = useRef(settings)

  useEffect(() => {
    setDraft(settings)
    latestDraftRef.current = settings
  }, [settings])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        void onSave(latestDraftRef.current)
      }
    }
  }, [onSave])

  const persist = (next: KeyboardAlertSettings): void => {
    latestDraftRef.current = next
    setDraft(next)
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void onSave(latestDraftRef.current)
    }, 280)
  }

  const flashDisabled = !capability.supported || !draft.enabled

  return (
    <div className="settings-pane-body">
      <header className="settings-pane-intro">
        <h3>Keyboard</h3>
        <p>
          Hard on/off flashes on the backlit keyboard when work needs you, until you open VibeBoard
          or the task.
        </p>
      </header>

      {(capability.reason || !capability.supported || feedback) && (
        <p className={`settings-note${!capability.supported ? ' warn' : ''}`}>
          {feedback ||
            capability.reason ||
            'Needs a Mac with a controllable keyboard backlight.'}
        </p>
      )}

      <div className="settings-block">
        <h4 className="settings-block-label">Alert</h4>
        <div className="settings-list">
          <SettingsRow
            title="Flash keyboard backlight"
            description="Hard on/off flashes as a warning"
            disabled={!capability.supported}
            control={
              <SettingsSwitch
                label="Flash keyboard backlight"
                checked={draft.enabled}
                disabled={!capability.supported}
                onChange={(checked) => persist({ ...latestDraftRef.current, enabled: checked })}
              />
            }
          />
          <SettingsRow
            title="Test flash"
            description="Hard on/off for a few seconds, then restores brightness"
            disabled={!capability.supported}
            control={
              <button
                className="settings-preview-button"
                type="button"
                title="Test keyboard flash"
                disabled={!capability.supported || isSaving}
                onClick={() => void onTest()}
              >
                <span>Test</span>
              </button>
            }
          />
        </div>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-label">Flash when</h4>
        <div className="settings-list">
          <SettingsRow
            title="Needs attention"
            description="Task failed or is waiting for you"
            disabled={flashDisabled}
            control={
              <SettingsSwitch
                label="Flash when a task needs attention"
                checked={draft.flashOnTaskFailed}
                disabled={flashDisabled}
                onChange={(checked) =>
                  persist({ ...latestDraftRef.current, flashOnTaskFailed: checked })
                }
              />
            }
          />
          <SettingsRow
            title="Task completed"
            disabled={flashDisabled}
            control={
              <SettingsSwitch
                label="Flash when a task completes"
                checked={draft.flashOnTaskCompleted}
                disabled={flashDisabled}
                onChange={(checked) =>
                  persist({ ...latestDraftRef.current, flashOnTaskCompleted: checked })
                }
              />
            }
          />
          <SettingsRow
            title="All tasks finished"
            disabled={flashDisabled}
            control={
              <SettingsSwitch
                label="Flash when all tasks finish"
                checked={draft.flashOnAllFinished}
                disabled={flashDisabled}
                onChange={(checked) =>
                  persist({ ...latestDraftRef.current, flashOnAllFinished: checked })
                }
              />
            }
          />
        </div>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-label">Pause when</h4>
        <div className="settings-list">
          <SettingsRow
            title="App focused"
            description="Pause while VibeBoard is forward; resumes when you leave if it still needs you"
            disabled={flashDisabled}
            control={
              <SettingsSwitch
                label="Pause when app is focused"
                checked={draft.stopOnAppFocus}
                disabled={flashDisabled}
                onChange={(checked) =>
                  persist({ ...latestDraftRef.current, stopOnAppFocus: checked })
                }
              />
            }
          />
          <SettingsRow
            title="Task opened"
            description="Pause while that task is open; resumes when you leave if it still needs you"
            disabled={flashDisabled}
            control={
              <SettingsSwitch
                label="Pause when task is opened"
                checked={draft.stopOnOpenTask}
                disabled={flashDisabled}
                onChange={(checked) =>
                  persist({ ...latestDraftRef.current, stopOnOpenTask: checked })
                }
              />
            }
          />
        </div>
      </div>
    </div>
  )
}

function SettingsUpdatesPane({
  info,
  isUpdating,
  onDownload,
  onInstall
}: {
  info: UpdateInfo
  isUpdating: boolean
  onDownload: () => void
  onInstall: () => void
}): ReactElement {
  const isBusy = info.status === 'checking' || info.status === 'downloading' || info.status === 'installing' || isUpdating
  const canDownload = info.status === 'available'
  const canInstall = info.status === 'downloaded'
  const buttonLabel = canInstall
    ? info.mode === 'dev'
      ? 'Show notes'
      : 'Restart'
    : canDownload
      ? info.mode === 'manual'
        ? 'Open release'
        : 'Download update'
      : info.status === 'installing'
        ? info.mode === 'dev'
          ? 'Finishing'
          : 'Restarting'
        : info.status === 'downloading'
          ? 'Downloading'
          : 'Up to date'

  return (
    <div className="settings-pane-body">
      <header className="settings-pane-intro">
        <h3>Updates</h3>
        <p>Install new versions from GitHub Releases.</p>
      </header>

      <div className="settings-block">
        <h4 className="settings-block-label">Version</h4>
        <div className="settings-list">
          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-title">
                {info.currentVersion && info.currentVersion !== '0.0.0'
                  ? `Installed v${info.currentVersion}`
                  : 'VibeBoard'}
              </span>
              <span className="settings-row-desc">
                {info.message ||
                  (info.latestVersion
                    ? `Latest is v${info.latestVersion}`
                    : info.currentVersion
                      ? `You're on v${info.currentVersion}`
                      : 'Checking for updates…')}
              </span>
            </div>
          </div>
          {(info.status === 'downloading' || info.status === 'installing') && (
            <div className="settings-progress-row">
              <div className="update-progress" aria-label={`Update ${info.progress ?? 0}%`}>
                <span style={{ width: `${info.progress ?? 0}%` }} />
              </div>
            </div>
          )}
          {(canDownload || canInstall || info.releaseUrl) && (
            <div className="settings-actions-row">
              {(canDownload || canInstall) && (
                <button
                  className="primary-action"
                  type="button"
                  onClick={canInstall ? onInstall : onDownload}
                  disabled={isBusy}
                >
                  {canInstall ? (
                    <Check size={15} strokeWidth={1.75} />
                  ) : info.mode === 'manual' ? (
                    <ExternalLink size={15} strokeWidth={1.75} />
                  ) : (
                    <Download size={15} strokeWidth={1.75} />
                  )}
                  <span>{buttonLabel}</span>
                </button>
              )}
              {info.releaseUrl && (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    if (info.releaseUrl) void window.vibeboard.openExternalUrl(info.releaseUrl)
                  }}
                >
                  <ExternalLink size={15} strokeWidth={1.75} />
                  <span>GitHub releases</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
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

function AgentCliPicker({
  snapshot,
  onSelect
}: {
  snapshot: AgentCliSnapshot
  onSelect: (id: AgentCliId) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const active = snapshot.active

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className={`agent-cli-dropdown${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="agent-cli-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${active.label}: ${active.detail}`}
        onClick={() => setOpen((value) => !value)}
      >
        <AgentCliIcon id={active.id} size={18} className="agent-cli-trigger-icon" />
        <span className="agent-cli-trigger-copy">
          <span className="agent-cli-trigger-name">{active.label}</span>
          <span className={`agent-cli-trigger-status${active.available ? ' ready' : ''}`}>
            {agentCliStatusLabel(active)}
          </span>
        </span>
        <ChevronDown size={14} strokeWidth={ICON_STROKE} className="agent-cli-trigger-chevron" />
      </button>

      {open && (
        <div className="agent-cli-menu" role="listbox" aria-label="Choose agent CLI">
          {snapshot.providers.map((provider) => {
            const selected = snapshot.activeCli === provider.id
            return (
              <button
                key={provider.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`agent-cli-menu-item${selected ? ' is-selected' : ''}${provider.available ? '' : ' is-unavailable'}`}
                onClick={() => {
                  onSelect(provider.id)
                  setOpen(false)
                }}
              >
                <AgentCliIcon id={provider.id} size={18} className="agent-cli-menu-icon" />
                <span className="agent-cli-menu-copy">
                  <span className="agent-cli-menu-name">{provider.label}</span>
                  <span className={`agent-cli-menu-status${provider.available ? ' ready' : ''}`}>
                    {agentCliStatusLabel(provider)}
                  </span>
                </span>
                {selected ? <Check size={14} strokeWidth={ICON_STROKE} className="agent-cli-menu-check" /> : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function agentCliStatusLabel(provider: AgentCliProviderStatus): string {
  // Ready means signed in and usable, not merely installed.
  if (provider.detail === 'Checking…') return 'Checking…'
  if (provider.available) return 'Signed in'
  if (provider.installed) return 'Login needed'
  return 'Not installed'
}

function AgentCliSetupCard({
  provider,
  feedback,
  isWorking,
  onSetup
}: {
  provider: AgentCliProviderStatus
  feedback: string
  isWorking: boolean
  onSetup: () => void
}): ReactElement {
  const needsInstall = !provider.installed
  return (
    <div className="cursor-card missing agent-cli-setup-card">
      <div className="cursor-status-row">
        <div>
          <AgentCliIcon id={provider.id} size={15} />
          <span>{needsInstall ? 'Install required' : 'Sign in required'}</span>
        </div>
        <span className="connection-pill missing">{needsInstall ? 'Missing' : 'Login'}</span>
      </div>
      <div className="cursor-actions">
        <button className="primary-action setup-button" type="button" onClick={onSetup} disabled={isWorking}>
          <ExternalLink size={15} />
          <span>
            {isWorking ? 'Working…' : needsInstall ? 'Install & sign in' : 'Sign in'}
          </span>
        </button>
      </div>
      {feedback ? <div className="cursor-feedback">{feedback}</div> : null}
    </div>
  )
}

function UpdateBanner({
  info,
  onDownload,
  onInstall,
  onOpenSettings
}: {
  info: UpdateInfo
  onDownload: () => void
  onInstall: () => void
  onOpenSettings: () => void
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
      <div className="update-banner-actions">
        <button className="secondary-action" type="button" onClick={onOpenSettings}>
          <Settings size={15} />
          <span>Settings</span>
        </button>
        {(canDownload || canInstall || isBusy) && (
          <button className="primary-action" type="button" onClick={buttonAction} disabled={isBusy}>
            {canInstall ? <Check size={15} /> : info.mode === 'manual' ? <ExternalLink size={15} /> : <Download size={15} />}
            <span>{buttonLabel}</span>
          </button>
        )}
      </div>
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
  const showWindowControls = platformClass !== 'platform-mac'
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [menuState, setMenuState] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [closedMenuOpen, setClosedMenuOpen] = useState(false)
  const [closedSearch, setClosedSearch] = useState('')
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dragOverlayWidth, setDragOverlayWidth] = useState<number | null>(null)
  const menuTab = tabs.find((tab) => tab.id === menuState?.tabId) ?? null
  const draggedTab = draggedTabId ? tabs.find((tab) => tab.id === draggedTabId) ?? null : null
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs])
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
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

  useEffect(() => {
    if (!showWindowControls) return
    void window.vibeboard.windowIsMaximized().then(setIsWindowMaximized)
    return window.vibeboard.onWindowMaximizedChanged(setIsWindowMaximized)
  }, [showWindowControls])

  const handleTabDragStart = (event: DragStartEvent): void => {
    const tabId = String(event.active.id)
    setDraggedTabId(tabId)
    setMenuState(null)
    setClosedMenuOpen(false)
    const rect = event.active.rect.current.initial
    setDragOverlayWidth(rect?.width ?? null)
  }

  const handleTabDragCancel = (): void => {
    setDraggedTabId(null)
    setDragOverlayWidth(null)
  }

  const handleTabDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setDraggedTabId(null)
    setDragOverlayWidth(null)
    if (!over || active.id === over.id) return

    const oldIndex = tabs.findIndex((tab) => tab.id === active.id)
    const newIndex = tabs.findIndex((tab) => tab.id === over.id)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return

    onReorderTabs(arrayMove(tabs, oldIndex, newIndex).map((tab) => tab.id))
  }

  return (
    <div
      className="tabs-bar"
      onDoubleClick={(event) => {
        if (!showWindowControls) return
        const target = event.target as HTMLElement
        if (target.closest('.tabs, .tabs-actions, .window-controls, .tab-menu, .closed-tabs-wrap')) return
        void window.vibeboard.windowMaximize().then(setIsWindowMaximized)
      }}
    >
      <DndContext
        sensors={tabSensors}
        onDragStart={handleTabDragStart}
        onDragEnd={handleTabDragEnd}
        onDragCancel={handleTabDragCancel}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          <div className={draggedTabId ? 'tabs dragging-tab' : 'tabs'} data-tour="tabs">
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                status={tabStatuses.get(tab.id) ?? 'idle'}
                isActive={tab.id === activeTabId}
                onSelect={() => onSelectTab(tab.id)}
                onClose={() => onCloseTab(tab.id)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenuState({ tabId: tab.id, x: event.clientX, y: event.clientY })
                }}
              />
            ))}
          </div>
        </SortableContext>
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {draggedTab ? (
              <TabPillOverlay
                tab={draggedTab}
                status={tabStatuses.get(draggedTab.id) ?? 'idle'}
                isActive={draggedTab.id === activeTabId}
                width={dragOverlayWidth}
              />
            ) : null}
          </DragOverlay>,
          document.body
        )}
      </DndContext>
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
                  <span>Recent</span>
                  <small>{closedTabs.length}</small>
                </div>
                <label className="closed-tabs-search">
                  <Search size={14} strokeWidth={ICON_STROKE} />
                  <input
                    value={closedSearch}
                    onChange={(event) => setClosedSearch(event.target.value)}
                    placeholder="Search projects"
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
                            <RotateCcw size={13} strokeWidth={ICON_STROKE} />
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
                          <Trash2 size={14} strokeWidth={ICON_STROKE} />
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
      {showWindowControls && (
        <div className="window-controls">
          <button
            className="window-control"
            type="button"
            title="Minimize"
            aria-label="Minimize"
            onClick={() => void window.vibeboard.windowMinimize()}
          >
            <Minus size={14} strokeWidth={ICON_STROKE} />
          </button>
          <button
            className="window-control"
            type="button"
            title={isWindowMaximized ? 'Restore' : 'Maximize'}
            aria-label={isWindowMaximized ? 'Restore' : 'Maximize'}
            onClick={() => void window.vibeboard.windowMaximize().then(setIsWindowMaximized)}
          >
            {isWindowMaximized ? (
              <Copy size={12} strokeWidth={ICON_STROKE} />
            ) : (
              <Square size={12} strokeWidth={ICON_STROKE} />
            )}
          </button>
          <button
            className="window-control window-control-close"
            type="button"
            title="Close"
            aria-label="Close"
            onClick={() => void window.vibeboard.windowClose()}
          >
            <X size={14} strokeWidth={ICON_STROKE} />
          </button>
        </div>
      )}
    </div>
  )
}


function SortableTab({
  tab,
  status,
  isActive,
  onSelect,
  onClose,
  onContextMenu
}: {
  tab: BoardTab
  status: Task['status'] | 'idle'
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  onContextMenu: (event: ReactMouseEvent) => void
}): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...tabColorVars(tab.color, isActive)
      }}
      className={`tab status-${status} ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${
        tab.color ? 'has-color' : ''
      }`}
      title={tab.name}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      <button
        className="tab-select"
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
        }}
      >
        {tab.isPinned ? <Pin size={12} strokeWidth={ICON_STROKE} /> : null}
        <span className="tab-status-dot" aria-hidden="true" />
        <span>{tab.name}</span>
      </button>
      <button
        className="tab-close"
        type="button"
        title="Close project"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
      >
        ×
      </button>
    </div>
  )
}

function TabPillOverlay({
  tab,
  status,
  isActive,
  width
}: {
  tab: BoardTab
  status: Task['status'] | 'idle'
  isActive: boolean
  width: number | null
}): ReactElement {
  return (
    <div
      className={`tab drag-overlay status-${status} ${isActive ? 'active' : ''} ${tab.color ? 'has-color' : ''}`}
      style={{
        width: width ?? undefined,
        ...tabColorVars(tab.color, true)
      }}
      title={tab.name}
    >
      <div className="tab-select">
        {tab.isPinned ? <Pin size={12} strokeWidth={ICON_STROKE} /> : null}
        <span className="tab-status-dot" aria-hidden="true" />
        <span>{tab.name}</span>
      </div>
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

let modalEscapeSeq = 0
const modalEscapeStack: number[] = []

function useModalEscape(onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const id = ++modalEscapeSeq
    modalEscapeStack.push(id)

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape') return
      // Nested modals (e.g. image preview over task detail) all listen on window;
      // only the topmost mounted modal should close.
      if (modalEscapeStack[modalEscapeStack.length - 1] !== id) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCloseRef.current()
    }

    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      const index = modalEscapeStack.indexOf(id)
      if (index >= 0) modalEscapeStack.splice(index, 1)
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [])
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
    <div className={`sidebar-metric tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function LaneColumn({
  lane,
  tasks,
  activeDragTaskId,
  dropPreviewPosition,
  onOpenTask,
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
        <div className="lane-header-title">
          <span className="lane-header-icon" aria-hidden="true">
            {getLaneHeaderIcon(lane.name)}
          </span>
          <EditableTitle
            className="lane-title-input"
            value={lane.name}
            onCommit={(name) => onRenameLane(lane.id, name)}
          />
        </div>
        <div className="lane-header-actions">
          <span>{tasks.length}</span>
          {canDelete && (
            <button
              className="lane-delete-button"
              type="button"
              title="Delete lane"
              onClick={() => onDeleteLane(lane.id)}
            >
              <Trash2 size={ICON_SM} strokeWidth={ICON_STROKE} />
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
    </section>
  )
}

function getLaneHeaderIcon(name: string): ReactElement {
  const key = name.trim().toLowerCase()
  if (/(active|running|doing|progress|todo|backlog|inbox)/.test(key)) {
    return <ListTodo size={ICON_SM} strokeWidth={ICON_STROKE} />
  }
  if (/(review|waiting|qa|verify|approval)/.test(key)) {
    return <Eye size={ICON_SM} strokeWidth={ICON_STROKE} />
  }
  if (/(done|complete|finished|shipped)/.test(key)) {
    return <Check size={ICON_SM} strokeWidth={ICON_STROKE} />
  }
  if (/(blocked|hold|paused)/.test(key)) {
    return <Circle size={ICON_SM} strokeWidth={ICON_STROKE} />
  }
  return <Columns3 size={ICON_SM} strokeWidth={ICON_STROKE} />
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

function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isRedundantWithTitle(value: string | null | undefined, title: string): boolean {
  if (!value) return true
  const left = normalizeComparableText(value)
  const right = normalizeComparableText(title)
  if (!left || !right) return true
  return left === right || left.includes(right) || right.includes(left)
}

function getTaskEyebrow(task: Task): string | null {
  const queued = task.queuedMessages?.length ?? 0
  if (queued > 0) return `${queued} queued`
  if (task.model && !isRedundantWithTitle(task.model, task.title)) return task.model
  return null
}

function getTaskFooterStatus(task: Task): {
  tone: 'working' | 'attention' | 'done' | 'idle'
  icon: ReactElement
  label: string
} {
  if (task.status === 'processing') {
    return {
      tone: 'working',
      icon: <Loader2 size={13} strokeWidth={ICON_STROKE} className="task-card-spinner" />,
      label: 'Working...'
    }
  }
  if (task.status === 'attention') {
    return {
      tone: 'attention',
      icon: <AlertTriangle size={13} strokeWidth={ICON_STROKE} />,
      label: 'Needs you'
    }
  }
  if (task.status === 'done_unread' || task.status === 'done_read') {
    return {
      tone: 'done',
      icon: <Check size={13} strokeWidth={ICON_STROKE} />,
      label: 'Done'
    }
  }
  return {
    tone: 'idle',
    icon: <Clock size={13} strokeWidth={ICON_STROKE} />,
    label: 'Ready'
  }
}

function TaskCardContent({ task }: { task: Task }): ReactElement {
  const footer = getTaskFooterStatus(task)
  const eyebrow = getTaskEyebrow(task)
  const summary = task.summary.trim()
  const showSummary = Boolean(summary) && !isRedundantWithTitle(summary, task.title)
  const timeLabel = formatRelativeTime(task.updatedAt)
  // Branch is provisioned when a run starts; only show git chrome after a real push.
  const showPushedIcon = Boolean(task.pushedToMain)

  return (
    <div className="task-card-content">
      {eyebrow ? (
        <div className="task-card-topline">
          <span className="task-card-eyebrow">{eyebrow}</span>
        </div>
      ) : null}
      <h3 className="task-card-title">{task.title}</h3>
      {showSummary ? <p className="task-card-summary">{summary}</p> : null}
      <div className="task-card-footer">
        <span className={`task-card-footer-status tone-${footer.tone}`}>
          {footer.icon}
          <span>{footer.label}</span>
        </span>
        {timeLabel ? (
          <>
            <span className="task-card-footer-dot" aria-hidden="true">
              ·
            </span>
            <span className="task-card-footer-time">{timeLabel}</span>
          </>
        ) : null}
        {showPushedIcon ? (
          <span className="task-card-footer-meta">
            <span title="Pushed to main">
              <GitCommitHorizontal size={13} strokeWidth={ICON_STROKE} />
            </span>
          </span>
        ) : null}
      </div>
    </div>
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
      className={`task-card status-${task.status} ${isDragging ? 'dragging' : ''} ${isMenuOpen ? 'menu-open' : ''}${
        task.id === marketingDemoFeatureTaskId ? ' is-demo-target' : ''
      }`}
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="task-open">
        <TaskCardContent task={task} />
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
            <MoreHorizontal size={ICON_SM} strokeWidth={ICON_STROKE} />
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
                <Pencil size={ICON_SM} strokeWidth={ICON_STROKE} />
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
                  <Check size={ICON_SM} strokeWidth={ICON_STROKE} />
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
                <Trash2 size={ICON_SM} strokeWidth={ICON_STROKE} />
                <span>Delete task</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </article>
  )
}

function TaskCardPreview({
  task,
  width
}: {
  task: Task
  width: number | null
}): ReactElement {
  return (
    <article
      className={`task-card drag-preview status-${task.status}`}
      style={width ? { width } : undefined}
    >
      <div className="task-open">
        <TaskCardContent task={task} />
      </div>
    </article>
  )
}

function TaskDropPreview(): ReactElement {
  return <div className="task-drop-preview" aria-hidden="true" />
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
          if (!title.trim()) return
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
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="task-form-body">
          <textarea
            ref={titleRef}
            className="task-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title"
            autoFocus
            rows={1}
            aria-label="Task title"
          />
        </div>

        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-action" type="submit" disabled={!title.trim()}>
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
          if (!title.trim()) return
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
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="task-form-body">
          <textarea
            ref={titleRef}
            className="task-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title"
            rows={1}
            aria-label="Task title"
          />
        </div>

        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-action" type="submit" disabled={!title.trim()}>
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
  activeAgentLabel = 'Cursor',
  activeAgentCli = 'cursor',
  forcedDraft,
  isExiting = false,
  onLoadOlderConversations,
  onSendMessage,
  onRetryTask,
  onRetryPrompt,
  onStopTask,
  onUpdateModel,
  onDeleteTask,
  onClose,
  onExited
}: {
  task: Task
  project: Project | null
  conversations: ConversationEntry[]
  changes: CodeChange[]
  hasOlderConversations: boolean
  isLoadingOlderConversations: boolean
  canUseCursor: boolean
  activeAgentLabel?: string
  activeAgentCli?: AgentCliId
  forcedDraft?: string
  isExiting?: boolean
  onLoadOlderConversations: () => void
  onSendMessage: (taskId: string, content: string, attachments?: TaskMessageAttachmentInput[]) => void
  onRetryTask: (taskId: string) => void
  onRetryPrompt: (taskId: string) => void
  onStopTask: (taskId: string) => void
  onUpdateModel: (taskId: string, model: string | null) => void
  onDeleteTask: (taskId: string) => void
  onClose: () => void
  onExited?: () => void
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
  const exitTimerRef = useRef<number | null>(null)

  const requestClose = (): void => {
    if (isExiting) return
    onClose()
  }

  useModalEscape(requestClose)

  useEffect(() => {
    if (!isExiting) return
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)
    const prefersReduced =
      document.documentElement.dataset.reduceMotion === 'reduce' ||
      (document.documentElement.dataset.reduceMotion !== 'no-preference' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null
      onExited?.()
    }, prefersReduced ? 40 : 340)
    return () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)
    }
  }, [isExiting, onExited])

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
    <div
      className={`modal-backdrop task-detail-backdrop${isExiting ? ' is-exiting' : ''}`}
      onMouseDown={closeOnBackdropMouseDown(requestClose)}
    >
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
                  title="Ask agent to commit and push (no Co-authored-by; authorship stays yours)"
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
            <button
              className={`code-changes-switch${showCodeChanges ? ' on' : ''}`}
              type="button"
              role="switch"
              aria-checked={showCodeChanges}
              title={showCodeChanges ? 'Hide code changes and enlarge chat' : 'Show code changes'}
              onClick={() => setCodeChangesVisible(!showCodeChanges)}
            >
              <Code2 size={14} strokeWidth={1.75} />
              <span>Changes</span>
              <span className="code-changes-track" aria-hidden="true">
                <span className="code-changes-thumb" />
              </span>
            </button>
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
            <button className="icon-button" type="button" onClick={requestClose} title="Close">
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
              activeAgentCli={activeAgentCli}
              forcedDraft={forcedDraft}
              disabledLabel={
                !canUseCursor
                  ? `${activeAgentLabel} not connected`
                  : !project
                    ? 'No project selected'
                    : 'Unavailable'
              }
              onLoadOlderConversations={onLoadOlderConversations}
              onSendMessage={onSendMessage}
              onRetryPrompt={onRetryPrompt}
              onUpdateModel={onUpdateModel}
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
                    <div className="thread-empty-state changes-empty-state">
                      <span className="thread-empty-icon" aria-hidden="true">
                        <Code2 size={28} strokeWidth={ICON_STROKE} />
                      </span>
                      <strong>No changes yet</strong>
                      <p>Diffs show up here when the agent edits files.</p>
                    </div>
                  ) : (
                    changes.map((change) => (
                      <DiffViewer key={change.id} change={change} taskId={task.id} />
                    ))
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
  activeAgentCli = 'cursor',
  forcedDraft,
  disabledLabel,
  onLoadOlderConversations,
  onSendMessage,
  onRetryPrompt,
  onUpdateModel
}: {
  conversations: ConversationEntry[]
  task: Task
  queuedMessages: QueuedTaskMessage[]
  hasOlderConversations: boolean
  isLoadingOlderConversations: boolean
  canSend: boolean
  canRetryPrompt: boolean
  activeAgentCli?: AgentCliId
  forcedDraft?: string
  disabledLabel: string
  onLoadOlderConversations: () => void
  onSendMessage: (taskId: string, content: string, attachments?: TaskMessageAttachmentInput[]) => void
  onRetryPrompt: (taskId: string) => void
  onUpdateModel: (taskId: string, model: string | null) => void
}): ReactElement {
  const [draft, setDraft] = useState(() =>
    forcedDraft !== undefined ? forcedDraft : readTaskComposerDraft(task.id)
  )
  const [pendingAttachments, setPendingAttachments] = useState<PendingComposerAttachment[]>([])
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null)
  const [editingQueuedDraft, setEditingQueuedDraft] = useState('')
  const streamRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const olderScrollSnapshotRef = useRef<{ height: number; top: number } | null>(null)
  const isDraftForced = forcedDraft !== undefined
  const lastAssistantIndex = conversations.reduce(
    (lastIndex, entry, index) => (entry.role === 'assistant' ? index : lastIndex),
    -1
  )
  const isRunning = task.status === 'processing'
  const lastUserMessageAt =
    [...conversations].reverse().find((entry) => entry.role === 'user')?.createdAt ?? null
  // Prefer the active run start so prior-run system/thinking status stays out of this thread.
  const systemSince = task.runStartedAt ?? lastUserMessageAt
  const threadEntries = compactConversationEntries(
    conversations
      .filter((entry, index) => {
        if (isNoisyConversationEntry(entry)) return false
        if (entry.role !== 'system') return true
        // Keep CLI debug / empty-reply diagnostics even after Done.
        if (isAgentCliDiagnosticMessage(entry.content)) return true
        if (isUselessSystemStatusFragment(entry.content)) return false
        if (systemSince && entry.createdAt < systemSince) return false
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
        ? `Queue follow-up (${queuedMessages.length})`
        : 'Queue a follow-up…'
      : 'Message…'

  useEffect(() => {
    setDraft(isDraftForced ? (forcedDraft ?? '') : readTaskComposerDraft(task.id))
    setPendingAttachments([])
  }, [task.id])

  useEffect(() => {
    if (!isDraftForced) return
    setDraft(forcedDraft ?? '')
  }, [forcedDraft, isDraftForced])

  useEffect(() => {
    if (isDraftForced) return
    writeTaskComposerDraft(task.id, draft)
  }, [draft, isDraftForced, task.id])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    if (isDraftForced) {
      // Clear inline height so the fixed demo class can own layout without jumps.
      composer.style.height = ''
      return
    }
    composer.style.height = '36px'
    composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 36), 120)}px`
  }, [draft, isDraftForced])

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
        {isLoadingOlderConversations && (
          <div className="thread-empty-state is-loading">Loading earlier messages</div>
        )}
        {threadEntries.length === 0 ? (
          <div className="thread-empty-state">
            <span className="thread-empty-icon" aria-hidden="true">
              <MessageSquare size={28} strokeWidth={ICON_STROKE} />
            </span>
            <strong>Chat is empty</strong>
            <p>Send a message to start the agent on this task.</p>
          </div>
        ) : (
          threadEntries.map((entry) => (
            <div
              key={entry.id}
              className={`agent-step role-${entry.role}${
                entry.role === 'system' && isAgentToolProgressLine(entry.content) ? ' is-tool-progress' : ''
              }`}
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
      </div>

      {(canSend || canRetryPrompt) && (
        <div className="prompt-template-row" aria-label="Prompt templates">
          <TaskModelPicker
            taskId={task.id}
            model={task.model ?? null}
            disabled={!canSend}
            activeAgentCli={activeAgentCli}
            onChange={onUpdateModel}
          />
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

      <div className="composer-stack">
      {queuedMessages.length > 0 ? (
        <div className="queued-tray" aria-label="Queued messages">
          <div className="queued-tray-header">
            <span className="queued-tray-count">
              {queuedMessages.length} Queued
            </span>
            <span className="queued-tray-hint">sends after current run</span>
          </div>
          <div className="queued-tray-list">
            {queuedMessages.map((queued) => (
              <div key={queued.id} className="queued-tray-item">
                {editingQueuedId === queued.id ? (
                  <form
                    className="queued-tray-edit"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const trimmed = editingQueuedDraft.trim()
                      if (!trimmed) return
                      void window.vibeboard
                        .updateQueuedTaskMessage({
                          taskId: task.id,
                          messageId: queued.id,
                          content: trimmed
                        })
                        .then(() => {
                          setEditingQueuedId(null)
                          setEditingQueuedDraft('')
                        })
                    }}
                  >
                    <textarea
                      className="queued-tray-edit-input"
                      value={editingQueuedDraft}
                      rows={2}
                      autoFocus
                      onChange={(event) => setEditingQueuedDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setEditingQueuedId(null)
                          setEditingQueuedDraft('')
                        }
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          event.currentTarget.form?.requestSubmit()
                        }
                      }}
                    />
                    <div className="queued-tray-edit-actions">
                      <button type="submit" className="template-chip">
                        Save
                      </button>
                      <button
                        type="button"
                        className="template-chip"
                        onClick={() => {
                          setEditingQueuedId(null)
                          setEditingQueuedDraft('')
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="queued-tray-preview">
                      {(queued.attachments?.length ?? 0) > 0 ? (
                        <MessageAttachments attachments={queued.attachments} />
                      ) : null}
                      <span className="queued-tray-text">
                        {queued.content.trim() || 'Attachment'}
                      </span>
                    </div>
                    <div className="queued-tray-actions">
                      <button
                        type="button"
                        className="queued-tray-action"
                        title="Edit queued message"
                        aria-label="Edit queued message"
                        onClick={() => {
                          setEditingQueuedId(queued.id)
                          setEditingQueuedDraft(queued.content)
                        }}
                      >
                        <Pencil size={14} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        className="queued-tray-action is-danger"
                        title="Remove queued message"
                        aria-label="Remove queued message"
                        onClick={() => {
                          void window.vibeboard.removeQueuedTaskMessage({
                            taskId: task.id,
                            messageId: queued.id
                          })
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
          onChange={(event) => {
            if (isDraftForced) return
            setDraft(event.target.value)
          }}
          disabled={!canSend}
          readOnly={isDraftForced}
          rows={1}
          placeholder={composerPlaceholder}
          className={isDraftForced ? 'is-demo-typing' : undefined}
          onPaste={(event) => {
            if (isDraftForced) {
              event.preventDefault()
              return
            }
            const files = collectClipboardImageFiles(event.clipboardData)
            if (files.length === 0) return
            event.preventDefault()
            void addImageFiles(files)
          }}
          onKeyDown={(event) => {
            if (isDraftForced) {
              event.preventDefault()
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button
          className={`icon-button${isDraftForced && canSubmit ? ' is-demo-send-ready' : ''}`}
          type="button"
          onClick={send}
          disabled={!canSubmit}
          title={isRunning ? 'Queue message' : 'Send'}
        >
          <Send size={16} />
        </button>
      </div>
      </div>
    </div>
  )
}

type ModelProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'cursor'
  | 'xai'
  | 'meta'
  | 'deepseek'
  | 'other'

interface ModelProviderGroup {
  id: ModelProviderId
  label: string
  models: AgentModel[]
}

const MODEL_PROVIDER_ORDER: ModelProviderId[] = [
  'openai',
  'anthropic',
  'google',
  'cursor',
  'xai',
  'meta',
  'deepseek',
  'other'
]

const MODEL_PROVIDER_LABELS: Record<ModelProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  cursor: 'Cursor',
  xai: 'xAI',
  meta: 'Meta',
  deepseek: 'DeepSeek',
  other: 'Other'
}

const FEATURED_MODELS_PER_PROVIDER = 7

function detectModelProvider(model: AgentModel): ModelProviderId {
  const haystack = `${model.id} ${model.label}`.toLowerCase()
  if (
    /\b(gpt|o[1-9]|chatgpt|openai|codex)\b/.test(haystack) ||
    haystack.startsWith('gpt-') ||
    haystack.startsWith('codex-') ||
    /^o[1-9]/.test(haystack)
  ) {
    return 'openai'
  }
  if (/\b(claude|anthropic)\b/.test(haystack) || haystack.startsWith('claude-')) return 'anthropic'
  if (/\b(gemini|google|gemma)\b/.test(haystack) || haystack.startsWith('gemini-')) return 'google'
  if (/\b(cursor|composer|bugbot)\b/.test(haystack) || haystack.startsWith('cursor-')) return 'cursor'
  if (/\b(grok|xai)\b/.test(haystack) || haystack.startsWith('grok-')) return 'xai'
  if (/\b(llama|meta)\b/.test(haystack) || haystack.startsWith('llama')) return 'meta'
  if (/\bdeepseek\b/.test(haystack) || haystack.startsWith('deepseek')) return 'deepseek'
  return 'other'
}

function scoreFeaturedModel(model: AgentModel): number {
  const id = model.id.toLowerCase()
  const label = model.label.toLowerCase()
  let score = 0
  if (model.isDefault) score += 120
  if (model.isCurrent) score += 80
  if (/\b(gpt-5|gpt-4\.1|gpt-4o|o3|o4|claude-4|claude-sonnet-4|claude-opus-4|gemini-2\.5|composer)\b/.test(`${id} ${label}`)) {
    score += 60
  }
  if (/\b(sonnet|opus|pro|maxi|codex)\b/.test(label)) score += 20
  if (/\b(preview|experimental|nightly|beta|fast|mini|nano|haiku|flash-lite)\b/.test(`${id} ${label}`)) {
    score -= 40
  }
  if (/-thinking|-low|-high|-medium|\[|\]/.test(id)) score -= 25
  score -= Math.min(id.length, 40) * 0.35
  return score
}

function featuredModelsForProvider(models: AgentModel[], selectedId: string): AgentModel[] {
  const ranked = [...models].sort((a, b) => scoreFeaturedModel(b) - scoreFeaturedModel(a))
  const featured = ranked.slice(0, FEATURED_MODELS_PER_PROVIDER)
  if (selectedId && !featured.some((item) => item.id === selectedId)) {
    const selected = models.find((item) => item.id === selectedId)
    if (selected) featured.unshift(selected)
  }
  return featured
}

function groupModelsByProvider(models: AgentModel[]): ModelProviderGroup[] {
  const buckets = new Map<ModelProviderId, AgentModel[]>()
  for (const model of models) {
    if (model.id.toLowerCase() === 'auto') continue
    const provider = detectModelProvider(model)
    const list = buckets.get(provider) ?? []
    list.push(model)
    buckets.set(provider, list)
  }

  return MODEL_PROVIDER_ORDER.flatMap((id) => {
    const list = buckets.get(id)
    if (!list || list.length === 0) return []
    return [{ id, label: MODEL_PROVIDER_LABELS[id], models: list }]
  })
}

function TaskModelPicker({
  taskId,
  model,
  disabled,
  activeAgentCli = 'cursor',
  onChange
}: {
  taskId: string
  model: string | null
  disabled: boolean
  activeAgentCli?: AgentCliId
  onChange: (taskId: string, model: string | null) => void
}): ReactElement {
  const [models, setModels] = useState<AgentModel[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setLoading] = useState(false)
  const [isOpen, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hoveredProvider, setHoveredProvider] = useState<ModelProviderId | null>(null)
  const [flyoutStyle, setFlyoutStyle] = useState<CSSProperties | null>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const flyoutCloseTimer = useRef<number | null>(null)

  const clearFlyoutCloseTimer = (): void => {
    if (flyoutCloseTimer.current == null) return
    window.clearTimeout(flyoutCloseTimer.current)
    flyoutCloseTimer.current = null
  }

  const closeProviderFlyout = (): void => {
    clearFlyoutCloseTimer()
    setHoveredProvider(null)
    setFlyoutStyle(null)
  }

  const scheduleCloseProviderFlyout = (): void => {
    clearFlyoutCloseTimer()
    flyoutCloseTimer.current = window.setTimeout(() => {
      flyoutCloseTimer.current = null
      setHoveredProvider(null)
      setFlyoutStyle(null)
    }, 140)
  }

  useEffect(() => {
    let cancelled = false

    const loadModels = async (): Promise<void> => {
      setLoading(true)
      setLoadError(null)
      try {
        if (typeof window.vibeboard.listAgentModels !== 'function') {
          throw new Error('Restart VibeBoard to load models')
        }
        const nextModels = await window.vibeboard.listAgentModels()
        if (!cancelled) setModels(nextModels)
      } catch (error) {
        if (cancelled) return
        setModels([])
        setLoadError(error instanceof Error ? error.message : 'Could not load models')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [taskId, activeAgentCli])

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setMenuStyle(null)
      closeProviderFlyout()
      return
    }

    const placeMenu = (): void => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const width = Math.min(300, window.innerWidth - 16)
      const estimatedHeight = 340
      const gap = 6
      const openAbove = rect.top > estimatedHeight + 24
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
      const top = openAbove
        ? Math.max(8, rect.top - gap - estimatedHeight)
        : Math.min(window.innerHeight - 8 - estimatedHeight, rect.bottom + gap)
      setMenuStyle({
        position: 'fixed',
        top: openAbove ? undefined : top,
        bottom: openAbove ? window.innerHeight - rect.top + gap : undefined,
        left,
        width,
        maxHeight: Math.min(360, window.innerHeight - 16)
      })
    }

    placeMenu()
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 20)
    const closeOnOutside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.task-model-flyout')) return
      if (target instanceof Element && target.closest('.task-model-options')) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', closeOnOutside, true)
    window.addEventListener('keydown', closeOnEscape, true)
    window.addEventListener('resize', placeMenu)
    return () => {
      window.clearTimeout(focusTimer)
      clearFlyoutCloseTimer()
      window.removeEventListener('pointerdown', closeOnOutside, true)
      window.removeEventListener('keydown', closeOnEscape, true)
      window.removeEventListener('resize', placeMenu)
    }
  }, [isOpen])

  const selectedValue = model ?? ''
  const isAuto = !selectedValue
  const selectedModel =
    models.find((item) => item.id === selectedValue) ??
    (selectedValue
      ? { id: selectedValue, label: selectedValue, isDefault: false, isCurrent: false }
      : null)
  const selectedLabel = selectedModel?.label ?? 'Auto'
  const catalog = useMemo(() => {
    const next = models.filter((item) => item.id.toLowerCase() !== 'auto')
    if (selectedValue && !next.some((item) => item.id === selectedValue)) {
      return [{ id: selectedValue, label: selectedValue }, ...next]
    }
    return next
  }, [models, selectedValue])

  const normalizedQuery = query.trim().toLowerCase()
  const isSearching = normalizedQuery.length > 0
  const searchResults = isSearching
    ? catalog.filter(
        (item) =>
          item.id.toLowerCase().includes(normalizedQuery) ||
          item.label.toLowerCase().includes(normalizedQuery)
      )
    : []
  const providerGroups = useMemo(() => groupModelsByProvider(catalog), [catalog])

  const agentLabel =
    activeAgentCli === 'claude' ? 'Claude' : activeAgentCli === 'codex' ? 'Codex' : 'Cursor'
  const title = loadError
    ? loadError
    : isLoading
      ? `Loading ${agentLabel} models…`
      : `Model for this task (${agentLabel})`

  const pickModel = (next: string | null): void => {
    onChange(taskId, next)
    setOpen(false)
  }

  const openProviderFlyout = (providerId: ModelProviderId, row: HTMLElement): void => {
    clearFlyoutCloseTimer()
    const rect = row.getBoundingClientRect()
    const flyoutWidth = 248
    const gap = 6
    const openLeft = rect.right + gap + flyoutWidth > window.innerWidth - 8
    const left = openLeft ? Math.max(8, rect.left - gap - flyoutWidth) : rect.right + gap
    const maxHeight = Math.min(280, window.innerHeight - 16)
    let top = rect.top
    if (top + maxHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - 8 - maxHeight)
    }
    setHoveredProvider(providerId)
    setFlyoutStyle({
      position: 'fixed',
      top,
      left,
      width: flyoutWidth,
      maxHeight
    })
  }

  return (
    <div className="task-model-menu" ref={menuRef}>
      <button
        ref={triggerRef}
        className={isOpen ? 'template-chip task-model-trigger open' : 'template-chip task-model-trigger'}
        type="button"
        disabled={disabled || isLoading}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="task-model-trigger-copy">
          <span className="task-model-trigger-label">Model</span>
          <span className="task-model-trigger-value">{isLoading ? '…' : selectedLabel}</span>
        </span>
        <ChevronDown size={13} />
      </button>

      {isOpen &&
        menuStyle &&
        createPortal(
          <div
            className="task-model-options task-model-options-portal"
            role="listbox"
            aria-label={`${agentLabel} models`}
            style={menuStyle}
          >
          <div className="task-model-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search models"
              aria-label="Search models"
              onChange={(event) => {
                setQuery(event.target.value)
                closeProviderFlyout()
              }}
            />
          </div>

          {loadError && <div className="task-model-empty">{loadError}</div>}

          {!loadError && (
            <>
              <button
                className={isAuto ? 'task-model-auto selected' : 'task-model-auto'}
                type="button"
                role="option"
                aria-selected={isAuto}
                onClick={() => pickModel(null)}
              >
                <span className="task-model-auto-copy">
                  <strong>Auto</strong>
                  <small>Balanced quality and speed, recommended for most tasks</small>
                </span>
                <span
                  className={isAuto ? 'task-model-switch on' : 'task-model-switch'}
                  aria-hidden="true"
                >
                  <span className="task-model-switch-knob" />
                </span>
              </button>

              <div className="task-model-divider" />

              <div className="task-model-list">
                {isSearching ? (
                  searchResults.length === 0 ? (
                    <div className="task-model-empty">No models match “{query.trim()}”</div>
                  ) : (
                    searchResults.map((item) => {
                      const isSelected = item.id === selectedValue
                      return (
                        <button
                          key={item.id}
                          className={isSelected ? 'task-model-option selected' : 'task-model-option'}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => pickModel(item.id)}
                        >
                          <span className="task-model-check">{isSelected && <Check size={13} />}</span>
                          <span className="task-model-option-copy">
                            <strong>{item.label}</strong>
                            <small>{item.id}</small>
                          </span>
                        </button>
                      )
                    })
                  )
                ) : (
                  providerGroups.map((group) => {
                    const featured = featuredModelsForProvider(group.models, selectedValue)
                    const isHovered = hoveredProvider === group.id
                    const hasSelected =
                      Boolean(selectedValue) && group.models.some((item) => item.id === selectedValue)
                    return (
                      <div
                        key={group.id}
                        className={
                          isHovered || hasSelected
                            ? 'task-model-provider open'
                            : 'task-model-provider'
                        }
                        onMouseEnter={(event) => openProviderFlyout(group.id, event.currentTarget)}
                        onMouseLeave={scheduleCloseProviderFlyout}
                      >
                        <button
                          className="task-model-provider-trigger"
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={isHovered}
                          onClick={(event) => {
                            const row = event.currentTarget.parentElement
                            if (row) openProviderFlyout(group.id, row)
                          }}
                        >
                          <span>{group.label}</span>
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>

              {!isSearching &&
                hoveredProvider &&
                flyoutStyle &&
                createPortal(
                  (() => {
                    const group = providerGroups.find((item) => item.id === hoveredProvider)
                    if (!group) return null
                    const featured = featuredModelsForProvider(group.models, selectedValue)
                    return (
                      <div
                        className="task-model-flyout"
                        role="menu"
                        style={flyoutStyle}
                        onMouseEnter={clearFlyoutCloseTimer}
                        onMouseLeave={scheduleCloseProviderFlyout}
                      >
                        {featured.map((item) => {
                          const isSelected = item.id === selectedValue
                          return (
                            <button
                              key={item.id}
                              className={
                                isSelected ? 'task-model-option selected' : 'task-model-option'
                              }
                              type="button"
                              role="menuitemradio"
                              aria-checked={isSelected}
                              onClick={() => pickModel(item.id)}
                            >
                              <span className="task-model-check">
                                {isSelected && <Check size={13} />}
                              </span>
                              <span className="task-model-option-copy">
                                <strong>{item.label}</strong>
                                <small>{item.id}</small>
                              </span>
                            </button>
                          )
                        })}
                        {group.models.length > featured.length ? (
                          <div className="task-model-flyout-hint">
                            Search to see all {group.models.length} models
                          </div>
                        ) : null}
                      </div>
                    )
                  })(),
                  document.body
                )}
            </>
          )}
          </div>,
          document.body
        )}
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

function MessageMarkdown({
  content,
  addedLines
}: {
  content: string
  addedLines?: ReadonlySet<string>
}): ReactElement {
  const highlightModel = useMemo(
    () => buildMarkdownDiffHighlightModel(addedLines),
    [addedLines]
  )
  const highlightAdded = highlightModel != null
  const wrapText = (nodes: ReactNode): ReactNode =>
    highlightModel ? highlightAddedFragmentsInNodes(nodes, highlightModel.needles) : nodes

  return (
    <div className={`message-markdown${highlightAdded ? ' has-diff-highlights' : ''}`}>
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
                {wrapText(children)}
              </a>
            )
          },
          p({ children }) {
            return <p>{wrapText(children)}</p>
          },
          li({ children }) {
            return <li>{wrapText(children)}</li>
          },
          h1({ children }) {
            return <h1>{wrapText(children)}</h1>
          },
          h2({ children }) {
            return <h2>{wrapText(children)}</h2>
          },
          h3({ children }) {
            return <h3>{wrapText(children)}</h3>
          },
          h4({ children }) {
            return <h4>{wrapText(children)}</h4>
          },
          td({ children }) {
            return <td>{wrapText(children)}</td>
          },
          th({ children }) {
            return <th>{wrapText(children)}</th>
          },
          table({ children }) {
            return (
              <div className="markdown-table-wrap">
                <table>{children}</table>
              </div>
            )
          },
          tr({ children }) {
            const cells = Children.toArray(children)
            const [firstCell, ...remainingCells] = cells
            if (
              cells.length > 1 &&
              hasRenderableMarkdownCellContent(firstCell) &&
              remainingCells.every((cell) => !hasRenderableMarkdownCellContent(cell))
            ) {
              return (
                <tr className="markdown-table-note-row">
                  <td colSpan={cells.length}>{wrapText(markdownCellChildren(firstCell))}</td>
                </tr>
              )
            }

            const rowAdded =
              highlightModel != null && isAddedMarkdownTableRow(cells, highlightModel.tableRows)
            return <tr className={rowAdded ? 'md-diff-added-row' : undefined}>{children}</tr>
          },
          img({ src, alt }) {
            return <MarkdownImage src={src} alt={alt} />
          },
          pre({ children }) {
            return <>{children}</>
          },
          code({ className, children }) {
            const rawCode = String(children).replace(/\n$/, '')
            const language = normalizeLanguage((className ?? '').replace(/^language-/, ''))
            const isBlock = rawCode.includes('\n') || Boolean(className)

            if (!isBlock) {
              return <code className="inline-code">{wrapText(children)}</code>
            }

            const html =
              highlightModel != null
                ? buildCodeHtmlWithAddedHighlights(
                    rawCode,
                    language,
                    highlightModel.codeLines,
                    highlightCode
                  )
                : highlightCode(rawCode, language)

            return <MarkdownCodeBlock code={rawCode} language={language} html={html} />
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

interface MarkdownDiffHighlightModel {
  /** Substrings to mark inside paragraphs / cells / headings. */
  needles: string[]
  /** Normalized cell lists for whole-row table highlighting. */
  tableRows: string[][]
  /** Lines to mark inside fenced code blocks. */
  codeLines: ReadonlySet<string>
}

function buildMarkdownDiffHighlightModel(
  addedLines?: ReadonlySet<string>
): MarkdownDiffHighlightModel | null {
  if (!addedLines || addedLines.size === 0) return null

  const needles = new Set<string>()
  const tableRows: string[][] = []
  const codeLines = new Set<string>()

  for (const rawLine of addedLines) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim() || isMarkdownTableSeparator(line)) continue

    codeLines.add(line)
    codeLines.add(line.trim())

    const cells = parseMarkdownTableCells(line)
    if (cells) {
      const normalized = cells.map(normalizeMarkdownDiffText)
      tableRows.push(normalized)
      for (const cell of cells) {
        const trimmed = cell.trim()
        if (!trimmed) continue
        // Prefer longer / distinctive cell text to avoid painting short labels everywhere.
        if (trimmed.length >= 6 || /[/\s]/.test(trimmed)) {
          needles.add(trimmed)
          needles.add(normalizeMarkdownDiffText(trimmed))
        }
      }
      continue
    }

    needles.add(line)
    needles.add(line.trim())
    const plain = normalizeMarkdownDiffText(line)
    if (plain) needles.add(plain)
  }

  return {
    needles: [...needles]
      .filter((needle) => needle.length > 0)
      .sort((left, right) => right.length - left.length),
    tableRows,
    codeLines
  }
}

function parseMarkdownTableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.includes('|', 1)) return null
  if (isMarkdownTableSeparator(trimmed)) return null
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function normalizeMarkdownDiffText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function reactNodePlainText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => reactNodePlainText(child)).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return reactNodePlainText(node.props.children)
  }
  return ''
}

function isAddedMarkdownTableRow(cells: ReactNode[], tableRows: string[][]): boolean {
  if (tableRows.length === 0 || cells.length === 0) return false
  const rendered = cells.map((cell) => normalizeMarkdownDiffText(reactNodePlainText(cell)))
  if (rendered.every((cell) => !cell)) return false

  return tableRows.some((expected) => {
    if (expected.length !== rendered.length) return false
    return expected.every((cell, index) => cell === rendered[index])
  })
}

function highlightAddedFragmentsInNodes(nodes: ReactNode, needles: string[]): ReactNode {
  return Children.map(nodes, (child) => {
    if (typeof child === 'string') return highlightAddedFragmentsInText(child, needles)
    if (typeof child === 'number') return child
    if (!isValidElement<{ children?: ReactNode }>(child)) return child
    if (child.props.children == null) return child
    return cloneElement(child, {
      ...child.props,
      children: highlightAddedFragmentsInNodes(child.props.children, needles)
    })
  })
}

function highlightAddedFragmentsInText(text: string, needles: string[]): ReactNode {
  if (needles.length === 0 || !text) return text

  let earliestIndex = -1
  let earliestNeedle = ''
  for (const needle of needles) {
    if (!needle) continue
    const index = text.indexOf(needle)
    if (index < 0) continue
    if (earliestIndex < 0 || index < earliestIndex) {
      earliestIndex = index
      earliestNeedle = needle
    }
  }
  if (earliestIndex < 0) return text

  const before = text.slice(0, earliestIndex)
  const match = text.slice(earliestIndex, earliestIndex + earliestNeedle.length)
  const after = text.slice(earliestIndex + earliestNeedle.length)

  return (
    <>
      {before}
      <mark className="md-diff-added">{match}</mark>
      {highlightAddedFragmentsInText(after, needles)}
    </>
  )
}

function hasRenderableMarkdownCellContent(cell: ReactNode): boolean {
  const content = markdownCellChildren(cell)
  if (content === null || content === undefined) return false
  if (typeof content === 'string') return content.trim().length > 0
  if (typeof content === 'number') return true
  if (Array.isArray(content)) return content.some((child) => hasRenderableMarkdownCellContent(child))
  if (isValidElement<{ children?: ReactNode }>(content)) return hasRenderableMarkdownCellContent(content.props.children)
  return true
}

function markdownCellChildren(cell: ReactNode): ReactNode {
  return isValidElement<{ children?: ReactNode }>(cell) ? cell.props.children : cell
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }): ReactElement {
  const [didFail, setDidFail] = useState(false)
  const label = alt?.trim() || 'Image'
  const isBadge = isBadgeImage(src, label)

  if (!src || didFail) {
    return isBadge ? (
      <span className="markdown-badge-fallback">{label}</span>
    ) : (
      <span className="markdown-image-fallback" role="img" aria-label={label}>
        {label}
      </span>
    )
  }

  return (
    <img
      className={isBadge ? 'markdown-badge-image' : 'markdown-image'}
      src={src}
      alt={label}
      loading="lazy"
      onError={() => setDidFail(true)}
    />
  )
}

function isBadgeImage(src: string | undefined, alt: string): boolean {
  return Boolean(src?.includes('img.shields.io') || /^(license|platform|build|version|status)\b/i.test(alt))
}

function isNoisyConversationEntry(entry: ConversationEntry): boolean {
  const content = entry.content.trim()
  if (!content) return (entry.attachments?.length ?? 0) === 0
  if (/^(system|user|assistant|thinking|tool_call|result|metadata|init|start|started|end|done|completed|success)$/i.test(content)) return true
  if (content.includes('You are running inside VibeBoard as a background coding agent.')) return true
  if (content.includes('Token and exploration rules:')) return true
  return false
}

function isAgentCliDiagnosticMessage(content: string): boolean {
  return /^(Codex|Claude|Cursor) (debug|finished without|CLI debug)/i.test(content.trim())
}

function isOperationalSystemMessage(content: string): boolean {
  const text = content.trim()
  return (
    isAgentCliDiagnosticMessage(text) ||
    /^(Agent is running|Still working|Starting Cursor|Starting Codex|Starting Claude|Select a project|Cursor (CLI|Agent)|This run was interrupted|Project folder|Could not|Retry keeps|This run mode|Git repository)/i.test(
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
  // Do not strip conversational lines like "I'm fine…" - that hid Codex/Claude replies.
  // Only remove Cursor stream marker noise / UUID junk via cleanConversationLine.
  return stripLeadingActualMessageMarker(content)
    .split(/\r?\n/)
    .map((line) => cleanConversationLine(line))
    .filter(Boolean)
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

function DiffViewer({ change, taskId }: { change: CodeChange; taskId: string }): ReactElement {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const diffText = useMemo(() => change.diffText.trim() || fallbackDiff(change), [change])
  const rows = useMemo(() => compactDiffRows(parseDiffRows(diffText)), [diffText])
  const language = useMemo(
    () => normalizeLanguage(change.language || languageFromPath(change.filePath)),
    [change.filePath, change.language]
  )
  const languageLabel = useMemo(() => displayLanguage(language), [language])
  const markdownPreview = useMemo(() => markdownPreviewFromDiff(diffText), [diffText])
  const canPreviewMarkdown = language === 'markdown' && Boolean(markdownPreview.content.trim())

  return (
    <article className="diff-file">
      <header className="diff-file-header">
        <div className="diff-file-title">
          <span className={`change-type ${change.changeType}`}>{change.changeType}</span>
          <strong>{change.filePath}</strong>
        </div>
        <div className="diff-file-meta">
          {canPreviewMarkdown && (
            <button
              className="icon-text-button markdown-preview-button"
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              title="Preview rendered Markdown with added lines highlighted"
            >
              <Eye size={14} />
              <span>Preview</span>
            </button>
          )}
          <span>{languageLabel}</span>
        </div>
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
      {isPreviewOpen && (
        <MarkdownPreviewModal
          taskId={taskId}
          filePath={change.filePath}
          fallbackContent={markdownPreview.content}
          addedLines={markdownPreview.addedLines}
          onClose={() => setIsPreviewOpen(false)}
        />
      )}
    </article>
  )
}

function MarkdownPreviewModal({
  taskId,
  filePath,
  fallbackContent,
  addedLines,
  onClose
}: {
  taskId: string
  filePath: string
  fallbackContent: string
  addedLines: ReadonlySet<string>
  onClose: () => void
}): ReactElement {
  const [content, setContent] = useState(fallbackContent)
  const [loadState, setLoadState] = useState<'loading' | 'file' | 'diff'>('loading')

  useModalEscape(onClose)

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    void window.vibeboard
      .readTaskWorkspaceFile({ taskId, filePath })
      .then((fileContent) => {
        if (cancelled) return
        if (fileContent != null && fileContent.length > 0) {
          setContent(fileContent)
          setLoadState('file')
          return
        }
        setContent(healMarkdownTablesForPreview(fallbackContent))
        setLoadState('diff')
      })
      .catch(() => {
        if (cancelled) return
        setContent(healMarkdownTablesForPreview(fallbackContent))
        setLoadState('diff')
      })
    return () => {
      cancelled = true
    }
  }, [taskId, filePath, fallbackContent])

  return (
    <div className="modal-backdrop markdown-preview-backdrop" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section
        className="modal-panel markdown-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${filePath} preview`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>Markdown preview</h2>
            <p>
              {filePath}
              {addedLines.size > 0 ? ' · green marks new or changed lines' : ''}
              {loadState === 'diff' ? ' · from diff hunks' : ''}
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close preview">
            <X size={18} />
          </button>
        </header>
        <div className="markdown-preview-body markdown-preview-diff">
          {loadState === 'loading' ? (
            <p className="settings-note">Loading file…</p>
          ) : (
            <MessageMarkdown content={content} addedLines={addedLines} />
          )}
        </div>
      </section>
    </div>
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

function markdownPreviewFromDiff(diffText: string): {
  content: string
  addedLines: ReadonlySet<string>
} {
  const rows = parseDiffRows(diffText).filter(
    (row) => row.kind === 'context' || row.kind === 'added'
  )
  const addedLines = new Set(
    rows.filter((row) => row.kind === 'added').map((row) => row.text)
  )
  return {
    content: healMarkdownTablesForPreview(
      rows
        .map((row) => row.text)
        .join('\n')
        .trim()
    ),
    addedLines
  }
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.includes('|', 1)
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|') || !/-{1,}/.test(trimmed)) return false
  // GFM delimiter row: pipes + hyphens/colons only.
  return /^[\s|:\-]+$/.test(trimmed) && /-+/.test(trimmed)
}

function markdownTableColumnCount(line: string): number {
  const cells = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
  return Math.max(1, cells.length)
}

/**
 * Diff hunks often omit the table header/separator above a changed row, so remark-gfm
 * cannot form a table. When we only have hunk text, insert a synthetic delimiter.
 */
function healMarkdownTablesForPreview(content: string): string {
  const lines = content.split('\n')
  const output: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const prev = output.length > 0 ? output[output.length - 1] : ''
    const startsTableBlock =
      isMarkdownTableRow(line) &&
      !isMarkdownTableSeparator(line) &&
      !isMarkdownTableRow(prev) &&
      !isMarkdownTableSeparator(prev)

    if (startsTableBlock) {
      // Peek ahead: only heal when the next lines look like more table rows
      // and there is no delimiter in this run.
      let hasSeparator = false
      let rowCount = 0
      let columns = markdownTableColumnCount(line)
      for (let look = index; look < lines.length; look += 1) {
        const candidate = lines[look]
        if (!candidate.trim()) break
        if (isMarkdownTableSeparator(candidate)) {
          hasSeparator = true
          break
        }
        if (!isMarkdownTableRow(candidate)) break
        rowCount += 1
        columns = Math.max(columns, markdownTableColumnCount(candidate))
      }

      if (!hasSeparator && rowCount >= 1) {
        if (output.length > 0 && output[output.length - 1].trim() !== '') {
          output.push('')
        }
        const delimiter = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
        // Use the first data row as a visible header stand-in only when a single
        // orphaned row would otherwise never form a table; otherwise invent a blank header.
        if (rowCount === 1) {
          output.push(line)
          output.push(delimiter)
          continue
        }
        const blankHeader = `| ${Array.from({ length: columns }, () => ' ').join(' | ')} |`
        output.push(blankHeader)
        output.push(delimiter)
      }
    }

    output.push(line)
  }

  return output.join('\n')
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

function tabColorVars(color: string | null | undefined, isActive: boolean): React.CSSProperties {
  if (!color) return {}
  return {
    '--tab-bg': hexToRgba(color, isActive ? 0.34 : 0.2),
    '--tab-bg-hover': hexToRgba(color, 0.26)
  } as React.CSSProperties
}


function applyAppearanceSettings(settings: AppearanceSettings): void {
  const root = document.documentElement
  const ui = settings.uiFontSize
  root.style.setProperty('--text-xs', `${Math.max(10, ui - 2)}px`)
  root.style.setProperty('--text-sm', `${Math.max(11, ui - 1)}px`)
  root.style.setProperty('--text-md', `${ui}px`)
  root.style.setProperty('--text-lg', `${ui + 2}px`)
  root.style.setProperty('--text-xl', `${ui + 5}px`)
  root.style.setProperty('--code-font-size', `${settings.codeFontSize}px`)
  root.style.fontSize = `${ui}px`

  root.dataset.fontSmoothing = settings.fontSmoothing ? 'on' : 'off'
  root.dataset.reduceMotion = settings.reduceMotion
}

function isAgentToolProgressLine(content: string): boolean {
  return /^(Using |Reading |Read |Editing |Edited |Deleted |Deleting |Searched |Searching |Listed files|Listing files|Ran command|Running command|Fetched |Fetching |Used )/i.test(
    content.trim()
  )
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
