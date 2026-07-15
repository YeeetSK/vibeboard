import { ReactElement, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
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
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Download,
  Ellipsis,
  ExternalLink,
  FolderPlus,
  FolderOpen,
  History,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Pin,
  RadioTower,
  RotateCcw,
  Search,
  Send,
  Trash2,
  X
} from 'lucide-react'
import type {
  AppState,
  BoardTab,
  CodeChange,
  ConversationEntry,
  CursorSetupPhase,
  CursorStatus,
  Lane,
  Project,
  QuitRequest,
  SearchResult,
  Task,
  TaskDetail,
  UpdateInfo,
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
  activeTabId: ''
}

const emptyTaskDetail: TaskDetail = {
  conversations: [],
  changes: [],
  hasOlderConversations: false
}
const conversationPageSize = 5

const tabColors = ['#ff7a1a', '#f7c56b', '#2fcf75', '#42b883', '#9b8cff', '#ff5f57']
const platformClass = navigator.userAgent.includes('Mac')
  ? 'platform-mac'
  : navigator.userAgent.includes('Windows')
    ? 'platform-windows'
    : 'platform-linux'
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
const emptyUpdateInfo: UpdateInfo = {
  status: 'idle',
  currentVersion: '0.0.0',
  latestVersion: null,
  message: 'Ready to check for updates.',
  progress: null,
  releaseUrl: null
}

