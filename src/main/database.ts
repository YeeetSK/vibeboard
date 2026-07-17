import { app, dialog } from 'electron'
import Database from 'better-sqlite3'
import path from 'node:path'
import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import type {
  AppState,
  BoardTab,
  CodeChange,
  ConversationEntry,
  CreateLaneInput,
  CreateProjectInput,
  CreateTabInput,
  CreateTaskInput,
  GetTaskDetailInput,
  Lane,
  MoveTaskInput,
  NotificationSettings,
  Project,
  RecordSearchOpenInput,
  ReorderTabsInput,
  RenameInput,
  RunMode,
  SendTaskMessageInput,
  SearchResult,
  SearchWorkspaceInput,
  Task,
  TaskDetail,
  TaskStatus,
  UpdateTabMetaInput,
  UpdateTaskStatusInput
} from '../shared/types'

const now = (): string => new Date().toISOString()
const id = (): string => crypto.randomUUID()
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (match) => `\\${match}`)
const compactProjectPath = (projectPath: string): string => {
  const parts = projectPath.split('/').filter(Boolean)
  if (parts.length <= 3) return projectPath
  return `.../${parts.slice(-3).join('/')}`
}

const taskStatusLabel = (status: TaskStatus): string => {
  if (status === 'processing') return 'Running'
  if (status === 'attention') return 'Needs you'
  if (status === 'done_unread') return 'Done unread'
  if (status === 'done_read') return 'Done'
  return 'Idle'
}

const statusLaneMatchers: Record<TaskStatus, RegExp[]> = {
  idle: [/\b(backlog|todo|waiting|ideas?)\b/i],
  processing: [/\b(active|running|in progress|doing|working)\b/i],
  attention: [/\b(needs you|attention|review|blocked|issue|fix)\b/i],
  done_unread: [/\b(done|complete|completed|finished|shipped)\b/i],
  done_read: [/\b(done|complete|completed|finished|shipped)\b/i]
}

export interface TaskStatusChangeEvent {
  task: Task
  oldStatus: TaskStatus
  newStatus: TaskStatus
}

