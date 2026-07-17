const DURATION_MS = 1600
const PROCESSING_SELECTOR = '.status-processing, .result-status-processing'

/** Shared wall-clock driven CSS vars so every in-progress indicator stays in phase. */
export function startProcessingClock(): () => void {
  const root = document.documentElement
  let raf = 0
  let running = false

  const tick = (now: number): void => {
    const phase = (now % DURATION_MS) / DURATION_MS
    root.style.setProperty('--processing-angle', `${(phase * 360).toFixed(2)}deg`)
    const pulse = 0.25 + 0.45 * 0.5 * (1 - Math.cos(phase * Math.PI * 2))
    root.style.setProperty('--processing-pulse', pulse.toFixed(4))
    raf = requestAnimationFrame(tick)
  }

  const syncRunning = (): void => {
    const active = Boolean(document.querySelector(PROCESSING_SELECTOR))
    if (active && !running) {
      running = true
      raf = requestAnimationFrame(tick)
      return
    }
    if (!active && running) {
      running = false
      cancelAnimationFrame(raf)
      raf = 0
    }
  }

  const observer = new MutationObserver(syncRunning)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class']
  })
  syncRunning()

  return () => {
    observer.disconnect()
    cancelAnimationFrame(raf)
  }
}
