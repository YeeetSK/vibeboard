export type TaskStatus = 'idle' | 'processing' | 'attention' | 'done_unread' | 'done_read'

export interface Project {
  id: string
  name: string
  path: string
  pathMissing: boolean
  createdAt: string
}

export interface BoardTab {
  id: string
  name: string
  activeProjectId: string | null
  isPinned: number
  isClosed: number
  color: string | null
  position: number
  createdAt: string
  lastUsedAt: string
}

export interface Lane {
  id: string
  tabId: string
  name: string
  position: number
}

export interface Task {
  id: string
  tabId: string
  laneId: string
  projectId: string | null
  title: string
  summary: string
  status: TaskStatus
  position: number
  createdAt: string
  updatedAt: string
}

export interface ConversationEntry {
  id: string
  taskId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export interface CodeChange {
  id: string
  taskId: string
  filePath: string
  summary: string
  changeType: 'added' | 'modified' | 'deleted'
  language: string
  diffText: string
  createdAt: string
}

export interface AppState {
  projects: Project[]
  tabs: BoardTab[]
  closedTabs: BoardTab[]
  lanes: Lane[]
  tasks: Task[]
  activeTabId: string
}

export interface TaskDetail {
  conversations: ConversationEntry[]
  changes: CodeChange[]
  hasOlderConversations: boolean
}

export interface GetTaskDetailInput {
  taskId: string
  beforeCreatedAt?: string
  limit?: number
  includeChanges?: boolean
}

export interface CreateProjectInput {
  name?: string
}

export interface CreateTabInput {
  name: string
  projectId?: string | null
}

export interface RenameInput {
  id: string
  name: string
}

export interface UpdateTabMetaInput {
  id: string
  isPinned?: boolean
  color?: string | null
}

export interface ReorderTabsInput {
  orderedIds: string[]
}

export interface CreateLaneInput {
  tabId: string
  name: string
}

export interface CreateTaskInput {
  tabId: string
  laneId: string
  projectId: string | null
  title: string
  prompt?: string
}

export interface MoveTaskInput {
  taskId: string
  laneId: string
  position: number
}

export interface UpdateTaskStatusInput {
  taskId: string
  status: TaskStatus
}

export interface SendTaskMessageInput {
  taskId: string
  content: string
}

export interface SearchWorkspaceInput {
  query: string
  limit?: number
}

export interface RecordSearchOpenInput {
  result: SearchResult
}

export type SearchResultKind = 'project' | 'tab' | 'task' | 'prompt'

export interface SearchResult {
  id: string
  kind: SearchResultKind
  title: string
  subtitle: string
  match: string
  meta?: string
  taskStatus?: TaskStatus
  tabId?: string
  taskId?: string
  projectId?: string
  isClosedTab?: boolean
}

export interface RunTaskResult {
  started: boolean
  message: string
}

export interface CursorDebugInfo {
  cursorCommand: string | null
  agentCommand: string | null
  authStatus: string
  checkedCursorCommands: string[]
  checkedAgentCommands: string[]
  installCommand: string
  lastInstallOutput: string
  processPath: string
  shellPath: string
}

export interface CursorStatus {
  available: boolean
  label: string
  debug: CursorDebugInfo
}

export type CursorSetupPhase = 'checking' | 'preparing' | 'ready' | 'failed'

export interface QuitRequest {
  hasRunningTasks: boolean
}

export type NotificationEventKey = 'taskCompleted' | 'taskFailed' | 'allTasksFinished'

export interface NotificationEventSettings {
  taskCompleted: boolean
  taskFailed: boolean
  allTasksFinished: boolean
}

export interface NtfySettings {
  enabled: boolean
  serverUrl: string
  topic: string
  events: NotificationEventSettings
}

export interface NotificationSettings {
  desktopEnabled: boolean
  desktopEvents: NotificationEventSettings
  ntfy: NtfySettings
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not_available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export type UpdateMode = 'auto' | 'manual' | 'dev'

export interface UpdateInfo {
  status: UpdateStatus
  mode: UpdateMode
  currentVersion: string
  latestVersion: string | null
  message: string
  progress: number | null
  releaseUrl: string | null
  releaseNotes: string | null
}

export interface VibeBoardApi {
  getState: () => Promise<AppState>
  getTaskDetail: (input: GetTaskDetailInput) => Promise<TaskDetail>
  searchWorkspace: (input: SearchWorkspaceInput) => Promise<SearchResult[]>
  recordSearchOpen: (input: RecordSearchOpenInput) => Promise<void>
  onStateChanged: (callback: () => void) => () => void
  onQuitRequested: (callback: (request: QuitRequest) => void) => () => void
  onUpdateChanged: (callback: (info: UpdateInfo) => void) => () => void
  getUpdateInfo: () => Promise<UpdateInfo>
  downloadUpdate: () => Promise<UpdateInfo>
  installUpdate: () => Promise<UpdateInfo>
  getNotificationSettings: () => Promise<NotificationSettings>
  updateNotificationSettings: (settings: NotificationSettings) => Promise<NotificationSettings>
  sendTestNotification: () => Promise<void>
  createProject: (input: CreateProjectInput) => Promise<Project | null>
  relocateProject: (projectId: string) => Promise<Project | null>
  openProjectFolder: (projectId: string) => Promise<void>
  openExternalUrl: (url: string) => Promise<void>
  createTab: (input: CreateTabInput) => Promise<BoardTab>
  renameTab: (input: RenameInput) => Promise<void>
  updateTabMeta: (input: UpdateTabMetaInput) => Promise<void>
  reorderTabs: (input: ReorderTabsInput) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  reopenTab: (tabId: string) => Promise<void>
  deleteTab: (tabId: string) => Promise<void>
  setActiveTab: (tabId: string) => Promise<void>
  createLane: (input: CreateLaneInput) => Promise<Lane>
  renameLane: (input: RenameInput) => Promise<void>
  deleteLane: (laneId: string) => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<Task>
  renameTask: (input: RenameInput) => Promise<void>
  moveTask: (input: MoveTaskInput) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  sendTaskMessage: (input: SendTaskMessageInput) => Promise<RunTaskResult>
  runTaskWithCursor: (taskId: string) => Promise<RunTaskResult>
  updateTaskStatus: (input: UpdateTaskStatusInput) => Promise<void>
  markTaskRead: (taskId: string) => Promise<void>
  getCursorAdapterStatus: () => Promise<CursorStatus>
  installCursorCli: () => Promise<RunTaskResult>
  openCursorInstallTerminal: () => Promise<void>
  openCursorSetup: () => Promise<void>
  confirmQuit: () => Promise<void>
  cancelQuit: () => Promise<void>
}
