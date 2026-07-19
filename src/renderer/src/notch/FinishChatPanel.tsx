import { FormEvent, ReactElement, RefObject } from 'react'
import { Code2, Send } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { NotchOverlaySnapshot } from '../../../shared/types'
import { MarkdownCodeBlock } from '../MarkdownCodeBlock'
import { NotchSlotText } from './NotchSlotText'
import { escapeHtml, preserveMarkdownNewlines } from './markdown'

export function FinishChatPanel({
  snapshot,
  tone,
  surfaceClass,
  escRemaining,
  escHolding,
  draft,
  setDraft,
  sending,
  canSubmit,
  inputRef,
  submitReply
}: {
  snapshot: NotchOverlaySnapshot
  tone: string
  surfaceClass: string
  escRemaining: string | null
  escHolding: boolean
  draft: string
  setDraft: (value: string) => void
  sending: boolean
  canSubmit: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  submitReply: (event?: FormEvent) => Promise<void>
}): ReactElement {
  const isParked = snapshot.parked
  const isStatusSize = snapshot.compactSize
  const isNarrow = snapshot.narrowSize
  return (
    <div
      className={`notch-shell finish-open${isParked ? ' is-parked' : ''}${
        isStatusSize ? ' is-status-size' : ''
      }${isNarrow ? ' is-narrow' : ''}`}
    >
      <button
        className="notch-dismiss-hit"
        type="button"
        aria-label="Park finished chat"
        aria-hidden={isParked || isStatusSize}
        tabIndex={isParked || isStatusSize ? -1 : 0}
        onMouseDown={(event) => {
          if (isParked || isStatusSize) return
          // Park on press so it wins over focus/input side effects.
          event.preventDefault()
          void window.vibeboard.parkNotchFinishChat()
        }}
      />
      <div
        className={`notch-island expanded finish-chat tone-${tone}${surfaceClass}${
          isParked ? ' is-parked' : ''
        }${isStatusSize ? ' is-status-size' : ''}${isNarrow ? ' is-narrow' : ''}`}
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
        <div className="notch-finish-canvas">
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
              {snapshot.projectName ? (
                <>
                  <span className="notch-parked-sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="notch-parked-project">{snapshot.projectName}</span>
                </>
              ) : null}
            </div>
          ) : null}

          <div
            className="notch-body"
            aria-hidden={isParked || isStatusSize}
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
                  disabled={sending || isStatusSize || isParked}
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
                  disabled={!canSubmit || isStatusSize || isParked}
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
    </div>
  )
}
