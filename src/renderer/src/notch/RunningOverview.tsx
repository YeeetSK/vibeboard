import { FormEvent, ReactElement, RefObject } from 'react'
import { ArrowLeft, Code2, Pencil, Send, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NotchOverlaySnapshot } from '../../../shared/types'
import { MarkdownCodeBlock } from '../MarkdownCodeBlock'
import { NotchSlotText } from './NotchSlotText'
import { escapeHtml, preserveMarkdownNewlines } from './markdown'

function formatElapsed(iso: string | null, nowMs: number): string {
  if (!iso) return '…'
  const start = Date.parse(iso)
  if (!Number.isFinite(start)) return '…'
  const totalSec = Math.max(0, Math.floor((nowMs - start) / 1000))
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function RunningOverview({
  snapshot,
  surfaceClass,
  escRemaining,
  escHolding,
  draft,
  setDraft,
  sending,
  canSubmit,
  inputRef,
  systemTailRef,
  nowMs,
  editingQueuedId,
  setEditingQueuedId,
  editingQueuedDraft,
  setEditingQueuedDraft,
  submitReply
}: {
  snapshot: NotchOverlaySnapshot
  surfaceClass: string
  escRemaining: string | null
  escHolding: boolean
  draft: string
  setDraft: (value: string) => void
  sending: boolean
  canSubmit: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  systemTailRef: RefObject<HTMLDivElement | null>
  nowMs: number
  editingQueuedId: string | null
  setEditingQueuedId: (value: string | null) => void
  editingQueuedDraft: string
  setEditingQueuedDraft: (value: string) => void
  submitReply: (event?: FormEvent) => Promise<void>
}): ReactElement {
  const isDoneOverview = snapshot.overviewKind === 'done'
  const agents = snapshot.runningAgents
  const selectedId = snapshot.selectedRunningTaskId
  const selectedAgent =
    agents.find((agent) => agent.taskId === selectedId) ??
    (snapshot.runningDetailOpen && selectedId
      ? {
          taskId: selectedId,
          title: snapshot.taskTitle ?? 'Task',
          projectName: snapshot.projectName,
          runStartedAt: null,
          queuedCount: snapshot.queuedMessages.length
        }
      : null)
  const showDetail = Boolean(snapshot.runningDetailOpen && selectedAgent)
  const isParked = snapshot.parked
  const detailStatus = snapshot.selectedRunningStatus
  const isFinishedDetail =
    isDoneOverview || detailStatus === 'done' || detailStatus === 'attention'
  const isStatusSize = snapshot.compactSize
  const isNarrow = snapshot.narrowSize
  const listLabel = isDoneOverview ? 'Done' : 'Running'
  const listBadge =
    agents.length === 1
      ? isDoneOverview
        ? '1 finished'
        : '1 session'
      : isDoneOverview
        ? `${agents.length} finished`
        : `${agents.length} sessions`
  const saveQueuedEdit = async (): Promise<void> => {
    if (!selectedId || !editingQueuedId || !editingQueuedDraft.trim()) return
    await window.vibeboard.updateQueuedTaskMessage({
      taskId: selectedId,
      messageId: editingQueuedId,
      content: editingQueuedDraft
    })
    setEditingQueuedId(null)
    setEditingQueuedDraft('')
  }
  const openAgentDetail = (taskId: string): void => {
    void window.vibeboard.selectNotchRunningTask(taskId)
  }
  const detailTone =
    detailStatus === 'attention'
      ? 'attention'
      : detailStatus === 'done' || isDoneOverview
        ? 'done'
        : 'running'
  const listTone = isDoneOverview ? 'done' : 'running'
  return (
    <div
      className={`notch-shell finish-open${isParked ? ' is-parked' : ''}${
        isStatusSize ? ' is-status-size' : ''
      }${isNarrow ? ' is-narrow' : ''}`}
    >
      <button
        className="notch-dismiss-hit"
        type="button"
        aria-label={
          showDetail
            ? 'Park task'
            : isDoneOverview
              ? 'Close done overview'
              : 'Close running overview'
        }
        aria-hidden={isParked || isStatusSize}
        tabIndex={isParked || isStatusSize ? -1 : 0}
        onMouseDown={(event) => {
          if (isParked || isStatusSize) return
          event.preventDefault()
          if (showDetail) {
            void window.vibeboard.parkNotchFinishChat()
            return
          }
          void window.vibeboard.closeNotchRunningOverview()
        }}
      />
      <div
        className={`notch-island expanded running-overview tone-${
          showDetail ? detailTone : listTone
        }${surfaceClass}${isParked ? ' is-parked' : ''}${
          isStatusSize ? ' is-status-size' : ''
        }${isNarrow ? ' is-narrow' : ''}${showDetail ? ' is-detail' : ' is-list'}`}
        role="dialog"
        aria-label={
          isParked
            ? 'Task minimized, click to expand'
            : showDetail
              ? isDoneOverview
                ? 'Finished task'
                : 'Running task'
              : isDoneOverview
                ? 'Finished tasks'
                : 'Running agents'
        }
        onMouseEnter={() => {
          if (isParked) window.vibeboard.setNotchMousePassthrough(false)
        }}
        onMouseLeave={() => {
          if (isParked) window.vibeboard.setNotchMousePassthrough(true)
        }}
        onClick={() => {
          if (isParked) {
            void window.vibeboard.unparkNotchFinishChat()
            return
          }
          // Stalled mid-expand: clicking the status bar forces a full open.
          if (isStatusSize) {
            if (isDoneOverview) void window.vibeboard.openNotchDoneOverview()
            else void window.vibeboard.openNotchRunningOverview()
          }
        }}
      >
        <div className="notch-running-canvas">
          <span className="notch-top">
            <span className="notch-side notch-side-left">
              {showDetail && !isParked ? (
                <button
                  className="notch-running-back"
                  type="button"
                  disabled={isStatusSize}
                  title={isDoneOverview ? 'Back to finished' : 'Back to agents'}
                  aria-label={isDoneOverview ? 'Back to finished' : 'Back to agents'}
                  onClick={(event) => {
                    event.stopPropagation()
                    setDraft('')
                    setEditingQueuedId(null)
                    setEditingQueuedDraft('')
                    void window.vibeboard.closeNotchRunningDetail()
                  }}
                >
                  <ArrowLeft size={14} strokeWidth={1.75} />
                </button>
              ) : (
                <span className="notch-dot" aria-hidden="true" />
              )}
              <NotchSlotText
                className="notch-headline"
                value={
                  showDetail
                    ? isParked
                      ? snapshot.headline || listLabel
                      : selectedAgent?.title || snapshot.headline || listLabel
                    : listLabel
                }
              />
              {escRemaining != null && !isParked ? (
                <span
                  className={escHolding ? 'notch-esc-close holding' : 'notch-esc-close'}
                  aria-live="polite"
                >
                  ESC to close ({escRemaining}s)
                </span>
              ) : !showDetail ? (
                <span className="notch-queue-badge">{listBadge}</span>
              ) : isParked ? null : isFinishedDetail ? (
                <span className="notch-queue-badge">
                  {detailStatus === 'attention' ? 'Needs you' : 'Finished'}
                </span>
              ) : detailStatus === 'processing' ? (
                <span className="notch-queue-badge">Running</span>
              ) : null}
            </span>
            <span className="notch-camera-gap" aria-hidden="true" />
            <span className="notch-side notch-side-right">
              {showDetail ? (
                <button
                  className="notch-open-task"
                  type="button"
                  disabled={!selectedId || isStatusSize}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (selectedId) void window.vibeboard.openTaskFromNotch(selectedId)
                  }}
                >
                  Open task
                </button>
              ) : null}
            </span>
          </span>

          {showDetail ? (
            <div className="notch-parked-line" aria-hidden={isStatusSize}>
              {isParked ? (
                <>
                  <span className="notch-parked-title">{selectedAgent?.title || 'Task'}</span>
                  {selectedAgent?.projectName ? (
                    <>
                      <span className="notch-parked-sep" aria-hidden="true">
                        ·
                      </span>
                      <span className="notch-parked-project">{selectedAgent.projectName}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  {selectedAgent?.projectName ? (
                    <span className="notch-parked-project">{selectedAgent.projectName}</span>
                  ) : (
                    <span className="notch-parked-project">No project</span>
                  )}
                  {detailStatus === 'processing' ? (
                    <>
                      <span className="notch-parked-sep" aria-hidden="true">
                        ·
                      </span>
                      <span className="notch-parked-project">
                        {formatElapsed(selectedAgent?.runStartedAt ?? null, nowMs)}
                      </span>
                    </>
                  ) : null}
                  {(selectedAgent?.queuedCount ?? 0) > 0 ? (
                    <>
                      <span className="notch-parked-sep" aria-hidden="true">
                        ·
                      </span>
                      <span className="notch-running-list-queued">
                        {selectedAgent?.queuedCount} queued
                      </span>
                    </>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {!showDetail ? (
            <div className="notch-running-list-page" aria-hidden={isStatusSize}>
              <div className="notch-running-list" role="list">
                {agents.map((agent) => (
                  <button
                    key={agent.taskId}
                    type="button"
                    role="listitem"
                    className="notch-running-list-item"
                    disabled={isStatusSize}
                    onClick={() => openAgentDetail(agent.taskId)}
                  >
                    <span className="notch-running-list-main">
                      <span className="notch-running-list-title">{agent.title}</span>
                      <span className="notch-running-list-meta">
                        <span>{agent.projectName ?? 'No project'}</span>
                        {agent.queuedCount > 0 ? (
                          <span className="notch-running-list-queued">
                            {agent.queuedCount} queued
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {!isDoneOverview ? (
                      <span className="notch-running-list-elapsed">
                        {formatElapsed(agent.runStartedAt, nowMs)}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="notch-running-thread" aria-hidden={isParked || isStatusSize}>
                <div ref={systemTailRef} className="notch-running-stream">
                  {!isFinishedDetail && snapshot.systemLines.length > 0 ? (
                    snapshot.systemLines.map((line, index) => (
                      <div
                        key={`${index}-${line.slice(0, 24)}`}
                        className="notch-agent-step role-system"
                      >
                        <Code2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        <div>
                          <strong className="notch-agent-step-label">System</strong>
                          <p>{line}</p>
                        </div>
                      </div>
                    ))
                  ) : !isFinishedDetail && !snapshot.answer ? (
                    <div className="notch-agent-step role-system">
                      <Code2 size={14} strokeWidth={1.75} aria-hidden="true" />
                      <div>
                        <strong className="notch-agent-step-label">System</strong>
                        <p>Waiting for progress…</p>
                      </div>
                    </div>
                  ) : null}
                  {snapshot.answer ? (
                    <div className="notch-answer">
                      <span className="notch-answer-label">
                        <Code2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        Agent
                      </span>
                      <div className="notch-answer-markdown message-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            pre({ children }) {
                              return <>{children}</>
                            },
                            code({ className, children }) {
                              const rawCode = String(children).replace(/\n$/, '')
                              const language = (className ?? '').replace(/^language-/, '')
                              const isBlock = rawCode.includes('\n') || Boolean(className)
                              if (!isBlock) {
                                return <code className="inline-code">{children}</code>
                              }
                              return (
                                <MarkdownCodeBlock
                                  code={rawCode}
                                  language={language}
                                  html={escapeHtml(rawCode)}
                                />
                              )
                            }
                          }}
                        >
                          {preserveMarkdownNewlines(snapshot.answer)}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : isFinishedDetail ? (
                    <div className="notch-agent-step role-system">
                      <Code2 size={14} strokeWidth={1.75} aria-hidden="true" />
                      <div>
                        <strong className="notch-agent-step-label">System</strong>
                        <p>Finished. Open the task to read the full reply.</p>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="notch-composer-stack">
                  {snapshot.queuedMessages.length > 0 ? (
                    <div className="notch-queued-tray" aria-label="Queued messages">
                      <div className="notch-queued-tray-header">
                        <span className="notch-queued-tray-count">
                          {snapshot.queuedMessages.length} Queued
                        </span>
                        <span className="notch-queued-tray-hint">
                          {isFinishedDetail ? 'next' : 'after current run'}
                        </span>
                      </div>
                      <div className="notch-queued-tray-list">
                        {snapshot.queuedMessages.map((queued) => (
                          <div key={queued.id} className="notch-queued-tray-item">
                            {editingQueuedId === queued.id ? (
                              <form
                                className="notch-queued-edit"
                                onSubmit={(event) => {
                                  event.preventDefault()
                                  void saveQueuedEdit()
                                }}
                              >
                                <textarea
                                  className="notch-queued-edit-input"
                                  value={editingQueuedDraft}
                                  rows={2}
                                  autoFocus
                                  onChange={(event) => setEditingQueuedDraft(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                      event.preventDefault()
                                      setEditingQueuedId(null)
                                      setEditingQueuedDraft('')
                                    }
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                      event.preventDefault()
                                      void saveQueuedEdit()
                                    }
                                  }}
                                />
                                <div className="notch-queued-edit-actions">
                                  <button type="submit" className="notch-queued-edit-save">
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    className="notch-queued-edit-cancel"
                                    onClick={() => {
                                      setEditingQueuedId(null)
                                      setEditingQueuedDraft('')
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <span className="notch-queued-tray-text">{queued.content}</span>
                                <div className="notch-queued-actions">
                                  <button
                                    type="button"
                                    className="notch-queued-action"
                                    title="Edit queued message"
                                    aria-label="Edit queued message"
                                    onClick={() => {
                                      setEditingQueuedId(queued.id)
                                      setEditingQueuedDraft(queued.content)
                                    }}
                                  >
                                    <Pencil size={13} strokeWidth={1.75} />
                                  </button>
                                  <button
                                    type="button"
                                    className="notch-queued-action is-danger"
                                    title="Remove queued message"
                                    aria-label="Remove queued message"
                                    onClick={() => {
                                      if (!selectedId) return
                                      void window.vibeboard.removeQueuedTaskMessage({
                                        taskId: selectedId,
                                        messageId: queued.id
                                      })
                                    }}
                                  >
                                    <Trash2 size={13} strokeWidth={1.75} />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <form
                    className="notch-running-composer"
                    onSubmit={(event) => {
                      void submitReply(event)
                    }}
                  >
                    <textarea
                      ref={inputRef}
                      className="notch-running-composer-input"
                      value={draft}
                      rows={1}
                      placeholder={isFinishedDetail ? 'Message…' : 'Queue a follow-up…'}
                      disabled={sending || !selectedId || isStatusSize}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          void submitReply()
                        }
                      }}
                    />
                    <button
                      className="notch-running-composer-send"
                      type="submit"
                      disabled={!canSubmit || isStatusSize}
                      title="Queue message"
                      aria-label="Queue message"
                    >
                      <Send size={15} strokeWidth={1.75} />
                    </button>
                  </form>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
