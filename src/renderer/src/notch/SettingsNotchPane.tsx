import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react'
import type { NotchOverlayCapability, NotchOverlaySettings } from '../../../shared/types'

function SettingsSwitch({
  checked,
  disabled,
  onChange,
  label
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  label: string
}): ReactElement {
  return (
    <button
      className={`settings-switch${checked ? ' on' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch-knob" />
    </button>
  )
}

function SettingsRow({
  title,
  description,
  disabled,
  control,
  nested
}: {
  title: string
  description?: ReactNode
  disabled?: boolean
  control: ReactElement
  nested?: boolean
}): ReactElement {
  return (
    <div className={`settings-row${nested ? ' nested' : ''}${disabled ? ' disabled' : ''}`}>
      <div className="settings-row-copy">
        <span className="settings-row-title">{title}</span>
        {description ? <span className="settings-row-desc">{description}</span> : null}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  )
}

export function SettingsNotchPane({
  settings,
  capability,
  feedback,
  onSave
}: {
  settings: NotchOverlaySettings
  capability: NotchOverlayCapability
  feedback: string
  isSaving: boolean
  onSave: (settings: NotchOverlaySettings) => Promise<void>
}): ReactElement {
  const [draft, setDraft] = useState(settings)
  const saveTimerRef = useRef<number | null>(null)
  const latestDraftRef = useRef(settings)

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        void onSave(latestDraftRef.current)
      }
    }
  }, [onSave])

  const persist = (next: NotchOverlaySettings): void => {
    latestDraftRef.current = next
    setDraft(next)
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void onSave(latestDraftRef.current)
    }, 280)
  }

  const expandDisabled = !capability.supported || !draft.enabled

  return (
    <div className="settings-pane-body">
      <header className="settings-pane-intro">
        <h3>Notch</h3>
        <p>Live status at the camera notch when VibeBoard is in the background.</p>
      </header>

      {(capability.reason || !capability.supported || feedback) && (
        <p className={`settings-note${!capability.supported ? ' warn' : ''}`}>
          {feedback || capability.reason || 'Notch overlay needs a notched Mac display.'}
        </p>
      )}

      <div className="settings-block">
        <h4 className="settings-block-label">Overlay</h4>
        <div className="settings-list">
          <SettingsRow
            title="Show overlay"
            description="Compact island with running, done, and inactive status"
            disabled={!capability.supported}
            control={
              <SettingsSwitch
                label="Show overlay"
                checked={draft.enabled}
                disabled={!capability.supported}
                onChange={(checked) => persist({ ...latestDraftRef.current, enabled: checked })}
              />
            }
          />
        </div>
      </div>

      <div className="settings-block">
        <h4 className="settings-block-label">Expand when</h4>
        <div className="settings-list">
          <SettingsRow
            title="Task completed"
            disabled={expandDisabled}
            control={
              <SettingsSwitch
                label="Expand when a task completes"
                checked={draft.expandOnTaskCompleted}
                disabled={expandDisabled}
                onChange={(checked) =>
                  persist({ ...latestDraftRef.current, expandOnTaskCompleted: checked })
                }
              />
            }
          />
          <SettingsRow
            title="Show answer and reply"
            description="Opens the finished task detail instead of only the Done list"
            nested
            disabled={expandDisabled || !draft.expandOnTaskCompleted}
            control={
              <SettingsSwitch
                label="Show answer and reply field"
                checked={draft.showFinishChat}
                disabled={expandDisabled || !draft.expandOnTaskCompleted}
                onChange={(checked) => persist({ ...latestDraftRef.current, showFinishChat: checked })}
              />
            }
          />
          <SettingsRow
            title="Needs attention"
            description="Stays compact and opens the task on click"
            disabled={expandDisabled}
            control={
              <SettingsSwitch
                label="Expand when a task needs attention"
                checked={draft.expandOnAttention}
                disabled={expandDisabled}
                onChange={(checked) =>
                  persist({ ...latestDraftRef.current, expandOnAttention: checked })
                }
              />
            }
          />
          <SettingsRow
            title="All tasks finished"
            disabled={expandDisabled}
            control={
              <SettingsSwitch
                label="Expand when all tasks finish"
                checked={draft.expandOnAllFinished}
                disabled={expandDisabled}
                onChange={(checked) =>
                  persist({ ...latestDraftRef.current, expandOnAllFinished: checked })
                }
              />
            }
          />
        </div>
      </div>
    </div>
  )
}
