import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
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

async function installCursorCli(): Promise<RunTaskResult> {
  const cursorCommand = await resolveCursorCommand()
  const result = cursorCommand
    ? await runInstallCommand(cursorCommand, ['agent', '--help'])
    : await runInstallCommand('/bin/zsh', ['-lc', 'curl https://cursor.com/install -fsS | bash'])
  const command = await resolveCursorAgentCommand()

  if (command) {
    return { started: true, message: 'Connected to Cursor CLI.' }
  }

  return {
    started: false,
    message: result.message || 'Cursor CLI install did not finish. Check your network, then try Connect again.'
  }
}

async function resolveCursorCommand(): Promise<string | null> {
  const fromShell = await resolveFromShell('cursor')
  if (fromShell) return fromShell

  for (const candidate of cursorCommandCandidates()) {
    if (existsSync(candidate)) return candidate
  }

  return null
}

function cursorCommandCandidates(): string[] {
  return [
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    '/opt/homebrew/bin/cursor',
    '/usr/local/bin/cursor'
  ]
}

function runInstallCommand(command: string, args: string[]): Promise<RunTaskResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env
    })
    let output = ''
    let finished = false

    const finish = (result: RunTaskResult): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish({
        started: false,
        message: 'Still waiting for Cursor CLI install. If Cursor opened a sign-in prompt, finish it there, then click Connect.'
      })
    }, 60000)

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.on('error', (error) => {
      finish({ started: false, message: error.message })
    })

    child.on('close', (code) => {
      finish({
        started: code === 0,
        message: output.trim() || `Cursor CLI installer exited with code ${code ?? 'unknown'}.`
      })
    })
  })
}
