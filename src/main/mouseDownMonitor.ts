import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

/**
 * Poll left-mouse button state globally on macOS via CoreGraphics
 * (no Accessibility prompt). Emits on press edges only.
 */
const MONITOR_SCRIPT = `
import sys, time
from ctypes import cdll, c_bool, c_uint32
cg = cdll.LoadLibrary("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
cg.CGEventSourceButtonState.restype = c_bool
cg.CGEventSourceButtonState.argtypes = [c_uint32, c_uint32]
prev = None
while True:
    down = bool(cg.CGEventSourceButtonState(1, 0))
    if down != prev:
        if down:
            sys.stdout.write("1\\n")
            sys.stdout.flush()
        prev = down
    time.sleep(0.016)
`

export function startMacMouseDownMonitor(onDown: () => void): () => void {
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
      if (line.trim() === '1') onDown()
    }
  }

  stdout.on('data', handleChunk)
  child.on('error', () => {
    // python3 missing - click-away park falls back to blur / resign-active.
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
