import { FormEvent, ReactElement, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NotchOverlaySnapshot } from '../../shared/types'

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
  focusInput: false
}

/** Single newlines become hard breaks so agent replies match the chat layout. */
function preserveMarkdownNewlines(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/([^\n])\n(?!\n)/g, '$1  \n')
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

  const dismiss = (force = false): void => {
    void window.vibeboard.dismissNotchFinishChat(force ? { force: true } : undefined)
  }

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

  if (isFinishChat) {
    return (
      <div className="notch-shell finish-open">
        <button
          className="notch-dismiss-hit"
          type="button"
          aria-label="Dismiss"
          onClick={() => dismiss(false)}
        />
        <div
          className={`notch-island expanded finish-chat tone-${tone}`}
          role="dialog"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              dismiss(true)
            }
          }}
        >
          <span className="notch-top">
            <span className="notch-side notch-side-left">
              <span className="notch-dot" aria-hidden="true" />
              <span className="notch-headline">{snapshot.headline || 'Finished'}</span>
            </span>
            <span className="notch-camera-gap" aria-hidden="true" />
            <span className="notch-side notch-side-right">
              <button
                className="notch-open-task"
                type="button"
                onClick={() => {
                  if (snapshot.taskId) void window.vibeboard.openTaskFromNotch(snapshot.taskId)
                }}
              >
                Open task
              </button>
            </span>
          </span>

          <div className="notch-body">
            {snapshot.taskTitle ? <span className="notch-title">{snapshot.taskTitle}</span> : null}

            {snapshot.answer ? (
              <div className="notch-answer">
                <span className="notch-answer-label">Agent</span>
                <div className="notch-answer-markdown message-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
              <textarea
                ref={inputRef}
                className="notch-reply-input"
                value={draft}
                rows={2}
                placeholder="Reply to continue…"
                disabled={sending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void submitReply()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    dismiss(true)
                  }
                }}
              />
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <button
      className={`notch-island compact tone-${tone}`}
      type="button"
      onClick={handleCompactClick}
      title="Reopen last finish panel, or open a task that needs you"
    >
      <span className="notch-top">
        <span className="notch-side notch-side-left">
          {snapshot.headline ? (
            <>
              <span className="notch-dot" aria-hidden="true" />
              <span className="notch-headline">{snapshot.headline}</span>
            </>
          ) : null}
        </span>
        <span className="notch-camera-gap" aria-hidden="true" />
        <span className="notch-side notch-side-right">
          {snapshot.trailing === 'spinner' ? (
            <span className="notch-spinner" aria-hidden="true" />
          ) : snapshot.trailing ? (
            <span className="notch-trailing">{snapshot.trailing}</span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
