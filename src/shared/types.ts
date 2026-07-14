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
  createdAt: string
}

export interface AppState {
  projects: Project[]
  tabs: BoardTab[]
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

export interface CreateLaneInput {
  tabId: string
  name: string
}

export interface CreateTaskInput {
  tabId: string
  laneId: string
  projectId: string | null
  title: string
  summary: string
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

export interface VibeBoardApi {
  getState: () => Promise<AppState>
  createProject: (input: CreateProjectInput) => Promise<Project | null>
  createTab: (input: CreateTabInput) => Promise<BoardTab>
  renameTab: (input: RenameInput) => Promise<void>
  setActiveTab: (tabId: string) => Promise<void>
  createLane: (input: CreateLaneInput) => Promise<Lane>
  renameLane: (input: RenameInput) => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<Task>
  moveTask: (input: MoveTaskInput) => Promise<void>
  updateTaskStatus: (input: UpdateTaskStatusInput) => Promise<void>
  markTaskRead: (taskId: string) => Promise<void>
  getCursorAdapterStatus: () => Promise<{ available: boolean; label: string }>
}
