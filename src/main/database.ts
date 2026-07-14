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
  SendTaskMessageInput,
  Task,
  TaskStatus,
  UpdateTabMetaInput,
  UpdateTaskStatusInput
} from '../shared/types'

const now = (): string => new Date().toISOString()
const id = (): string => crypto.randomUUID()

export class VibeBoardStore {
  private db: Database.Database

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'vibeboard.sqlite')
    this.db = new Database(dbPath)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = WAL')
    this.migrate()
    this.replaceOldDemoSeed()
    this.seed()
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
      .get() as { id: string }
    const activeTabId = savedActiveTab?.id ?? fallbackTab.id

    return {
      projects: this.db.prepare('SELECT * FROM projects ORDER BY createdAt DESC').all() as Project[],
      tabs: this.db
        .prepare('SELECT * FROM tabs WHERE isClosed = 0 ORDER BY isPinned DESC, createdAt')
        .all() as BoardTab[],
      closedTabs: this.db
        .prepare('SELECT * FROM tabs WHERE isClosed = 1 ORDER BY createdAt DESC')
        .all() as BoardTab[],
      lanes: this.db.prepare('SELECT * FROM lanes ORDER BY position').all() as Lane[],
      tasks: this.db.prepare('SELECT * FROM tasks ORDER BY position').all() as Task[],
      conversations: this.db
        .prepare('SELECT * FROM conversations ORDER BY createdAt')
        .all() as ConversationEntry[],
      changes: this.db.prepare('SELECT * FROM code_changes ORDER BY createdAt').all() as CodeChange[],
      activeTabId
    }
  }

  getTaskRunContext(taskId: string): { task: Task; project: Project | null; prompt: string } | null {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task | undefined
    if (!task) return null

    const project = task.projectId
      ? (this.db.prepare('SELECT * FROM projects WHERE id = ?').get(task.projectId) as Project | undefined)
      : null
    const promptRow = this.db
      .prepare("SELECT content FROM conversations WHERE taskId = ? AND role = 'user' ORDER BY createdAt DESC LIMIT 1")
      .get(taskId) as { content: string } | undefined

    return {
      task,
      project: project ?? null,
      prompt: promptRow?.content || task.summary || task.title
    }
  }

  appendConversation(taskId: string, role: ConversationEntry['role'], content: string): void {
    this.db
      .prepare('INSERT INTO conversations (id, taskId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(id(), taskId, role, content, now())
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

      return existingProject
    }

    const project: Project = {
      id: id(),
      name: input.name?.trim() || path.basename(folderPath),
      path: folderPath,
      createdAt: now()
    }

    this.db
      .prepare('INSERT INTO projects (id, name, path, createdAt) VALUES (?, ?, ?, ?)')
      .run(project.id, project.name, project.path, project.createdAt)

    this.createTab({ name: project.name, projectId: project.id })
    return project
  }

  createTab(input: CreateTabInput): BoardTab {
    const tab: BoardTab = {
      id: id(),
      name: input.name.trim() || 'Project',
      activeProjectId: input.projectId ?? null,
      isPinned: 0,
      isClosed: 0,
      color: null,
      createdAt: now()
    }

    const insertTab = this.db.prepare(
      'INSERT INTO tabs (id, name, activeProjectId, isPinned, isClosed, color, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const insertLane = this.db.prepare(
      'INSERT INTO lanes (id, tabId, name, position) VALUES (?, ?, ?, ?)'
    )

    const transaction = this.db.transaction(() => {
      insertTab.run(tab.id, tab.name, tab.activeProjectId, tab.isPinned, tab.isClosed, tab.color, tab.createdAt)
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

  closeTab(tabId: string): void {
    const tabs = this.db
      .prepare('SELECT id FROM tabs WHERE isClosed = 0 ORDER BY isPinned DESC, createdAt')
      .all() as Array<{ id: string }>
    if (tabs.length <= 1) {
      return
    }

    const activeTabId = this.getSetting('activeTabId')
    const tabIndex = tabs.findIndex((tab) => tab.id === tabId)
    const fallbackTab = tabs[tabIndex + 1] ?? tabs[tabIndex - 1] ?? tabs.find((tab) => tab.id !== tabId)

    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE tabs SET isClosed = 1 WHERE id = ?').run(tabId)
      if (activeTabId === tabId && fallbackTab) {
        this.setSetting('activeTabId', fallbackTab.id)
      }
    })

    transaction()
  }

  reopenTab(tabId: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE tabs SET isClosed = 0 WHERE id = ?').run(tabId)
      this.setSetting('activeTabId', tabId)
    })

    transaction()
  }

  deleteTab(tabId: string): void {
    const tabs = this.db.prepare('SELECT id, isClosed FROM tabs ORDER BY isPinned DESC, createdAt').all() as Array<{
      id: string
      isClosed: number
    }>
    if (tabs.length <= 1) {
      return
    }

    const targetTab = tabs.find((tab) => tab.id === tabId)
    const openTabs = tabs.filter((tab) => tab.isClosed === 0)
    if (!targetTab || (targetTab.isClosed === 0 && openTabs.length <= 1)) {
      return
    }

    const activeTabId = this.getSetting('activeTabId')
    const fallbackTab = tabs.find((tab) => tab.id !== tabId && tab.isClosed === 0)
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
      if (activeTabId === tabId && fallbackTab) {
        this.setSetting('activeTabId', fallbackTab.id)
      }
    })

    transaction()
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
      position: positionRow.position,
      createdAt: timestamp,
      updatedAt: timestamp
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
        isPinned INTEGER NOT NULL DEFAULT 0,
        isClosed INTEGER NOT NULL DEFAULT 0,
        color TEXT,
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
        language TEXT NOT NULL DEFAULT '',
        diffText TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL,
        FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
      );
    `)
    this.ensureColumn('tabs', 'isPinned', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('tabs', 'isClosed', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('tabs', 'color', 'TEXT')
    this.ensureColumn('tabs', 'activeProjectId', 'TEXT')
    this.ensureColumn('code_changes', 'language', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('code_changes', 'diffText', "TEXT NOT NULL DEFAULT ''")
    this.linkLegacyTabsToProjects()
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
      createdAt: now()
    }
    this.db
      .prepare('INSERT INTO projects (id, name, path, createdAt) VALUES (?, ?, ?, ?)')
      .run(project.id, project.name, project.path, project.createdAt)

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
