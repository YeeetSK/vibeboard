import { ReactElement, useState } from 'react'
import { Loader2, ScanFace } from 'lucide-react'

export function DevNotchFinishLauncher(): ReactElement {
  const [pending, setPending] = useState(false)
  const [label, setLabel] = useState('Test notch finish')

  return (
    <button
      className="sidebar-nav-item"
      type="button"
      disabled={pending}
      title="Arm finish-chat test: leave VibeBoard, notch appears, then expands after 1.5s"
      onClick={() => {
        setPending(true)
        setLabel('Leave app…')
        void window.vibeboard.scheduleDevNotchFinishTest().finally(() => {
          // Stay armed until notch expand would have fired; UI just hints to leave.
          window.setTimeout(() => {
            setPending(false)
            setLabel('Test notch finish')
          }, 8000)
        })
      }}
    >
      <ScanFace size={16} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  )
}

export function DevNotchRunningLauncher(): ReactElement {
  const [pending, setPending] = useState(false)

  return (
    <button
      className="sidebar-nav-item"
      type="button"
      disabled={pending}
      title="Open running-overview test with simulated agents (no real tasks required)"
      onClick={() => {
        setPending(true)
        void window.vibeboard.scheduleDevNotchRunningTest().finally(() => {
          window.setTimeout(() => setPending(false), 600)
        })
      }}
    >
      <Loader2 size={16} strokeWidth={1.75} />
      <span>{pending ? 'Opening…' : 'Test notch running'}</span>
    </button>
  )
}
