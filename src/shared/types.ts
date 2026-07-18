export type TaskStatus = 'idle' | 'processing' | 'attention' | 'done_unread' | 'done_read'
export type RunMode = 'shared' | 'branch' | 'worktree'

export interface Project {
  id: string
  name: string
  path: string
  runMode: RunMode
  autoMoveTasks: number
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

export interface QueuedTaskMessage {
  id: string
  content: string
  attachments: ConversationAttachment[]
}

export interface Task {
  id: string
  tabId: string
  laneId: string
  projectId: string | null
  title: string
  summary: string
  status: TaskStatus
  runModeOverride: RunMode | null
  /** Cursor Agent model id; null uses the CLI default (Auto). */
  model: string | null
  branchName: string | null
  worktreePath: string | null
  /**
   * 1 when this task's code changes were committed and pushed to main/origin
   * with a clean working tree afterward. 0 otherwise, including chat-only tasks
   * that never had code changes.
   */
  pushedToMain: number
  position: number
  createdAt: string
  updatedAt: string
  /** ISO timestamp set while a Cursor run is active; null/omitted when idle. */
  runStartedAt?: string | null
  /** Follow-up messages waiting to run after the current agent finishes. */
  queuedMessages?: QueuedTaskMessage[]
}

export interface AgentModel {
  id: string
  label: string
  isDefault?: boolean
  isCurrent?: boolean
}

export interface ConversationAttachment {
  id: string
  name: string
  mimeType: string
  filePath: string
  dataUrl?: string
}

export interface ConversationEntry {
  id: string
  taskId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: ConversationAttachment[]
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

export interface UpdateProjectRunModeInput {
  projectId: string
  runMode: RunMode
}

export interface TaskMessageAttachmentInput {
  name: string
  mimeType: string
  dataBase64: string
}

export interface UpdateProjectAutoMoveInput {
  projectId: string
  autoMoveTasks: boolean
}

export interface UpdateTaskModelInput {
  taskId: string
  /** Cursor Agent model id, or null for Auto/default. */
  model: string | null
}

export interface SendTaskMessageInput {
  taskId: string
  content: string
  attachments?: TaskMessageAttachmentInput[]
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

export interface NotificationOpenRequest {
  taskId: string
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
  /** Play a short sound when a task finishes. */
  playFinishSound: boolean
}

export type ReduceMotionPreference = 'system' | 'reduce' | 'no-preference'

export interface AppearanceSettings {
  uiFontSize: number
  codeFontSize: number
  fontSmoothing: boolean
  reduceMotion: ReduceMotionPreference
}

export interface NotchOverlaySettings {
  enabled: boolean
  /** Expand when a task finishes successfully. */
  expandOnTaskCompleted: boolean
  /** On finish, show the AI answer plus a reply field in the notch. */
  showFinishChat: boolean
  /** Expand when a task needs attention (closest to AI asking / blocked). */
  expandOnAttention: boolean
  /** Expand when the last running task stops. */
  expandOnAllFinished: boolean
}

export interface NotchOverlayCapability {
  supported: boolean
  platform: string
  hasNotch: boolean
  reason: string | null
}

export type NotchOverlayMode = 'compact' | 'expanded'

export interface NotchOverlaySnapshot {
  mode: NotchOverlayMode
  runningCount: number
  attentionCount: number
  doneCount: number
  headline: string
  /** Right-side compact label, e.g. "3" or "3 sessions". */
  trailing: string | null
  detail: string | null
  taskId: string | null
  taskTitle: string | null
  /** Latest assistant reply when showing the finish-chat panel. */
  answer: string | null
  /** Show the chat reply field in the expanded notch. */
  showReply: boolean
  /** Ask the overlay to focus the reply input. */
  focusInput: boolean
  /** Whether the island surface is revealed (animates in/out of the hardware notch). */
  surfaceVisible: boolean
  /** Remaining seconds shown for hold-Esc-to-close (finish chat only). */
  escapeCloseRemainingSec: number | null
  /** Finish chat temporarily parked after click-away (mid size, click to expand). */
  parked: boolean
  /** Other finished tasks waiting behind the current finish panel. */
  finishQueueRemaining: number
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
  onNotificationOpened: (callback: (request: NotificationOpenRequest) => void) => () => void
  getUpdateInfo: () => Promise<UpdateInfo>
  downloadUpdate: () => Promise<UpdateInfo>
  installUpdate: () => Promise<UpdateInfo>
  getNotificationSettings: () => Promise<NotificationSettings>
  updateNotificationSettings: (settings: NotificationSettings) => Promise<NotificationSettings>
  getAppearanceSettings: () => Promise<AppearanceSettings>
  updateAppearanceSettings: (settings: AppearanceSettings) => Promise<AppearanceSettings>
  sendTestNotification: () => Promise<void>
  previewFinishSound: () => Promise<void>
  getNotchOverlayCapability: () => Promise<NotchOverlayCapability>
  getNotchOverlaySettings: () => Promise<NotchOverlaySettings>
  updateNotchOverlaySettings: (settings: NotchOverlaySettings) => Promise<NotchOverlaySettings>
  getNotchOverlaySnapshot: () => Promise<NotchOverlaySnapshot>
  onNotchOverlaySnapshot: (callback: (snapshot: NotchOverlaySnapshot) => void) => () => void
  openTaskFromNotch: (taskId: string) => Promise<void>
  collapseNotchOverlay: () => Promise<void>
  peekNotchOverlay: () => Promise<void>
  dismissNotchFinishChat: (options?: { force?: boolean }) => Promise<boolean>
  reopenNotchFinishChat: () => Promise<boolean>
  unparkNotchFinishChat: () => Promise<boolean>
  parkNotchFinishChat: () => Promise<boolean>
  scheduleDevNotchFinishTest: (delayMs?: number) => Promise<{ ok: boolean; delayMs?: number; reason?: string }>
  startNotchMarketingDemo: () => Promise<{ ok: boolean; reason?: string }>
  stopNotchMarketingDemo: () => Promise<{ ok: boolean }>
  setNotchMousePassthrough: (passthrough: boolean) => void
  sendNotchReply: (input: { taskId: string; content: string }) => Promise<void>
  getOnboardingComplete: () => Promise<boolean>
  markOnboardingComplete: () => Promise<void>
  reportUserActivity: () => void
  createProject: (input: CreateProjectInput) => Promise<Project | null>
  relocateProject: (projectId: string) => Promise<Project | null>
  updateProjectRunMode: (input: UpdateProjectRunModeInput) => Promise<void>
  updateProjectAutoMove: (input: UpdateProjectAutoMoveInput) => Promise<void>
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
  updateTaskModel: (input: UpdateTaskModelInput) => Promise<void>
  sendTaskMessage: (input: SendTaskMessageInput) => Promise<RunTaskResult>
  runTaskWithCursor: (taskId: string) => Promise<RunTaskResult>
  retryTaskPrompt: (taskId: string) => Promise<RunTaskResult>
  stopTask: (taskId: string) => Promise<RunTaskResult>
  updateTaskStatus: (input: UpdateTaskStatusInput) => Promise<void>
  markTaskRead: (taskId: string) => Promise<void>
  getCursorAdapterStatus: () => Promise<CursorStatus>
  listAgentModels: () => Promise<AgentModel[]>
  installCursorCli: () => Promise<RunTaskResult>
  openCursorInstallTerminal: () => Promise<void>
  openCursorSetup: () => Promise<void>
  confirmQuit: () => Promise<void>
  cancelQuit: () => Promise<void>
}
