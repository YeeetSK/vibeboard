import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

/**
 * Poll Escape key state globally on macOS via CoreGraphics (no Accessibility prompt).
 * Emits edge transitions only (down / up).
 */
const MONITOR_SCRIPT = `
import sys, time
from ctypes import cdll, c_bool, c_uint32
cg = cdll.LoadLibrary("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
cg.CGEventSourceKeyState.restype = c_bool
cg.CGEventSourceKeyState.argtypes = [c_uint32, c_uint32]
prev = None
while True:
    down = bool(cg.CGEventSourceKeyState(1, 53))
    if down != prev:
        sys.stdout.write("1\\n" if down else "0\\n")
        sys.stdout.flush()
        prev = down
    time.sleep(0.02)
`

export function startMacEscapeKeyMonitor(onChange: (down: boolean) => void): () => void {
  if (process.platform !== 'darwin') {
    return () => undefined
  }

  let child: ChildProcess | null = null
  let stopped = false
  let buffer = ''

  try {
    child = spawn('/usr/bin/python3', ['-c', MONITOR_SCRIPT], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    return () => undefined
  }

  const stdout = child.stdout as Readable | null
  if (!stdout) {
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
    return () => undefined
  }

  const handleChunk = (chunk: Buffer): void => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '1') onChange(true)
      else if (trimmed === '0') onChange(false)
    }
  }

  stdout.on('data', handleChunk)
  child.on('error', () => {
    // python3 missing or failed to start, so Escape hold simply won't work unfocused.
  })
  child.on('exit', () => {
    child = null
  })

  return () => {
    if (stopped) return
    stopped = true
    if (!child || child.killed) return
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
    child = null
  }
}
