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
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Download,
  ExternalLink,
  FolderPlus,
  History,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  Plus,
  Play,
  Pin,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  X
} from 'lucide-react'
import type {
  AppState,
  BoardTab,
  CodeChange,
  ConversationEntry,
  CursorStatus,
  Lane,
  Project,
  Task,
} from '../../shared/types'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)

const emptyState: AppState = {
  projects: [],
  tabs: [],
  closedTabs: [],
  lanes: [],
  tasks: [],
  conversations: [],
  changes: [],
  activeTabId: ''
}

const tabColors = ['#ff7a1a', '#f7c56b', '#2fcf75', '#42b883', '#9b8cff', '#ff5f57']
const emptyCursorStatus: CursorStatus = {
  available: false,
  label: 'Checking Cursor',
  debug: {
    cursorCommand: null,
    cursorAgentCommand: null,
    checkedCursorCommands: [],
    checkedCursorAgentCommands: [],
    installCommand: '',
    lastInstallOutput: '',
    processPath: '',
    shellPath: ''
  }
}

export function App(): ReactElement {
  const [state, setState] = useState<AppState>(emptyState)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [newTaskLaneId, setNewTaskLaneId] = useState<string | null>(null)
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null)
  const [cursorStatus, setCursorStatus] = useState<CursorStatus>(emptyCursorStatus)
  const [isInstallingCursorCli, setInstallingCursorCli] = useState(false)
  const [cursorFeedback, setCursorFeedback] = useState('')
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [deleteTabId, setDeleteTabId] = useState<string | null>(null)

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
  const activeLanes = useMemo(
    () => state.lanes.filter((lane) => lane.tabId === activeTab?.id).sort(byPosition),
    [state.lanes, activeTab?.id]
  )
  const activeTasks = useMemo(
    () => state.tasks.filter((task) => task.tabId === activeTab?.id),
    [state.tasks, activeTab?.id]
  )
  const activeBoardStats = useMemo(() => {
    const running = activeTasks.filter((task) => task.status === 'processing').length
    const attention = activeTasks.filter((task) => task.status === 'attention').length
    const done = activeTasks.filter((task) => task.status === 'done_read' || task.status === 'done_unread').length
    return { running, attention, done, total: activeTasks.length }
  }, [activeTasks])
  const tasksByProject = useMemo(() => {
    return state.tasks.reduce<Record<string, number>>((counts, task) => {
      if (!task.projectId) return counts
      counts[task.projectId] = (counts[task.projectId] ?? 0) + 1
      return counts
    }, {})
  }, [state.tasks])
  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId) ?? null
  const activeDragTask = state.tasks.find((task) => task.id === activeDragTaskId) ?? null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    refresh()
    refreshCursorStatus()
    return window.vibeboard.onStateChanged(() => {
      refresh()
    })
  }, [])

  const refreshCursorStatus = async (): Promise<void> => {
    const nextStatus = await window.vibeboard.getCursorAdapterStatus()
    setCursorStatus(nextStatus)
    setCursorFeedback(nextStatus.available ? 'Cursor CLI is ready.' : 'cursor-agent is still missing.')
  }

  const installCursorCli = async (): Promise<void> => {
    setInstallingCursorCli(true)
    setCursorFeedback('Installing Cursor CLI. This can take a minute.')
    try {
      const result = await window.vibeboard.installCursorCli()
      setCursorFeedback(result.message)
      const nextStatus = await window.vibeboard.getCursorAdapterStatus()
      setCursorStatus(nextStatus)
    } finally {
      setInstallingCursorCli(false)
    }
  }

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

  const closeTab = async (tabId: string): Promise<void> => {
    if (state.tabs.length <= 1) return
    await window.vibeboard.closeTab(tabId)
    await refresh()
  }

  const reopenTab = async (tabId: string): Promise<void> => {
    await window.vibeboard.reopenTab(tabId)
    await refresh()
  }

  const deleteTab = async (tabId: string): Promise<void> => {
    await window.vibeboard.deleteTab(tabId)
    setDeleteTabId(null)
    await refresh()
  }

  const updateTabMeta = async (input: { id: string; isPinned?: boolean; color?: string | null }): Promise<void> => {
    await window.vibeboard.updateTabMeta(input)
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

  const deleteLane = async (id: string): Promise<void> => {
    if (activeLanes.length <= 1) return
    await window.vibeboard.deleteLane(id)
    await refresh()
  }

  const createTask = async (input: NewTaskInput): Promise<void> => {
    if (!activeTab || !newTaskLaneId) return
    await window.vibeboard.createTask({
      tabId: activeTab.id,
      laneId: newTaskLaneId,
      projectId: input.projectId,
      title: input.title,
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

  const runTaskWithCursor = async (taskId: string): Promise<void> => {
    await window.vibeboard.runTaskWithCursor(taskId)
    await refresh()
  }

  const sendTaskMessage = async (taskId: string, content: string): Promise<void> => {
    await window.vibeboard.sendTaskMessage({ taskId, content })
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
        closedTabs={state.closedTabs}
        tasks={state.tasks}
        activeTabId={activeTab?.id}
        onCloseTab={closeTab}
        onCreateTab={createTab}
        onDeleteTab={(id) => setDeleteTabId(id)}
        onReopenTab={reopenTab}
        onSelectTab={setActiveTab}
        onUpdateTabMeta={updateTabMeta}
      />

      <main className={isSidebarCollapsed ? 'workspace sidebar-collapsed' : 'workspace'}>
        <aside className="sidebar">
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

          <button className="primary-action sidebar-project-button" type="button" onClick={createProject} title="Add project">
            <FolderPlus size={18} />
            <span>Add project</span>
          </button>

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

          <section className="panel project-panel">
            <div className="panel-title">
              <PanelsTopLeft size={16} />
              <span>Projects</span>
            </div>
            <div className="project-list">
              {state.projects.length === 0 ? (
                <div className="muted-line">Add a project folder</div>
              ) : (
                state.projects.map((project) => (
                  <ProjectRow key={project.id} project={project} taskCount={tasksByProject[project.id] ?? 0} />
                ))
              )}
            </div>
          </section>

          <section className="panel integration-panel">
            <div className="panel-title">
              <RadioTower size={16} />
              <span>Cursor</span>
            </div>
            <CursorConnection
              feedback={cursorFeedback}
              isInstalling={isInstallingCursorCli}
              status={cursorStatus}
              onInstallCli={installCursorCli}
              onOpenSetup={() => window.vibeboard.openCursorSetup()}
              onRefresh={refreshCursorStatus}
            />
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
                  onDeleteLane={deleteLane}
                  canDelete={activeLanes.length > 1}
                  onRenameLane={renameLane}
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
          onRunWithCursor={runTaskWithCursor}
          onSendMessage={sendTaskMessage}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {deleteTabId && (
        <DeleteTabModal
          tab={state.tabs.find((tab) => tab.id === deleteTabId) ?? state.closedTabs.find((tab) => tab.id === deleteTabId) ?? null}
          canDelete={
            Boolean(state.closedTabs.find((tab) => tab.id === deleteTabId)) ||
            (Boolean(state.tabs.find((tab) => tab.id === deleteTabId)) && state.tabs.length > 1)
          }
          onClose={() => setDeleteTabId(null)}
          onConfirm={() => deleteTab(deleteTabId)}
        />
      )}
    </div>
  )
}

function CursorConnection({
  feedback,
  isInstalling,
  status,
  onInstallCli,
  onOpenSetup,
  onRefresh
}: {
  feedback: string
  isInstalling: boolean
  status: CursorStatus
  onInstallCli: () => void
  onOpenSetup: () => void
  onRefresh: () => void
}): ReactElement {
  return (
    <div className={status.available ? 'cursor-card connected' : 'cursor-card missing'}>
      <div className="cursor-status-row">
        <div>
          <Code2 size={15} />
          <span>{status.available ? 'Connected' : 'Not connected'}</span>
        </div>
        <span className={status.available ? 'connection-pill connected' : 'connection-pill missing'}>
          {status.available ? 'Ready' : 'Missing'}
        </span>
      </div>
      <div className="cursor-actions">
        {!status.available && (
          <button className="primary-action setup-button" type="button" onClick={onInstallCli} disabled={isInstalling}>
            <Download size={15} />
            <span>{isInstalling ? 'Installing' : 'Install CLI'}</span>
          </button>
        )}
        <button className="secondary-action setup-button" type="button" onClick={onRefresh} disabled={isInstalling}>
          <RefreshCw size={15} />
          <span>Connect</span>
        </button>
        {!status.available && (
          <button className="secondary-action setup-button" type="button" onClick={onOpenSetup} disabled={isInstalling}>
            <ExternalLink size={15} />
            <span>Open Cursor</span>
          </button>
        )}
      </div>
      {feedback && <div className="cursor-feedback">{feedback}</div>}
      <div className="cursor-steps">
        {!status.available && (
          <ol>
            <li>Install CLI.</li>
            <li>Sign in if Cursor asks.</li>
            <li>Click Connect.</li>
          </ol>
        )}
      </div>
      {import.meta.env.DEV && <CursorDebugPanel status={status} />}
    </div>
  )
}

function CursorDebugPanel({ status }: { status: CursorStatus }): ReactElement {
  const debugLines = [
    ['cursor', status.debug.cursorCommand ?? 'not found'],
    ['cursor-agent', status.debug.cursorAgentCommand ?? 'not found'],
    ['install', status.debug.installCommand],
    ['checked cursor', status.debug.checkedCursorCommands.join('\n')],
    ['checked agent', status.debug.checkedCursorAgentCommands.join('\n')],
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
  tasks,
  activeTabId,
  onCloseTab,
  onCreateTab,
  onDeleteTab,
  onReopenTab,
  onSelectTab,
  onUpdateTabMeta
}: {
  tabs: BoardTab[]
  closedTabs: BoardTab[]
  tasks: Task[]
  activeTabId?: string
  onCloseTab: (id: string) => void
  onCreateTab: () => void
  onDeleteTab: (id: string) => void
  onReopenTab: (id: string) => void
  onSelectTab: (id: string) => void
  onUpdateTabMeta: (input: { id: string; isPinned?: boolean; color?: string | null }) => void
}): ReactElement {
  const [menuState, setMenuState] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [closedMenuOpen, setClosedMenuOpen] = useState(false)
  const menuTab = tabs.find((tab) => tab.id === menuState?.tabId) ?? null

  useEffect(() => {
    if (!menuState && !closedMenuOpen) return
    const close = (): void => {
      setMenuState(null)
      setClosedMenuOpen(false)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuState, closedMenuOpen])

  return (
    <div className="tabs-bar">
      <div className="tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab status-${tabStatus(tab.id, tasks)} ${tab.id === activeTabId ? 'active' : ''}`}
            style={
              {
                '--tab-color': tab.color ?? 'transparent',
                '--tab-tint': tab.color ? hexToRgba(tab.color, tab.id === activeTabId ? 0.24 : 0.14) : '#202020'
              } as React.CSSProperties
            }
            title={tab.name}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenuState({ tabId: tab.id, x: event.clientX, y: event.clientY })
            }}
          >
            <button className="tab-select" type="button" onClick={() => onSelectTab(tab.id)}>
              {tab.isPinned ? <Pin size={12} /> : null}
              <span className="tab-status-dot" aria-hidden="true" />
              <span>{tab.name}</span>
            </button>
            {tabs.length > 1 && (
              <button
                className="tab-close"
                type="button"
                title="Close board"
                onClick={(event) => {
                  event.stopPropagation()
                  onCloseTab(tab.id)
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="icon-button" type="button" onClick={onCreateTab} title="New board">
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
            title="Closed boards"
          >
            <History size={17} />
          </button>
          {closedMenuOpen && (
            <div className="closed-tabs-menu">
              <div className="closed-tabs-head">
                <span>Closed boards</span>
                <small>{closedTabs.length}</small>
              </div>
              {closedTabs.map((tab) => (
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
                    <RotateCcw size={14} />
                    <span>{tab.name}</span>
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
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
            {menuTab.isPinned ? 'Unpin tab' : 'Pin tab'}
          </button>
          <div className="tab-menu-label">Color</div>
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
          {tabs.length > 1 && (
            <button
              type="button"
              onClick={() => {
                onCloseTab(menuTab.id)
                setMenuState(null)
              }}
            >
              Close tab
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onDeleteTab(menuTab.id)
              setMenuState(null)
            }}
          >
            Delete tab
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

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel compact confirm-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <h2>Delete tab</h2>
            <p>{tab?.name ?? 'Board'}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="confirm-body">
          <p>Permanent delete removes this board, its lanes, tasks, chat, and code changes.</p>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="confirm"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'Enter' && isConfirmed && canDelete) onConfirm()
            }}
          />
        </div>
        <footer className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="danger-action" type="button" disabled={!isConfirmed || !canDelete} onClick={onConfirm}>
            Delete
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

function ProjectRow({ project, taskCount }: { project: Project; taskCount: number }): ReactElement {
  return (
    <div className="project-row" title={project.path}>
      <div className="project-row-head">
        <span>{project.name}</span>
        <small>{taskCount}</small>
      </div>
      <small>{compactPath(project.path)}</small>
    </div>
  )
}

function LaneColumn({
  lane,
  tasks,
  projects,
  onOpenTask,
  onAddTask,
  onDeleteLane,
  canDelete,
  onRenameLane
}: {
  lane: Lane
  tasks: Task[]
  projects: Project[]
  onOpenTask: (task: Task) => void
  onAddTask: () => void
  onDeleteLane: (id: string) => void
  canDelete: boolean
  onRenameLane: (id: string, name: string) => void
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
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              project={projects.find((project) => project.id === task.projectId) ?? null}
              onOpen={() => onOpenTask(task)}
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
  onOpen
}: {
  task: Task
  project: Project | null
  onOpen: () => void
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
      {...attributes}
      {...listeners}
    >
      <button className="task-open" type="button" onClick={onOpen}>
        <div className="task-title-row">
          <h3>{task.title}</h3>
          {task.status === 'attention' && <AlertTriangle size={16} />}
          {(task.status === 'done_unread' || task.status === 'done_read') && <Check size={16} />}
        </div>
        {task.summary && <p>{task.summary}</p>}
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
      {task.summary && <p>{task.summary}</p>}
      <small>{project?.name ?? 'No project'}</small>
    </article>
  )
}

interface NewTaskInput {
  projectId: string | null
  title: string
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
  const [prompt, setPrompt] = useState('')
  const [projectId, setProjectId] = useState<string | null>(projects[0]?.id ?? null)

  return (
    <div className="modal-backdrop">
      <form
        className="task-form modal-panel compact"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit({ projectId, title, prompt })
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
          <span>Prompt</span>
          <textarea
            className="fixed-prompt-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
          />
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
  onRunWithCursor,
  onSendMessage,
  onClose
}: {
  task: Task
  project: Project | null
  conversations: ConversationEntry[]
  changes: CodeChange[]
  onRunWithCursor: (taskId: string) => void
  onSendMessage: (taskId: string, content: string) => void
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
          <div className="modal-head-actions">
            <button
              className="icon-text-button"
              type="button"
              onClick={() => onRunWithCursor(task.id)}
              disabled={!project || task.status === 'processing'}
              title={!project ? 'Select a project first' : 'Run with Cursor'}
            >
              <Play size={16} />
              <span>{task.status === 'processing' ? 'Running' : 'Run'}</span>
            </button>
            <button className="icon-button" type="button" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="detail-grid">
          <section className="detail-column">
            <div className="section-title">
              <MessageSquare size={16} />
              <span>Prompt</span>
            </div>
            <CodexThread conversations={conversations} task={task} onSendMessage={onSendMessage} />
          </section>

          <section className="detail-column">
            <div className="section-title">
              <Code2 size={16} />
              <span>Code changes</span>
            </div>
            {changes.length > 0 && <ChangeSummary changes={changes} />}
            <div className="change-list">
              {changes.length === 0 ? (
                <div className="empty-panel">No changes captured</div>
              ) : (
                changes.map((change) => <DiffViewer key={change.id} change={change} />)
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}

function CodexThread({
  conversations,
  task,
  onSendMessage
}: {
  conversations: ConversationEntry[]
  task: Task
  onSendMessage: (taskId: string, content: string) => void
}): ReactElement {
  const [draft, setDraft] = useState('')
  const userEntries = conversations.filter((entry) => entry.role === 'user')
  const prompt = userEntries[0]?.content || task.summary || task.title
  const threadEntries = conversations.filter((entry) => entry.id !== userEntries[0]?.id)

  const send = (): void => {
    const content = draft.trim()
    if (!content) return
    onSendMessage(task.id, content)
    setDraft('')
  }

  return (
    <div className="codex-thread">
      <section className="prompt-panel">
        <p>{prompt}</p>
      </section>

      <div className="agent-stream">
        {threadEntries.length === 0 ? (
          <div className="agent-step">
            <Code2 size={16} />
            <div>
              <strong>Agent workspace</strong>
              <p>{task.status === 'processing' ? 'Working on this task' : task.summary}</p>
            </div>
          </div>
        ) : (
          threadEntries.map((entry) => (
            <div key={entry.id} className={entry.role === 'user' ? 'agent-step user-step' : 'agent-step'}>
              {entry.role === 'user' ? <MessageSquare size={16} /> : <Code2 size={16} />}
              <div>
                <strong>{entry.role === 'user' ? 'You' : entry.role === 'assistant' ? 'Agent' : 'System'}</strong>
                <p>{entry.content}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="thread-composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder="Message"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button className="icon-button" type="button" onClick={send} disabled={!draft.trim()} title="Send">
          <Send size={16} />
        </button>
      </div>
    </div>
  )
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
  const diffText = change.diffText.trim() || fallbackDiff(change)
  const lines = diffText.split('\n')

  return (
    <article className="diff-file">
      <header className="diff-file-header">
        <div>
          <span className={`change-type ${change.changeType}`}>{change.changeType}</span>
          <strong>{change.filePath}</strong>
        </div>
        <span>{change.language || languageFromPath(change.filePath)}</span>
      </header>
      <div className="diff-table" role="table" aria-label={`${change.filePath} diff`}>
        <div className="diff-rows">
          {lines.map((line, index) => {
            const kind = diffLineKind(line)
            const displayLine = kind === 'hunk' ? line : line.slice(1)
            const language = normalizeLanguage(change.language || languageFromPath(change.filePath))

            return (
              <div key={`${index}-${line}`} className={`diff-line ${kind}`} role="row">
                <span className="diff-gutter">{kind === 'context' ? ' ' : line[0]}</span>
                <span className="diff-number">{kind === 'hunk' ? '' : index + 1}</span>
                <code
                  dangerouslySetInnerHTML={{
                    __html: kind === 'hunk' ? escapeHtml(displayLine) : highlightCode(displayLine, language)
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
    css: 'css',
    html: 'xml',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    mjs: 'javascript',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'tsx',
    xml: 'xml'
  }
  return extension ? languageMap[extension] || '' : ''
}

function normalizeLanguage(language: string): string {
  return language === 'ts' ? 'typescript' : language
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

function tabStatus(tabId: string, tasks: Task[]): Task['status'] {
  const tabTasks = tasks.filter((task) => task.tabId === tabId)
  if (tabTasks.some((task) => task.status === 'attention')) return 'attention'
  if (tabTasks.some((task) => task.status === 'processing')) return 'processing'
  if (tabTasks.some((task) => task.status === 'done_unread')) return 'done_unread'
  if (tabTasks.length > 0 && tabTasks.every((task) => task.status === 'done_read')) return 'done_read'
  return 'idle'
}

function byPosition<T extends { position: number }>(a: T, b: T): number {
  return a.position - b.position
}
