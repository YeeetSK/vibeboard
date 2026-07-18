import { FormEvent, ReactElement, useEffect, useRef, useState } from 'react'
import { Code2, Send } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NotchOverlaySnapshot } from '../../shared/types'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { NotchSlotText } from './NotchSlotText'

const emptySnapshot: NotchOverlaySnapshot = {
  mode: 'compact',
  runningCount: 0,
  attentionCount: 0,
  doneCount: 0,
  headline: '',
  trailing: null,
  detail: null,
  taskId: null,
  taskTitle: null,
  answer: null,
  showReply: false,
  focusInput: false,
  surfaceVisible: false,
  escapeCloseRemainingSec: null,
  parked: false,
  finishQueueRemaining: 0
}

/** Single newlines become hard breaks so agent replies match the chat layout. */
function preserveMarkdownNewlines(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/([^\n])\n(?!\n)/g, '$1  \n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function OverlayApp(): ReactElement {
  const [snapshot, setSnapshot] = useState<NotchOverlaySnapshot>(emptySnapshot)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.vibeboard.getNotchOverlaySnapshot().then((next) => {
      if (!cancelled) setSnapshot(next)
    })
    const unsubscribe = window.vibeboard.onNotchOverlaySnapshot(setSnapshot)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!snapshot.showReply || !snapshot.focusInput) return
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 40)
    return () => window.clearTimeout(timer)
  }, [snapshot.focusInput, snapshot.showReply, snapshot.taskId])

  useEffect(() => {
    if (!snapshot.showReply) setDraft('')
  }, [snapshot.showReply, snapshot.taskId])

  const isFinishChat = Boolean(snapshot.mode === 'expanded' && snapshot.showReply)

  const tone =
    snapshot.headline === 'Needs you'
      ? 'attention'
      : snapshot.headline === 'Running'
        ? 'running'
        : snapshot.headline === 'Finished' ||
            snapshot.headline === 'All done' ||
            snapshot.headline === 'Done'
          ? 'done'
          : 'idle'

  const handleCompactClick = (): void => {
    void window.vibeboard.reopenNotchFinishChat().then((opened) => {
      if (opened) return
      if (snapshot.attentionCount > 0 || snapshot.headline === 'Needs you') {
        if (snapshot.taskId) void window.vibeboard.openTaskFromNotch(snapshot.taskId)
      }
    })
  }

  const submitReply = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (!snapshot.taskId || !draft.trim() || sending) return
    setSending(true)
    try {
      await window.vibeboard.sendNotchReply({ taskId: snapshot.taskId, content: draft })
      setDraft('')
    } finally {
      setSending(false)
    }
  }

  const hasVisibleContent = Boolean(
    snapshot.showReply || snapshot.headline.trim() || snapshot.trailing
  )
  // Never paint an empty black pill: only reveal the island when there is content.
  const surfaceClass = snapshot.surfaceVisible && hasVisibleContent ? ' surface-visible' : ''
  const canSubmit = Boolean(snapshot.taskId && draft.trim() && !sending)
  const escRemaining =
    snapshot.escapeCloseRemainingSec == null
      ? null
      : snapshot.escapeCloseRemainingSec.toFixed(1)
  const escHolding =
    snapshot.escapeCloseRemainingSec != null && snapshot.escapeCloseRemainingSec < 1.5

  // Idle / empty: render nothing so a visible window never paints black chrome.
  if (!isFinishChat && !hasVisibleContent) {
    return <div className="notch-shell is-idle" aria-hidden="true" />
  }

  if (isFinishChat) {
    const isParked = snapshot.parked
    return (
      <div className={`notch-shell finish-open${isParked ? ' is-parked' : ''}`}>
        {!isParked ? (
          <button
            className="notch-dismiss-hit"
            type="button"
            aria-label="Park finished chat"
            onMouseDown={(event) => {
              // Park on press so it wins over focus/input side effects.
              event.preventDefault()
              void window.vibeboard.parkNotchFinishChat()
            }}
          />
        ) : null}
        <div
          className={`notch-island expanded finish-chat tone-${tone}${surfaceClass}${isParked ? ' is-parked' : ''}`}
          role="dialog"
          aria-label={isParked ? 'Finished task, click to expand' : 'Task finished'}
          onMouseEnter={() => {
            if (isParked) window.vibeboard.setNotchMousePassthrough(false)
          }}
          onMouseLeave={() => {
            if (isParked) window.vibeboard.setNotchMousePassthrough(true)
          }}
          onClick={() => {
            if (isParked) void window.vibeboard.unparkNotchFinishChat()
          }}
        >
          <span className="notch-top">
            <span className="notch-side notch-side-left">
              <span className="notch-dot" aria-hidden="true" />
              <NotchSlotText
                className="notch-headline"
                value={snapshot.headline || 'Finished'}
              />
              {escRemaining != null ? (
                <span
                  className={escHolding ? 'notch-esc-close holding' : 'notch-esc-close'}
                  aria-live="polite"
                >
                  ESC to close ({escRemaining}s)
                </span>
              ) : null}
              {snapshot.finishQueueRemaining > 0 ? (
                <span className="notch-queue-badge">
                  +{snapshot.finishQueueRemaining} more
                </span>
              ) : null}
            </span>
            <span className="notch-camera-gap" aria-hidden="true" />
            <span className="notch-side notch-side-right">
              <button
                className="notch-open-task"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  if (snapshot.taskId) void window.vibeboard.openTaskFromNotch(snapshot.taskId)
                }}
              >
                Open task
              </button>
            </span>
          </span>

          {snapshot.taskTitle ? (
            <div className="notch-parked-line">
              <span className="notch-parked-title">{snapshot.taskTitle}</span>
            </div>
          ) : null}

          <div
            className="notch-body"
            aria-hidden={isParked}
            onClick={(event) => event.stopPropagation()}
          >
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
            ) : (
              <p className="notch-detail">No agent reply yet.</p>
            )}

            <form
              className="notch-reply"
              onSubmit={(event) => {
                void submitReply(event)
              }}
            >
              <div className="notch-reply-bar">
                <textarea
                  ref={inputRef}
                  className="notch-reply-input"
                  value={draft}
                  rows={1}
                  placeholder="Message…"
                  disabled={sending}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void submitReply()
                    }
                  }}
                />
                <button
                  className="notch-reply-send"
                  type="submit"
                  disabled={!canSubmit}
                  title="Send"
                  aria-label="Send"
                >
                  <Send size={15} strokeWidth={1.75} />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <button
      className={`notch-island compact tone-${tone}${surfaceClass}`}
      type="button"
      onClick={handleCompactClick}
      title="Reopen last finish panel, or open a task that needs you"
    >
      <span className="notch-top">
        <span className="notch-side notch-side-left">
          {snapshot.headline ? (
            <>
              <span className="notch-dot" aria-hidden="true" />
              <NotchSlotText className="notch-headline" value={snapshot.headline} />
            </>
          ) : null}
        </span>
        <span className="notch-camera-gap" aria-hidden="true" />
        <span className="notch-side notch-side-right">
          <NotchSlotText
            className="notch-trailing"
            value={
              snapshot.trailing === 'spinner'
                ? 'spinner'
                : snapshot.trailing
                  ? snapshot.trailing
                  : null
            }
          />
        </span>
      </span>
    </button>
  )
}
