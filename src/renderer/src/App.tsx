import { ReactElement, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
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
import {
  AlertTriangle,
  Check,
  Code2,
  FolderPlus,
  GripVertical,
  LayoutDashboard,
  MessageSquare,
  PanelsTopLeft,
  Plus,
  X
} from 'lucide-react'
import type {
  AppState,
  BoardTab,
  CodeChange,
  ConversationEntry,
  Lane,
  Project,
  Task,
  TaskStatus
} from '../../shared/types'

const emptyState: AppState = {
  projects: [],
  tabs: [],
  lanes: [],
  tasks: [],
  conversations: [],
  changes: [],
  activeTabId: ''
}

const statusOptions: Array<{ value: TaskStatus; label: string }> = [
  { value: 'idle', label: 'Idle' },
  { value: 'processing', label: 'Processing' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'done_unread', label: 'Done' },
  { value: 'done_read', label: 'Read' }
]

export function App(): ReactElement {
  const [state, setState] = useState<AppState>(emptyState)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [newTaskLaneId, setNewTaskLaneId] = useState<string | null>(null)
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null)
  const [cursorLabel, setCursorLabel] = useState('Cursor adapter ready')

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
  const activeLanes = useMemo(
    () => state.lanes.filter((lane) => lane.tabId === activeTab?.id).sort(byPosition),
    [state.lanes, activeTab?.id]
  )
  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId) ?? null
  const activeDragTask = state.tasks.find((task) => task.id === activeDragTaskId) ?? null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    refresh()
    window.vibeboard.getCursorAdapterStatus().then((status) => setCursorLabel(status.label))
  }, [])

  const refresh = async (): Promise<void> => {
    setState(await window.vibeboard.getState())
  }

  const createProject = async (): Promise<void> => {
    await window.vibeboard.createProject({})
    await refresh()
  }

  const createTab = async (): Promise<void> => {
    await window.vibeboard.createTab({ name: `Board ${state.tabs.length + 1}` })
    await refresh()
  }

  const setActiveTab = async (tabId: string): Promise<void> => {
    await window.vibeboard.setActiveTab(tabId)
    await refresh()
  }

  const createLane = async (): Promise<void> => {
    if (!activeTab) return
    await window.vibeboard.createLane({ tabId: activeTab.id, name: 'New lane' })
    await refresh()
  }

  const renameActiveTab = async (name: string): Promise<void> => {
    if (!activeTab || !name.trim()) return
    await window.vibeboard.renameTab({ id: activeTab.id, name })
    await refresh()
  }

  const renameLane = async (id: string, name: string): Promise<void> => {
    if (!name.trim()) return
    await window.vibeboard.renameLane({ id, name })
    await refresh()
  }

  const createTask = async (input: NewTaskInput): Promise<void> => {
    if (!activeTab || !newTaskLaneId) return
    await window.vibeboard.createTask({
      tabId: activeTab.id,
      laneId: newTaskLaneId,
      projectId: input.projectId,
      title: input.title,
      summary: input.summary,
      prompt: input.prompt
    })
    setNewTaskLaneId(null)
    await refresh()
  }

  const openTask = async (task: Task): Promise<void> => {
    setSelectedTaskId(task.id)
    if (task.status === 'done_unread') {
      await window.vibeboard.markTaskRead(task.id)
      await refresh()
    }
  }

  const updateTaskStatus = async (taskId: string, status: TaskStatus): Promise<void> => {
    await window.vibeboard.updateTaskStatus({ taskId, status })
    await refresh()
  }

  const onDragStart = (event: DragStartEvent): void => {
    setActiveDragTaskId(String(event.active.id))
  }

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    const { active, over } = event
    setActiveDragTaskId(null)
    if (!over) return

    const task = state.tasks.find((item) => item.id === active.id)
    if (!task) return

    const overTask = state.tasks.find((item) => item.id === over.id)
    const overLane = state.lanes.find((lane) => lane.id === over.id)
    const targetLaneId = overTask?.laneId ?? overLane?.id
    if (!targetLaneId) return

    const laneTasks = state.tasks.filter((item) => item.laneId === targetLaneId && item.id !== task.id)
    const targetIndex = overTask ? laneTasks.findIndex((item) => item.id === overTask.id) : laneTasks.length
    await window.vibeboard.moveTask({
      taskId: task.id,
      laneId: targetLaneId,
      position: targetIndex < 0 ? laneTasks.length : targetIndex
    })
    await refresh()
  }

  return (
    <div className="app-shell">
      <TopBar
        tabs={state.tabs}
        activeTabId={activeTab?.id}
        onCreateTab={createTab}
        onSelectTab={setActiveTab}
      />

      <main className="workspace">
        <aside className="sidebar">
          <div className="brand">
            <LayoutDashboard size={22} />
            <span>VibeBoard</span>
          </div>

          <button className="primary-action" type="button" onClick={createProject}>
            <FolderPlus size={18} />
            <span>Project</span>
          </button>

          <section className="panel">
            <div className="panel-title">
              <PanelsTopLeft size={16} />
              <span>Projects</span>
            </div>
            <div className="project-list">
              {state.projects.length === 0 ? (
                <div className="muted-line">No projects</div>
              ) : (
                state.projects.map((project) => <ProjectRow key={project.id} project={project} />)
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <Code2 size={16} />
              <span>Integration</span>
            </div>
            <div className="adapter-row">
              <span>{cursorLabel}</span>
            </div>
          </section>
        </aside>

        <section className="board-area">
          <header className="board-header">
            <div>
              <EditableTitle
                className="board-title-input"
                value={activeTab?.name ?? 'Main Board'}
                onCommit={renameActiveTab}
              />
              <p>{activeLanes.length} lanes</p>
            </div>
            <button className="icon-text-button" type="button" onClick={createLane}>
              <Plus size={17} />
              <span>Lane</span>
            </button>
          </header>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragCancel={() => setActiveDragTaskId(null)}
            onDragEnd={onDragEnd}
          >
            <div className={activeDragTaskId ? 'lane-grid dragging-card' : 'lane-grid'}>
              {activeLanes.map((lane) => (
                <LaneColumn
                  key={lane.id}
                  lane={lane}
                  tasks={state.tasks.filter((task) => task.laneId === lane.id).sort(byPosition)}
                  projects={state.projects}
                  onOpenTask={openTask}
                  onAddTask={() => setNewTaskLaneId(lane.id)}
                  onRenameLane={renameLane}
                  onStatusChange={updateTaskStatus}
                />
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeDragTask ? (
                <TaskCardPreview
                  task={activeDragTask}
                  project={state.projects.find((project) => project.id === activeDragTask.projectId) ?? null}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </section>
      </main>

      {newTaskLaneId && (
        <TaskFormModal
          projects={state.projects}
          onClose={() => setNewTaskLaneId(null)}
          onSubmit={createTask}
        />
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          project={state.projects.find((project) => project.id === selectedTask.projectId) ?? null}
          conversations={state.conversations.filter((entry) => entry.taskId === selectedTask.id)}
          changes={state.changes.filter((change) => change.taskId === selectedTask.id)}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  )
}

function TopBar({
  tabs,
  activeTabId,
  onCreateTab,
  onSelectTab
}: {
  tabs: BoardTab[]
  activeTabId?: string
  onCreateTab: () => void
  onSelectTab: (id: string) => void
}): ReactElement {
  return (
    <div className="tabs-bar">
      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === activeTabId ? 'tab active' : 'tab'}
            type="button"
            onClick={() => onSelectTab(tab.id)}
            title={tab.name}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <button className="icon-button" type="button" onClick={onCreateTab} title="New board">
        <Plus size={17} />
      </button>
    </div>
  )
}

function ProjectRow({ project }: { project: Project }): ReactElement {
  return (
    <div className="project-row" title={project.path}>
      <span>{project.name}</span>
      <small>{project.path}</small>
    </div>
  )
}

function LaneColumn({
  lane,
  tasks,
  projects,
  onOpenTask,
  onAddTask,
  onRenameLane,
  onStatusChange
}: {
  lane: Lane
  tasks: Task[]
  projects: Project[]
  onOpenTask: (task: Task) => void
  onAddTask: () => void
  onRenameLane: (id: string, name: string) => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
}): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id })

  return (
    <section className={isOver ? 'lane over' : 'lane'} ref={setNodeRef}>
      <header className="lane-header">
        <EditableTitle
          className="lane-title-input"
          value={lane.name}
          onCommit={(name) => onRenameLane(lane.id, name)}
        />
        <span>{tasks.length}</span>
      </header>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              project={projects.find((project) => project.id === task.projectId) ?? null}
              onOpen={() => onOpenTask(task)}
              onStatusChange={onStatusChange}
            />
          ))}
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
  project,
  onOpen,
  onStatusChange
}: {
  task: Task
  project: Project | null
  onOpen: () => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
}): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id
  })
  const style = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition
  }

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-card status-${task.status} ${isDragging ? 'dragging' : ''}`}
    >
      <div className="task-card-head">
        <button className="drag-handle" type="button" title="Drag task" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </button>
        <select
          className="status-select"
          value={task.status}
          onChange={(event) => onStatusChange(task.id, event.target.value as TaskStatus)}
          aria-label="Task status"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button className="task-open" type="button" onClick={onOpen}>
        <div className="task-title-row">
          <h3>{task.title}</h3>
          {task.status === 'attention' && <AlertTriangle size={16} />}
          {(task.status === 'done_unread' || task.status === 'done_read') && <Check size={16} />}
        </div>
        <p>{task.summary}</p>
        <small>{project?.name ?? 'No project'}</small>
      </button>
    </article>
  )
}

function TaskCardPreview({ task, project }: { task: Task; project: Project | null }): ReactElement {
  return (
    <article className={`task-card drag-preview status-${task.status}`}>
      <div className="task-title-row">
        <h3>{task.title}</h3>
        {task.status === 'attention' && <AlertTriangle size={16} />}
        {(task.status === 'done_unread' || task.status === 'done_read') && <Check size={16} />}
      </div>
      <p>{task.summary}</p>
      <small>{project?.name ?? 'No project'}</small>
    </article>
  )
}

interface NewTaskInput {
  projectId: string | null
  title: string
  summary: string
  prompt: string
}

function TaskFormModal({
  projects,
  onClose,
  onSubmit
}: {
  projects: Project[]
  onClose: () => void
  onSubmit: (input: NewTaskInput) => void
}): ReactElement {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [prompt, setPrompt] = useState('')
  const [projectId, setProjectId] = useState<string | null>(projects[0]?.id ?? null)

  return (
    <div className="modal-backdrop">
      <form
        className="task-form modal-panel compact"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit({ projectId, title, summary, prompt })
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
          <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </label>

        <label>
          <span>Project</span>
          <select value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value || null)}>
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Summary</span>
          <input value={summary} onChange={(event) => setSummary(event.target.value)} />
        </label>

        <label>
          <span>Prompt</span>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} />
        </label>

        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-action" type="submit">
            <Plus size={18} />
            <span>Create</span>
          </button>
        </div>
      </form>
    </div>
  )
}

function TaskDetailModal({
  task,
  project,
  conversations,
  changes,
  onClose
}: {
  task: Task
  project: Project | null
  conversations: ConversationEntry[]
  changes: CodeChange[]
  onClose: () => void
}): ReactElement {
  return (
    <div className="modal-backdrop">
      <section className="modal-panel task-detail">
        <div className="modal-head">
          <div>
            <h2>{task.title}</h2>
            <p>{project?.name ?? 'No project'}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="detail-grid">
          <section className="detail-column">
            <div className="section-title">
              <MessageSquare size={16} />
              <span>Conversation</span>
            </div>
            <div className="conversation-list">
              {conversations.map((entry) => (
                <div key={entry.id} className={`message ${entry.role}`}>
                  <strong>{entry.role}</strong>
                  <p>{entry.content}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-column">
            <div className="section-title">
              <Code2 size={16} />
              <span>Code changes</span>
            </div>
            <div className="change-list">
              {changes.length === 0 ? (
                <div className="empty-panel">No changes captured</div>
              ) : (
                changes.map((change) => (
                  <div key={change.id} className="change-row">
                    <span className={`change-type ${change.changeType}`}>{change.changeType}</span>
                    <strong>{change.filePath}</strong>
                    <p>{change.summary}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}

function byPosition<T extends { position: number }>(a: T, b: T): number {
  return a.position - b.position
}