export function App(): ReactElement {
  const [state, setState] = useState<AppState>(emptyState)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [newTaskLaneId, setNewTaskLaneId] = useState<string | null>(null)
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null)
  const [dragPreviewTarget, setDragPreviewTarget] = useState<{ laneId: string; position: number } | null>(null)
  const [cursorStatus, setCursorStatus] = useState<CursorStatus>(emptyCursorStatus)
  const [isInstallingCursorCli, setInstallingCursorCli] = useState(false)
  const [cursorSetupPhase, setCursorSetupPhase] = useState<CursorSetupPhase>('checking')
  const [cursorFeedback, setCursorFeedback] = useState('')
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [deleteTabId, setDeleteTabId] = useState<string | null>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  const [quitRequest, setQuitRequest] = useState<QuitRequest | null>(null)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchResults, setGlobalSearchResults] = useState<SearchResult[]>([])
  const [isGlobalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>(emptyUpdateInfo)
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskDetail>(emptyTaskDetail)
  const [isLoadingOlderConversations, setLoadingOlderConversations] = useState(false)

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
  const activeProject = activeTab?.activeProjectId
    ? state.projects.find((project) => project.id === activeTab.activeProjectId) ?? null
    : null
  const openProjectLabel =
    navigator.userAgent.includes('Windows') ? 'Explorer' : navigator.userAgent.includes('Mac') ? 'Finder' : 'Folder'
  const activeLanes = useMemo(
    () => state.lanes.filter((lane) => lane.tabId === activeTab?.id).sort(byPosition),
    [state.lanes, activeTab?.id]
  )
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
  const tabStatuses = useMemo(() => buildTabStatusMap(state.tasks), [state.tasks])
  const activeBoardStats = useMemo(() => {
    const running = activeTasks.filter((task) => task.status === 'processing').length
    const attention = activeTasks.filter((task) => task.status === 'attention').length
    const done = activeTasks.filter((task) => task.status === 'done_read' || task.status === 'done_unread').length
    return { running, attention, done, total: activeTasks.length }
  }, [activeTasks])
  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId) ?? null
  const activeDragTask = state.tasks.find((task) => task.id === activeDragTaskId) ?? null

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
    window.vibeboard.getUpdateInfo().then(setUpdateInfo)
    return () => {
      stopStateListener()
      stopQuitListener()
      stopUpdateListener()
    }
  }, [])

  useEffect(() => {
    if (cursorSetupPhase !== 'failed') return
    const intervalId = window.setInterval(() => {
      if (document.hidden) return
      refreshCursorStatus({ quiet: true })
    }, 15000)
    return () => window.clearInterval(intervalId)
  }, [cursorSetupPhase])

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
    let cancelled = false

    if (!selectedTask) {
      setSelectedTaskDetail(emptyTaskDetail)
      setLoadingOlderConversations(false)
      return
    }

    window.vibeboard
      .getTaskDetail({ taskId: selectedTask.id, limit: conversationPageSize, includeChanges: true })
      .then((detail) => {
        if (!cancelled) {
          setSelectedTaskDetail((current) => {
            const isSameTask = current.conversations.every((entry) => entry.taskId === selectedTask.id)
            if (!isSameTask) return detail
            return {
              conversations: mergeConversationEntries(current.conversations, detail.conversations),
              changes: detail.changes,
              hasOlderConversations: current.hasOlderConversations || detail.hasOlderConversations
            }
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedTask?.id, selectedTask?.status, selectedTask?.updatedAt])

  const loadOlderSelectedTaskConversations = async (): Promise<void> => {
    if (!selectedTask || !selectedTaskDetail.hasOlderConversations || isLoadingOlderConversations) return
    const oldestConversation = selectedTaskDetail.conversations[0]
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

  const prepareCursorOnLaunch = async (): Promise<void> => {
    const nextStatus = await window.vibeboard.getCursorAdapterStatus()
    setCursorStatus(nextStatus)
    if (nextStatus.available) {
      setCursorSetupPhase('ready')
      setCursorFeedback('')
      return
    }
    if (nextStatus.debug.agentCommand) {
      setCursorSetupPhase('failed')
      setCursorFeedback('Cursor Agent needs login.')
      return
    }

    setCursorSetupPhase('preparing')
    setCursorFeedback('')
    const result = await window.vibeboard.installCursorCli()
    const statusAfterInstall = await window.vibeboard.getCursorAdapterStatus()
    setCursorStatus(statusAfterInstall)
    if (statusAfterInstall.available) {
      setCursorSetupPhase('ready')
      setCursorFeedback('')
      return
    }

    setCursorSetupPhase('failed')
    setCursorFeedback(result.message || 'Cursor CLI setup needs attention.')
  }

  const refreshCursorStatus = async (options: { quiet?: boolean } = {}): Promise<void> => {
    const nextStatus = await window.vibeboard.getCursorAdapterStatus()
    setCursorStatus(nextStatus)
    if (nextStatus.available) {
      setCursorSetupPhase('ready')
      setCursorFeedback('')
      return
    }

    setCursorSetupPhase('failed')
    if (!options.quiet) {
      setCursorFeedback(nextStatus.debug.agentCommand ? 'Cursor Agent needs login.' : 'Cursor Agent is missing.')
    }
  }

  const openCursorRepair = async (): Promise<void> => {
    setInstallingCursorCli(true)
    setCursorFeedback('Terminal install opened. VibeBoard will recheck automatically.')
    try {
      await window.vibeboard.openCursorInstallTerminal()
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
    await createProject()
  }

  const closeTab = async (tabId: string): Promise<void> => {
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

  const reorderTabs = async (orderedIds: string[]): Promise<void> => {
    await window.vibeboard.reorderTabs({ orderedIds })
    await refresh()
  }

  const setActiveTab = async (tabId: string): Promise<void> => {
    await window.vibeboard.setActiveTab(tabId)
    await refresh()
  }

  const openSearchResult = async (result: SearchResult): Promise<void> => {
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
  }

  const createLane = async (): Promise<void> => {
    if (!activeTab) return
    await window.vibeboard.createLane({ tabId: activeTab.id, name: 'New lane' })
    await refresh()
  }

  const openActiveProjectFolder = async (): Promise<void> => {
    if (!activeProject || activeProject.pathMissing) return
    await window.vibeboard.openProjectFolder(activeProject.id)
  }

  const relocateActiveProject = async (): Promise<void> => {
    if (!activeProject) return
    await window.vibeboard.relocateProject(activeProject.id)
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

  const deleteTask = async (id: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === id)
    if (task?.status === 'processing') return
    if (selectedTaskId === id) {
      setSelectedTaskId(null)
    }
    setDeleteTaskId(null)
    await window.vibeboard.deleteTask(id)
    await refresh()
  }

  const finishTask = async (id: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === id)
    if (task?.status === 'processing') return
    await window.vibeboard.updateTaskStatus({ taskId: id, status: 'done_unread' })
    await refresh()
  }

  const createTask = async (input: NewTaskInput): Promise<void> => {
    if (!activeTab || !newTaskLaneId) return
    await window.vibeboard.createTask({
      tabId: activeTab.id,
      laneId: newTaskLaneId,
      projectId: activeProject?.id ?? null,
      title: input.title
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

  const sendTaskMessage = async (taskId: string, content: string): Promise<void> => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (!cursorStatus.available || !task?.projectId) return
    await window.vibeboard.sendTaskMessage({ taskId, content })
    await refresh()
  }

  const cancelQuit = async (): Promise<void> => {
    setQuitRequest(null)
    await window.vibeboard.cancelQuit()
  }

  const confirmQuit = async (): Promise<void> => {
    await window.vibeboard.confirmQuit()
  }

  const downloadUpdate = async (): Promise<void> => {
    setUpdateInfo(await window.vibeboard.downloadUpdate())
  }

  const installUpdate = async (): Promise<void> => {
    await window.vibeboard.installUpdate()
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
        if (selectedTaskId) {
          event.preventDefault()
          setSelectedTaskId(null)
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
  }, [activeTab, deleteTabId, deleteTaskId, isGlobalSearchOpen, newTaskLaneId, quitRequest, selectedTaskId, state.tabs])

  const onDragStart = (event: DragStartEvent): void => {
    setActiveDragTaskId(String(event.active.id))
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
    setActiveDragTaskId(null)
    setDragPreviewTarget(null)

    const target = getTaskDropTarget(event)
    if (!target) return

    const task = state.tasks.find((item) => item.id === event.active.id)
    if (!task) return

    await window.vibeboard.moveTask({
      taskId: task.id,
      laneId: target.laneId,
      position: target.position
    })
    await refresh()
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

          <GlobalSearchLauncher onOpen={() => setGlobalSearchOpen(true)} />

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

          <section className="panel integration-panel">
            {cursorSetupPhase === 'failed' && (
              <>
                <div className="panel-title">
                  <RadioTower size={16} />
                  <span>Cursor</span>
                </div>
                <CursorConnection
                  feedback={cursorFeedback}
                  isInstalling={isInstallingCursorCli}
                  status={cursorStatus}
                  onRepair={openCursorRepair}
                />
              </>
            )}
          </section>

          <UpdatePanel
            info={updateInfo}
            onDownload={downloadUpdate}
            onInstall={installUpdate}
          />
        </aside>

        <section className="board-area">
          {activeTab ? (
            <>
              <header className="board-header">
                <div>
                  <EditableTitle
                    className="board-title-input"
                    value={activeTab.name}
                    onCommit={renameActiveTab}
                  />
                </div>
                <div className="board-header-actions">
                  <button
                    className="icon-text-button"
                    type="button"
                    onClick={openActiveProjectFolder}
                    disabled={!activeProject || activeProject.pathMissing}
                    title={`Open in ${openProjectLabel}`}
                  >
                    <FolderOpen size={17} />
                    <span>{openProjectLabel}</span>
                  </button>
                  {activeProject?.pathMissing && (
                    <button
                      className="icon-text-button needs-attention"
                      type="button"
                      onClick={relocateActiveProject}
                      title="Relocate project folder"
                    >
                      <FolderOpen size={17} />
                      <span>Relocate</span>
                    </button>
                  )}
                  <button className="icon-text-button" type="button" onClick={createLane}>
                    <Plus size={17} />
                    <span>Lane</span>
                  </button>
                </div>
              </header>

              <DndContext
                sensors={sensors}
                collisionDetection={taskCollisionDetection}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragCancel={() => {
                  setActiveDragTaskId(null)
                  setDragPreviewTarget(null)
                }}
                onDragEnd={onDragEnd}
              >
                <div
                  className={activeDragTaskId ? 'lane-grid dragging-card' : 'lane-grid'}
                  style={{ '--lane-count': Math.min(activeLanes.length, 4) } as React.CSSProperties}
                >
                  {activeLanes.map((lane) => (
                    <LaneColumn
                      key={lane.id}
                      lane={lane}
                      tasks={tasksByLaneId.get(lane.id) ?? []}
                      activeDragTaskId={activeDragTaskId}
                      dropPreviewPosition={dragPreviewTarget?.laneId === lane.id ? dragPreviewTarget.position : null}
                      onOpenTask={openTask}
                      onAddTask={() => setNewTaskLaneId(lane.id)}
                      onDeleteLane={deleteLane}
                      onDeleteTask={setDeleteTaskId}
                      onFinishTask={finishTask}
                      canDelete={activeLanes.length > 1}
                      onRenameLane={renameLane}
                    />
                  ))}
                </div>
                <DragOverlay dropAnimation={null}>
                  {activeDragTask ? (
                    <TaskCardPreview task={activeDragTask} />
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
          project={state.projects.find((project) => project.id === selectedTask.projectId) ?? null}
          conversations={selectedTaskDetail.conversations}
          changes={selectedTaskDetail.changes}
          hasOlderConversations={selectedTaskDetail.hasOlderConversations}
          isLoadingOlderConversations={isLoadingOlderConversations}
          canUseCursor={cursorStatus.available}
          onLoadOlderConversations={loadOlderSelectedTaskConversations}
          onSendMessage={sendTaskMessage}
          onClose={() => setSelectedTaskId(null)}
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
    </div>
  )
}

function EmptyBoard({
  closedTabs,
  projects,
  onCreateProject,
  onDeleteTab,
  onReopenTab
}: {
  closedTabs: BoardTab[]
  projects: Project[]
  onCreateProject: () => void
  onDeleteTab: (id: string) => void
  onReopenTab: (id: string) => void
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
          <button className="primary-action" type="button" onClick={onCreateProject}>
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
    <button className="global-search-launcher" type="button" onClick={onOpen} title="Search">
      <Search size={16} />
      <span>Search</span>
      <kbd>{navigator.userAgent.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
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

function CursorConnection({
  feedback,
  isInstalling,
  status,
  onRepair
}: {
  feedback: string
  isInstalling: boolean
  status: CursorStatus
  onRepair: () => void
}): ReactElement {
  const hasAgent = Boolean(status.debug.agentCommand)
  return (
    <div className="cursor-card missing">
      <div className="cursor-status-row">
        <div>
          <Code2 size={15} />
          <span>Needs setup</span>
        </div>
        <span className="connection-pill missing">{hasAgent ? 'Login' : 'Missing'}</span>
      </div>
      <div className="cursor-actions">
        <button className="primary-action setup-button" type="button" onClick={onRepair} disabled={isInstalling}>
          <ExternalLink size={15} />
          <span>{isInstalling ? 'Opening' : hasAgent ? 'Login in Terminal' : 'Fix in Terminal'}</span>
        </button>
      </div>
      {feedback && <div className="cursor-feedback">{feedback}</div>}
      {import.meta.env.DEV && <CursorDebugPanel status={status} />}
    </div>
  )
}

function UpdatePanel({
  info,
  onDownload,
  onInstall
}: {
  info: UpdateInfo
  onDownload: () => void
  onInstall: () => void
}): ReactElement {
  const isVisible = info.status === 'available' || info.status === 'downloading' || info.status === 'downloaded'
  if (!isVisible) return <></>

  const isBusy = info.status === 'checking' || info.status === 'downloading'
  const canDownload = info.status === 'available'
  const canInstall = info.status === 'downloaded'
  const buttonLabel = canInstall ? 'Restart' : canDownload ? 'Update' : 'Downloading'
  const buttonAction = canInstall ? onInstall : onDownload
  const tone =
    info.status === 'available' || info.status === 'downloaded'
      ? 'ready'
      : info.status === 'error'
        ? 'error'
        : 'idle'

  return (
    <section className={`panel update-panel ${tone}`}>
      <div className="panel-title">
        <Download size={16} />
        <span>Updates</span>
      </div>
      <div className="update-card">
        <div className="update-copy">
          <strong>{info.latestVersion ? `v${info.latestVersion}` : `v${info.currentVersion}`}</strong>
          <span>{info.message}</span>
        </div>
        {info.status === 'downloading' && (
          <div className="update-progress" aria-label={`Download ${info.progress ?? 0}%`}>
            <span style={{ width: `${info.progress ?? 0}%` }} />
          </div>
        )}
        <button className="primary-action setup-button" type="button" onClick={buttonAction} disabled={isBusy}>
          {canInstall ? <Check size={15} /> : <Download size={15} />}
          <span>{buttonLabel}</span>
        </button>
      </div>
    </section>
  )
}

function CursorDebugPanel({ status }: { status: CursorStatus }): ReactElement {
  const debugLines = [
    ['cursor', status.debug.cursorCommand ?? 'not found'],
    ['agent', status.debug.agentCommand ?? 'not found'],
    ['auth', status.debug.authStatus],
    ['install', status.debug.installCommand],
    ['checked cursor', status.debug.checkedCursorCommands.join('\n')],
    ['checked agent', status.debug.checkedAgentCommands.join('\n')],
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
  projects,
  tabStatuses,
  activeTabId,
  onCloseTab,
  onCreateTab,
  onDeleteTab,
  onReopenTab,
  onReorderTabs,
  onSelectTab,
  onUpdateTabMeta
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
}): ReactElement {
  const [menuState, setMenuState] = useState<{ tabId: string; x: number; y: number } | null>(null)
  const [closedMenuOpen, setClosedMenuOpen] = useState(false)
  const [closedSearch, setClosedSearch] = useState('')
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const menuTab = tabs.find((tab) => tab.id === menuState?.tabId) ?? null
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
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

  const moveTab = (draggedId: string, targetId: string): void => {
    if (draggedId === targetId) return
    const draggedIndex = tabs.findIndex((tab) => tab.id === draggedId)
    const targetIndex = tabs.findIndex((tab) => tab.id === targetId)
    if (draggedIndex < 0 || targetIndex < 0) return

    const nextTabs = [...tabs]
    const [draggedTab] = nextTabs.splice(draggedIndex, 1)
    nextTabs.splice(targetIndex, 0, draggedTab)
    onReorderTabs(nextTabs.map((tab) => tab.id))
  }

  const handleTabDragStart = (event: ReactDragEvent<HTMLDivElement>, tabId: string): void => {
    setDraggedTabId(tabId)
    setDragOverTabId(null)
    setMenuState(null)
    setClosedMenuOpen(false)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tabId)
  }

  const handleTabDragOver = (event: ReactDragEvent<HTMLDivElement>, tabId: string): void => {
    if (!draggedTabId || draggedTabId === tabId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverTabId(tabId)
  }

  const handleTabDrop = (event: ReactDragEvent<HTMLDivElement>, tabId: string): void => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData('text/plain') || draggedTabId
    if (draggedId) {
      moveTab(draggedId, tabId)
    }
    setDraggedTabId(null)
    setDragOverTabId(null)
  }

  const clearTabDrag = (): void => {
    setDraggedTabId(null)
    setDragOverTabId(null)
  }

  return (
    <div className="tabs-bar">
      <div className="tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            draggable
            className={`tab status-${tabStatuses.get(tab.id) ?? 'idle'} ${tab.id === activeTabId ? 'active' : ''} ${
              draggedTabId === tab.id ? 'dragging' : ''
            } ${dragOverTabId === tab.id ? 'drag-over' : ''}`}
            style={
              {
                '--tab-bg': tab.color ? hexToRgba(tab.color, tab.id === activeTabId ? 0.24 : 0.14) : '#202020'
              } as React.CSSProperties
            }
            title={tab.name}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenuState({ tabId: tab.id, x: event.clientX, y: event.clientY })
            }}
            onDragStart={(event) => handleTabDragStart(event, tab.id)}
            onDragOver={(event) => handleTabDragOver(event, tab.id)}
            onDrop={(event) => handleTabDrop(event, tab.id)}
            onDragEnd={clearTabDrag}
          >
            <button className="tab-select" type="button" onClick={() => onSelectTab(tab.id)}>
              {tab.isPinned ? <Pin size={12} /> : null}
              <span className="tab-status-dot" aria-hidden="true" />
              <span>{tab.name}</span>
            </button>
            <button
              className="tab-close"
              type="button"
              title="Close project"
              onClick={(event) => {
                event.stopPropagation()
                onCloseTab(tab.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tabs-actions">
        <button className="icon-button" type="button" onClick={onCreateTab} title="Add project">
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
                  <span>Closed projects</span>
                  <small>{closedTabs.length}</small>
                </div>
                <label className="closed-tabs-search">
                  <Search size={14} />
                  <input
                    value={closedSearch}
                    onChange={(event) => setClosedSearch(event.target.value)}
                    placeholder="Search recent projects"
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
                            <RotateCcw size={15} />
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
                          <Trash2 size={15} />
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
            <span className="key-hint">Enter</span>
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

function DeleteTaskModal({
  task,
  onClose,
  onConfirm
}: {
  task: Task | null
  onClose: () => void
  onConfirm: () => void
}): ReactElement {
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
          <p>This removes the task, its chat, and captured code changes.</p>
        </div>
        <footer className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose} autoFocus>
            Cancel
            <span className="key-hint">Esc</span>
          </button>
          <button className="danger-action" type="button" onClick={onConfirm}>
            Delete
            <span className="key-hint">Enter</span>
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
            <span className="key-hint">Enter</span>
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

function LaneColumn({
  lane,
  tasks,
  activeDragTaskId,
  dropPreviewPosition,
  onOpenTask,
  onAddTask,
  onDeleteLane,
  onDeleteTask,
  onFinishTask,
  canDelete,
  onRenameLane
}: {
  lane: Lane
  tasks: Task[]
  activeDragTaskId: string | null
  dropPreviewPosition: number | null
  onOpenTask: (task: Task) => void
  onAddTask: () => void
  onDeleteLane: (id: string) => void
  onDeleteTask: (id: string) => void
  onFinishTask: (id: string) => void
  canDelete: boolean
  onRenameLane: (id: string, name: string) => void
}): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id })
  let visibleTaskIndex = 0

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
  onOpen,
  onDelete,
  onFinish
}: {
  task: Task
  onOpen: () => void
  onDelete: () => void
  onFinish: () => void
}): ReactElement {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const cardRef = useRef<HTMLElement | null>(null)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id
  })
  const style = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition
  }
  const canMutate = task.status !== 'processing'
  const canFinish = canMutate && task.status !== 'done_unread' && task.status !== 'done_read'

  useEffect(() => {
    if (!isMenuOpen) return

    const closeOnOutsideClick = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (cardRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsMenuOpen(false)
    }

    window.addEventListener('pointerdown', closeOnOutsideClick, true)
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick, true)
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [isMenuOpen])

  return (
    <article
      ref={(element) => {
        setNodeRef(element)
        cardRef.current = element
      }}
      style={style}
      className={`task-card status-${task.status} ${isDragging ? 'dragging' : ''} ${isMenuOpen ? 'menu-open' : ''}`}
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="task-open">
        <div className="task-title-row">
          <h3>{task.title}</h3>
          <TaskStatusChip status={task.status} />
        </div>
        {task.summary && <p>{task.summary}</p>}
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
              setIsMenuOpen((value) => !value)
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Ellipsis size={15} />
          </button>
          {isMenuOpen && (
            <div className="task-action-menu" role="menu" onPointerDown={(event) => event.stopPropagation()}>
              {canFinish && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation()
                    setIsMenuOpen(false)
                    onFinish()
                  }}
                >
                  <Check size={15} />
                  <span>Finish task</span>
                </button>
              )}
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  setIsMenuOpen(false)
                  onDelete()
                }}
              >
                <Trash2 size={15} />
                <span>Delete task</span>
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function TaskCardPreview({ task }: { task: Task }): ReactElement {
  return (
    <article className={`task-card drag-preview status-${task.status}`}>
      <div className="task-title-row">
        <h3>{task.title}</h3>
        <TaskStatusChip status={task.status} />
      </div>
      {task.summary && <p>{task.summary}</p>}
    </article>
  )
}

function TaskDropPreview(): ReactElement {
  return <div className="task-drop-preview" aria-hidden="true" />
}

function TaskStatusChip({ status }: { status: Task['status'] }): ReactElement | null {
  if (status === 'attention') {
    return (
      <span className="task-status-chip attention" title="Needs attention">
        <AlertTriangle size={13} />
      </span>
    )
  }

  if (status === 'done_unread' || status === 'done_read') {
    return (
      <span className="task-status-chip done" title={status === 'done_unread' ? 'Done' : 'Done read'}>
        <Check size={13} />
      </span>
    )
  }

  return null
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
            <X size={18} />
          </button>
        </div>

        <label>
          <span>Title</span>
          <textarea
            ref={titleRef}
            className="task-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
            rows={1}
          />
        </label>

        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>
            Cancel
            <span className="key-hint">Esc</span>
          </button>
          <button className="primary-action" type="submit">
            <Plus size={18} />
            <span>Create</span>
            <span className="key-hint">Enter</span>
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
  hasOlderConversations,
  isLoadingOlderConversations,
  canUseCursor,
  onLoadOlderConversations,
  onSendMessage,
  onClose
}: {
  task: Task
  project: Project | null
  conversations: ConversationEntry[]
  changes: CodeChange[]
  hasOlderConversations: boolean
  isLoadingOlderConversations: boolean
  canUseCursor: boolean
  onLoadOlderConversations: () => void
  onSendMessage: (taskId: string, content: string) => void
  onClose: () => void
}): ReactElement {
  const canChat = Boolean(project) && canUseCursor && task.status !== 'processing'

  return (
    <div className="modal-backdrop" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <section className="modal-panel task-detail">
        <div className="modal-head">
          <div>
            <h2>{task.title}</h2>
            <p>{project?.name ?? 'No project'}</p>
          </div>
          <div className="modal-head-actions">
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
            <AgentThread
              conversations={conversations}
              task={task}
              hasOlderConversations={hasOlderConversations}
              isLoadingOlderConversations={isLoadingOlderConversations}
              canSend={canChat}
              disabledLabel={!canUseCursor ? 'Cursor not connected' : !project ? 'No project selected' : 'Running'}
              onLoadOlderConversations={onLoadOlderConversations}
              onSendMessage={onSendMessage}
            />
          </section>

          <section className="detail-column">
            <div className="section-title">
              <Code2 size={16} />
              <span>Code changes</span>
            </div>
            <div className="change-stack">
              {changes.length > 0 && <ChangeSummary changes={changes} />}
              <div className="change-list">
                {changes.length === 0 ? (
                  <div className="detail-empty-state">No changes captured</div>
                ) : (
                  changes.map((change) => <DiffViewer key={change.id} change={change} />)
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}

function AgentThread({
  conversations,
  task,
  hasOlderConversations,
  isLoadingOlderConversations,
  canSend,
  disabledLabel,
  onLoadOlderConversations,
  onSendMessage
}: {
  conversations: ConversationEntry[]
  task: Task
  hasOlderConversations: boolean
  isLoadingOlderConversations: boolean
  canSend: boolean
  disabledLabel: string
  onLoadOlderConversations: () => void
  onSendMessage: (taskId: string, content: string) => void
}): ReactElement {
  const [draft, setDraft] = useState('')
  const [activePromptId, setActivePromptId] = useState<string | null>(null)
  const streamRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const userMessageRefs = useRef(new Map<string, HTMLDivElement>())
  const olderScrollSnapshotRef = useRef<{ height: number; top: number } | null>(null)
  const userEntries = conversations.filter((entry) => entry.role === 'user')
  const latestUserEntry = userEntries.at(-1) ?? null
  const activePromptEntry =
    userEntries.find((entry) => entry.id === activePromptId) ?? latestUserEntry ?? userEntries[0] ?? null
  const prompt = activePromptEntry?.content.trim() ?? ''
  const showSystemEntries = task.status === 'processing' || task.status === 'attention'
  const threadEntries = compactConversationEntries(
    conversations
      .filter(
        (entry) =>
          entry.id !== userEntries[0]?.id &&
          !isNoisyConversationEntry(entry) &&
          (showSystemEntries || entry.role !== 'system')
      )
      .map((entry) => ({
        ...entry,
        content: entry.role === 'user' ? entry.content.trim() : cleanConversationContent(entry.content)
      }))
      .filter((entry) => entry.content)
  )
  const scrollKey = `${task.status}:${threadEntries.map((entry) => `${entry.id}:${entry.content.length}`).join('|')}`

  useEffect(() => {
    setActivePromptId(latestUserEntry?.id ?? null)
  }, [latestUserEntry?.id, task.id])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    composer.style.height = '0px'
    composer.style.height = `${Math.min(composer.scrollHeight, 150)}px`
  }, [draft])

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

  const syncActivePromptFromScroll = (): void => {
    const stream = streamRef.current
    if (!stream || userEntries.length === 0) return

    const anchorY = stream.scrollTop + 32
    let currentEntry = userEntries[0]
    for (const entry of userEntries) {
      const element = userMessageRefs.current.get(entry.id)
      if (!element) continue
      if (element.offsetTop <= anchorY) {
        currentEntry = entry
      } else {
        break
      }
    }
    setActivePromptId((currentId) => (currentId === currentEntry.id ? currentId : currentEntry.id))
  }

  const handleStreamScroll = (): void => {
    maybeLoadOlder()
    syncActivePromptFromScroll()
  }

  const send = (): void => {
    const content = draft.trim()
    if (!canSend || !content) return
    onSendMessage(task.id, content)
    setDraft('')
  }

  return (
    <div className="agent-thread">
      {prompt && (
        <section className="prompt-panel">
          <p>{prompt}</p>
        </section>
      )}

      <div className="agent-stream" ref={streamRef} onScroll={handleStreamScroll}>
        {isLoadingOlderConversations && <div className="thread-empty-state">Loading earlier messages</div>}
        {!prompt && threadEntries.length === 0 ? (
          <div className="thread-empty-state">
            Chat is empty
          </div>
        ) : threadEntries.length === 0 ? (
          <div className="agent-step">
            <Code2 size={16} />
            <div>
              <strong className="agent-step-label">Agent workspace</strong>
              <p>{task.status === 'processing' ? 'Working on this task' : 'Waiting for the agent'}</p>
            </div>
          </div>
        ) : (
          threadEntries.map((entry) => (
            <div
              key={entry.id}
              ref={(element) => {
                if (entry.role !== 'user') return
                if (element) {
                  userMessageRefs.current.set(entry.id, element)
                } else {
                  userMessageRefs.current.delete(entry.id)
                }
              }}
              className={`agent-step role-${entry.role}`}
            >
              {entry.role === 'user' ? <MessageSquare size={16} /> : <Code2 size={16} />}
              <div>
                <strong className="agent-step-label">
                  {entry.role === 'user' ? 'You' : entry.role === 'assistant' ? 'Agent' : 'System'}
                </strong>
                <MessageMarkdown content={entry.content} />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="thread-composer">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!canSend}
          rows={2}
          placeholder={canSend ? 'Message' : disabledLabel}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button className="icon-button" type="button" onClick={send} disabled={!canSend || !draft.trim()} title="Send">
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

function MessageMarkdown({ content }: { content: string }): ReactElement {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
          table({ children }) {
            return (
              <div className="markdown-table-wrap">
                <table>{children}</table>
              </div>
            )
          },
          code({ className, children }) {
            const rawCode = String(children).replace(/\n$/, '')
            const language = normalizeLanguage((className ?? '').replace(/^language-/, ''))
            const isBlock = rawCode.includes('\n') || Boolean(className)

            if (!isBlock) {
              return <code className="inline-code">{children}</code>
            }

            return (
              <code
                className="markdown-code"
                dangerouslySetInnerHTML={{ __html: highlightCode(rawCode, language) }}
              />
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function isNoisyConversationEntry(entry: ConversationEntry): boolean {
  const content = entry.content.trim()
  if (!content) return true
  if (/^(system|user|assistant|thinking|tool_call|result|metadata|init|start|started|end|done|completed|success)$/i.test(content)) return true
  if (content.includes('You are running inside VibeBoard as a background coding agent.')) return true
  if (content.includes('Token and exploration rules:')) return true
  return false
}

function cleanConversationContent(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => cleanConversationLine(line))
    .filter((line) => line && !isProgressNarrationLine(line))
    .join('\n')
    .trim()
}

function cleanConversationLine(line: string): string {
  return line
    .trim()
    .replaceAll('VibeBoardStartActualMessage', '')
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

function cursorStreamMarkerPattern(): RegExp {
  return /\b(?:call--?\d+|call_\d+|tool--?\d+|tool_\d+|fc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_\d+)?)\b/gi
}

function isProgressNarrationLine(line: string): boolean {
  return (
    /^(i('|’)?m|i am|i('|’)?ll|i will|reading|reviewing|examining|checking|running|looking|scanning|opening|inspecting)\b/i.test(
      line
    ) ||
    /^(the user|the request|the context|a modified .+ appears|files to understand|likely about)\b/i.test(line) ||
    /^the project structure is now clear\b/i.test(line) ||
    /^the task is unclear\b/i.test(line) ||
    /^nothing clear to do yet\b/i.test(line) ||
    /^what do you want next\b/i.test(line)
  )
}

function mergeConversationEntries(left: ConversationEntry[], right: ConversationEntry[]): ConversationEntry[] {
  const entriesById = new Map<string, ConversationEntry>()
  for (const entry of left) {
    entriesById.set(entry.id, entry)
  }
  for (const entry of right) {
    entriesById.set(entry.id, entry)
  }
  return Array.from(entriesById.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function compactConversationEntries(entries: ConversationEntry[]): ConversationEntry[] {
  const compacted: ConversationEntry[] = []

  for (const entry of entries) {
    const previous = compacted.at(-1)
    if (previous && previous.role === entry.role) {
      previous.content = joinConversationParts(previous.content, entry.content)
      continue
    }
    compacted.push({ ...entry })
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

function DiffViewer({ change }: { change: CodeChange }): ReactElement {
  const diffText = useMemo(() => change.diffText.trim() || fallbackDiff(change), [change])
  const rows = useMemo(() => parseDiffRows(diffText), [diffText])
  const language = useMemo(
    () => normalizeLanguage(change.language || languageFromPath(change.filePath)),
    [change.filePath, change.language]
  )

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
          {rows.map((row, index) => {
            return (
              <div key={`${index}-${row.raw}`} className={`diff-line ${row.kind}`} role="row">
                <span className="diff-gutter">{row.kind === 'context' ? ' ' : (row.raw[0] ?? ' ')}</span>
                <span className="diff-number">{row.newLine ?? row.oldLine ?? ''}</span>
                <code
                  dangerouslySetInnerHTML={{
                    __html: row.kind === 'hunk' ? escapeHtml(row.text) : highlightCode(row.text, language)
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

interface DiffRow {
  raw: string
  text: string
  kind: 'added' | 'removed' | 'hunk' | 'context'
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

function byPosition<T extends { position: number }>(a: T, b: T): number {
  return a.position - b.position
}
