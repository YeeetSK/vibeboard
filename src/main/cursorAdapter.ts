import { execFile, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { RunTaskResult } from '../shared/types'

const execFileAsync = promisify(execFile)

export interface CursorAdapterStatus {
  available: boolean
  label: string
}

export interface CursorAdapter {
  status(): Promise<CursorAdapterStatus>
  installCli(): Promise<RunTaskResult>
}

export class PlaceholderCursorAdapter implements CursorAdapter {
  async status(): Promise<CursorAdapterStatus> {
    const command = await resolveCursorAgentCommand()
    return {
      available: Boolean(command),
      label: command ? 'cursor-agent ready' : 'cursor-agent missing'
    }
  }

  installCli(): Promise<RunTaskResult> {
    return installCursorCli()
  }
}

export async function resolveCursorAgentCommand(): Promise<string | null> {
  const fromShell = await resolveFromShell('cursor-agent')
  if (fromShell) return fromShell

  for (const candidate of cursorAgentCandidates()) {
    if (await canRun(candidate)) return candidate
  }

  return null
}

async function resolveFromShell(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/bin/zsh', ['-lc', `command -v ${command}`])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function canRun(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version'])
    return true
  } catch {
    return false
  }
}

function cursorAgentCandidates(): string[] {
  const home = os.homedir()
  return [
    path.join(home, '.local', 'bin', 'cursor-agent'),
    path.join(home, '.cursor', 'bin', 'cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent'
  ]
}

function installCursorCli(): Promise<RunTaskResult> {
  return new Promise((resolve) => {
    const child = spawn('/bin/zsh', ['-lc', 'curl https://cursor.com/install -fsS | bash'], {
      env: process.env
    })
    let output = ''

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.on('error', (error) => {
      resolve({ started: false, message: error.message })
    })

    child.on('close', async (code) => {
      const command = await resolveCursorAgentCommand()
      resolve({
        started: code === 0 && Boolean(command),
        message: command ? 'Cursor CLI installed.' : output.trim() || `Cursor CLI installer exited with code ${code ?? 'unknown'}.`
      })
    })
  })
}
