import { app, dialog } from 'electron'
import Database from 'better-sqlite3'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  AppState,
  BoardTab,
  CodeChange,
  ConversationEntry,
  CreateLaneInput,
  CreateProjectInput,
  CreateTabInput,
  CreateTaskInput,
  Lane,
  MoveTaskInput,
  Project,
  RenameInput,
  Task,
  TaskStatus,
  UpdateTaskStatusInput
} from '../shared/types'

const now = (): string => new Date().toISOString()
const id = (): string => crypto.randomUUID()

export class VibeBoardStore {
  private db: Database.Database

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'vibeboard.sqlite')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
    this.seed()
  }

  getState(): AppState {
    const activeTabId =
      this.getSetting('activeTabId') ??
      (this.db.prepare('SELECT id FROM tabs ORDER BY createdAt LIMIT 1').get() as { id: string }).id

    return {
      projects: this.db.prepare('SELECT * FROM projects ORDER BY createdAt DESC').all() as Project[],
      tabs: this.db.prepare('SELECT * FROM tabs ORDER BY createdAt').all() as BoardTab[],
      lanes: this.db.prepare('SELECT * FROM lanes ORDER BY position').all() as Lane[],
      tasks: this.db.prepare('SELECT * FROM tasks ORDER BY position').all() as Task[],
      conversations: this.db
        .prepare('SELECT * FROM conversations ORDER BY createdAt')
        .all() as ConversationEntry[],
      changes: this.db.prepare('SELECT * FROM code_changes ORDER BY createdAt').all() as CodeChange[],
      activeTabId
    }
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
    const project: Project = {
      id: id(),
      name: input.name?.trim() || path.basename(folderPath),
      path: folderPath,
      createdAt: now()
    }

    this.db
      .prepare('INSERT INTO projects (id, name, path, createdAt) VALUES (?, ?, ?, ?)')
      .run(project.id, project.name, project.path, project.createdAt)

    return project
  }

  createTab(input: CreateTabInput): BoardTab {
    const tab: BoardTab = {
      id: id(),
      name: input.name.trim() || 'Board',
      activeProjectId: null,
      createdAt: now()
    }

    const insertTab = this.db.prepare(
      'INSERT INTO tabs (id, name, activeProjectId, createdAt) VALUES (?, ?, ?, ?)'
    )
    const insertLane = this.db.prepare(
      'INSERT INTO lanes (id, tabId, name, position) VALUES (?, ?, ?, ?)'
    )

    const transaction = this.db.transaction(() => {
      insertTab.run(tab.id, tab.name, tab.activeProjectId, tab.createdAt)
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

  setActiveTab(tabId: string): void {
    this.setSetting('activeTabId', tabId)
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

  createTask(input: CreateTaskInput): Task {
    const positionRow = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 as position FROM tasks WHERE laneId = ?')
      .get(input.laneId) as { position: number }
    const timestamp = now()
    const task: Task = {
      id: id(),
      tabId: input.tabId,
      laneId: input.laneId,
      projectId: input.projectId,
      title: input.title.trim() || 'Untitled task',
      summary: input.summary.trim(),
      status: 'idle',
      position: positionRow.position,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const conversation: ConversationEntry = {
      id: id(),
      taskId: task.id,
      role: 'user',
      content: input.prompt.trim() || input.summary.trim() || task.title,
      createdAt: timestamp
    }

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO tasks (id, tabId, laneId, projectId, title, summary, status, position, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          task.id,
          task.tabId,
          task.laneId,
          task.projectId,
          task.title,
          task.summary,
          task.status,
          task.position,
          task.createdAt,
          task.updatedAt
        )
      this.db
        .prepare(
          'INSERT INTO conversations (id, taskId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)'
        )
        .run(conversation.id, conversation.taskId, conversation.role, conversation.content, conversation.createdAt)
    })

    transaction()
    return task
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

  updateTaskStatus(input: UpdateTaskStatusInput): void {
    this.db
      .prepare('UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?')
      .run(input.status, now(), input.taskId)
  }

  markTaskRead(taskId: string): void {
    this.db
      .prepare("UPDATE tasks SET status = 'done_read', updatedAt = ? WHERE id = ? AND status = 'done_unread'")
      .run(now(), taskId)
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
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tabs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        activeProjectId TEXT,
        createdAt TEXT NOT NULL
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
        createdAt TEXT NOT NULL,
        FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
      );
    `)
  }

  private seed(): void {
    const tabCount = this.db.prepare('SELECT COUNT(*) as count FROM tabs').get() as { count: number }
    if (tabCount.count > 0) {
      return
    }

    const tab = this.createTab({ name: 'Main Board' })
    const backlog = this.db
      .prepare('SELECT id FROM lanes WHERE tabId = ? ORDER BY position LIMIT 1')
      .get(tab.id) as { id: string }
    const task = this.createTask({
      tabId: tab.id,
      laneId: backlog.id,
      projectId: null,
      title: 'Connect Cursor adapter',
      summary: 'Placeholder task for the future Cursor control layer.',
      prompt: 'Prepare the adapter boundary for Cursor MCP, CLI, or ACP support.'
    })
    this.db
      .prepare(
        'INSERT INTO code_changes (id, taskId, filePath, summary, changeType, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        id(),
        task.id,
        'src/main/cursorAdapter.ts',
        'Adapter interface is ready for a concrete Cursor integration.',
        'added',
        now()
      )
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