export const defaultNotificationSettings: NotificationSettings = {
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

const mergeNotificationSettings = (settings: Partial<NotificationSettings>): NotificationSettings => ({
  desktopEnabled: Boolean(settings.desktopEnabled),
  desktopEvents: {
    taskCompleted: settings.desktopEvents?.taskCompleted ?? defaultNotificationSettings.desktopEvents.taskCompleted,
    taskFailed: settings.desktopEvents?.taskFailed ?? defaultNotificationSettings.desktopEvents.taskFailed,
    allTasksFinished:
      settings.desktopEvents?.allTasksFinished ?? defaultNotificationSettings.desktopEvents.allTasksFinished
  },
  ntfy: {
    enabled: Boolean(settings.ntfy?.enabled),
    serverUrl: settings.ntfy?.serverUrl?.trim() || defaultNotificationSettings.ntfy.serverUrl,
    topic: settings.ntfy?.topic?.trim() || '',
    events: {
      taskCompleted: settings.ntfy?.events?.taskCompleted ?? defaultNotificationSettings.ntfy.events.taskCompleted,
      taskFailed: settings.ntfy?.events?.taskFailed ?? defaultNotificationSettings.ntfy.events.taskFailed,
      allTasksFinished:
        settings.ntfy?.events?.allTasksFinished ?? defaultNotificationSettings.ntfy.events.allTasksFinished
    }
  }
})

const normalizeRunMode = (value: string | null | undefined): RunMode => {
  if (value === 'branch' || value === 'worktree') return value
  return 'worktree'
}

const withPathState = (project: Project): Project => ({
  ...project,
  runMode: normalizeRunMode(project.runMode),
  pathMissing: !existsSync(project.path)
})

const parseSearchQuery = (
  rawQuery: string
): {
  text: string
  regex: RegExp | null
  minLength: number | null
  maxLength: number | null
} => {
  let text = rawQuery.trim()
  let regex: RegExp | null = null
  let minLength: number | null = null
  let maxLength: number | null = null

  text = text.replace(/\blen(?:gth)?\s*([<>]=?)\s*(\d+)\b/gi, (_match, operator: string, rawLength: string) => {
    const value = Number(rawLength)
    if (operator.startsWith('>')) {
      minLength = operator === '>' ? value + 1 : value
    } else {
      maxLength = operator === '<' ? value - 1 : value
    }
    return ''
  })

  const regexMatch = text.match(/^\/(.+)\/([imsu]*)$/)
  if (regexMatch) {
    try {
      regex = new RegExp(regexMatch[1], regexMatch[2])
      text = ''
    } catch {
      regex = null
    }
  }

  return { text: text.trim(), regex, minLength, maxLength }
}

export class VibeBoardStore {
  private db: Database.Database
  private taskStatusListener: ((event: TaskStatusChangeEvent) => void) | null = null

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'vibeboard.sqlite')
    this.db = new Database(dbPath)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = WAL')
    this.migrate()
    this.replaceOldDemoSeed()
    this.seed()
  }

  setTaskStatusListener(listener: (event: TaskStatusChangeEvent) => void): void {
    this.taskStatusListener = listener
  }

  getNotificationSettings(): NotificationSettings {
    const raw = this.getSetting('notificationSettings')
    if (!raw) return defaultNotificationSettings

    try {
      const parsed = JSON.parse(raw) as Partial<NotificationSettings>
      return mergeNotificationSettings(parsed)
    } catch {
      return defaultNotificationSettings
    }
  }

  updateNotificationSettings(settings: NotificationSettings): NotificationSettings {
    const nextSettings = mergeNotificationSettings(settings)
    this.setSetting('notificationSettings', JSON.stringify(nextSettings))
    return nextSettings
  }

  getState(): AppState {
    const savedActiveTabId = this.getSetting('activeTabId')
    const savedActiveTab = savedActiveTabId
      ? (this.db.prepare('SELECT id FROM tabs WHERE id = ? AND isClosed = 0').get(savedActiveTabId) as
          | { id: string }
          | undefined)
      : undefined
    const fallbackTab = this.db
      .prepare('SELECT id FROM tabs WHERE isClosed = 0 ORDER BY createdAt LIMIT 1')
      .get() as { id: string } | undefined
    const activeTabId = savedActiveTab?.id ?? fallbackTab?.id ?? ''

    return {
      projects: (this.db.prepare('SELECT * FROM projects ORDER BY createdAt DESC').all() as Project[]).map(withPathState),
      tabs: this.db
        .prepare('SELECT * FROM tabs WHERE isClosed = 0 ORDER BY isPinned DESC, position, createdAt')
        .all() as BoardTab[],
      closedTabs: this.db
        .prepare('SELECT * FROM tabs WHERE isClosed = 1 ORDER BY lastUsedAt DESC, createdAt DESC LIMIT 40')
        .all() as BoardTab[],
      lanes: this.db.prepare('SELECT * FROM lanes ORDER BY position').all() as Lane[],
      tasks: this.db.prepare('SELECT * FROM tasks ORDER BY position').all() as Task[],
      activeTabId
    }
  }

  getTaskDetail(input: GetTaskDetailInput): TaskDetail {
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 50)
    const conversationRows = input.beforeCreatedAt
      ? (this.db
          .prepare(
            'SELECT * FROM conversations WHERE taskId = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT ?'
          )
          .all(input.taskId, input.beforeCreatedAt, limit + 1) as ConversationEntry[])
      : (this.db
          .prepare('SELECT * FROM conversations WHERE taskId = ? ORDER BY createdAt DESC LIMIT ?')
          .all(input.taskId, limit + 1) as ConversationEntry[])
    const conversations = conversationRows.slice(0, limit).reverse()

    return {
      conversations,
      changes:
        input.includeChanges === false
          ? []
          : (this.db
              .prepare('SELECT * FROM code_changes WHERE taskId = ? ORDER BY createdAt')
              .all(input.taskId) as CodeChange[]),
      hasOlderConversations: conversationRows.length > limit
    }
  }

  searchWorkspace(input: SearchWorkspaceInput): SearchResult[] {
    const limit = Math.min(Math.max(input.limit ?? 18, 1), 40)
    const parsed = parseSearchQuery(input.query)
    const isHistoryQuery = !parsed.text && !parsed.regex && parsed.minLength === null && parsed.maxLength === null
    const hasText = Boolean(parsed.text)
    const allowPathSearch = parsed.text.length >= 3 || Boolean(parsed.regex) || parsed.minLength !== null || parsed.maxLength !== null
    const like = `%${escapeLike(parsed.text)}%`
    const candidates: SearchResult[] = []
    const candidateLimit = Math.max(limit * 3, 36)

    const matches = (value: string): boolean => {
      if (parsed.minLength !== null && value.length < parsed.minLength) return false
      if (parsed.maxLength !== null && value.length > parsed.maxLength) return false
      if (parsed.regex) return parsed.regex.test(value)
      return true
    }

    if (isHistoryQuery) {
      return this.getSearchHistory(Math.min(limit, 4))
    }

    const projectRows = this.db
      .prepare(
        hasText
          ? `SELECT
              projects.id as projectId,
              projects.name as projectName,
              projects.path as projectPath,
              tabs.id as tabId,
              tabs.isClosed as isClosedTab
            FROM projects
            LEFT JOIN tabs ON tabs.activeProjectId = projects.id
            WHERE projects.name LIKE ? ESCAPE '\\'
              ${allowPathSearch ? "OR projects.path LIKE ? ESCAPE '\\'" : ''}
            ORDER BY COALESCE(tabs.lastUsedAt, projects.createdAt) DESC
            LIMIT ?`
          : `SELECT
              projects.id as projectId,
              projects.name as projectName,
              projects.path as projectPath,
              tabs.id as tabId,
              tabs.isClosed as isClosedTab
            FROM projects
            LEFT JOIN tabs ON tabs.activeProjectId = projects.id
            ORDER BY COALESCE(tabs.lastUsedAt, projects.createdAt) DESC
            LIMIT ?`
      )
      .all(
        ...(hasText ? (allowPathSearch ? [like, like, candidateLimit] : [like, candidateLimit]) : [candidateLimit])
      ) as Array<{
      projectId: string
      projectName: string
      projectPath: string
      tabId: string | null
      isClosedTab: number | null
    }>

    for (const row of projectRows) {
      const match = allowPathSearch ? `${row.projectName} ${row.projectPath}` : row.projectName
      if (!matches(match)) continue
      const tabId = row.tabId ?? undefined
      candidates.push({
        id: tabId ? `tab:${tabId}` : `project:${row.projectId}`,
        kind: tabId ? 'tab' : 'project',
        title: row.projectName,
        subtitle: compactProjectPath(row.projectPath),
        match,
        meta: row.isClosedTab ? 'Closed' : 'Open',
        projectId: row.projectId,
        tabId,
        isClosedTab: Boolean(row.isClosedTab)
      })
    }

    const tabRows = this.db
      .prepare(
        hasText
          ? `SELECT tabs.*, projects.path as projectPath
            FROM tabs
            LEFT JOIN projects ON projects.id = tabs.activeProjectId
            WHERE tabs.name LIKE ? ESCAPE '\\'
              AND tabs.activeProjectId IS NULL
            ORDER BY tabs.isClosed, tabs.lastUsedAt DESC, tabs.createdAt DESC
            LIMIT ?`
          : `SELECT tabs.*, projects.path as projectPath
            FROM tabs
            LEFT JOIN projects ON projects.id = tabs.activeProjectId
            WHERE tabs.activeProjectId IS NULL
            ORDER BY tabs.isClosed, tabs.lastUsedAt DESC, tabs.createdAt DESC
            LIMIT ?`
      )
      .all(...(hasText ? [like, candidateLimit] : [candidateLimit])) as Array<BoardTab & { projectPath: string | null }>

    for (const row of tabRows) {
      if (!matches(row.name)) continue
      candidates.push({
        id: `tab:${row.id}`,
        kind: 'tab',
        title: row.name,
        subtitle: row.projectPath ?? (row.isClosed ? 'Closed project' : 'Open project'),
        match: row.name,
        tabId: row.id,
        projectId: row.activeProjectId ?? undefined,
        isClosedTab: Boolean(row.isClosed)
      })
    }

    const taskRows = this.db
      .prepare(
        hasText
          ? `SELECT tasks.*, tabs.name as tabName, tabs.isClosed as isClosedTab, lanes.name as laneName, projects.name as projectName
            FROM tasks
            JOIN tabs ON tabs.id = tasks.tabId
            LEFT JOIN lanes ON lanes.id = tasks.laneId
            LEFT JOIN projects ON projects.id = tasks.projectId
            WHERE tasks.title LIKE ? ESCAPE '\\'
            ORDER BY tasks.updatedAt DESC
            LIMIT ?`
          : `SELECT tasks.*, tabs.name as tabName, tabs.isClosed as isClosedTab, lanes.name as laneName, projects.name as projectName
            FROM tasks
            JOIN tabs ON tabs.id = tasks.tabId
            LEFT JOIN lanes ON lanes.id = tasks.laneId
            LEFT JOIN projects ON projects.id = tasks.projectId
            ORDER BY tasks.updatedAt DESC
            LIMIT ?`
      )
      .all(...(hasText ? [like, candidateLimit] : [candidateLimit])) as Array<
      Task & { tabName: string; isClosedTab: number; laneName: string | null; projectName: string | null }
    >

    for (const row of taskRows) {
      if (!matches(row.title)) continue
      candidates.push({
        id: `task:${row.id}`,
        kind: 'task',
        title: row.title,
        subtitle: row.projectName ?? row.tabName,
        match: row.title,
        meta: [taskStatusLabel(row.status), row.laneName].filter(Boolean).join(' · '),
        taskStatus: row.status,
        taskId: row.id,
        tabId: row.tabId,
        projectId: row.projectId ?? undefined,
        isClosedTab: Boolean(row.isClosedTab)
      })
    }

    const promptRows = this.db
      .prepare(
        hasText
          ? `SELECT
              conversations.id,
              conversations.content,
              tasks.id as taskId,
              tasks.title as taskTitle,
              tasks.tabId,
              tasks.projectId,
              tabs.name as tabName,
              tabs.isClosed as isClosedTab,
              tasks.status as taskStatus,
              lanes.name as laneName,
              projects.name as projectName
            FROM conversations
            JOIN tasks ON tasks.id = conversations.taskId
            JOIN tabs ON tabs.id = tasks.tabId
            LEFT JOIN lanes ON lanes.id = tasks.laneId
            LEFT JOIN projects ON projects.id = tasks.projectId
            WHERE conversations.role = 'user'
              AND conversations.content LIKE ? ESCAPE '\\'
            ORDER BY conversations.createdAt DESC
            LIMIT ?`
          : `SELECT
              conversations.id,
              conversations.content,
              tasks.id as taskId,
              tasks.title as taskTitle,
              tasks.tabId,
              tasks.projectId,
              tabs.name as tabName,
              tabs.isClosed as isClosedTab,
              tasks.status as taskStatus,
              lanes.name as laneName,
              projects.name as projectName
            FROM conversations
            JOIN tasks ON tasks.id = conversations.taskId
            JOIN tabs ON tabs.id = tasks.tabId
            LEFT JOIN lanes ON lanes.id = tasks.laneId
            LEFT JOIN projects ON projects.id = tasks.projectId
            WHERE conversations.role = 'user'
            ORDER BY conversations.createdAt DESC
            LIMIT ?`
      )
      .all(...(hasText ? [like, candidateLimit] : [candidateLimit])) as Array<{
      id: string
      content: string
      taskId: string
      taskTitle: string
      tabId: string
      projectId: string | null
      tabName: string
      isClosedTab: number
      taskStatus: TaskStatus
      laneName: string | null
      projectName: string | null
    }>

    for (const row of promptRows) {
      if (!matches(row.content)) continue
      candidates.push({
        id: `prompt:${row.id}`,
        kind: 'prompt',
        title: row.taskTitle,
        subtitle: row.projectName ?? row.tabName,
        match: row.content,
        meta: [taskStatusLabel(row.taskStatus), row.laneName].filter(Boolean).join(' · '),
        taskStatus: row.taskStatus,
        taskId: row.taskId,
        tabId: row.tabId,
        projectId: row.projectId ?? undefined,
        isClosedTab: Boolean(row.isClosedTab)
      })
    }

    const seen = new Set<string>()
    return candidates
      .filter((candidate) => {
        const navigationKey = candidate.taskId
          ? `task:${candidate.taskId}`
          : candidate.tabId
            ? `tab:${candidate.tabId}`
            : candidate.projectId
              ? `project:${candidate.projectId}`
              : candidate.id
        if (seen.has(navigationKey)) return false
        seen.add(navigationKey)
        return true
      })
      .slice(0, limit)
  }

  recordSearchOpen(input: RecordSearchOpenInput): void {
    const result = input.result
    this.db
      .prepare(
        `INSERT INTO search_history
          (id, kind, title, subtitle, match, meta, tabId, taskId, projectId, isClosedTab, openedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          title = excluded.title,
          subtitle = excluded.subtitle,
          match = excluded.match,
          meta = excluded.meta,
          tabId = excluded.tabId,
          taskId = excluded.taskId,
          projectId = excluded.projectId,
          isClosedTab = excluded.isClosedTab,
          openedAt = excluded.openedAt`
      )
      .run(
        result.id,
        result.kind,
        result.title,
        result.subtitle,
        result.match,
        result.meta ?? '',
        result.tabId ?? null,
        result.taskId ?? null,
        result.projectId ?? null,
        result.isClosedTab ? 1 : 0,
        now()
      )
  }

  private getSearchHistory(limit: number): SearchResult[] {
    const rows = this.db
      .prepare('SELECT * FROM search_history ORDER BY openedAt DESC LIMIT ?')
      .all(limit) as Array<{
      id: string
      kind: SearchResult['kind']
      title: string
      subtitle: string
      match: string
      meta: string
      tabId: string | null
      taskId: string | null
      projectId: string | null
      isClosedTab: number
    }>

    const seen = new Set<string>()
    return rows
      .filter((row) => {
        const navigationKey = row.taskId
          ? `task:${row.taskId}`
          : row.tabId
            ? `tab:${row.tabId}`
            : row.projectId
              ? `project:${row.projectId}`
              : row.id
        if (seen.has(navigationKey)) return false
        seen.add(navigationKey)
        return true
      })
      .map((row) => ({
        id: row.tabId && !row.taskId ? `tab:${row.tabId}` : row.id,
        kind: row.tabId && !row.taskId ? 'tab' : row.kind,
        title: row.title,
        subtitle: row.subtitle,
        match: row.match,
        meta: row.meta,
        tabId: row.tabId ?? undefined,
        taskId: row.taskId ?? undefined,
        projectId: row.projectId ?? undefined,
        isClosedTab: Boolean(row.isClosedTab)
      }))
  }

  getTaskRunContext(taskId: string): { task: Task; project: Project | null; prompt: string; previousPrompts: string[] } | null {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task | undefined
    if (!task) return null

    const project = task.projectId
      ? (this.db.prepare('SELECT * FROM projects WHERE id = ?').get(task.projectId) as Project | undefined)
      : null
    const promptRows = this.db
      .prepare("SELECT content FROM conversations WHERE taskId = ? AND role = 'user' ORDER BY createdAt DESC LIMIT 3")
      .all(taskId) as Array<{ content: string }>
    const latestPrompt = promptRows[0]?.content

    return {
      task,
      project: project ?? null,
      prompt: latestPrompt || task.summary || task.title,
      previousPrompts: promptRows
        .slice(1)
        .map((row) => row.content.trim())
        .filter(Boolean)
        .reverse()
    }
  }

  listTasksForCleanup(input: { taskId?: string; laneId?: string; tabId?: string }): Array<{ task: Task; project: Project | null }> {
    let tasks: Task[] = []
    if (input.taskId) {
      const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.taskId) as Task | undefined
      tasks = task ? [task] : []
    } else if (input.laneId) {
      tasks = this.db.prepare('SELECT * FROM tasks WHERE laneId = ?').all(input.laneId) as Task[]
    } else if (input.tabId) {
      tasks = this.db.prepare('SELECT * FROM tasks WHERE tabId = ?').all(input.tabId) as Task[]
    }

    const projectCache = new Map<string, Project | null>()
    return tasks.map((task) => {
      if (!task.projectId) return { task, project: null }
      if (!projectCache.has(task.projectId)) {
        const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(task.projectId) as Project | undefined
        projectCache.set(task.projectId, project ? withPathState(project) : null)
      }
      return { task, project: projectCache.get(task.projectId) ?? null }
    })
  }

  getProject(projectId: string): Project | null {
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Project | undefined
    return project ? withPathState(project) : null
  }

  updateProjectRunMode(projectId: string, runMode: RunMode): void {
    const normalizedRunMode = normalizeRunMode(runMode)
    this.db.prepare('UPDATE projects SET runMode = ? WHERE id = ?').run(normalizedRunMode, projectId)
  }

  getRunningTaskCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'processing'").get() as {
      count: number
    }
    return row.count
  }

  async relocateProject(projectId: string): Promise<Project | null> {
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Project | undefined
    if (!project) return null

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: `Relocate ${project.name}`
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folderPath = result.filePaths[0]
    this.db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(folderPath, projectId)
    return withPathState({ ...project, path: folderPath })
  }

  appendConversation(taskId: string, role: ConversationEntry['role'], content: string): void {
    const timestamp = now()
    const transaction = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO conversations (id, taskId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)')
        .run(id(), taskId, role, content, timestamp)
      this.db.prepare('UPDATE tasks SET updatedAt = ? WHERE id = ?').run(timestamp, taskId)
    })
    transaction()
  }

  recoverInterruptedProcessingTasks(): number {
    const interrupted = this.db
      .prepare("SELECT id FROM tasks WHERE status = 'processing'")
      .all() as Array<{ id: string }>

    for (const task of interrupted) {
      this.updateTaskStatus({ taskId: task.id, status: 'attention' })
      this.appendConversation(
        task.id,
        'system',
        'This run was interrupted when VibeBoard closed or restarted. Progress so far is saved in this chat — open the task and hit Retry or Retry prompt to continue.'
      )
    }

    return interrupted.length
  }

  sendTaskMessage(input: SendTaskMessageInput): void {
    const content = input.content.trim()
    if (!content) return

    const transaction = this.db.transaction(() => {
      this.appendConversation(input.taskId, 'user', content)
      this.db.prepare('UPDATE tasks SET updatedAt = ? WHERE id = ?').run(now(), input.taskId)
    })

    transaction()
  }

  replaceCodeChanges(
    taskId: string,
    changes: Array<Pick<CodeChange, 'filePath' | 'summary' | 'changeType' | 'language' | 'diffText'>>
  ): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM code_changes WHERE taskId = ?').run(taskId)
      const insert = this.db.prepare(
        'INSERT INTO code_changes (id, taskId, filePath, summary, changeType, language, diffText, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      changes.forEach((change) => {
        insert.run(
          id(),
          taskId,
          change.filePath,
          change.summary,
          change.changeType,
          change.language,
          change.diffText,
          now()
        )
      })
    })

    transaction()
  }

  async createProject(input: CreateProjectInput): Promise<Project | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select project folder'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folderPath = result.filePaths[0]
    const existingProject = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(folderPath) as Project | undefined
    if (existingProject) {
      const existingTab = this.db
        .prepare('SELECT id, isClosed FROM tabs WHERE activeProjectId = ? ORDER BY createdAt LIMIT 1')
        .get(existingProject.id) as { id: string; isClosed: number } | undefined

      if (existingTab) {
        if (existingTab.isClosed) {
          this.reopenTab(existingTab.id)
        } else {
          this.setActiveTab(existingTab.id)
        }
      } else {
        this.createTab({ name: existingProject.name, projectId: existingProject.id })
      }

      return withPathState(existingProject)
    }

    const project: Project = {
      id: id(),
      name: input.name?.trim() || path.basename(folderPath),
      path: folderPath,
      runMode: 'worktree',
      pathMissing: false,
      createdAt: now()
    }

    this.db
      .prepare('INSERT INTO projects (id, name, path, runMode, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(project.id, project.name, project.path, project.runMode, project.createdAt)

    this.createTab({ name: project.name, projectId: project.id })
    return project
  }

  createTab(input: CreateTabInput): BoardTab {
    const createdAt = now()
    const tab: BoardTab = {
      id: id(),
      name: input.name.trim() || 'Project',
      activeProjectId: input.projectId ?? null,
      isPinned: 0,
      isClosed: 0,
      color: null,
      position: this.nextTabPosition(),
      createdAt,
      lastUsedAt: createdAt
    }

    const insertTab = this.db.prepare(
      'INSERT INTO tabs (id, name, activeProjectId, isPinned, isClosed, color, position, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const insertLane = this.db.prepare(
      'INSERT INTO lanes (id, tabId, name, position) VALUES (?, ?, ?, ?)'
    )

    const transaction = this.db.transaction(() => {
      insertTab.run(
        tab.id,
        tab.name,
        tab.activeProjectId,
        tab.isPinned,
        tab.isClosed,
        tab.color,
        tab.position,
        tab.createdAt,
        tab.lastUsedAt
      )
      ;['Backlog', 'Active', 'Review', 'Done'].forEach((name, position) => {
        insertLane.run(id(), tab.id, name, position)
      })
      this.setSetting('activeTabId', tab.id)
    })

    transaction()
    return tab
  }

  renameTab(input: RenameInput): void {
    this.db.prepare('UPDATE tabs SET name = ? WHERE id = ?').run(input.name.trim(), input.id)
  }

  updateTabMeta(input: UpdateTabMetaInput): void {
    if (input.isPinned !== undefined) {
      this.db.prepare('UPDATE tabs SET isPinned = ? WHERE id = ?').run(input.isPinned ? 1 : 0, input.id)
    }

    if (input.color !== undefined) {
      this.db.prepare('UPDATE tabs SET color = ? WHERE id = ?').run(input.color, input.id)
    }
  }

  reorderTabs(input: ReorderTabsInput): void {
    const updatePosition = this.db.prepare('UPDATE tabs SET position = ? WHERE id = ?')
    const transaction = this.db.transaction(() => {
      input.orderedIds.forEach((tabId, position) => {
        updatePosition.run(position, tabId)
      })
    })

    transaction()
  }

  closeTab(tabId: string): void {
    const tabs = this.db
      .prepare('SELECT id FROM tabs WHERE isClosed = 0 ORDER BY isPinned DESC, position, createdAt')
      .all() as Array<{ id: string }>

    const activeTabId = this.getSetting('activeTabId')
    const tabIndex = tabs.findIndex((tab) => tab.id === tabId)
    const fallbackTab = tabs[tabIndex + 1] ?? tabs[tabIndex - 1] ?? tabs.find((tab) => tab.id !== tabId)

    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE tabs SET isClosed = 1, lastUsedAt = ? WHERE id = ?').run(now(), tabId)
      if (activeTabId === tabId) {
        this.setSetting('activeTabId', fallbackTab?.id ?? '')
      }
    })

    transaction()
  }

  reopenTab(tabId: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE tabs SET isClosed = 0, lastUsedAt = ? WHERE id = ?').run(now(), tabId)
      this.setSetting('activeTabId', tabId)
    })

    transaction()
  }

  deleteTab(tabId: string): void {
    const tabs = this.db.prepare('SELECT id, isClosed FROM tabs ORDER BY isPinned DESC, position, createdAt').all() as Array<{
      id: string
      isClosed: number
    }>

    const targetTab = tabs.find((tab) => tab.id === tabId)
    const openTabs = tabs.filter((tab) => tab.isClosed === 0)
    if (!targetTab) {
      return
    }

    const activeTabId = this.getSetting('activeTabId')
    const fallbackTab = openTabs.find((tab) => tab.id !== tabId)
    const projectRow = this.db.prepare('SELECT activeProjectId FROM tabs WHERE id = ?').get(tabId) as
      | { activeProjectId: string | null }
      | undefined

    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM tabs WHERE id = ?').run(tabId)
      if (projectRow?.activeProjectId) {
        const remainingProjectTabs = this.db
          .prepare('SELECT COUNT(*) as count FROM tabs WHERE activeProjectId = ?')
          .get(projectRow.activeProjectId) as { count: number }
        if (remainingProjectTabs.count === 0) {
          this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectRow.activeProjectId)
        }
      }
      if (activeTabId === tabId) {
        this.setSetting('activeTabId', fallbackTab?.id ?? '')
      }
    })

    transaction()
  }

  setActiveTab(tabId: string): void {
    this.setSetting('activeTabId', tabId)
    this.db.prepare('UPDATE tabs SET lastUsedAt = ? WHERE id = ?').run(now(), tabId)
  }

  createLane(input: CreateLaneInput): Lane {
    const positionRow = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 as position FROM lanes WHERE tabId = ?')
      .get(input.tabId) as { position: number }
    const lane: Lane = {
      id: id(),
      tabId: input.tabId,
      name: input.name.trim() || 'Lane',
      position: positionRow.position
    }

    this.db
      .prepare('INSERT INTO lanes (id, tabId, name, position) VALUES (?, ?, ?, ?)')
      .run(lane.id, lane.tabId, lane.name, lane.position)
    return lane
  }

  renameLane(input: RenameInput): void {
    this.db.prepare('UPDATE lanes SET name = ? WHERE id = ?').run(input.name.trim(), input.id)
  }

  deleteLane(laneId: string): void {
    const lane = this.db.prepare('SELECT tabId FROM lanes WHERE id = ?').get(laneId) as
      | { tabId: string }
      | undefined
    if (!lane) return

    const laneCount = this.db
      .prepare('SELECT COUNT(*) as count FROM lanes WHERE tabId = ?')
      .get(lane.tabId) as { count: number }
    if (laneCount.count <= 1) {
      return
    }

    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM lanes WHERE id = ?').run(laneId)
      const remainingLanes = this.db
        .prepare('SELECT id FROM lanes WHERE tabId = ? ORDER BY position')
        .all(lane.tabId) as Array<{ id: string }>
      const updatePosition = this.db.prepare('UPDATE lanes SET position = ? WHERE id = ?')
      remainingLanes.forEach((item, position) => {
        updatePosition.run(position, item.id)
      })
    })

    transaction()
  }

  createTask(input: CreateTaskInput): Task {
    const tab = this.db.prepare('SELECT activeProjectId FROM tabs WHERE id = ?').get(input.tabId) as
      | { activeProjectId: string | null }
      | undefined
    const positionRow = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 as position FROM tasks WHERE laneId = ?')
      .get(input.laneId) as { position: number }
    const timestamp = now()
    const task: Task = {
      id: id(),
      tabId: input.tabId,
      laneId: input.laneId,
      projectId: tab?.activeProjectId ?? input.projectId,
      title: input.title.trim() || 'Untitled task',
      summary: input.prompt?.trim() ?? '',
      status: 'idle',
      runModeOverride: null,
      branchName: null,
      worktreePath: null,
      position: positionRow.position,
      createdAt: timestamp,
      updatedAt: timestamp
    }

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO tasks (id, tabId, laneId, projectId, title, summary, status, runModeOverride, branchName, worktreePath, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          task.id,
          task.tabId,
          task.laneId,
          task.projectId,
          task.title,
          task.summary,
          task.status,
          task.runModeOverride,
          task.branchName,
          task.worktreePath,
          task.position,
          task.createdAt,
          task.updatedAt
        )
    })

    transaction()
    return task
  }

  updateTaskRunWorkspace(input: { taskId: string; branchName: string | null; worktreePath: string | null }): void {
    this.db
      .prepare('UPDATE tasks SET branchName = ?, worktreePath = ?, updatedAt = ? WHERE id = ?')
      .run(input.branchName, input.worktreePath, now(), input.taskId)
  }

  moveTask(input: MoveTaskInput): void {
    const timestamp = now()
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.taskId) as Task | undefined
    if (!task) return

    const targetTasks = this.db
      .prepare('SELECT id FROM tasks WHERE laneId = ? AND id != ? ORDER BY position')
      .all(input.laneId, input.taskId) as Array<{ id: string }>
    const nextPosition = Math.max(0, Math.min(input.position, targetTasks.length))
    targetTasks.splice(nextPosition, 0, { id: input.taskId })

    const transaction = this.db.transaction(() => {
      this.db
        .prepare('UPDATE tasks SET laneId = ?, position = ?, updatedAt = ? WHERE id = ?')
        .run(input.laneId, nextPosition, timestamp, input.taskId)

      const updatePosition = this.db.prepare('UPDATE tasks SET position = ?, updatedAt = ? WHERE id = ?')
      targetTasks.forEach((item, position) => {
        updatePosition.run(position, timestamp, item.id)
      })

      if (task.laneId !== input.laneId) {
        const sourceTasks = this.db
          .prepare('SELECT id FROM tasks WHERE laneId = ? ORDER BY position')
          .all(task.laneId) as Array<{ id: string }>
        sourceTasks.forEach((item, position) => {
          updatePosition.run(position, timestamp, item.id)
        })
      }
    })

    transaction()
  }

  deleteTask(taskId: string): void {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task | undefined
    if (!task) return
    if (task.status === 'processing') return

    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
      const remainingTasks = this.db
        .prepare('SELECT id FROM tasks WHERE laneId = ? ORDER BY position')
        .all(task.laneId) as Array<{ id: string }>
      const timestamp = now()
      const updatePosition = this.db.prepare('UPDATE tasks SET position = ?, updatedAt = ? WHERE id = ?')
      remainingTasks.forEach((item, position) => {
        updatePosition.run(position, timestamp, item.id)
      })
    })

    transaction()
  }

  renameTask(input: RenameInput): void {
    const title = input.name.trim()
    if (!title) return

    this.db.prepare('UPDATE tasks SET title = ?, updatedAt = ? WHERE id = ?').run(title, now(), input.id)
  }

  updateTaskStatus(input: UpdateTaskStatusInput): void {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.taskId) as Task | undefined
    if (!task || task.status === input.status) return
    const timestamp = now()
    const targetLane = this.findStatusLane(task.tabId, input.status)

    const transaction = this.db.transaction(() => {
      if (targetLane && targetLane.id !== task.laneId) {
        const targetPosition = this.nextTaskPosition(targetLane.id)
        this.db
          .prepare('UPDATE tasks SET laneId = ?, position = ?, status = ?, updatedAt = ? WHERE id = ?')
          .run(targetLane.id, targetPosition, input.status, timestamp, input.taskId)
        this.reorderLaneTasks(task.laneId, timestamp)
      } else {
        this.db
          .prepare('UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?')
          .run(input.status, timestamp, input.taskId)
      }
    })

    transaction()
    this.taskStatusListener?.({
      task: { ...task, laneId: targetLane?.id ?? task.laneId, status: input.status, updatedAt: timestamp },
      oldStatus: task.status,
      newStatus: input.status
    })
  }

  markTaskRead(taskId: string): void {
    this.db
      .prepare("UPDATE tasks SET status = 'done_read', updatedAt = ? WHERE id = ? AND status = 'done_unread'")
      .run(now(), taskId)
  }

  private findStatusLane(tabId: string, status: TaskStatus): Lane | null {
    const lanes = this.getLanesForTab(tabId)
    const matchers = statusLaneMatchers[status]
    return lanes.find((lane) => matchers.some((matcher) => matcher.test(lane.name))) ?? null
  }

  private nextTaskPosition(laneId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 as position FROM tasks WHERE laneId = ?')
      .get(laneId) as { position: number }
    return row.position
  }

  private reorderLaneTasks(laneId: string, timestamp: string): void {
    const tasks = this.db
      .prepare('SELECT id FROM tasks WHERE laneId = ? ORDER BY position')
      .all(laneId) as Array<{ id: string }>
    const updatePosition = this.db.prepare('UPDATE tasks SET position = ?, updatedAt = ? WHERE id = ?')
    tasks.forEach((item, position) => {
      updatePosition.run(position, timestamp, item.id)
    })
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        runMode TEXT NOT NULL DEFAULT 'worktree',
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tabs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        activeProjectId TEXT,
        isPinned INTEGER NOT NULL DEFAULT 0,
        isClosed INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        lastUsedAt TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS lanes (
        id TEXT PRIMARY KEY,
        tabId TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        FOREIGN KEY (tabId) REFERENCES tabs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        tabId TEXT NOT NULL,
        laneId TEXT NOT NULL,
        projectId TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        runModeOverride TEXT,
        branchName TEXT,
        worktreePath TEXT,
        position INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (tabId) REFERENCES tabs(id) ON DELETE CASCADE,
        FOREIGN KEY (laneId) REFERENCES lanes(id) ON DELETE CASCADE,
        FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS code_changes (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        filePath TEXT NOT NULL,
        summary TEXT NOT NULL,
        changeType TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT '',
        diffText TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL,
        FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS search_history (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL,
        match TEXT NOT NULL,
        meta TEXT NOT NULL DEFAULT '',
        tabId TEXT,
        taskId TEXT,
        projectId TEXT,
        isClosedTab INTEGER NOT NULL DEFAULT 0,
        openedAt TEXT NOT NULL
      );
    `)
    this.ensureColumn('tabs', 'isPinned', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('tabs', 'isClosed', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('tabs', 'color', 'TEXT')
    this.ensureColumn('tabs', 'activeProjectId', 'TEXT')
    this.ensureColumn('tabs', 'position', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('tabs', 'lastUsedAt', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('projects', 'runMode', "TEXT NOT NULL DEFAULT 'worktree'")
    this.ensureColumn('tasks', 'runModeOverride', 'TEXT')
    this.ensureColumn('tasks', 'branchName', 'TEXT')
    this.ensureColumn('tasks', 'worktreePath', 'TEXT')
    this.ensureColumn('code_changes', 'language', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('code_changes', 'diffText', "TEXT NOT NULL DEFAULT ''")
    this.backfillTabLastUsedAt()
    this.backfillTabPositions()
    this.linkLegacyTabsToProjects()
    this.defaultProjectsToWorktree()
  }

  private defaultProjectsToWorktree(): void {
    if (this.getSetting('defaultedProjectsToWorktree')) return

    this.db.prepare("UPDATE projects SET runMode = 'worktree' WHERE runMode = 'shared'").run()
    this.setSetting('defaultedProjectsToWorktree', now())
  }

  private nextTabPosition(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as position FROM tabs').get() as {
      position: number
    }
    return row.position
  }

  private backfillTabPositions(): void {
    const positionedTabs = this.db.prepare('SELECT COUNT(*) as count FROM tabs WHERE position != 0').get() as {
      count: number
    }
    if (positionedTabs.count > 0) return

    const tabs = this.db.prepare('SELECT id FROM tabs ORDER BY createdAt').all() as Array<{ id: string }>
    const updatePosition = this.db.prepare('UPDATE tabs SET position = ? WHERE id = ?')
    const transaction = this.db.transaction(() => {
      tabs.forEach((tab, position) => {
        updatePosition.run(position, tab.id)
      })
    })

    transaction()
  }

  private backfillTabLastUsedAt(): void {
    this.db.prepare("UPDATE tabs SET lastUsedAt = createdAt WHERE lastUsedAt = ''").run()
  }

  private seed(): void {
    const tabCount = this.db.prepare('SELECT COUNT(*) as count FROM tabs').get() as { count: number }
    if (tabCount.count > 0) {
      return
    }

    const project: Project = {
      id: id(),
      name: 'VibeBoard',
      path: app.getAppPath(),
      runMode: 'worktree',
      pathMissing: false,
      createdAt: now()
    }
    this.db
      .prepare('INSERT INTO projects (id, name, path, runMode, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(project.id, project.name, project.path, project.runMode, project.createdAt)

    const productTab = this.createTab({ name: 'VibeBoard', projectId: project.id })
    this.updateTabMeta({ id: productTab.id, isPinned: true, color: '#ff7a1a' })
    const releaseTab = this.createTab({ name: 'Release', projectId: project.id })
    this.updateTabMeta({ id: releaseTab.id, color: '#9b8cff' })

    const productLanes = this.getLanesForTab(productTab.id)
    const releaseLanes = this.getLanesForTab(releaseTab.id)

    const runningTask = this.createTask({
      tabId: productTab.id,
      laneId: productLanes[1].id,
      projectId: project.id,
      title: 'Run Cursor in the background',
      prompt: 'Wire the task Run button so Cursor runs headlessly in the selected project folder and captured diffs appear on the right.'
    })
    this.updateTaskStatus({ taskId: runningTask.id, status: 'processing' })
    this.appendConversation(runningTask.id, 'system', 'Starting Cursor CLI agent in the project folder.')
    this.appendConversation(runningTask.id, 'assistant', 'Reading the task prompt and preparing a headless run.')

    const doneTask = this.createTask({
      tabId: productTab.id,
      laneId: productLanes[3].id,
      projectId: project.id,
      title: 'Render real code diffs',
      prompt: 'Replace the summary-only code changes card with actual unified diffs and language-aware formatting.'
    })
    this.updateTaskStatus({ taskId: doneTask.id, status: 'done_unread' })
    this.appendConversation(doneTask.id, 'assistant', 'Added a diff model and renderer for file-level changes.')
    this.replaceCodeChanges(doneTask.id, [
      {
        filePath: 'src/renderer/src/App.tsx',
        summary: '12 additions, 3 deletions',
        changeType: 'modified',
        language: 'typescript',
        diffText: `@@ -650,9 +650,13 @@ function TaskDetailModal({
-              {changes.map((change) => (
-                <div className="change-row">{change.summary}</div>
-              ))}
+              {changes.map((change) => (
+                <DiffViewer key={change.id} change={change} />
+              ))}
             </div>
           </section>
         </div>`
      },
      {
        filePath: 'src/renderer/src/styles.css',
        summary: '20 additions, 0 deletions',
        changeType: 'modified',
        language: 'css',
        diffText: `@@ -705,0 +706,20 @@
+.diff-file {
+  overflow: hidden;
+  border: 1px solid var(--line);
+  border-radius: 8px;
+  background: #151515;
+}
+
+.diff-line.added {
+  background: rgba(47, 207, 117, 0.12);
+}
+
+.diff-line.removed {
+  background: rgba(255, 95, 87, 0.12);
+}`
      }
    ])

    const attentionTask = this.createTask({
      tabId: productTab.id,
      laneId: productLanes[2].id,
      projectId: null,
      title: 'Select a project before running',
      prompt: 'Make the Run button explain what is missing when a task has no project selected.'
    })
    this.updateTaskStatus({ taskId: attentionTask.id, status: 'attention' })
    this.appendConversation(attentionTask.id, 'system', 'Select a project before running this task with Cursor.')

    this.createTask({
      tabId: productTab.id,
      laneId: productLanes[0].id,
      projectId: project.id,
      title: 'Add accept and discard controls',
      prompt: 'Design controls for accepting or discarding code changes from a completed task.'
    })

    this.createTask({
      tabId: releaseTab.id,
      laneId: releaseLanes[0].id,
      projectId: project.id,
      title: 'Write release notes',
      prompt: 'Generate concise release notes from completed VibeBoard tasks and changed files.'
    })

    this.createTask({
      tabId: releaseTab.id,
      laneId: releaseLanes[2].id,
      projectId: project.id,
      title: 'Check packaged installers',
      prompt: 'Run the local packaging checks and list the installer artifacts.'
    })

    this.setSetting('activeTabId', productTab.id)
  }

  private replaceOldDemoSeed(): void {
    const counts = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM projects) as projectCount,
          (SELECT COUNT(*) FROM tabs) as tabCount,
          (SELECT COUNT(*) FROM tasks) as taskCount`
      )
      .get() as { projectCount: number; tabCount: number; taskCount: number }
    const oldTask = this.db.prepare('SELECT title FROM tasks LIMIT 1').get() as { title: string } | undefined

    if (
      counts.projectCount === 0 &&
      counts.tabCount === 1 &&
      counts.taskCount === 1 &&
      oldTask?.title === 'Connect Cursor adapter'
    ) {
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM settings').run()
        this.db.prepare('DELETE FROM tabs').run()
        this.db.prepare('DELETE FROM projects').run()
      })()
    }
  }

  private getLanesForTab(tabId: string): Lane[] {
    return this.db.prepare('SELECT * FROM lanes WHERE tabId = ? ORDER BY position').all(tabId) as Lane[]
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
    }
  }

  private linkLegacyTabsToProjects(): void {
    this.db.exec(`
      UPDATE tabs
      SET activeProjectId = (
        SELECT projectId
        FROM tasks
        WHERE tasks.tabId = tabs.id
          AND projectId IS NOT NULL
        GROUP BY projectId
        ORDER BY COUNT(*) DESC
        LIMIT 1
      )
      WHERE activeProjectId IS NULL
        AND EXISTS (
          SELECT 1
          FROM tasks
          WHERE tasks.tabId = tabs.id
            AND projectId IS NOT NULL
        );

      UPDATE tasks
      SET projectId = (
        SELECT activeProjectId
        FROM tabs
        WHERE tabs.id = tasks.tabId
      )
      WHERE projectId IS NULL
        AND EXISTS (
          SELECT 1
          FROM tabs
          WHERE tabs.id = tasks.tabId
            AND activeProjectId IS NOT NULL
        );
    `)
  }

  private getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }
}
