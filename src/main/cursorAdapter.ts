import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface CursorAdapterStatus {
  available: boolean
  label: string
}

export interface CursorAdapter {
  status(): Promise<CursorAdapterStatus>
}

export class PlaceholderCursorAdapter implements CursorAdapter {
  async status(): Promise<CursorAdapterStatus> {
    const available = await hasCursorAgent()
    return {
      available,
      label: available ? 'cursor-agent ready' : 'cursor-agent missing'
    }
  }
}

async function hasCursorAgent(): Promise<boolean> {
  try {
    await execFileAsync('cursor-agent', ['--version'])
    return true
  } catch {
    return false
  }
}
