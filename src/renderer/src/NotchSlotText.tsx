import { ReactElement, useEffect, useRef, useState } from 'react'

type SlotValue = string | 'spinner' | null

/**
 * Slot-machine style value swap: outgoing slides up, incoming rises from below.
 * Used for notch headline + trailing count/status changes.
 */
export function NotchSlotText({
  value,
  className,
  render
}: {
  value: SlotValue
  className?: string
  render?: (value: Exclude<SlotValue, null>) => ReactElement
}): ReactElement | null {
  const [shown, setShown] = useState<SlotValue>(value)
  const [outgoing, setOutgoing] = useState<SlotValue>(null)
  const [rolling, setRolling] = useState(false)
  const shownRef = useRef<SlotValue>(value)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (value === shownRef.current) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const previous = shownRef.current
    shownRef.current = value

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (prefersReduced || previous == null || value == null) {
      setOutgoing(null)
      setShown(value)
      setRolling(false)
      return
    }

    setOutgoing(previous)
    setShown(value)
    setRolling(true)
    timerRef.current = window.setTimeout(() => {
      setOutgoing(null)
      setRolling(false)
      timerRef.current = null
    }, 340)

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [value])

  if (shown == null && outgoing == null) return null

  const paint = (item: Exclude<SlotValue, null>): ReactElement => {
    if (render) return render(item)
    if (item === 'spinner') return <span className="notch-spinner" aria-hidden="true" />
    return <>{item}</>
  }

  return (
    <span className={`notch-slot${className ? ` ${className}` : ''}`} aria-live="polite">
      <span className={`notch-slot-track${rolling && outgoing != null ? ' is-rolling' : ''}`}>
        {outgoing != null ? <span className="notch-slot-item">{paint(outgoing)}</span> : null}
        {shown != null ? <span className="notch-slot-item">{paint(shown)}</span> : null}
      </span>
    </span>
  )
}
