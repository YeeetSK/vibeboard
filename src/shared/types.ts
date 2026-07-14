export type TaskStatus = 'idle' | 'processing' | 'attention' | 'done_unread' | 'done_read'

export interface Project {
  id: string
  name: string
  path: string
  createdAt: string
}

export interface BoardTab {
  id: string
  name: string
  activeProjectId: string | null
  isPinned: number
  isClosed: number
  color: string | null
  createdAt: string
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
  conversations: ConversationEntry[]
  changes: CodeChange[]
  activeTabId: string
}

export interface CreateProjectInput {
  name?: string
}

export interface CreateTabInput {
  name: string
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

export interface CreateLaneInput {
  tabId: string
  name: string
}

export interface CreateTaskInput {
  tabId: string
  laneId: string
  projectId: string | null
  title: string
  prompt: string
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

export interface VibeBoardApi {
  getState: () => Promise<AppState>
  onStateChanged: (callback: () => void) => () => void
  createProject: (input: CreateProjectInput) => Promise<Project | null>
  createTab: (input: CreateTabInput) => Promise<BoardTab>
  renameTab: (input: RenameInput) => Promise<void>
  updateTabMeta: (input: UpdateTabMetaInput) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  reopenTab: (tabId: string) => Promise<void>
  deleteTab: (tabId: string) => Promise<void>
  setActiveTab: (tabId: string) => Promise<void>
  createLane: (input: CreateLaneInput) => Promise<Lane>
  renameLane: (input: RenameInput) => Promise<void>
  deleteLane: (laneId: string) => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<Task>
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
}
