import { FormEvent, ReactElement, useEffect, useRef, useState } from 'react'
import type { NotchOverlaySnapshot } from '../../../shared/types'
import { emptyNotchOverlaySnapshot } from '../../../shared/notch'
import { CompactStatus } from './CompactStatus'
import { FinishChatPanel } from './FinishChatPanel'
import { RunningOverview } from './RunningOverview'

export function OverlayApp(): ReactElement {
  const [snapshot, setSnapshot] = useState<NotchOverlaySnapshot>(emptyNotchOverlaySnapshot())
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null)
  const [editingQueuedDraft, setEditingQueuedDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const systemTailRef = useRef<HTMLDivElement>(null)

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
    if (!snapshot.showRunningOverview || !snapshot.runningDetailOpen) return
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 40)
    return () => window.clearTimeout(timer)
  }, [snapshot.showRunningOverview, snapshot.runningDetailOpen, snapshot.selectedRunningTaskId])

  useEffect(() => {
    if (!snapshot.showReply && !snapshot.showRunningOverview) setDraft('')
    setEditingQueuedId(null)
    setEditingQueuedDraft('')
  }, [snapshot.showReply, snapshot.showRunningOverview, snapshot.taskId, snapshot.selectedRunningTaskId])

  useEffect(() => {
    if (!editingQueuedId) return
    if (!snapshot.queuedMessages.some((item) => item.id === editingQueuedId)) {
      setEditingQueuedId(null)
      setEditingQueuedDraft('')
    }
  }, [editingQueuedId, snapshot.queuedMessages])

  useEffect(() => {
    if (!snapshot.showRunningOverview) return
    // Only tick while something is actually running - finished/idle stays frozen.
    const hasLiveTimer =
      snapshot.selectedRunningStatus === 'processing' ||
      (snapshot.overviewKind !== 'done' &&
        !snapshot.runningDetailOpen &&
        snapshot.runningAgents.length > 0)
    if (!hasLiveTimer) return
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [
    snapshot.showRunningOverview,
    snapshot.selectedRunningStatus,
    snapshot.overviewKind,
    snapshot.runningDetailOpen,
    snapshot.runningAgents.length
  ])

  useEffect(() => {
    if (!snapshot.showRunningOverview) return
    const el = systemTailRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [snapshot.showRunningOverview, snapshot.selectedRunningTaskId, snapshot.systemLines])

  const isFinishChat = Boolean(snapshot.mode === 'expanded' && snapshot.showReply)
  const isRunningOverview = Boolean(snapshot.mode === 'expanded' && snapshot.showRunningOverview)

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
    if (snapshot.headline === 'Done') {
      void window.vibeboard.openNotchDoneOverview()
      return
    }
    void window.vibeboard.reopenNotchFinishChat().then((opened) => {
      if (opened) return
      if (snapshot.headline === 'Running' || snapshot.runningCount > 0) {
        void window.vibeboard.openNotchRunningOverview()
        return
      }
      if (snapshot.attentionCount > 0 || snapshot.headline === 'Needs you') {
        if (snapshot.taskId) void window.vibeboard.openTaskFromNotch(snapshot.taskId)
      }
    })
  }

  const submitReply = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    const taskId = snapshot.selectedRunningTaskId ?? snapshot.taskId
    if (!taskId || !draft.trim() || sending) return
    setSending(true)
    try {
      await window.vibeboard.sendNotchReply({ taskId, content: draft })
      setDraft('')
    } catch {
      // Keep the draft so the user can retry.
    } finally {
      setSending(false)
    }
  }

  const hasVisibleContent = Boolean(
    snapshot.showReply ||
      snapshot.showRunningOverview ||
      snapshot.headline.trim() ||
      snapshot.trailing
  )
  // Never paint an empty black pill: only reveal the island when there is content.
  const surfaceClass = snapshot.surfaceVisible && hasVisibleContent ? ' surface-visible' : ''
  const activeTaskId = snapshot.selectedRunningTaskId ?? snapshot.taskId
  const canSubmit = Boolean(activeTaskId && draft.trim() && !sending)
  const escRemaining =
    snapshot.escapeCloseRemainingSec == null
      ? null
      : snapshot.escapeCloseRemainingSec.toFixed(1)
  const escHolding =
    snapshot.escapeCloseRemainingSec != null && snapshot.escapeCloseRemainingSec < 0.5

  // Idle / empty: render nothing so a visible window never paints black chrome.
  if (!isFinishChat && !isRunningOverview && !hasVisibleContent) {
    return <div className="notch-shell is-idle" aria-hidden="true" />
  }

  if (isRunningOverview) {
    return (
      <RunningOverview
        snapshot={snapshot}
        surfaceClass={surfaceClass}
        escRemaining={escRemaining}
        escHolding={escHolding}
        draft={draft}
        setDraft={setDraft}
        sending={sending}
        canSubmit={canSubmit}
        inputRef={inputRef}
        systemTailRef={systemTailRef}
        nowMs={nowMs}
        editingQueuedId={editingQueuedId}
        setEditingQueuedId={setEditingQueuedId}
        editingQueuedDraft={editingQueuedDraft}
        setEditingQueuedDraft={setEditingQueuedDraft}
        submitReply={submitReply}
      />
    )
  }

  if (isFinishChat) {
    return (
      <FinishChatPanel
        snapshot={snapshot}
        tone={tone}
        surfaceClass={surfaceClass}
        escRemaining={escRemaining}
        escHolding={escHolding}
        draft={draft}
        setDraft={setDraft}
        sending={sending}
        canSubmit={canSubmit}
        inputRef={inputRef}
        submitReply={submitReply}
      />
    )
  }

  return (
    <CompactStatus
      snapshot={snapshot}
      tone={tone}
      surfaceClass={surfaceClass}
      onClick={handleCompactClick}
    />
  )
}
